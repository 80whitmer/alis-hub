const { newPage, ensureLoggedIn }          = require('./playwright/browser');
const { createCommunity, setCrmId }        = require('./playwright/communityPage');
const { navigateToBillingSettings, updateGLAccount, closeDetailView } = require('./playwright/billingPage');
const { captureResidentSettings, applyResidentSettings } = require('./playwright/residentSettingsPage');
const { navigateToCareSettings, setCareItemAssistanceLevel, setCareItemReportingLabel } = require('./playwright/carePage');
const { listCurrentResidents, moveOutResident, nameKey } = require('./playwright/residentMoveOutPage');
const { getSettingsDestination } = require('../services/settingsDestinations');
const { getCommunities } = require('../services/alisApiClient');
const { setJobStatus, setItemStatus, syncJobItems } = require('../db/database');
const { broadcast }                        = require('../api/broadcaster');
const { getTemplate }                      = require('./templates-loader');
const { runKpiExportJob }                  = require('./kpiExport');
const { runWellnessScorecardJob }          = require('./wellnessExport');
const { runCommunityRevenueSnapshotJob }   = require('./communityRevenueSnapshot');
const { runCompanyUsageAuditJob }          = require('./usageAudit');
const { runCrmIdAuditJob }                 = require('./crmIdAudit');
const { runCrmIdAuditBulkJob }             = require('./crmIdAuditBulk');
const { runAuditHistoryJob }               = require('./auditHistoryJob');
const { runAcuityHistoryJob }              = require('./acuityHistoryJob');
const { runMedCartReportJob }              = require('./medCartReportJob');
const { runMovedOutBillingJob }            = require('./movedOutBillingJob');

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

      case 'crm-id-audit':
        return await runCrmIdAuditJob(jobId, payload);

      case 'crm-id-audit-bulk':
        return await runCrmIdAuditBulkJob(jobId);

      case 'audit-history':
        return await runAuditHistoryJob(jobId, payload);

      case 'resident-acuity-history':
        return await runAcuityHistoryJob(jobId, payload);

      case 'med-cart-report':
        return await runMedCartReportJob(jobId, payload);

      case 'moved-out-billing':
        return await runMovedOutBillingJob(jobId, payload);

      case 'resident-move-out':
        return await runResidentMoveOutJob(jobId, payload);

      case 'care-item-assistance-level':
        return await runCareItemAssistanceLevelJob(jobId, payload);

      case 'care-item-reporting-label':
        return await runCareItemReportingLabelJob(jobId, payload);

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

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Same
 * pattern as kpiExport.js's mapWithConcurrency (see its comment for why
 * `fn` must catch its own errors) — duplicated rather than imported since
 * it's a 10-line generic helper, not worth a shared module for one caller
 * on each side.
 */
async function mapWithConcurrency(items, limit, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch (err) {
        console.error('[care-item] mapWithConcurrency: fn should never throw — item may be incomplete:', err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Shared engine for the care-item-* jobs — bulk-sets one select field (see
 * `spec`: Assistance Level or Reporting Label) on named Care Items (Settings/Care/{communityId}?tab=Care) across
 * one or more communities. Built for Leisure Care's "add Total 2x Staff to
 * every item that calls out 2+ staff in its title" ask (Sep 2026); the item
 * list stays generic (name + target label) rather than hardcoding that
 * pattern, since the same engine works for any Care Item field this table
 * exposes via its edit pane.
 *
 * Each (community, item) pair is one job item — a community with 14 items
 * to fix produces 14 rows, so partial failure on one item doesn't lose
 * progress on the rest of that community.
 *
 * Communities run CONCURRENTLY (default 4 at once, see `concurrency`
 * payload field) — a first sequential version took ~5 minutes per
 * community (mostly ALIS server round-trips per item, not anything this
 * code controls), which would have put a 48-community portfolio run around
 * 4 hours. Each worker logs in independently (confirmed live, Sep 2026:
 * two simultaneous independent logins on the same ALIS account both stayed
 * authenticated — no concurrent-session kickout). An earlier version tried
 * sharing one login's storageState across workers instead, to avoid N real
 * login flows; confirmed live that this does NOT work here — a worker
 * page seeded with another context's storageState still bounced to
 * /Login, so each worker keeps its own real ensureLoggedIn call.
 *
 * SSE events: job_start | item_start | item_done | item_fail | job_done
 */
async function runCareItemFieldJob(jobId, payload, spec) {
  const { companyName, items } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);
  const concurrency = Math.max(1, Math.min(8, Number(payload.concurrency) || 4));

  const hosts = (payload.companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
  if (hosts.length === 0) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: 'ALIS Company Host is required.' });
    return;
  }
  if (!items || items.length === 0) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: spec.itemsRequiredMessage });
    return;
  }

  setJobStatus(jobId, 'running');

  // Resolve communities — explicit list (with per-entry host override), or
  // auto-pull every non-Training community per host, same convention as
  // usageAudit.js / wellnessExport.js.
  let communities = payload.communities;
  const unresolvedCommunities = [];
  if (communities && communities.length > 0) {
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));

    // Entries given by NAME only (no communityId) are looked up on their host
    // by exact, case/whitespace/apostrophe-insensitive name — so a pasted list
    // of community names works without hunting down IDs first. Names that
    // match nothing are surfaced as failed rows below, not silently dropped.
    const norm = (n) => String(n || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    const needLookup = communities.filter((c) => !c.communityId);
    if (needLookup.length > 0) {
      const byHost = {};
      for (const host of new Set(needLookup.map((c) => c.host))) {
        try {
          byHost[host] = await getCommunities(host);
        } catch (err) {
          emit('progress', { message: `Failed to look up communities on host "${host}": ${err.message}` });
          byHost[host] = [];
        }
      }
      communities = communities.filter((c) => {
        if (c.communityId) return true;
        const match = (byHost[c.host] || []).find((x) => norm(x.communityName) === norm(c.name));
        if (!match) {
          unresolvedCommunities.push(c.name);
          return false;
        }
        c.communityId = match.communityId;
        return true;
      });
      if (unresolvedCommunities.length > 0) {
        emit('progress', { message: `Could not find ${unresolvedCommunities.length} community name(s) on the host: ${unresolvedCommunities.join(', ')}` });
      }
    }
  } else {
    communities = [];
    for (const host of hosts) {
      try {
        const all = await getCommunities(host);
        const resolved = all
          .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host }));
        communities.push(...resolved);
        emit('progress', { message: `Auto-resolved ${resolved.length} communities from host "${host}".` });
      } catch (err) {
        emit('progress', { message: `Failed to auto-resolve communities from host "${host}": ${err.message}` });
      }
    }
  }

  if (communities.length === 0) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: 'No communities to process.' });
    return;
  }

  // Backfill job_items with the REAL per-(community,item) rows and the
  // correct total — this template's payload.communities is often empty at
  // request time (auto-discover), so /api/jobs/create's own item-count
  // guess is wrong (and even when communities IS given up front, the real
  // unit of work is communities × items, not communities alone). Without
  // this, every setItemStatus below silently updates zero rows (no row
  // exists with a matching name), so the progress bar stays frozen at
  // "0 of 0" and completed/failed never move — confirmed live (Sep 2026,
  // Aaron's first concurrent run) even though the underlying automation
  // ran correctly the whole time. Same fix already applied in every other
  // multi-community job (kpiExport.js, wellnessExport.js, usageAudit.js, …).
  const itemNames = [];
  for (const community of communities) {
    for (const item of items) itemNames.push(`${community.name} — ${item.name}`);
  }
  const unresolvedNames = unresolvedCommunities.map((n) => `${n} — (community not found on host)`);
  syncJobItems(jobId, [...itemNames, ...unresolvedNames]);
  for (const n of unresolvedNames) {
    setItemStatus(jobId, n, 'failed', 'No community with this name exists on the given ALIS host');
  }

  emit('job_start', { jobId, total: itemNames.length + unresolvedNames.length, company: companyName, concurrency });

  let updated = 0, alreadySet = 0, skipped = 0, failed = unresolvedNames.length;

  async function processCommunity(community) {
    const url = `https://${community.host}.alisonline.com/Settings/Care/${community.communityId}?tab=Care`;
    let page;

    try {
      page = await newPage();
      await ensureLoggedIn(page, url);
      await navigateToCareSettings(page, url);
    } catch (err) {
      // Whole community unreachable — fail every item under it rather than
      // silently skipping (matches the rest of this job's per-item accounting).
      for (const item of items) {
        const name = `${community.name} — ${item.name}`;
        setItemStatus(jobId, name, 'failed', `Could not load Care Settings: ${err.message}`);
        emit('item_fail', { name, error: `Could not load Care Settings: ${err.message}` });
        failed++;
      }
      await page?.context().close().catch(() => {});
      return;
    }

    for (const item of items) {
      const name = `${community.name} — ${item.name}`;
      setItemStatus(jobId, name, 'running');
      emit('item_start', { name });

      try {
        const result = await spec.apply(page, item);

        if (result.status === 'updated') {
          updated++;
          setItemStatus(jobId, name, 'success', null, { outcome: 'updated', detail: `${result.previousValue || '(blank)'} → ${spec.targetOf(item)}` });
          emit('item_done', { name, status: 'updated', from: result.previousValue, to: spec.targetOf(item) });
        } else if (result.status === 'already-set') {
          alreadySet++;
          setItemStatus(jobId, name, 'success', null, { outcome: 'already-set', detail: result.previousValue });
          emit('item_done', { name, status: 'already-set' });
        } else if (result.status === 'skipped-different-value') {
          skipped++;
          setItemStatus(jobId, name, 'success', null, { outcome: 'skipped', detail: `left as "${result.previousValue}"` });
          emit('item_done', { name, status: 'skipped', from: result.previousValue, note: `${spec.fieldName} is "${result.previousValue}", not "${item.fromLabel}" — left unchanged` });
        } else if (result.status === 'not-found') {
          failed++;
          setItemStatus(jobId, name, 'failed', 'Item not found on this community\'s Care Settings page');
          emit('item_fail', { name, error: 'Item not found on this community\'s Care Settings page' });
        } else {
          failed++;
          setItemStatus(jobId, name, 'failed', `This item has no ${spec.fieldName} field`);
          emit('item_fail', { name, error: `This item has no ${spec.fieldName} field` });
        }
      } catch (err) {
        const shot = `error_care_${jobId}_${name.replace(/[^a-z0-9]/gi, '_')}.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

        failed++;
        setItemStatus(jobId, name, 'failed', err.message);
        emit('item_fail', { name, error: err.message });
      }
    }

    await page.context().close().catch(() => {});
  }

  await mapWithConcurrency(communities, concurrency, processCommunity);

  setJobStatus(jobId, 'done');
  emit('job_done', {
    jobId,
    company: companyName,
    communities: communities.length,
    total: itemNames.length,
    updated,
    alreadySet,
    skipped,
    failed,
  });
}

/**
 * Run the resident-move-out job — moves out a named list of residents from one
 * community's Current Residents tab by driving ALIS's Move Out pane (for bulk
 * move-outs the importer can't action). Strictly sequential: these are real,
 * hard-to-undo writes, and one browser page keeps the audit trail simple.
 *
 * Residents are matched by "Last, First" against the live Current tab; any
 * name with no match (or more than one) fails its own row without touching ALIS.
 * Every resident inherits the job-level move-out details and may override any of
 * them (e.g. a per-person time). `dryRun` fills and verifies the form but never
 * clicks Confirm — use it on a couple of residents first.
 *
 * SSE events: job_start | item_start | item_done | item_fail | job_done
 */
async function runResidentMoveOutJob(jobId, payload) {
  const { companyName, companyHost, communityId, residents, dryRun = false } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);

  const fail = (error) => {
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
  };
  if (!companyHost) return fail('ALIS Company Host is required.');
  if (!communityId) return fail('ALIS Community ID is required.');
  if (!Array.isArray(residents) || residents.length === 0) return fail('At least one resident (name) is required.');

  // detail key -> [payload default key, label]
  const FIELDS = {
    physicalDate: ['physicalMoveOutDate', 'Physical Move Out Date'],
    physicalTime: ['physicalMoveOutTime', 'Physical Move Out Time'],
    reason: ['moveOutReason', 'Move Out Reason'],
    destination: ['moveOutDestination', 'Move Out Destination'],
    financialDate: ['financialMoveOutDate', 'Financial Move Out Date'],
  };
  for (const [, [key, label]] of Object.entries(FIELDS)) {
    if (!payload[key] && !residents.every((r) => r[key])) {
      return fail(`${label} is required (set it on the job, or on every resident).`);
    }
  }

  const names = residents.map((r) => r.name);
  syncJobItems(jobId, names);
  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: names.length, company: companyName, dryRun });

  let moved = 0, dry = 0, failed = 0;
  let page;
  try {
    const listUrl = `https://${companyHost}.alisonline.com/Residents/${communityId}?tab=Current`;
    page = await newPage();
    await ensureLoggedIn(page, listUrl);
    const current = await listCurrentResidents(page, listUrl);
    emit('progress', { message: `Found ${current.length} current residents${dryRun ? ' (DRY RUN — nothing will be submitted)' : ''}.` });

    for (const r of residents) {
      setItemStatus(jobId, r.name, 'running');
      emit('item_start', { name: r.name });
      try {
        const matches = current.filter((c) => c.key === nameKey(r.name));
        if (matches.length === 0) throw new Error('Not on the Current Residents tab (already moved out, or name differs)');
        if (matches.length > 1) throw new Error(`Name matches ${matches.length} current residents (rooms ${matches.map((m) => m.room).join(', ')}) — not guessing`);

        const details = {};
        for (const [k, [key]] of Object.entries(FIELDS)) details[k] = r[key] || payload[key];

        const result = await moveOutResident(page, companyHost, matches[0], details, { dryRun });
        if (result.status === 'moved-out') {
          moved++;
          setItemStatus(jobId, r.name, 'success', null, { outcome: 'moved-out', detail: result.summary });
          emit('item_done', { name: r.name, status: 'moved-out', detail: result.summary });
        } else if (result.status === 'dry-run') {
          dry++;
          setItemStatus(jobId, r.name, 'success', null, { outcome: 'dry-run', detail: result.summary });
          emit('item_done', { name: r.name, status: 'dry-run', detail: result.summary });
        } else {
          throw new Error(result.summary);
        }
      } catch (err) {
        const shot = `error_moveout_${jobId}_${r.name.replace(/[^a-z0-9]/gi, '_')}.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        failed++;
        setItemStatus(jobId, r.name, 'failed', err.message);
        emit('item_fail', { name: r.name, error: err.message });
      }
    }
  } catch (err) {
    setJobStatus(jobId, 'failed', `Could not load Current Residents: ${err.message}`);
    emit('job_error', { error: `Could not load Current Residents: ${err.message}` });
    await page?.context().close().catch(() => {});
    return;
  }

  await page.context().close().catch(() => {});
  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, company: companyName, total: names.length, movedOut: moved, dryRun: dry, failed });
}

function runCareItemAssistanceLevelJob(jobId, payload) {
  return runCareItemFieldJob(jobId, payload, {
    fieldName: 'Assistance Level',
    itemsRequiredMessage: 'At least one Care Item (name + target Assistance Level) is required.',
    targetOf: (item) => item.assistanceLevel,
    apply: (page, item) => setCareItemAssistanceLevel(page, item.name, item.assistanceLevel),
  });
}

/**
 * Run the care-item-reporting-label job — same engine as Assistance Level but
 * sets the "Reporting Label" select (`#ReportingLabelId`). Built for the Oct
 * 2026 Leisure Care ask: relabel the "Two Staff" Care Items to "Two Person
 * Assist". Each item may carry an optional `fromLabel`; when set, the item is
 * only changed if its Reporting Label currently equals it (e.g. "ABST"),
 * otherwise it is left alone and reported as skipped.
 */
function runCareItemReportingLabelJob(jobId, payload) {
  return runCareItemFieldJob(jobId, payload, {
    fieldName: 'Reporting Label',
    itemsRequiredMessage: 'At least one Care Item (name + target Reporting Label) is required.',
    targetOf: (item) => item.reportingLabel,
    apply: (page, item) => setCareItemReportingLabel(page, item.name, item.reportingLabel, item.fromLabel),
  });
}

module.exports = {
  runCreateCommunitiesJob,
  runTemplateJob,
  runSyncGLAccountsJob,
  runSyncResidentSettingsJob,
  runKpiExportJob,
  runResidentMoveOutJob,
  runCareItemAssistanceLevelJob,
  runCareItemReportingLabelJob,
};
