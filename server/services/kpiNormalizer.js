/**
 * Normalizes raw ALIS export-API responses into the KPI set used for
 * QBR/MBR reporting, and diffs them against an ALIS 500 benchmark snapshot.
 *
 * Real field names for every export endpoint are in
 * server/services/ALIS_EXPORT_API_REFERENCE.md — check there first. Every
 * extractor below still reads through `firstDefined()` with a few plausible
 * candidate field names rather than a single hardcoded one (and logs when
 * none match) as a safety net against the API changing field names or
 * casing, not because the schema is unknown.
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

  // Every row missing every candidate date key means the field names are
  // wrong (an API shape change, most likely) — not "nothing happened this
  // period". That distinction previously went unlogged: normalizeHospitalVisits
  // silently returned zero on every job for months because the date keys
  // it filtered on didn't exist on the real leave rows.
  if (rows.length > 0 && rows.every((r) => firstDefined(r, dateKeys) === undefined)) {
    warnUnmatched('date-filtered row', dateKeys);
  }

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
 *
 * hasOccupancyData mirrors hasBillingData/hasEvaluationData elsewhere in
 * this file — some accounts simply don't populate ALIS's floor-plan/room
 * module at all (confirmed live against a real account: every getOccupancy
 * call succeeds, just returns zero rows, for every month tried). Without
 * this flag the dashboard showed a bare "—" that read as broken rather
 * than "not tracked here." A genuine API failure (as opposed to real,
 * confirmed-empty data) is a different signal — see kpiExport.js's
 * occupancyErrors → dataWarnings, which surfaces separately.
 */
/**
 * `pct`/`occupiedRoomDays` deliberately still count every occupied room-day,
 * matching ALIS's own floor-plan/occupancy report exactly — a client
 * ticket (Artegan, confirmed live) already flagged occupancy/resident-days
 * inflation from "fake" (never-billed, typically test) resident profiles,
 * and quietly changing the headline occupancy figure here would just trade
 * that trust problem for a new "doesn't match ALIS's own dashboard" one.
 *
 * Instead, when `billedResidentIds` is provided (built in kpiExport.js from
 * the same recurringCharges/invoiceCharges rows already pulled — per client
 * guidance that an unbilled resident profile is typically a fake one),
 * `billedOccupiedRoomDays` gives a second, adjusted resident-days figure
 * with those residents' room-days excluded — used only for the
 * per-1,000-resident-days clinical rates (falls/hospital/PRN in
 * kpiExport.js), which is where that ticket's actual complaint was: an
 * inflated denominator understating those rates, not the occupancy % itself.
 * `null` (not 0) when there's no billing data to check against at all —
 * some accounts genuinely don't run billing through ALIS, and treating
 * "can't tell" as "everyone's unbilled" would zero out the rate KPIs for
 * every one of them.
 */
function normalizeOccupancy(rawRows = [], { billedResidentIds } = {}) {
  const relevant = rawRows.filter((r) => r.dataSet === 'Occupied' || r.dataSet === 'Vacant');
  if (relevant.length === 0) return { hasOccupancyData: rawRows.length > 0, pct: null, occupiedRoomDays: null, totalRoomDays: null, byCommunity: [], byProductType: [], byClassification: [], billedOccupiedRoomDays: null, unbilledResidentCount: null };

  const hasBillingSignal = billedResidentIds instanceof Set && billedResidentIds.size > 0;
  const unbilledResidents = new Set();

  // residentProductType/residentClassification are already present on every
  // hqOccupancies row (confirmed live, ALIS_EXPORT_API_REFERENCE.md) — this
  // just wasn't reading them yet. Same {occupied,total} bucket shape as
  // byCommunity below, mirroring normalizeLengthOfStayAndMoveOuts'
  // byProductType pattern (above) rather than inventing a new one.
  const byCommunity = {};
  const byProductType = {};
  const byClassification = {};
  let billedOccupied = 0;
  for (const r of relevant) {
    const cid = r.communityId ?? 'unknown';
    byCommunity[cid] = byCommunity[cid] || { occupied: 0, total: 0 };
    byCommunity[cid].total++;

    const productType = (firstDefined(r, ['residentProductType']) || 'Unspecified').toString().trim() || 'Unspecified';
    byProductType[productType] = byProductType[productType] || { occupied: 0, total: 0 };
    byProductType[productType].total++;

    const classification = (firstDefined(r, ['residentClassification']) || 'Unspecified').toString().trim() || 'Unspecified';
    byClassification[classification] = byClassification[classification] || { occupied: 0, total: 0 };
    byClassification[classification].total++;

    if (r.dataSet === 'Occupied') {
      byCommunity[cid].occupied++;
      byProductType[productType].occupied++;
      byClassification[classification].occupied++;
      const isBilled = !hasBillingSignal || billedResidentIds.has(String(r.residentId));
      if (isBilled) {
        billedOccupied++;
      } else {
        unbilledResidents.add(String(r.residentId));
      }
    }
  }

  const totalOccupied = Object.values(byCommunity).reduce((s, c) => s + c.occupied, 0);
  const totalRoomDays = Object.values(byCommunity).reduce((s, c) => s + c.total, 0);

  return {
    hasOccupancyData: true,
    pct: totalRoomDays ? totalOccupied / totalRoomDays : null,
    occupiedRoomDays: totalOccupied,
    totalRoomDays,
    billedOccupiedRoomDays: hasBillingSignal ? billedOccupied : null,
    unbilledResidentCount: hasBillingSignal ? unbilledResidents.size : null,
    byCommunity: Object.entries(byCommunity).map(([communityId, c]) => ({
      communityId,
      pct: c.total ? c.occupied / c.total : null,
      // Raw occupied/total counts, added alongside the existing `pct`
      // (Sep 2026, for the Community Revenue Snapshot job's Unit
      // Capacity/Total Occupied Units columns) — same shape byProductType/
      // byClassification below already expose; byCommunity just hadn't
      // needed them until now. Purely additive, existing callers reading
      // only `.pct` are unaffected.
      occupied: c.occupied,
      total: c.total,
    })),
    // pct here is each group's share of total CENSUS (occupied / total
    // occupied across every group) — a composition/mix percentage, not
    // that group's own fill rate (which would be c.occupied / c.total,
    // "what % of Memory Care rooms are occupied"). Aaron asked for the
    // former (2026-09-07): "what percentage are each of the product
    // types or classifications" of the whole. `total` (room count for
    // that group) is still returned as-is for the Occupied/Total column.
    byProductType: Object.entries(byProductType)
      .map(([productType, c]) => ({ productType, pct: totalOccupied ? c.occupied / totalOccupied : null, occupied: c.occupied, total: c.total }))
      .sort((a, b) => b.total - a.total),
    byClassification: Object.entries(byClassification)
      .map(([classification, c]) => ({ classification, pct: totalOccupied ? c.occupied / totalOccupied : null, occupied: c.occupied, total: c.total }))
      .sort((a, b) => b.total - a.total),
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

// ── Upcoming birthdays & decade milestones ───────────────────────────────

/** Resident `dob` is 'MM/DD/YYYY'; staff `dateOfBirth` is an ISO date-time. Returns a UTC Date (month/day only matters to callers here) or null if missing/unparseable. */
function parseBirthdate(raw) {
  if (!raw) return null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (mdy) {
    const [, m, d, y] = mdy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/**
 * The concrete Date `birthdate`'s month/day falls on within
 * [windowStart, windowEnd] (inclusive, UTC calendar days), or null if it
 * doesn't land in the window this year or next — checking both handles a
 * window that crosses a Dec 31 -> Jan 1 boundary without special-casing it.
 */
function nextBirthdayInWindow(birthdate, windowStart, windowEnd) {
  if (!birthdate) return null;
  const start = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate()));
  const end = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate()));
  for (const year of [start.getUTCFullYear(), end.getUTCFullYear()]) {
    const candidate = new Date(Date.UTC(year, birthdate.getUTCMonth(), birthdate.getUTCDate()));
    if (candidate >= start && candidate <= end) return candidate;
  }
  return null;
}

function personName(r, nameKeys) {
  return firstDefined(r, nameKeys) || [r.firstName, r.lastName].filter(Boolean).join(', ') || null;
}

/**
 * Residents/staff with a birthday landing in [windowStart, windowEnd].
 * Callers choose the window's meaning: kpiExport.js uses a forward-looking
 * ~90 days from periodEnd (a deliberate exception to every other QBR metric
 * being retrospective over the period just reviewed — there's no natural
 * "birthdays that happened last quarter" framing worth celebrating in a
 * deck delivered after the fact), wellnessExport.js uses the next 14 days
 * from weekEnding. Only active residents/staff are considered — a former
 * resident's or staff member's birthday isn't something to surface.
 * Decade-milestone flags (90/100/110...) are resident-only per the original
 * ask; staff birthdays don't carry a milestone flag. `dobCoverage` reports
 * how many active records actually have a birthdate on file, since staff
 * coverage in particular is partial (~1/3 of records in accounts checked so
 * far) and the UI needs to disclose that rather than imply completeness.
 */
function normalizeUpcomingBirthdays(residents = [], staff = [], { windowStart, windowEnd } = {}) {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const activeResidents = residents.filter((r) => r.isActiveResident);
  const activeStaff = staff.filter((r) => r.isActive);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      residents: [],
      staff: [],
      dobCoverage: {
        residents: { withDob: activeResidents.filter((r) => firstDefined(r, ['dob'])).length, total: activeResidents.length },
        staff: { withDob: activeStaff.filter((r) => firstDefined(r, ['dateOfBirth'])).length, total: activeStaff.length },
      },
    };
  }

  const residentHits = [];
  let residentsWithDob = 0;
  for (const r of activeResidents) {
    const birthdate = parseBirthdate(firstDefined(r, ['dob']));
    if (birthdate) residentsWithDob++;
    const hit = nextBirthdayInWindow(birthdate, start, end);
    if (!hit) continue;
    const turningAge = hit.getUTCFullYear() - birthdate.getUTCFullYear();
    residentHits.push({
      residentId: r.residentId,
      name: personName(r, ['fullName', 'residentName']),
      communityId: r.communityId,
      turningAge,
      birthdayDate: hit.toISOString().slice(0, 10),
      isDecadeMilestone: turningAge % 10 === 0,
      isMajorMilestone: turningAge >= 90 && turningAge % 10 === 0,
    });
  }
  residentHits.sort((a, b) => a.birthdayDate.localeCompare(b.birthdayDate));

  const staffHits = [];
  let staffWithDob = 0;
  for (const r of activeStaff) {
    const birthdate = parseBirthdate(firstDefined(r, ['dateOfBirth']));
    if (birthdate) staffWithDob++;
    const hit = nextBirthdayInWindow(birthdate, start, end);
    if (!hit) continue;
    staffHits.push({
      staffId: r.staffId,
      name: personName(r, ['fullName', 'staffName', 'name']),
      communityId: r.communityId,
      jobRole: firstDefined(r, ['jobRole', 'role', 'title']) || null,
      birthdayDate: hit.toISOString().slice(0, 10),
    });
  }
  staffHits.sort((a, b) => a.birthdayDate.localeCompare(b.birthdayDate));

  return {
    residents: residentHits,
    staff: staffHits,
    dobCoverage: {
      residents: { withDob: residentsWithDob, total: activeResidents.length },
      staff: { withDob: staffWithDob, total: activeStaff.length },
    },
  };
}

/** `windowEnd` for normalizeUpcomingBirthdays's forward-looking QBR window — see kpiExport.js's call site. */
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/** Shared by the portfolio rollup and every product-type/community cut below — same stats, different stay subsets. */
function computeLosStats(stays) {
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

/**
 * Rolls up LOS/move-out stats portfolio-wide, then cuts the same stats by
 * product type (residentProductType — IL/AL/MC/etc.) and by community, per
 * client feedback wanting LOS broken out by product type (not just a single
 * blended number) with community-level detail available for the ones who
 * want to drill further. `communities` (same {host,communityId,name,region}
 * shape normalizePpd/normalizeDso take) resolves a human-readable community
 * name instead of falling back to "Community <id>" everywhere.
 */
function normalizeLengthOfStayAndMoveOuts(moveInOutRows = [], { communities = [] } = {}) {
  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));

  const stays = moveInOutRows
    .map((r) => {
      const moveIn = firstDefined(r, ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate']);
      const moveOut = firstDefined(r, ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate', 'dischargeDate']);
      const reason = firstDefined(r, ['moveOutReason', 'moveOutReasonCategory', 'reason']);
      if (!moveIn || !moveOut) return null;
      const los = daysBetween(moveIn, moveOut);
      if (los == null) return null;

      const productType = (firstDefined(r, ['residentProductType', 'productType', 'productTypeReportingLabel']) || 'Unspecified').toString().trim() || 'Unspecified';
      const communityKey = r.communityId != null ? `${r._host}::${r.communityId}` : null;
      const meta = communityKey ? communityMeta.get(communityKey) : null;
      const communityName = meta?.name || firstDefined(r, ['communityName']) || (r.communityId != null ? `Community ${r.communityId}` : null);

      return { los, reason, productType, communityKey, communityId: r.communityId ?? null, host: r._host, communityName };
    })
    .filter(Boolean);

  const portfolio = computeLosStats(stays);

  const byProductTypeMap = new Map();
  for (const s of stays) {
    if (!byProductTypeMap.has(s.productType)) byProductTypeMap.set(s.productType, []);
    byProductTypeMap.get(s.productType).push(s);
  }
  const byProductType = Array.from(byProductTypeMap.entries())
    .map(([productType, subset]) => ({ productType, ...computeLosStats(subset) }))
    .sort((a, b) => b.totalMoveOuts - a.totalMoveOuts);

  // Stays with no communityId (shouldn't normally happen, but the API's
  // nullability contract allows it) are excluded from the community cut —
  // they're still counted in portfolio/byProductType above.
  const byCommunityMap = new Map();
  for (const s of stays) {
    if (!s.communityKey) continue;
    if (!byCommunityMap.has(s.communityKey)) {
      byCommunityMap.set(s.communityKey, { communityId: s.communityId, host: s.host, name: s.communityName, rows: [] });
    }
    byCommunityMap.get(s.communityKey).rows.push(s);
  }
  const byCommunity = Array.from(byCommunityMap.values())
    .map((c) => {
      const productTypeMap = new Map();
      for (const s of c.rows) {
        if (!productTypeMap.has(s.productType)) productTypeMap.set(s.productType, []);
        productTypeMap.get(s.productType).push(s);
      }
      const communityByProductType = Array.from(productTypeMap.entries())
        .map(([productType, subset]) => ({ productType, ...computeLosStats(subset) }))
        .sort((a, b) => b.totalMoveOuts - a.totalMoveOuts);

      return {
        communityId: c.communityId,
        host: c.host,
        name: c.name || `Community ${c.communityId}`,
        ...computeLosStats(c.rows),
        byProductType: communityByProductType,
      };
    })
    .sort((a, b) => b.totalMoveOuts - a.totalMoveOuts);

  return { ...portfolio, byProductType, byCommunity };
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

// ── Incident report completion ──────────────────────────────────────────

/**
 * `isComplete`/`status` reflect the incident record's own overall status,
 * but a real live pull shows records with isComplete:true that still carry
 * incompleteForms/incompleteTasks > 0 (the top-level status can close before
 * every sub-item does) — so "fully documented" is judged on the forms/tasks
 * counts, not just isComplete, per client feedback (Gallaher, 2026-09-01)
 * wanting visibility into incident reports whose documentation/interventions
 * were never finished, not just ones the system marked open/closed.
 */
function computeIncidentCompletionStats(rows) {
  const total = rows.length;
  if (total === 0) {
    return { total: 0, complete: 0, pctComplete: null, openItemCount: 0, totalIncompleteForms: 0, totalIncompleteTasks: 0 };
  }
  let openItemCount = 0;
  let totalIncompleteForms = 0;
  let totalIncompleteTasks = 0;
  for (const r of rows) {
    const incompleteForms = Number(r.incompleteForms) || 0;
    const incompleteTasks = Number(r.incompleteTasks) || 0;
    totalIncompleteForms += incompleteForms;
    totalIncompleteTasks += incompleteTasks;
    if (incompleteForms > 0 || incompleteTasks > 0) openItemCount++;
  }
  return {
    total,
    complete: total - openItemCount,
    pctComplete: (total - openItemCount) / total,
    openItemCount,
    totalIncompleteForms,
    totalIncompleteTasks,
  };
}

/**
 * Surfaces which incident reports still have open documentation —
 * unfinished forms (e.g. care plan updates) or tasks (e.g. the
 * post-fall intervention Maria flagged as required but easy to miss) —
 * broken out by community so a nurse/AM can work the open list per
 * building rather than combing the full incidents/leaves data manually.
 * `incidentRows` should already be scoped to the reporting period and the
 * job's requested communities (same `scopedIncidents` normalizeFalls uses).
 */
function normalizeIncidentCompletion(incidentRows = [], { communities = [] } = {}) {
  if (incidentRows.length === 0) {
    return { hasData: false, overall: computeIncidentCompletionStats([]), falls: computeIncidentCompletionStats([]), byCommunity: [], openItems: [] };
  }

  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const resolveCommunityName = (r) => {
    const key = r.communityId != null ? `${r._host}::${r.communityId}` : null;
    const meta = key ? communityMeta.get(key) : null;
    return meta?.name || firstDefined(r, ['communityName']) || (r.communityId != null ? `Community ${r.communityId}` : null);
  };

  const overall = computeIncidentCompletionStats(incidentRows);

  const fallRows = incidentRows.filter((r) => (firstDefined(r, ['incidentType', 'type', 'category']) || '').toString().toLowerCase().includes('fall'));
  const falls = computeIncidentCompletionStats(fallRows);

  const byCommunityMap = new Map();
  for (const r of incidentRows) {
    if (r.communityId == null) continue;
    const key = `${r._host}::${r.communityId}`;
    if (!byCommunityMap.has(key)) {
      byCommunityMap.set(key, { communityId: r.communityId, host: r._host, name: resolveCommunityName(r), rows: [] });
    }
    byCommunityMap.get(key).rows.push(r);
  }
  const byCommunity = Array.from(byCommunityMap.values())
    .map((c) => ({ communityId: c.communityId, host: c.host, name: c.name, ...computeIncidentCompletionStats(c.rows) }))
    .sort((a, b) => b.openItemCount - a.openItemCount);

  // The actionable worklist — oldest open item first, since that's the one
  // that's been sitting longest.
  const openItems = incidentRows
    .filter((r) => (Number(r.incompleteForms) || 0) > 0 || (Number(r.incompleteTasks) || 0) > 0)
    .map((r) => ({
      incidentId: r.incidentId ?? null,
      communityId: r.communityId ?? null,
      host: r._host,
      communityName: resolveCommunityName(r),
      residentName: firstDefined(r, ['residentFullName', 'residentName']) || null,
      incidentType: r.incidentType || null,
      incidentDateTime: r.incidentDateTime || null,
      incompleteForms: Number(r.incompleteForms) || 0,
      incompleteTasks: Number(r.incompleteTasks) || 0,
    }))
    .sort((a, b) => new Date(a.incidentDateTime || 0) - new Date(b.incidentDateTime || 0));

  return { hasData: true, overall, falls, byCommunity, openItems };
}

// ── Sentinel incidents (Leisure Care only — see companyFeatures.js) ──────

/**
 * Leisure Care's own ALIS incident-type configuration tags specific
 * high-severity variants with "Sentinel" in the type name — e.g.
 * "Elopement (Sentinel)", "Death (Unexpected) (Sentinel)", "\"Lost\" or
 * \"Missing\" or \"Eloped\" Resident (Sentinel)". Confirmed live (Sep 2026,
 * 11,025 incidents): 108 matched, spanning many different base incident
 * types — this is a cross-cutting severity tag Leisure Care applies to
 * their own incident-type list, not a single incident type of its own.
 * Matched on a bare "sentinel" substring (not "(Sentinel)" with parens) —
 * one real value ("Death (Unexpected) Sentinel") has no parens around the
 * word itself.
 *
 * No other client's incident-type list uses this convention (see
 * companyFeatures.js) — callers should gate calling this at all on
 * isSentinelIncidentTrackingEnabled(companyName), not rely on it merely
 * returning zero matches for other clients, since a coincidental
 * type-name match at another client would otherwise misreport.
 *
 * Returns the same shape as normalizeIncidentCompletion's byCommunity/items
 * pattern — a QBR/Wellness audience needs the actual list (resident,
 * incident type, date), not just a count, given how rare and high-severity
 * these are.
 */
function normalizeSentinelIncidents(incidentRows = [], { communities = [] } = {}) {
  const sentinelRows = incidentRows.filter((r) => (r.incidentType || '').toString().toLowerCase().includes('sentinel'));
  if (sentinelRows.length === 0) {
    return { hasData: true, total: 0, byCommunity: [], items: [] };
  }

  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const resolveCommunityName = (r) => {
    const key = r.communityId != null ? `${r._host}::${r.communityId}` : null;
    const meta = key ? communityMeta.get(key) : null;
    return meta?.name || firstDefined(r, ['communityName']) || (r.communityId != null ? `Community ${r.communityId}` : null);
  };

  const byCommunityMap = new Map();
  for (const r of sentinelRows) {
    if (r.communityId == null) continue;
    const key = `${r._host}::${r.communityId}`;
    if (!byCommunityMap.has(key)) {
      byCommunityMap.set(key, { communityId: r.communityId, host: r._host, name: resolveCommunityName(r), rows: [] });
    }
    byCommunityMap.get(key).rows.push(r);
  }
  const byCommunity = Array.from(byCommunityMap.values())
    .map((c) => ({ communityId: c.communityId, host: c.host, name: c.name, total: c.rows.length }))
    .sort((a, b) => b.total - a.total);

  const items = sentinelRows
    .map((r) => ({
      incidentId: r.incidentId ?? null,
      communityId: r.communityId ?? null,
      host: r._host,
      communityName: resolveCommunityName(r),
      residentName: firstDefined(r, ['residentFullName', 'residentName']) || null,
      incidentType: r.incidentType || null,
      incidentDateTime: r.incidentDateTime || null,
      isComplete: r.isComplete ?? null,
    }))
    .sort((a, b) => new Date(b.incidentDateTime || 0) - new Date(a.incidentDateTime || 0));

  return { hasData: true, total: sentinelRows.length, byCommunity, items };
}

// ── Hospital / SNF visits (leaves) ───────────────────────────────────────

function normalizeHospitalVisits(leaveRows = [], residentDays) {
  const DESTINATION_KEYS = ['leaveDestination', 'leaveType', 'type'];
  if (leaveRows.length > 0 && leaveRows.every((r) => firstDefined(r, DESTINATION_KEYS) === undefined)) {
    warnUnmatched('leave', DESTINATION_KEYS);
  }

  // leaveDestination is a free-text-ish field (real values seen: "Hospital",
  // "Skilled Nursing", "Rehabilitation Facility", "Vacation", "Holiday",
  // "Home") — "rehab" is included because a rehab-facility stay is almost
  // always a hospital discharge destination, the same clinical event this
  // KPI is meant to surface.
  const visits = leaveRows.filter((r) => {
    const destination = (firstDefined(r, DESTINATION_KEYS) || '').toString().toLowerCase();
    return destination.includes('hospital') || destination.includes('snf') || destination.includes('skilled') || destination.includes('rehab');
  });

  const stays = visits
    .map((r) => {
      const start = firstDefined(r, ['startDateTime', 'startDate', 'leaveStartDate']);
      // actualEndDateTime (when the resident really returned) beats
      // scheduledEndDateTime (the plan) when both are present.
      const end = firstDefined(r, ['actualEndDateTime', 'endDate', 'leaveEndDate', 'returnDate', 'scheduledEndDateTime']);
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
    return { totalEnabledStaff: 0, activeInWindow: 0, pct: null, neverLoggedIn: 0, staffToCensusRatio: null, inactive: [] };
  }

  let activeInWindow = 0;
  let neverLoggedIn = 0;
  // Every enabled staff member NOT active in the window — for the
  // Staffing section's exportable "who hasn't logged in" list. Kept
  // alongside (not instead of) the pct/count rollup above, same as
  // normalizeCareLevelEvaluations's `flagged` array.
  const inactive = [];
  for (const r of enabled) {
    const loginTime = firstDefined(r, ['loginTime', 'lastLoginTime', 'lastLogin']);
    const name = firstDefined(r, ['fullName', 'staffName', 'name']) || [r.firstName, r.lastName].filter(Boolean).join(', ') || null;
    const staffDetails = {
      staffId: r.staffId,
      name,
      communityId: r.communityId,
      host: r._host,
      jobRole: firstDefined(r, ['jobRole', 'role', 'title']) || null,
      hireDate: firstDefined(r, ['dateOfHire', 'hireDate']) || null,
      lastLogin: loginTime || null,
    };

    if (!loginTime) {
      neverLoggedIn++;
      inactive.push(staffDetails);
      continue;
    }
    const daysAgo = (ref.getTime() - new Date(loginTime).getTime()) / 86400000;
    if (daysAgo >= -1 && daysAgo <= recencyDays) {
      activeInWindow++;
    } else {
      inactive.push(staffDetails);
    }
  }

  return {
    totalEnabledStaff: enabled.length,
    activeInWindow,
    pct: activeInWindow / enabled.length,
    neverLoggedIn,
    staffToCensusRatio: residentCensus ? activeInWindow / residentCensus : null,
    inactive,
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

/**
 * PRN (as-needed) medication administrations per 1,000 resident-days —
 * an overall rate only, not broken down by drug class. `/v3/export/clinical/
 * orderAdministration` (see kpiExport.js) has no medication-class field, just
 * a free-text `orderName` (e.g. "HYDROCODONE-ACET 5MG-325MG TABLET") —
 * classifying that into sedative/analgesic/antipsychotic/etc. would mean
 * guessing at drug names, a clinical-accuracy call this normalizer
 * deliberately doesn't make. `rows` is expected to already be filtered to
 * isPrn === true (see kpiExport.js's per-community pull) — this just counts
 * and rate-normalizes.
 */
function normalizePrnAdministration(rows = [], residentDays) {
  const count = rows.length;
  return { overall: residentDays ? (count / residentDays) * 1000 : null, count };
}

/**
 * Month-by-month admissions (move-ins) and discharges (move-outs) across
 * the reporting period, each bucketed independently by its own date — NOT
 * the "moved out during this period" cohort normalizeLengthOfStayAndMoveOuts
 * uses above, since an admission with no discharge yet still needs to count
 * as an admission here.
 */
function normalizeAdmissionsDischarges(moveInOutRows = [], periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const monthKeys = [];
  // UTC-built cursor, not new Date(year, month, 1) off a UTC-parsed date —
  // on a host west of UTC that local constructor reads back the wrong
  // month at the boundary (e.g. a "2026-04-01" period start silently
  // becomes March), same bug that was in kpiExport.js's monthsInRange.
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    monthKeys.push(cursor.toISOString().slice(0, 7)); // 'YYYY-MM'
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const admissionsByMonth = Object.fromEntries(monthKeys.map((m) => [m, 0]));
  const dischargesByMonth = Object.fromEntries(monthKeys.map((m) => [m, 0]));

  for (const r of moveInOutRows) {
    const moveIn = firstDefined(r, ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate']);
    if (moveIn) {
      const t = new Date(moveIn);
      if (!Number.isNaN(t.getTime()) && t.getTime() >= startMs && t.getTime() <= endMs) {
        const key = t.toISOString().slice(0, 7);
        if (key in admissionsByMonth) admissionsByMonth[key]++;
      }
    }
    const moveOut = firstDefined(r, ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate', 'dischargeDate']);
    if (moveOut) {
      const t = new Date(moveOut);
      if (!Number.isNaN(t.getTime()) && t.getTime() >= startMs && t.getTime() <= endMs) {
        const key = t.toISOString().slice(0, 7);
        if (key in dischargesByMonth) dischargesByMonth[key]++;
      }
    }
  }

  const months = monthKeys.map((m, i) => {
    const admissions = admissionsByMonth[m];
    const discharges = dischargesByMonth[m];
    const prevKey = i > 0 ? monthKeys[i - 1] : null;
    const admissionsMomPct = prevKey && admissionsByMonth[prevKey] ? (admissions - admissionsByMonth[prevKey]) / admissionsByMonth[prevKey] : null;
    const dischargesMomPct = prevKey && dischargesByMonth[prevKey] ? (discharges - dischargesByMonth[prevKey]) / dischargesByMonth[prevKey] : null;
    return { month: m, admissions, discharges, net: admissions - discharges, admissionsMomPct, dischargesMomPct };
  });

  return {
    months,
    totalAdmissions: months.reduce((a, m) => a + m.admissions, 0),
    totalDischarges: months.reduce((a, m) => a + m.discharges, 0),
    netChange: months.reduce((a, m) => a + m.net, 0),
  };
}

const IL_PRODUCT_TYPES = ['il', 'independent'];

/**
 * Care-level evaluation compliance, excluding Independent Living residents
 * (a level-of-care evaluation has no meaning for a private-pay IL lease —
 * there's no care level to assess). For each remaining resident, looks at
 * their isMostCurrent evaluation row and buckets them as:
 *   - neverEvaluated: no evaluation row exists at all
 *   - expired:        ALIS itself flagged the current evaluation isExpired
 *   - incomplete:     the current evaluation isn't isCompleted
 *   - overdue:        completed, current, but its evaluationDate is more
 *                      than 12 months before `asOfIso` (the QBR period end,
 *                      not "today" — keeps a re-run of a past quarter
 *                      reproducible instead of drifting with the clock)
 * Checked in that order so one resident is never double-counted.
 */
function normalizeCareLevelEvaluations(evaluationRows = [], residentRows = [], asOfIso) {
  const nonIlResidents = residentRows.filter((r) => {
    const productType = (firstDefined(r, ['productType', 'residentProductType', 'careType']) || '').toString().toLowerCase();
    return !IL_PRODUCT_TYPES.some((il) => productType.includes(il));
  });

  // Whether this account has ANY evaluation records at all. Some accounts
  // don't use ALIS's care-level evaluation module — for them, every
  // resident would otherwise show as "neverEvaluated," reading as a 100%
  // compliance failure when the real answer is "not applicable here."
  const hasEvaluationData = evaluationRows.length > 0;

  if (nonIlResidents.length === 0) {
    return { hasEvaluationData, totalResidents: 0, expired: 0, incomplete: 0, overdue: 0, neverEvaluated: 0, needsAttention: 0, pctNeedsAttention: null, flagged: [], revenueLeakage: { affectedResidents: 0, totalMonthlyGap: 0, items: [] } };
  }

  const mostCurrentByResident = new Map();
  for (const e of evaluationRows) {
    if (!e.isMostCurrent) continue;
    mostCurrentByResident.set(String(firstDefined(e, ['residentId'])), e);
  }

  const cutoff = new Date(asOfIso);
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  let expired = 0, incomplete = 0, overdue = 0, neverEvaluated = 0;
  const flagged = [];

  // Revenue leakage: preOverrideFee is what the evaluation itself
  // recommended charging; fee is what's actually billed. When someone
  // overrides the fee DOWN from the evaluation's recommendation,
  // preOverrideFee > fee — a direct, ALIS-computed under-billing signal,
  // independent of whether the evaluation is otherwise compliant (a
  // resident can be fully up-to-date on paperwork and still billed below
  // what their own evaluation says they should be).
  let underbilledCount = 0;
  let totalMonthlyGap = 0;
  const underbilled = [];

  for (const resident of nonIlResidents) {
    const residentId = String(firstDefined(resident, ['residentId']));
    const name = firstDefined(resident, ['fullName', 'residentName', 'name']);
    const evalRow = mostCurrentByResident.get(residentId);

    if (evalRow) {
      const fee = Number(evalRow.fee);
      const preOverrideFee = Number(evalRow.preOverrideFee);
      if (!Number.isNaN(fee) && !Number.isNaN(preOverrideFee) && preOverrideFee > fee) {
        const gap = preOverrideFee - fee;
        underbilledCount++;
        totalMonthlyGap += gap;
        underbilled.push({ residentId, name, communityId: resident.communityId, currentFee: fee, recommendedFee: preOverrideFee, monthlyGap: gap, careLevel: evalRow.careLevel, preOverrideCareLevel: evalRow.preOverrideCareLevel });
      }
    }

    // Shared across every flagged reason below — the QBR dashboard's
    // "Residents needing attention" table/export needs the full picture
    // (community, current care level/fee/product type, move-in date), not
    // just why a resident was flagged. `host` rides along so the client can
    // key against `_host`::communityId the same way filterByCommunity does,
    // rather than risking a same-numbered community colliding across hosts.
    //
    // Care level/fee prefer the resident record's own careLevelName/
    // careLevelFee (the account's live, current billing state) over the
    // evaluation row's careLevel/fee — an expired or long-overdue evaluation
    // reflects what was true when it was completed, which can lag behind
    // where the resident actually sits today. Evaluation fields are only a
    // fallback for accounts whose residents export doesn't carry these.
    const currentFeeRaw = firstDefined(resident, ['careLevelFee', 'fee']);
    const currentFee = currentFeeRaw != null && !Number.isNaN(Number(currentFeeRaw)) ? Number(currentFeeRaw) : null;
    const evalFee = evalRow?.fee != null && !Number.isNaN(Number(evalRow.fee)) ? Number(evalRow.fee) : null;

    const commonDetails = {
      residentId,
      name,
      communityId: resident.communityId,
      host: resident._host,
      moveInDate: firstDefined(resident, ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate']) || null,
      productType: firstDefined(resident, ['productType', 'residentProductType', 'careType']) || null,
      careLevel: firstDefined(resident, ['careLevelName', 'careLevel']) ?? evalRow?.careLevel ?? null,
      fee: currentFee ?? evalFee,
      evaluationDate: evalRow?.evaluationDate ?? null,
      expirationDate: evalRow?.expirationDate ?? null,
    };

    if (!evalRow) {
      neverEvaluated++;
      flagged.push({ ...commonDetails, reason: 'neverEvaluated' });
      continue;
    }
    if (evalRow.isExpired) {
      expired++;
      flagged.push({ ...commonDetails, reason: 'expired' });
      continue;
    }
    if (!evalRow.isCompleted) {
      incomplete++;
      flagged.push({ ...commonDetails, reason: 'incomplete' });
      continue;
    }
    const evalDate = evalRow.evaluationDate ? new Date(evalRow.evaluationDate) : null;
    if (!evalDate || Number.isNaN(evalDate.getTime()) || evalDate < cutoff) {
      overdue++;
      flagged.push({ ...commonDetails, reason: 'overdue' });
    }
  }

  const needsAttention = expired + incomplete + overdue + neverEvaluated;

  return {
    hasEvaluationData,
    totalResidents: nonIlResidents.length,
    expired,
    incomplete,
    overdue,
    neverEvaluated,
    needsAttention,
    pctNeedsAttention: needsAttention / nonIlResidents.length,
    flagged,
    revenueLeakage: {
      affectedResidents: underbilledCount,
      totalMonthlyGap,
      items: underbilled,
    },
  };
}

// ── Recurring revenue (billing) ─────────────────────────────────────────

/**
 * Recurring-charge revenue for the period — rent, care-level fees, and
 * add-ons, scoped server-side via getRecurringCharges' serviceStartDate/
 * serviceEndDate params. This is the current active billing schedule, not
 * a historical invoice ledger (that's /v1/export/billing/invoiceCharges,
 * not yet wired up) — treat it as a revenue *run rate* for the period, not
 * a reconciled actuals figure.
 *
 * `quantity` is nullable on this endpoint — a flat monthly charge is
 * commonly recorded with quantity omitted rather than explicitly 1, so a
 * missing quantity defaults to 1 (one unit of the charge), while an
 * explicit 0 is left as a real zero (e.g. a comped line item).
 */
function normalizeRecurringRevenue(chargeRows = []) {
  let total = 0;
  let perDiemTotal = 0;
  let flatTotal = 0;
  const byPayerType = {};
  const byProductType = {};
  const residentIds = new Set();

  for (const r of chargeRows) {
    const unitPrice = Number(r.unitPrice) || 0;
    const quantity = r.quantity == null ? 1 : Number(r.quantity);
    const lineTotal = unitPrice * quantity;

    total += lineTotal;
    if (r.isPerDiem) perDiemTotal += lineTotal; else flatTotal += lineTotal;

    const payer = (r.payerType || 'Unknown').toString();
    byPayerType[payer] = (byPayerType[payer] || 0) + lineTotal;

    const product = (r.residentProductType || 'Unknown').toString();
    byProductType[product] = (byProductType[product] || 0) + lineTotal;

    if (r.residentId != null) residentIds.add(String(r.residentId));
  }

  return {
    // Whether this account has ANY recurring-charge records at all — not
    // the same as `total > 0`. An account that simply doesn't run its
    // billing through ALIS (some do it elsewhere) will always have zero
    // rows here; that's "not applicable," not "zero revenue," and callers
    // should hide this section rather than display a misleading $0.
    hasBillingData: chargeRows.length > 0,
    total,
    perDiemTotal,
    flatTotal,
    revenuePerResident: residentIds.size ? total / residentIds.size : null,
    residentsWithCharges: residentIds.size,
    byPayerType,
    byProductType,
  };
}

// ── Billed revenue (actual invoice line items) ──────────────────────────

/**
 * Actual billed revenue for the period, from real invoice line items
 * (server-side scoped via getInvoiceCharges' invoiceStartDate/
 * invoiceEndDate) — the preferred revenue figure over
 * normalizeRecurringRevenue's active-schedule run-rate, since this
 * reflects what was actually invoiced during the period rather than an
 * estimate from the current billing setup. Sums `amount` as-is (already
 * net of discounts per the API) rather than recomputing from
 * unitPrice*quantity.
 */
function normalizeInvoiceCharges(invoiceChargeRows = []) {
  let total = 0;
  const byPayerType = {};
  const byProductType = {};
  const residentIds = new Set();

  for (const r of invoiceChargeRows) {
    const amount = Number(r.amount) || 0;
    total += amount;

    const payer = (r.payerType || 'Unknown').toString();
    byPayerType[payer] = (byPayerType[payer] || 0) + amount;

    const product = (r.residentProductType || 'Unknown').toString();
    byProductType[product] = (byProductType[product] || 0) + amount;

    if (r.residentId != null) residentIds.add(String(r.residentId));
  }

  return {
    hasBillingData: invoiceChargeRows.length > 0,
    total,
    revenuePerResident: residentIds.size ? total / residentIds.size : null,
    residentsWithCharges: residentIds.size,
    byPayerType,
    byProductType,
  };
}

// ── Outstanding invoices (AR aging) ─────────────────────────────────────

/**
 * Accounts-receivable aging from outstanding invoices, as of `asOfIso`
 * (the QBR period end, same reproducibility convention as
 * normalizeCareLevelEvaluations — not "today", so re-running a past
 * quarter's numbers doesn't drift with the clock). Buckets by
 * invoiceDueDate, not invoiceDate, since aging is measured from when
 * payment was due, not when the invoice was issued.
 */
function normalizeOutstandingInvoices(invoiceRows = [], asOfIso) {
  const asOf = new Date(asOfIso).getTime();
  const outstanding = invoiceRows.filter((r) => Number(r.invoiceBalance) > 0);

  const aging = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  const byPayerType = {};

  for (const r of outstanding) {
    const balance = Number(r.invoiceBalance) || 0;
    const dueMs = r.invoiceDueDate ? new Date(r.invoiceDueDate).getTime() : NaN;
    const daysPastDue = Number.isNaN(dueMs) ? null : Math.floor((asOf - dueMs) / 86400000);

    if (daysPastDue == null || daysPastDue <= 0) aging.current += balance;
    else if (daysPastDue <= 30) aging.days1to30 += balance;
    else if (daysPastDue <= 60) aging.days31to60 += balance;
    else if (daysPastDue <= 90) aging.days61to90 += balance;
    else aging.days90plus += balance;

    const payer = (r.payerType || 'Unknown').toString();
    byPayerType[payer] = (byPayerType[payer] || 0) + balance;
  }

  const total = Object.values(aging).reduce((a, b) => a + b, 0);

  return {
    // Whether this account has ANY invoice records at all — checked
    // against the raw pull, not the balance>0 filtered set, since a real
    // AR position of $0 (everyone's paid up) is a genuinely good result
    // worth showing, not the same as "doesn't use ALIS billing at all."
    hasBillingData: invoiceRows.length > 0,
    total,
    invoiceCount: outstanding.length,
    aging,
    byPayerType,
  };
}

// ── Days Sales Outstanding (DSO) ─────────────────────────────────────────

/**
 * DSO = (AR balance ÷ Billed revenue) × Days. Standard formula — verified
 * against the client's own worked example (150,000 / 300,000 × 30 = 15).
 *
 * AR balance here is NOT a period-end snapshot: outstandingInvoices only
 * ever returns the balance as of right now (job run time) — there's no way
 * to ask ALIS what was outstanding at a past date. So both billed revenue
 * AND outstanding balance are bucketed by each invoice's own `invoiceDate`,
 * making "this month's DSO" read as "of what was billed in that month, how
 * much remains uncollected as of today" — a cohort figure, not a
 * point-in-time balance. That's a deliberate deviation from the textbook
 * definition, chosen because it's real data (not a fabricated historical
 * balance) and sums cleanly month → quarter → year and across
 * company/region/community/resident scopes.
 *
 * This is also the template for bringing Company/Region/Facility/Resident
 * rollups to other KPI sections (occupancy, staffing, etc.) later — see
 * CHANGELOG.md.
 */
function dsoBand(days) {
  if (days == null) return null;
  if (days <= 11) return 'green';
  if (days <= 30) return 'yellow';
  return 'red';
}

function dsoMonthKeysInRange(periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const monthKeys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    monthKeys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return monthKeys;
}

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function computeDso(billedRevenue, arBalance, days) {
  return billedRevenue > 0 ? (arBalance / billedRevenue) * days : null;
}

function bucketMonth(invoiceDate, monthKeys) {
  if (!invoiceDate) return null;
  const key = new Date(invoiceDate).toISOString().slice(0, 7);
  return monthKeys.includes(key) ? key : null;
}

function normalizeDso(invoiceChargeRows = [], outstandingInvoiceRows = [], { periodStart, periodEnd, communities = [] } = {}) {
  const hasBillingData = invoiceChargeRows.length > 0 || outstandingInvoiceRows.length > 0;
  if (!hasBillingData) {
    return { hasBillingData: false, portfolio: null, byRegion: [], byCommunity: [], byResident: [] };
  }

  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const monthKeys = dsoMonthKeysInRange(periodStart, periodEnd);
  // daysBetween is exclusive (moveIn→moveOut style elsewhere in this file)
  // — the DSO "Number of Days" needs an inclusive calendar count (e.g. 30
  // for periodStart='…-06-01'/periodEnd='…-06-30'), so +1.
  const rawPeriodDays = daysBetween(periodStart, periodEnd);
  const periodDays = rawPeriodDays != null ? rawPeriodDays + 1 : monthKeys.reduce((s, m) => s + daysInMonth(m), 0);

  function newScope(extra = {}) {
    return { ...extra, billedRevenue: 0, arBalance: 0, byMonth: Object.fromEntries(monthKeys.map((m) => [m, { billedRevenue: 0, arBalance: 0 }])) };
  }

  const portfolio = newScope();
  const regions = new Map();      // region name -> scope
  const communityScopes = new Map(); // `${host}::${communityId}` -> scope
  const residentScopes = new Map();  // `${host}::${residentId}` -> scope

  function resolveScopes(row) {
    const communityKey = `${row._host}::${row.communityId}`;
    const meta = communityMeta.get(communityKey);
    const regionName = meta?.region || 'Unassigned';
    if (!regions.has(regionName)) regions.set(regionName, newScope({ region: regionName }));
    if (!communityScopes.has(communityKey)) {
      communityScopes.set(communityKey, newScope({
        communityId: row.communityId,
        host: row._host,
        name: meta?.name || firstDefined(row, ['communityName']) || `Community ${row.communityId}`,
        region: meta?.region || null,
      }));
    }
    const residentId = firstDefined(row, ['residentId']);
    const residentKey = residentId != null ? `${row._host}::${residentId}` : null;
    if (residentKey && !residentScopes.has(residentKey)) {
      residentScopes.set(residentKey, newScope({
        residentId,
        communityId: row.communityId,
        host: row._host,
        name: firstDefined(row, ['residentFullName', 'residentName']) || null,
      }));
    }
    return {
      regionScope: regions.get(regionName),
      communityScope: communityScopes.get(communityKey),
      residentScope: residentKey ? residentScopes.get(residentKey) : null,
    };
  }

  function apply(scope, monthKey, field, amount) {
    if (!scope || !amount) return;
    scope[field] += amount;
    if (monthKey && scope.byMonth[monthKey]) scope.byMonth[monthKey][field] += amount;
  }

  for (const row of invoiceChargeRows) {
    const amount = Number(row.amount) || 0;
    if (!amount) continue;
    const monthKey = bucketMonth(firstDefined(row, ['invoiceDate']), monthKeys);
    const { regionScope, communityScope, residentScope } = resolveScopes(row);
    apply(portfolio, monthKey, 'billedRevenue', amount);
    apply(regionScope, monthKey, 'billedRevenue', amount);
    apply(communityScope, monthKey, 'billedRevenue', amount);
    apply(residentScope, monthKey, 'billedRevenue', amount);
  }

  // Same balance>0 filter normalizeOutstandingInvoices uses — a fully-paid
  // invoice shouldn't count as AR just because it once existed.
  for (const row of outstandingInvoiceRows.filter((r) => Number(r.invoiceBalance) > 0)) {
    const balance = Number(row.invoiceBalance) || 0;
    const monthKey = bucketMonth(firstDefined(row, ['invoiceDate']), monthKeys);
    const { regionScope, communityScope, residentScope } = resolveScopes(row);
    apply(portfolio, monthKey, 'arBalance', balance);
    apply(regionScope, monthKey, 'arBalance', balance);
    apply(communityScope, monthKey, 'arBalance', balance);
    apply(residentScope, monthKey, 'arBalance', balance);
  }

  function finalize(scope, extra = {}) {
    const dso = computeDso(scope.billedRevenue, scope.arBalance, periodDays);
    return {
      ...extra,
      billedRevenue: scope.billedRevenue,
      arBalance: scope.arBalance,
      dsoDays: dso,
      band: dsoBand(dso),
      monthly: monthKeys.map((m) => {
        const b = scope.byMonth[m];
        const monthDso = computeDso(b.billedRevenue, b.arBalance, daysInMonth(m));
        return { month: m, billedRevenue: b.billedRevenue, arBalance: b.arBalance, dsoDays: monthDso, band: dsoBand(monthDso) };
      }),
    };
  }

  const byDsoDesc = (a, b) => (b.dsoDays ?? -1) - (a.dsoDays ?? -1);

  return {
    hasBillingData: true,
    portfolio: finalize(portfolio),
    byRegion: Array.from(regions.values()).map((s) => finalize(s, { region: s.region })).sort(byDsoDesc),
    byCommunity: Array.from(communityScopes.values())
      .map((s) => finalize(s, { communityId: s.communityId, host: s.host, name: s.name, region: s.region }))
      .sort(byDsoDesc),
    // Only residents currently carrying a balance, worst-first — same
    // "flagged list" shape as normalizeStaffActivity's `inactive` and
    // normalizeCareLevelEvaluations' `flagged`, not every resident.
    byResident: Array.from(residentScopes.values())
      .filter((s) => s.arBalance > 0)
      .map((s) => {
        const dso = computeDso(s.billedRevenue, s.arBalance, periodDays);
        return { residentId: s.residentId, communityId: s.communityId, host: s.host, name: s.name, billedRevenue: s.billedRevenue, arBalance: s.arBalance, dsoDays: dso, band: dsoBand(dso) };
      })
      .sort(byDsoDesc),
  };
}

// ── PPD (revenue per occupied/census day) ────────────────────────────────

/**
 * "PPD" (Per Patient/Person Day) — a standard senior-living finance yield
 * metric: billed revenue divided by a day-count denominator, tracked
 * month over month. Two denominators, both real and independently
 * meaningful (confirmed against a live account's raw hqOccupancies rows,
 * not assumed):
 *   - occupiedDays: unit/bed-days where dataSet==='Occupied' — the
 *     billable/financial occupancy figure normalizeOccupancy already
 *     computes as `occupiedRoomDays`.
 *   - censusDays: the same population further filtered to censusOcc===1
 *     — a resident physically on premises that day. Confirmed live: this
 *     is a strict subset of occupiedDays (every censusDays row is also an
 *     occupied-day row, but ~2% of occupied-days have censusOcc===0 — a
 *     unit held/billed while the resident is on a hospital stay or leave
 *     of absence, not physically there). Same billable-vs-physical
 *     distinction as physicalMoveInDate/financialMoveInDate elsewhere in
 *     this file, just for day-level occupancy instead of move dates.
 *
 * Unlike DSO, PPD needs no cohort workaround — billed revenue and
 * occupancy/census days are both real, dated data for every month in the
 * period (no "AR is only a snapshot" problem), so monthly figures are
 * exact, not an approximation.
 */
function normalizePpd(invoiceChargeRows = [], occupancyRows = [], { periodStart, periodEnd, communities = [] } = {}) {
  const hasData = invoiceChargeRows.length > 0 || occupancyRows.length > 0;
  if (!hasData) {
    return { hasData: false, portfolio: null, byRegion: [], byCommunity: [] };
  }

  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const monthKeys = dsoMonthKeysInRange(periodStart, periodEnd);

  function newScope(extra = {}) {
    return { ...extra, billedRevenue: 0, occupiedDays: 0, censusDays: 0, byMonth: Object.fromEntries(monthKeys.map((m) => [m, { billedRevenue: 0, occupiedDays: 0, censusDays: 0 }])) };
  }

  const portfolio = newScope();
  const regions = new Map();
  const communityScopes = new Map();

  function resolveScopes(row) {
    const communityKey = `${row._host}::${row.communityId}`;
    const meta = communityMeta.get(communityKey);
    const regionName = meta?.region || 'Unassigned';
    if (!regions.has(regionName)) regions.set(regionName, newScope({ region: regionName }));
    if (!communityScopes.has(communityKey)) {
      communityScopes.set(communityKey, newScope({
        communityId: row.communityId,
        host: row._host,
        name: meta?.name || firstDefined(row, ['communityName']) || `Community ${row.communityId}`,
        region: meta?.region || null,
      }));
    }
    return { regionScope: regions.get(regionName), communityScope: communityScopes.get(communityKey) };
  }

  function apply(scope, monthKey, field, amount) {
    if (!scope || !amount) return;
    scope[field] += amount;
    if (monthKey && scope.byMonth[monthKey]) scope.byMonth[monthKey][field] += amount;
  }

  for (const row of invoiceChargeRows) {
    const amount = Number(row.amount) || 0;
    if (!amount) continue;
    const monthKey = bucketMonth(firstDefined(row, ['invoiceDate']), monthKeys);
    const { regionScope, communityScope } = resolveScopes(row);
    apply(portfolio, monthKey, 'billedRevenue', amount);
    apply(regionScope, monthKey, 'billedRevenue', amount);
    apply(communityScope, monthKey, 'billedRevenue', amount);
  }

  for (const row of occupancyRows) {
    if (row.dataSet !== 'Occupied' && row.dataSet !== 'Vacant') continue;
    const monthKey = bucketMonth(row.date, monthKeys);
    const { regionScope, communityScope } = resolveScopes(row);
    if (row.dataSet === 'Occupied') {
      apply(portfolio, monthKey, 'occupiedDays', 1);
      apply(regionScope, monthKey, 'occupiedDays', 1);
      apply(communityScope, monthKey, 'occupiedDays', 1);
    }
    if (row.censusOcc === 1) {
      apply(portfolio, monthKey, 'censusDays', 1);
      apply(regionScope, monthKey, 'censusDays', 1);
      apply(communityScope, monthKey, 'censusDays', 1);
    }
  }

  function computePpd(billedRevenue, days) {
    return days > 0 ? billedRevenue / days : null;
  }

  function finalize(scope, extra = {}) {
    return {
      ...extra,
      billedRevenue: scope.billedRevenue,
      occupiedDays: scope.occupiedDays,
      censusDays: scope.censusDays,
      ppdByUnitDays: computePpd(scope.billedRevenue, scope.occupiedDays),
      ppdByCensus: computePpd(scope.billedRevenue, scope.censusDays),
      monthly: monthKeys.map((m) => {
        const b = scope.byMonth[m];
        return {
          month: m,
          billedRevenue: b.billedRevenue,
          occupiedDays: b.occupiedDays,
          censusDays: b.censusDays,
          ppdByUnitDays: computePpd(b.billedRevenue, b.occupiedDays),
          ppdByCensus: computePpd(b.billedRevenue, b.censusDays),
        };
      }),
    };
  }

  const byPpdDesc = (a, b) => (b.ppdByUnitDays ?? -1) - (a.ppdByUnitDays ?? -1);

  return {
    hasData: true,
    portfolio: finalize(portfolio),
    byRegion: Array.from(regions.values()).map((s) => finalize(s, { region: s.region })).sort(byPpdDesc),
    byCommunity: Array.from(communityScopes.values())
      .map((s) => finalize(s, { communityId: s.communityId, host: s.host, name: s.name, region: s.region }))
      .sort(byPpdDesc),
  };
}

// ── Community Revenue Snapshot (monthly, per-community) ─────────────────

/**
 * Per-community Charges/Credits/Discounts/Net Revenue for one month — new
 * for the monthly Community Revenue Snapshot job (Sep 2026, Aaron),
 * modeled on normalizePpd's resolveScopes/communityMeta pattern just above
 * rather than extending normalizeInvoiceCharges (portfolio-only, used
 * as-is by the QBR pipeline; changing its shape would ripple into
 * KpiDashboard.jsx). `type` is invoiceCharges' own field — confirmed live
 * against real data: values are `Charge`/`Credit`/`Discount`/`Subsidy`,
 * signs already correct (Credits/Discounts/Subsidy negative), and
 * Charges + Credits + Discounts + Subsidy really does equal the account's
 * own Net Revenue figure. `Subsidy` is folded into `discounts` to match
 * Viva's real report's exact 3-column spec (Charges/Credits/Discounts) —
 * easy to break out as its own column later if that granularity matters.
 */
function normalizeCommunityRevenue(invoiceChargeRows = [], communities = []) {
  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const communityScopes = new Map();

  function scopeFor(row) {
    const key = `${row._host}::${row.communityId}`;
    if (!communityScopes.has(key)) {
      const meta = communityMeta.get(key);
      communityScopes.set(key, {
        communityId: row.communityId,
        host: row._host,
        name: meta?.name || firstDefined(row, ['communityName']) || `Community ${row.communityId}`,
        charges: 0, credits: 0, discounts: 0,
      });
    }
    return communityScopes.get(key);
  }

  for (const row of invoiceChargeRows) {
    const amount = Number(row.amount) || 0;
    if (!amount) continue;
    const scope = scopeFor(row);
    if (row.type === 'Charge') scope.charges += amount;
    else if (row.type === 'Credit') scope.credits += amount;
    else scope.discounts += amount; // Discount or Subsidy — both revenue-reducing adjustments
  }

  return Array.from(communityScopes.values()).map((s) => ({
    communityId: s.communityId,
    host: s.host,
    name: s.name,
    charges: s.charges,
    credits: s.credits,
    discounts: s.discounts,
    netRevenue: s.charges + s.credits + s.discounts,
  }));
}

/**
 * Per-community Move Ins/Move Outs for one month — same resolveScopes
 * pattern as normalizeCommunityRevenue above, and the exact same
 * physicalMoveInDate/physicalMoveOutDate field-reading convention already
 * used by the portfolio-only normalizeAdmissionsDischarges, just grouped
 * by community instead of summed to a portfolio total.
 */
function normalizeCommunityMoveInOut(moveInOutRows = [], communities = [], periodStart, periodEnd) {
  const communityMeta = new Map(communities.map((c) => [`${c.host}::${c.communityId}`, c]));
  const communityScopes = new Map();
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();

  function scopeFor(row) {
    const key = `${row._host}::${row.communityId}`;
    if (!communityScopes.has(key)) {
      const meta = communityMeta.get(key);
      communityScopes.set(key, {
        communityId: row.communityId,
        host: row._host,
        name: meta?.name || firstDefined(row, ['communityName']) || `Community ${row.communityId}`,
        moveIns: 0, moveOuts: 0,
      });
    }
    return communityScopes.get(key);
  }

  const inWindow = (raw) => {
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return !Number.isNaN(t) && t >= startMs && t <= endMs;
  };

  for (const row of moveInOutRows) {
    const moveIn = firstDefined(row, ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate']);
    if (inWindow(moveIn)) scopeFor(row).moveIns++;
    const moveOut = firstDefined(row, ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate', 'dischargeDate']);
    if (inWindow(moveOut)) scopeFor(row).moveOuts++;
  }

  return Array.from(communityScopes.values());
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

  // The ALIS 500 benchmark only publishes PRN rate by drug class (analgesics,
  // sedativesAntipsychotics, etc.) — there's no single published "overall"
  // figure to diff our overall-only rate against directly. Summing the
  // published categories reconstructs the equivalent overall benchmark
  // rather than comparing our total against one narrow category (which
  // would make any real account look artificially high).
  const prnBenchmarkOverall = Object.values(clin.prnAdministrationPer1000ResidentDays).reduce((sum, v) => sum + v, 0);

  return {
    occupancyPct: diffMetric(normalized.occupancy?.pct, occ.referenceOccupancyPct / 100, { higherIsBetter: true }),
    medianLosDays: diffMetric(normalized.lengthOfStay?.medianDays, occ.lengthOfStay.medianDays, { higherIsBetter: true }),
    moveOutWithin12mo: diffMetric(normalized.lengthOfStay?.moveOutWithin?.['12mo'], occ.lengthOfStay.moveOutWithin['12mo'], { higherIsBetter: false }),
    qualityOfServiceMoveOutShare: diffMetric(normalized.lengthOfStay?.moveOutReasonBuckets?.qualityOfService, occ.moveOutReasons.qualityOfService, { higherIsBetter: false }),
    fallsPer1000ResidentDays: diffMetric(normalized.falls?.per1000ResidentDays, clin.falls.per1000ResidentDays, { higherIsBetter: false }),
    hospitalVisitsPer1000ResidentDays: diffMetric(normalized.hospitalVisits?.per1000ResidentDays, clin.hospitalVisits.per1000ResidentDays, { higherIsBetter: false }),
    prnAdministrationPer1000ResidentDays: diffMetric(normalized.prnAdministration?.overall, prnBenchmarkOverall, { higherIsBetter: false }),
  };
}

module.exports = {
  diffMetric,
  normalizeOccupancy,
  normalizeDemographics,
  normalizeUpcomingBirthdays,
  addDays,
  normalizeLengthOfStayAndMoveOuts,
  normalizeAdmissionsDischarges,
  normalizeCareLevelEvaluations,
  normalizeRecurringRevenue,
  normalizeInvoiceCharges,
  normalizeOutstandingInvoices,
  normalizeDso,
  dsoBand,
  normalizePpd,
  normalizeCommunityRevenue,
  normalizeCommunityMoveInOut,
  normalizeFalls,
  normalizeIncidentCompletion,
  normalizeSentinelIncidents,
  normalizeHospitalVisits,
  normalizeDiagnoses,
  normalizeCareCompletion,
  normalizeStaffActivity,
  normalizePrnAdministration,
  estimateResidentDays,
  computeBenchmarkDiffs,
  filterByDateRange,
};
