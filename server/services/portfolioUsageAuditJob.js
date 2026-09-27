/**
 * Manual, on-demand "Run portfolio usage audit" job — same reasoning and
 * shape as portfolioEntitlementsJob.js (a real ALIS admin login+scrape per
 * account is slow and shouldn't ride along on every regular Refresh), but
 * for the Company/Community Usage Audit tool instead of raw entitlement
 * flags: rolls up each account's Enabled/Used grid (usageAuditNormalizer.js)
 * into one combined adoption score (usageAuditScore.js) so accounts can be
 * compared side by side — the portfolio-wide version of Aaron's old
 * manually-maintained red/yellow/green client spreadsheets.
 *
 * Each account run reuses the existing single-company job runner
 * (usageAudit.js's runCompanyUsageAuditJob) verbatim via a synthetic,
 * throwaway `jobs` row — no changes to that file needed. The per-job
 * usage_audit_snapshots row it writes is read back immediately after and
 * folded into portfolio_usage_snapshots (one row per company, replaced each
 * run); the throwaway job row itself is left in place (same low-cost
 * "doesn't need cleanup" reasoning as this app's other one-off job rows).
 */
const { randomUUID } = require('crypto');
const { runCompanyUsageAuditJob } = require('../automation/usageAudit');
const { computeUsageAuditScore } = require('./usageAuditScore');
const {
  createJob, getJob, getUsageAuditSnapshot, replacePortfolioUsageSnapshot,
  countPortfolioUsageSnapshotCompanies,
} = require('../db/database');
const { broadcast } = require('../api/broadcaster');

// Fixed channel id, not a per-run jobId — same one-run-at-a-time reasoning
// as portfolioEntitlementsJob.js's STREAM_CHANNEL.
const STREAM_CHANNEL = 'portfolio-usage-audit';

let state = { status: 'idle', total: 0, processed: 0, currentCompany: null, startedAt: null, finishedAt: null, errors: [] };
let cancelRequested = false;

function getStatus() {
  return { ...state, snapshotCompanyCount: countPortfolioUsageSnapshotCompanies() };
}

function cancelPortfolioUsageAuditCheck() {
  if (state.status !== 'running') return false;
  cancelRequested = true;
  broadcast(STREAM_CHANNEL, 'log', { msg: 'Cancelling — finishing the current account, then stopping…' });
  return true;
}

/** Runs one account's usage audit through the existing single-company job runner and folds the result into the portfolio snapshot table. */
async function checkOneAccount(account) {
  const jobId = `portfolio-usage-audit-${account.hubspotCompanyId}-${randomUUID()}`;
  createJob({
    id: jobId,
    type: 'company-usage-audit',
    label: `Portfolio usage audit — ${account.companyName || account.companyHost}`,
    total: 1,
    payload: {
      companyName: account.companyName,
      companyHost: account.companyHost,
      alisAdminCompanyIds: account.alisAdminCompanyIds || '',
      hubspotCompanyId: account.hubspotCompanyId,
      lookbackDays: 90,
    },
  });

  await runCompanyUsageAuditJob(jobId, {
    companyName: account.companyName,
    companyHost: account.companyHost,
    alisAdminCompanyIds: account.alisAdminCompanyIds || '',
    hubspotCompanyId: account.hubspotCompanyId,
    lookbackDays: 90,
  });

  const job = getJob(jobId);
  if (job?.status !== 'done') {
    throw new Error(job?.error || 'Usage audit job did not complete successfully.');
  }

  const snapshot = getUsageAuditSnapshot(jobId);
  if (!snapshot) throw new Error('Usage audit job completed but wrote no snapshot.');

  const { enabledPct, usedPct, combinedScore } = computeUsageAuditScore(snapshot.summary);
  replacePortfolioUsageSnapshot(account.hubspotCompanyId, {
    companyName: account.companyName,
    companyHost: account.companyHost,
    enabledPct, usedPct, combinedScore,
    summary: snapshot.summary,
  });
}

function startPortfolioUsageAuditCheck(accounts) {
  if (state.status === 'running') return false;
  cancelRequested = false;
  state = { status: 'running', total: accounts.length, processed: 0, currentCompany: null, startedAt: new Date().toISOString(), finishedAt: null, errors: [] };
  broadcast(STREAM_CHANNEL, 'log', { msg: `Starting portfolio usage audit — ${accounts.length} account(s)...` });

  (async () => {
    for (let i = 0; i < accounts.length; i++) {
      if (cancelRequested) break;
      const account = accounts[i];
      state.currentCompany = account.companyName || account.companyHost;
      try {
        await checkOneAccount(account);
        state.processed = i + 1;
        broadcast(STREAM_CHANNEL, 'log', { msg: `[${i + 1}/${accounts.length}] ${state.currentCompany}` });
      } catch (err) {
        state.processed = i + 1;
        state.errors.push({ companyName: state.currentCompany, error: err.message });
        broadcast(STREAM_CHANNEL, 'log', { msg: `[${i + 1}/${accounts.length}] ${state.currentCompany} — ERROR: ${err.message}`, level: 'error' });
      }
    }
  })()
    .then(() => {
      const wasCancelled = cancelRequested;
      state.status = wasCancelled ? 'cancelled' : 'done';
      state.finishedAt = new Date().toISOString();
      cancelRequested = false;
      broadcast(STREAM_CHANNEL, 'log', {
        msg: wasCancelled
          ? `Cancelled. ${state.processed} of ${state.total} account(s) checked before stopping, ${state.errors.length} error(s).`
          : `Done. ${state.processed} of ${state.total} account(s) checked, ${state.errors.length} error(s).`,
      });
      broadcast(STREAM_CHANNEL, 'complete', getStatus());
    })
    .catch((err) => {
      state.status = 'error';
      state.finishedAt = new Date().toISOString();
      cancelRequested = false;
      state.errors.push({ companyName: null, error: err.message });
      broadcast(STREAM_CHANNEL, 'log', { msg: `FATAL ERROR: ${err.message}`, level: 'error' });
      broadcast(STREAM_CHANNEL, 'complete', getStatus());
    });

  return true;
}

module.exports = { startPortfolioUsageAuditCheck, cancelPortfolioUsageAuditCheck, getStatus };
