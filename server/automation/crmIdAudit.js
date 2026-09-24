const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { captureCompanyDetail } = require('./playwright/companyDetailPage');
const { getChildCompanies } = require('../services/hubspotAccounts');
const { buildCrmIdAuditReport } = require('../services/crmIdAuditNormalizer');
const { setJobStatus, addCrmIdAuditSnapshot, getCompanyHost } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * Run the crm-id-audit job: for one ALIS company, scrape the ALIS Admin
 * company-detail page (company CRM ID + Communities table with each
 * community's own CRM ID and status badge), then cross-check every value
 * against HubSpot — the company's Record ID (from the company_hosts
 * mapping, or a value passed in directly) and each Live community's
 * matching child-company Record ID (matched by name).
 *
 * This is a data-integrity check, not a usage/entitlements audit — kept as
 * its own job template (rather than folded into company-usage-audit) since
 * it runs against a single ALIS Admin company ID with no HubSpot ticket/
 * deal/entitlements pull involved, and Aaron may want to run it on its own
 * cadence across the whole portfolio later.
 *
 * Emits SSE events: job_start | progress | job_done | job_error
 */
async function runCrmIdAuditJob(jobId, payload) {
  const { companyName, alisAdminCompanyId } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, company: companyName });

  if (!alisAdminCompanyId) {
    const error = 'ALIS Admin Company ID is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  let hubspotCompanyId = payload.hubspotCompanyId || null;
  if (!hubspotCompanyId) {
    const mapped = getCompanyHost({ companyName });
    hubspotCompanyId = mapped?.hubspot_company_id || null;
  }

  emit('progress', { message: `Logging in to admin.alisonline.com to read company ${alisAdminCompanyId}…` });
  let page;
  let detail;
  try {
    page = await newPage();
    await ensureLoggedIn(page);
    detail = await captureCompanyDetail(page, alisAdminCompanyId);
    emit('progress', { message: `Captured company CRM ID and ${detail.communities.length} communit${detail.communities.length === 1 ? 'y' : 'ies'}.` });
  } catch (err) {
    const error = `Failed to scrape ALIS Admin company ${alisAdminCompanyId}: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  } finally {
    if (page) await page.context().close().catch(() => {});
  }

  let hubspotChildCompanies = null;
  let hubspotLookupError = null;
  if (hubspotCompanyId) {
    try {
      emit('progress', { message: `Pulling child companies from HubSpot for record ${hubspotCompanyId}…` });
      hubspotChildCompanies = await getChildCompanies(hubspotCompanyId);
    } catch (err) {
      hubspotLookupError = err.message;
      console.error(`[crm-id-audit:${jobId}] HubSpot child-company lookup failed:`, err);
      emit('progress', { message: `HubSpot lookup failed — community rows will show HUBSPOT_LOOKUP_UNAVAILABLE: ${err.message}` });
    }
  } else {
    hubspotLookupError = 'No HubSpot Company ID provided or found in the company_hosts mapping — community rows will show HUBSPOT_LOOKUP_UNAVAILABLE.';
    emit('progress', { message: hubspotLookupError });
  }

  const report = buildCrmIdAuditReport({
    companyName,
    alisAdminCompanyId,
    companyCrmId: detail.crmId,
    hubspotCompanyId,
    alisCommunities: detail.communities,
    hubspotChildCompanies,
    hubspotLookupError,
  });
  report.sourceUrl = detail.sourceUrl;
  report.capturedAt = detail.capturedAt;

  addCrmIdAuditSnapshot(jobId, { companyName, alisAdminCompanyId, report });

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runCrmIdAuditJob };
