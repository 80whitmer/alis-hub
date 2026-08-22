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
  let residents, moveInsAndOuts, incidents, leaves, diagnosesAndAllergies;
  try {
    emit('progress', { message: 'Pulling resident roster, move-ins/outs, incidents, leaves, and diagnoses…' });
    [residents, moveInsAndOuts, incidents, leaves, diagnosesAndAllergies] = await Promise.all([
      getResidents(companyHost),
      getMoveInsAndOuts(companyHost),
      getIncidents(companyHost),
      getLeaves(companyHost),
      getDiagnosesAndAllergies(companyHost),
    ]);
    cacheRaw(jobId, 'residents', residents);
    cacheRaw(jobId, 'moveInsAndOuts', moveInsAndOuts);
    cacheRaw(jobId, 'incidents', incidents);
    cacheRaw(jobId, 'leaves', leaves);
    cacheRaw(jobId, 'diagnosesAndAllergies', diagnosesAndAllergies);
  } catch (err) {
    console.error(`[kpi-export:${jobId}] Account-wide ALIS API pull failed:`, err);
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `Account-wide ALIS API pull failed: ${err.message}` });
    return;
  }

  // ── Per-community pulls (occupancy + recorded care) ─────────────────────
  const occupancyRows = [];
  const recordedCareRows = [];

  for (const community of communities) {
    const { name, communityId } = community;
    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    try {
      const [occupancy, recordedCare] = await Promise.all([
        getOccupancy(companyHost, { communityId, monthAndYear: periodStart }),
        getRecordedCare(companyHost, { communityId, careStartDate: periodStart, careEndDate: periodEnd }),
      ]);
      occupancyRows.push(...(Array.isArray(occupancy) ? occupancy : [occupancy]).filter(Boolean));
      recordedCareRows.push(...(Array.isArray(recordedCare) ? recordedCare : [recordedCare]).filter(Boolean));

      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });
    } catch (err) {
      console.error(`[kpi-export:${jobId}] Per-community pull failed for "${name}":`, err);
      setItemStatus(jobId, name, 'failed', err.message);
      emit('item_fail', { name, error: err.message });
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
