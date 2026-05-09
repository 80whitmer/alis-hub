const { newPage, ensureLoggedIn }          = require('./playwright/browser');
const { createCommunity, setCrmId }        = require('./playwright/communityPage');
const { setJobStatus, setItemStatus }      = require('../db/database');
const { broadcast }                        = require('../api/broadcaster');

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

module.exports = { runCreateCommunitiesJob };
