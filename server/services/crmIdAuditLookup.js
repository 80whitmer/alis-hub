/**
 * Cross-references currently-unmapped accounts against the most recent
 * "CRM ID Audit (bulk)" report already sitting on disk (Sep 2026, Aaron:
 * "check against last audit... zero new scraping, instant" — a live
 * portal-wide detail-page scan to resolve a handful of unmapped accounts by
 * CRM ID scales with the WHOLE ~550-company ALIS admin directory, not with
 * the few accounts actually left to map (see discoverAlisAdminIds's own
 * doc comment), so it's a real drag on a bigger portfolio like Team AM's
 * 460 accounts. crmIdAuditBulk.js's own bulk run already paid that cost
 * once and wrote every company's CRM ID to its workbook — reusing THAT
 * (a local file read, no browser, no login) is instant regardless of
 * portfolio size.
 *
 * Same result shape as discoverAlisAdminIds (autoMatched/ambiguous/
 * noCandidate/noAlisId/alreadyMapped) so the client can feed it into the
 * exact same review UI, plus `sourceReport` so the UI can show how stale
 * the data is — a CRM ID pairing rarely changes, but the human should
 * still see the date.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { REPORTS_ROOT } = require('../automation/crmIdAuditBulk');

/** Newest report dir (by its own generatedAt, not filesystem mtime) with both a summary.json and a workbook, or null if none exist yet. */
function findLatestReport() {
  if (!fs.existsSync(REPORTS_ROOT)) return null;
  const dirs = fs.readdirSync(REPORTS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  let latest = null;
  for (const d of dirs) {
    const summaryPath = path.join(REPORTS_ROOT, d.name, 'summary.json');
    if (!fs.existsSync(summaryPath)) continue;
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch {
      continue;
    }
    const workbookPath = path.join(REPORTS_ROOT, d.name, summary.filename);
    if (!fs.existsSync(workbookPath)) continue;
    if (!latest || new Date(summary.generatedAt) > new Date(latest.generatedAt)) {
      latest = { generatedAt: summary.generatedAt, workbookPath, jobId: d.name };
    }
  }
  return latest;
}

/**
 * `companies`: [{ id, name, alisAdminCompanyId }] — same shape
 * discoverAlisAdminIds takes. Returns { available: false } if no bulk audit
 * report has ever been run.
 */
async function checkAgainstLastAudit(companies) {
  const latest = findLatestReport();
  if (!latest) return { available: false };

  const unmapped = companies.filter((c) => !c.alisAdminCompanyId);
  const byHubspotId = new Map(unmapped.map((c) => [String(c.id).trim(), c]));
  const alreadyAssignedIds = new Set(
    companies.filter((c) => c.alisAdminCompanyId).map((c) => String(c.alisAdminCompanyId))
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(latest.workbookPath);
  const sheet = wb.getWorksheet('Companies');

  const autoMatched = [];
  if (sheet) {
    const header = sheet.getRow(1).values; // 1-indexed, [empty, 'HubSpot Company Name', ...]
    const colIndex = (label) => header.findIndex((v) => v === label);
    const nameCol = colIndex('HubSpot Company Name');
    const alisNameCol = colIndex('ALIS Company Name');
    const matchedByCol = colIndex('Matched By');
    const alisAdminIdCol = colIndex('ALIS Admin Company ID');
    const hubspotIdCol = colIndex('HubSpot Record ID');

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (row.getCell(matchedByCol).value !== 'CRM ID') return;
      const hubspotCompanyId = String(row.getCell(hubspotIdCol).value || '').trim();
      const alisAdminCompanyId = String(row.getCell(alisAdminIdCol).value || '').trim();
      if (!hubspotCompanyId || !alisAdminCompanyId) return;

      const hubspotMatch = byHubspotId.get(hubspotCompanyId);
      if (!hubspotMatch) return; // already mapped now, or not in this portfolio
      if (alreadyAssignedIds.has(alisAdminCompanyId)) return; // shouldn't happen if hubspotMatch is unmapped, but stay consistent with discoverAlisAdminIds

      autoMatched.push({
        hubspotCompanyId: hubspotMatch.id,
        companyName: hubspotMatch.name,
        alisAdminCompanyId,
        alisCompanyName: String(row.getCell(alisNameCol).value || row.getCell(nameCol).value || ''),
        companyHost: null, // not captured in this report — Check for Alignment Drift picks it up once the ID is confirmed
        score: 1,
        matchMethod: 'crmId',
      });
    });
  }

  return {
    available: true,
    sourceReport: { generatedAt: latest.generatedAt },
    directoryCount: null,
    crmIdMatchCount: autoMatched.length,
    crmIdReadFailures: 0,
    autoMatched,
    ambiguous: [],
    noAlisId: [],
    noCandidate: [],
    alreadyMapped: [],
  };
}

module.exports = { checkAgainstLastAudit, findLatestReport };
