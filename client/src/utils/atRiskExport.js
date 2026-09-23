/**
 * Exports the At-Risk Accounts drawer's list to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as dsoExport.js /
 * topThreeEnhancementsExport.js / unmappedAmExport.js.
 */
import ExcelJS from 'exceljs';

export async function exportAtRiskAccounts(accounts) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('At-Risk Accounts');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 30 },
    { header: 'AM', key: 'accountManagerName', width: 22 },
    { header: 'Health Score', key: 'score', width: 12 },
    { header: 'Band', key: 'band', width: 12 },
    { header: 'Why', key: 'why', width: 60 },
    { header: 'HubSpot Link', key: 'url', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    sheet.addRow({
      companyName: a.company_name,
      accountManagerName: a.account_manager_name,
      score: a.health_score,
      band: a.health_band,
      why: (a.riskReasons || []).join('; ') || '—',
      url: a.hubspotUrl || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'At-Risk-Accounts.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
