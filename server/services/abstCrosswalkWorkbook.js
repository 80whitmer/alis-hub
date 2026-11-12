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

function buildAbstCrosswalkWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';
  wb.created = new Date(report.meta.generatedAt);

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
    'Weekly caregiver minutes by resident (Staff time items only; PRN not multiplied)',
    [
      { header: 'Resident', width: 26 }, { header: 'Unit', width: 8 }, { header: 'Product', width: 11 },
      { header: 'Evaluation date', width: 12 }, { header: 'Evaluation reason', width: 18 }, { header: 'Care plan published', width: 12 },
      { header: 'Weekly caregiver minutes', width: 12 }, { header: 'Elements with staff time', width: 12 },
      { header: 'Minutes not yet configured', width: 12 }, { header: 'Not assessed', width: 10 },
    ],
    report.residents.map((r) => ({
      values: [
        r.name, r.unit, r.productType, r.evaluation?.date ?? '', r.evaluation?.reason ?? 'No completed evaluation', r.carePlanPublishDate ?? '',
        r.weeklyCaregiverMinutes,
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

module.exports = { buildAbstCrosswalkWorkbook };
