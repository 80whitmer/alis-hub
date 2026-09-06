/**
 * Exports the Length of Stay drawer's product-type/community breakdown to
 * an .xlsx file — see kpiNormalizer.js's normalizeLengthOfStayAndMoveOuts
 * for where byProductType/byCommunity's fields come from. Per client
 * feedback, community x product-type detail lives here rather than on
 * screen — the dashboard/drawer show the rolled-up and by-community cuts.
 */
import ExcelJS from 'exceljs';

const days1 = (n) => (n == null ? '' : Number(n.toFixed(1)));
const pct1 = (n) => (n == null ? '' : Number((n * 100).toFixed(1)));

const STAT_COLUMNS = [
  { header: 'Avg LOS (days)', key: 'avgDays', width: 16 },
  { header: 'Median LOS (days)', key: 'medianDays', width: 18 },
  { header: 'Move-Outs ≤3mo', key: 'within3mo', width: 15 },
  { header: 'Move-Outs ≤6mo', key: 'within6mo', width: 15 },
  { header: 'Move-Outs ≤12mo', key: 'within12mo', width: 16 },
  { header: 'Total Move-Outs', key: 'totalMoveOuts', width: 16 },
];

function statRow(stats) {
  return {
    avgDays: days1(stats.avgDays),
    medianDays: days1(stats.medianDays),
    within3mo: pct1(stats.moveOutWithin?.['3mo']),
    within6mo: pct1(stats.moveOutWithin?.['6mo']),
    within12mo: pct1(stats.moveOutWithin?.['12mo']),
    totalMoveOuts: stats.totalMoveOuts ?? 0,
  };
}

export async function exportLos({ portfolio, byProductType, byCommunity }, companyName) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const rollupSheet = workbook.addWorksheet('LOS Rolled Up');
  rollupSheet.columns = [{ header: 'Scope', key: 'scope', width: 20 }, ...STAT_COLUMNS];
  rollupSheet.getRow(1).font = { bold: true };
  rollupSheet.addRow({ scope: 'Portfolio', ...statRow(portfolio) });

  const productTypeSheet = workbook.addWorksheet('LOS by Product Type');
  productTypeSheet.columns = [{ header: 'Product Type', key: 'productType', width: 24 }, ...STAT_COLUMNS];
  productTypeSheet.getRow(1).font = { bold: true };
  for (const p of byProductType || []) {
    productTypeSheet.addRow({ productType: p.productType, ...statRow(p) });
  }

  const communitySheet = workbook.addWorksheet('LOS by Community');
  communitySheet.columns = [{ header: 'Community', key: 'name', width: 30 }, ...STAT_COLUMNS];
  communitySheet.getRow(1).font = { bold: true };
  for (const c of byCommunity || []) {
    communitySheet.addRow({ name: c.name, ...statRow(c) });
  }

  const detailSheet = workbook.addWorksheet('LOS by Community & Product Type');
  detailSheet.columns = [
    { header: 'Community', key: 'name', width: 30 },
    { header: 'Product Type', key: 'productType', width: 24 },
    ...STAT_COLUMNS,
  ];
  detailSheet.getRow(1).font = { bold: true };
  for (const c of byCommunity || []) {
    for (const p of c.byProductType || []) {
      detailSheet.addRow({ name: c.name, productType: p.productType, ...statRow(p) });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-los-breakdown.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
