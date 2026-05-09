const { newPage, ensureLoggedIn }          = require('./playwright/browser');
const { createCommunity, setCrmId }        = require('./playwright/communityPage');
const { navigateToBillingSettings, updateGLAccount, closeDetailView } = require('./playwright/billingPage');
const { setJobStatus, setItemStatus }      = require('../db/database');
const { broadcast }                        = require('../api/broadcaster');
const { getTemplate }                      = require('./templates-loader');

/**
 * Run the create-communities job.
 * Emits SSE events: item_start | item_done | item_fail | job_done
 */
async function runCreateCommunitiesJob(jobId, { companyUrl, communities }) {
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: communities.length });

  let page;
  try {
    page = await newPage();
    await ensureLoggedIn(page);
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `Login failed: ${err.message}` });
    return;
  }

  for (const community of communities) {
    const { name, crm_id } = community;

    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    try {
      await createCommunity(page, companyUrl, community);
      await setCrmId(page, companyUrl, name, crm_id);

      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });

    } catch (err) {
      // Screenshot on failure
      const shot = `error_${name.replace(/[^a-z0-9]/gi, '_')}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      // Try to dismiss any open modal so the next community can proceed
      await page.locator(
        '.modal button:has-text("Cancel"), .modal .close, [aria-label="Close"]'
      ).first().click().catch(() => {});

      setItemStatus(jobId, name, 'failed', err.message);
      emit('item_fail', { name, error: err.message });
    }
  }

  await page.context().close().catch(() => {});

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

/**
 * Generic job runner for any template
 * Dispatches to template-specific handler
 */
async function runTemplateJob(jobId, template, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);

  try {
    setJobStatus(jobId, 'running');

    // Dispatch to template-specific handler
    switch (template.id) {
      case 'create-communities':
        return await runCreateCommunitiesJob(jobId, payload);

      case 'sync-gl-accounts':
        return await runSyncGLAccountsJob(jobId, payload);

      default:
        setJobStatus(jobId, 'failed');
        emit('job_error', { error: `No handler for template: ${template.id}` });
    }
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: err.message });
  }
}

/**
 * Run the sync-gl-accounts job
 * Emits SSE events: item_start | item_done | item_fail | job_done
 */
async function runSyncGLAccountsJob(jobId, { communityName, billingSettingsUrl, syncDate, items }) {
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: items.length, community: communityName });

  let page;
  try {
    page = await newPage();
    // Navigate directly to billing settings URL (handles login if needed)
    await ensureLoggedIn(page, billingSettingsUrl);
    // Verify we're on the right page
    await navigateToBillingSettings(page, billingSettingsUrl);
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `Setup failed: ${err.message}` });
    return;
  }

  // Filter out skipped items
  const activeItems = items.filter(item => item.gl_new && item.gl_new !== '?');

  let successCount = 0;
  let failureCount = 0;

  for (const item of items) {
    const { name, gl_old, gl_new, disc1_old, disc1_new, disc2_old, disc2_new } = item;

    // Skip items without new GL value
    if (!gl_new || gl_new === '?') {
      setItemStatus(jobId, name, 'skipped');
      emit('item_done', { name, status: 'skipped' });
      continue;
    }

    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    try {
      // Update the GL account mapping
      await updateGLAccount(
        page,
        name,
        gl_old,
        gl_new,
        {
          disc1_old,
          disc1_new: disc1_new || null,
          disc2_old,
          disc2_new: disc2_new || null,
        },
        syncDate // Pass the sync date from the job
      );

      // Close any open detail views to prepare for next item
      await closeDetailView(page);

      setItemStatus(jobId, name, 'success');
      emit('item_done', { name, gl_old, gl_new });
      successCount++;

    } catch (err) {
      // Take screenshot on failure for debugging
      const shot = `error_${jobId}_${name.replace(/[^a-z0-9]/gi, '_')}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      setItemStatus(jobId, name, 'failed', err.message);
      emit('item_fail', { name, error: err.message });
      failureCount++;
    }
  }

  await page.context().close().catch(() => {});

  const summary = {
    jobId,
    community: communityName,
    syncDate,
    total: items.length,
    updated: successCount,
    failed: failureCount,
    skipped: items.length - successCount - failureCount,
  };

  setJobStatus(jobId, 'done');
  emit('job_done', summary);
}

module.exports = {
  runCreateCommunitiesJob,
  runTemplateJob,
  runSyncGLAccountsJob,
};
