/**
 * crmIdAuditWorkbook.js
 * Builds the portfolio-wide CRM ID Audit .xlsx from an array of per-company
 * crmIdAuditNormalizer reports (see crmIdAuditBulk.js) — one Summary sheet,
 * one Companies sheet, one Communities sheet, same ExcelJS conventions
 * (styleHeader, colored status fills) as acuityHistory.js/usageAuditExport.js.
 */
const ExcelJS = require('exceljs');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const STATUS_FILL = {
  MATCH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } },
  MISMATCH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E7' } },
  MISSING_ON_ALIS_SIDE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E7' } },
  MISSING_ON_HUBSPOT_SIDE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E7' } },
  NO_HUBSPOT_MATCH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
  NO_ALIS_ADMIN_MATCH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
  HUBSPOT_LOOKUP_UNAVAILABLE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
  SKIPPED_NOT_LIVE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
  BOTH_BLANK: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
};

const MATCH_METHOD_LABEL = { id: 'CRM ID', host: 'ALIS Host', name: 'Name only', null: 'Unmatched' };

function styleHeader(sheet) {
  sheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
}

function buildCrmIdAuditBulkWorkbook({ companyResults, generatedAt }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';

  const totals = { company: {}, community: {} };
  for (const r of companyResults) {
    totals.company[r.report.company.status] = (totals.company[r.report.company.status] || 0) + 1;
    for (const c of r.report.communities) {
      totals.community[c.status] = (totals.community[c.status] || 0) + 1;
    }
  }

  // ── Summary ──
  const s = wb.addWorksheet('Summary');
  s.getColumn(1).width = 32;
  s.getColumn(2).width = 20;
  const title = s.addRow(['ALIS ↔ HubSpot CRM ID Audit — Portfolio-Wide']);
  title.getCell(1).font = { bold: true, size: 14 };
  s.addRow([`Generated: ${new Date(generatedAt).toLocaleString()}`]);
  s.addRow([`Companies audited: ${companyResults.length}`]);
  s.addRow([]);
  s.addRow(['Matched by', 'Count']).eachCell((c) => { c.font = { bold: true }; });
  const matchCounts = { id: 0, host: 0, name: 0, null: 0 };
  for (const r of companyResults) matchCounts[r.report.company.matchMethod || 'null']++;
  for (const [method, count] of Object.entries(matchCounts)) s.addRow([MATCH_METHOD_LABEL[method], count]);
  s.addRow([]);
  s.addRow(['Company-level status', 'Count']).eachCell((c) => { c.font = { bold: true }; });
  for (const [status, count] of Object.entries(totals.company)) s.addRow([status, count]);
  s.addRow([]);
  s.addRow(['Community-level status', 'Count']).eachCell((c) => { c.font = { bold: true }; });
  for (const [status, count] of Object.entries(totals.community)) s.addRow([status, count]);

  // ── Companies ──
  const c = wb.addWorksheet('Companies');
  c.columns = [
    { header: 'HubSpot Company Name', key: 'companyName', width: 32 },
    { header: 'ALIS Company Name', key: 'alisCompanyName', width: 32 },
    { header: 'Matched By', key: 'matchMethod', width: 12 },
    { header: 'ALIS Admin Company ID', key: 'alisAdminCompanyId', width: 20 },
    { header: 'ALIS CRM ID', key: 'alisCrmId', width: 18 },
    { header: 'HubSpot Record ID', key: 'hubspotRecordId', width: 18 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Name Note', key: 'nameNote', width: 50 },
  ];
  for (const r of companyResults) {
    const co = r.report.company;
    const row = c.addRow({
      companyName: co.companyName,
      alisCompanyName: co.alisCompanyName,
      matchMethod: MATCH_METHOD_LABEL[co.matchMethod || 'null'],
      alisAdminCompanyId: co.alisAdminCompanyId,
      alisCrmId: co.alisCrmId,
      hubspotRecordId: co.hubspotRecordId,
      status: co.status,
      nameNote: co.nameNote || (r.report.hubspotLookupError ? `HubSpot lookup failed: ${r.report.hubspotLookupError}` : ''),
    });
    row.getCell('status').fill = STATUS_FILL[co.status] || null;
  }
  styleHeader(c);

  // ── Communities ──
  const m = wb.addWorksheet('Communities');
  m.columns = [
    { header: 'Company Name', key: 'companyName', width: 28 },
    { header: 'Community Name', key: 'communityName', width: 32 },
    { header: 'Status Badges', key: 'badges', width: 18 },
    { header: 'Matched By', key: 'matchMethod', width: 12 },
    { header: 'ALIS Community ID', key: 'alisCommunityId', width: 16 },
    { header: 'ALIS CRM ID', key: 'alisCrmId', width: 16 },
    { header: 'HubSpot Record ID', key: 'hubspotRecordId', width: 16 },
    { header: 'HubSpot Matched Name', key: 'hubspotMatchedName', width: 28 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Name Note', key: 'nameNote', width: 50 },
  ];
  for (const r of companyResults) {
    for (const community of r.report.communities) {
      const row = m.addRow({
        companyName: r.report.company.companyName,
        communityName: community.communityName,
        badges: (community.statusBadges || []).join(', '),
        matchMethod: community.matchMethod ? MATCH_METHOD_LABEL[community.matchMethod] : '',
        alisCommunityId: community.alisCommunityId,
        alisCrmId: community.alisCrmId,
        hubspotRecordId: community.hubspotRecordId,
        hubspotMatchedName: community.hubspotMatchedName,
        status: community.status,
        nameNote: community.nameNote || '',
      });
      row.getCell('status').fill = STATUS_FILL[community.status] || null;
    }
  }
  styleHeader(m);

  return wb;
}

module.exports = { buildCrmIdAuditBulkWorkbook };
