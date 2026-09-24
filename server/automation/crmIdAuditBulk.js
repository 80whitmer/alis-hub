const fs = require('fs');
const path = require('path');
const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { captureCompanyDirectory } = require('./playwright/companiesPage');
const { captureCompanyDetail } = require('./playwright/companyDetailPage');
const { getAllHomeOfficeCompanies, getChildCompanies, getLifecycleDataQualityFlag } = require('../services/hubspotAccounts');
const { buildCrmIdAuditReport, normalizeNameKey } = require('../services/crmIdAuditNormalizer');
const { buildCrmIdAuditBulkWorkbook } = require('../services/crmIdAuditWorkbook');
const { setJobStatus, setItemStatus, syncJobItems, getJob, getCompanyHost } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * Reports (one workbook + a summary.json manifest) live on disk per job, not
 * the sql.js DB — same reasoning as acuity-reports/ (see that job's doc
 * comment): a full-portfolio run's combined JSON is bulkier than a single
 * blob column should carry, and sql.js rewrites the whole DB file on every
 * write.
 */
const REPORTS_ROOT = path.join(__dirname, 'crm-id-audit-bulk-reports');

function isCancelled(jobId) {
  return getJob(jobId)?.status === 'failed';
}

/**
 * Finds which ALIS Admin company record a HubSpot Home Office is actually
 * the same real account as — ID first, then the company_hosts subdomain
 * mapping, name only as a last resort. Confirmed necessary live (Aaron, Sep
 * 2026): a first run matching by name alone failed on ~half the portfolio
 * ("OneLife", "Ascent Senior Living", "Hearth and Truss", ...) even though
 * those are presumably real, correctly-linked accounts whose ALIS Admin
 * display name just doesn't match HubSpot's. Matching by the CRM ID itself
 * is the more fundamental check anyway — the whole audit exists to confirm
 * that link, so finding the record BY that link first (when it's already
 * right) is more correct than assuming names line up.
 */
function findAlisMatch(homeOffice, { byCrmId, byHost, byNameKey }) {
  const idMatch = byCrmId.get(String(homeOffice.id).trim());
  if (idMatch) return { row: idMatch, method: 'id' };

  const hostMapping = getCompanyHost({ hubspotCompanyId: homeOffice.id });
  const host = hostMapping?.company_host?.trim().toLowerCase();
  if (host) {
    const hostMatch = byHost.get(host);
    if (hostMatch) return { row: hostMatch, method: 'host' };
  }

  const nameMatch = byNameKey.get(normalizeNameKey(homeOffice.name));
  if (nameMatch) return { row: nameMatch, method: 'name' };

  return { row: null, method: null };
}

/**
 * Run the crm-id-audit-bulk job:
 *  1. Every active Home Office company (Client - Home Office lifecycle
 *     stage — Leads/Canceled excluded, same rule the Account Health/Team AM
 *     dashboards already use).
 *  2. Scrape EVERY company in the ALIS Admin directory (not just the ones
 *     that look name-matched) — company CRM ID + full Communities table —
 *     building an index by CRM ID and by host, since matching by ID/host is
 *     the whole point and can't be done without first knowing every ALIS
 *     company's own CRM ID.
 *  3. Match each Home Office to its ALIS record by ID, then host
 *     (company_hosts mapping), then name as a last resort (see
 *     findAlisMatch) — auditing the CRM ID field itself once matched, plus
 *     each Live/Onboarding community (Training excluded) against HubSpot
 *     child companies with the same ID-first matching.
 *
 * One shared Playwright login session for the whole run.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runCrmIdAuditBulkJob(jobId) {
  const emit = (event, data) => broadcast(jobId, event, data);
  setJobStatus(jobId, 'running');
  emit('job_start', { jobId });

  emit('progress', { message: 'Pulling active Home Office companies from HubSpot…' });
  let homeOffices;
  try {
    const { companies } = await getAllHomeOfficeCompanies();
    homeOffices = companies.filter((c) => getLifecycleDataQualityFlag(c.lifecycleStage) === null);
    emit('progress', { message: `${homeOffices.length} active Home Office companies (of ${companies.length} total, ${companies.length - homeOffices.length} excluded as Lead/Canceled/other-stage).` });
  } catch (err) {
    const error = `Failed to pull Home Office companies from HubSpot: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  if (homeOffices.length === 0) {
    const error = 'No active Home Office companies found in HubSpot.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  emit('progress', { message: 'Logging in to admin.alisonline.com and reading the full company directory…' });
  let page;
  let directory;
  try {
    page = await newPage();
    await ensureLoggedIn(page);
    directory = await captureCompanyDirectory(page);
    emit('progress', { message: `Read ${directory.length} companies from the ALIS Admin directory — scraping each one's CRM ID and Communities (this is the slow part)…` });
  } catch (err) {
    const error = `Failed to read the ALIS Admin company directory: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    if (page) await page.context().close().catch(() => {});
    return;
  }

  // ── Scrape every ALIS company's detail page — the only way to know its
  // CRM ID before matching, since CRM ID isn't in the directory listing. ──
  const itemNames = directory.map((row) => `${row.companyName} [${row.alisAdminCompanyId}]`);
  syncJobItems(jobId, itemNames);
  emit('job_start', { jobId, total: directory.length });

  const byAdminId = new Map();
  const byCrmId = new Map();
  const byHost = new Map();
  const byNameKey = new Map();
  let scrapeFailures = 0;

  for (let i = 0; i < directory.length; i++) {
    if (isCancelled(jobId)) break;
    const row = directory[i];
    const itemName = itemNames[i];
    setItemStatus(jobId, itemName, 'running');
    emit('item_start', { name: itemName });

    try {
      const detail = await captureCompanyDetail(page, row.alisAdminCompanyId);
      const entry = { ...row, detail };
      byAdminId.set(row.alisAdminCompanyId, entry);
      if (detail.crmId) byCrmId.set(detail.crmId.trim(), entry);
      if (row.companyHost) byHost.set(row.companyHost.trim().toLowerCase(), entry);
      byNameKey.set(normalizeNameKey(row.companyName), entry);
      setItemStatus(jobId, itemName, 'success');
      emit('item_done', { name: itemName });
    } catch (err) {
      scrapeFailures++;
      console.error(`[crm-id-audit-bulk:${jobId}] Detail scrape failed for "${row.companyName}" [${row.alisAdminCompanyId}]:`, err);
      setItemStatus(jobId, itemName, 'failed', err.message);
      emit('item_fail', { name: itemName, error: err.message });
    }
    if ((i + 1) % 25 === 0) emit('progress', { message: `Scraped ${i + 1} of ${directory.length} ALIS companies (${scrapeFailures} failed so far)…` });
  }

  await page.context().close().catch(() => {});

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  emit('progress', { message: `Finished scraping ALIS Admin (${byAdminId.size} of ${directory.length} companies captured). Matching each Home Office and comparing CRM IDs…` });

  // ── Match each Home Office to its ALIS record (ID > host > name) and build its report ──
  const companyResults = [];
  const matchMethodCounts = { id: 0, host: 0, name: 0, none: 0 };
  for (const homeOffice of homeOffices) {
    if (isCancelled(jobId)) break;

    const { row: alisRow, method: matchMethod } = findAlisMatch(homeOffice, { byCrmId, byHost, byNameKey });
    matchMethodCounts[matchMethod || 'none']++;

    if (!alisRow) {
      companyResults.push({
        companyName: homeOffice.name,
        hubspotCompanyId: homeOffice.id,
        report: buildCrmIdAuditReport({
          companyName: homeOffice.name,
          alisAdminCompanyId: null,
          companyCrmId: null,
          hubspotCompanyId: homeOffice.id,
          matchMethod: null,
          alisCommunities: [],
          hubspotChildCompanies: null,
        }),
      });
      continue;
    }

    let hubspotChildCompanies = null;
    let hubspotLookupError = null;
    try {
      hubspotChildCompanies = await getChildCompanies(homeOffice.id);
    } catch (err) {
      hubspotLookupError = err.message;
    }

    const report = buildCrmIdAuditReport({
      companyName: homeOffice.name,
      alisAdminCompanyId: alisRow.alisAdminCompanyId,
      alisCompanyName: alisRow.companyName,
      companyCrmId: alisRow.detail.crmId,
      hubspotCompanyId: homeOffice.id,
      matchMethod,
      alisCommunities: alisRow.detail.communities,
      hubspotChildCompanies,
      hubspotLookupError,
    });
    report.sourceUrl = alisRow.detail.sourceUrl;
    report.capturedAt = alisRow.detail.capturedAt;

    companyResults.push({ companyName: homeOffice.name, hubspotCompanyId: homeOffice.id, report });
  }

  emit('progress', {
    message: `Matched ${matchMethodCounts.id} by CRM ID, ${matchMethodCounts.host} by ALIS host, ${matchMethodCounts.name} by name only, and could not match ${matchMethodCounts.none} at all.`,
  });

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  emit('progress', { message: 'Building the portfolio-wide Excel workbook…' });
  const generatedAt = new Date().toISOString();
  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `CRM ID Audit - Portfolio-Wide - ${generatedAt.slice(0, 10)}.xlsx`;

  try {
    await buildCrmIdAuditBulkWorkbook({ companyResults, generatedAt }).xlsx.writeFile(path.join(outDir, filename));
  } catch (err) {
    const error = `Failed to build the workbook: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  const matchedCount = companyResults.filter((r) => r.report.company.alisAdminCompanyId).length;
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    generatedAt,
    filename,
    companiesAudited: companyResults.length,
    companiesMatched: matchedCount,
    companiesUnmatched: companyResults.length - matchedCount,
    matchMethodCounts,
    companies: companyResults.map((r) => ({
      companyName: r.report.company.companyName,
      alisCompanyName: r.report.company.alisCompanyName,
      matchMethod: r.report.company.matchMethod,
      companyStatus: r.report.company.status,
      nameNote: r.report.company.nameNote,
      communityCount: r.report.communities.length,
      communityProblems: r.report.communities.filter((c) => c.status === 'MISMATCH' || c.status.startsWith('MISSING')).length,
    })),
  }, null, 2));

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runCrmIdAuditBulkJob, REPORTS_ROOT };
