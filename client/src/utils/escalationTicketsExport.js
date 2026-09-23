/**
 * Exports the flattened Escalation Tickets table (EscalationRequestsSection.jsx)
 * to .xlsx — same single-purpose ExcelJS + Blob-download shape as
 * enhancementRequestsExport.js. No "Top 3?" column — escalations have no
 * such ranking concept.
 */
import ExcelJS from 'exceljs';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export async function exportEscalationTickets(items, includeAccountManager = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Escalation Tickets');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    ...(includeAccountManager ? [{ header: 'AM', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Escalation', key: 'subject', width: 45 },
    { header: 'Request Date', key: 'createdAt', width: 14 },
    { header: 'Days Open', key: 'daysOpen', width: 10 },
    { header: 'Next Step', key: 'nextStep', width: 45 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Size (Total Capacity)', key: 'totalCapacity', width: 14 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'Company Escalations', key: 'companyPosition', width: 18 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const t of items) {
    sheet.addRow({
      companyName: t.companyName,
      accountManagerName: t.accountManagerName,
      subject: t.subject,
      createdAt: t.createdAt ? t.createdAt.slice(0, 10) : '',
      daysOpen: t.daysOpen ?? '',
      nextStep: t.nextStep || '',
      tier: t.tier || '',
      totalCapacity: t.totalCapacity ?? '',
      arr: currencyStr(t.arrCents),
      companyPosition: t.companyPosition || '',
      url: t.url || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Escalation-Tickets.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
