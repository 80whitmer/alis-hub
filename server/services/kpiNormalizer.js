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

// ── Occupancy ────────────────────────────────────────────────────────────

function normalizeOccupancy(rawRows = []) {
  if (rawRows.length === 0) return { pct: null, census: null, capacity: null, byCommunity: [] };

  const byCommunity = rawRows.map((row) => {
    const census = firstDefined(row, ['census', 'currentCensus', 'occupiedUnits']);
    const capacity = firstDefined(row, ['capacity', 'licensedCapacity', 'physicalCapacity', 'totalUnits']);
    if (census === undefined || capacity === undefined) warnUnmatched('hqOccupancies', ['census/currentCensus', 'capacity/licensedCapacity']);
    return {
      communityId: firstDefined(row, ['communityId', 'communityID']),
      communityName: firstDefined(row, ['communityName', 'name']),
      census: census ?? null,
      capacity: capacity ?? null,
      pct: census != null && capacity ? census / capacity : null,
    };
  });

  const totalCensus = byCommunity.reduce((s, c) => s + (c.census || 0), 0);
  const totalCapacity = byCommunity.reduce((s, c) => s + (c.capacity || 0), 0);

  return {
    pct: totalCapacity ? totalCensus / totalCapacity : null,
    census: totalCensus,
    capacity: totalCapacity,
    byCommunity,
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

function normalizeLengthOfStayAndMoveOuts(moveInOutRows = []) {
  const stays = moveInOutRows
    .map((r) => {
      const moveIn = firstDefined(r, ['moveInDate', 'admissionDate']);
      const moveOut = firstDefined(r, ['moveOutDate', 'dischargeDate']);
      const reason = firstDefined(r, ['moveOutReason', 'moveOutReasonCategory', 'reason']);
      if (!moveIn || !moveOut) return null;
      const los = daysBetween(moveIn, moveOut);
      return los == null ? null : { los, reason };
    })
    .filter(Boolean);

  if (stays.length === 0) {
    return { avgDays: null, medianDays: null, moveOutWithin: {}, moveOutReasons: {}, totalMoveOuts: 0 };
  }

  const losValues = stays.map((s) => s.los);
  const avgDays = losValues.reduce((a, b) => a + b, 0) / losValues.length;
  const medianDays = median(losValues);

  const within = (days) => stays.filter((s) => s.los <= days).length / stays.length;

  const reasonCounts = {};
  for (const s of stays) {
    const key = (s.reason || 'unknown').toString().toLowerCase();
    reasonCounts[key] = (reasonCounts[key] || 0) + 1;
  }
  const moveOutReasons = Object.fromEntries(
    Object.entries(reasonCounts).map(([k, v]) => [k, v / stays.length])
  );

  return {
    avgDays,
    medianDays,
    moveOutWithin: { '3mo': within(90), '6mo': within(180), '12mo': within(365) },
    moveOutReasons,
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

function normalizeDiagnoses(diagnosisRows = [], totalResidents) {
  if (!totalResidents) return {};
  const counts = {};
  for (const r of diagnosisRows) {
    const category = firstDefined(r, ['diagnosisCategory', 'category', 'diagnosisCode']);
    if (!category) continue;
    const key = category.toString().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / totalResidents]));
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
    qualityOfServiceMoveOutShare: diffMetric(normalized.lengthOfStay?.moveOutReasons?.qos, occ.moveOutReasons.qualityOfService, { higherIsBetter: false }),
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
  normalizePrnAdministration,
  estimateResidentDays,
  computeBenchmarkDiffs,
};
