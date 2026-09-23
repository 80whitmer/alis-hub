/**
 * Exports the flattened "All Deals" table (DealsSection, duplicated per
 * dashboard — AccountHealthDashboard.jsx/TeamAmDashboard.jsx) to .xlsx —
 * same single-purpose ExcelJS + Blob-download shape as
 * escalationTicketsExport.js, including its `includeAccountManager` flag
 * convention.
 */
import ExcelJS from 'exceljs';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export async function exportAllDeals(deals, includeAccountManager = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('All Deals');
  sheet.columns = [
    { header: 'Account', key: 'companyName', width: 30 },
    ...(includeAccountManager ? [{ header: 'AM', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Deal', key: 'name', width: 40 },
    { header: 'Pipeline', key: 'pipeline', width: 24 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Value', key: 'value', width: 14 },
    { header: 'Close Date', key: 'closeDate', width: 14 },
    { header: 'Open?', key: 'openStatus', width: 8 },
    { header: 'Next Step', key: 'nextStep', width: 40 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const d of deals) {
    sheet.addRow({
      companyName: d.companyName,
      accountManagerName: d.accountManagerName,
      tier: d.tier || '',
      name: d.name,
      pipeline: d.pipeline,
      stage: d.stage,
      value: currencyStr(d.valueCents),
      closeDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
      openStatus: d.isOpen ? 'Open' : 'Closed',
      nextStep: d.nextStep || '',
      url: d.url || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'All-Deals.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
