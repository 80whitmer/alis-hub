/**
 * Exports the Unassigned Tier Companies drawer's list to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as atRiskExport.js /
 * unmappedAmExport.js.
 */
import ExcelJS from 'exceljs';

export async function exportUnassignedTierAccounts(accounts) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Unassigned Tier');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    { header: 'AM', key: 'accountManagerName', width: 22 },
    { header: 'Open Tickets', key: 'openTickets', width: 14 },
    { header: 'Closed Tickets', key: 'closedTickets', width: 14 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    sheet.addRow({
      companyName: a.company_name,
      accountManagerName: a.account_manager_name,
      openTickets: a.open_ticket_count || 0,
      closedTickets: a.closed_ticket_count || 0,
      arr: ((a.arr_cents || 0) / 100),
      url: a.hubspotUrl || '',
    });
  }
  sheet.getColumn('arr').numFmt = '$#,##0';

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Unassigned-Tier-Companies.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
