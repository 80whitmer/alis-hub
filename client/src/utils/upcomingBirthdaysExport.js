/**
 * Exports the Wellness Scorecard's "Upcoming Birthdays & Milestones" panel
 * (client/src/components/UpcomingBirthdaysPanel.jsx) to .xlsx — same
 * single-purpose ExcelJS + Blob-download shape as wellnessResidentListExport.js.
 * Not part of the main exportWellnessScorecard workbook (that one mirrors
 * Imagine Senior Living's own fixed report layout, which has no birthdays
 * section) — this is its own small export, triggered from that section's
 * own button (Sep 2026, Aaron).
 */
import ExcelJS from 'exceljs';

function communityName(communities, communityId) {
  if (communityId == null) return '';
  const c = communities?.find((c) => String(c.communityId) === String(communityId));
  return c?.name || '';
}

export async function exportUpcomingBirthdays(data, { companyName, weekEnding, communities = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const residentSheet = workbook.addWorksheet('Residents');
  residentSheet.columns = [
    { header: 'Resident', key: 'name', width: 28 },
    { header: 'Community', key: 'community', width: 26 },
    { header: 'Product Type', key: 'productType', width: 14 },
    { header: 'Turning', key: 'turningAge', width: 10 },
    { header: 'Decade Milestone', key: 'milestone', width: 16 },
    { header: 'Birthday', key: 'birthdayDate', width: 14 },
  ];
  residentSheet.getRow(1).font = { bold: true };
  for (const r of data?.residents || []) {
    residentSheet.addRow({
      name: r.name || '',
      community: communityName(communities, r.communityId),
      productType: r.productType || '',
      turningAge: r.turningAge,
      milestone: r.isDecadeMilestone ? `Turning ${r.turningAge}` : '',
      birthdayDate: r.birthdayDate || '',
    });
  }

  const staffSheet = workbook.addWorksheet('Staff');
  staffSheet.columns = [
    { header: 'Staff', key: 'name', width: 28 },
    { header: 'Community', key: 'community', width: 26 },
    { header: 'Job Role', key: 'jobRole', width: 24 },
    { header: 'Birthday', key: 'birthdayDate', width: 14 },
  ];
  staffSheet.getRow(1).font = { bold: true };
  for (const s of data?.staff || []) {
    staffSheet.addRow({
      name: s.name || '',
      community: communityName(communities, s.communityId),
      jobRole: s.jobRole || '',
      birthdayDate: s.birthdayDate || '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'Wellness-Scorecard').replace(/[^a-z0-9.\-]/gi, '_')}-Upcoming-Birthdays-${weekEnding || ''}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
