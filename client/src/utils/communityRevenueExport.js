/**
 * Exports the Community Revenue & Occupancy table (CommunityRevenueSection.jsx)
 * to .xlsx — same single-purpose ExcelJS + Blob-download shape as
 * enhancementRequestsExport.js. Each trended field is a `{current, prior,
 * deltaAbs, deltaPct}` object from the /api/team-am/community-revenue
 * response — exported as two columns (current + Δ vs. prior month) rather
 * than flattened into one, so the delta is still visible/sortable in Excel.
 */
import ExcelJS from 'exceljs';

function fmtDelta(trend) {
  if (!trend || trend.deltaAbs == null) return '';
  const sign = trend.deltaAbs > 0 ? '+' : '';
  return `${sign}${Math.round(trend.deltaAbs * 100) / 100}`;
}

export async function exportCommunityRevenue(rows, month) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Community Revenue');
  sheet.columns = [
    { header: 'Company', key: 'companyName', width: 28 },
    { header: 'Community', key: 'communityName', width: 30 },
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Charges', key: 'charges', width: 14 },
    { header: 'Credits', key: 'credits', width: 12 },
    { header: 'Discounts', key: 'discounts', width: 12 },
    { header: 'Net Revenue', key: 'netRevenue', width: 14 },
    { header: 'Net Revenue Δ', key: 'netRevenueDelta', width: 14 },
    { header: 'Unit Capacity (est.)', key: 'unitCapacity', width: 16 },
    { header: 'Total Occupied Units', key: 'occupiedUnits', width: 16 },
    { header: 'Occupied Units Δ', key: 'occupiedUnitsDelta', width: 14 },
    { header: 'Move Ins', key: 'moveIns', width: 10 },
    { header: 'Move Outs', key: 'moveOuts', width: 10 },
    { header: 'Occupancy Unit Days', key: 'occupancyUnitDays', width: 16 },
    { header: 'Occupancy Unit Days Δ', key: 'occupancyUnitDaysDelta', width: 16 },
    { header: 'Census Days', key: 'censusDays', width: 12 },
    { header: 'Census Days Δ', key: 'censusDaysDelta', width: 12 },
    { header: 'PPD (Unit Days)', key: 'ppdUnitDays', width: 14 },
    { header: 'PPD (Unit Days) Δ', key: 'ppdUnitDaysDelta', width: 14 },
    { header: 'PPD (Census)', key: 'ppdCensus', width: 14 },
    { header: 'PPD (Census) Δ', key: 'ppdCensusDelta', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow({
      companyName: r.companyName,
      communityName: r.communityName,
      month: r.month,
      charges: r.charges ?? '',
      credits: r.credits ?? '',
      discounts: r.discounts ?? '',
      netRevenue: r.netRevenue?.current ?? '',
      netRevenueDelta: fmtDelta(r.netRevenue),
      unitCapacity: r.unitCapacity ?? '',
      occupiedUnits: r.totalOccupiedUnits?.current ?? '',
      occupiedUnitsDelta: fmtDelta(r.totalOccupiedUnits),
      moveIns: r.moveIns ?? '',
      moveOuts: r.moveOuts ?? '',
      occupancyUnitDays: r.occupancyUnitDays?.current ?? '',
      occupancyUnitDaysDelta: fmtDelta(r.occupancyUnitDays),
      censusDays: r.censusDays?.current ?? '',
      censusDaysDelta: fmtDelta(r.censusDays),
      ppdUnitDays: r.ppdUnitDays?.current != null ? Math.round(r.ppdUnitDays.current * 100) / 100 : '',
      ppdUnitDaysDelta: fmtDelta(r.ppdUnitDays),
      ppdCensus: r.ppdCensus?.current != null ? Math.round(r.ppdCensus.current * 100) / 100 : '',
      ppdCensusDelta: fmtDelta(r.ppdCensus),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Community-Revenue-${month || 'export'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
