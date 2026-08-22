const fs = require('fs');
const path = require('path');

const {
  getOccupancy, getResidents, getMoveInsAndOuts, getIncidents,
  getLeaves, getDiagnosesAndAllergies, getRecordedCare,
} = require('../services/alisApiClient');
const {
  normalizeOccupancy, normalizeDemographics, normalizeLengthOfStayAndMoveOuts,
  normalizeFalls, normalizeHospitalVisits, normalizeDiagnoses,
  normalizePrnAdministration, estimateResidentDays, computeBenchmarkDiffs,
  filterByDateRange,
} = require('../services/kpiNormalizer');

/** 'YYYY-MM-01' for each calendar month between two ISO dates, inclusive. */
function monthsInRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/**
 * residents/moveInsAndOuts/incidents/leaves/diagnosesAndAllergies are
 * account-wide (no communityId query param exists for them) — without this
 * filter, a job scoped to one community would silently report numbers for
 * the whole account.
 */
function filterByCommunity(rows, communityIds) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((r) => communityIds.has(String(r.communityId)));
}
const { getLatestBenchmarks } = require('../services/alis500Benchmarks');
const { getTicketSummaryForCompany } = require('../services/hubspotTickets');
const { generateFlags } = require('../services/qbrFlags');
const { setJobStatus, setItemStatus, addKpiSnapshot } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

const CACHE_ROOT = path.join(__dirname, 'kpi-cache');

function cacheRaw(jobId, name, data) {
  const dir = path.join(CACHE_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

/**
 * Run the kpi-export job: pull ALIS export-API data for an account's
 * communities, normalize it, diff against the latest ALIS 500 benchmark,
 * pull HubSpot ticket history if a company is linked, and generate
 * rule-based discussion-point flags. Writes one compact snapshot row to
 * `kpi_snapshots`; raw API payloads are cached to disk (see kpi-cache/)
 * rather than the DB — see plan doc for why (sql.js rewrites the whole
 * file on every write).
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runKpiExportJob(jobId, payload) {
  const { companyName, companyHost, communities, periodStart, periodEnd, hubspotCompanyId } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: communities.length, company: companyName });

  // ── Account-wide pulls (one call each, not per-community) ──────────────
  // Promise.allSettled (not Promise.all) so one endpoint 401ing doesn't hide
  // whether the others also failed — Promise.all would short-circuit on the
  // first rejection and silently drop the rest.
  const ACCOUNT_WIDE_ENDPOINTS = [
    { key: 'residents', fn: () => getResidents(companyHost) },
    { key: 'moveInsAndOuts', fn: () => getMoveInsAndOuts(companyHost) },
    { key: 'incidents', fn: () => getIncidents(companyHost) },
    { key: 'leaves', fn: () => getLeaves(companyHost) },
    { key: 'diagnosesAndAllergies', fn: () => getDiagnosesAndAllergies(companyHost) },
  ];

  emit('progress', { message: 'Pulling resident roster, move-ins/outs, incidents, leaves, and diagnoses…' });
  const settled = await Promise.allSettled(ACCOUNT_WIDE_ENDPOINTS.map((e) => e.fn()));

  const pulled = {};
  const endpointErrors = [];
  settled.forEach((result, i) => {
    const { key } = ACCOUNT_WIDE_ENDPOINTS[i];
    if (result.status === 'fulfilled') {
      pulled[key] = result.value;
      cacheRaw(jobId, key, result.value);
    } else {
      pulled[key] = null;
      endpointErrors.push(`${key}: ${result.reason.message}`);
      console.error(`[kpi-export:${jobId}] "${key}" pull failed:`, result.reason);
    }
  });

  if (endpointErrors.length === ACCOUNT_WIDE_ENDPOINTS.length) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `All account-wide ALIS API pulls failed: ${endpointErrors.join('; ')}` });
    return;
  }
  if (endpointErrors.length > 0) {
    emit('progress', { message: `${endpointErrors.length} of ${ACCOUNT_WIDE_ENDPOINTS.length} account-wide pulls failed and will be treated as empty: ${endpointErrors.join('; ')}` });
  }

  const { residents, moveInsAndOuts, incidents, leaves, diagnosesAndAllergies } = pulled;

  // ── Per-community pulls (occupancy + recorded care) ─────────────────────
  // hqOccupancies takes a single `monthAndYear`, not a range, so a
  // multi-month period needs one call per calendar month.
  const months = monthsInRange(periodStart, periodEnd);
  const occupancyRows = [];
  const recordedCareRows = [];

  for (const community of communities) {
    const { name, communityId } = community;
    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    const [occupancyMonthResults, recordedCareResult] = await Promise.all([
      Promise.allSettled(months.map((m) => getOccupancy(companyHost, { communityId, monthAndYear: m }))),
      Promise.allSettled([getRecordedCare(companyHost, { communityId, careStartDate: periodStart, careEndDate: periodEnd })]),
    ]);

    let occupancySuccessCount = 0;
    occupancyMonthResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        occupancySuccessCount++;
        const occupancy = result.value;
        occupancyRows.push(...(Array.isArray(occupancy) ? occupancy : [occupancy]).filter(Boolean));
      } else {
        console.error(`[kpi-export:${jobId}] "occupancy" pull failed for "${name}" / ${months[i]}:`, result.reason);
      }
    });

    const recordedCareOutcome = recordedCareResult[0];
    if (recordedCareOutcome.status === 'fulfilled') {
      const recordedCare = recordedCareOutcome.value;
      recordedCareRows.push(...(Array.isArray(recordedCare) ? recordedCare : [recordedCare]).filter(Boolean));
    } else {
      console.error(`[kpi-export:${jobId}] "recordedCare" pull failed for "${name}":`, recordedCareOutcome.reason);
    }

    if (occupancySuccessCount === 0 && recordedCareOutcome.status === 'rejected') {
      const error = `occupancy: all ${months.length} month(s) failed; recordedCare: ${recordedCareOutcome.reason.message}`;
      setItemStatus(jobId, name, 'failed', error);
      emit('item_fail', { name, error });
    } else {
      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });
    }
  }
  cacheRaw(jobId, 'occupancy', occupancyRows);
  cacheRaw(jobId, 'recordedCare', recordedCareRows);

  // ── Normalize ─────────────────────────────────────────────────────────
  emit('progress', { message: 'Normalizing KPIs and diffing against ALIS 500 benchmarks…' });

  // residents/moveInsAndOuts/incidents/leaves/diagnosesAndAllergies are
  // account-wide pulls — filter down to the communities this job actually
  // asked about before normalizing, or a single-community job would report
  // whole-account numbers.
  const requestedCommunityIds = new Set(communities.map((c) => String(c.communityId)));
  const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);
  const scopedResidents = filterByCommunity(asArray(residents), requestedCommunityIds);
  const scopedDiagnoses = filterByCommunity(asArray(diagnosesAndAllergies), requestedCommunityIds);

  // incidents and leaves have no server-side date filter at all (confirmed
  // against the live OpenAPI spec) — they return full history, so an
  // unfiltered pull would badly inflate any per-1000-resident-days rate.
  const scopedIncidents = filterByDateRange(
    filterByCommunity(asArray(incidents), requestedCommunityIds),
    ['incidentDateTime', 'incidentDate'],
    periodStart, periodEnd
  );
  const scopedLeaves = filterByDateRange(
    filterByCommunity(asArray(leaves), requestedCommunityIds),
    ['startDate', 'leaveStartDate'],
    periodStart, periodEnd
  );
  // Move-out cohort = residents who moved out during this period (matches
  // how the ALIS 500 benchmark frames its move-out reason breakdown), not
  // every historical stay for this community.
  const scopedMoveInsAndOuts = filterByDateRange(
    filterByCommunity(asArray(moveInsAndOuts), requestedCommunityIds),
    ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate'],
    periodStart, periodEnd
  );

  const occupancy = normalizeOccupancy(occupancyRows);
  const demographics = normalizeDemographics(scopedResidents);
  const lengthOfStay = normalizeLengthOfStayAndMoveOuts(scopedMoveInsAndOuts);
  // occupiedRoomDays IS the real resident-days figure for the period (one
  // resident ≈ one occupied room-day) — prefer it over the avgCensus*days
  // estimate, which only kicks in if occupancy data is missing entirely.
  const residentDays = occupancy.occupiedRoomDays ?? estimateResidentDays({ avgCensus: occupancy.pct, periodStart, periodEnd });
  const falls = normalizeFalls(scopedIncidents, residentDays);
  const hospitalVisits = normalizeHospitalVisits(scopedLeaves, residentDays);
  const diagnosisPrevalence = normalizeDiagnoses(scopedDiagnoses, demographics.totalResidents);
  const prnAdministration = normalizePrnAdministration(recordedCareRows, residentDays);

  const normalized = { occupancy, demographics, lengthOfStay, falls, hospitalVisits, diagnosisPrevalence, prnAdministration };

  const benchmark = getLatestBenchmarks();
  const diffs = computeBenchmarkDiffs(normalized, benchmark);

  // ── HubSpot tickets (optional) ────────────────────────────────────────
  let ticketSummary = null;
  if (hubspotCompanyId) {
    try {
      emit('progress', { message: 'Pulling HubSpot ticket history…' });
      ticketSummary = await getTicketSummaryForCompany(hubspotCompanyId);
      cacheRaw(jobId, 'ticketSummary', ticketSummary);
    } catch (err) {
      emit('progress', { message: `HubSpot ticket pull skipped: ${err.message}` });
    }
  }

  const flags = generateFlags(normalized, diffs, ticketSummary);

  const summary = {
    companyName,
    companyHost,
    communities,
    periodStart,
    periodEnd,
    benchmarkQuarter: benchmark.quarter,
    normalized,
    diffs,
    ticketSummary,
    flags,
  };

  addKpiSnapshot(jobId, { companyName, periodStart, periodEnd, benchmarkQuarter: benchmark.quarter, summary });

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, flagCount: flags.length });
}

module.exports = { runKpiExportJob };
