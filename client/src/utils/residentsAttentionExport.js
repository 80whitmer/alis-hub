/**
 * Exports the Levels of Care "residents needing attention" list to an
 * .xlsx file the account manager can hand directly to the client — see
 * kpiNormalizer.js's normalizeCareLevelEvaluations for where `flagged`'s
 * fields come from.
 */
import ExcelJS from 'exceljs';

const REASON_LABEL = {
  expired: 'Expired',
  incomplete: 'Incomplete',
  overdue: 'Not evaluated in 12+ months',
  neverEvaluated: 'Never evaluated',
};

/** 'YYYY-MM-DD' from an ISO date/datetime string, or '' if missing/invalid. */
function dateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export async function exportResidentsNeedingAttention(flagged, communities, companyName) {
  // Keyed by host::communityId, same convention as the server's
  // filterByCommunity — two hosts can share a numeric community ID.
  const communityNameByKey = new Map((communities || []).map((c) => [`${c.host}::${c.communityId}`, c.name]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Residents Needing Attention');
  sheet.columns = [
    { header: 'Resident', key: 'name', width: 26 },
    { header: 'Community', key: 'community', width: 30 },
    { header: 'Status', key: 'reason', width: 26 },
    { header: 'Current Care Level', key: 'careLevel', width: 20 },
    { header: 'Current Product Type', key: 'productType', width: 20 },
    { header: 'Current Care Level Fee', key: 'fee', width: 20 },
    { header: 'Move-In Date', key: 'moveInDate', width: 16 },
    { header: 'Expiration Date', key: 'expirationDate', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('fee').numFmt = '$#,##0.00';

  for (const f of flagged) {
    sheet.addRow({
      name: f.name || `Resident ${f.residentId}`,
      community: communityNameByKey.get(`${f.host}::${f.communityId}`) || (f.communityId ?? '—'),
      reason: REASON_LABEL[f.reason] || f.reason,
      careLevel: f.careLevel || '—',
      productType: f.productType || '—',
      fee: f.fee,
      moveInDate: dateOnly(f.moveInDate),
      expirationDate: dateOnly(f.expirationDate),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-residents-needing-attention.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
