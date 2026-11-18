/**
 * Oregon ABST — estimated staff minutes per shift, per day (OAR 411-054-0037 rule (D)).
 *
 * Source: ALIS export recordedCare. One row per scheduled care task occurrence (ALIS has
 * already expanded "3x daily" etc.), carrying the community's shift label, care date, and the
 * care item's estimated minutes. This is a STAFFING view, so we sum ESTIMATED minutes for every
 * scheduled ABST occurrence and deliberately ignore whether staff recorded it (timeTaken,
 * isCareNotRecorded are not used).
 *
 * Differs from the crosswalk's weekly minutes on purpose: the crosswalk does not multiply the
 * "x2/x3 per day" quantity; this view counts every scheduled occurrence.
 *
 * Aggregates only — no resident names leave this module (resident counts are numbers).
 */
const api = require('./alisApiClient');

const MAX_DAYS = 92;
const CHUNK_DAYS = 7;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const round1 = (n) => Math.round(n * 10) / 10;

function toUtc(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

function daysBetween(start, end) {
  const out = [];
  for (let t = toUtc(start); t <= toUtc(end); t += 86400000) out.push(fmt(t));
  return out;
}

function chunk(start, end) {
  const out = [];
  for (let t = toUtc(start); t <= toUtc(end); t += CHUNK_DAYS * 86400000) {
    out.push([fmt(t), fmt(Math.min(t + (CHUNK_DAYS - 1) * 86400000, toUtc(end)))]);
  }
  return out;
}

function validateRange(start, end) {
  if (!DAY_RE.test(start || '') || !DAY_RE.test(end || '')) throw new Error('start and end must be YYYY-MM-DD.');
  if (toUtc(end) < toUtc(start)) throw new Error('end must be on or after start.');
  const n = daysBetween(start, end).length;
  if (n > MAX_DAYS) throw new Error(`Date range is limited to ${MAX_DAYS} days (got ${n}).`);
}

// "Shift I" < "Shift II" < "Shift III" sorts correctly as plain text; numeric covers "Shift 1/2/3".
const SHIFT_ORDER = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * @param {string} host
 * @param {object} opts { communityId, start, end (YYYY-MM-DD, inclusive), excludeIndependent?, category? (default 'ABST'), onProgress? }
 */
async function buildShiftMinutes(host, opts = {}) {
  const { communityId, start, end, excludeIndependent = true, category = 'ABST', onProgress = () => {} } = opts;
  if (!communityId) throw new Error('communityId is required.');
  validateRange(start, end);
  const cid = Number(communityId);

  const key = [host, cid, start, end, excludeIndependent, category].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const chunks = chunk(start, end);
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(`Pulling scheduled care ${chunks[i][0]} to ${chunks[i][1]} (${i + 1}/${chunks.length})…`);
    const part = await api.getRecordedCare(host, { communityId: cid, careStartDate: chunks[i][0], careEndDate: chunks[i][1] });
    for (const r of Array.isArray(part) ? part : []) rows.push(r);
  }

  const inRange = (day) => day >= start && day <= end;
  const all = rows.filter((r) => Number(r.communityId) === cid && r.careDate && inRange(r.careDate.slice(0, 10)));
  const abstRows = all.filter((r) => r.careItemCategory === category);
  const excludedIndependent = excludeIndependent ? abstRows.filter((r) => /independent/i.test(r.residentProductType || '')) : [];
  const excludedSet = new Set(excludedIndependent);
  const scoped = abstRows.filter((r) => !excludedSet.has(r));
  const counted = scoped.filter((r) => !r.isPrnCare);
  const prn = scoped.filter((r) => r.isPrnCare);

  const shifts = [...new Set(counted.map((r) => r.byShift || '(no shift)'))].sort(SHIFT_ORDER);
  const days = daysBetween(start, end);

  // date x shift grid
  const grid = Object.fromEntries(days.map((d) => [d, Object.fromEntries(shifts.map((s) => [s, { minutes: 0, tasks: 0, residents: new Set() }]))]));
  for (const r of counted) {
    const cell = grid[r.careDate.slice(0, 10)][r.byShift || '(no shift)'];
    cell.minutes += Number(r.timeEstimated) || 0;
    cell.tasks += 1;
    cell.residents.add(r.residentId);
  }
  const daily = days.map((date) => {
    const cells = shifts.map((s) => ({ shift: s, minutes: round1(grid[date][s].minutes), tasks: grid[date][s].tasks, residents: grid[date][s].residents.size }));
    const residents = new Set();
    shifts.forEach((s) => grid[date][s].residents.forEach((id) => residents.add(id)));
    return {
      date,
      weekday: new Date(toUtc(date)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      shifts: cells,
      totalMinutes: round1(cells.reduce((a, c) => a + c.minutes, 0)),
      totalTasks: cells.reduce((a, c) => a + c.tasks, 0),
      residents: residents.size,
    };
  });

  const totals = shifts.map((s) => {
    const minutes = daily.reduce((a, d) => a + d.shifts.find((c) => c.shift === s).minutes, 0);
    return { shift: s, minutes: round1(minutes), averagePerDay: round1(minutes / days.length) };
  });

  // Observed hours of task times per shift (so the shift labels are explainable on paper).
  const hoursByShift = {};
  for (const r of counted) {
    const h = (r.careTime || '').slice(11, 13);
    if (!h) continue;
    const k = r.byShift || '(no shift)';
    (hoursByShift[k] = hoursByShift[k] || new Set()).add(Number(h));
  }
  const observedHours = Object.fromEntries(shifts.map((s) => [s, [...(hoursByShift[s] || [])].sort((a, b) => a - b)]));

  // care item x shift (range totals)
  const itemMap = new Map();
  for (const r of counted) {
    const k = r.careItemName;
    const it = itemMap.get(k) || { name: k, perOccurrence: Number(r.timeEstimated) || 0, byShift: {}, tasks: 0, minutes: 0 };
    const s = r.byShift || '(no shift)';
    it.byShift[s] = (it.byShift[s] || 0) + (Number(r.timeEstimated) || 0);
    it.tasks += 1;
    it.minutes += Number(r.timeEstimated) || 0;
    itemMap.set(k, it);
  }
  const items = [...itemMap.values()]
    .map((it) => ({ ...it, minutes: round1(it.minutes), byShift: Object.fromEntries(Object.entries(it.byShift).map(([s, m]) => [s, round1(m)])) }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

  const noMinutes = counted.filter((r) => !(Number(r.timeEstimated) > 0)).length;
  const value = {
    meta: {
      host,
      communityId: cid,
      communityName: all[0]?.communityName || `Community ${cid}`,
      start,
      end,
      dayCount: days.length,
      category,
      excludeIndependent,
      generatedAt: new Date().toISOString(),
      method:
        'Estimated staff minutes for every scheduled ABST care task occurrence, summed by calendar care date and the community\'s shift. '
        + 'Each occurrence counts (a "3x daily" task counts three times). Estimated minutes come from the care item setting; '
        + 'whether staff documented the task is not considered. PRN tasks are listed separately and are not included in shift totals.',
      shifts,
      observedHours,
      excludedIndependentTasks: excludedIndependent.length,
      tasksWithoutMinutes: noMinutes,
      prnTasks: prn.length,
    },
    daily,
    totals,
    grandTotalMinutes: round1(daily.reduce((a, d) => a + d.totalMinutes, 0)),
    averageDailyMinutes: round1(daily.reduce((a, d) => a + d.totalMinutes, 0) / days.length),
    items,
    prn: Object.values(
      prn.reduce((m, r) => {
        const x = (m[r.careItemName] = m[r.careItemName] || { name: r.careItemName, occurrences: 0, minutesPerOccurrence: Number(r.timeEstimated) || 0 });
        x.occurrences += 1;
        return m;
      }, {})
    ).sort((a, b) => b.occurrences - a.occurrences),
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { buildShiftMinutes, validateRange, MAX_DAYS };
