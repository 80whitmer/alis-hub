/**
 * Exports the "Needs an Account Manager" deals/tickets lists (see
 * TeamAmDashboard.jsx's UnmappedAmSection) to .xlsx — same single-purpose
 * ExcelJS + Blob-download shape as dsoExport.js/topThreeEnhancementsExport.js.
 * Two sheets (Deals, Tickets) rather than one combined sheet, since the
 * two record types have genuinely different columns (deal value/pipeline
 * vs. ticket rank/age).
 */
import ExcelJS from 'exceljs';

const usd = (cents) => (cents == null ? '' : Number((cents / 100).toFixed(2)));

export async function exportUnmappedAmRecords({ deals, tickets }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const dealSheet = workbook.addWorksheet('Deals');
  dealSheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    { header: 'Account Manager', key: 'accountManagerLabel', width: 22 },
    { header: 'Deal', key: 'name', width: 40 },
    { header: 'Pipeline', key: 'pipeline', width: 20 },
    { header: 'Stage', key: 'stage', width: 22 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Value', key: 'value', width: 14 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  dealSheet.getRow(1).font = { bold: true };
  for (const d of deals) {
    dealSheet.addRow({
      companyName: d.companyName,
      accountManagerLabel: d.accountManagerLabel,
      name: d.name,
      pipeline: d.pipeline || '',
      stage: d.stage || '',
      status: d.isOpen ? 'Open' : 'Closed',
      value: usd(d.valueCents),
      url: d.url || '',
    });
  }

  const ticketSheet = workbook.addWorksheet('Tickets');
  ticketSheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    { header: 'Account Manager', key: 'accountManagerLabel', width: 22 },
    { header: 'Ticket', key: 'subject', width: 40 },
    { header: 'Type', key: 'type', width: 20 },
    { header: 'Stage', key: 'stage', width: 22 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  ticketSheet.getRow(1).font = { bold: true };
  for (const t of tickets) {
    ticketSheet.addRow({
      companyName: t.companyName,
      accountManagerLabel: t.accountManagerLabel,
      subject: t.subject,
      type: t.type,
      stage: t.stage || '',
      url: t.url || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Needs-Account-Manager.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
