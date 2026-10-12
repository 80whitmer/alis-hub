const fs = require('fs');
const path = require('path');
const { buildMovedOutBillingReport, buildMovedOutBillingWorkbook } = require('../services/movedOutBilling');
const { setJobStatus } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * One workbook + a summary.json manifest per job, on disk rather than the
 * sql.js DB — same reasoning as med-cart-reports/ and acuity-reports/.
 */
const REPORTS_ROOT = path.join(__dirname, 'moved-out-billing-reports');

function safeFilename(s) {
  return s.replace(/[^a-z0-9 .\-()]/gi, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Run the moved-out-billing job: one company host, three live API pulls — no
 * per-item loop, so this just does the work and reports done/failed.
 *
 * Emits SSE events: job_start | progress | job_done | job_error
 */
async function runMovedOutBillingJob(jobId, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);
  const { companyName, companyHost, communityName } = payload;

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: 1, company: companyName });

  if (!companyHost) {
    const error = 'ALIS Company Host is required.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  let report;
  try {
    emit('progress', { message: 'Pulling moved-out recurring charges, outstanding invoices, and move-out dates from ALIS…' });
    report = await buildMovedOutBillingReport(companyHost, { communityName });
  } catch (err) {
    console.error(`[moved-out-billing:${jobId}] Failed:`, err);
    setJobStatus(jobId, 'failed', err.message);
    emit('job_error', { error: err.message });
    return;
  }

  const { counts } = report;
  emit('progress', {
    message: `${counts.flagged} moved-out resident(s) flagged — ${counts.high} with a live charge, ${counts.medium} with an open invoice only, ${counts.low} with a charge that ran past move-out.`,
  });

  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const label = companyName || companyHost;
  const filename = safeFilename(`${label} - Moved-Out Billing Review (${report.generatedOn}).xlsx`);

  try {
    await buildMovedOutBillingWorkbook(report).xlsx.writeFile(path.join(outDir, filename));
  } catch (err) {
    const error = `Failed to build the workbook: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    filename,
    companyName: label,
    companyHost,
    communityFilter: report.communityFilter,
    counts,
    communities: report.communities,
  }, null, 2));

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runMovedOutBillingJob, REPORTS_ROOT };
