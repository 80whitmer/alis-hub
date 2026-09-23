const {
  getCommunities, getInvoiceCharges, getOccupancy, getHistoricalMoveInMoveOuts, getHistoricalFloorPlan,
} = require('../services/alisApiClient');
const {
  normalizePpd, normalizeCommunityRevenue, normalizeCommunityMoveInOut,
} = require('../services/kpiNormalizer');
const { setJobStatus, setItemStatus, syncJobItems, addCommunityRevenueSnapshots, getJob } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/** Same reasoning/contract as kpiExport.js's identical helper — see that file's doc comment. Folded into this job runner too (Sep 2026) since it shares the same "Cancel Job is cosmetic" gap. */
function isCancelled(jobId) {
  return getJob(jobId)?.status === 'failed';
}

const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);

/** Same convention as kpiExport.js's/wellnessExport.js's identical helper — splits a (possibly comma-separated) companyHost into a clean list of subdomains. */
function parseHosts(companyHost) {
  return String(companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
}

/** 'YYYY-MM' -> { periodStart: 'YYYY-MM-01', periodEnd: 'YYYY-MM-<lastDay>' } — the two dates every pull in this job needs. */
function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0)); // day 0 of next month = last day of this month
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
}

/** Same shape/contract as kpiExport.js's identical helper — runs `fn` over `items` with at most `limit` in flight, each call catching its own errors so one bad community can't take down the others still in flight. */
async function mapWithConcurrency(items, limit, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch (err) {
        console.error('[community-revenue-snapshot] mapWithConcurrency: fn should never throw (errors should be caught internally) — item may be incomplete:', err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Same deliberately-conservative concurrency cap and rationale as
// kpiExport.js's COMMUNITY_CONCURRENCY — occupancy isn't documented either
// way on rate limits, so this errs cautious rather than measured.
const COMMUNITY_CONCURRENCY = 4;

/**
 * Unit Capacity is a BEST-EFFORT ESTIMATE, not an authoritative figure —
 * confirmed against Viva's real July 2025 report that its actual "Unit
 * Capacity" column is sourced from a manually-maintained file outside
 * ALIS entirely (the report's own metric dictionary says so explicitly:
 * "*We're using the internal file from Heather's"), so no ALIS endpoint,
 * including this one, can reproduce it exactly. This dedupes
 * historicalFloorPlan (a room-INVENTORY log, not a day-by-day snapshot —
 * same source accountHealthOccupancy.js already uses for its own "Total
 * Capacity" estimate) by (communityId, roomId), keeping only rows where
 * !isDisabled — it matched Viva's real number exactly for 2 of 5
 * communities spot-checked (Bel Air 48, Wilson Manor 50) and undercounted
 * by a large margin for the other 3 (e.g. Hagerstown: 32 here vs. 56
 * real), so treat this field as directional, not exact, anywhere it's
 * surfaced. Aaron confirmed (Sep 2026) to ship it as a labeled estimate
 * rather than block on it or leave it blank.
 */
function countCapacityByCommunity(floorPlanRows) {
  const seen = new Set();
  const byCommunity = new Map();
  for (const r of floorPlanRows) {
    if (r.isDisabled) continue;
    const key = `${r.communityId}:${r.roomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byCommunity.set(r.communityId, (byCommunity.get(r.communityId) || 0) + 1);
  }
  return byCommunity;
}

/**
 * Total Occupied Units is the same point-in-time-vs-summed distinction as
 * capacity above — Viva's spreadsheet means "units occupied as of month
 * end," not room-days summed across the month. Pulls the latest date at
 * or before periodEnd actually present in the pull (mirrors
 * accountHealthOccupancy.js's filterToLatestDay fallback, anchored to the
 * snapshot month's last day instead of today) and counts each community's
 * `dataSet: "Occupied"` rows on that date.
 */
function countOccupiedUnitsByCommunity(occupancyRows, periodEnd) {
  const actual = occupancyRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');
  const onOrBefore = actual.filter((r) => r.date && r.date <= periodEnd);
  const dates = [...new Set(onOrBefore.map((r) => r.date))].sort();
  const latest = dates[dates.length - 1];
  const byCommunity = new Map();
  if (!latest) return byCommunity;
  for (const r of onOrBefore) {
    if (r.date !== latest || r.dataSet !== 'Occupied') continue;
    byCommunity.set(r.communityId, (byCommunity.get(r.communityId) || 0) + 1);
  }
  return byCommunity;
}

/**
 * Occupancy by product type (AL/MC/etc.) and by classification, per
 * community, as of the same month-end snapshot date
 * countOccupiedUnitsByCommunity uses above (Crissy's team's monthly
 * census-by-product-type/classification pull — Aaron, Sep 2026). `pct` is
 * each product type/classification's share of THAT community's own
 * occupied total (a composition-mix percentage), matching the exact
 * convention kpiNormalizer.js's normalizeOccupancy already established for
 * byProductType/byClassification (Aaron, 2026-09-07: "what percentage are
 * each of the product types or classifications" of the whole) — not that
 * group's own fill rate. Kept as its own implementation here rather than a
 * shared import, same "this file and kpiNormalizer.js mirror rather than
 * share logic" convention noted throughout this codebase.
 */
function computeOccupancyBreakdownByCommunity(occupancyRows, periodEnd) {
  const actual = occupancyRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');
  const onOrBefore = actual.filter((r) => r.date && r.date <= periodEnd);
  const dates = [...new Set(onOrBefore.map((r) => r.date))].sort();
  const latest = dates[dates.length - 1];
  const byCommunity = new Map();
  if (!latest) return byCommunity;

  const grouped = new Map(); // communityId -> { total, byProductType: Map, byClassification: Map }
  for (const r of onOrBefore) {
    if (r.date !== latest || r.dataSet !== 'Occupied') continue;
    if (!grouped.has(r.communityId)) {
      grouped.set(r.communityId, { total: 0, byProductType: new Map(), byClassification: new Map() });
    }
    const g = grouped.get(r.communityId);
    g.total++;
    const productType = (r.residentProductType || 'Unspecified').toString().trim() || 'Unspecified';
    g.byProductType.set(productType, (g.byProductType.get(productType) || 0) + 1);
    const classification = (r.residentClassification || 'Unspecified').toString().trim() || 'Unspecified';
    g.byClassification.set(classification, (g.byClassification.get(classification) || 0) + 1);
  }

  for (const [communityId, g] of grouped) {
    byCommunity.set(communityId, {
      byProductType: Array.from(g.byProductType.entries())
        .map(([productType, occupied]) => ({ productType, occupied, pct: g.total ? occupied / g.total : null }))
        .sort((a, b) => b.occupied - a.occupied),
      byClassification: Array.from(g.byClassification.entries())
        .map(([classification, occupied]) => ({ classification, occupied, pct: g.total ? occupied / g.total : null }))
        .sort((a, b) => b.occupied - a.occupied),
    });
  }
  return byCommunity;
}

/**
 * Runs the monthly Community Revenue & Occupancy Snapshot job for one
 * account: pulls one calendar month of invoice charges, occupancy, and
 * move-in/move-out history, computes per-community Charges/Credits/
 * Discounts/Net Revenue (normalizeCommunityRevenue), Unit Capacity/Total
 * Occupied Units (normalizeOccupancy), occupancy by product type and by
 * classification (computeOccupancyBreakdownByCommunity), Occupancy-Unit-Days/
 * Census/both PPD bases (normalizePpd), and Move-Ins/Move-Outs
 * (normalizeCommunityMoveInOut), then stores one row per community
 * (addCommunityRevenueSnapshots) — the
 * Team AM Dashboard looks up each community's prior-month row itself to
 * compute the MoM diff at render time, same as every other trend view in
 * this app being computed from stored history rather than baked in here.
 *
 * Deliberately much simpler than kpiExport.js's quarter-spanning version:
 * a single calendar month needs none of that file's month-chunking/
 * clipping machinery — getInvoiceCharges caps at 1 month per call and
 * getOccupancy's hqOccupancies only ever takes one monthAndYear, so both
 * become a single direct call instead of a `months.map(...)` loop.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runCommunityRevenueSnapshotJob(jobId, payload) {
  const { companyName } = payload;
  const month = payload.month;
  const hosts = parseHosts(payload.companyHost);
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const error = 'Month is required, as "YYYY-MM" — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }
  if (hosts.length === 0) {
    const error = 'ALIS Company Host is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  const { periodStart, periodEnd } = monthBounds(month);

  const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];
  let communities = payload.communities;
  if (communities && communities.length > 0) {
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));
  } else {
    emit('progress', { message: `No communities specified — pulling the full community list for ${hosts.length > 1 ? `${hosts.length} hosts (${hosts.join(', ')})` : `host "${hosts[0]}"`}…` });
    communities = [];
    const hostErrors = [];
    for (const host of hosts) {
      if (isCancelled(jobId)) {
        emit('job_error', { error: 'Job was cancelled.' });
        return;
      }
      try {
        const all = await getCommunities(host);
        const resolved = all
          .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
          .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host }));
        communities.push(...resolved);
      } catch (err) {
        hostErrors.push(`${host}: ${err.message}`);
        console.error(`[community-revenue-snapshot:${jobId}] Failed to auto-resolve communities for host "${host}":`, err);
      }
    }
    if (communities.length === 0) {
      const error = `Failed to auto-resolve any communities across host(s) ${hosts.join(', ')}: ${hostErrors.join('; ')}`;
      setJobStatus(jobId, 'failed', error);
      emit('job_error', { error });
      return;
    }
  }
  syncJobItems(jobId, communities.map((c) => c.name));
  emit('job_start', { jobId, total: communities.length, company: companyName });

  // Account-wide pulls: invoiceCharges (capped at 1 month/call — well
  // within this job's single-month scope, no chunking needed) and
  // move-in/move-out history (no date-range param at all — scoped
  // client-side below, same as normalizeAdmissionsDischarges already does
  // for the QBR pipeline).
  emit('progress', { message: `Pulling invoice charges, move-in/out history, and floor plan for ${month} from ${hosts.length} host(s)…` });
  let invoiceChargeRows = [];
  let moveInOutRows = [];
  let floorPlanRows = [];
  const endpointErrors = [];
  for (const host of hosts) {
    if (isCancelled(jobId)) {
      emit('job_error', { error: 'Job was cancelled.' });
      return;
    }
    const [chargesResult, moveResult, floorPlanResult] = await Promise.allSettled([
      getInvoiceCharges(host, { invoiceStartDate: periodStart, invoiceEndDate: periodEnd }),
      getHistoricalMoveInMoveOuts(host),
      getHistoricalFloorPlan(host),
    ]);
    if (chargesResult.status === 'fulfilled') {
      invoiceChargeRows.push(...asArray(chargesResult.value).map((r) => ({ ...r, _host: host })));
    } else {
      endpointErrors.push(`invoiceCharges@${host}: ${chargesResult.reason.message}`);
      console.error(`[community-revenue-snapshot:${jobId}] "invoiceCharges" pull failed for host "${host}":`, chargesResult.reason);
    }
    if (moveResult.status === 'fulfilled') {
      moveInOutRows.push(...asArray(moveResult.value).map((r) => ({ ...r, _host: host })));
    } else {
      endpointErrors.push(`moveInMoveOuts@${host}: ${moveResult.reason.message}`);
      console.error(`[community-revenue-snapshot:${jobId}] "moveInMoveOuts" pull failed for host "${host}":`, moveResult.reason);
    }
    if (floorPlanResult.status === 'fulfilled') {
      floorPlanRows.push(...asArray(floorPlanResult.value).map((r) => ({ ...r, _host: host })));
    } else {
      // Best-effort, same as accountHealthOccupancy.js's identical fallback — Unit
      // Capacity just stays null for this host's communities rather than failing the job.
      endpointErrors.push(`historicalFloorPlan@${host}: ${floorPlanResult.reason.message}`);
      console.error(`[community-revenue-snapshot:${jobId}] "historicalFloorPlan" pull failed for host "${host}", Unit Capacity will stay unknown for its communities:`, floorPlanResult.reason);
    }
  }
  if (endpointErrors.length > 0) {
    emit('progress', { message: `${endpointErrors.length} account-wide pull(s) failed and will be treated as empty: ${endpointErrors.join('; ')}` });
  }

  const communityKeys = new Set(communities.map((c) => `${c.host}::${c.communityId}`));
  invoiceChargeRows = invoiceChargeRows.filter((r) => communityKeys.has(`${r._host}::${r.communityId}`));
  moveInOutRows = moveInOutRows.filter((r) => communityKeys.has(`${r._host}::${r.communityId}`));
  floorPlanRows = floorPlanRows.filter((r) => communityKeys.has(`${r._host}::${r.communityId}`));

  // Per-community pull: occupancy (hqOccupancies takes a single
  // monthAndYear, not a range — one call per community, no month-loop
  // needed for a job already scoped to one month).
  const occupancyRows = [];
  await mapWithConcurrency(communities, COMMUNITY_CONCURRENCY, async (community) => {
    const { name, communityId, host } = community;
    if (isCancelled(jobId)) {
      setItemStatus(jobId, name, 'failed', 'Job was cancelled.');
      return;
    }
    try {
      const rows = await getOccupancy(host, { communityId, monthAndYear: periodStart });
      occupancyRows.push(...asArray(rows).map((r) => ({ ...r, communityId, _host: host })));
      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });
    } catch (err) {
      setItemStatus(jobId, name, 'failed', err.message);
      emit('item_fail', { name, error: err.message });
      console.error(`[community-revenue-snapshot:${jobId}] "occupancy" pull failed for "${name}":`, err);
    }
  });

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  emit('progress', { message: 'Computing per-community revenue and occupancy…' });

  const revenueByCommunity = normalizeCommunityRevenue(invoiceChargeRows, communities);
  const ppd = normalizePpd(invoiceChargeRows, occupancyRows, { periodStart, periodEnd, communities });
  const moveInOutByCommunity = normalizeCommunityMoveInOut(moveInOutRows, communities, periodStart, periodEnd);
  const capacityByCommunity = countCapacityByCommunity(floorPlanRows);
  const occupiedUnitsByCommunity = countOccupiedUnitsByCommunity(occupancyRows, periodEnd);
  const occupancyBreakdownByCommunity = computeOccupancyBreakdownByCommunity(occupancyRows, periodEnd);

  const revenueByKey = new Map(revenueByCommunity.map((r) => [`${r.host}::${r.communityId}`, r]));
  const moveByKey = new Map(moveInOutByCommunity.map((r) => [`${r.host}::${r.communityId}`, r]));
  const ppdByKey = new Map((ppd.byCommunity || []).map((r) => [`${r.host}::${r.communityId}`, r]));

  const rows = communities.map((c) => {
    const key = `${c.host}::${c.communityId}`;
    const rev = revenueByKey.get(key);
    const move = moveByKey.get(key);
    const p = ppdByKey.get(key);
    const occupancyBreakdown = occupancyBreakdownByCommunity.get(c.communityId);
    return {
      companyName,
      companyHost: c.host,
      communityId: c.communityId,
      communityName: c.name,
      month,
      charges: rev?.charges ?? 0,
      credits: rev?.credits ?? 0,
      discounts: rev?.discounts ?? 0,
      netRevenue: rev?.netRevenue ?? 0,
      unitCapacity: capacityByCommunity.has(c.communityId) ? capacityByCommunity.get(c.communityId) : null,
      totalOccupiedUnits: occupiedUnitsByCommunity.has(c.communityId) ? occupiedUnitsByCommunity.get(c.communityId) : null,
      moveIns: move?.moveIns ?? 0,
      moveOuts: move?.moveOuts ?? 0,
      occupancyUnitDays: p?.occupiedDays ?? null,
      censusDays: p?.censusDays ?? null,
      ppdUnitDays: p?.ppdByUnitDays ?? null,
      ppdCensus: p?.ppdByCensus ?? null,
      occupancyByProductType: occupancyBreakdown?.byProductType ?? null,
      occupancyByClassification: occupancyBreakdown?.byClassification ?? null,
    };
  });

  addCommunityRevenueSnapshots(jobId, rows);

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runCommunityRevenueSnapshotJob };
