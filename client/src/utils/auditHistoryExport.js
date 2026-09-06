/**
 * Exports an audit-history snapshot to .xlsx — one "Combined" sheet
 * (every row across every target, timestamp-sorted) plus one sheet per
 * target, matching the on-screen dashboard's Combined/per-target split.
 */
import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function addSheet(workbook, sheetName, rows, { showTarget = false } = {}) {
  const sheet = workbook.addWorksheet(sheetName);
  const columns = [
    ...(showTarget ? [{ header: 'Target', key: 'target', width: 28 }] : []),
    { header: 'Note', key: 'note', width: 70 },
    { header: 'Updated At', key: 'updatedAt', width: 22 },
    { header: 'Updated By', key: 'updatedByName', width: 20 },
    { header: 'Updated By (username)', key: 'updatedByUsername', width: 18 },
  ];
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const r of rows) {
    sheet.addRow({
      target: r.targetLabel,
      note: r.note,
      updatedAt: r.updatedAt,
      updatedByName: r.updatedByName,
      updatedByUsername: r.updatedByUsername,
    });
  }
  if (rows.length === 0) {
    sheet.addRow({ note: 'No matching audit rows.' });
  }
}

function addExplanationSheet(workbook, snapshot) {
  const sheet = workbook.addWorksheet('Explanation');
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 90;

  const title = sheet.addRow([`ALIS Audit History — ${snapshot.companyName}`]);
  title.getCell(1).font = { bold: true, size: 14 };
  sheet.mergeCells(`A${title.number}:B${title.number}`);
  sheet.addRow([`Host: ${snapshot.companyHost} · Generated ${new Date(snapshot.generatedAt).toLocaleString()} · ${snapshot.totalRows} total row(s) across ${snapshot.targets.length} target(s)`]);
  sheet.addRow([]);

  const f = snapshot.filters || {};
  const filterRows = [
    ['Date range', (f.startDate || f.endDate) ? `${f.startDate || '…'} – ${f.endDate || '…'}` : 'None (unfiltered — capped at 500 rows/target)'],
    ['Updated By (staffId)', f.staffId || 'All staff'],
    ['Type / Category', f.category || 'All types'],
    ['Notes search', f.notes || 'None'],
  ];
  for (const [k, v] of filterRows) {
    const row = sheet.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  const targetsHead = sheet.addRow(['Targets pulled']);
  targetsHead.getCell(1).font = { bold: true, size: 12 };
  for (const t of snapshot.targets) {
    const label = t.truncated ? `${t.targetLabel} (hit the 500-row safety cap — narrow the date range for a complete pull)`
      : t.error ? `${t.targetLabel} (FAILED: ${t.error})`
      : `${t.targetLabel} (${t.rowCount} rows)`;
    sheet.addRow(['', label]);
  }
  if (snapshot.dataWarnings?.length) {
    sheet.addRow([]);
    const warnHead = sheet.addRow(['Data warnings']);
    warnHead.getCell(1).font = { bold: true, size: 12 };
    for (const w of snapshot.dataWarnings) {
      const row = sheet.addRow(['', w]);
      row.getCell(2).alignment = { wrapText: true };
    }
  }
}

export async function exportAuditHistory(snapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  addExplanationSheet(workbook, snapshot);
  addSheet(workbook, 'Combined', snapshot.combined, { showTarget: true });
  for (const t of snapshot.targets) {
    // Sheet names can't exceed 31 chars or contain :\/?*[].
    const safeName = t.targetLabel.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
    addSheet(workbook, safeName, t.rows || []);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(snapshot.companyName || 'Audit-History').replace(/[^a-z0-9.\-]/gi, '_')}-audit-history.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
