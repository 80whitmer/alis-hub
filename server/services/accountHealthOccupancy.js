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
const { getOccupancy } = require('./alisApiClient');
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
  // host failed.
  const rawRows = [];
  const hostErrors = [];
  for (const h of hosts) {
    try {
      rawRows.push(...await getOccupancy(h));
    } catch (err) {
      hostErrors.push(`${h}: ${err.message}`);
    }
  }
  if (hostErrors.length === hosts.length) {
    throw new Error(`Occupancy pull failed for every host (${hosts.join(', ')}): ${hostErrors.join('; ')}`);
  }
  if (hostErrors.length > 0) {
    console.error(`[accountHealthOccupancy] ${companyName}: occupancy pull failed for ${hostErrors.length} of ${hosts.length} host(s), continuing with the rest: ${hostErrors.join('; ')}`);
  }

  const { rows, asOfDate } = filterToLatestDay(rawRows);
  const normalized = normalizeOccupancy(rows);
  return { ...normalized, asOfDate };
}

module.exports = { getOccupancySnapshotForAccount };
