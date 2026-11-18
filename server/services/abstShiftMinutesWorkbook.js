const ExcelJS = require('exceljs');

const HEADER_ROW = 6;
const NAVY = 'FF1F3A5F';

function titleBlock(ws, m, title, width) {
  const lines = [
    `${m.communityName} — ${title}`,
    `Care dates ${m.start} to ${m.end} (${m.dayCount} days) · Generated ${new Date(m.generatedAt).toLocaleString('en-US')} · ALIS export API`,
    `Method: ${m.method}`,
    m.excludeIndependent ? 'Independent-living residents are not included.' : '',
  ];
  lines.forEach((t, i) => {
    ws.mergeCells(i + 1, 1, i + 1, Math.max(width, 4));
    const c = ws.getCell(i + 1, 1);
    c.value = t;
    c.font = { bold: i === 0, size: i === 0 ? 14 : 10, italic: i >= 2 };
    c.alignment = { wrapText: true, vertical: 'top' };
  });
  ws.getRow(3).height = 54;
}

function styleHeader(ws, width) {
  const row = ws.getRow(HEADER_ROW);
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c === 1 ? 'left' : 'center' };
  }
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` };
}

function hoursLabel(hours) {
  if (!hours || !hours.length) return '';
  const pad = (h) => String(h).padStart(2, '0') + ':00';
  // contiguous runs, merged across midnight (22-23 + 0-5 -> 22:00-06:00)
  const set = new Set(hours);
  const wraps = set.has(0) && set.has(23);
  const ordered = wraps ? [...hours.filter((h) => h >= 12), ...hours.filter((h) => h < 12)] : hours;
  const runs = [];
  for (const h of ordered) {
    const last = runs[runs.length - 1];
    if (last && (h === (last[1] + 1) % 24)) last[1] = h; else runs.push([h, h]);
  }
  return runs.map(([a, b]) => `${pad(a)}–${pad((b + 1) % 24)}`).join(', ');
}

/** @param {object} data result of buildShiftMinutes() */
function buildShiftMinutesWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  const m = data.meta;
  const shifts = m.shifts;

  // ── Sheet 1: daily minutes by shift ──
  const ws = wb.addWorksheet('Daily minutes by shift');
  const cols = ['Date', 'Day', ...shifts.map((s) => `${s} (min)`), 'Total (min)', 'Scheduled tasks', 'Residents with tasks'];
  ws.columns = cols.map((c, i) => ({ width: i === 0 ? 13 : i === 1 ? 12 : 16 }));
  titleBlock(ws, m, 'ABST estimated staff minutes per shift, per day', cols.length);
  ws.getRow(HEADER_ROW).values = cols;
  styleHeader(ws, cols.length);
  data.daily.forEach((d, i) => {
    const row = ws.getRow(HEADER_ROW + 1 + i);
    row.values = [d.date, d.weekday, ...d.shifts.map((c) => c.minutes), d.totalMinutes, d.totalTasks, d.residents];
    for (let c = 3; c <= cols.length; c++) row.getCell(c).numFmt = '#,##0';
    row.getCell(2 + shifts.length + 1).font = { bold: true };
  });
  const base = HEADER_ROW + 1 + data.daily.length;
  const sumRow = ws.getRow(base);
  sumRow.values = ['Total', '', ...data.totals.map((t) => t.minutes), data.grandTotalMinutes];
  const avgRow = ws.getRow(base + 1);
  avgRow.values = ['Average per day', '', ...data.totals.map((t) => t.averagePerDay), data.averageDailyMinutes];
  for (const r of [sumRow, avgRow]) {
    r.font = { bold: true };
    for (let c = 3; c <= 2 + shifts.length + 1; c++) r.getCell(c).numFmt = '#,##0';
    r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F8' } }; });
  }
  let n = base + 3;
  ws.getCell(n, 1).value = 'Shift definitions (task times observed in ALIS)';
  ws.getCell(n++, 1).font = { bold: true };
  shifts.forEach((s) => { ws.getCell(n, 1).value = s; ws.getCell(n++, 2).value = hoursLabel(m.observedHours[s]); });

  // ── Sheet 2: care item x shift ──
  const wi = wb.addWorksheet('By care item');
  const icols = ['Care item', 'Minutes per occurrence', ...shifts.map((s) => `${s} (min)`), 'Total (min)', 'Scheduled tasks'];
  wi.columns = icols.map((c, i) => ({ width: i === 0 ? 60 : 16 }));
  titleBlock(wi, m, 'ABST estimated minutes by care item and shift (whole date range)', icols.length);
  wi.getRow(HEADER_ROW).values = icols;
  styleHeader(wi, icols.length);
  data.items.forEach((it, i) => {
    const row = wi.getRow(HEADER_ROW + 1 + i);
    row.values = [it.name, it.perOccurrence, ...shifts.map((s) => it.byShift[s] || 0), it.minutes, it.tasks];
    for (let c = 3; c <= 2 + shifts.length + 1; c++) row.getCell(c).numFmt = '#,##0';
  });

  // ── Sheet 3: PRN ──
  const wp = wb.addWorksheet('PRN (not in totals)');
  const pcols = ['PRN care item', 'Times scheduled in range', 'Minutes per occurrence'];
  wp.columns = pcols.map((c, i) => ({ width: i === 0 ? 60 : 24 }));
  titleBlock(wp, m, 'PRN ABST care items (shown per occurrence; not included in shift totals)', pcols.length);
  wp.getRow(HEADER_ROW).values = pcols;
  styleHeader(wp, pcols.length);
  if (!data.prn.length) wp.getRow(HEADER_ROW + 1).values = ['No PRN ABST tasks in this range', '', ''];
  data.prn.forEach((p, i) => { wp.getRow(HEADER_ROW + 1 + i).values = [p.name, p.occurrences, p.minutesPerOccurrence]; });

  return wb;
}

module.exports = { buildShiftMinutesWorkbook };
