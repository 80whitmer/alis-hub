/**
 * Exports a Weekly Wellness Scorecard snapshot to .xlsx — one sheet per
 * community plus a Portfolio rollup, columns matching Imagine Senior
 * Living's own "Weekly Wellness Report" layout so this reads as a
 * digitized version of the document a Wellness Director already fills in
 * by hand, not a redesign. Computed rows are pre-filled; manual rows
 * (skin/wound, infection control, narrative fields, etc.) are left
 * genuinely blank for them to complete, same as today — see
 * client/src/utils/wellnessRows.js for the row/category list and
 * server/services/wellnessNormalizer.js for how the computed values are
 * produced.
 */
import ExcelJS from 'exceljs';
import { resolveWellnessRow, getVisibleWellnessRows } from './wellnessRows';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const COLUMNS = [
  { header: 'Category', key: 'category', width: 26 },
  { header: 'Key Indicator', key: 'indicator', width: 42 },
  { header: 'AL', key: 'al', width: 8 },
  { header: 'MC', key: 'mc', width: 8 },
  { header: 'Total', key: 'total', width: 10 },
  { header: 'Prior Week', key: 'prior', width: 12 },
  { header: 'Trend', key: 'trend', width: 8 },
  { header: 'Status', key: 'status', width: 10 },
  { header: 'Residents / Details', key: 'details', width: 30 },
  { header: 'Action / Intervention', key: 'action', width: 30 },
  { header: 'Owner', key: 'owner', width: 16 },
  { header: 'Due Date', key: 'due', width: 12 },
  { header: 'Escalated?', key: 'escalated', width: 12 },
  { header: 'Leadership Notes', key: 'notes', width: 30 },
];

function addScorecardSheet(workbook, sheetName, snapshot, communityId) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = COLUMNS;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const row of getVisibleWellnessRows(snapshot)) {
    const v = resolveWellnessRow(row, snapshot, communityId);
    // Details stays blank for every row except the four incident-based ones
    // with a real, ALIS-computed open-documentation count (not judgment,
    // unlike Status/Action/Owner/etc. below) — see wellnessNormalizer.js's
    // withOpenDocs and DocCompletionBadge in WellnessScorecard.jsx for the
    // same signal rendered on screen.
    const reporterNote = v.openDocsReporters?.length
      ? ` — reported by ${v.openDocsReporters.map((r) => `${r.name}${r.count > 1 ? ` x${r.count}` : ''}`).join(', ')}`
      : '';
    const details = row.hasDocCompletion && v.openDocsTotal > 0
      ? `${v.openDocsTotal} of ${v.total} incident report(s) missing a completed form or intervention${reporterNote}`
      : '';
    sheet.addRow({
      category: row.category,
      indicator: row.label,
      al: v.al,
      mc: v.mc,
      total: v.total,
      prior: v.prior,
      trend: v.trend,
      // Status/Action/Owner/Due/Escalated/Notes are always left blank — no
      // threshold engine exists yet to compute a Green/Yellow/Red status,
      // and the narrative fields are inherently the Wellness Director's
      // judgment, same as the original sheet.
      status: '',
      details,
      action: '',
      owner: '',
      due: '',
      escalated: '',
      notes: '',
    });
  }
}

export async function exportWellnessScorecard(snapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  addScorecardSheet(workbook, 'Portfolio', snapshot, null);
  for (const c of snapshot.communities) {
    // Sheet names can't exceed 31 chars or contain :\/?*[] — trim and strip.
    const safeName = c.name.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
    addScorecardSheet(workbook, safeName, snapshot, String(c.communityId));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(snapshot.companyName || 'Wellness-Scorecard').replace(/[^a-z0-9.\-]/gi, '_')}-${snapshot.weekEnding}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
