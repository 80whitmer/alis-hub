/**
 * Account Truth model, ported from alis-product-ops (Aaron, Sep 2026:
 * "digging the account truth model -- could we bring it over and
 * integrate it with the team am / account health dashboards"). Shared
 * across both dashboards' UI — an account's ALIS Admin Company ID and its
 * live entitlements are the same HubSpot company/ALIS admin data
 * regardless of which dashboard looks at it, so this is one router (not
 * duplicated per-page like most of this app's other API routes) mounted
 * once at /api/account-truth.
 */
const express = require('express');
const router = express.Router();
const { getLiveEntitlements } = require('../services/alisEntitlements');
const { checkCompanyAlignmentDrift } = require('../services/alisCompanyDiscovery');
const {
  startDiscovery, cancelDiscovery, getStatus: getDiscoveryStatus, STREAM_CHANNEL: DISCOVERY_STREAM_CHANNEL,
} = require('../services/alisAdminDiscoveryJob');
const { checkAgainstLastAudit } = require('../services/crmIdAuditLookup');
const { findExcludedPortfolioAccounts } = require('../services/hubspotAccounts');
const { hubspotRecordUrl } = require('../services/hubspotTickets');
const {
  startPortfolioEntitlementsCheck, cancelPortfolioEntitlementsCheck,
  getStatus: getPortfolioEntitlementsStatus, getPortfolioEntitlementRollup,
} = require('../services/portfolioEntitlementsJob');
const {
  startPortfolioUsageAuditCheck, cancelPortfolioUsageAuditCheck,
  getStatus: getPortfolioUsageAuditStatus,
} = require('../services/portfolioUsageAuditJob');
const { getScoreBand, computeCommunityScores } = require('../services/usageAuditScore');
const { subscribe, unsubscribe } = require('./broadcaster');
const {
  getAlisAdminId, setAlisAdminId, bulkSetAlisAdminIds, deleteAlisAdminId, listAlisAdminIds,
  listCompanyHosts, listPortfolioUsageSnapshots,
  upsertCompanyHost, upsertCompanyAlignment, listCompanyAlignment,
  logCompanyAlignmentActivity, listCompanyAlignmentActivityLog, deleteCompanyAlignmentActivityLogEntry,
} = require('../db/database');

// PUT /api/account-truth/:id/alis-admin-id
router.put('/:id/alis-admin-id', (req, res) => {
  const { alisAdminCompanyId, companyName } = req.body || {};
  if (!alisAdminCompanyId || !String(alisAdminCompanyId).trim()) {
    return res.status(400).json({ error: 'alisAdminCompanyId is required' });
  }
  setAlisAdminId({ hubspotCompanyId: req.params.id, companyName, alisAdminCompanyId: String(alisAdminCompanyId).trim() });
  res.status(204).end();
});

// DELETE /api/account-truth/:id/alis-admin-id
router.delete('/:id/alis-admin-id', (req, res) => {
  deleteAlisAdminId(req.params.id);
  res.status(204).end();
});

// POST /api/account-truth/alis-admin-ids/import — bulk version, for the
// Download/Upload template flow and for committing alisCompanyDiscovery.js's
// reviewed results. Rows with no ID are silently skipped.
router.post('/alis-admin-ids/import', (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected { rows: [{ hubspotCompanyId, companyName, alisAdminCompanyId }] }' });
  }
  const imported = bulkSetAlisAdminIds(rows);
  res.json({ imported });
});

// POST /api/account-truth/alis-admin-ids/discover/run — kicks off the
// discovery scrape as a background job (Sep 2026, Aaron: hit a 502 running
// this as a plain blocking POST — a slow run's CRM ID rescue pass
// outlasted the dev proxy's own connection timeout even though the backend
// was still working. 202 + poll/stream /status instead, same pattern as
// portfolio-entitlements/usage-audit below). A proposal only; nothing is
// saved until the reviewed result is POSTed to /import above.
router.post('/alis-admin-ids/discover/run', (req, res) => {
  const companies = req.body?.companies;
  if (!Array.isArray(companies)) {
    return res.status(400).json({ error: 'Expected { companies: [{ id, name, alisAdminCompanyId }] }' });
  }
  const started = startDiscovery(companies);
  if (!started) {
    return res.status(409).json({ error: 'A Discover & Align run is already in progress.' });
  }
  res.status(202).json({ started: true });
});

// POST /api/account-truth/alis-admin-ids/discover/cancel — stops a running
// discovery after its current company finishes. No-op if nothing's running.
router.post('/alis-admin-ids/discover/cancel', (req, res) => {
  const cancelled = cancelDiscovery();
  if (!cancelled) {
    return res.status(409).json({ error: 'No Discover & Align run is currently in progress.' });
  }
  res.status(202).json({ cancelling: true });
});

// GET /api/account-truth/alis-admin-ids/discover/status — current job
// state, including the final result once done (persists across reloads
// since it's read from job memory, not tied to any one request/response).
router.get('/alis-admin-ids/discover/status', (req, res) => {
  res.json(getDiscoveryStatus());
});

// GET /api/account-truth/alis-admin-ids/discover/stream — live progress log
// of a running discovery, same SSE convention as portfolio-entitlements/
// portfolio-usage-audit's own /stream routes below.
router.get('/alis-admin-ids/discover/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const job = getDiscoveryStatus();
  res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  subscribe(DISCOVERY_STREAM_CHANNEL, res);
  req.on('close', () => unsubscribe(DISCOVERY_STREAM_CHANNEL, res));
});

// POST /api/account-truth/alis-admin-ids/check-last-audit — cross-references
// currently-unmapped accounts against the most recent CRM ID Audit (bulk)
// report already on disk (see crmIdAuditLookup.js's doc comment: zero new
// scraping, so it's fast on any portfolio size, unlike a live Discover run's
// ambiguous-bucket rescue). Synchronous — a local file read, not a job.
router.post('/alis-admin-ids/check-last-audit', async (req, res, next) => {
  try {
    const companies = req.body?.companies;
    if (!Array.isArray(companies)) {
      return res.status(400).json({ error: 'Expected { companies: [{ id, name, alisAdminCompanyId }] }' });
    }
    const result = await checkAgainstLastAudit(companies);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/account-truth/company-alignment — every company_alignment row
// (ALIS-side name, human-confirmed flag, last drift-check result), for the
// combined template's pre-fill and the Company Alignment panel's own status
// display. Cheap local read, no live scrape.
router.get('/company-alignment', (req, res) => {
  res.json({ rows: listCompanyAlignment() });
});

// POST /api/account-truth/company-alignment/import — the combined
// Download/Upload template's write path (Aaron, Sep 2026: "combine these
// templates and update/discovery patterns"), and what Discover's "Import
// Selected" now posts to as well: one row can touch all three tables
// (company_hosts, alis_admin_ids, company_alignment) since a single company
// can carry a subdomain, an admin ID, and an alignment note independently —
// each write is skipped if that row didn't include the relevant field,
// rather than clobbering an existing value with a blank.
router.post('/company-alignment/import', (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected { rows: [{ hubspotCompanyId, companyName, companyHost?, alisAdminCompanyId?, alisCompanyName?, crmIdConfirmed? }] }' });
  }
  // Which of Discover & Align / the template / the new Check Last Audit
  // Report triggered this write (Sep 2026, Aaron: "an audit log... to keep
  // track of actioned updates and imports") — free text, defaults to
  // 'template' since that's this route's original caller.
  const source = req.body?.source || 'template';
  let hostsImported = 0;
  let adminIdsImported = 0;
  let alignmentImported = 0;
  for (const row of rows) {
    const { hubspotCompanyId, companyName, companyHost, alisAdminCompanyId, alisCompanyName, crmIdConfirmed } = row;
    if (!hubspotCompanyId) continue;
    if (companyHost) {
      upsertCompanyHost({ companyName, hubspotCompanyId, companyHost });
      hostsImported++;
    }
    if (alisAdminCompanyId) {
      setAlisAdminId({ hubspotCompanyId, companyName, alisAdminCompanyId });
      adminIdsImported++;
    }
    if (alisCompanyName !== undefined || crmIdConfirmed !== undefined) {
      upsertCompanyAlignment(hubspotCompanyId, { alisCompanyName, crmIdConfirmed });
      alignmentImported++;
    }
  }
  if (hostsImported > 0 || adminIdsImported > 0 || alignmentImported > 0) {
    logCompanyAlignmentActivity(
      source,
      `${rows.length} row(s) imported — ${adminIdsImported} admin ID(s), ${hostsImported} subdomain(s), ${alignmentImported} alignment note(s).`
    );
  }
  res.json({ hostsImported, adminIdsImported, alignmentImported });
});

// GET /api/account-truth/company-alignment/activity-log — the audit log of
// every past import (see logCompanyAlignmentActivity's own call site
// above), newest first.
router.get('/company-alignment/activity-log', (req, res) => {
  res.json({ rows: listCompanyAlignmentActivityLog() });
});

// DELETE /api/account-truth/company-alignment/activity-log/:id — removes
// one log entry (Aaron: "the option to delete the records if they are
// cluttering things up"). Log-only — never touches the actual imported
// data (company_hosts/alis_admin_ids/company_alignment).
router.delete('/company-alignment/activity-log/:id', (req, res) => {
  deleteCompanyAlignmentActivityLogEntry(req.params.id);
  res.status(204).end();
});

// POST /api/account-truth/company-alignment/check-drift — cross-checks
// every account with a known ALIS Admin Company ID against a fresh scrape
// of ALIS admin's own company directory (one login, one page — see
// checkCompanyAlignmentDrift's doc comment for why no new scraping
// capability was needed). Synchronous rather than a tracked job: the
// directory scrape is a single page load, not a per-account loop like the
// portfolio entitlements/usage-audit checks.
router.post('/company-alignment/check-drift', async (req, res, next) => {
  try {
    const result = await checkCompanyAlignmentDrift();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/account-truth/excluded — accounts owned by a known AM that never
// show up in the normal Account Health / Team AM pull, with why (Lead/
// Canceled lifecycle, no lifecycle stage, or the wrong-association-type gap
// — see findExcludedPortfolioAccounts' own doc comment). Live, on-demand
// (no caching) — same reasoning as /alis-admin-ids/discover above.
router.get('/excluded', async (req, res, next) => {
  try {
    const result = await findExcludedPortfolioAccounts();
    res.json({ excluded: result.map((r) => ({ ...r, hubspotUrl: hubspotRecordUrl('company', r.hubspotCompanyId) })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/account-truth/:id/live-entitlements?products=A,B,C — logs into
// ALIS admin and scrapes this account's real Entitlements page, grouped by
// ALIS product category and cross-checked against `products` (the
// company's HubSpot alis_products, sent by the client). 400s if no
// alis_admin_ids row exists yet.
router.get('/:id/live-entitlements', async (req, res, next) => {
  try {
    const alisAdminCompanyId = getAlisAdminId(req.params.id);
    if (!alisAdminCompanyId) {
      return res.status(400).json({ error: 'No ALIS Admin Company ID set for this account yet — enter one first.' });
    }
    const hubspotProducts = typeof req.query.products === 'string'
      ? req.query.products.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const result = await getLiveEntitlements(alisAdminCompanyId, hubspotProducts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/account-truth/portfolio-entitlements/run — kicks off a
// portfolio-wide live entitlements scrape, one account at a time, over
// every account with an ALIS Admin Company ID on file. Deliberately
// manual/separate from either dashboard's own Refresh — a real ALIS admin
// login+scrape per account is slow, and this hits production only when
// asked. `companies` (name lookup) comes from the client's already-loaded
// portfolio. 202 + poll /status rather than blocking the request.
router.post('/portfolio-entitlements/run', (req, res) => {
  const companies = req.body?.companies;
  if (!Array.isArray(companies)) {
    return res.status(400).json({ error: 'Expected { companies: [{ id, name }] }' });
  }
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const accounts = listAlisAdminIds().map((r) => ({
    hubspotCompanyId: r.hubspot_company_id,
    companyName: nameById.get(r.hubspot_company_id) || null,
    alisAdminCompanyId: r.alis_admin_company_id,
  }));
  if (accounts.length === 0) {
    return res.status(400).json({ error: 'No accounts have an ALIS Admin Company ID on file yet.' });
  }
  const started = startPortfolioEntitlementsCheck(accounts);
  if (!started) {
    return res.status(409).json({ error: 'A portfolio entitlement check is already running.' });
  }
  res.status(202).json({ started: true, total: accounts.length });
});

// POST /api/account-truth/portfolio-entitlements/cancel — stops a running
// check after its current account finishes (see portfolioEntitlementsJob.js's
// cancelPortfolioEntitlementsCheck doc comment). No-op if nothing's running.
router.post('/portfolio-entitlements/cancel', (req, res) => {
  const cancelled = cancelPortfolioEntitlementsCheck();
  if (!cancelled) {
    return res.status(409).json({ error: 'No portfolio entitlement check is currently running.' });
  }
  res.status(202).json({ cancelling: true });
});

// GET /api/account-truth/portfolio-entitlements/status — job progress plus
// the current %-enabled-per-flag rollup, computed from whatever's been
// captured so far (visible mid-run, and persists across reloads since it's
// read from the DB, not job memory).
router.get('/portfolio-entitlements/status', (req, res) => {
  res.json({ job: getPortfolioEntitlementsStatus(), rollup: getPortfolioEntitlementRollup() });
});

// GET /api/account-truth/portfolio-entitlements/stream — live log of a
// running check (Sep 2026, Aaron: ported the idea from the ALIS Photo
// Migrator side project's own live-scrolling-log UX). Uses the same
// broadcaster.js SSE plumbing as this app's other long jobs, but a fixed
// channel name instead of a per-run jobId (portfolioEntitlementsJob.js
// only ever has one run active at a time — see its own doc comment).
// Sends the current point-in-time job snapshot immediately on connect so a
// client opening mid-run (or reloading) hydrates its progress bar/counts
// right away, same convention as stream.js's generic job-stream route;
// past individual log lines aren't replayable, only what's broadcast from
// this point forward.
router.get('/portfolio-entitlements/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const job = getPortfolioEntitlementsStatus();
  res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  subscribe('portfolio-entitlements', res);
  req.on('close', () => unsubscribe('portfolio-entitlements', res));
});

// POST /api/account-truth/portfolio-usage-audit/run — kicks off a
// portfolio-wide usage audit, one account at a time, over every account
// with a known ALIS Company Host on file (server/db/database.js's
// company_hosts table, auto-learned from prior single-company usage-audit
// runs — no client-supplied account list needed, unlike
// /portfolio-entitlements/run). Deliberately manual, same reasoning as that
// route. 202 + poll /status rather than blocking the request.
router.post('/portfolio-usage-audit/run', (req, res) => {
  const adminIdByCompany = new Map(listAlisAdminIds().map((r) => [r.hubspot_company_id, r.alis_admin_company_id]));
  const accounts = listCompanyHosts()
    .filter((r) => r.hubspot_company_id && r.company_host)
    .map((r) => ({
      hubspotCompanyId: r.hubspot_company_id,
      companyName: r.company_name,
      companyHost: r.company_host,
      alisAdminCompanyIds: adminIdByCompany.get(r.hubspot_company_id) || '',
    }));
  if (accounts.length === 0) {
    return res.status(400).json({ error: 'No accounts have a known ALIS Company Host on file yet.' });
  }
  const started = startPortfolioUsageAuditCheck(accounts);
  if (!started) {
    return res.status(409).json({ error: 'A portfolio usage audit is already running.' });
  }
  res.status(202).json({ started: true, total: accounts.length });
});

// POST /api/account-truth/portfolio-usage-audit/cancel
router.post('/portfolio-usage-audit/cancel', (req, res) => {
  const cancelled = cancelPortfolioUsageAuditCheck();
  if (!cancelled) {
    return res.status(409).json({ error: 'No portfolio usage audit is currently running.' });
  }
  res.status(202).json({ cancelling: true });
});

// GET /api/account-truth/portfolio-usage-audit/status — job progress plus
// the current per-company roll-up (combined score, enabled/used %,
// per-community breakdown), computed from whatever's been captured so far.
router.get('/portfolio-usage-audit/status', (req, res) => {
  const rows = listPortfolioUsageSnapshots();
  const companies = rows.map((r) => ({
    hubspotCompanyId: r.hubspot_company_id,
    companyName: r.company_name,
    companyHost: r.company_host,
    enabledPct: r.enabled_pct,
    usedPct: r.used_pct,
    combinedScore: r.combined_score,
    band: getScoreBand(r.combined_score),
    capturedAt: r.captured_at,
    communities: computeCommunityScores(r.summary),
  }));
  res.json({ job: getPortfolioUsageAuditStatus(), rollup: { companies } });
});

// GET /api/account-truth/portfolio-usage-audit/stream — live log of a
// running check, same SSE convention as /portfolio-entitlements/stream.
router.get('/portfolio-usage-audit/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const job = getPortfolioUsageAuditStatus();
  res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  subscribe('portfolio-usage-audit', res);
  req.on('close', () => unsubscribe('portfolio-usage-audit', res));
});

module.exports = router;
