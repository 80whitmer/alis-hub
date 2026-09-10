const { newPage, ensureLoggedIn }          = require('./playwright/browser');
const { createCommunity, setCrmId }        = require('./playwright/communityPage');
const { navigateToBillingSettings, updateGLAccount, closeDetailView } = require('./playwright/billingPage');
const { captureResidentSettings, applyResidentSettings } = require('./playwright/residentSettingsPage');
const { getSettingsDestination } = require('../services/settingsDestinations');
const { setJobStatus, setItemStatus }      = require('../db/database');
const { broadcast }                        = require('../api/broadcaster');
const { getTemplate }                      = require('./templates-loader');
const { runKpiExportJob }                  = require('./kpiExport');
const { runWellnessScorecardJob }          = require('./wellnessExport');
const { runCommunityRevenueSnapshotJob }   = require('./communityRevenueSnapshot');
const { runCompanyUsageAuditJob }          = require('./usageAudit');
const { runAuditHistoryJob }               = require('./auditHistoryJob');

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

      case 'sync-resident-settings':
        return await runSyncResidentSettingsJob(jobId, payload);

      case 'kpi-export':
        return await runKpiExportJob(jobId, payload);

      case 'wellness-scorecard':
        return await runWellnessScorecardJob(jobId, payload);

      case 'community-revenue-snapshot':
        return await runCommunityRevenueSnapshotJob(jobId, payload);

      case 'company-usage-audit':
        return await runCompanyUsageAuditJob(jobId, payload);

      case 'audit-history':
        return await runAuditHistoryJob(jobId, payload);

      default: {
        const error = `No handler for template: ${template.id}`;
        setJobStatus(jobId, 'failed', error);
        emit('job_error', { error });
      }
    }
  } catch (err) {
    // This is the catch-all for a genuine unhandled exception escaping a
    // template handler (as opposed to a handler's own clean "failed" exit
    // with a specific message) — the stack trace is what makes this one
    // debuggable after the fact instead of just "something threw."
    setJobStatus(jobId, 'failed', err.stack || err.message);
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
        syncDate, // Pass the sync date from the job
        jobId     // Pass jobId for logging GL sync details
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

/**
 * Resolves a sourceUrl/target url from (category, companyHost, communityId)
 * via settingsDestinations.js when a raw url isn't given directly — this is
 * what generalized "Sync Resident Settings" into "Sync ALIS Settings"
 * (captureFormFields/applyFormFields were never actually Resident-specific,
 * they just hadn't been pointed anywhere else). An explicit `url` always
 * wins, so every job payload saved before this existed keeps working
 * unchanged.
 */
function resolveSettingsUrl({ url, category, companyHost, communityId }) {
  if (url) return url;
  if (!category || !companyHost) {
    throw new Error('Either a direct URL, or both category + companyHost, are required.');
  }
  const dest = getSettingsDestination(category);
  if (dest.scope === 'community' && !communityId) {
    throw new Error(`"${dest.label}" is a per-community settings page — a communityId is required.`);
  }
  return dest.urlFor(companyHost, communityId);
}

/**
 * Run the sync-settings job (formerly "sync-resident-settings" — same
 * engine, now pointed at any Settings category via settingsDestinations.js,
 * not just Resident Settings).
 *
 * Phase 1 — captures all form-field states + compliance template properties
 *            from the source page.
 * Phase 2 — applies that snapshot to each target.
 *
 * Each target is one job item (pass/fail).
 * SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runSyncResidentSettingsJob(jobId, payload) {
  const { sourceName, category, companyHost, sourceCommunityId, targets: rawTargets } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);

  let sourceUrl;
  let targets;
  try {
    sourceUrl = resolveSettingsUrl({ url: payload.sourceUrl, category, companyHost, communityId: sourceCommunityId });
    targets = rawTargets.map((t) => ({
      name: t.name,
      url: resolveSettingsUrl({ url: t.url, category, companyHost, communityId: t.communityId }),
    }));
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: err.message });
    return;
  }

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: targets.length, source: sourceName });

  // ── Phase 1: Capture source ──────────────────────────────────────────────
  let page;
  try {
    page = await newPage();
    await ensureLoggedIn(page, sourceUrl);
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `Login failed: ${err.message}` });
    return;
  }

  let snapshot;
  try {
    emit('progress', { message: `Capturing settings from "${sourceName}"…` });
    snapshot = await captureResidentSettings(page, sourceUrl);
    emit('progress', {
      message:
        `Captured — checkboxes: ${snapshot.fields.checkboxes.length}, ` +
        `selects: ${snapshot.fields.selects.length}, ` +
        `compliance items (deep config): ${snapshot.complianceItemsDeep.length}`,
    });
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: `Failed to capture source settings: ${err.message}` });
    await page.context().close().catch(() => {});
    return;
  }

  // ── Phase 2: Apply to each target ────────────────────────────────────────
  for (const target of targets) {
    setItemStatus(jobId, target.name, 'running');
    emit('item_start', { name: target.name });

    try {
      // ensureLoggedIn handles re-auth when switching to a different subdomain
      await ensureLoggedIn(page, target.url);

      const result = await applyResidentSettings(
        page,
        target.url,
        snapshot,
        emit,
      );

      setItemStatus(jobId, target.name, 'success');
      emit('item_done', {
        name:    target.name,
        applied: result.applied,
        skipped: result.skipped,
        failed:  result.failed,
      });
    } catch (err) {
      const shot = `error_settings_${target.name.replace(/[^a-z0-9]/gi, '_')}_${jobId}.png`;
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      setItemStatus(jobId, target.name, 'failed', err.message);
      emit('item_fail', { name: target.name, error: err.message });
    }
  }

  await page.context().close().catch(() => {});

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, source: sourceName, targets: targets.length });
}

module.exports = {
  runCreateCommunitiesJob,
  runTemplateJob,
  runSyncGLAccountsJob,
  runSyncResidentSettingsJob,
  runKpiExportJob,
};
