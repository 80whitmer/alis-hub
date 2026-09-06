/**
 * Exports a company-usage-audit snapshot to .xlsx — one sheet, features as
 * rows (grouped by category, matching the on-screen order) and one
 * Enabled/Used column pair per community, colored the same way as the RAG
 * dots in UsageAuditDashboard.jsx so this reads as a portable copy of the
 * on-screen grid rather than a re-derived report.
 *
 * Contracted is intentionally omitted — see UsageAuditDashboard.jsx's note
 * on why that column isn't shown for now (missing HubSpot scopes).
 */
import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const CELL_FILL = {
  true: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } },   // success-tinted
  false: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E7' } },  // error-tinted
  null: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },   // neutral
};
const CELL_TEXT = { true: 'Yes', false: 'No', null: '—' };

function stateKey(v) {
  return v === true ? 'true' : v === false ? 'false' : 'null';
}

const SECTION_FONT = { bold: true, size: 12, color: { argb: 'FF2F5D50' } };
const SUBHEAD_FONT = { bold: true };
const TABLE_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F3' } };

function addExplanationSheet(workbook, snapshot) {
  const sheet = workbook.addWorksheet('Explanation');
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 90;

  const title = sheet.addRow([`Company/Community ALIS Usage Audit — ${snapshot.companyName}`]);
  title.getCell(1).font = { bold: true, size: 14 };
  sheet.mergeCells(`A${title.number}:B${title.number}`);

  const hostsLabel = snapshot.hosts.length > 1 ? `${snapshot.hosts.length} ALIS hosts (${snapshot.hosts.join(', ')})` : `"${snapshot.hosts[0]}"`;
  sheet.addRow([`Generated ${new Date(snapshot.generatedAt).toLocaleString()} · ${snapshot.communities.length} communit${snapshot.communities.length === 1 ? 'y' : 'ies'} on ${hostsLabel}`]);
  sheet.addRow([]);

  const dateRangeHead = sheet.addRow(['Date range pulled']);
  dateRangeHead.getCell(1).font = SECTION_FONT;
  sheet.addRow([
    'Lookback window',
    snapshot.usageWindow
      ? `${snapshot.usageWindow.startDate} to ${snapshot.usageWindow.endDate} (${snapshot.lookbackDays} days, ending the day this audit ran)`
      : `Last ${snapshot.lookbackDays} days (exact dates not recorded — this audit predates that being tracked; rerun for a precise range)`,
  ]);
  sheet.addRow([
    '',
    'This is the window used for every date-scoped "Used" count below. A few signals are NOT date-limited — they reflect current/full-history data instead — see the "What each Used number counts" table, which calls those out explicitly.',
  ]).getCell(2).alignment = { wrapText: true };
  sheet.addRow([]);

  const columnsHead = sheet.addRow(['What each column means']);
  columnsHead.getCell(1).font = SECTION_FONT;
  const colTableHeader = sheet.addRow(['Column', 'Meaning']);
  colTableHeader.eachCell((cell) => { cell.font = SUBHEAD_FONT; cell.fill = TABLE_HEADER_FILL; });
  const columnMeanings = [
    ['Category', 'The feature grouping from the original 2024 roadmap tracker (Prospects, Residents, Medications, Care, Staff, Billing, Communities, Reports).'],
    ['Feature', 'One tracked ALIS feature/module. A "core" tag means no ALIS entitlement flag exists for it — it\'s presumed always available, not gated. A "?" tag means the mapping to an ALIS entitlement flag is a best guess with 2+ candidates — see Feature notes in the on-screen dashboard for detail.'],
    ['Mapping', 'How confident the feature → entitlement-flag mapping is: "confident" (clean name match), "ambiguous" (multiple candidate flags, unconfirmed), or "ungated" (no flag exists — presumed always-on).'],
    ['{Community} — Enabled', 'Yes / No / — (not scraped). Read from the ALIS Entitlements admin page for the community\'s host, EXCEPT: if the Used column shows real activity, Enabled is shown as Yes regardless of the raw entitlement flag — real usage is stronger evidence of "enabled" than our own flag mapping, and self-corrects a wrong or ambiguous mapping (see the Resident Evaluation Tool row for a real example of this).'],
    ['{Community} — Used', 'A record count if this feature has a usage signal defined, otherwise — (no signal defined yet — not the same as "not used"). See "What each Used number counts" below for exactly what\'s being counted per feature.'],
  ];
  for (const [col, meaning] of columnMeanings) {
    const row = sheet.addRow([col, meaning]);
    row.getCell(1).font = SUBHEAD_FONT;
    row.getCell(2).alignment = { wrapText: true };
  }
  sheet.addRow([]);

  const notedHead = sheet.addRow(['Not shown in this export']);
  notedHead.getCell(1).font = SECTION_FONT;
  sheet.addRow([
    'Contracted',
    'Temporarily omitted — comparing against HubSpot deal line items needs read access HubSpot hasn\'t granted this app yet. The underlying logic is built and will populate once that\'s resolved.',
  ]).getCell(2).alignment = { wrapText: true };
  sheet.addRow([]);

  const signalsHead = sheet.addRow(['What each "Used" number counts']);
  signalsHead.getCell(1).font = SECTION_FONT;
  const signalTableHeader = sheet.addRow(['Feature(s)', 'What the number counts']);
  signalTableHeader.eachCell((cell) => { cell.font = SUBHEAD_FONT; cell.fill = TABLE_HEADER_FILL; });

  // One row per usage signal actually used by a feature in this report,
  // rather than every key the app knows about — so a report never lists a
  // signal type that has no relevance to its own feature list.
  const featuresBySignal = new Map();
  for (const f of snapshot.features) {
    if (!f.usageSignal) continue;
    if (!featuresBySignal.has(f.usageSignal)) featuresBySignal.set(f.usageSignal, []);
    featuresBySignal.get(f.usageSignal).push(f.label);
  }
  for (const [signal, labels] of featuresBySignal) {
    const row = sheet.addRow([labels.join(', '), snapshot.signalDescriptions?.[signal] || signal]);
    row.getCell(1).alignment = { wrapText: true };
    row.getCell(2).alignment = { wrapText: true };
  }
  const noSignalFeatures = snapshot.features.filter((f) => !f.usageSignal).map((f) => f.label);
  if (noSignalFeatures.length > 0) {
    sheet.addRow([]);
    const row = sheet.addRow([noSignalFeatures.join(', '), 'No usage signal built yet — Used always shows — for these. This does not mean unused, just not measured.']);
    row.getCell(1).alignment = { wrapText: true };
    row.getCell(2).alignment = { wrapText: true };
  }
}

export async function exportUsageAudit(snapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  addExplanationSheet(workbook, snapshot);

  const sheet = workbook.addWorksheet('Usage Audit');

  const columns = [
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Feature', key: 'feature', width: 34 },
    { header: 'Mapping', key: 'mapping', width: 12 },
  ];
  for (const c of snapshot.communities) {
    const label = snapshot.hosts.length > 1 ? `${c.name} [${c.host}]` : c.name;
    columns.push({ header: `${label} — Enabled`, key: `enabled_${c.host}_${c.communityId}`, width: 16 });
    columns.push({ header: `${label} — Used`, key: `used_${c.host}_${c.communityId}`, width: 12 });
  }
  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

  for (const feature of snapshot.features) {
    const rowData = {
      category: feature.category,
      feature: feature.label,
      mapping: feature.mappingConfidence,
    };
    for (const c of snapshot.communities) {
      const cell = feature.byCommunity[`${c.host}::${c.communityId}`];
      rowData[`enabled_${c.host}_${c.communityId}`] = CELL_TEXT[stateKey(cell.enabled)];
      rowData[`used_${c.host}_${c.communityId}`] = cell.usageCount != null ? cell.usageCount : CELL_TEXT[stateKey(cell.used)];
    }
    const row = sheet.addRow(rowData);

    for (const c of snapshot.communities) {
      const cell = feature.byCommunity[`${c.host}::${c.communityId}`];
      row.getCell(`enabled_${c.host}_${c.communityId}`).fill = CELL_FILL[stateKey(cell.enabled)];
      row.getCell(`used_${c.host}_${c.communityId}`).fill = CELL_FILL[stateKey(cell.used)];
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(snapshot.companyName || 'Usage-Audit').replace(/[^a-z0-9.\-]/gi, '_')}-usage-audit.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
