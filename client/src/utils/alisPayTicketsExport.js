/**
 * Exports the flattened Open ALIS Pay Tickets drawer list to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as topThreeEnhancementsExport.js.
 */
import ExcelJS from 'exceljs';

export async function exportAlisPayTickets(items, includeAccountManager = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('ALIS Pay Tickets');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    ...(includeAccountManager ? [{ header: 'AM', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Ticket Subject', key: 'subject', width: 45 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Days Open', key: 'daysOpen', width: 10 },
    { header: 'Created', key: 'createdAt', width: 14 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const t of items) {
    sheet.addRow({
      companyName: t.companyName,
      accountManagerName: t.accountManagerName,
      subject: t.subject,
      stage: t.stage || '',
      daysOpen: t.daysOpen ?? '',
      createdAt: t.createdAt ? t.createdAt.slice(0, 10) : '',
      url: t.url || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Open-ALIS-Pay-Tickets.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
