/**
 * Exports the flattened Top 3 Enhancement Requests drawer list to .xlsx —
 * same single-purpose ExcelJS + Blob-download shape as dsoExport.js.
 * Shared between AccountHealthDashboard.jsx and TeamAmDashboard.jsx (see
 * TopThreeEnhancementsCard.jsx) — `items` already carries an
 * `accountManagerName` field or not depending on which page flattened it,
 * so the Account Manager column is included whenever any row has one
 * rather than being toggled by a separate flag.
 */
import ExcelJS from 'exceljs';

export async function exportTopThreeEnhancements(items) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const includeAm = items.some((i) => i.accountManagerName != null);

  // No colon — Excel sheet names can't contain ':\/?*[]'.
  const sheet = workbook.addWorksheet('Enhancement Requests - Top 3');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    ...(includeAm ? [{ header: 'AM', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Ticket Subject', key: 'subject', width: 40 },
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Created', key: 'createdAt', width: 14 },
    { header: 'Closed', key: 'closedAt', width: 14 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const t of items) {
    sheet.addRow({
      companyName: t.companyName,
      accountManagerName: t.accountManagerName,
      subject: t.subject,
      rank: t.rank || '',
      stage: t.stage || '',
      status: t.isOpen === false ? 'Closed' : t.isOpen === true ? 'Open' : '',
      createdAt: t.createdAt ? t.createdAt.slice(0, 10) : '',
      closedAt: t.closedAt ? t.closedAt.slice(0, 10) : '',
      url: t.url || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Top-3-Enhancement-Requests.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
