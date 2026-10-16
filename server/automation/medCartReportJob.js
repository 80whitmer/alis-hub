const fs = require('fs');
const path = require('path');
const { buildMedCartReport, buildMedCartWorkbook } = require('../services/medCartReport');
const { setJobStatus } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * One workbook + a summary.json manifest per job, on disk rather than the
 * sql.js DB — same reasoning as acuity-reports/ and crm-id-audit-bulk-reports/
 * (resident-level detail is bulkier than a blob column should carry, and
 * sql.js rewrites the whole DB file on every write).
 */
const REPORTS_ROOT = path.join(__dirname, 'med-cart-reports');

function safeFilename(s) {
  return s.replace(/[^a-z0-9 .\-()]/gi, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Run the med-cart-report job: single community, single pull — no per-item
 * loop needed (unlike the multi-community templates), so this just does the
 * work and reports done/failed.
 *
 * Emits SSE events: job_start | progress | job_done | job_error
 */
async function runMedCartReportJob(jobId, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);
  const { companyName, companyHost, communityId, communityName, startDate, endDate, floorPlan = [] } = payload;

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: 1, company: companyName });

  if (!companyHost) {
    const error = 'ALIS Company Host is required.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }
  if (!communityId && !communityName) {
    const error = 'Either Community ID or Community Name is required.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }
  if (!Array.isArray(floorPlan) || floorPlan.length === 0) {
    const error = 'Floor Plan rows are required — import or paste the ALIS Floor Plan export (Unit #, Assigned To, Default Med Cart).';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  let report;
  try {
    emit('progress', { message: 'Pulling community, residents, and medication-pass activity from ALIS…' });
    report = await buildMedCartReport(
      companyHost,
      { communityId, name: communityName },
      floorPlan,
      { startDate, endDate }
    );
  } catch (err) {
    console.error(`[med-cart-report:${jobId}] Failed:`, err);
    setJobStatus(jobId, 'failed', err.message);
    emit('job_error', { error: err.message });
    return;
  }

  emit('progress', {
    message: `Matched ${report.counts.matchedResidents} of ${report.counts.floorPlanResidents} floor-plan residents (${report.counts.unmatchedFloorPlan} unmatched, ${report.counts.missingCart} missing a cart) · ${report.counts.ordersCovered} medication orders in range.`,
  });

  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const filename = safeFilename(`${report.community.communityName} - Med Cart Report (${report.period.startDate} to ${report.period.endDate}).xlsx`);

  try {
    await buildMedCartWorkbook(report).xlsx.writeFile(path.join(outDir, filename));
  } catch (err) {
    const error = `Failed to build the workbook: ${err.message}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    filename,
    community: report.community,
    period: report.period,
    counts: report.counts,
  }, null, 2));

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runMedCartReportJob, REPORTS_ROOT };
