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

/**
 * Attaches the actual flagged rows (mapped through `toItem` to a small
 * display-friendly shape) onto each bucket a groupByCommunityAndProductType
 * result already has, for a drawer/export UI to list — same "enrich the
 * bucket, don't change its shape" idea as withOpenDocs' `reporters` summary
 * below, just the full row list instead of an aggregated count. Existing
 * code reading `.AL`/`.MC`/`.total` is unaffected by the extra `.items` key.
 */
function attachItems(result, rows, toItem) {
  const items = rows.map(toItem);
  result.portfolio.items = items;
  for (const cid of Object.keys(result.byCommunity)) {
    result.byCommunity[cid].items = items.filter((it) => String(it.communityId) === cid);
  }
  return result;
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
  const result = groupByCommunityAndProductType(scoped, allCommunityIds);
  return attachItems(result, scoped, (r) => ({
    residentId: r.residentId, residentName: r.residentName, communityId: r.communityId, communityName: r.communityName,
    date: r.occurredOn, detail: [r.severity, r.observationText].filter(Boolean).join(' — ') || null,
  }));
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
  const result = groupByCommunityAndProductType(open, allCommunityIds);
  return attachItems(result, open, (r) => ({
    residentId: r.residentId, residentName: r.residentName, communityId: r.communityId, communityName: r.communityName,
    date: r.startDateTime, detail: [r.leaveDestination, r.leaveStatus].filter(Boolean).join(' — ') || null,
  }));
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

// Real evaluation `reason` values vary by account/state for "this
// resident's first assessment" (confirmed live across samples: some
// accounts use "Move In", others "Pre-admission" or "Initial") — every
// name observed so far for that same underlying concept is matched, as
// opposed to the distinct periodic follow-up reasons ("30 day", "60 day",
// "90 day", etc.) some accounts also use, which are a separate ongoing
// compliance cadence, not the initial move-in assessment this row tracks.
const MOVE_IN_EVAL_REASONS = new Set(['Move In', 'Pre-admission', 'Initial']);
// 'no_eval' = never started; 'draft' = started but not finished/signed —
// both read as "incomplete or pending" per Aaron (Sep 2026). 'completed'
// and 'imported' (migrated from a prior system) don't count as pending.
const PENDING_EVAL_STATUSES = new Set(['no_eval', 'draft']);
// How many days after physicalMoveInDate a resident still counts as
// "recently moved in" for this row — a reasonable default covering most
// states' initial-assessment deadlines, easy to retune if Aaron wants a
// different window.
const MOVE_IN_ASSESSMENT_WINDOW_DAYS = 30;

/**
 * Residents who moved in within the trailing MOVE_IN_ASSESSMENT_WINDOW_DAYS
 * days (per historicalMoveInMoveOuts' physicalMoveInDate — plain
 * /v1/export/residents has no move-in date at all) whose most-current
 * initial-assessment-type evaluation is either missing (`no_eval`) or
 * still in progress (`draft`). Refined (Sep 2026, Aaron) from an earlier
 * version that flagged ANY resident with a pending move-in eval regardless
 * of how long ago they moved in — which could keep flagging a years-old
 * stale record — and that only caught `no_eval`, missing an assessment
 * that was started but never finished. A resident with no move-in-date
 * record at all is excluded rather than guessed at, matching this file's
 * "don't guess" convention.
 */
function normalizeMoveInAssessmentsPending(evaluations, moveInsById, allCommunityIds, weekEndingDate) {
  const cutoff = new Date(weekEndingDate);
  cutoff.setDate(cutoff.getDate() - MOVE_IN_ASSESSMENT_WINDOW_DAYS);

  const pending = evaluations.filter((r) => {
    if (!MOVE_IN_EVAL_REASONS.has(r.reason) || r.isMostCurrent !== true || r.residentStatus === 'Moved Out') return false;
    if (!PENDING_EVAL_STATUSES.has(r.status)) return false;
    const moveInDate = moveInsById.get(String(r.residentId));
    if (!moveInDate) return false;
    const d = new Date(moveInDate);
    return !Number.isNaN(d.getTime()) && d >= cutoff && d <= weekEndingDate;
  });
  return groupByCommunityAndProductType(pending, allCommunityIds);
}

// ── Evaluations needing attention ────────────────────────────────────────

/**
 * Every non-Independent-Living, currently-in-house resident whose most
 * current evaluation (ALIS's own `isMostCurrent` flag — one per resident,
 * not scoped to a single evaluation `reason`) is expired, still in
 * progress, more than a year old, or simply doesn't exist. Same
 * classification order as the QBR pipeline's "Levels of Care" section
 * (kpiNormalizer.js's normalizeCareLevelEvaluations) — deliberately not
 * reused directly, since that function also computes revenue-leakage
 * figures this weekly row has no use for, and returns portfolio-only
 * totals rather than the AL/MC/community bucket shape every other row
 * here shares (via groupByCommunityAndProductType).
 */
function normalizeEvaluationsNeedingAttention(evaluations, residents, allCommunityIds, weekEndingDate) {
  const activeResidents = residents.filter((r) => r.residentStatus !== 'Moved Out' && (r.productType || '').toUpperCase() !== 'IL');

  const mostCurrentByResident = new Map();
  for (const e of evaluations) {
    if (e.isMostCurrent) mostCurrentByResident.set(String(e.residentId), e);
  }

  const cutoff = new Date(weekEndingDate);
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const flagged = [];
  for (const resident of activeResidents) {
    const evalRow = mostCurrentByResident.get(String(resident.residentId));
    const base = { communityId: resident.communityId, residentProductType: resident.productType, residentId: resident.residentId };

    if (!evalRow) {
      flagged.push({ ...base, attentionReason: 'neverEvaluated' });
      continue;
    }
    if (evalRow.isExpired) {
      flagged.push({ ...base, attentionReason: 'expired' });
      continue;
    }
    if (!evalRow.isCompleted) {
      flagged.push({ ...base, attentionReason: 'incomplete' });
      continue;
    }
    const evalDate = evalRow.evaluationDate ? new Date(evalRow.evaluationDate) : null;
    if (!evalDate || Number.isNaN(evalDate.getTime()) || evalDate < cutoff) {
      flagged.push({ ...base, attentionReason: 'overdue' });
    }
  }
  const result = groupByCommunityAndProductType(flagged, allCommunityIds);

  // Each community's share of ITS OWN considered (non-IL, in-house)
  // resident population — not a share of the portfolio total, matching the
  // QBR pipeline's normalizeCareLevelEvaluations byCommunity ranking. A raw
  // count alone can't tell a Wellness Director which community is actually
  // falling behind: 5 flagged residents at a 20-bed community is a much
  // bigger problem than the same 5 at a 120-bed one. Purely additive —
  // existing callers reading only `.AL`/`.MC`/`.total` are unaffected.
  const consideredByCommunity = {};
  for (const cid of allCommunityIds) consideredByCommunity[String(cid)] = 0;
  for (const r of activeResidents) {
    const cid = String(r.communityId ?? 'unknown');
    consideredByCommunity[cid] = (consideredByCommunity[cid] || 0) + 1;
  }
  for (const cid of Object.keys(result.byCommunity)) {
    const considered = consideredByCommunity[cid] || 0;
    result.byCommunity[cid].consideredResidents = considered;
    result.byCommunity[cid].pct = considered ? result.byCommunity[cid].total / considered : null;
  }
  result.portfolio.consideredResidents = activeResidents.length;
  result.portfolio.pct = activeResidents.length ? result.portfolio.total / activeResidents.length : null;

  return result;
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

/**
 * Occupancy as of the week-ending date — a point-in-time snapshot, not a
 * "this week" count like the other rows above, so (same reasoning as
 * staffing in wellnessExport.js) it isn't run through withTrend/
 * withCarePointsTrend, at least in this first pass. `occupancyRows` should
 * already be pre-filtered to the single relevant day — hqOccupancies
 * returns one row per resident per calendar day across the whole
 * requested month (see wellnessExport.js's per-community pull), and a
 * week's worth of the same residents/rooms repeated 7x would just dilute
 * the count, not add information, for a single-snapshot figure like this.
 * Same fields/shape as kpiNormalizer.js's normalizeOccupancy
 * (byProductType/byClassification) — kept as a separate implementation
 * rather than a shared import, matching how this file and kpiNormalizer.js
 * have always mirrored rather than shared logic.
 */
function normalizeOccupancySnapshot(occupancyRows, allCommunityIds = []) {
  const relevant = occupancyRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');
  if (relevant.length === 0) {
    return { hasOccupancyData: occupancyRows.length > 0, pct: null, occupied: null, total: null, byCommunity: {}, byProductType: [], byClassification: [] };
  }

  const byCommunity = {};
  for (const cid of allCommunityIds) byCommunity[String(cid)] = { occupied: 0, total: 0, byProductType: {}, byClassification: {} };

  const byProductType = {};
  const byClassification = {};

  for (const r of relevant) {
    const cid = String(r.communityId ?? 'unknown');
    byCommunity[cid] = byCommunity[cid] || { occupied: 0, total: 0, byProductType: {}, byClassification: {} };
    byCommunity[cid].total++;

    const productType = (r.residentProductType || 'Unspecified').toString().trim() || 'Unspecified';
    byProductType[productType] = byProductType[productType] || { occupied: 0, total: 0 };
    byProductType[productType].total++;
    byCommunity[cid].byProductType[productType] = byCommunity[cid].byProductType[productType] || { occupied: 0, total: 0 };
    byCommunity[cid].byProductType[productType].total++;

    const classification = (r.residentClassification || 'Unspecified').toString().trim() || 'Unspecified';
    byClassification[classification] = byClassification[classification] || { occupied: 0, total: 0 };
    byClassification[classification].total++;
    byCommunity[cid].byClassification[classification] = byCommunity[cid].byClassification[classification] || { occupied: 0, total: 0 };
    byCommunity[cid].byClassification[classification].total++;

    if (r.dataSet === 'Occupied') {
      byCommunity[cid].occupied++;
      byProductType[productType].occupied++;
      byClassification[classification].occupied++;
      byCommunity[cid].byProductType[productType].occupied++;
      byCommunity[cid].byClassification[classification].occupied++;
    }
  }

  const totalOccupied = Object.values(byCommunity).reduce((s, c) => s + c.occupied, 0);
  const total = Object.values(byCommunity).reduce((s, c) => s + c.total, 0);

  // Per-community breakdowns use the same "share of occupied" pct
  // convention as the portfolio-level ones below, just scoped to that
  // community's own occupied count instead of the portfolio's (Aaron, Sep
  // 2026: "add the occupancy breakdown per community on the community
  // sections") — so e.g. "40%" on one community's Memory Care Medicaid row
  // means 40% of that community's occupied units, not the portfolio's.
  for (const cid of Object.keys(byCommunity)) {
    const c = byCommunity[cid];
    c.byProductType = Object.entries(c.byProductType)
      .map(([productType, v]) => ({ productType, pct: c.occupied ? v.occupied / c.occupied : null, occupied: v.occupied, total: v.total }))
      .sort((a, b) => b.total - a.total);
    c.byClassification = Object.entries(c.byClassification)
      .map(([classification, v]) => ({ classification, pct: c.occupied ? v.occupied / c.occupied : null, occupied: v.occupied, total: v.total }))
      .sort((a, b) => b.total - a.total);
  }

  return {
    hasOccupancyData: true,
    pct: total ? totalOccupied / total : null,
    occupied: totalOccupied,
    total,
    byCommunity,
    // pct is each group's share of total census (occupied / totalOccupied
    // across every group), not that group's own fill rate — matches
    // kpiNormalizer.js's normalizeOccupancy (2026-09-07, Aaron: "what
    // percentage are each of the product types or classifications" of
    // the whole).
    byProductType: Object.entries(byProductType)
      .map(([productType, c]) => ({ productType, pct: totalOccupied ? c.occupied / totalOccupied : null, occupied: c.occupied, total: c.total }))
      .sort((a, b) => b.total - a.total),
    byClassification: Object.entries(byClassification)
      .map(([classification, c]) => ({ classification, pct: totalOccupied ? c.occupied / totalOccupied : null, occupied: c.occupied, total: c.total }))
      .sort((a, b) => b.total - a.total),
  };
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

// ── Resident age ──────────────────────────────────────────────────────────

// Senior-living-appropriate decade bands rather than raw 10s-since-birth
// buckets (Aaron, Sep 2026) — "<60" catches the rare younger resident
// without a mostly-empty "50s"/"40s" bucket, and "100+" (not "100s") since
// nobody expects a 110-120 bucket to ever populate separately.
const AGE_BANDS = ['<60', '60s', '70s', '80s', '90s', '100+'];
function residentAgeBand(age) {
  if (age == null) return null;
  if (age < 60) return '<60';
  if (age < 70) return '60s';
  if (age < 80) return '70s';
  if (age < 90) return '80s';
  if (age < 100) return '90s';
  return '100+';
}

/** One scope's (portfolio or one community's) average age + decade-band counts, from residents with a numeric `age` on file. */
function summarizeResidentAges(residents) {
  const withAge = residents.filter((r) => typeof r.age === 'number');
  const bandCounts = Object.fromEntries(AGE_BANDS.map((b) => [b, 0]));
  for (const r of withAge) {
    const band = residentAgeBand(r.age);
    if (band) bandCounts[band]++;
  }
  return {
    totalResidents: residents.length,
    countedForAge: withAge.length,
    avgAge: withAge.length ? withAge.reduce((sum, r) => sum + r.age, 0) / withAge.length : null,
    bandCounts,
  };
}

/**
 * Average resident age and decade-band counts, portfolio-wide and per
 * community (Aaron, Sep 2026) — rendered as its own small summary at the
 * top of each WellnessTable scope (client/src/pages/WellnessScorecard.jsx),
 * not forced into the AL/MC/Total row shape every WELLNESS_ROWS entry uses,
 * same rationale as the Occupancy section already being its own thing.
 * Excludes Moved Out residents, same convention as censusByCommunity in
 * wellnessExport.js.
 */
function normalizeResidentAge(residents, allCommunityIds) {
  const active = residents.filter((r) => r.residentStatus !== 'Moved Out');
  const byCommunity = {};
  for (const cid of allCommunityIds) {
    byCommunity[String(cid)] = summarizeResidentAges(active.filter((r) => String(r.communityId) === String(cid)));
  }
  const portfolio = summarizeResidentAges(active);
  return { portfolio, byCommunity };
}

// ── Activity-pattern risk ────────────────────────────────────────────────

// First-pass thresholds (Sep 2026) — derived from a real 5-resident sample
// against `viva`'s recordedCare data, not a statistically tuned model. Only
// 1 of the 5 showed the hypothesized decline; expect to revisit these once
// live portfolio data accumulates. See the "Predictive change-of-condition
// flagging" note in the project-wellness-scorecard memory for the full
// investigation.
const ACTIVITY_RISK_MIN_BASELINE_WEEKS = 4; // of the 6 baseline weeks, how many must have any logging at all
const ACTIVITY_RISK_MIN_BASELINE_VOLUME = 6; // pooled Activities item count across the baseline weeks
const ACTIVITY_RISK_SKIP_RATE_DELTA = 0.2; // current skip-rate must clear baseline + this margin
const ACTIVITY_RISK_MIN_ABS_SKIP_RATE = 0.35; // ...and never below this floor, so a ~0% baseline can't flag on a trivial blip

/**
 * Flags residents whose Activities-category care logging shows a sustained
 * skip-rate spike against their own recent baseline — an inferred early
 * signal, not a measured event (see wellnessExport.js's top-of-file comment
 * on why fuzzy/derived signals are handled carefully in this codebase). A
 * resident is only ever flagged or left out of `items` entirely — there is
 * no "confirmed stable" state, since most residents don't have enough
 * Activities logging to say anything at all about them yet.
 *
 * `weeklyHistoryByResidentId` — { [residentId]: history[] }, each history
 * already DESC by week_ending and already including the current week (see
 * getResidentActivityHistory in database.js). `residentMetaById` —
 * { [residentId]: { residentName, communityId, residentProductType } }.
 */
function computeActivityPatternRisk(weeklyHistoryByResidentId, residentMetaById, allCommunityIds) {
  const flagged = [];
  for (const [residentId, history] of Object.entries(weeklyHistoryByResidentId)) {
    const current = history.slice(0, 2);
    const baseline = history.slice(2, 8);
    if (current.length < 2 || current.some((w) => w.activity_count === 0)) continue; // no trustworthy current skip-rate

    const baselineWeeksWithData = baseline.filter((w) => w.activity_count > 0);
    const baselineCount = baseline.reduce((sum, w) => sum + w.activity_count, 0);
    const baselineSkipped = baseline.reduce((sum, w) => sum + w.activity_skipped_count, 0);
    if (baselineWeeksWithData.length < ACTIVITY_RISK_MIN_BASELINE_WEEKS || baselineCount < ACTIVITY_RISK_MIN_BASELINE_VOLUME) continue; // not enough history to trust a baseline yet

    const baselineSkipRate = baselineSkipped / baselineCount;
    const threshold = Math.max(baselineSkipRate + ACTIVITY_RISK_SKIP_RATE_DELTA, ACTIVITY_RISK_MIN_ABS_SKIP_RATE);
    const bothWeeksElevated = current.every((w) => w.activity_skipped_count / w.activity_count >= threshold);
    if (!bothWeeksElevated) continue;

    const meta = residentMetaById[residentId] || {};
    const currentSkipRate = current[0].activity_skipped_count / current[0].activity_count;
    flagged.push({
      residentId,
      residentName: meta.residentName || null,
      communityId: meta.communityId,
      communityName: meta.communityName || null,
      residentProductType: meta.residentProductType,
      baselineSkipRatePct: Math.round(baselineSkipRate * 100),
      currentSkipRatePct: Math.round(currentSkipRate * 100),
    });
  }

  const result = groupByCommunityAndProductType(flagged, allCommunityIds);
  return attachItems(result, flagged, (f) => ({
    residentId: f.residentId,
    residentName: f.residentName,
    communityId: f.communityId,
    communityName: f.communityName,
    detail: `Activity skip-rate ${f.baselineSkipRatePct}% baseline → ${f.currentSkipRatePct}% current`,
  }));
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
  normalizeEvaluationsNeedingAttention,
  normalizeMedicationExceptions,
  normalizeStaffTrainingGaps,
  normalizeCarePointsAverage,
  withCarePointsTrend,
  normalizeOccupancySnapshot,
  normalizeResidentAge,
  computeActivityPatternRisk,
  withTrend,
  trendArrow,
};
