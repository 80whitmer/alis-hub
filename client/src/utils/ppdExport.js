/**
 * Exports the PPD drawer's region/facility breakdown to an .xlsx file —
 * see kpiNormalizer.js's normalizePpd for where byRegion/byCommunity's
 * fields come from.
 */
import ExcelJS from 'exceljs';

const usd2 = (n) => (n == null ? '' : Number(n.toFixed(2)));

export async function exportPpd({ byRegion, byCommunity }, companyName) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  if (byRegion?.length > 0) {
    const sheet = workbook.addWorksheet('PPD by Region');
    sheet.columns = [
      { header: 'Region', key: 'region', width: 24 },
      { header: 'Billed Revenue', key: 'billedRevenue', width: 18 },
      { header: 'Occupied Days', key: 'occupiedDays', width: 16 },
      { header: 'Census Days', key: 'censusDays', width: 16 },
      { header: 'PPD (Unit Days)', key: 'ppdByUnitDays', width: 16 },
      { header: 'PPD (Census)', key: 'ppdByCensus', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of byRegion) {
      sheet.addRow({ region: r.region, billedRevenue: usd2(r.billedRevenue), occupiedDays: r.occupiedDays, censusDays: r.censusDays, ppdByUnitDays: usd2(r.ppdByUnitDays), ppdByCensus: usd2(r.ppdByCensus) });
    }
  }

  const facilitySheet = workbook.addWorksheet('PPD by Facility');
  facilitySheet.columns = [
    { header: 'Facility', key: 'name', width: 30 },
    { header: 'Region', key: 'region', width: 20 },
    { header: 'Billed Revenue', key: 'billedRevenue', width: 18 },
    { header: 'Occupied Days', key: 'occupiedDays', width: 16 },
    { header: 'Census Days', key: 'censusDays', width: 16 },
    { header: 'PPD (Unit Days)', key: 'ppdByUnitDays', width: 16 },
    { header: 'PPD (Census)', key: 'ppdByCensus', width: 16 },
  ];
  facilitySheet.getRow(1).font = { bold: true };
  for (const c of byCommunity || []) {
    facilitySheet.addRow({ name: c.name, region: c.region || 'Unassigned', billedRevenue: usd2(c.billedRevenue), occupiedDays: c.occupiedDays, censusDays: c.censusDays, ppdByUnitDays: usd2(c.ppdByUnitDays), ppdByCensus: usd2(c.ppdByCensus) });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-ppd-breakdown.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
