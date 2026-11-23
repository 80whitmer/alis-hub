/**
 * Viva Senior Living YoY metrics — STAGE 2: build the Excel workbook from the
 * cache vivaYoyPull.js wrote. Usage: node server/automation/vivaYoyReport.js
 *
 * Periods (full calendar months): T12 = 2025-11..2026-10, P12 = 2024-11..2025-10.
 * Monthly figures are computed directly from daily/event data (NOT by summing
 * weekly figures, since weeks straddle month boundaries). Missing data is
 * left blank and flagged — never zero-filled or interpolated.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DIR = path.join(__dirname, 'data', 'viva-yoy');
const CACHE = path.join(DIR, 'cache');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const pad = (n) => String(n).padStart(2, '0');

function monthsBetween(first, last) {
  const out = []; let [y, m] = first.split('-').map(Number); const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const MONTHS = monthsBetween('2024-11', '2026-10');
const periodOf = (ym) => (ym >= '2025-11' ? 'T12' : 'P12');
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// Mon–Sun weeks fully inside the 24-month window; keyed by week-ending (Sunday).
function weeks() {
  const out = []; let d = new Date('2024-11-04T00:00:00Z');
  const end = new Date('2026-10-31T00:00:00Z');
  while (true) {
    const sun = new Date(d.getTime() + 6 * 86400000);
    if (sun > end) break;
    out.push({ start: d.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) });
    d = new Date(d.getTime() + 7 * 86400000);
  }
  return out;
}
const WEEKS = weeks();
const weekOf = (date) => WEEKS.find((w) => date >= w.start && date <= w.end)?.end || null;

const communities = readJson(path.join(CACHE, 'communities.json'), []);
const scope = communities.filter((c) => c.status === 'active' && !/training|management/i.test(c.communityName))
  .sort((a, b) => a.communityName.localeCompare(b.communityName));
const errors = readJson(path.join(CACHE, 'errors.json'), []);
const obsFile = readJson(path.join(CACHE, 'obs.json'), null);
const evalsFile = readJson(path.join(CACHE, 'evals.json'), null);

const FALL = /^fall\b/i;
const SKIN_WOUND_OBS = /wound|skin/i;

// ── Per-community aggregation ───────────────────────────────────────────────
const flags = []; // {community, metric, issue}
const flag = (c, metric, issue) => flags.push({ community: c.communityName, metric, issue });

const data = {};
for (const c of scope) {
  const cid = c.communityId;
  const d = { occDays: {}, medsDays: {}, inc: [], wound: [], occMonthsMissing: [], medsMonthsMissing: [], occMonthsZero: [], medsMonthsZero: [], occPartial: [] };

  for (const m of MONTHS) {
    const o = readJson(path.join(CACHE, 'occ', `${cid}-${m}.json`), null);
    if (!o) d.occMonthsMissing.push(m);
    else if (!o.rows || Object.keys(o.days).length === 0) d.occMonthsZero.push(m);
    else {
      Object.assign(d.occDays, o.days);
      const n = Object.keys(o.days).length; if (n < daysIn(m)) d.occPartial.push(`${m} (${n}/${daysIn(m)}d)`);
    }
    const md = readJson(path.join(CACHE, 'meds', `${cid}-${m}.json`), null);
    if (!md) d.medsMonthsMissing.push(m);
    else if (!md.rows || Object.keys(md.days).length === 0) d.medsMonthsZero.push(m);
    else Object.assign(d.medsDays, md.days);
  }
  const inc = readJson(path.join(CACHE, 'inc', `${cid}.json`), null);
  d.incPulled = inc != null; d.inc = inc || [];
  if (obsFile) d.wound = obsFile.wound.filter((w) => w.cid === cid);

  // Go-live: first month with real census. Months before it are "not open / no data", not zero.
  const occMonthsWithCensus = MONTHS.filter((m) => Object.entries(d.occDays).some(([dt, v]) => dt.startsWith(m) && v.occ > 0));
  d.firstMonth = occMonthsWithCensus[0] || null;
  d.hasMonth = (m) => d.firstMonth != null && m >= d.firstMonth && !d.occMonthsMissing.includes(m) && !d.occMonthsZero.includes(m);
  data[cid] = d;

  // Flags
  if (d.occMonthsMissing.length) flag(c, 'Census/Occupancy', `Pull failed for ${d.occMonthsMissing.length} month(s): ${d.occMonthsMissing.join(', ')}`);
  if (d.firstMonth === null) flag(c, 'Census/Occupancy', 'No occupancy data in any of the 24 months — community excluded from comparisons');
  else if (d.firstMonth > '2024-11') flag(c, 'All metrics', `Data begins ${d.firstMonth}; prior-12 period is partial — YoY not like-for-like`);
  const gapMonths = d.firstMonth ? d.occMonthsZero.filter((m) => m >= d.firstMonth) : [];
  if (gapMonths.length) flag(c, 'Census/Occupancy', `Zero rows returned after go-live for: ${gapMonths.join(', ')} (left blank)`);
  if (d.occPartial.length) flag(c, 'Census/Occupancy', `Partial-month day coverage: ${d.occPartial.join('; ')}`);
  if (d.medsMonthsMissing.length) flag(c, 'Missed meds', `Pull failed for ${d.medsMonthsMissing.length} month(s): ${d.medsMonthsMissing.join(', ')}`);
  const medsGap = d.medsMonthsZero.filter((m) => d.firstMonth && m >= d.firstMonth);
  if (medsGap.length) flag(c, 'Missed meds', `No MAR rows after go-live for ${medsGap.length} month(s): ${medsGap.join(', ')} (likely eMAR not in use; left blank)`);
  if (!d.incPulled) flag(c, 'Incidents', 'Incident pull failed — falls/unlocked incidents blank');
  else if (d.inc.length === 0) flag(c, 'Incidents', 'Zero incidents recorded in 24 months — may be no incident module use rather than zero events');
  if (obsFile) {
    const oc = obsFile.byCommunity[cid];
    if (!oc) flag(c, 'Wound observations', 'No observations of any type found for this community');
    else if (oc.min > '2024-11-30') flag(c, 'Wound observations', `Observation history only begins ${oc.min}`);
    if (!obsFile.complete) flag(c, 'Wound observations', 'Observation pull hit the page cap — counts may be understated');
  }
}
if (!obsFile) flags.push({ community: '(all)', metric: 'Wound observations', issue: 'Observation pull not completed' });
flags.push({ community: '(all)', metric: 'Falls with injury', issue: 'Viva has no "fall with injury" IncidentType (types are Fall - Unwitnessed / Fall - Witnessed). Not derivable from IncidentType; column left blank rather than guessed.' });
flags.push({ community: '(all)', metric: 'Wound observations', issue: 'Viva has no ObservationType "Skin/Wound Note". Counted types matching /wound|skin/i instead: ' + (obsFile ? Object.entries(obsFile.types).filter(([t]) => SKIN_WOUND_OBS.test(t)).map(([t, n]) => `${t} (${n})`).join(', ') : 'n/a') });
flags.push({ community: '(all)', metric: 'Past-due evaluations / incomplete service plans', issue: 'ALIS API exposes current state only (no history) — shown as a point-in-time snapshot, no YoY comparison possible.' });
flags.push({ community: '(all)', metric: 'Incomplete service plans', issue: 'No ResidentServicePlans.ServicePlanCompletedDate in API. Proxy used: current residents\' most-current evaluation whose carePlanStatus is not "active" (draft/none).' });
for (const e of errors) flags.push({ community: `(pull error ${e.stage})`, metric: e.stage, issue: `${JSON.stringify(e.item)}: ${e.error}` });

// ── Metric calculators ──────────────────────────────────────────────────────
const inRange = (dt, a, b) => dt >= a && dt <= b;
function occStats(d, a, b) {
  let census = 0, occ = 0, cap = 0, n = 0, last = null;
  for (const [dt, v] of Object.entries(d.occDays)) if (inRange(dt, a, b)) { census += v.census; occ += v.occ; cap += v.cap; n++; if (!last || dt > last.dt) last = { dt, census: v.census }; }
  return n ? { avgCensus: census / n, occPct: cap ? occ / cap : null, capacity: cap / n, endCensus: last.census, occ, cap, days: n } : null;
}
function medsStats(d, a, b) {
  let sched = 0, exc = 0, nw = 0, n = 0;
  for (const [dt, v] of Object.entries(d.medsDays)) if (inRange(dt, a, b)) { sched += v.sched; exc += v.exception; nw += v.new; n++; }
  return n ? { sched, missed: exc + nw, exception: exc, notRecorded: nw } : null;
}
function incStats(d, a, b) {
  if (!d.incPulled) return null;
  let falls = 0, unlocked = 0;
  for (const i of d.inc) if (i.date && inRange(i.date, a, b)) { if (FALL.test(i.type || '')) falls++; if (i.status === 'incomplete') unlocked++; }
  return { falls, unlocked };
}
function woundCount(d, a, b) {
  if (!obsFile) return null;
  return d.wound.filter((w) => w.date && inRange(w.date, a, b)).length;
}
// A (community, period) cell is reportable only when the community was live for the whole period slice.
const bounds = (m) => [`${m}-01`, `${m}-${pad(daysIn(m))}`];

function monthRow(c, m) {
  const d = data[c.communityId]; const [a, b] = bounds(m);
  const live = d.hasMonth(m);
  const o = live ? occStats(d, a, b) : null;
  const md = live && !d.medsMonthsZero.includes(m) && !d.medsMonthsMissing.includes(m) ? medsStats(d, a, b) : null;
  const inc = live ? incStats(d, a, b) : null;
  const w = live ? woundCount(d, a, b) : null;
  return {
    community: c.communityName, communityId: c.communityId, month: m, period: periodOf(m),
    avgCensus: o?.avgCensus ?? null, endCensus: o?.endCensus ?? null, capacity: o?.capacity ?? null, occPct: o?.occPct ?? null,
    falls: inc?.falls ?? null, fallsInjury: null, missedMeds: md?.missed ?? null, schedMeds: md?.sched ?? null,
    missedPct: md && md.sched ? md.missed / md.sched : null, unlocked: inc?.unlocked ?? null, wounds: w,
    _occ: o, _live: live,
  };
}
const monthRows = scope.flatMap((c) => MONTHS.map((m) => monthRow(c, m)));

function weekRow(c, w) {
  const d = data[c.communityId]; const m = w.end.slice(0, 7);
  const live = d.firstMonth != null && w.start >= `${d.firstMonth}-01`;
  const o = live ? occStats(d, w.start, w.end) : null;
  const md = live && o ? medsStats(d, w.start, w.end) : null;
  const inc = live && o ? incStats(d, w.start, w.end) : null;
  return {
    community: c.communityName, weekEnding: w.end, month: m, period: periodOf(m),
    avgCensus: o?.avgCensus ?? null, occPct: o?.occPct ?? null, falls: inc?.falls ?? null, missedMeds: md?.missed ?? null,
    unlocked: inc?.unlocked ?? null, wounds: live && o ? woundCount(d, w.start, w.end) : null,
  };
}
const weekRows = scope.flatMap((c) => WEEKS.map((w) => weekRow(c, w)));

// ── YoY per community (T12 vs P12) ──────────────────────────────────────────
function yoyFor(c) {
  const rows = monthRows.filter((r) => r.communityId === c.communityId);
  const agg = (period) => {
    const rs = rows.filter((r) => r.period === period && r._live);
    const sum = (k) => { const v = rs.filter((r) => r[k] != null); return v.length ? v.reduce((s, r) => s + r[k], 0) : null; };
    const occ = rs.filter((r) => r._occ); const o = occ.reduce((s, r) => s + r._occ.occ, 0); const cp = occ.reduce((s, r) => s + r._occ.cap, 0);
    const cen = occ.reduce((s, r) => s + r._occ.avgCensus * r._occ.days, 0); const dys = occ.reduce((s, r) => s + r._occ.days, 0);
    return { months: rs.length, avgCensus: dys ? cen / dys : null, occPct: cp ? o / cp : null, falls: sum('falls'), missedMeds: sum('missedMeds'), schedMeds: sum('schedMeds'), unlocked: sum('unlocked'), wounds: sum('wounds') };
  };
  const t = agg('T12'), p = agg('P12');
  const comparable = t.months === 12 && p.months === 12 && !flags.some((f) => f.community === c.communityName && ['Census/Occupancy', 'Missed meds', 'Incidents', 'All metrics'].includes(f.metric));
  return { community: c.communityName, t, p, comparable };
}
const yoy = scope.map(yoyFor);

// ── Snapshot: past-due evaluations & incomplete service plans (as of pull) ─
const today = (evalsFile?.pulledAt || new Date().toISOString()).slice(0, 10);
function snapshotFor(c) {
  if (!evalsFile) return null;
  const rows = evalsFile.rows.filter((r) => r.cid === c.communityId);
  const current = rows.filter((r) => r.isMostCurrent === true && r.residentStatus && /resident/i.test(r.residentStatus) && r.residentStatus !== 'Moved Out');
  const pastDue = current.filter((r) => r.expirationDate && r.expirationDate < today);
  const literal = rows.filter((r) => r.expirationDate && r.expirationDate < today && r.isMostCurrent === false && r.isCompleted === false);
  const incompletePlans = current.filter((r) => r.carePlanStatus !== 'active');
  return { residents: current.length, pastDue: pastDue.length, literal: literal.length, incompletePlans: incompletePlans.length };
}

// ── Workbook ────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } } };
function addSheet(name, columns, rows, opts = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: opts.freezeX || 0 }] });
  ws.columns = columns;
  ws.getRow(1).eachCell((c) => { c.font = HEAD.font; c.fill = HEAD.fill; c.alignment = { wrapText: true, vertical: 'middle' }; });
  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}
const col = (header, key, width = 14, fmt) => ({ header, key, width, style: fmt ? { numFmt: fmt } : {} });
const N1 = '#,##0.0', N0 = '#,##0', P1 = '0.0%';

// Portfolio monthly
const portfolio = MONTHS.map((m) => {
  const rs = monthRows.filter((r) => r.month === m && r._live);
  const sum = (k) => { const v = rs.filter((r) => r[k] != null); return v.length ? v.reduce((s, r) => s + r[k], 0) : null; };
  const occ = rs.filter((r) => r._occ); const o = occ.reduce((s, r) => s + r._occ.occ, 0); const cp = occ.reduce((s, r) => s + r._occ.cap, 0);
  const md = rs.filter((r) => r.schedMeds != null);
  return {
    month: m, period: periodOf(m), reporting: occ.length, of: scope.length,
    avgCensus: sum('avgCensus'), capacity: sum('capacity'), occPct: cp ? o / cp : null,
    falls: sum('falls'), fallsInjury: null, missedMeds: sum('missedMeds'), schedMeds: sum('schedMeds'),
    missedPct: md.length ? md.reduce((s, r) => s + r.missedMeds, 0) / md.reduce((s, r) => s + r.schedMeds, 0) : null,
    unlocked: sum('unlocked'), wounds: sum('wounds'),
  };
});

// README
const readme = wb.addWorksheet('README');
readme.columns = [{ width: 120 }];
[
  'Viva Senior Living — Year-over-Year Clinical & Operational Metrics',
  `Source: ALIS Export/Integration API (host "viva"), pulled ${today}. In scope: ${scope.length} active communities (Training/Management accounts and canceled/suspended communities excluded).`,
  'Periods: T12 = Nov 2025–Oct 2026 (12 full months); P12 = Nov 2024–Oct 2025. Latest partial month (Nov 2026) excluded.',
  'Monthly values are computed directly from daily/event data (not by summing weeks). Weekly = Mon–Sun, labelled by Sunday week-ending date, only weeks fully inside the window.',
  '',
  'DEFINITIONS',
  'Census / Occupancy: from v2 hqOccupancies daily snapshots. Avg census = mean daily count of Occupied bed rows with censusOcc=1. Occupancy % = Occupied bed-days ÷ (Occupied + Vacant bed-days). Matches alis-hub KPI logic.',
  'Falls: incidents (Integration v2) with IncidentType starting "Fall" (Fall - Unwitnessed / Fall - Witnessed), by incident date.',
  'Falls with injury: NOT AVAILABLE — Viva has no such IncidentType. Left blank (see Data Flags).',
  'Missed meds: non-PRN medication/treatment administrations (orderAdministration v3) with status "exception" or "new", by scheduled date. Sub-split in Community Monthly is not shown; "new" = never recorded (isNotRecorded), "exception" = refused/held/etc. Missed % = missed ÷ scheduled non-PRN.',
  'Unlocked incidents: incidents with status "incomplete" (current status as of pull), bucketed by incident date — all incident types.',
  'Wound observations: observations whose ObservationType matches /wound|skin/i (Viva has no literal "Skin/Wound Note" type), by occurredOn date.',
  'Past-due evaluations (snapshot): current residents\' most-current evaluation with expirationDate < pull date. Literal alt (isMostCurrent=false, isCompleted=false, expired) shown alongside.',
  'Incomplete service plans (snapshot, PROXY): current residents\' most-current evaluation whose carePlanStatus is not "active".',
  '',
  'DATA INTEGRITY RULES: blanks mean "no data" — never zero-filled or interpolated. Months before a community\'s first census are blank (not yet live in ALIS). See Data Flags for every community/metric gap.',
  'Portfolio rows sum only communities reporting that month ("Communities reporting" column) — compare T12 vs P12 using the "Comparable only" rows in YoY Summary to avoid growth/onboarding distortion.',
].forEach((t, i) => { const r = readme.addRow([t]); r.alignment = { wrapText: true }; if (i === 0 || t === 'DEFINITIONS') r.font = { bold: true, size: i === 0 ? 14 : 11 }; });

addSheet('Portfolio Monthly', [
  col('Month', 'month', 10), col('Period', 'period', 8), col('Communities reporting', 'reporting', 12), col('Communities in scope', 'of', 12),
  col('Avg daily census (sum)', 'avgCensus', 14, N1), col('Avg capacity (beds)', 'capacity', 14, N1), col('Occupancy %', 'occPct', 12, P1),
  col('Falls', 'falls', 10, N0), col('Falls w/ injury', 'fallsInjury', 12), col('Missed meds', 'missedMeds', 12, N0), col('Scheduled meds', 'schedMeds', 14, N0),
  col('Missed %', 'missedPct', 10, '0.00%'), col('Unlocked incidents', 'unlocked', 12, N0), col('Wound/skin observations', 'wounds', 14, N0),
], portfolio, { freezeX: 1 });

// YoY summary
const sumKeys = ['falls', 'missedMeds', 'unlocked', 'wounds'];
const yoyRows = yoy.map((y) => ({
  community: y.community, comparable: y.comparable ? 'Yes' : 'NO — see flags',
  pMonths: y.p.months, tMonths: y.t.months,
  pCensus: y.p.avgCensus, tCensus: y.t.avgCensus, pOcc: y.p.occPct, tOcc: y.t.occPct,
  pFalls: y.p.falls, tFalls: y.t.falls, fallsChg: y.p.falls != null && y.t.falls != null ? y.t.falls - y.p.falls : null,
  pMissed: y.p.missedMeds, tMissed: y.t.missedMeds, missedChg: y.p.missedMeds != null && y.t.missedMeds != null ? y.t.missedMeds - y.p.missedMeds : null,
  pUnl: y.p.unlocked, tUnl: y.t.unlocked, pWound: y.p.wounds, tWound: y.t.wounds, wChg: y.p.wounds != null && y.t.wounds != null ? y.t.wounds - y.p.wounds : null,
  flags: flags.filter((f) => f.community === y.community).map((f) => `${f.metric}: ${f.issue}`).join(' | '),
}));
function totalRow(label, list) {
  const s = (k) => { const v = list.map((y) => y[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const wocc = (which) => { const rs = list.filter((y) => y[which === 'p' ? 'pOcc' : 'tOcc'] != null); return rs.length ? null : null; };
  const base = { community: label, comparable: '', pMonths: '', tMonths: '' };
  for (const k of ['pCensus', 'tCensus', 'pFalls', 'tFalls', 'fallsChg', 'pMissed', 'tMissed', 'missedChg', 'pUnl', 'tUnl', 'pWound', 'tWound', 'wChg']) base[k] = s(k);
  void wocc;
  return base;
}
const yoyAll = totalRow('PORTFOLIO — all in-scope communities (sums what is reported; not like-for-like)', yoyRows);
const yoyComp = totalRow('PORTFOLIO — comparable communities only (full 12+12 months, no flags)', yoyRows.filter((r) => r.comparable === 'Yes'));
// Portfolio occupancy % from raw bed-days
function portOcc(list, which) {
  let o = 0, c = 0;
  for (const y of list) for (const r of monthRows.filter((mr) => mr.community === y.community && mr.period === which && mr._occ)) { o += r._occ.occ; c += r._occ.cap; }
  return c ? o / c : null;
}
yoyAll.pOcc = portOcc(yoyRows, 'P12'); yoyAll.tOcc = portOcc(yoyRows, 'T12');
yoyComp.pOcc = portOcc(yoyRows.filter((r) => r.comparable === 'Yes'), 'P12'); yoyComp.tOcc = portOcc(yoyRows.filter((r) => r.comparable === 'Yes'), 'T12');
const ysh = addSheet('YoY Summary', [
  col('Community', 'community', 44), col('Comparable?', 'comparable', 14), col('P12 months w/ data', 'pMonths', 10), col('T12 months w/ data', 'tMonths', 10),
  col('P12 avg census', 'pCensus', 11, N1), col('T12 avg census', 'tCensus', 11, N1), col('P12 occ %', 'pOcc', 10, P1), col('T12 occ %', 'tOcc', 10, P1),
  col('P12 falls', 'pFalls', 9, N0), col('T12 falls', 'tFalls', 9, N0), col('Falls Δ', 'fallsChg', 9, N0),
  col('P12 missed meds', 'pMissed', 11, N0), col('T12 missed meds', 'tMissed', 11, N0), col('Missed Δ', 'missedChg', 10, N0),
  col('P12 unlocked inc.', 'pUnl', 10, N0), col('T12 unlocked inc.', 'tUnl', 10, N0),
  col('P12 wound obs', 'pWound', 10, N0), col('T12 wound obs', 'tWound', 10, N0), col('Wound Δ', 'wChg', 9, N0),
  col('Data flags', 'flags', 120),
], [yoyAll, yoyComp, ...yoyRows], { freezeX: 1 });
[2, 3].forEach((r) => { ysh.getRow(r).font = { bold: true }; });
ysh.addRow([]); ysh.addRow(['Falls with injury: not available for Viva (no matching IncidentType) — see Data Flags.']);

addSheet('Community Monthly', [
  col('Community', 'community', 42), col('Month', 'month', 10), col('Period', 'period', 8),
  col('Avg daily census', 'avgCensus', 12, N1), col('Month-end census', 'endCensus', 12, N0), col('Avg capacity', 'capacity', 11, N1), col('Occupancy %', 'occPct', 11, P1),
  col('Falls', 'falls', 8, N0), col('Falls w/ injury', 'fallsInjury', 10), col('Missed meds', 'missedMeds', 11, N0), col('Scheduled meds', 'schedMeds', 12, N0), col('Missed %', 'missedPct', 9, '0.00%'),
  col('Unlocked incidents', 'unlocked', 11, N0), col('Wound/skin obs', 'wounds', 11, N0),
], monthRows, { freezeX: 2 });

addSheet('Community Weekly', [
  col('Community', 'community', 42), col('Week ending (Sun)', 'weekEnding', 14), col('Month', 'month', 10), col('Period', 'period', 8),
  col('Avg daily census', 'avgCensus', 12, N1), col('Occupancy %', 'occPct', 11, P1), col('Falls', 'falls', 8, N0), col('Missed meds', 'missedMeds', 11, N0),
  col('Unlocked incidents', 'unlocked', 11, N0), col('Wound/skin obs', 'wounds', 11, N0),
], weekRows, { freezeX: 2 });

const snapRows = scope.map((c) => ({ community: c.communityName, ...(snapshotFor(c) || {}) }));
const tot = (k) => snapRows.reduce((s, r) => s + (r[k] || 0), 0);
addSheet(`Snapshot as of ${today}`, [
  col('Community', 'community', 44), col('Current residents w/ evaluation', 'residents', 14, N0), col('Past-due evaluations', 'pastDue', 12, N0),
  col('Alt: expired, not most-current, not completed', 'literal', 16, N0), col('Incomplete service plans (proxy)', 'incompletePlans', 14, N0),
], [{ community: 'PORTFOLIO', residents: tot('residents'), pastDue: tot('pastDue'), literal: tot('literal'), incompletePlans: tot('incompletePlans') }, ...snapRows]);

addSheet('Data Flags', [col('Community', 'community', 44), col('Metric', 'metric', 30), col('Issue', 'issue', 130)], flags);

const out = path.join(DIR, `Viva_YoY_Metrics_${today}.xlsx`);
wb.xlsx.writeFile(out).then(() => console.log('WROTE', out, `| communities ${scope.length}, flags ${flags.length}, comparable ${yoy.filter((y) => y.comparable).length}`));
