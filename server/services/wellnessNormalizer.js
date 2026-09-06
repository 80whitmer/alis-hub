/**
 * Normalizes raw ALIS export-API responses into the row counts for the
 * Weekly Wellness Scorecard — see server/automation/wellnessExport.js for
 * the job that pulls the raw data and calls into this, and
 * client/src/pages/WellnessScorecard.jsx for how the output renders.
 *
 * Field names/enum values here were confirmed against live data at
 * imagineseniorliving (Aug 2026) — see server/services/ALIS_EXPORT_API_REFERENCE.md
 * for the full documented shape of each endpoint.
 *
 * Every resident-scoped row groups by communityId and residentProductType
 * (AL/MC — Independent/Respite residents are counted in `total` but not
 * broken into either AL/MC bucket, same as the source data itself doesn't
 * put them in either setting). Staff-scoped rows (training gaps, staffing
 * activity) group by communityId only — a staff member isn't "AL" or "MC",
 * they work at a community that may house either or both.
 */

function emptyBucket() {
  return { AL: 0, MC: 0, total: 0 };
}

/**
 * Buckets `rows` (already filtered to whatever this row is counting) by
 * communityId, and by AL/MC within each community. `allCommunityIds` seeds
 * every community in this job with a zero bucket first — without this, a
 * community with zero matches this week gets no key in `byCommunity` at
 * all, which silently drops its trend arrow if it had a nonzero prior week
 * (a real bug caught during MVP verification: "0 this week" must still
 * produce a {total: 0} entry to compare against, not just disappear).
 */
function groupByCommunityAndProductType(rows, allCommunityIds = []) {
  const byCommunity = {};
  for (const cid of allCommunityIds) {
    byCommunity[String(cid)] = emptyBucket();
  }
  for (const r of rows) {
    const cid = String(r.communityId ?? 'unknown');
    byCommunity[cid] = byCommunity[cid] || emptyBucket();
    byCommunity[cid].total++;
    const productType = (r.residentProductType || '').toUpperCase();
    if (productType === 'AL') byCommunity[cid].AL++;
    else if (productType === 'MC') byCommunity[cid].MC++;
  }

  const portfolio = Object.values(byCommunity).reduce(
    (acc, c) => ({ AL: acc.AL + c.AL, MC: acc.MC + c.MC, total: acc.total + c.total }),
    emptyBucket()
  );

  return { portfolio, byCommunity };
}

/** Same idea, but for staff-scoped rows — no AL/MC split, just a per-community total. Same zero-seeding rationale as groupByCommunityAndProductType. */
function groupStaffByCommunity(rows, allCommunityIds = []) {
  const byCommunity = {};
  for (const cid of allCommunityIds) {
    byCommunity[String(cid)] = 0;
  }
  for (const r of rows) {
    const cid = String(r.communityId ?? 'unknown');
    byCommunity[cid] = (byCommunity[cid] || 0) + 1;
  }
  const portfolio = Object.values(byCommunity).reduce((a, b) => a + b, 0);
  return {
    portfolio: { total: portfolio },
    byCommunity: Object.fromEntries(Object.entries(byCommunity).map(([cid, total]) => [cid, { total }])),
  };
}

function withinTrailingWeek(dateStr, weekEndingDate, weekStartDate) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return !Number.isNaN(t) && t >= weekStartDate.getTime() && t <= weekEndingDate.getTime();
}

// ── Incidents (falls, elopement, behavioral) ────────────────────────────

/**
 * `incidents.incidentType` is a clean enum at every client checked so far
 * (e.g. "Fall (Unwitnessed)", "Fall (Witnessed)", "Elopement", "Behavioral",
 * "Aggressive Act ", "Medication Error", "Hospitalization") — matched
 * case-insensitively with a trailing-space trim since at least one real
 * value ("Aggressive Act ") has trailing whitespace in ALIS's own data.
 */
function matchIncidentType(incidentType, patterns) {
  const t = (incidentType || '').toString().trim().toLowerCase();
  return patterns.some((p) => t.includes(p));
}

/**
 * Sidecar count of how many of this row's incidents this week still have
 * open documentation — `incompleteForms`/`incompleteTasks` on the same
 * `incidents` rows already pulled for the count itself, no extra API call.
 * Reuses groupByCommunityAndProductType so it gets the identical AL/MC/
 * byCommunity shape as the count it's attached to. Per client feedback
 * (Gallaher, 2026-09-01) about wanting visibility into incomplete incident
 * documentation — same signal now wired into the QBR pipeline
 * (kpiNormalizer.js's normalizeIncidentCompletion), brought into the weekly
 * scorecard since a Wellness Director needs this catch-up list *this week*,
 * not at quarter-end. `isComplete` isn't used here on purpose — real data
 * shows records marked complete that still carry incompleteForms/
 * incompleteTasks > 0, so the sub-item counts are the more accurate signal.
 */
/**
 * `staffNameByIncidentId` (from getIncidentsV2 — the only ALIS endpoint
 * with staff attribution, see alisApiClient.js) turns the open-docs count
 * into an actionable "who to follow up with" list, not just a number — a
 * Wellness Director working the undocumented-incident list needs to know
 * WHO still owes a form, not just how many are outstanding. Absent (empty
 * object, the default) is a normal, expected state — `reporters` just
 * comes back empty — since the v2 pull is best-effort (see
 * wellnessExport.js's buildStaffNameByIncidentId).
 */
function reporterCounts(rows, staffNameByIncidentId) {
  const counts = {};
  for (const r of rows) {
    const name = staffNameByIncidentId?.[r.incidentId];
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function withOpenDocs(result, scopedRows, allCommunityIds, staffNameByIncidentId) {
  const openDocsRows = scopedRows.filter((r) => (Number(r.incompleteForms) || 0) > 0 || (Number(r.incompleteTasks) || 0) > 0);
  const openDocs = groupByCommunityAndProductType(openDocsRows, allCommunityIds);
  openDocs.portfolio.reporters = reporterCounts(openDocsRows, staffNameByIncidentId);
  for (const cid of Object.keys(openDocs.byCommunity)) {
    openDocs.byCommunity[cid].reporters = reporterCounts(openDocsRows.filter((r) => String(r.communityId) === cid), staffNameByIncidentId);
  }
  return { ...result, openDocs };
}

/** The raw filtered incident rows behind normalizeIncidentRow's count — exported so a caller (wellnessExport.js) can fetch per-incident formData for exactly this week's matching incidents without re-deriving the same filter. */
function scopeIncidentsThisWeek(incidents, weekEndingDate, weekStartDate, patterns) {
  return incidents.filter(
    (r) => withinTrailingWeek(r.incidentDateTime, weekEndingDate, weekStartDate) && matchIncidentType(r.incidentType, patterns)
  );
}

function normalizeIncidentRow(incidents, weekEndingDate, weekStartDate, patterns, allCommunityIds, staffNameByIncidentId) {
  const scoped = scopeIncidentsThisWeek(incidents, weekEndingDate, weekStartDate, patterns);
  return withOpenDocs(groupByCommunityAndProductType(scoped, allCommunityIds), scoped, allCommunityIds, staffNameByIncidentId);
}

const normalizeFallsThisWeek = (incidents, weekEndingDate, weekStartDate, allCommunityIds, staffNameByIncidentId) =>
  normalizeIncidentRow(incidents, weekEndingDate, weekStartDate, ['fall'], allCommunityIds, staffNameByIncidentId);

const normalizeElopementThisWeek = (incidents, weekEndingDate, weekStartDate, allCommunityIds, staffNameByIncidentId) =>
  normalizeIncidentRow(incidents, weekEndingDate, weekStartDate, ['elopement'], allCommunityIds, staffNameByIncidentId);

const normalizeBehavioralThisWeek = (incidents, weekEndingDate, weekStartDate, allCommunityIds, staffNameByIncidentId) =>
  normalizeIncidentRow(incidents, weekEndingDate, weekStartDate, ['behavioral', 'aggressive act'], allCommunityIds, staffNameByIncidentId);

/**
 * Leisure Care-only (see companyFeatures.js) — matches ALIS incident-type
 * names containing "sentinel", e.g. "Elopement (Sentinel)", "Death
 * (Unexpected) Sentinel" (confirmed live, Sep 2026: 108 of 11,025 real
 * incidents, spanning many different base incident types — a cross-cutting
 * severity tag, not one incident type of its own). Callers should only
 * invoke this when isSentinelIncidentTrackingEnabled(companyName) is true —
 * see wellnessExport.js.
 */
const normalizeSentinelIncidentsThisWeek = (incidents, weekEndingDate, weekStartDate, allCommunityIds) =>
  normalizeIncidentRow(incidents, weekEndingDate, weekStartDate, ['sentinel'], allCommunityIds);

// Every incidentType enum value confirmed live that isn't already its own
// row above or a hospital/ER event tracked separately via leaves — a real
// residual count, not a keyword guess, since incidentType itself is the
// clean enum (see matchIncidentType's doc comment). "Medication Error" is
// deliberately included here rather than folded into medicationExceptions
// — that row counts orderAdministration exceptions (a missed/late/refused
// dose), a different, non-overlapping event from a staff member logging an
// actual medication-error incident report.
const OTHER_INCIDENT_EXCLUDE = ['fall', 'elopement', 'behavioral', 'aggressive act', 'hospitalization'];
function normalizeOtherIncidentsThisWeek(incidents, weekEndingDate, weekStartDate, allCommunityIds, staffNameByIncidentId) {
  const scoped = incidents.filter(
    (r) => withinTrailingWeek(r.incidentDateTime, weekEndingDate, weekStartDate) && !matchIncidentType(r.incidentType, OTHER_INCIDENT_EXCLUDE)
  );
  return withOpenDocs(groupByCommunityAndProductType(scoped, allCommunityIds), scoped, allCommunityIds, staffNameByIncidentId);
}

/**
 * Reads ALIS's own hospital-transfer answer off a completed Incident Report
 * Form (see getIncidentFormData in alisApiClient.js). Confirmed live field
 * key `generic.incident_reporting_form.taken_to_hospital` ("Yes"/"No"), read
 * via a substring key search rather than an exact match since a different
 * community/client may run a differently-named form template with the same
 * question — matching the "structured field or leave it manual" caution
 * this codebase already applies elsewhere (see wellnessExport.js's
 * skinWound/infectionControl comment): if no matching key is found at all,
 * this returns false, same as "no transfer", which is a real limitation for
 * a community using an unrecognized template, not a bug.
 */
function formDataIndicatesHospitalTransfer(formDataRows) {
  for (const form of formDataRows || []) {
    const data = form?.data || {};
    for (const [key, value] of Object.entries(data)) {
      const k = key.toLowerCase();
      if ((k.includes('taken_to_hospital') || k.includes('hospital_transfer')) && typeof value === 'string') {
        if (value.trim().toLowerCase() === 'yes') return true;
      }
    }
  }
  return false;
}

/**
 * `fallsThisWeek` is this week's raw fall incident rows (from
 * scopeIncidentsThisWeek); `hospitalTransferByIncidentId` is a Map<incidentId,
 * boolean> the caller builds by calling getIncidentFormData per completed
 * fall (see wellnessExport.js) — kept as a plain lookup here so this stays a
 * pure function with no API calls of its own. This computes the
 * hospital-transfer half of the "Falls with injury (head) / hospital
 * transfer" row; the generic Incident Report Form template has no separate
 * "head injury" checkbox, so that qualifier isn't captured here (would need
 * free-text scanning of the incident summary, which this codebase
 * deliberately avoids for anything treated as an authoritative count — see
 * the same skinWound caution).
 */
function normalizeFallsWithHospitalTransfer(fallsThisWeek, hospitalTransferByIncidentId, allCommunityIds) {
  const scoped = fallsThisWeek.filter((r) => hospitalTransferByIncidentId.get(r.incidentId) === true);
  return groupByCommunityAndProductType(scoped, allCommunityIds);
}

// ── Change in condition (observations) ───────────────────────────────────

/**
 * `residents/observations.observationType` includes a real "Change of
 * Condition" / "Change in Conditions" value at ISL — both spellings are
 * matched since the same concept is entered inconsistently in the source
 * system. This is a structured-field match, not the free-text keyword
 * scan used for the skin/wound "review worklist" idea (see
 * wellnessExport.js's comment on why those stay manual) — observationType
 * itself is the enum value, `observationText` is never inspected here.
 */
function normalizeChangeInConditionThisWeek(observations, weekEndingDate, weekStartDate, allCommunityIds) {
  const scoped = observations.filter((r) => {
    const type = (r.observationType || '').toLowerCase();
    return withinTrailingWeek(r.occurredOn, weekEndingDate, weekStartDate) && (type.includes('change of condition') || type.includes('change in condition'));
  });
  return groupByCommunityAndProductType(scoped, allCommunityIds);
}

// ── Residents currently hospitalized / in ER (leaves) ───────────────────

/**
 * "Currently" means an open leave (no actualEndDateTime yet) whose
 * destination is hospital/SNF/rehab — same destination-keyword logic as
 * kpiNormalizer.js's normalizeHospitalVisits, just filtered to "still out"
 * instead of "total visits in the period".
 */
function normalizeCurrentlyHospitalized(leaves, allCommunityIds) {
  const open = leaves.filter((r) => {
    if (r.actualEndDateTime) return false;
    const destination = (r.leaveDestination || r.leaveType || r.type || '').toString().toLowerCase();
    return destination.includes('hospital') || destination.includes('snf') || destination.includes('skilled') || destination.includes('rehab');
  });
  return groupByCommunityAndProductType(open, allCommunityIds);
}

// ── Quarterly evaluations overdue ───────────────────────────────────────

/**
 * A resident's most-current Quarterly evaluation being expired means
 * they're overdue for the next one — isMostCurrent/isExpired are
 * ALIS-computed flags on the evaluations export, not something we derive
 * from dates ourselves.
 */
function normalizeEvaluationsOverdue(evaluations, allCommunityIds) {
  const overdue = evaluations.filter((r) => r.reason === 'Quarterly' && r.isMostCurrent === true && r.isExpired === true);
  return groupByCommunityAndProductType(overdue, allCommunityIds);
}

/**
 * A move-in evaluation still sitting at `status: 'no_eval'` for a resident
 * who isn't Moved Out means the initial assessment was never completed —
 * same isMostCurrent/status vocabulary as evaluationsOverdue above, just a
 * different `reason` filter and no isExpired check (a never-started
 * evaluation has no expiration to check).
 */
function normalizeMoveInAssessmentsPending(evaluations, allCommunityIds) {
  const pending = evaluations.filter(
    (r) => (r.reason === 'Move In' || r.reason === 'Pre-admission') && r.isMostCurrent === true && r.status === 'no_eval' && r.residentStatus !== 'Moved Out'
  );
  return groupByCommunityAndProductType(pending, allCommunityIds);
}

// ── Medication exceptions ────────────────────────────────────────────────

/**
 * `status === 'exception'` covers a flagged administration (wrong time,
 * unavailable med, refused, etc.); `isNotRecorded === true` covers a dose
 * nobody ever logged as given at all. Both represent "this scheduled
 * medication event didn't happen as planned" — PRN orders are excluded
 * since there's no "missed" PRN, only "not needed".
 */
function normalizeMedicationExceptions(orderRows, allCommunityIds) {
  const exceptions = orderRows.filter(
    (r) => r.orderType !== 'PRN' && (r.status === 'exception' || r.isNotRecorded === true)
  );
  return groupByCommunityAndProductType(exceptions, allCommunityIds);
}

// ── Staff training / competency gaps ─────────────────────────────────────

/**
 * staff/complianceDetails is not populated at every client — an account
 * with zero rows here isn't a bug, it means that ALIS module isn't in use
 * for this account yet. Counts by staff member x incomplete item (one
 * staff member with 3 overdue trainings counts 3 times), matching how the
 * source data itself has one row per compliance item per staff member.
 */
function normalizeStaffTrainingGaps(staffComplianceRows, allCommunityIds) {
  // 'incomplete' is the only non-'completed' status value confirmed live so
  // far; 'expired' is included on the assumption the API uses the same
  // vocabulary as residents/complianceDetails (unconfirmed — no expired row
  // was observed in either client sampled) rather than leaving expired
  // items silently uncounted if that assumption turns out right.
  const incomplete = staffComplianceRows.filter((r) => r.status === 'incomplete' || r.status === 'expired');
  return groupStaffByCommunity(incomplete, allCommunityIds);
}

// ── Acuity (CarePoints) ──────────────────────────────────────────────────

/**
 * Averages `carePoints` across each community's current resident
 * evaluations. Confirmed live (Sep 2026): `/v1/export/residents/evaluations`
 * already returns a populated `carePoints` field (ALIS's own acuity/fee-tier
 * scoring input, same field `careLevel`/`fee` are derived from) on every
 * isMostCurrent evaluation — no XML parsing or extra endpoint call needed
 * for the total, unlike the per-question detail (see
 * server/services/evaluationScoring.js, which parses retXml +
 * evaluationConfiguration for readable question/answer text — a separate,
 * heavier pull worth it only for a resident-level detail view, not this
 * portfolio-average row).
 *
 * Deliberately reports an average, not a "high/medium/low" label — see
 * wellnessExport.js's MANUAL_ROW_KEYS comment on highRiskResidents for why
 * inventing a risk-level threshold from an ALIS number is left to the
 * Wellness Director's judgment on purpose. This row is real ALIS data with
 * no invented interpretation layered on.
 */
function avgBucketFor(rows) {
  const byType = { AL: [], MC: [] };
  for (const r of rows) {
    const productType = (r.residentProductType || '').toUpperCase();
    if (productType === 'AL') byType.AL.push(r);
    else if (productType === 'MC') byType.MC.push(r);
  }
  const avgOf = (list) => (list.length ? list.reduce((sum, r) => sum + r.carePoints, 0) / list.length : null);
  return {
    AL: { avg: avgOf(byType.AL), count: byType.AL.length },
    MC: { avg: avgOf(byType.MC), count: byType.MC.length },
    total: { avg: avgOf(rows), count: rows.length },
  };
}

function normalizeCarePointsAverage(evaluations, allCommunityIds = []) {
  const scored = evaluations.filter((r) => r.isMostCurrent === true && r.carePoints != null);

  const byCommunity = {};
  for (const cid of allCommunityIds) byCommunity[String(cid)] = avgBucketFor([]);
  for (const cid of new Set(scored.map((r) => String(r.communityId)))) {
    byCommunity[cid] = avgBucketFor(scored.filter((r) => String(r.communityId) === cid));
  }

  return { portfolio: avgBucketFor(scored), byCommunity };
}

/** Trend for normalizeCarePointsAverage's shape ({avg,count} buckets, not {AL,MC,total} counts) — same idea as withTrend, kept separate since comparing averages needs `.avg`, not `.total`. */
function withCarePointsTrend(current, priorCarePoints) {
  const scopeTrend = (curr, prev) => ({
    current: curr?.avg ?? null,
    prior: prev?.avg ?? null,
    trend: trendArrow(curr?.avg ?? null, prev?.avg ?? null),
  });
  const byCommunity = {};
  for (const cid of Object.keys(current.byCommunity)) {
    byCommunity[cid] = scopeTrend(current.byCommunity[cid].total, priorCarePoints?.byCommunity?.[cid]?.total);
  }
  return { ...current, portfolioTrend: scopeTrend(current.portfolio.total, priorCarePoints?.portfolio?.total), byCommunityTrend: byCommunity };
}

// ── Trend (this week vs. prior week) ────────────────────────────────────

function trendArrow(current, prior) {
  if (current == null || prior == null) return null;
  if (current > prior) return '↑';
  if (current < prior) return '↓';
  return '→';
}

/**
 * Compares this week's `rows` (the shape produced by the functions above —
 * { portfolio: {...}, byCommunity: {...} }) against the prior snapshot's
 * same structure, returning { current, prior, trend } per scope (portfolio
 * and each community). Prior may be null (first-ever run for this account)
 * — every trend comes back null in that case rather than a fabricated "→".
 */
function withTrend(currentRow, priorRow) {
  const scopeTrend = (curr, prev) => ({
    current: curr?.total ?? 0,
    prior: prev?.total ?? null,
    trend: trendArrow(curr?.total ?? 0, prev?.total ?? null),
  });

  const byCommunity = {};
  for (const cid of Object.keys(currentRow.byCommunity)) {
    byCommunity[cid] = scopeTrend(currentRow.byCommunity[cid], priorRow?.byCommunity?.[cid]);
  }

  return {
    ...currentRow,
    portfolioTrend: scopeTrend(currentRow.portfolio, priorRow?.portfolio),
    byCommunityTrend: byCommunity,
  };
}

module.exports = {
  groupByCommunityAndProductType,
  groupStaffByCommunity,
  normalizeFallsThisWeek,
  normalizeElopementThisWeek,
  normalizeBehavioralThisWeek,
  normalizeOtherIncidentsThisWeek,
  normalizeSentinelIncidentsThisWeek,
  scopeIncidentsThisWeek,
  formDataIndicatesHospitalTransfer,
  normalizeFallsWithHospitalTransfer,
  normalizeChangeInConditionThisWeek,
  normalizeCurrentlyHospitalized,
  normalizeEvaluationsOverdue,
  normalizeMoveInAssessmentsPending,
  normalizeMedicationExceptions,
  normalizeStaffTrainingGaps,
  normalizeCarePointsAverage,
  withCarePointsTrend,
  withTrend,
  trendArrow,
};
