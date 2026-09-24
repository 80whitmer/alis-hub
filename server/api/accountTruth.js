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
const { discoverAlisAdminIds } = require('../services/alisCompanyDiscovery');
const { startPortfolioEntitlementsCheck, getStatus: getPortfolioEntitlementsStatus, getPortfolioEntitlementRollup } = require('../services/portfolioEntitlementsJob');
const { subscribe, unsubscribe } = require('./broadcaster');
const {
  getAlisAdminId, setAlisAdminId, bulkSetAlisAdminIds, deleteAlisAdminId, listAlisAdminIds,
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

// POST /api/account-truth/alis-admin-ids/discover — scrapes ALIS admin's
// own company directory and proposes matches against `companies` (sent by
// the client — it already has the portfolio loaded). A proposal only;
// nothing is saved until the reviewed result is POSTed to /import above.
router.post('/alis-admin-ids/discover', async (req, res, next) => {
  try {
    const companies = req.body?.companies;
    if (!Array.isArray(companies)) {
      return res.status(400).json({ error: 'Expected { companies: [{ id, name, alisAdminCompanyId }] }' });
    }
    const result = await discoverAlisAdminIds(companies);
    res.json(result);
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

module.exports = router;
