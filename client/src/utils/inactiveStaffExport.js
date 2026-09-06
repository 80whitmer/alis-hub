/**
 * Exports the Staffing section's "not logged in within 30 days" list to an
 * .xlsx file — see kpiNormalizer.js's normalizeStaffActivity for where
 * `inactive`'s fields come from.
 */
import ExcelJS from 'exceljs';

/** 'YYYY-MM-DD' from an ISO date/datetime string, or '' if missing/invalid. */
function dateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export async function exportInactiveStaff(inactive, communities, companyName) {
  // Keyed by host::communityId, same convention as the server's
  // filterByCommunity — two hosts can share a numeric community ID.
  const communityNameByKey = new Map((communities || []).map((c) => [`${c.host}::${c.communityId}`, c.name]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Staff Not Logged In (30d)');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Community', key: 'community', width: 30 },
    { header: 'Hire Date', key: 'hireDate', width: 16 },
    { header: 'Job Role', key: 'jobRole', width: 24 },
    { header: 'Last Login', key: 'lastLogin', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const s of inactive) {
    sheet.addRow({
      name: s.name || `Staff ${s.staffId}`,
      community: communityNameByKey.get(`${s.host}::${s.communityId}`) || (s.communityId ?? '—'),
      hireDate: dateOnly(s.hireDate),
      jobRole: s.jobRole || '—',
      lastLogin: s.lastLogin ? dateOnly(s.lastLogin) : 'Never',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-staff-not-logged-in.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
