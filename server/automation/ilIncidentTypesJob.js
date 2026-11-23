const path = require('path');
const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { createIncidentType } = require('./playwright/incidentTypePage');
const { setJobStatus, setItemStatus, syncJobItems } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * Run the il-incident-types job: for each incident type, open the Create
 * Incident Type panel, set name + reporting label, multi-select the IL
 * communities, attach the (existing) Independent Incident Form as Required,
 * and submit. Runs one type at a time; a type that already exists is skipped,
 * so re-running after a partial failure is safe.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done | job_error
 */
async function runIlIncidentTypesJob(jobId, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);
  const {
    companyName, companyHost, communities = [], incidentTypes = [],
    formName = 'Independent Incident Form', formRequired = true, dryRun = false,
  } = payload;

  if (!companyHost || !incidentTypes.length || !communities.length) {
    const error = 'companyHost, at least one incident type, and at least one community are required.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  const names = incidentTypes.map((t) => t.name);
  syncJobItems(jobId, names);
  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: names.length, company: companyName, dryRun });
  emit('progress', { message: `${dryRun ? 'DRY RUN — nothing will be submitted. ' : ''}${names.length} types × ${communities.length} communities, form "${formName}" ${formRequired ? '(Required)' : '(Optional)'}.` });

  let page;
  try {
    page = await newPage();
    await ensureLoggedIn(page, `https://${companyHost}.alisonline.com/Settings/Incidents`);
  } catch (err) {
    setJobStatus(jobId, 'failed', `Login failed: ${err.message}`);
    emit('job_error', { error: `Login failed: ${err.message}` });
    await page?.context().close().catch(() => {});
    return;
  }

  let created = 0, dry = 0, skipped = 0, failed = 0;
  for (const type of incidentTypes) {
    setItemStatus(jobId, type.name, 'running');
    emit('item_start', { name: type.name });
    try {
      const shot = path.join(__dirname, 'data', 'il-incident-types', `shot_${jobId}_${type.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`);
      const r = await createIncidentType(page, companyHost, type, {
        communities, formName, formRequired, dryRun, screenshotPath: dryRun ? shot : null,
      });
      if (r.status === 'created') created++;
      else if (r.status === 'dry-run') dry++;
      else skipped++;
      setItemStatus(jobId, type.name, 'success', null, { outcome: r.status, detail: r.summary });
      emit('item_done', { name: type.name, status: r.status, detail: r.summary });
    } catch (err) {
      failed++;
      await page.screenshot({ path: path.join(__dirname, '..', `error_incident_type_${jobId}_${type.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`), fullPage: true }).catch(() => {});
      setItemStatus(jobId, type.name, 'failed', err.message);
      emit('item_fail', { name: type.name, error: err.message });
    }
  }

  await page.context().close().catch(() => {});
  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, company: companyName, total: names.length, created, dryRun: dry, skipped, failed });
}

module.exports = { runIlIncidentTypesJob };
