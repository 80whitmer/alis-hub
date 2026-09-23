/**
 * Tier-rolled-up portfolio KPIs, ported from alis-product-ops's
 * server/services/kpiMetrics.js (Aaron, Sep 2026: "I actually love all of
 * these rolled up tier kpis on the Product dashboard — make sure those are
 * rolled into the Team AM dashboard, and filtered down in a person view on
 * the AH with tracking and trending"). Runs over the same enriched account
 * objects each page serves (getEnrichedTeamAmAccounts / getEnrichedAccounts),
 * so the recorded trend and the "current" bars can't drift apart.
 *
 * Capacity prefers ALIS total_capacity (occupancy refresh), falling back to
 * HubSpot's hand-maintained company_total_capacity (Team AM only). Averages
 * per community divide by communitiesWithCapacity — only communities of
 * accounts that HAVE a capacity figure — so accounts never refreshed for
 * occupancy don't drag the average toward zero.
 */

function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}

const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];

const METRIC_KEYS = [
  'arrCents', 'companyCount', 'communityCount', 'capacityBeds', 'communitiesWithCapacity',
  'arrAddedThisYearCents', 'companiesContributingArr', 'communitiesContributingArr',
];

const ARR_BANDS = [
  { key: 'No ARR', maxDollars: 0 },
  { key: '$1–25k', maxDollars: 25000 },
  { key: '$25k–50k', maxDollars: 50000 },
  { key: '$50k–100k', maxDollars: 100000 },
  { key: '$100k–250k', maxDollars: 250000 },
  { key: '$250k–500k', maxDollars: 500000 },
  { key: '$500k+', maxDollars: Infinity },
];

function arrBandFor(arrCents) {
  const dollars = (arrCents || 0) / 100;
  return (ARR_BANDS.find((b) => dollars <= b.maxDollars) || ARR_BANDS[ARR_BANDS.length - 1]).key;
}

function capacityFor(a) {
  if (a.total_capacity > 0) return a.total_capacity;
  if (a.hubspot_capacity > 0) return a.hubspot_capacity;
  return null;
}

function emptyBucket() {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
}

function addAccount(bucket, a) {
  const communities = a.active_community_count || 0;
  const capacity = capacityFor(a);
  bucket.arrCents += a.arr_cents || 0;
  bucket.companyCount += 1;
  bucket.communityCount += communities;
  if (capacity != null) {
    bucket.capacityBeds += capacity;
    bucket.communitiesWithCapacity += communities;
  }
  bucket.arrAddedThisYearCents += a.arr_added_this_year_cents || 0;
  if ((a.arr_added_this_year_cents || 0) > 0) {
    bucket.companiesContributingArr += 1;
    bucket.communitiesContributingArr += communities;
  }
}

/** Lifecycle-flagged accounts are excluded, same as every other trended total on both pages. `includeAm` adds the per-Account-Manager rollup (Team AM only). */
function computeTierKpis(accounts, { includeAm = false } = {}) {
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const byTier = new Map();
  const byAm = new Map();
  const byArrBand = new Map(ARR_BANDS.map((b) => [b.key, {}]));

  for (const a of clean) {
    const tier = tierLabel(a.tier);
    if (!byTier.has(tier)) byTier.set(tier, emptyBucket());
    addAccount(byTier.get(tier), a);
    if (includeAm) {
      const am = a.account_manager_name || 'Unassigned';
      if (!byAm.has(am)) byAm.set(am, emptyBucket());
      addAccount(byAm.get(am), a);
    }
    const band = byArrBand.get(arrBandFor(a.arr_cents));
    band[tier] = (band[tier] || 0) + 1;
  }

  const tiers = TIER_ORDER.filter((t) => byTier.has(t));
  const rows = { tier: [], am: [], arrBand: [] };
  for (const [scopeKey, m] of byTier) {
    for (const metricKey of METRIC_KEYS) rows.tier.push({ scopeKey, metricKey, value: m[metricKey] });
  }
  for (const [scopeKey, m] of byAm) {
    for (const metricKey of METRIC_KEYS) rows.am.push({ scopeKey, metricKey, value: m[metricKey] });
  }
  const bandRows = ARR_BANDS.map((b) => {
    const counts = byArrBand.get(b.key);
    const row = { band: b.key, companyCount: 0 };
    for (const t of tiers) {
      row[t] = counts[t] || 0;
      row.companyCount += row[t];
    }
    rows.arrBand.push({ scopeKey: b.key, metricKey: 'companyCount', value: row.companyCount });
    return row;
  });

  return {
    current: {
      tiers,
      byTier: Object.fromEntries(byTier),
      byAm: includeAm ? Object.fromEntries(byAm) : undefined,
      byArrBand: bandRows,
    },
    rows,
  };
}

const SCOPE_SUFFIXES = { tier: 'tier_kpi', am: 'am_kpi', arrBand: 'arr_band' };

/** Records today's point under `${prefix}_tier_kpi` etc. — new scopes, separate from each page's existing 'team_am'/'account_health' rows, so this can't collide with (or push past the row cap of) the trends already there. */
function recordTierKpis(prefix, accounts, opts) {
  const { recordKpiMetricSnapshots } = require('../db/database');
  const { rows } = computeTierKpis(accounts, opts);
  for (const [key, suffix] of Object.entries(SCOPE_SUFFIXES)) {
    if (rows[key].length) recordKpiMetricSnapshots(`${prefix}_${suffix}`, rows[key]);
  }
}

/** { current, history: {tier, am, arrBand} } for the Tier KPIs sections. Records a first point if this prefix has no history at all yet, so a fresh install shows today's bars in the trend immediately instead of waiting for the next refresh. */
function getTierKpiPayload(prefix, accounts, opts) {
  const { getKpiMetricHistoryRows } = require('../db/database');
  const { current } = computeTierKpis(accounts, opts);
  const read = () => Object.fromEntries(
    Object.entries(SCOPE_SUFFIXES).map(([key, suffix]) => [key, getKpiMetricHistoryRows(`${prefix}_${suffix}`)])
  );
  let history = read();
  if (history.tier.length === 0 && accounts.length > 0) {
    recordTierKpis(prefix, accounts, opts);
    history = read();
  }
  return { current, history };
}

module.exports = { computeTierKpis, recordTierKpis, getTierKpiPayload };
