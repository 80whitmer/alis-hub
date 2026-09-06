const {
  getCommunities, getIncidents, getEvaluations, getLeaves, getStaff, getResidents,
  getOrderAdministration, getStaffComplianceDetails, getObservations, getIncidentFormData, getIncidentsV2,
  getOccupancy,
} = require('../services/alisApiClient');
const {
  normalizeFallsThisWeek, normalizeElopementThisWeek, normalizeBehavioralThisWeek,
  normalizeOtherIncidentsThisWeek, normalizeChangeInConditionThisWeek,
  normalizeCurrentlyHospitalized, normalizeEvaluationsOverdue, normalizeMoveInAssessmentsPending,
  normalizeMedicationExceptions, normalizeStaffTrainingGaps, normalizeCarePointsAverage,
  scopeIncidentsThisWeek, formDataIndicatesHospitalTransfer, normalizeFallsWithHospitalTransfer,
  normalizeSentinelIncidentsThisWeek, normalizeOccupancySnapshot,
  withTrend, withCarePointsTrend,
} = require('../services/wellnessNormalizer');
const { shouldTrackSentinelIncidents } = require('../services/companyFeatures');
const { normalizeStaffActivity, diffMetric, estimateResidentDays } = require('../services/kpiNormalizer');
const { getLatestBenchmarks } = require('../services/alis500Benchmarks');
const { setJobStatus, setItemStatus, syncJobItems, addWellnessSnapshot, getPriorWellnessSnapshot } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);

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
  moveInAssessments: (data, weekStartDate, weekEndingDate, communityIds) => normalizeMoveInAssessmentsPending(data.evaluations, communityIds),
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
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));
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
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host }));
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
  ];

  emit('progress', { message: `Pulling incidents, evaluations, leaves, staff, staff compliance, and observation data from ${hosts.length} host(s)…` });

  const pulled = { incidents: [], evaluations: [], leaves: [], staff: [], residents: [], staffComplianceDetails: [], observations: [] };
  const endpointErrors = [];
  for (const host of hosts) {
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
  // hqOccupancies only takes a whole-month `monthAndYear` and returns one
  // row per resident per calendar day across that month (confirmed live) —
  // pulling just weekEnding's month and filtering to that single date below
  // avoids fetching a month of data to use one day of it twice.
  const occupancyMonthAndYear = `${weekEnding.slice(0, 7)}-01`;
  const occupancyRows = [];
  for (const community of communities) {
    const { name, communityId, host } = community;
    const itemName = multiHost ? `${name} [${host}]` : name;
    setItemStatus(jobId, itemName, 'running');
    emit('item_start', { name: itemName });

    const [orderResult, incidentsV2Result, occupancyResult] = await Promise.allSettled([
      getOrderAdministration(host, { communityId, startDate: weekStart, endDate: weekEnding }),
      getIncidentsV2(host, { communityId, startDate: weekStart, endDate: weekEnding }),
      getOccupancy(host, { communityId, monthAndYear: occupancyMonthAndYear }),
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

    if (failed) {
      setItemStatus(jobId, itemName, 'failed', 'One or more per-community pulls failed for this community — see server logs.');
      emit('item_fail', { name: itemName, error: 'Partial per-community pull failure' });
    } else {
      setItemStatus(jobId, itemName, 'success');
      emit('item_done', { name: itemName });
    }
  }

  const data = { incidents, evaluations, leaves, staff, residents, staffComplianceDetails, orderAdministration, observations, staffNameByIncidentId };

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
  if (sentinelIncidentTrackingEnabled) {
    rowsWithTrend.sentinelIncidents = withTrend(rows.sentinelIncidents, prior?.summary?.rows?.sentinelIncidents);
  }
  rowsWithTrend.staffing = { portfolio: staffingPortfolio, byCommunity: staffingByCommunity };
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

  const manualRows = Object.fromEntries(MANUAL_ROW_KEYS.map((key) => [key, null]));

  const summary = {
    companyName,
    companyHost: payload.companyHost,
    weekEnding,
    communities: communities.map((c) => ({ name: c.name, communityId: c.communityId, host: c.host })),
    rows: rowsWithTrend,
    manualRows,
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
