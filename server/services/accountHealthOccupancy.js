/**
 * Total capacity + current census for the Account Health Dashboard — a
 * true point-in-time snapshot (today's beds/residents), not the
 * room-days-across-the-whole-month figure normalizeOccupancy() usually
 * feeds into elsewhere in this app (KPI Dashboard/QBR/Wellness, which
 * report on a whole period). Reuses that same normalizer for its
 * byProductType/byClassification breakdown — the shape is identical,
 * only the INPUT rows differ (filtered to one day here, a whole month
 * there).
 *
 * Requires a known ALIS subdomain per account (server/api/companyHosts.js)
 * — a genuinely separate, Basic-Auth-per-subdomain external API, unlike
 * everything else on this dashboard (all HubSpot). Confirmed live (Sep
 * 2026) only 7 of 109 accounts have a remembered mapping; this is why
 * occupancy refresh is its own action/button, not bundled into the main
 * HubSpot refresh — accounts with no mapping just show no occupancy data
 * rather than blocking or slowing down everything else. Supports more
 * than one subdomain per account (comma-separated in the same cell, per
 * Aaron — Sep 2026) for a Home Office that spans multiple ALIS instances;
 * results are merged before computing today's snapshot, same convention
 * kpiExport.js/wellnessExport.js/usageAudit.js already use.
 */
const { getCompanyHost } = require('../db/database');
const { getOccupancy, getResidents, getHistoricalFloorPlan } = require('./alisApiClient');
const { normalizeOccupancy } = require('./kpiNormalizer');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// A HubSpot company can span more than one ALIS instance (e.g. grew
// through M&A, communities split across two separate ALIS subdomains) —
// company_host already supports this as a comma-separated list, the same
// convention kpiExport.js/wellnessExport.js/usageAudit.js already use
// (and upsertCompanyHost already merges into on conflict). This was the
// one consumer of company_host that didn't split it yet — duplicated
// locally rather than imported, matching this codebase's established
// small-helper-duplication pattern elsewhere.
function parseHosts(companyHost) {
  return String(companyHost || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * hqOccupancies returns one row per room per day for the whole
 * `monthAndYear` (defaults to the current month when omitted — confirmed
 * live via ALIS's own OpenAPI spec). Filtering to exactly today's `date`
 * turns normalizeOccupancy's usual "room-days this month" figures into a
 * true today snapshot (total = capacity today, occupied = census today).
 * Falls back to the most recent date actually present in the pull if
 * today's rows haven't posted yet (data lag), rather than reporting a
 * false "no data" for an account that's still very much occupied.
 */
function filterToLatestDay(rawRows) {
  // Confirmed live (Sep 2026, Leisure Care — ~7,000 residents, large
  // enough that a single month's rows exceed getOccupancy's 100k-row
  // safety cap): hqOccupancies rows for the current month include
  // `dataSet: "Occupied"`/"Vacant" rows tagged `forecastStatus:
  // "Forecast"` reaching all the way to month-end, and pagination
  // truncation had already dropped every early-month date (including
  // today) before this filter even ran — so "pick the latest date
  // present" landed on the 30th, reporting a forward projection as
  // "current" census. A "current" census can never legitimately come
  // from a date after today, regardless of why — so the fallback below
  // only ever looks backward from today, never forward, and reports no
  // data at all if that's all that's available rather than a
  // plausible-looking wrong number.
  const actual = rawRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');

  const today = todayIso();
  const todayRows = actual.filter((r) => r.date === today);
  if (todayRows.length > 0) return { rows: todayRows, asOfDate: today };

  const pastDates = [...new Set(actual.map((r) => r.date).filter((d) => d && d <= today))].sort();
  const latest = pastDates[pastDates.length - 1];
  if (!latest) return { rows: [], asOfDate: null };
  return { rows: actual.filter((r) => r.date === latest), asOfDate: latest };
}

/**
 * historicalFloorPlan is a room-INVENTORY log (one row per physical
 * room/bed ever configured, `isInitial`/`createdAt` tracking history),
 * not a day-by-day snapshot like hqOccupancies — so "current capacity"
 * means dedupe to each room's latest row and count the ones not
 * disabled/retired, not just `rows.length`. Confirmed live (Sep 2026,
 * "Hickory Senior Living"/host "thecottages"): 2101 log rows collapse to
 * 969 real non-disabled rooms across 21 of its 26 communities — the
 * other 5 communities simply have no rows here either (a real "not
 * every community has this configured" gap, not a bug).
 */
function countActiveCapacity(floorPlanRows) {
  const seenRoomIds = new Set();
  let total = 0;
  for (const r of floorPlanRows) {
    if (r.isDisabled) continue;
    const key = `${r.communityId}:${r.roomId}`;
    if (seenRoomIds.has(key)) continue;
    seenRoomIds.add(key);
    total++;
  }
  return total;
}

/**
 * Some accounts genuinely don't use ALIS's floor-plan/room-assignment
 * feature — confirmed live (Sep 2026, "Constant Care" / host
 * "grandbrook"): a correctly-mapped, clearly real, active account
 * (29 real communities, all plausibly named) whose hqOccupancies pull
 * comes back completely empty on every community and every month
 * tried, while `/v1/export/residents` for the SAME host returns 556
 * real current residents. hqOccupancies being empty means "this
 * account doesn't track room assignments in ALIS," not "no data" —
 * falling back to a current-residents count gets a real census number
 * for exactly this case.
 *
 * `capacity`, when known (from historicalFloorPlan — see
 * countActiveCapacity above), fills in a real Total Capacity/occupancy %
 * that this fallback couldn't otherwise compute — confirmed live
 * (Sep 2026, "Hickory Senior Living"): the account's admin FloorPlan
 * page clearly shows real rooms even though hqOccupancies is empty, so
 * "no capacity data" was a data-SOURCE gap, not a real absence of the
 * data. Per-product-type/classification capacity stays null regardless
 * — historicalFloorPlan has no product-type field, so only the
 * portfolio/community-wide total is knowable this way, not a per-group
 * breakdown of it.
 */
function normalizeFromResidents(residents, capacity = null) {
  const byProductType = {};
  const byClassification = {};
  for (const r of residents) {
    const pt = (r.productType || 'Unspecified').toString().trim() || 'Unspecified';
    byProductType[pt] = (byProductType[pt] || 0) + 1;
    const cl = (r.classification || 'Unspecified').toString().trim() || 'Unspecified';
    byClassification[cl] = (byClassification[cl] || 0) + 1;
  }
  // pct (per-group) is each group's share of total census (occupied /
  // total residents) — the same census-share meaning kpiNormalizer.js's
  // normalizeOccupancy uses. The top-level pct is a real occupancy rate
  // (census / capacity) when capacity is known, null otherwise.
  const total = residents.length;
  return {
    hasOccupancyData: total > 0,
    pct: capacity ? total / capacity : null,
    occupiedRoomDays: total,
    totalRoomDays: capacity || null,
    byProductType: Object.entries(byProductType)
      .map(([productType, occupied]) => ({ productType, occupied, total: null, pct: total ? occupied / total : null }))
      .sort((a, b) => b.occupied - a.occupied),
    byClassification: Object.entries(byClassification)
      .map(([classification, occupied]) => ({ classification, occupied, total: null, pct: total ? occupied / total : null }))
      .sort((a, b) => b.occupied - a.occupied),
  };
}

const NO_DATA = { hasOccupancyData: false, pct: null, occupiedRoomDays: null, totalRoomDays: null, byProductType: [], byClassification: [] };

/** Returns null if this account has no known ALIS subdomain — a real, expected state for most of the portfolio today (see doc comment above), not an error. */
async function getOccupancySnapshotForAccount(companyName, hubspotCompanyId) {
  const host = getCompanyHost({ companyName, hubspotCompanyId });
  if (!host) return null;

  const hosts = parseHosts(host.company_host);
  if (hosts.length === 0) return null;

  // One bad host (network hiccup, a stale/typo'd subdomain) shouldn't
  // blank out an account that has other, working hosts — merge whatever
  // succeeds, matching kpiExport.js's partial-data-over-total-failure
  // pattern for the same multi-host case. Only throws (surfacing as a
  // real per-account error in the /refresh-occupancy route) if every
  // host failed on BOTH the floor-plan pull and the residents fallback
  // below — a host that's simply wrong/unauthorized should still read
  // as a failure, not silently render as "no data."
  const rawRows = [];
  const hostErrors = [];
  for (const h of hosts) {
    try {
      rawRows.push(...await getOccupancy(h));
    } catch (err) {
      hostErrors.push(`${h}: ${err.message}`);
    }
  }

  const { rows, asOfDate } = filterToLatestDay(rawRows);
  const normalized = normalizeOccupancy(rows);
  if (normalized.hasOccupancyData) {
    if (hostErrors.length > 0) {
      console.error(`[accountHealthOccupancy] ${companyName}: occupancy pull failed for ${hostErrors.length} of ${hosts.length} host(s), continuing with the rest: ${hostErrors.join('; ')}`);
    }
    return { ...normalized, asOfDate };
  }

  // No floor-plan/occupancy-snapshot data from any host — try current
  // residents (census) plus historicalFloorPlan (capacity) instead of
  // giving up. The capacity pull is genuinely best-effort on top of an
  // already-best-effort fallback: a failure here just means this
  // account's Total Capacity stays "—" same as before, it never blocks
  // the census figure residents provides.
  const residents = [];
  const residentErrors = [];
  for (const h of hosts) {
    try {
      residents.push(...await getResidents(h));
    } catch (err) {
      residentErrors.push(`${h}: ${err.message}`);
    }
  }

  if (residents.length > 0) {
    const floorPlanRows = [];
    for (const h of hosts) {
      try {
        floorPlanRows.push(...await getHistoricalFloorPlan(h));
      } catch (err) {
        console.error(`[accountHealthOccupancy] ${companyName}: historicalFloorPlan pull failed for host "${h}", Total Capacity will stay unknown for this host: ${err.message}`);
      }
    }
    const capacity = countActiveCapacity(floorPlanRows);
    return { ...normalizeFromResidents(residents, capacity), asOfDate: todayIso() };
  }

  // Neither approach returned anything. Only a real error if EVERY host
  // failed on BOTH pulls — otherwise this is a genuine "no data at all
  // for this account" case, not a failure.
  if (hostErrors.length === hosts.length && residentErrors.length === hosts.length) {
    throw new Error(`Occupancy pull failed for every host (${hosts.join(', ')}): ${hostErrors.join('; ')}`);
  }
  return NO_DATA;
}

module.exports = { getOccupancySnapshotForAccount };
