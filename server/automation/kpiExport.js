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
} = require('../services/kpiNormalizer');
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
  const occupancyRows = [];
  const recordedCareRows = [];

  for (const community of communities) {
    const { name, communityId } = community;
    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    const [occupancyResult, recordedCareResult] = await Promise.allSettled([
      getOccupancy(companyHost, { communityId, monthAndYear: periodStart }),
      getRecordedCare(companyHost, { communityId, careStartDate: periodStart, careEndDate: periodEnd }),
    ]);

    if (occupancyResult.status === 'fulfilled') {
      const occupancy = occupancyResult.value;
      occupancyRows.push(...(Array.isArray(occupancy) ? occupancy : [occupancy]).filter(Boolean));
    } else {
      console.error(`[kpi-export:${jobId}] "occupancy" pull failed for "${name}":`, occupancyResult.reason);
    }

    if (recordedCareResult.status === 'fulfilled') {
      const recordedCare = recordedCareResult.value;
      recordedCareRows.push(...(Array.isArray(recordedCare) ? recordedCare : [recordedCare]).filter(Boolean));
    } else {
      console.error(`[kpi-export:${jobId}] "recordedCare" pull failed for "${name}":`, recordedCareResult.reason);
    }

    if (occupancyResult.status === 'rejected' && recordedCareResult.status === 'rejected') {
      const error = `occupancy: ${occupancyResult.reason.message}; recordedCare: ${recordedCareResult.reason.message}`;
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

  const occupancy = normalizeOccupancy(occupancyRows);
  const demographics = normalizeDemographics(Array.isArray(residents) ? residents : residents?.items || []);
  const lengthOfStay = normalizeLengthOfStayAndMoveOuts(Array.isArray(moveInsAndOuts) ? moveInsAndOuts : moveInsAndOuts?.items || []);
  const residentDays = estimateResidentDays({ avgCensus: occupancy.census, periodStart, periodEnd });
  const falls = normalizeFalls(Array.isArray(incidents) ? incidents : incidents?.items || [], residentDays);
  const hospitalVisits = normalizeHospitalVisits(Array.isArray(leaves) ? leaves : leaves?.items || [], residentDays);
  const diagnosisPrevalence = normalizeDiagnoses(Array.isArray(diagnosesAndAllergies) ? diagnosesAndAllergies : diagnosesAndAllergies?.items || [], demographics.totalResidents);
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
