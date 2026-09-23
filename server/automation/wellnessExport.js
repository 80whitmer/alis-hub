const {
  getCommunities, getIncidents, getEvaluations, getLeaves, getStaff, getResidents,
  getOrderAdministration, getStaffComplianceDetails, getObservations, getIncidentFormData, getIncidentsV2,
  getOccupancy, getHistoricalMoveInMoveOuts, getRecordedCare,
} = require('../services/alisApiClient');
const {
  normalizeFallsThisWeek, normalizeElopementThisWeek, normalizeBehavioralThisWeek,
  normalizeOtherIncidentsThisWeek, normalizeChangeInConditionThisWeek,
  normalizeCurrentlyHospitalized, normalizeEvaluationsOverdue, normalizeMoveInAssessmentsPending,
  normalizeEvaluationsNeedingAttention,
  normalizeMedicationExceptions, normalizeStaffTrainingGaps, normalizeCarePointsAverage,
  scopeIncidentsThisWeek, formDataIndicatesHospitalTransfer, normalizeFallsWithHospitalTransfer,
  normalizeSentinelIncidentsThisWeek, normalizeOccupancySnapshot, normalizeResidentAge,
  computeActivityPatternRisk,
  withTrend, withCarePointsTrend,
} = require('../services/wellnessNormalizer');
const { shouldTrackSentinelIncidents } = require('../services/companyFeatures');
const { computeCommunityHealthScore, computeRollup } = require('../services/wellnessHealthScoring');
const { normalizeStaffActivity, diffMetric, estimateResidentDays, normalizeUpcomingBirthdays, addDays } = require('../services/kpiNormalizer');
const { getLatestBenchmarks } = require('../services/alis500Benchmarks');
const {
  setJobStatus, setItemStatus, syncJobItems, addWellnessSnapshot, getPriorWellnessSnapshot,
  replaceResidentActivityWeekly, getResidentActivityHistory, getJob,
} = require('../db/database');
const { broadcast } = require('../api/broadcaster');

const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);

/**
 * True once someone has cancelled this job out from under it (POST /api/jobs/:id/cancel
 * — see database.js's cancelJob) — that call only ever flips the DB row's
 * status to 'failed', it doesn't touch this function's own execution, so
 * without this check a cancelled job just kept running in the background
 * regardless (confirmed live, Sep 2026: a stuck per-community pull ran for
 * 1.5+ hours with Cancel Job clicked and no effect). Safe to key off
 * `status === 'failed'` specifically: this function is the only thing that
 * ever sets that status for its own job, and always at a `return` point —
 * so seeing 'failed' while still mid-loop can only mean an external
 * cancelJob() call, never this same run's own error path. Checked between
 * iterations, not mid-call — an already-in-flight ALIS pull still runs to
 * its own hard deadline (see alisApiClient.js's REQUEST_TIMEOUT_MS) rather
 * than being forcibly aborted, so cancellation takes effect within one
 * community's worth of time, not instantly, but that's now bounded to
 * well under two minutes instead of unbounded.
 */
function isCancelled(jobId) {
  return getJob(jobId)?.status === 'failed';
}

/** Splits the (possibly comma-separated) companyHost field into a clean list of subdomains — same convention as kpiExport.js's parseHosts. */
function parseHosts(companyHost) {
  return String(companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
}

/** Account-wide endpoints (incidents, evaluations, leaves, staff, staff compliance) are only scoped by host, not community — filter to this job's communities the same way kpiExport.js's filterByCommunity does. */
function filterByCommunity(rows, communityKeys) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((r) => communityKeys.has(`${r._host}::${r.communityId}`));
}

/** [weekStartDate, weekEndingDate] as Date objects spanning the 7 days ending on (and including) weekEnding — weekEndingDate is pushed to end-of-day so same-day incidents aren't excluded by a midnight cutoff. */
function getWeekWindow(weekEnding) {
  const weekEndingDate = new Date(`${weekEnding}T23:59:59.999Z`);
  const weekStartDate = new Date(weekEndingDate.getTime() - 6 * 86400000);
  weekStartDate.setUTCHours(0, 0, 0, 0);
  return { weekStartDate, weekEndingDate };
}

// Every calculator takes the same (data, weekStartDate, weekEndingDate,
// communityIds) signature so the loop below can call them uniformly —
// communityIds seeds a zero bucket for every community in this job so a
// community with zero matches this week still gets a real {total: 0} entry
// to compare against, instead of silently missing from byCommunity (see
// groupByCommunityAndProductType's doc comment).
const ROW_CALCULATORS = {
  falls: (data, weekStartDate, weekEndingDate, communityIds) => normalizeFallsThisWeek(data.incidents, weekEndingDate, weekStartDate, communityIds, data.staffNameByIncidentId),
  elopement: (data, weekStartDate, weekEndingDate, communityIds) => normalizeElopementThisWeek(data.incidents, weekEndingDate, weekStartDate, communityIds, data.staffNameByIncidentId),
  behavioral: (data, weekStartDate, weekEndingDate, communityIds) => normalizeBehavioralThisWeek(data.incidents, weekEndingDate, weekStartDate, communityIds, data.staffNameByIncidentId),
  otherIncidents: (data, weekStartDate, weekEndingDate, communityIds) => normalizeOtherIncidentsThisWeek(data.incidents, weekEndingDate, weekStartDate, communityIds, data.staffNameByIncidentId),
  changeInCondition: (data, weekStartDate, weekEndingDate, communityIds) => normalizeChangeInConditionThisWeek(data.observations, weekEndingDate, weekStartDate, communityIds),
  hospitalCurrent: (data, weekStartDate, weekEndingDate, communityIds) => normalizeCurrentlyHospitalized(data.leaves, communityIds),
  evaluationsOverdue: (data, weekStartDate, weekEndingDate, communityIds) => normalizeEvaluationsOverdue(data.evaluations, communityIds),
  moveInAssessments: (data, weekStartDate, weekEndingDate, communityIds) => normalizeMoveInAssessmentsPending(data.evaluations, data.moveInsById, communityIds, weekEndingDate),
  evaluationsNeedingAttention: (data, weekStartDate, weekEndingDate, communityIds) => normalizeEvaluationsNeedingAttention(data.evaluations, data.residents, communityIds, weekEndingDate),
  medicationExceptions: (data, weekStartDate, weekEndingDate, communityIds) => normalizeMedicationExceptions(data.orderAdministration, communityIds),
  staffTrainingGaps: (data, weekStartDate, weekEndingDate, communityIds) => normalizeStaffTrainingGaps(data.staffComplianceDetails, communityIds),
};

// Rows the ISL sample report asks for that no ALIS endpoint currently
// supports reliably — shipped as `null` (not 0) throughout the summary so
// the UI/export can render "not tracked in ALIS" instead of implying "no
// concern this week". Per-row rationale, confirmed against live data at two
// clients (Aug 2026):
//   - skinWound / infectionControl: no structured field anywhere in the
//     ALIS export API (checked the full OpenAPI spec). Free-text
//     `residents/observations.observationText` does carry real signal
//     (wound/skin keywords hit ~3-5% of notes in a live sample) but is
//     deliberately NOT used to compute this row — a false negative from
//     imperfect keyword matching is a real safety risk, not just an
//     inconvenience. A "review worklist" surfacing matching notes (not an
//     authoritative count) is a safer future use of that same data.
//   - rnDelegation: checked all distinct compliance-item names across 2
//     clients (55 + 49 items) — no delegation-tracking item exists in
//     either. Not exposed as structured data anywhere; would need ALIS to
//     add a new compliance-item type, not something we can pull today.
//   - pharmacyNarcotic: `clinical/orders` DOES carry `isNarcotic`/
//     `isControlled` booleans, joinable to `orderAdministration` exceptions
//     via `orderId`/`recordedOrderId` — a real, structured path to this
//     row. Not wired here because `clinical/orders`'s only date filter is
//     `createdAt` (when the order was WRITTEN), not "active during this
//     window" — a live join test matched only 1,271 of 15,267 admin rows
//     using a 30-day order-catalog pull, since most administered orders
//     were prescribed long before that window. Doing this right needs a
//     maintained order-catalog cache (pulled/refreshed independently of
//     the weekly window), not a bigger date range. Real opportunity,
//     deferred pending that caching design.
//   - highRiskResidents / continuousCareResidents: evaluations.careLevel
//     goes up to "Care Level 5", which could proxy acuity, but ALIS itself
//     never labels a resident "high risk" — inventing that label from a
//     care-level number risks false clinical precision. Left to the
//     Wellness Director's judgment on purpose.
//   - pullCord: no pull-cord/emergency-response endpoint exists anywhere in
//     the documented API — this is very likely a separate third-party
//     nurse-call system ALIS doesn't ingest, not a gap in what's wired up.
//   - complianceReadiness / reportableIncident: residents/staff
//     complianceDetails' `expiresOn` could proxy survey-readiness risk, but
//     "reportable incident notification pending" is a workflow status (did
//     staff notify the state) with no ALIS field at all — inherently
//     process tracking, not data.
//   - carePlanChanges: evaluations.carePlanStatus has a real 'draft' value,
//     but 'deprecated' (the far more common non-'active' value) is just
//     normal lifecycle — a superseded plan, not one needing attention.
//     Left manual until there's a clear rule for "draft on the resident's
//     current evaluation" that a product decision should confirm first.
//   - familyComplaints: HubSpot ticket `hs_ticket_category` could filter to
//     complaints, but its actual values for this client haven't been
//     verified live — shipping an unverified filter risks misreporting
//     real complaint data, which is worse than leaving it manual.
// fallsWithInjury moved OFF this list (Sep 2026) — confirmed live that
// `residents/incidents/{id}/formData` (per-incident structured form detail)
// returns a real `taken_to_hospital` flag once a fall's Incident Report Form
// is completed. Computed below via normalizeFallsWithHospitalTransfer,
// covering the hospital-transfer half of the row's label — the form has no
// separate "head injury" checkbox, so that qualifier still isn't captured.
const MANUAL_ROW_KEYS = [
  'carePlanChanges', 'rnDelegation', 'pharmacyNarcotic', 'skinWound',
  'weightLoss', 'infectionControl', 'highRiskResidents', 'continuousCareResidents',
  'familyComplaints', 'careTracking', 'pullCord', 'complianceReadiness', 'reportableIncident',
];

/**
 * Run the wellness-scorecard job: pull a trailing 7-day window of clinical
 * incidents/evaluations/leaves/medication-administration/staff-compliance
 * data for an account's communities, compute per-community + portfolio
 * counts (see wellnessNormalizer.js), diff the 2 rows that have a published
 * ALIS 500 benchmark, and look up last week's snapshot for trend arrows.
 * Writes one row to `wellness_snapshots`.
 *
 * Mirrors kpiExport.js's structure (multi-host support, _host tagging,
 * Promise.allSettled account-wide pulls, per-item job tracking) at a
 * smaller scale — a week of clinical data is a fraction of a quarter of
 * billing/occupancy data, so there's no month-splitting or per-day looping
 * here.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runWellnessScorecardJob(jobId, payload) {
  const { companyName, weekEnding, hubspotCompanyId } = payload;
  const hosts = parseHosts(payload.companyHost);
  const multiHost = hosts.length > 1;
  const emit = (event, data) => broadcast(jobId, event, data);
  const dataWarnings = [];

  setJobStatus(jobId, 'running');

  if (!weekEnding) {
    const error = 'Week Ending is required — fill that field in before running the job.';
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

  const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];
  let communities = payload.communities;
  if (communities && communities.length > 0) {
    // Manually-typed communities don't carry `region` (the form only asks
    // for name + ID) — same join-by-communityId backfill kpiExport.js does,
    // so this job's region rollup (see wellnessHealthScoring.js) works
    // regardless of which path a job took to get its community list.
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));
    const regionByHostAndCommunity = new Map();
    for (const host of new Set(communities.map((c) => c.host))) {
      try {
        const all = await getCommunities(host);
        for (const c of all) regionByHostAndCommunity.set(`${host}::${c.communityId}`, c.region || null);
      } catch (err) {
        console.error(`[wellness-scorecard:${jobId}] Failed to look up regions for host "${host}" (manually-specified communities will show no region):`, err);
      }
    }
    communities = communities.map((c) => ({ ...c, region: regionByHostAndCommunity.get(`${c.host}::${c.communityId}`) ?? null }));
  } else {
    emit('progress', { message: `No communities specified — pulling the full community list for ${hosts.length > 1 ? `${hosts.length} hosts (${hosts.join(', ')})` : `host "${hosts[0]}"`}…` });
    communities = [];
    const hostErrors = [];
    for (const host of hosts) {
      try {
        const all = await getCommunities(host);
        const resolved = all
          .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
          .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host, region: c.region || null }));
        communities.push(...resolved);
        emit('progress', { message: `Auto-resolved ${resolved.length} of ${all.length} communities from host "${host}" (excluded Training and canceled/suspended communities).` });
      } catch (err) {
        hostErrors.push(`${host}: ${err.message}`);
        console.error(`[wellness-scorecard:${jobId}] Failed to auto-resolve communities for host "${host}":`, err);
      }
    }
    if (communities.length === 0) {
      const error = `Failed to auto-resolve any communities across host(s) ${hosts.join(', ')}: ${hostErrors.join('; ')}`;
      setJobStatus(jobId, 'failed', error);
      emit('job_error', { error });
      return;
    }
    if (hostErrors.length > 0) {
      const msg = `${hostErrors.length} of ${hosts.length} host(s) failed to auto-resolve and were skipped: ${hostErrors.join('; ')}`;
      emit('progress', { message: msg });
      dataWarnings.push(msg);
    }
    syncJobItems(jobId, communities.map((c) => (multiHost ? `${c.name} [${c.host}]` : c.name)));
  }

  emit('job_start', { jobId, total: communities.length, company: companyName });

  const communityKeys = new Set(communities.map((c) => `${c.host}::${c.communityId}`));
  const { weekStartDate, weekEndingDate } = getWeekWindow(weekEnding);
  const weekStart = weekStartDate.toISOString().slice(0, 10);

  // ── Account-wide pulls (incidents/evaluations/leaves/staff/staff
  // compliance have no communityId query param — pulled once per host,
  // filtered down to this job's communities afterward). ────────────────────
  const ACCOUNT_WIDE_ENDPOINTS = [
    { key: 'incidents', fn: (host) => getIncidents(host) },
    { key: 'evaluations', fn: (host) => getEvaluations(host) },
    { key: 'leaves', fn: (host) => getLeaves(host) },
    { key: 'staff', fn: (host) => getStaff(host) },
    { key: 'residents', fn: (host) => getResidents(host) },
    // Confirmed live: an account not using this ALIS module returns an
    // empty array, not an error — a settled-empty result here is a real
    // finding (see MANUAL_ROW_KEYS comment above), not a pull failure.
    { key: 'staffComplianceDetails', fn: (host) => getStaffComplianceDetails(host) },
    // No date-range param at all on this endpoint — stopBeforeDate lets
    // getObservations page forward only until it's paged past this job's
    // week window (confirmed live: returned newest-first), instead of
    // pulling an account's entire historical note log every week.
    { key: 'observations', fn: (host) => getObservations(host, { stopBeforeDate: weekStartDate }) },
    // For "recently moved in" scoping on the Move-In Assessments row below
    // — plain /v1/export/residents has no move-in date at all (confirmed
    // live), only this history-of-moves endpoint does (physicalMoveInDate).
    // Same account-wide, no-params, single-call shape as every other
    // endpoint here, already proven cheap enough for the QBR pipeline.
    { key: 'moveInMoveOuts', fn: (host) => getHistoricalMoveInMoveOuts(host) },
  ];

  emit('progress', { message: `Pulling incidents, evaluations, leaves, staff, staff compliance, move-in/out history, and observation data from ${hosts.length} host(s)…` });

  const pulled = { incidents: [], evaluations: [], leaves: [], staff: [], residents: [], staffComplianceDetails: [], observations: [], moveInMoveOuts: [] };
  const endpointErrors = [];
  for (const host of hosts) {
    if (isCancelled(jobId)) {
      emit('job_error', { error: 'Job was cancelled.' });
      return;
    }
    const settled = await Promise.allSettled(ACCOUNT_WIDE_ENDPOINTS.map((e) => e.fn(host)));
    settled.forEach((result, i) => {
      const { key } = ACCOUNT_WIDE_ENDPOINTS[i];
      if (result.status === 'fulfilled') {
        pulled[key].push(...asArray(result.value).map((r) => ({ ...r, _host: host })));
      } else {
        endpointErrors.push(`${key}@${host}: ${result.reason.message}`);
        console.error(`[wellness-scorecard:${jobId}] "${key}" pull failed for host "${host}":`, result.reason);
      }
    });
  }

  const totalEndpointAttempts = hosts.length * ACCOUNT_WIDE_ENDPOINTS.length;
  if (endpointErrors.length === totalEndpointAttempts) {
    const error = `All account-wide ALIS API pulls failed across every host: ${endpointErrors.join('; ')}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }
  if (endpointErrors.length > 0) {
    const msg = `${endpointErrors.length} of ${totalEndpointAttempts} account-wide pulls failed and will be treated as empty: ${endpointErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  const incidents = filterByCommunity(pulled.incidents, communityKeys);
  const evaluations = filterByCommunity(pulled.evaluations, communityKeys);
  const leaves = filterByCommunity(pulled.leaves, communityKeys);
  const staff = filterByCommunity(pulled.staff, communityKeys);
  const residents = filterByCommunity(pulled.residents, communityKeys);
  const staffComplianceDetails = filterByCommunity(pulled.staffComplianceDetails, communityKeys);
  const observations = filterByCommunity(pulled.observations, communityKeys);
  const moveInMoveOuts = filterByCommunity(pulled.moveInMoveOuts, communityKeys);

  // Latest physicalMoveInDate per resident — a resident who's moved in,
  // out, and back in has multiple historical rows; only their current
  // stay's move-in date matters for "recently moved in."
  const moveInsById = new Map();
  for (const r of moveInMoveOuts) {
    if (!r.physicalMoveInDate) continue;
    const existing = moveInsById.get(String(r.residentId));
    if (!existing || new Date(r.physicalMoveInDate) > new Date(existing)) {
      moveInsById.set(String(r.residentId), r.physicalMoveInDate);
    }
  }

  // ── Per-community pull: orderAdministration (has a communityId query
  // param and a 1-month date-range cap — well within a 7-day window), plus
  // v2 incidents (Integration API — communityId + date-range required,
  // unlike the account-wide v1 pull `incidents` above) purely for its staff
  // attribution (staffFirstName/staffLastName), which the v1 export
  // endpoint doesn't carry at all. Best-effort: a failed pull here just
  // means that community's incidents show up with no reporter name, not a
  // job failure. ────────────────────────────────────────────────────────
  const orderAdministration = [];
  const staffNameByIncidentId = {};
  // Activities-category recordedCare rows for this week only, per community
  // — feeds the "activity-pattern risk" row below. A 7-day window per
  // community is well within recordedCare's per-call cost (no month
  // chunking needed, unlike the 90-day pulls in usageAudit.js that hit real
  // volume limits) since this job already pulls a 7-day window for
  // orderAdministration/incidentsV2 above.
  const recordedCareActivityRows = [];
  // hqOccupancies only takes a whole-month `monthAndYear` and returns one
  // row per resident per calendar day across that month (confirmed live) —
  // pulling just weekEnding's month and filtering to that single date below
  // avoids fetching a month of data to use one day of it twice.
  const occupancyMonthAndYear = `${weekEnding.slice(0, 7)}-01`;
  const occupancyRows = [];
  for (const community of communities) {
    if (isCancelled(jobId)) {
      emit('job_error', { error: 'Job was cancelled.' });
      return;
    }
    const { name, communityId, host } = community;
    const itemName = multiHost ? `${name} [${host}]` : name;
    setItemStatus(jobId, itemName, 'running');
    emit('item_start', { name: itemName });

    const [orderResult, incidentsV2Result, occupancyResult, recordedCareResult] = await Promise.allSettled([
      getOrderAdministration(host, { communityId, startDate: weekStart, endDate: weekEnding }),
      getIncidentsV2(host, { communityId, startDate: weekStart, endDate: weekEnding }),
      getOccupancy(host, { communityId, monthAndYear: occupancyMonthAndYear }),
      getRecordedCare(host, { communityId, careStartDate: weekStart, careEndDate: weekEnding }),
    ]);

    let failed = false;
    if (orderResult.status === 'fulfilled') {
      orderAdministration.push(...asArray(orderResult.value).map((r) => ({ ...r, _host: host })));
    } else {
      failed = true;
      console.error(`[wellness-scorecard:${jobId}] "orderAdministration" pull failed for "${itemName}":`, orderResult.reason);
    }
    if (incidentsV2Result.status === 'fulfilled') {
      for (const r of incidentsV2Result.value) {
        if (r.incidentId != null && (r.staffFirstName || r.staffLastName)) {
          staffNameByIncidentId[r.incidentId] = `${r.staffFirstName || ''} ${r.staffLastName || ''}`.trim();
        }
      }
    } else {
      // Not pushed to dataWarnings — staff attribution is a nice-to-have
      // enrichment, not a data-completeness signal worth surfacing the way
      // a failed orderAdministration pull is.
      console.error(`[wellness-scorecard:${jobId}] "incidentsV2" (staff attribution) pull failed for "${itemName}":`, incidentsV2Result.reason);
    }
    if (occupancyResult.status === 'fulfilled') {
      occupancyRows.push(...asArray(occupancyResult.value).filter((r) => r.date === weekEnding).map((r) => ({ ...r, communityId })));
    } else {
      // Same rationale as incidentsV2 above — occupancy is a supplementary
      // breakdown row, a failed pull for one community shouldn't fail the
      // whole job the way orderAdministration does.
      console.error(`[wellness-scorecard:${jobId}] "occupancy" pull failed for "${itemName}":`, occupancyResult.reason);
    }
    if (recordedCareResult.status === 'fulfilled') {
      for (const r of asArray(recordedCareResult.value)) {
        if (r.careItemCategory === 'Activities') recordedCareActivityRows.push({ ...r, communityId });
      }
    } else {
      // Same "best-effort, not a job failure" treatment as incidentsV2 —
      // a missing week for this community just leaves a gap in that
      // resident's rolling history, handled the same way as any other week
      // with no data (see computeActivityPatternRisk's history gate).
      console.error(`[wellness-scorecard:${jobId}] "recordedCare" (activity-pattern risk) pull failed for "${itemName}":`, recordedCareResult.reason);
    }

    if (failed) {
      setItemStatus(jobId, itemName, 'failed', 'One or more per-community pulls failed for this community — see server logs.');
      emit('item_fail', { name: itemName, error: 'Partial per-community pull failure' });
    } else {
      setItemStatus(jobId, itemName, 'success');
      emit('item_done', { name: itemName });
    }
  }

  // A cancel that lands mid-loop is caught between iterations above, but
  // this function would otherwise carry on computing rows and writing a
  // snapshot as if it had finished normally — overwriting cancelJob()'s
  // own 'failed' status with 'done' at the very end. Bail out here too.
  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  const data = { incidents, evaluations, leaves, staff, residents, staffComplianceDetails, orderAdministration, observations, staffNameByIncidentId, moveInsById };

  // ── Compute each automatable row, then per-community staffing activity
  // (not in ROW_CALCULATORS since normalizeStaffActivity's shape/inputs
  // differ from the resident-scoped rows — grouped by community by hand). ──
  emit('progress', { message: 'Computing row counts…' });

  const rows = {};
  for (const [key, calc] of Object.entries(ROW_CALCULATORS)) {
    rows[key] = calc(data, weekStartDate, weekEndingDate, communities.map((c) => c.communityId));
  }

  // ── Falls with hospital transfer (formData enrichment) ──────────────────
  // Per-incident call, scoped to just this week's completed Fall incidents
  // (typically a small set) — not run through ROW_CALCULATORS since it
  // needs an async API call per incident, unlike every other row here.
  emit('progress', { message: 'Checking completed fall incident forms for hospital-transfer detail…' });
  const fallsThisWeek = scopeIncidentsThisWeek(incidents, weekEndingDate, weekStartDate, ['fall']);
  const fallsWithForms = fallsThisWeek.filter((r) => (r.completedForms || 0) > 0);
  const formDataResults = await Promise.allSettled(fallsWithForms.map((r) => getIncidentFormData(r._host, r.incidentId)));
  const hospitalTransferByIncidentId = new Map();
  let formDataEmptyCount = 0;
  formDataResults.forEach((result, i) => {
    const incidentId = fallsWithForms[i].incidentId;
    if (result.status === 'fulfilled') {
      if (result.value.length === 0) formDataEmptyCount++;
      hospitalTransferByIncidentId.set(incidentId, formDataIndicatesHospitalTransfer(result.value));
    } else {
      formDataEmptyCount++;
      console.error(`[wellness-scorecard:${jobId}] formData pull failed for incident ${incidentId}:`, result.reason);
    }
  });
  // Confirmed live: a fall marked completedForms>0 does NOT guarantee
  // formData actually returns content (same unreliability the codebase
  // already treats isComplete/completedForms with elsewhere) — surfacing
  // this so a run of all-zero fallsWithInjury reads as "data wasn't
  // available this week," not "confirmed zero hospital transfers."
  if (fallsWithForms.length > 0 && formDataEmptyCount === fallsWithForms.length) {
    dataWarnings.push(`Falls with injury/hospital-transfer: none of this week's ${fallsWithForms.length} completed-form fall incident(s) returned usable formData — the row below reflects missing data, not confirmed zero transfers.`);
  } else if (formDataEmptyCount > 0) {
    dataWarnings.push(`Falls with injury/hospital-transfer: ${formDataEmptyCount} of ${fallsWithForms.length} completed-form fall incident(s) returned no formData.`);
  }
  rows.fallsWithInjury = normalizeFallsWithHospitalTransfer(fallsThisWeek, hospitalTransferByIncidentId, communities.map((c) => c.communityId));

  // ── Activity-pattern risk ────────────────────────────────────────────────
  // Persist this week's per-resident Activities aggregate first (so the
  // rolling history a re-run of THIS week reads back is this run's own
  // numbers, not stale ones), then pull each seen resident's history back
  // out to decide who's flagged. See computeActivityPatternRisk's doc
  // comment and the project-wellness-scorecard memory for the investigation
  // behind the thresholds.
  emit('progress', { message: 'Checking resident activity-engagement trends…' });
  const activityByResident = {};
  for (const r of recordedCareActivityRows) {
    if (r.residentId == null) continue;
    const entry = activityByResident[r.residentId] || { communityId: r.communityId, activityCount: 0, activitySkippedCount: 0 };
    entry.activityCount += 1;
    if (r.isCareNotRecorded) entry.activitySkippedCount += 1;
    activityByResident[r.residentId] = entry;
  }
  const residentMetaById = {};
  for (const r of residents) {
    residentMetaById[r.residentId] = { residentName: r.residentName, communityId: r.communityId, communityName: r.communityName, residentProductType: r.residentProductType };
  }
  replaceResidentActivityWeekly(
    hosts[0],
    weekEnding,
    Object.entries(activityByResident).map(([residentId, a]) => ({
      jobId, residentId, communityId: a.communityId,
      residentName: residentMetaById[residentId]?.residentName,
      residentProductType: residentMetaById[residentId]?.residentProductType,
      activityCount: a.activityCount, activitySkippedCount: a.activitySkippedCount,
    }))
  );
  const activityHistoryByResidentId = {};
  for (const residentId of Object.keys(activityByResident)) {
    activityHistoryByResidentId[residentId] = getResidentActivityHistory(hosts[0], residentId, weekEnding, 8);
  }
  rows.activityPatternRisk = computeActivityPatternRisk(activityHistoryByResidentId, residentMetaById, communities.map((c) => c.communityId));

  // Sentinel incidents — Leisure Care by name, OR any account whose own
  // incident-type config already tags "(Sentinel)" types (see
  // companyFeatures.js). The row itself is hidden entirely for every other
  // client (see wellnessRows.js's requiresFlag + featureFlags below), not
  // just shown as a 0.
  const sentinelIncidentTrackingEnabled = shouldTrackSentinelIncidents(companyName, incidents);
  if (sentinelIncidentTrackingEnabled) {
    rows.sentinelIncidents = normalizeSentinelIncidentsThisWeek(incidents, weekEndingDate, weekStartDate, communities.map((c) => c.communityId));
  }

  const staffByCommunity = {};
  for (const c of communities) {
    const cid = String(c.communityId);
    staffByCommunity[cid] = staff.filter((r) => String(r.communityId) === cid);
  }
  const censusByCommunity = {};
  for (const c of communities) {
    const cid = String(c.communityId);
    censusByCommunity[cid] = residents.filter((r) => String(r.communityId) === cid && r.status !== 'Moved Out').length;
  }
  const staffingByCommunity = {};
  for (const [cid, rowsForCommunity] of Object.entries(staffByCommunity)) {
    staffingByCommunity[cid] = normalizeStaffActivity(rowsForCommunity, { recencyDays: 7, referenceDate: weekEnding, residentCensus: censusByCommunity[cid] });
  }
  const staffingPortfolio = normalizeStaffActivity(staff, { recencyDays: 7, referenceDate: weekEnding, residentCensus: Object.values(censusByCommunity).reduce((a, b) => a + b, 0) });

  // Two role-filtered cuts of the same "% active in the last 7 days"
  // staffing indicator above (Aaron, Sep 2026), matched against `staff`'s
  // `securityRoles` array — ALIS's own small, clean permission-role enum
  // (confirmed live: "Caregiver", "Caregiver - plus eval", "Medication
  // Tech", "Nurse", "Pharmacy Administrator", "Pharmacy Tech", etc.) —
  // not `jobRole`, a much messier ~80-value free-text job-title field
  // that isn't what "security role" refers to in ALIS. Matched by
  // substring against the security-role name itself, same convention as
  // matchIncidentType elsewhere in this file, so the match is visible and
  // adjustable without guessing at a fixed enum ALIS could change.
  //
  // Nurse and Health & Wellness Director roles count toward BOTH cuts
  // (Aaron, Sep 2026) — both routinely handle medications AND caregiving
  // duties depending on the community, so neither is exclusively one or
  // the other. "HWD" is matched as a whole word (not a substring) so it
  // doesn't accidentally match inside some other role name.
  const isNurseOrHwdRole = (sr) => /nurse/i.test(sr) || /\bhwd\b/i.test(sr) || /health\s*(and|&)?\s*wellness\s*director/i.test(sr);
  const isMedicationSecurityRole = (r) => (r.securityRoles || []).some((sr) => /medication|pharmac/i.test(sr) || isNurseOrHwdRole(sr));
  // "Caregiver inclusive" matches any role whose name contains
  // "Caregiver" (currently "Caregiver" and "Caregiver - plus eval"), plus
  // Nurse/HWD per the same reasoning as the medication cut above, plus
  // Medication Tech specifically (Diane Umayam/Leisure Care, Sep 2026 —
  // med techs are floor caregiving staff and should count toward
  // caregiver coverage). Matched narrowly on "medication tech" so it
  // doesn't pull in Pharmacy Administrator/Pharmacy Tech, which are back-
  // office roles, not caregiving staff.
  const isCaregiverSecurityRole = (r) => (r.securityRoles || []).some((sr) => /caregiver/i.test(sr) || /medication\s*tech/i.test(sr) || isNurseOrHwdRole(sr));

  function staffActivityByRole(matchesRole) {
    const byCommunity = {};
    for (const [cid, rowsForCommunity] of Object.entries(staffByCommunity)) {
      byCommunity[cid] = normalizeStaffActivity(rowsForCommunity.filter(matchesRole), { recencyDays: 7, referenceDate: weekEnding, residentCensus: censusByCommunity[cid] });
    }
    const portfolio = normalizeStaffActivity(staff.filter(matchesRole), { recencyDays: 7, referenceDate: weekEnding, residentCensus: Object.values(censusByCommunity).reduce((a, b) => a + b, 0) });
    return { portfolio, byCommunity };
  }
  const medicationStaffing = staffActivityByRole(isMedicationSecurityRole);
  const caregiverStaffing = staffActivityByRole(isCaregiverSecurityRole);

  // Occupancy as of weekEnding — same point-in-time treatment as staffing
  // just above (no trend arrow in this first pass; see
  // normalizeOccupancySnapshot's doc comment).
  const occupancy = normalizeOccupancySnapshot(occupancyRows, communities.map((c) => c.communityId));

  // ── Trend vs. prior week ────────────────────────────────────────────────
  // Staffing isn't run through withTrend — normalizeStaffActivity's shape
  // (totalEnabledStaff/activeInWindow/pct) doesn't match the
  // {portfolio:{total},byCommunity} shape the other rows share, so it's
  // reported as a point-in-time figure only in this MVP, no trend arrow.
  const primaryHost = hosts[0];
  const prior = getPriorWellnessSnapshot(primaryHost, weekEnding);
  const rowsWithTrend = {};
  for (const key of Object.keys(ROW_CALCULATORS)) {
    rowsWithTrend[key] = withTrend(rows[key], prior?.summary?.rows?.[key]);
  }
  rowsWithTrend.fallsWithInjury = withTrend(rows.fallsWithInjury, prior?.summary?.rows?.fallsWithInjury);
  rowsWithTrend.activityPatternRisk = withTrend(rows.activityPatternRisk, prior?.summary?.rows?.activityPatternRisk);
  if (sentinelIncidentTrackingEnabled) {
    rowsWithTrend.sentinelIncidents = withTrend(rows.sentinelIncidents, prior?.summary?.rows?.sentinelIncidents);
  }
  rowsWithTrend.staffing = { portfolio: staffingPortfolio, byCommunity: staffingByCommunity };
  rowsWithTrend.medicationStaffing = medicationStaffing;
  rowsWithTrend.caregiverStaffing = caregiverStaffing;
  rowsWithTrend.occupancy = occupancy;

  // CarePoints (acuity) — sourced from the `evaluations` pull already made
  // above for evaluationsOverdue/moveInAssessments, no extra API call. Not
  // run through ROW_CALCULATORS since its shape ({avg,count} buckets) and
  // trend calc (withCarePointsTrend) differ from every count-based row.
  const carePointsAvg = normalizeCarePointsAverage(evaluations, communities.map((c) => c.communityId));
  rowsWithTrend.carePointsAvg = withCarePointsTrend(carePointsAvg, prior?.summary?.rows?.carePointsAvg);

  // ── Benchmark diff — only falls and hospital/ER have a published ALIS
  // 500 figure to compare against; every other row is trend-only. Weekly
  // resident-days is estimated from the current active-resident count
  // (a snapshot, not a true daily census average) x 7 — an approximation
  // worth revisiting if this benchmark comparison becomes something a
  // client sees regularly, not a QBR-grade resident-days calculation.
  const totalCensus = Object.values(censusByCommunity).reduce((a, b) => a + b, 0);
  const weekResidentDays = estimateResidentDays({ avgCensus: totalCensus, periodStart: weekStart, periodEnd: weekEnding });
  const benchmark = getLatestBenchmarks();
  const benchmarkDiffs = {
    falls: diffMetric(
      weekResidentDays ? (rows.falls.portfolio.total / weekResidentDays) * 1000 : null,
      benchmark.clinical.falls.per1000ResidentDays,
      { higherIsBetter: false }
    ),
    hospitalCurrent: diffMetric(
      weekResidentDays ? (rows.hospitalCurrent.portfolio.total / weekResidentDays) * 1000 : null,
      benchmark.clinical.hospitalVisits.per1000ResidentDays,
      { higherIsBetter: false }
    ),
  };

  // ── Community Health Score + region rollup (Sep 2026, Aaron) ────────────
  // See wellnessHealthScoring.js for the scoring rationale. Built from `rows`
  // (pre-trend — already carries each row's own `.openDocs` from its
  // calculator, e.g. normalizeFallsThisWeek) rather than rowsWithTrend,
  // since nothing here needs the trend wrapper. DOC_COMPLETION_ROW_KEYS
  // mirrors wellnessRowDefinitions.js's `hasDocCompletion` rows exactly —
  // update both if that list ever changes.
  const DOC_COMPLETION_ROW_KEYS = ['falls', 'otherIncidents', 'behavioral', 'elopement'];
  const communityHealth = communities.map((c) => {
    const cid = String(c.communityId);
    const census = censusByCommunity[cid] || 0;
    const residentDays = estimateResidentDays({ avgCensus: census, periodStart: weekStart, periodEnd: weekEnding });

    let incidentTotal = 0;
    let openDocsTotal = 0;
    for (const key of DOC_COMPLETION_ROW_KEYS) {
      incidentTotal += rows[key]?.byCommunity?.[cid]?.total ?? 0;
      openDocsTotal += rows[key]?.openDocs?.byCommunity?.[cid]?.total ?? 0;
    }

    const occByCommunity = occupancy.byCommunity?.[cid];
    const occupancyPct = occByCommunity && occByCommunity.total ? occByCommunity.occupied / occByCommunity.total : null;

    const { score, band, subScores } = computeCommunityHealthScore({
      fallsTotal: rows.falls?.byCommunity?.[cid]?.total ?? 0,
      hospitalTotal: rows.hospitalCurrent?.byCommunity?.[cid]?.total ?? 0,
      residentDays,
      fallsBenchmarkPer1000: benchmark.clinical.falls.per1000ResidentDays,
      hospitalBenchmarkPer1000: benchmark.clinical.hospitalVisits.per1000ResidentDays,
      openDocsTotal,
      incidentTotal,
      medExceptionsTotal: rows.medicationExceptions?.byCommunity?.[cid]?.total ?? 0,
      evaluationsOverdueTotal: rows.evaluationsOverdue?.byCommunity?.[cid]?.total ?? 0,
      census,
      occupancyPct,
      portfolioAvgOccupancyPct: occupancy.pct,
    });

    return {
      communityId: c.communityId, name: c.name, host: c.host, region: c.region || null, census, occupancyPct, score, band, subScores,
      // Raw counts alongside the score, purely for the rollup table display
      // — so it doesn't need to re-derive them from `rows` client-side.
      fallsTotal: rows.falls?.byCommunity?.[cid]?.total ?? 0,
      hospitalTotal: rows.hospitalCurrent?.byCommunity?.[cid]?.total ?? 0,
      medExceptionsTotal: rows.medicationExceptions?.byCommunity?.[cid]?.total ?? 0,
      evaluationsOverdueTotal: rows.evaluationsOverdue?.byCommunity?.[cid]?.total ?? 0,
    };
  });
  const communityHealthRollup = computeRollup(communityHealth);

  const manualRows = Object.fromEntries(MANUAL_ROW_KEYS.map((key) => [key, null]));

  // Forward-looking (next 14 days from weekEnding), not point-in-time like
  // the rest of this report — a weekly ops report should prompt "coming up
  // this week or next," not report what already happened. Doesn't fit the
  // AL/MC/count `rows` shape every WELLNESS_ROWS entry uses, so it's kept
  // top-level rather than forced into `rows`.
  const upcomingBirthdays = normalizeUpcomingBirthdays(residents, staff, {
    windowStart: weekEnding,
    windowEnd: addDays(weekEnding, 14),
  });

  // Average age + decade-band counts, portfolio-wide and per community —
  // same "doesn't fit the AL/MC/count row shape" rationale as
  // upcomingBirthdays above, kept top-level rather than forced into `rows`.
  const residentAge = normalizeResidentAge(residents, communities.map((c) => c.communityId));

  const summary = {
    companyName,
    companyHost: payload.companyHost,
    weekEnding,
    communities: communities.map((c) => ({ name: c.name, communityId: c.communityId, host: c.host, region: c.region || null })),
    rows: rowsWithTrend,
    manualRows,
    upcomingBirthdays,
    residentAge,
    communityHealth,
    communityHealthRollup,
    benchmarkDiffs,
    benchmarkQuarter: benchmark.quarter,
    dataWarnings,
    hubspotCompanyId: hubspotCompanyId || null,
    // Per-company row visibility gates (see companyFeatures.js) — the client
    // filters WELLNESS_ROWS entries carrying a matching `requiresFlag`
    // against this, rather than re-deriving "is this Leisure Care" itself.
    featureFlags: { sentinelIncidentTracking: sentinelIncidentTrackingEnabled },
  };

  addWellnessSnapshot(jobId, {
    companyHost: primaryHost,
    companyName,
    weekEnding,
    benchmarkQuarter: benchmark.quarter,
    summary,
  });

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runWellnessScorecardJob };
