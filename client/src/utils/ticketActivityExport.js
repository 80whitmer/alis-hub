/**
 * Exports the Ticket Activity table (TicketTable.jsx) to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as escalationTicketsExport.js/
 * enhancementRequestsExport.js.
 */
import ExcelJS from 'exceljs';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export async function exportTicketActivity(items, showAccountManager = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Ticket Activity');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    ...(showAccountManager ? [{ header: 'AM', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Subject', key: 'subject', width: 45 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Created', key: 'createdAt', width: 14 },
    { header: 'Days Open', key: 'daysOpen', width: 10 },
    { header: 'Closed', key: 'closedAt', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Next Step', key: 'nextStep', width: 45 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Size (Total Capacity)', key: 'totalCapacity', width: 14 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'Company Tickets', key: 'companyPosition', width: 16 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const t of items) {
    sheet.addRow({
      companyName: t.companyName,
      accountManagerName: t.accountManagerName,
      subject: t.subject,
      category: t.category || '',
      status: t.isOpen ? (t.pipelineStageLabel || 'Open') : 'Closed',
      createdAt: t.createdAt ? t.createdAt.slice(0, 10) : '',
      daysOpen: t.daysOpen ?? '',
      closedAt: t.closedAt ? t.closedAt.slice(0, 10) : '',
      dueDate: t.ticketDueDate ? t.ticketDueDate.slice(0, 10) : '',
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
  a.download = 'Ticket-Activity.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
