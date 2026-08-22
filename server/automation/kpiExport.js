const fs = require('fs');
const path = require('path');

const {
  getOccupancy, getCommunities, getStaff, getResidents, getMoveInsAndOuts, getIncidents,
  getLeaves, getDiagnosesAndAllergies, getRecordedCare, getScheduledCareTasks,
} = require('../services/alisApiClient');
const {
  normalizeOccupancy, normalizeDemographics, normalizeLengthOfStayAndMoveOuts,
  normalizeFalls, normalizeHospitalVisits, normalizeDiagnoses, normalizeCareCompletion,
  normalizeStaffActivity, normalizePrnAdministration, estimateResidentDays, computeBenchmarkDiffs,
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

/** 'YYYY-MM-DD' for each calendar day between two ISO dates, inclusive. */
function daysInRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const days = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

const CARE_TASK_BATCH_SIZE = 8;

// Disabled for now: scheduledCareTasks has no date-range param, so this is
// a day-by-day loop with no scalable ceiling (91 days × N communities for
// a quarter — thousands of calls for a multi-community account). Revisit
// once care completion is sourced from an ALIS HQ Dashboard report upload
// instead of the raw API. See feature/kpi-qbr-pipeline commit history.
const CARE_COMPLETION_ENABLED = false;

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
const { setJobStatus, setItemStatus, addKpiSnapshot, syncJobItems } = require('../db/database');
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
  const { companyName, companyHost, periodStart, periodEnd, hubspotCompanyId } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');

  if (!periodStart || !periodEnd) {
    setJobStatus(jobId, 'failed');
    const error = 'Period Start and Period End are both required — fill those fields in before running the job.';
    console.error(`[kpi-export:${jobId}] ${error}`);
    emit('job_error', { error });
    return;
  }

  // No communities specified → pull every community for this account,
  // minus Training communities (by name) and canceled/suspended ones (by
  // status). Only "canceled" and "active" have been seen in real data so
  // far — "suspended" isn't confirmed yet, matched defensively in case a
  // different account uses it.
  const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];
  let communities = payload.communities;
  if (!communities || communities.length === 0) {
    emit('progress', { message: 'No communities specified — pulling the full community list for this account…' });
    try {
      const all = await getCommunities(companyHost);
      communities = all
        .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
        .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
        .map((c) => ({ name: c.communityName, communityId: c.communityId }));
      emit('progress', { message: `Auto-resolved ${communities.length} of ${all.length} communities (excluded Training and canceled/suspended communities).` });
      // The job record was created with communities: [] before this
      // resolved — backfill job_items now, or setItemStatus's UPDATE-by-name
      // silently matches nothing and per-community tracking never works.
      syncJobItems(jobId, communities.map((c) => c.name));
    } catch (err) {
      setJobStatus(jobId, 'failed');
      const error = `Failed to auto-resolve community list: ${err.message}`;
      console.error(`[kpi-export:${jobId}] ${error}`);
      emit('job_error', { error });
      return;
    }
  }

  emit('job_start', { jobId, total: communities.length, company: companyName });

  const missingId = communities.find((c) => !c.communityId);
  if (missingId) {
    setJobStatus(jobId, 'failed');
    const error = `Community "${missingId.name}" is missing an ALIS Community ID — fill that field in before running the job.`;
    console.error(`[kpi-export:${jobId}] ${error}`);
    emit('job_error', { error });
    return;
  }

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
    { key: 'staff', fn: () => getStaff(companyHost) },
  ];

  emit('progress', { message: 'Pulling resident roster, move-ins/outs, incidents, leaves, diagnoses, and staff…' });
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

  const { residents, moveInsAndOuts, incidents, leaves, diagnosesAndAllergies, staff } = pulled;

  // ── Per-community pulls (occupancy + recorded care + care completion) ──
  // hqOccupancies takes a single `monthAndYear`, not a range, so a
  // multi-month period needs one call per calendar month.
  const months = monthsInRange(periodStart, periodEnd);
  // scheduledCareTasks has no date-range param at all — one call per day,
  // batched to avoid hammering the API. Only compact per-day counts are
  // kept (a full quarter is ~90 calls × ~700-800 tasks each — too much to
  // hold as raw rows).
  const days = daysInRange(periodStart, periodEnd);
  const occupancyRows = [];
  const recordedCareRows = [];
  const careCompletionDailySummaries = [];

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

    // careTaskDaysSucceeded defaults to 1 (not 0) when the feature is
    // disabled, so it never gets blamed in the failure check below.
    let careTaskDaysSucceeded = CARE_COMPLETION_ENABLED ? 0 : 1;
    if (CARE_COMPLETION_ENABLED) {
      for (let i = 0; i < days.length; i += CARE_TASK_BATCH_SIZE) {
        const batch = days.slice(i, i + CARE_TASK_BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((d) => getScheduledCareTasks(companyHost, { communityId, localCareDate: d }))
        );
        batchResults.forEach((result, j) => {
          const date = batch[j];
          if (result.status === 'fulfilled') {
            careTaskDaysSucceeded++;
            const tasks = (result.value || []).flatMap((r) => r.careTrackingItems || []);
            const recorded = tasks.filter((t) => String(t.taskStatus) === '1');
            const completed = recorded.filter((t) => String(t.outcome) === '1').length;
            careCompletionDailySummaries.push({ communityId, date, total: recorded.length, completed });
          } else {
            console.error(`[kpi-export:${jobId}] "scheduledCareTasks" pull failed for "${name}" / ${date}:`, result.reason);
          }
        });
        emit('progress', { message: `Care completion: ${Math.min(i + CARE_TASK_BATCH_SIZE, days.length)}/${days.length} days pulled for "${name}"` });
      }
    }

    if (occupancySuccessCount === 0 && recordedCareOutcome.status === 'rejected' && careTaskDaysSucceeded === 0) {
      const error = `occupancy: all ${months.length} month(s) failed; recordedCare: ${recordedCareOutcome.reason.message}; care completion: all ${days.length} day(s) failed`;
      setItemStatus(jobId, name, 'failed', error);
      emit('item_fail', { name, error });
    } else {
      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });
    }
  }
  cacheRaw(jobId, 'occupancy', occupancyRows);
  cacheRaw(jobId, 'recordedCare', recordedCareRows);
  cacheRaw(jobId, 'careCompletionDailySummaries', careCompletionDailySummaries);

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
  const scopedStaff = filterByCommunity(asArray(staff), requestedCommunityIds);

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
  const careCompletion = normalizeCareCompletion(careCompletionDailySummaries);
  // Average daily census over the period, for the staff-to-census ratio.
  const avgCensus = occupancy.occupiedRoomDays != null && days.length ? occupancy.occupiedRoomDays / days.length : null;
  const staffActivity = normalizeStaffActivity(scopedStaff, { residentCensus: avgCensus });

  const normalized = { occupancy, demographics, lengthOfStay, falls, hospitalVisits, diagnosisPrevalence, prnAdministration, careCompletion, staffActivity };

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
