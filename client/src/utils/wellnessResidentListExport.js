/**
 * Exports a Wellness Scorecard resident drawer's list to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as topThreeEnhancementsExport.js.
 * Generic across every `hasResidentDrawer` row (see wellnessRows.js) since
 * each item already carries a unified `detail` string from the server side
 * (wellnessNormalizer.js's attachItems callers).
 */
import ExcelJS from 'exceljs';

export async function exportWellnessResidentList(label, items) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  // Excel worksheet names are capped at 31 characters and can't contain
  // some punctuation (e.g. the em dash + community name this label often
  // carries) — sheet name is cosmetic, so just truncate rather than fail.
  const sheet = workbook.addWorksheet(label.replace(/[*?:/\\[\]]/g, '').slice(0, 31) || 'Residents');
  sheet.columns = [
    { header: 'Resident', key: 'residentName', width: 28 },
    { header: 'Community', key: 'communityName', width: 26 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Details', key: 'detail', width: 55 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const it of items) {
    sheet.addRow({
      residentName: it.residentName || '',
      communityName: it.communityName || '',
      date: it.date ? it.date.slice(0, 10) : '',
      detail: it.detail || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
