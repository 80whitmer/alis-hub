/**
 * Normalizes raw ALIS export-API responses into the KPI set used for
 * QBR/MBR reporting, and diffs them against an ALIS 500 benchmark snapshot.
 *
 * The export API's full field-level response schemas weren't retrievable
 * unauthenticated (the public OpenAPI doc truncates past $ref). Every
 * extractor below reads through `firstDefined()` with a few plausible
 * candidate field names rather than a single hardcoded one, and logs when
 * none match — adjust the candidate lists here once the first live pull
 * shows the real field names.
 */

/** Return the first defined, non-null value for any of `keys` on `obj`. */
function firstDefined(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function warnUnmatched(context, keys) {
  console.warn(`[kpiNormalizer] Could not find any of [${keys.join(', ')}] on a ${context} record — check server/services/alisApiClient.js response shape.`);
}

/**
 * Several export endpoints (incidents, leaves) have no server-side date
 * query param at all — they return their full history. Filter client-side
 * by whichever of `dateKeys` is present, or an unscoped period would pull
 * in incidents/leaves from outside the requested window and badly inflate
 * any per-1000-resident-days rate.
 */
function filterByDateRange(rows, dateKeys, periodStart, periodEnd) {
  if (!Array.isArray(rows)) return rows;
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return rows;

  return rows.filter((r) => {
    const raw = firstDefined(r, dateKeys);
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return !Number.isNaN(t) && t >= start && t <= end;
  });
}

// ── Occupancy ────────────────────────────────────────────────────────────

/**
 * hqOccupancies returns one row per room per day, with `dataSet` telling
 * you whether that room-day was "Occupied", "Vacant", or "Budget" (budget
 * rows are a forecast figure, not an actual state, and are excluded).
 * Occupancy % = occupied room-days / (occupied + vacant) room-days.
 * `occupiedRoomDays` doubles as a real resident-days figure for the
 * per-1000-resident-days rate calcs elsewhere — no need to estimate it
 * from an average census when we already have the room-day-level data.
 */
function normalizeOccupancy(rawRows = []) {
  const relevant = rawRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');
  if (relevant.length === 0) return { pct: null, occupiedRoomDays: null, totalRoomDays: null, byCommunity: [] };

  const byCommunity = {};
  for (const r of relevant) {
    const cid = r.communityId ?? 'unknown';
    byCommunity[cid] = byCommunity[cid] || { occupied: 0, total: 0 };
    byCommunity[cid].total++;
    if (r.dataSet === 'Occupied') byCommunity[cid].occupied++;
  }

  const totalOccupied = Object.values(byCommunity).reduce((s, c) => s + c.occupied, 0);
  const totalRoomDays = Object.values(byCommunity).reduce((s, c) => s + c.total, 0);

  return {
    pct: totalRoomDays ? totalOccupied / totalRoomDays : null,
    occupiedRoomDays: totalOccupied,
    totalRoomDays,
    byCommunity: Object.entries(byCommunity).map(([communityId, c]) => ({
      communityId,
      pct: c.total ? c.occupied / c.total : null,
    })),
  };
}

// ── Resident demographics ────────────────────────────────────────────────

function ageBucket(age) {
  if (age == null) return null;
  if (age >= 90) return '90+';
  if (age >= 80) return '80-90';
  if (age >= 70) return '70-80';
  return 'under70';
}

function normalizeDemographics(residents = []) {
  const total = residents.length;
  if (total === 0) return { totalResidents: 0, avgAge: null, ageBuckets: {}, genderSplit: {}, careSettingSplit: {} };

  const buckets = { '90+': 0, '80-90': 0, '70-80': 0, under70: 0 };
  const gender = { female: 0, male: 0, notReported: 0 };
  const careSetting = { AL: 0, MC: 0, other: 0 };
  let ageSum = 0;
  let ageCount = 0;

  for (const r of residents) {
    const age = firstDefined(r, ['age', 'currentAge', 'ageAtAdmission']);
    if (typeof age === 'number') {
      ageSum += age;
      ageCount++;
      const b = ageBucket(age);
      if (b) buckets[b]++;
    }

    const g = (firstDefined(r, ['gender', 'sex']) || '').toString().toLowerCase();
    if (g.startsWith('f')) gender.female++;
    else if (g.startsWith('m')) gender.male++;
    else gender.notReported++;

    const careType = (firstDefined(r, ['careType', 'productType', 'serviceType']) || '').toString().toLowerCase();
    if (careType.includes('memory')) careSetting.MC++;
    else if (careType.includes('assist')) careSetting.AL++;
    else careSetting.other++;
  }

  const pct = (n) => (total ? n / total : null);

  return {
    totalResidents: total,
    avgAge: ageCount ? ageSum / ageCount : null,
    ageBuckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, pct(v)])),
    genderSplit: Object.fromEntries(Object.entries(gender).map(([k, v]) => [k, pct(v)])),
    femaleToMaleRatio: gender.male ? gender.female / gender.male : null,
    careSettingSplit: Object.fromEntries(Object.entries(careSetting).map(([k, v]) => [k, pct(v)])),
  };
}

// ── Length of stay + move-out reasons ────────────────────────────────────

function daysBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000);
}

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Bucketed to match the three top-level categories the ALIS 500 benchmark
// reports move-out reasons under (health / life dynamics / quality of
// service) — real `moveOutReason` string values weren't confirmed from a
// live pull yet (every sample row we've seen had it null), so this is a
// best-effort keyword match pending real values to check against.
const MOVE_OUT_REASON_BUCKETS = {
  health: ['death', 'deceas', 'declin', 'improv', 'behavior'],
  lifeDynamics: ['relocat', 'discharg', 'respite', 'family'],
  qualityOfService: ['financ', 'competit', 'transfer', 'dissatisf', 'complaint'],
};

function bucketMoveOutReason(reason) {
  const r = (reason || '').toString().toLowerCase();
  for (const [bucket, keywords] of Object.entries(MOVE_OUT_REASON_BUCKETS)) {
    if (keywords.some((k) => r.includes(k))) return bucket;
  }
  return 'unknown';
}

function normalizeLengthOfStayAndMoveOuts(moveInOutRows = []) {
  const stays = moveInOutRows
    .map((r) => {
      const moveIn = firstDefined(r, ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate']);
      const moveOut = firstDefined(r, ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate', 'dischargeDate']);
      const reason = firstDefined(r, ['moveOutReason', 'moveOutReasonCategory', 'reason']);
      if (!moveIn || !moveOut) return null;
      const los = daysBetween(moveIn, moveOut);
      return los == null ? null : { los, reason };
    })
    .filter(Boolean);

  if (stays.length === 0) {
    return { avgDays: null, medianDays: null, moveOutWithin: {}, moveOutReasons: {}, moveOutReasonBuckets: {}, totalMoveOuts: 0 };
  }

  const losValues = stays.map((s) => s.los);
  const avgDays = losValues.reduce((a, b) => a + b, 0) / losValues.length;
  const medianDays = median(losValues);

  const within = (days) => stays.filter((s) => s.los <= days).length / stays.length;

  const reasonCounts = {};
  const bucketCounts = {};
  for (const s of stays) {
    const key = (s.reason || 'unknown').toString().toLowerCase();
    reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    const bucket = bucketMoveOutReason(s.reason);
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
  }
  const moveOutReasons = Object.fromEntries(
    Object.entries(reasonCounts).map(([k, v]) => [k, v / stays.length])
  );
  const moveOutReasonBuckets = Object.fromEntries(
    Object.entries(bucketCounts).map(([k, v]) => [k, v / stays.length])
  );

  return {
    avgDays,
    medianDays,
    moveOutWithin: { '3mo': within(90), '6mo': within(180), '12mo': within(365) },
    moveOutReasons,
    moveOutReasonBuckets,
    totalMoveOuts: stays.length,
  };
}

// ── Falls (incidents) ─────────────────────────────────────────────────────

function normalizeFalls(incidentRows = [], residentDays) {
  const falls = incidentRows.filter((r) => {
    const type = (firstDefined(r, ['incidentType', 'type', 'category']) || '').toString().toLowerCase();
    return type.includes('fall');
  });

  return {
    total: falls.length,
    per1000ResidentDays: residentDays ? (falls.length / residentDays) * 1000 : null,
  };
}

// ── Hospital / SNF visits (leaves) ───────────────────────────────────────

function normalizeHospitalVisits(leaveRows = [], residentDays) {
  const visits = leaveRows.filter((r) => {
    const type = (firstDefined(r, ['leaveType', 'type']) || '').toString().toLowerCase();
    return type.includes('hospital') || type.includes('snf') || type.includes('skilled');
  });

  const stays = visits
    .map((r) => {
      const start = firstDefined(r, ['startDate', 'leaveStartDate']);
      const end = firstDefined(r, ['endDate', 'leaveEndDate', 'returnDate']);
      return start && end ? daysBetween(start, end) : null;
    })
    .filter((d) => d != null);

  return {
    total: visits.length,
    per1000ResidentDays: residentDays ? (visits.length / residentDays) * 1000 : null,
    avgLengthOfStayDays: stays.length ? stays.reduce((a, b) => a + b, 0) / stays.length : null,
    medianLengthOfStayDays: median(stays),
  };
}

// ── Diagnoses ─────────────────────────────────────────────────────────────

/**
 * diagnosesAndAllergies returns one row per resident with free-text
 * `primaryDiagnoses`/`secondaryDiagnoses` strings (e.g. "HTN; GERD; OA"),
 * not per-category rows — so this is keyword matching against that text,
 * not a field lookup. Category keys match alis500-benchmarks-*.json's
 * `clinical.diagnosisPrevalence` keys so the two can be diffed directly.
 */
const DIAGNOSIS_KEYWORDS = {
  cerebrovascular: ['stroke', 'cva', 'tia', 'cerebrovascular'],
  neurodegenerative: ['dementia', 'alzheimer', 'parkinson', 'cognitive impairment'],
  hypertensive: ['hypertension', 'htn', 'hypotension'],
  cardiovascular: ['heart failure', 'chf', 'arrhythmia', 'afib', 'atrial fibrillation', 'cad', 'angina', 'dvt', 'cardiovascular'],
  lipidDisorders: ['hyperlipidemia', 'lipid'],
  musculoskeletal: ['osteoarthrit', 'osteoporosis', 'osteopenia', ' oa;', ' oa,', ' oa.'],
  moodDisorders: ['depress', 'bipolar'],
  anxietyDisorders: ['anxiety', 'gad', 'panic', 'ptsd'],
  sleepDisorders: ['insomnia', 'sleep apnea'],
  diabetes: ['diabet', ' dm;', ' dm,', ' dm.'],
  thyroidDisorders: ['thyroid'],
  gerd: ['gerd', 'acid reflux', 'reflux'],
  colorectalDiseases: ['diverticul', 'irritable bowel', ' ibs', 'colon cancer', 'colorectal'],
  kidneyFailure: ['kidney', 'renal failure', 'ckd'],
  obstructiveLung: ['copd', 'emphysema', 'asthma'],
  anemia: ['anemia'],
};

function normalizeDiagnoses(residentRows = [], totalResidents) {
  if (!totalResidents) return {};
  const counts = {};
  for (const r of residentRows) {
    const text = [
      firstDefined(r, ['primaryDiagnoses', 'primaryDiagnosis']),
      firstDefined(r, ['secondaryDiagnoses', 'secondaryDiagnosis']),
    ].filter(Boolean).join('; ').toLowerCase();
    if (!text) continue;

    for (const [category, keywords] of Object.entries(DIAGNOSIS_KEYWORDS)) {
      if (keywords.some((k) => text.includes(k))) {
        counts[category] = (counts[category] || 0) + 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / totalResidents]));
}

// ── Staff activity ────────────────────────────────────────────────────────

/**
 * /v1/export/staff (one account-wide call, no per-community loop needed)
 * gives one row per staff member with isActive/isLoginEnabled and a single
 * `loginTime` (their most recent login, not a login history). This is a
 * snapshot as of when the job runs, not scoped to periodStart/periodEnd
 * the way the other KPIs are — there's no way to ask "who logged in
 * during Q2" from this field alone, only "who has logged in recently."
 * activeStaffCount vs. residentCensus is a rough staffing-intensity
 * comparison, not a validated industry ratio.
 */
function normalizeStaffActivity(staffRows = [], { recencyDays = 30, referenceDate, residentCensus } = {}) {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const enabled = staffRows.filter((r) => r.isActive && r.isLoginEnabled);
  if (enabled.length === 0) {
    return { totalEnabledStaff: 0, activeInWindow: 0, pct: null, neverLoggedIn: 0, staffToCensusRatio: null };
  }

  let activeInWindow = 0;
  let neverLoggedIn = 0;
  for (const r of enabled) {
    const loginTime = firstDefined(r, ['loginTime', 'lastLoginTime', 'lastLogin']);
    if (!loginTime) {
      neverLoggedIn++;
      continue;
    }
    const daysAgo = (ref.getTime() - new Date(loginTime).getTime()) / 86400000;
    if (daysAgo >= -1 && daysAgo <= recencyDays) activeInWindow++;
  }

  return {
    totalEnabledStaff: enabled.length,
    activeInWindow,
    pct: activeInWindow / enabled.length,
    neverLoggedIn,
    staffToCensusRatio: residentCensus ? activeInWindow / residentCensus : null,
  };
}

// ── Care task completion ──────────────────────────────────────────────────

/**
 * scheduledCareTasks (Integration: Care) has no date-range param — the
 * caller pulls one day at a time and passes in compact per-day summaries
 * here rather than raw task rows, since a full quarter is ~90 calls
 * returning ~700-800 tasks each (way too much to hold as raw JSON).
 * `taskStatus` = whether the task has been recorded yet (1) vs. still
 * pending (0); `outcome` = the actual result ("1"→Completed per
 * outcomeOptions). % delivered = completed / recorded, not / all tasks.
 */
function normalizeCareCompletion(dailySummaries = []) {
  const total = dailySummaries.reduce((s, d) => s + d.total, 0);
  const completed = dailySummaries.reduce((s, d) => s + d.completed, 0);
  return {
    pct: total ? completed / total : null,
    totalRecorded: total,
    completed,
    daysSampled: dailySummaries.length,
  };
}

// ── PRN administration ───────────────────────────────────────────────────

const PRN_CATEGORY_MAP = {
  analgesic: 'analgesics',
  sedative: 'sedativesAntipsychotics',
  antipsychotic: 'sedativesAntipsychotics',
  gi: 'gastrointestinal',
  gastrointestinal: 'gastrointestinal',
  respiratory: 'respiratory',
  sleep: 'sleep',
  relax: 'muscleRelaxants',
  muscle: 'muscleRelaxants',
};

function normalizePrnAdministration(recordedCareRows = [], residentDays) {
  const counts = {};
  for (const r of recordedCareRows) {
    const isPrn = firstDefined(r, ['isPrn', 'prn', 'careType']);
    const looksLikePrn = isPrn === true || (typeof isPrn === 'string' && isPrn.toLowerCase().includes('prn'));
    if (!looksLikePrn) continue;

    const categoryRaw = (firstDefined(r, ['medicationCategory', 'careItemCategory', 'category']) || 'other').toString().toLowerCase();
    const matchedKey = Object.keys(PRN_CATEGORY_MAP).find((k) => categoryRaw.includes(k));
    const bucket = matchedKey ? PRN_CATEGORY_MAP[matchedKey] : 'other';
    counts[bucket] = (counts[bucket] || 0) + 1;
  }

  if (!residentDays) return counts;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / residentDays) * 1000]));
}

/**
 * Estimate resident-days for a period from a census/demographics snapshot.
 * Falls back to (avg census * days in period) — a reasonable approximation
 * when the API doesn't expose a direct resident-day figure.
 */
function estimateResidentDays({ avgCensus, periodStart, periodEnd }) {
  if (!avgCensus || !periodStart || !periodEnd) return null;
  const days = daysBetween(periodStart, periodEnd);
  return days ? avgCensus * days : null;
}

// ── Benchmark diffing ────────────────────────────────────────────────────

function diffMetric(actual, benchmark, { higherIsBetter = true } = {}) {
  if (actual == null || benchmark == null) return null;
  const delta = actual - benchmark;
  const better = higherIsBetter ? delta >= 0 : delta <= 0;
  return { actual, benchmark, delta, better };
}

function computeBenchmarkDiffs(normalized, benchmark) {
  const occ = benchmark.occupancy;
  const clin = benchmark.clinical;

  return {
    occupancyPct: diffMetric(normalized.occupancy?.pct, occ.referenceOccupancyPct / 100, { higherIsBetter: true }),
    medianLosDays: diffMetric(normalized.lengthOfStay?.medianDays, occ.lengthOfStay.medianDays, { higherIsBetter: true }),
    moveOutWithin12mo: diffMetric(normalized.lengthOfStay?.moveOutWithin?.['12mo'], occ.lengthOfStay.moveOutWithin['12mo'], { higherIsBetter: false }),
    qualityOfServiceMoveOutShare: diffMetric(normalized.lengthOfStay?.moveOutReasonBuckets?.qualityOfService, occ.moveOutReasons.qualityOfService, { higherIsBetter: false }),
    fallsPer1000ResidentDays: diffMetric(normalized.falls?.per1000ResidentDays, clin.falls.per1000ResidentDays, { higherIsBetter: false }),
    hospitalVisitsPer1000ResidentDays: diffMetric(normalized.hospitalVisits?.per1000ResidentDays, clin.hospitalVisits.per1000ResidentDays, { higherIsBetter: false }),
    sedativePrnPer1000ResidentDays: diffMetric(normalized.prnAdministration?.sedativesAntipsychotics, clin.prnAdministrationPer1000ResidentDays.sedativesAntipsychotics, { higherIsBetter: false }),
  };
}

module.exports = {
  normalizeOccupancy,
  normalizeDemographics,
  normalizeLengthOfStayAndMoveOuts,
  normalizeFalls,
  normalizeHospitalVisits,
  normalizeDiagnoses,
  normalizeCareCompletion,
  normalizeStaffActivity,
  normalizePrnAdministration,
  estimateResidentDays,
  computeBenchmarkDiffs,
  filterByDateRange,
};
