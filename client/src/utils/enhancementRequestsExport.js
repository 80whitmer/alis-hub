/**
 * Exports the flattened Enhancement Requests table (EnhancementRequestsSection.jsx)
 * to .xlsx — same single-purpose ExcelJS + Blob-download shape as
 * topThreeEnhancementsExport.js. `includeAccountManager` is passed explicitly
 * (rather than inferred from the data, unlike topThreeEnhancementsExport.js)
 * since a portfolio with zero currently-assigned AMs would otherwise drop
 * the column entirely.
 */
import ExcelJS from 'exceljs';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export async function exportEnhancementRequests(items, includeAccountManager = false, topThreeOnly = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Enhancement Requests');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    ...(includeAccountManager ? [{ header: 'Account Manager', key: 'accountManagerName', width: 20 }] : []),
    { header: 'Enhancement', key: 'subject', width: 45 },
    { header: 'Request Date', key: 'createdAt', width: 14 },
    { header: 'Days Open', key: 'daysOpen', width: 10 },
    { header: 'Next Step', key: 'nextStep', width: 45 },
    { header: 'Top 3?', key: 'topThree', width: 8 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Size (Total Capacity)', key: 'totalCapacity', width: 14 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'Company Requests', key: 'companyPosition', width: 16 },
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
      topThree: t.isTopThree ? 'Yes' : 'No',
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
  a.download = topThreeOnly ? 'Top-3-Enhancement-Requests.xlsx' : 'Enhancement-Requests.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
