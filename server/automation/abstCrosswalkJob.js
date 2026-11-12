const fs = require('fs');
const path = require('path');
const { buildAbstCrosswalk } = require('../services/abstCrosswalk');
const { buildAbstCrosswalkWorkbook } = require('../services/abstCrosswalkWorkbook');
const { setJobStatus } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * report.json (resident PHI) + .xlsx per job, on disk under a git-ignored folder, served only
 * through the authenticated API (server/api/abstCrosswalk.js). Never write these to a shared
 * or public path, and never log resident names — progress messages carry counts only.
 */
const REPORTS_ROOT = path.join(__dirname, 'abst-crosswalk-reports');

function safeFilename(s) {
  return s.replace(/[^a-z0-9 .\-()]/gi, '_').replace(/\s+/g, ' ').trim();
}

async function runAbstCrosswalkJob(jobId, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);
  const { companyName, companyHost, communityId, retName, careItems, footnote } = payload;

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: 1, company: companyName });

  const fail = (error) => {
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
  };

  if (!companyHost) return fail('ALIS Company Host is required.');
  if (!communityId) return fail('ALIS Community ID is required.');

  let report;
  try {
    report = await buildAbstCrosswalk(companyHost, {
      communityId,
      retName: retName || undefined,
      careItems,
      footnote: footnote || '',
      onProgress: (message) => emit('progress', { message }),
    });
  } catch (err) {
    console.error(`[abst-crosswalk:${jobId}] Failed:`, err.message);
    return fail(err.message);
  }

  const gaps = report.summary.reduce((s, e) => s + e.counts.assessed_no_minutes, 0);
  const notAssessed = report.summary.reduce((s, e) => s + e.counts.not_assessed, 0);
  emit('progress', {
    message: `Built ${report.meta.residentCount} residents x 22 elements · ${gaps} "minutes not yet configured" · ${notAssessed} "not assessed".`,
  });

  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const filename = safeFilename(`${report.meta.communityName} - Oregon ABST Crosswalk (${report.meta.generatedAt.slice(0, 10)}).xlsx`);

  try {
    await buildAbstCrosswalkWorkbook(report).xlsx.writeFile(path.join(outDir, filename));
  } catch (err) {
    return fail(`Failed to build the workbook: ${err.message}`);
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...report, filename }));

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runAbstCrosswalkJob, REPORTS_ROOT };
