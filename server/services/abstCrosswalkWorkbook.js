const ExcelJS = require('exceljs');
const { STATUS, STATUS_LABEL } = require('./abstCrosswalk');

const TABLE_HEADER_ROW = 6;

/** Title block shared by every sheet: community, generated time, data-as-of, mandated line, optional footnote. */
function addHeaderBlock(ws, report, title, width) {
  const { meta } = report;
  const lines = [
    `${meta.communityName} — ${title}`,
    `Generated ${new Date(meta.generatedAt).toLocaleString('en-US')} · Data as of: ${meta.dataAsOf}`,
    meta.headerLine,
    meta.footnote || '',
  ];
  lines.forEach((t, i) => {
    ws.mergeCells(i + 1, 1, i + 1, Math.max(width, 4));
    const c = ws.getCell(i + 1, 1);
    c.value = t;
    c.font = { bold: i === 0, size: i === 0 ? 14 : 10, italic: i >= 2 };
  });
  ws.getRow(TABLE_HEADER_ROW - 1).height = 6;
}

function styleHeader(ws, width) {
  const row = ws.getRow(TABLE_HEADER_ROW);
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  ws.views = [{ state: 'frozen', ySplit: TABLE_HEADER_ROW }];
  ws.autoFilter = { from: { row: TABLE_HEADER_ROW, column: 1 }, to: { row: TABLE_HEADER_ROW, column: width } };
}

const FLAG_FILL = {
  [STATUS.GAP]: 'FFFFE699',
  [STATUS.NOT_ASSESSED]: 'FFF4B6B6',
};

function addTable(ws, report, title, columns, rows, opts = {}) {
  ws.columns = columns.map((c) => ({ width: c.width }));
  addHeaderBlock(ws, report, title, columns.length);
  ws.getRow(TABLE_HEADER_ROW).values = columns.map((c) => c.header);
  styleHeader(ws, columns.length);
  rows.forEach((r, i) => {
    const row = ws.getRow(TABLE_HEADER_ROW + 1 + i);
    row.values = r.values;
    row.alignment = { vertical: 'top', wrapText: true };
    if (r.fill) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.fill } }; });
  });
  if (opts.pageSetup !== false) {
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${TABLE_HEADER_ROW}:${TABLE_HEADER_ROW}` };
    ws.headerFooter = { oddHeader: `&L&9${report.meta.communityName}&R&9Generated ${new Date(report.meta.generatedAt).toLocaleDateString('en-US')}`, oddFooter: `&L&8${report.meta.headerLine}&R&8Page &P of &N` };
  }
}

function answerSummary(el) {
  return el.questions.flatMap((q) => q.answers.map((a) => a.answer)).join(' | ');
}

/** Drops residents of the given product types and recomputes both per-element summaries so counts stay consistent. */
function filterReport(report, { excludeProductTypes = [] } = {}) {
  if (!excludeProductTypes.length) return report;
  const residents = report.residents.filter((r) => !excludeProductTypes.includes(r.productType));
  const recount = (rows, statusOf) => rows.map((sm) => {
    const counts = Object.fromEntries(Object.keys(sm.counts).map((k) => [k, 0]));
    for (const r of residents) counts[statusOf(r, sm.id)]++;
    return { ...sm, counts, total: residents.length };
  });
  return {
    ...report,
    residents,
    summary: recount(report.summary, (r, id) => r.elements.find((e) => e.id === id).status),
    summaryCarePlan: recount(report.summaryCarePlan || report.summary, (r, id) => (r.carePlanView || r).elements.find((e) => e.id === id).status),
    meta: { ...report.meta, residentCount: residents.length },
  };
}

/** One minutes basis as a plain report: 'assessment' (the base data) or 'care_plan' (the care plan's own minutes x schedule). */
function projectBasis(report, basis) {
  if (basis !== 'care_plan') return report;
  const residents = report.residents.map((r) => ({
    ...r,
    elements: r.elements.map((e) => {
      const c = r.carePlanView.elements.find((x) => x.id === e.id);
      return { ...e, status: c.status, statusLabel: c.statusLabel, careRows: c.careRows, weeklyMinutes: c.weeklyMinutes, notes: c.notes, subTypes: c.subTypes || e.subTypes };
    }),
    weeklyCaregiverMinutes: r.carePlanView.weeklyCaregiverMinutes,
    averageDailyMinutes: r.carePlanView.averageDailyMinutes,
    totalCareItems: r.carePlanView.totalCareItems,
    prnItems: r.carePlanView.prnItems,
  }));
  return { ...report, residents, summary: report.summaryCarePlan || report.summary };
}

/**
 * Resident summary: one row per resident, one column per element, numbers only (the per-resident counterpart of the
 * community roll-up). Staff-time cells are average daily minutes (weekly / 7); other statuses are short codes.
 */
const ROLLUP_CODE = { independent: 'IND', outside: 'OUT', nurse: 'RN', not_applicable: 'N/A', assessed_no_minutes: 'TBD', not_assessed: '—' };
const ROLLUP_FILL = {
  staff_time: 'FFDCE8FB', independent: 'FFDDF3E3', outside: 'FFD5F0EE', nurse: 'FFE7DDF3',
  not_applicable: 'FFF0F0F0', assessed_no_minutes: 'FFFFE699', not_assessed: 'FFF4B6B6',
};
const ROLLUP_LEGEND = 'Number = average daily minutes (weekly / 7) for staff time · PRN = PRN only, not in totals · IND = independent · OUT = outside provider · RN = nurse task · N/A = does not apply · TBD = assistance assessed, minutes not yet configured · — = not assessed';

function rollupCell(el) {
  if (el.status === STATUS.STAFF_TIME) return el.weeklyMinutes > 0 ? Math.round((el.weeklyMinutes / 7) * 10) / 10 : 'PRN';
  return ROLLUP_CODE[el.status];
}

function addResidentSummarySheet(wb, report, sheetName, title) {
  const ws = wb.addWorksheet(sheetName);
  const elementIds = report.summary.map((s) => s.id);
  const columns = [
    { header: 'Resident', width: 26 }, { header: 'Unit', width: 7 }, { header: 'Product', width: 9 }, { header: 'Evaluation date', width: 11 },
    ...report.summary.map((s) => ({ header: `${s.id}. ${s.name}`, width: 11 })),
    { header: 'Average daily minutes', width: 11 }, { header: 'Weekly minutes', width: 10 }, { header: 'Average daily hours', width: 10 },
  ];
  const rows = report.residents.map((r) => ({
    values: [
      r.name, r.unit, r.productType, r.evaluation?.date ?? '',
      ...elementIds.map((id) => rollupCell(r.elements.find((e) => e.id === id))),
      r.averageDailyMinutes, r.weeklyCaregiverMinutes, round2(r.averageDailyMinutes / 60),
    ],
  }));
  addTable(ws, report, title, columns, rows);
  ws.getRow(TABLE_HEADER_ROW).height = 78;
  report.residents.forEach((r, i) => {
    const row = ws.getRow(TABLE_HEADER_ROW + 1 + i);
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    elementIds.forEach((id, k) => {
      const cell = row.getCell(5 + k);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROLLUP_FILL[r.elements.find((e) => e.id === id).status] } };
    });
    [5 + elementIds.length, 6 + elementIds.length, 7 + elementIds.length].forEach((c) => { row.getCell(c).font = { bold: true }; });
  });
  const legendRow = TABLE_HEADER_ROW + report.residents.length + 2;
  ws.mergeCells(legendRow, 1, legendRow, Math.min(columns.length, 20));
  ws.getCell(legendRow, 1).value = ROLLUP_LEGEND;
  ws.getCell(legendRow, 1).font = { italic: true, size: 9 };
  ws.getCell(legendRow, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(legendRow).height = 40;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: TABLE_HEADER_ROW }];
}

/** Minutes cells for one element: numbers for counted minutes, 0 for 0-minute statuses, blank where nothing is counted. */
function elementMinutes(el) {
  const staff = el.status === STATUS.STAFF_TIME;
  const counted = staff && el.weeklyMinutes > 0;
  const noMinutes = el.status === STATUS.GAP || el.status === STATUS.NOT_ASSESSED;
  return {
    daily: counted ? Math.round((el.weeklyMinutes / 7) * 10) / 10 : staff ? 'PRN' : noMinutes ? '' : 0,
    weekly: counted ? el.weeklyMinutes : staff || noMinutes ? '' : 0,
  };
}

const colLetter = (n) => {
  let out = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
  return out;
};

/**
 * One row per resident per element, numbers only (the list form of the vertical resident page), filterable by
 * resident. Row 5 totals the visible rows with SUBTOTAL, so filtering the Resident column to one resident totals that
 * resident and no filter totals the community. With two bases the sheet is one wide row per element (assessment and
 * care plan columns, plus the difference) so each column totals on its own.
 * reports: [{ label, rep }] — one entry per basis, same resident order.
 */
function addResidentListSheet(wb, reports, sheetName, title) {
  const ws = wb.addWorksheet(sheetName);
  const both = reports.length === 2;
  const rows = [];
  reports[0].rep.residents.forEach((r, ri) => {
    r.elements.forEach((el, ei) => {
      const parts = reports.map(({ rep }) => rep.residents[ri].elements[ei]);
      const cells = parts.flatMap((p) => {
        const m = elementMinutes(p);
        return [p.statusLabel, m.daily, m.weekly];
      });
      const wk = parts.map((p) => elementMinutes(p).weekly);
      const diff = both ? (typeof wk[0] === 'number' || wk[0] === 0) && (typeof wk[1] === 'number' || wk[1] === 0) ? round1(wk[0] - wk[1]) : '' : null;
      rows.push({
        values: [r.name, r.unit, r.productType, r.evaluation?.date ?? '', el.id, el.name, ...cells, ...(both ? [diff] : [])],
        fill: ROLLUP_FILL[parts[0].status],
      });
    });
  });
  const lead = [
    { header: 'Resident', width: 26 }, { header: 'Unit', width: 7 }, { header: 'Product', width: 9 }, { header: 'Evaluation date', width: 12 },
    { header: 'Element #', width: 9 }, { header: 'ODHS care element', width: 44 },
  ];
  const group = (suffix) => [
    { header: `Status${suffix}`, width: 32 }, { header: `Average daily minutes${suffix}`, width: 12 }, { header: `Weekly minutes${suffix}`, width: 12 },
  ];
  const columns = [...lead, ...group(both ? ' (assessment)' : ''), ...(both ? [...group(' (care plan)'), { header: 'Weekly difference (assessment minus care plan)', width: 14 }] : [])];
  addTable(ws, reports[0].rep, title, columns, rows);

  // Row 5: totals of the visible rows. SUBTOTAL(109) ignores rows hidden by the filter.
  const first = TABLE_HEADER_ROW + 1;
  const last = TABLE_HEADER_ROW + rows.length;
  const totalRow = ws.getRow(5);
  totalRow.height = 20;
  ws.mergeCells(5, 1, 5, lead.length);
  const label = ws.getCell(5, 1);
  label.value = 'Total of visible rows (filter the Resident column to total one resident)';
  label.font = { bold: true };
  label.alignment = { horizontal: 'right', vertical: 'middle' };
  const numericCols = both ? [lead.length + 2, lead.length + 3, lead.length + 5, lead.length + 6, lead.length + 7] : [lead.length + 2, lead.length + 3];
  for (const c of numericCols) {
    const L = colLetter(c);
    const result = rows.reduce((sum, rw) => sum + (typeof rw.values[c - 1] === 'number' ? rw.values[c - 1] : 0), 0);
    const cell = ws.getCell(5, c);
    cell.value = { formula: `SUBTOTAL(109,${L}${first}:${L}${last})`, result: Math.round(result * 10) / 10 };
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

const BASIS_LABEL = { assessment: 'Assessment basis', care_plan: 'Care plan basis' };

/** Excel sheet names: <= 31 chars, none of []:*?/\, no edge apostrophes, unique. */
function uniqueSheetName(base, taken) {
  const clean = String(base).replace(/[\[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Resident';
  let name = clean;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = clean.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/**
 * One tab per resident (22 elements, numbers only, with totals) plus an Index sheet that links to every tab.
 * basis: 'assessment' | 'care_plan' | 'both' (both = status/minutes for each basis side by side).
 */
function buildResidentTabsWorkbook(report, basis = 'assessment') {
  const bases = basis === 'both' ? ['assessment', 'care_plan'] : [basis === 'care_plan' ? 'care_plan' : 'assessment'];
  const both = bases.length === 2;
  const projected = bases.map((b) => projectBasis(report, b));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  wb.created = new Date(report.meta.generatedAt);

  const taken = new Set(['index']);
  const sheetNames = report.residents.map((r) => uniqueSheetName(r.name, taken));

  // Index
  const index = wb.addWorksheet('Index');
  const idxCols = [
    { header: 'Resident (click to open tab)', width: 30 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 10 }, { header: 'Evaluation date', width: 13 },
    { header: `Average daily minutes${both ? ' (assessment)' : ''}`, width: 14 }, { header: `Weekly minutes${both ? ' (assessment)' : ''}`, width: 14 },
    ...(both ? [{ header: 'Average daily minutes (care plan)', width: 14 }, { header: 'Weekly minutes (care plan)', width: 14 }] : []),
  ];
  const idxRows = report.residents.map((r, i) => ({
    values: [
      { text: r.name, hyperlink: `#'${sheetNames[i]}'!A1` }, r.unit, r.productType, r.evaluation?.date ?? '',
      projected[0].residents[i].averageDailyMinutes, projected[0].residents[i].weeklyCaregiverMinutes,
      ...(both ? [projected[1].residents[i].averageDailyMinutes, projected[1].residents[i].weeklyCaregiverMinutes] : []),
    ],
  }));
  addTable(index, report, `Resident index: one tab per resident, ${both ? 'assessment and care plan basis' : BASIS_LABEL[bases[0]].toLowerCase()}`, idxCols, idxRows);
  const lastIdx = TABLE_HEADER_ROW + idxRows.length;
  index.getRows(TABLE_HEADER_ROW + 1, idxRows.length).forEach((row) => { row.getCell(1).font = { color: { argb: 'FF1F5FBF' }, underline: true }; });
  const totRow = index.getRow(lastIdx + 1);
  totRow.getCell(1).value = `Community total (${idxRows.length} residents, visible rows)`;
  totRow.getCell(1).font = { bold: true };
  const totCols = both ? [5, 6, 7, 8] : [5, 6];
  for (const c of totCols) {
    const L = colLetter(c);
    totRow.getCell(c).value = {
      formula: `SUBTOTAL(109,${L}${TABLE_HEADER_ROW + 1}:${L}${lastIdx})`,
      result: Math.round(idxRows.reduce((sum, r) => sum + (typeof r.values[c - 1] === 'number' ? r.values[c - 1] : 0), 0) * 10) / 10,
    };
    totRow.getCell(c).font = { bold: true };
  }

  // One tab per resident
  report.residents.forEach((r, i) => {
    const ws = wb.addWorksheet(sheetNames[i]);
    const cols = [
      { header: '#', width: 5 }, { header: 'Care element', width: 46 },
      ...bases.flatMap((b) => [
        { header: `Status${both ? ` (${b === 'assessment' ? 'assessment' : 'care plan'})` : ''}`, width: 32 },
        { header: 'Average daily minutes', width: 12 }, { header: 'Weekly minutes', width: 12 },
      ]),
    ];
    const rows = r.elements.map((el, ei) => ({
      values: [el.id, el.name, ...projected.flatMap((p) => {
        const e = p.residents[i].elements[ei];
        const m = elementMinutes(e);
        return [e.statusLabel, m.daily, m.weekly];
      })],
      fill: ROLLUP_FILL[projected[0].residents[i].elements[ei].status],
    }));
    const unitText = r.unit ? `Unit ${r.unit}` : 'Unit —';
    addTable(ws, report, `${r.name} · ${unitText} · ${r.productType} · Latest completed evaluation ${r.evaluation ? `${r.evaluation.date}${r.evaluation.reason ? ` (${r.evaluation.reason})` : ''}` : 'none on file'}`, cols, rows);
    ws.autoFilter = undefined;
    const lastRow = TABLE_HEADER_ROW + rows.length;
    const tot = ws.getRow(lastRow + 1);
    tot.getCell(2).value = 'Total caregiver minutes (average daily = weekly / 7; PRN not included)';
    tot.getCell(2).font = { bold: true };
    bases.forEach((b, k) => {
      const dCol = 4 + k * 3;
      const wCol = 5 + k * 3;
      const rr = projected[k].residents[i];
      tot.getCell(dCol).value = { formula: `SUM(${colLetter(dCol)}${TABLE_HEADER_ROW + 1}:${colLetter(dCol)}${lastRow})`, result: rr.averageDailyMinutes };
      tot.getCell(wCol).value = { formula: `SUM(${colLetter(wCol)}${TABLE_HEADER_ROW + 1}:${colLetter(wCol)}${lastRow})`, result: rr.weeklyCaregiverMinutes };
      tot.getCell(dCol).font = { bold: true };
      tot.getCell(wCol).font = { bold: true };
      tot.getCell(dCol).alignment = { horizontal: 'center' };
      tot.getCell(wCol).alignment = { horizontal: 'center' };
      if (both) tot.getCell(dCol - 1).value = b === 'assessment' ? 'Assessment basis' : 'Care plan basis';
    });
    const note = ws.getRow(lastRow + 3);
    ws.mergeCells(lastRow + 3, 1, lastRow + 3, cols.length);
    note.getCell(1).value = ROLLUP_LEGEND.replace('Number = average daily minutes (weekly / 7) for staff time · PRN = PRN only, not in totals · IND = independent · OUT = outside provider · RN = nurse task · N/A = does not apply · TBD = assistance assessed, minutes not yet configured · — = not assessed', 'Average daily minutes = weekly / 7. PRN-only elements show PRN and are not in totals. Assistance assessed with no minutes set up is left blank and flagged in Status.');
    note.getCell(1).font = { italic: true, size: 9 };
    ws.getRow(lastRow + 5).getCell(1).value = { text: '← Back to index', hyperlink: "#'Index'!A1" };
    ws.getRow(lastRow + 5).getCell(1).font = { color: { argb: 'FF1F5FBF' }, underline: true };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  });
  return wb;
}

/** Just the one resident (regardless of product type), for a single-resident export. */
function selectResident(report, residentId) {
  const residents = report.residents.filter((r) => String(r.residentId) === String(residentId));
  return { ...report, residents, meta: { ...report.meta, residentCount: residents.length } };
}

/**
 * A workbook with only the "Resident by element" sheet (one row per resident per element, numbers only,
 * filterable by resident). basis: 'assessment' | 'care_plan' | 'both'.
 */
function buildResidentListWorkbook(report, basis = 'assessment') {
  const bases = basis === 'both' ? ['assessment', 'care_plan'] : [basis === 'care_plan' ? 'care_plan' : 'assessment'];
  const both = bases.length === 2;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  wb.created = new Date(report.meta.generatedAt);
  const single = report.residents.length === 1 ? `${report.residents[0].name}: ` : '';
  const basisTitle = both ? 'assessment basis and care plan basis side by side' : BASIS_LABEL[bases[0]].toLowerCase();
  addResidentListSheet(
    wb,
    bases.map((b) => ({ label: BASIS_LABEL[b], rep: projectBasis(report, b) })),
    'Resident by element',
    `${single}Resident by element, numbers only, ${basisTitle}${single ? '' : ". Filter the Resident column for one resident's 22 elements"}`
  );
  return wb;
}

/**
 * Survey-facing workbook. basis: 'assessment' | 'care_plan' | 'both' (internal side-by-side comparison).
 * One row per care item per element; no setup-gap or care-item-detail sheets. A missing care item usually just
 * means Independent or an outside provider, both fine at 0 minutes.
 */
function buildSurveyorWorkbook(report, basis = 'assessment') {
  const bases = basis === 'both' ? ['assessment', 'care_plan'] : [basis === 'care_plan' ? 'care_plan' : 'assessment'];
  const both = bases.length === 2;
  const projected = bases.map((b) => ({ b, rep: projectBasis(report, b) }));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  wb.created = new Date(report.meta.generatedAt);
  const lead = both ? ['Basis'] : [];
  const leadW = both ? [{ width: 16 }] : [];
  const basisTitle = both ? 'assessment basis and care plan basis side by side' : `${BASIS_LABEL[bases[0]].toLowerCase()}`;

  // 0. Resident summary (the clean, numbers-only view; first sheet)
  for (const { b, rep } of projected) {
    addResidentSummarySheet(wb, rep, both ? `Resident summary - ${b === 'assessment' ? 'assessment' : 'care plan'}` : 'Resident summary', `Resident summary by element, ${BASIS_LABEL[b].toLowerCase()}`);
  }

  addResidentListSheet(wb, projected.map(({ b, rep }) => ({ label: BASIS_LABEL[b], rep })), 'Resident by element (list)', `Resident by element, numbers only, ${basisTitle}. Filter the Resident column for one resident's 22 elements`);

  // 1. Resident x Element
  const detail = [];
  for (const { b, rep } of projected) {
    for (const r of rep.residents) {
      for (const el of r.elements) {
        el.careRows.forEach((cr, i) => detail.push({
          values: [
            ...(both ? [BASIS_LABEL[b]] : []),
            r.name, r.unit, r.productType, r.evaluation?.date ?? '', r.evaluation?.reason ?? '', el.id, el.name,
            i === 0 ? answerSummary(el) : '', cr.name, cr.schedule, cr.prn ? 'PRN' : '',
            cr.prn || cr.source === 'care_plan_only' ? '' : (cr.minutesPerOccurrence ?? 'Not yet configured'),
            cr.prn ? (cr.minutesPerOccurrence ?? '') : '',
            cr.prn || cr.weeklyMinutes == null ? '' : cr.weeklyMinutes,
            el.statusLabel,
            cr.source === 'assessment' ? 'Assessment answer' : cr.source === 'care_plan_only' ? 'Care plan only (not counted)' : cr.source === 'care_plan' ? 'Care plan' : '',
          ],
          fill: FLAG_FILL[el.status],
        }));
      }
    }
  }
  addTable(
    wb.addWorksheet('Resident x Element'),
    report,
    `Oregon ABST crosswalk, ${basisTitle}`,
    [
      ...lead.map((h, i) => ({ header: h, ...leadW[i] })),
      { header: 'Resident', width: 24 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 },
      { header: 'Evaluation date', width: 12 }, { header: 'Evaluation reason', width: 16 },
      { header: 'Element #', width: 8 }, { header: 'ODHS care element', width: 32 },
      { header: 'Assessment answer(s)', width: 56 }, { header: 'Care item', width: 40 }, { header: 'Schedule', width: 18 }, { header: 'PRN', width: 6 },
      { header: 'Minutes per scheduled day', width: 12 }, { header: 'PRN minutes per occurrence', width: 12 }, { header: 'Weekly minutes', width: 10 },
      { header: 'Status', width: 30 }, { header: 'Source', width: 22 },
    ],
    detail
  );

  // 2. Community summary
  const statusOrder = [STATUS.STAFF_TIME, STATUS.INDEPENDENT, STATUS.NURSE, STATUS.OUTSIDE, STATUS.NOT_APPLICABLE, STATUS.GAP, STATUS.NOT_ASSESSED];
  const summaryRows = [];
  for (const { b, rep } of projected) {
    for (const s of rep.summary) {
      summaryRows.push({
        values: [...(both ? [BASIS_LABEL[b]] : []), s.id, s.name, ...statusOrder.map((k) => s.counts[k]), s.total],
        fill: s.counts[STATUS.GAP] || s.counts[STATUS.NOT_ASSESSED] ? 'FFFFF2CC' : undefined,
      });
    }
  }
  addTable(
    wb.addWorksheet('Community summary'),
    report,
    'Residents by status for each element (every resident must appear in every element)',
    [...(both ? [{ header: 'Basis', width: 16 }] : []), { header: '#', width: 5 }, { header: 'ODHS care element', width: 44 }, ...statusOrder.map((s) => ({ header: STATUS_LABEL[s], width: 18 })), { header: 'Total residents', width: 12 }],
    summaryRows
  );

  // 3. Resident totals
  const base = projected[0].rep;
  const other = both ? projected[1].rep : null;
  const totalsRows = base.residents.map((r, i) => {
    const o = other ? other.residents[i] : null;
    return {
      values: [
        r.name, r.unit, r.productType, r.evaluation?.date ?? '', r.evaluation?.reason ?? 'No completed evaluation', r.carePlanPublishDate ?? '',
        r.totalCareItems, r.weeklyCaregiverMinutes, r.averageDailyMinutes, round2(r.averageDailyMinutes / 60),
        ...(o ? [o.weeklyCaregiverMinutes, o.averageDailyMinutes, round1(r.weeklyCaregiverMinutes - o.weeklyCaregiverMinutes)] : []),
      ],
    };
  });
  const tl = both ? 'assessment ' : '';
  addTable(
    wb.addWorksheet('Resident totals'),
    report,
    'Caregiver minutes by resident: weekly = care item minutes (per day) x days per week; average daily = weekly / 7. PRN and times-per-day are not multiplied',
    [
      { header: 'Resident', width: 26 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 },
      { header: 'Evaluation date', width: 12 }, { header: 'Evaluation reason', width: 18 }, { header: 'Care plan published', width: 12 },
      { header: 'Total care items', width: 10 }, { header: `Weekly caregiver minutes${both ? ' (assessment)' : ''}`, width: 14 },
      { header: `Average daily minutes${both ? ' (assessment)' : ''}`, width: 14 }, { header: `Average daily hours${both ? ' (assessment)' : ''}`, width: 12 },
      ...(both ? [{ header: 'Weekly caregiver minutes (care plan)', width: 14 }, { header: 'Average daily minutes (care plan)', width: 14 }, { header: 'Difference in weekly minutes (assessment minus care plan)', width: 16 }] : []),
    ],
    totalsRows
  );

  // 4. Roster layout (one sheet per basis)
  for (const { b, rep } of projected) {
    const roster = [];
    for (const r of rep.residents) {
      for (const el of r.elements) {
        for (const cr of el.careRows) {
          roster.push({
            values: [r.name, report.meta.communityName, cr.source === 'care_plan' ? (cr.label || 'ABST') : cr.source === 'assessment' ? 'Assessment answer' : cr.source === 'care_plan_only' ? 'Care plan (not counted)' : '',
              cr.name, cr.prn ? 'prn' : cr.schedule, cr.prn || cr.source === 'care_plan_only' ? '' : (cr.minutesPerOccurrence ?? 'Not yet configured'),
              cr.prn ? (cr.minutesPerOccurrence ?? '') : '',
              cr.prn || cr.minutesPerOccurrence == null || cr.source === 'care_plan_only' ? '' : round2(cr.minutesPerOccurrence / 60)],
            fill: FLAG_FILL[el.status],
          });
        }
      }
      roster.push({
        values: [`${r.name} Total`, '', '', `Total Care Items: ${r.totalCareItems}`, '', `Avg Daily Mins: ${r.averageDailyMinutes}`, `PRN items: ${r.prnItems} (per occurrence, not in totals)`, `Avg Daily Hrs: ${round2(r.averageDailyMinutes / 60)}`],
        fill: 'FFE7EEF7',
      });
    }
    addTable(
      wb.addWorksheet(both ? (b === 'assessment' ? 'Roster - assessment basis' : 'Roster - care plan basis') : 'Roster (HQ layout)'),
      report,
      `Care item roster in the ALIS HQ layout, ${BASIS_LABEL[b].toLowerCase()}. Totals are average daily minutes (weekly / 7); PRN is per occurrence and not multiplied`,
      [
        { header: 'Resident', width: 26 }, { header: 'Community', width: 28 }, { header: 'Care Item Label', width: 18 },
        { header: 'Care Item', width: 46 }, { header: 'Schedule', width: 22 }, { header: 'Estimated Mins (per scheduled day)', width: 16 },
        { header: 'Estimated Mins - PRN (per occurrence)', width: 16 }, { header: 'Estimated Hrs (per scheduled day)', width: 14 },
      ],
      roster
    );
  }
  return wb;
}

/**
 * surveyor = true: the survey-facing export — one row per resident per element, no care plan item
 * columns or care-item-level sheets (a missing care item usually just means Independent or an outside
 * provider, both fine at 0 minutes). The full internal workbook keeps the care item detail.
 */
function buildInternalWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  wb.created = new Date(report.meta.generatedAt);

  addResidentSummarySheet(wb, report, 'Resident summary - assessment', 'Resident summary by element, assessment basis');
  if (report.residents[0]?.carePlanView) addResidentSummarySheet(wb, projectBasis(report, 'care_plan'), 'Resident summary - care plan', 'Resident summary by element, care plan basis');

  addResidentListSheet(wb, [{ label: 'Assessment basis', rep: report }], 'Resident by element (list)', 'Resident by element, numbers only, assessment basis. Filter the Resident column for one resident');

  // 1. One row per resident per element (per care plan item where an element has several)
  const detail = [];
  for (const r of report.residents) {
    for (const el of r.elements) {
      const base = [
        r.name, r.unit, r.productType, r.evaluation?.date ?? '', r.evaluation?.reason ?? '', r.carePlanPublishDate ?? '',
        el.id, el.name, el.questions.filter((q) => q.answered).map((q) => q.text).join('; '), answerSummary(el),
        el.statusLabel,
      ];
      const fill = FLAG_FILL[el.status];
      const note = el.notes.join(' ');
      if (!el.careItems.length) {
        detail.push({ values: [...base, '', '', '', '', '', '', '', note], fill });
      } else {
        el.careItems.forEach((it, i) => detail.push({
          values: [
            ...base, it.name, it.category ?? '', it.label ?? '', it.schedule, it.prn ? 'PRN' : '',
            it.minutesPerOccurrence ?? '',
            it.prn || it.weeklyMinutes == null ? '' : (it.countsAsCaregiver ? it.weeklyMinutes : 0),
            [i === 0 ? note : '', it.excludedReason, it.periodic ? 'Monthly schedule: per-occurrence minutes only, not in weekly total.' : '', it.duplicateName ? 'Name exists in more than one category in Care Settings; ABST copy used.' : ''].filter(Boolean).join(' '),
          ],
          fill,
        }));
      }
    }
  }
  addTable(
    wb.addWorksheet('Resident x Element'),
    report,
    'Oregon ABST crosswalk, one row per resident per element',
    [
      { header: 'Resident', width: 24 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 },
      { header: 'Evaluation date', width: 12 }, { header: 'Evaluation reason', width: 16 }, { header: 'Care plan published', width: 12 },
      { header: 'Element #', width: 8 }, { header: 'ODHS care element', width: 30 }, { header: 'Assessment question(s)', width: 34 },
      { header: 'Assessment answer(s)', width: 50 }, { header: 'Status', width: 30 },
      { header: 'Care item', width: 38 }, { header: 'Care category', width: 14 }, { header: 'Reporting label', width: 10 },
      { header: 'Schedule', width: 18 }, { header: 'PRN', width: 6 }, { header: 'Min per occurrence', width: 10 },
      { header: 'Weekly minutes', width: 10 }, { header: 'Notes', width: 50 },
    ],
    detail
  );

  // 2. Community summary: element x status counts
  const statusOrder = [STATUS.STAFF_TIME, STATUS.INDEPENDENT, STATUS.NURSE, STATUS.OUTSIDE, STATUS.NOT_APPLICABLE, STATUS.GAP, STATUS.NOT_ASSESSED];
  addTable(
    wb.addWorksheet('Community summary'),
    report,
    'Residents by status for each element (every resident must appear in every element)',
    [{ header: '#', width: 5 }, { header: 'ODHS care element', width: 44 }, ...statusOrder.map((s) => ({ header: STATUS_LABEL[s], width: 18 })), { header: 'Total residents', width: 12 }],
    report.summary.map((s) => ({
      values: [s.id, s.name, ...statusOrder.map((k) => s.counts[k]), s.total],
      fill: s.counts[STATUS.GAP] || s.counts[STATUS.NOT_ASSESSED] ? 'FFFFF2CC' : undefined,
    }))
  );

  // 3. Resident totals
  addTable(
    wb.addWorksheet('Resident totals'),
    report,
    'Caregiver minutes by resident: weekly = care item minutes (per day) x days per week; average daily = weekly / 7. PRN and times-per-day are not multiplied',
    [
      { header: 'Resident', width: 26 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 },
      { header: 'Evaluation date', width: 12 }, { header: 'Evaluation reason', width: 18 }, { header: 'Care plan published', width: 12 },
      { header: 'Total care items', width: 10 }, { header: 'Weekly caregiver minutes', width: 12 }, { header: 'Average daily minutes', width: 12 }, { header: 'Average daily hours', width: 12 }, { header: 'Elements with staff time', width: 12 },
      { header: 'Minutes not yet configured', width: 12 }, { header: 'Not assessed', width: 10 },
    ],
    report.residents.map((r) => ({
      values: [
        r.name, r.unit, r.productType, r.evaluation?.date ?? '', r.evaluation?.reason ?? 'No completed evaluation', r.carePlanPublishDate ?? '',
        r.totalCareItems, r.weeklyCaregiverMinutes, r.averageDailyMinutes, round2(r.averageDailyMinutes / 60),
        r.elements.filter((e) => e.status === STATUS.STAFF_TIME).length,
        r.elements.filter((e) => e.status === STATUS.GAP).length,
        r.elements.filter((e) => e.status === STATUS.NOT_ASSESSED).length,
      ],
    }))
  );


  // 4. HQ roster format, for reconciliation with "Resident Roster with Care Plan Items" in ALIS HQ
  const hq = [];
  for (const r of report.residents) {
    for (const el of r.elements) {
      for (const it of el.careItems) {
        hq.push({
          values: [r.name, report.meta.communityName, it.label ?? '', it.name, it.prn ? 'prn' : it.schedule,
            it.prn ? '' : (it.weeklyMinutes ?? ''), it.prn ? (it.minutesPerOccurrence ?? '') : '',
            it.prn || it.weeklyMinutes == null ? '' : round2(it.weeklyMinutes / 60)],
        });
      }
    }
  }
  addTable(
    wb.addWorksheet('Care plan items (HQ layout)'),
    report,
    'ABST care plan items in the HQ roster layout. Weekly minutes are minutes x scheduled occurrences; PRN shows per-occurrence minutes only',
    [
      { header: 'Resident', width: 26 }, { header: 'Community', width: 28 }, { header: 'Care Item Label', width: 12 },
      { header: 'Care Item', width: 44 }, { header: 'Schedule', width: 20 }, { header: 'Estimated Mins (weekly)', width: 14 },
      { header: 'Estimated Mins - PRN (per occurrence)', width: 16 }, { header: 'Estimated Hrs (weekly)', width: 12 },
    ],
    hq
  );

  // 5. Setup gaps
  const gaps = [];
  for (const r of report.residents) {
    for (const el of r.elements) {
      if (el.status === STATUS.GAP || el.status === STATUS.NOT_ASSESSED) {
        gaps.push({ values: [r.name, r.unit, r.productType, el.id, el.name, el.statusLabel, answerSummary(el), el.notes.join(' ')], fill: FLAG_FILL[el.status] });
      }
    }
  }
  addTable(
    wb.addWorksheet('Setup gaps'),
    report,
    '"Assistance assessed, minutes not yet configured" and "Not assessed"',
    [
      { header: 'Resident', width: 26 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 }, { header: 'Element #', width: 8 },
      { header: 'ODHS care element', width: 40 }, { header: 'Status', width: 34 }, { header: 'Assessment answer(s)', width: 60 }, { header: 'Notes', width: 50 },
    ],
    gaps
  );

  // 6. ABST care plan items that no element claims
  const orphans = [];
  for (const r of report.residents) {
    for (const it of r.unassignedAbstItems) orphans.push({ values: [r.name, it.name, it.schedule, it.minutesPerOccurrence ?? '', 'ABST item not mapped to any of the 22 elements (edit the element config to place it)'] });
    for (const it of r.ambiguousDuplicateItems || []) orphans.push({ values: [r.name, it.name, it.schedule, it.minutesPerOccurrence ?? '', 'Name exists in two Care Settings categories and the plan row is at 0 minutes: treated as the older non-ABST copy, not counted'] });
    for (const it of r.itemsNotInCatalog) orphans.push({ values: [r.name, it.name, it.schedule, it.minutesPerOccurrence ?? '', 'Care item not found in the Care Settings catalog'] });
  }
  addTable(
    wb.addWorksheet('Unmapped items'),
    report,
    'Care plan items not placed under an element',
    [{ header: 'Resident', width: 26 }, { header: 'Care item', width: 44 }, { header: 'Schedule', width: 20 }, { header: 'Min per occurrence', width: 12 }, { header: 'Reason', width: 70 }],
    orphans
  );

  return wb;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

/** surveyor: survey-facing workbook (basis: assessment | care_plan | both). Otherwise the full internal workbook. */
function buildAbstCrosswalkWorkbook(report, { surveyor = false, basis = 'assessment' } = {}) {
  return surveyor ? buildSurveyorWorkbook(report, basis) : buildInternalWorkbook(report);
}

module.exports = { buildAbstCrosswalkWorkbook, buildResidentListWorkbook, buildResidentTabsWorkbook, selectResident, filterReport, projectBasis };
