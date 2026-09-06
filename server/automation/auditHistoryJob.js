const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { captureAuditHistory } = require('./playwright/auditHistoryPage');
const { getDestination } = require('../services/auditHistoryDestinations');
const { setJobStatus, setItemStatus, syncJobItems, addAuditHistorySnapshot } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * "MM/DD/YYYY h:mm:ss AM/PM TZ" (e.g. "09/03/2026 9:37:33 PM CST") — ALIS's
 * own Audit History timestamp format, confirmed live. Returns a Date (for
 * sorting) or null if unparseable — never throws, since a malformed
 * timestamp shouldn't take down the whole aggregation.
 */
function parseAuditTimestamp(str) {
  if (!str) return null;
  // Strip the trailing timezone abbreviation (CST/CDT/etc.) — not something
  // JS's Date parser understands, and every row in one job run is already
  // the same account's local timezone, so dropping it doesn't lose
  // information relevant to sorting/grouping within this report.
  const cleaned = str.replace(/\s+[A-Z]{2,4}$/, '');
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

function targetLabel(target) {
  const dest = getDestination(target.type);
  if (target.type === 'company') return dest.label;
  return `${dest.label}: ${target.name || target.communityId || target.residentId}`;
}

/**
 * Run the audit-history job: log in once to the account's ALIS subdomain,
 * then pull the Audit History widget from every requested target (company
 * page, community profile(s), resident profile(s)) with the same shared
 * filter set, and combine them into one timestamp-sorted feed plus a
 * per-target breakdown.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runAuditHistoryJob(jobId, payload) {
  const { companyName, companyHost, includeCompany, communities = [], residents = [], startDate, endDate, staffId, category, notes } = payload;
  const filters = { startDate, endDate, staffId, category, notes };
  const targets = [
    ...(includeCompany ? [{ type: 'company' }] : []),
    ...communities.map((c) => ({ type: 'community', communityId: c.communityId, name: c.name })),
    ...residents.map((r) => ({ type: 'resident', residentId: r.residentId, name: r.name })),
  ];
  const emit = (event, data) => broadcast(jobId, event, data);
  const dataWarnings = [];

  setJobStatus(jobId, 'running');

  if (!companyHost) {
    const error = 'ALIS Company Host is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }
  if (targets.length === 0) {
    const error = 'At least one target (Company, a Community, or a Resident) is required.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  const itemNames = targets.map(targetLabel);
  syncJobItems(jobId, itemNames);
  emit('job_start', { jobId, total: targets.length, company: companyName });

  const perTarget = [];
  let page;
  try {
    page = await newPage();
    emit('progress', { message: `Logging in to ${companyHost}.alisonline.com…` });
    // One retry — confirmed live that a transient ERR_NETWORK_CHANGED /
    // interrupted-navigation error on first login to a host is usually
    // headless-Chromium flakiness (see usageAudit.js's Daily Stand-Up
    // login for the same pattern).
    let loginErr;
    let loggedIn = false;
    for (let attempt = 1; attempt <= 2 && !loggedIn; attempt++) {
      try {
        await ensureLoggedIn(page, `https://${companyHost}.alisonline.com/`);
        loggedIn = true;
      } catch (err) {
        loginErr = err;
      }
    }
    if (!loggedIn) throw new Error(`Could not log in to ${companyHost}.alisonline.com (tried twice): ${loginErr.message}`);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const name = itemNames[i];
      setItemStatus(jobId, name, 'running');
      emit('item_start', { name });

      try {
        const dest = getDestination(target.type);
        const url = dest.urlFor(companyHost, target.communityId || target.residentId);
        const capture = await captureAuditHistory(page, url, { filters, maxPages: 50 });
        perTarget.push({
          targetType: target.type,
          targetLabel: name,
          communityId: target.communityId ?? null,
          residentId: target.residentId ?? null,
          ...capture,
        });
        if (capture.truncated) {
          dataWarnings.push(`${name}: hit the 50-page safety cap (500 rows) — narrow the date range for a complete pull.`);
        }
        setItemStatus(jobId, name, 'success');
        emit('item_done', { name });
      } catch (err) {
        console.error(`[audit-history:${jobId}] Capture failed for "${name}":`, err);
        perTarget.push({ targetType: target.type, targetLabel: name, communityId: target.communityId ?? null, residentId: target.residentId ?? null, error: err.message, rows: [], rowCount: 0 });
        setItemStatus(jobId, name, 'failed', err.message);
        emit('item_fail', { name, error: err.message });
      }
    }
  } catch (err) {
    console.error(`[audit-history:${jobId}] Fatal error:`, err);
    setJobStatus(jobId, 'failed', err.message);
    emit('job_error', { error: err.message });
    return;
  } finally {
    if (page) await page.context().close().catch(() => {});
  }

  // Combined, timestamp-sorted feed across every target — tagged with
  // which target each row came from, since "triangulate ALIS activity" (the
  // whole point of pulling multiple destinations at once) depends on being
  // able to see everything interleaved by time, not just per-destination.
  const combined = perTarget
    .flatMap((t) => t.rows.map((r) => ({ ...r, targetType: t.targetType, targetLabel: t.targetLabel })))
    .sort((a, b) => (parseAuditTimestamp(b.updatedAt)?.getTime() ?? 0) - (parseAuditTimestamp(a.updatedAt)?.getTime() ?? 0));

  // `targets` keeps each destination's own rows (for a per-destination
  // dashboard view); `combined` is the same rows merged + timestamp-sorted
  // across every destination (for the "triangulate" cross-reference view).
  const summary = {
    companyName,
    companyHost,
    filters,
    targets: perTarget,
    combined,
    totalRows: combined.length,
    generatedAt: new Date().toISOString(),
    dataWarnings,
  };

  addAuditHistorySnapshot(jobId, { companyHost, companyName, summary });

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runAuditHistoryJob };
