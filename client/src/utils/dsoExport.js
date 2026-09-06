/**
 * Exports the DSO drawer's facility and resident breakdown to an .xlsx
 * file — see kpiNormalizer.js's normalizeDso for where byCommunity/
 * byResident's fields come from.
 */
import ExcelJS from 'exceljs';

const usd = (n) => (n == null ? '' : Number(n.toFixed(2)));
const days = (n) => (n == null ? '' : Number(n.toFixed(1)));

export async function exportDso({ byRegion, byCommunity, byResident }, companyName) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  if (byRegion?.length > 0) {
    const sheet = workbook.addWorksheet('DSO by Region');
    sheet.columns = [
      { header: 'Region', key: 'region', width: 24 },
      { header: 'Billed Revenue', key: 'billedRevenue', width: 18 },
      { header: 'AR Balance', key: 'arBalance', width: 18 },
      { header: 'DSO (days)', key: 'dsoDays', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of byRegion) {
      sheet.addRow({ region: r.region, billedRevenue: usd(r.billedRevenue), arBalance: usd(r.arBalance), dsoDays: days(r.dsoDays) });
    }
  }

  const facilitySheet = workbook.addWorksheet('DSO by Facility');
  facilitySheet.columns = [
    { header: 'Facility', key: 'name', width: 30 },
    { header: 'Region', key: 'region', width: 20 },
    { header: 'Billed Revenue', key: 'billedRevenue', width: 18 },
    { header: 'AR Balance', key: 'arBalance', width: 18 },
    { header: 'DSO (days)', key: 'dsoDays', width: 14 },
  ];
  facilitySheet.getRow(1).font = { bold: true };
  for (const c of byCommunity || []) {
    facilitySheet.addRow({ name: c.name, region: c.region || 'Unassigned', billedRevenue: usd(c.billedRevenue), arBalance: usd(c.arBalance), dsoDays: days(c.dsoDays) });
  }

  const residentSheet = workbook.addWorksheet('DSO by Resident');
  residentSheet.columns = [
    { header: 'Resident', key: 'name', width: 26 },
    { header: 'Facility ID', key: 'communityId', width: 14 },
    { header: 'Billed Revenue', key: 'billedRevenue', width: 18 },
    { header: 'AR Balance', key: 'arBalance', width: 18 },
    { header: 'DSO (days)', key: 'dsoDays', width: 14 },
  ];
  residentSheet.getRow(1).font = { bold: true };
  for (const r of byResident || []) {
    residentSheet.addRow({ name: r.name || `Resident ${r.residentId}`, communityId: r.communityId, billedRevenue: usd(r.billedRevenue), arBalance: usd(r.arBalance), dsoDays: days(r.dsoDays) });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-dso-breakdown.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
