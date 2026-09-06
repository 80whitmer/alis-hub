/**
 * Exports the "incident reports needing completion" list to an .xlsx file —
 * see kpiNormalizer.js's normalizeIncidentCompletion for where openItems/
 * byCommunity's fields come from. Per client feedback (Gallaher,
 * 2026-09-01), this is the worklist a nurse/AM would use to close out
 * incident documentation and interventions community by community.
 */
import ExcelJS from 'exceljs';

/** 'YYYY-MM-DD' from an ISO date/datetime string, or '' if missing/invalid. */
function dateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export async function exportIncidentCompletion({ byCommunity, openItems }, companyName) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Completion by Community');
  summarySheet.columns = [
    { header: 'Community', key: 'name', width: 30 },
    { header: 'Total Incidents', key: 'total', width: 16 },
    { header: 'Fully Documented', key: 'complete', width: 18 },
    { header: 'Open (Forms/Tasks)', key: 'openItemCount', width: 18 },
    { header: '% Complete', key: 'pctComplete', width: 14 },
    { header: 'Incomplete Forms', key: 'totalIncompleteForms', width: 16 },
    { header: 'Incomplete Tasks', key: 'totalIncompleteTasks', width: 16 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  for (const c of byCommunity || []) {
    summarySheet.addRow({
      name: c.name,
      total: c.total,
      complete: c.complete,
      openItemCount: c.openItemCount,
      pctComplete: c.pctComplete != null ? Number((c.pctComplete * 100).toFixed(1)) : '',
      totalIncompleteForms: c.totalIncompleteForms,
      totalIncompleteTasks: c.totalIncompleteTasks,
    });
  }

  const openSheet = workbook.addWorksheet('Open Incident Reports');
  openSheet.columns = [
    { header: 'Resident', key: 'residentName', width: 26 },
    { header: 'Community', key: 'communityName', width: 30 },
    { header: 'Incident Type', key: 'incidentType', width: 26 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Incomplete Forms', key: 'incompleteForms', width: 16 },
    { header: 'Incomplete Tasks', key: 'incompleteTasks', width: 16 },
  ];
  openSheet.getRow(1).font = { bold: true };
  for (const item of openItems || []) {
    openSheet.addRow({
      residentName: item.residentName || `Resident ${item.incidentId ?? ''}`,
      communityName: item.communityName || '—',
      incidentType: item.incidentType || '—',
      date: dateOnly(item.incidentDateTime),
      incompleteForms: item.incompleteForms,
      incompleteTasks: item.incompleteTasks,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-incident-completion.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
