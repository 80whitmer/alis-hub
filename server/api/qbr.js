const express = require('express');
const router = express.Router();

const { getKpiSnapshot, updateKpiSnapshotSummary, getDsoHistory, getPpdHistory, getJob } = require('../db/database');
const { getLatestBenchmarks, getBenchmarksForQuarter, listAvailableQuarters } = require('../services/alis500Benchmarks');
const { buildQbrDeck } = require('../services/qbrExport');
const { generateFlags } = require('../services/qbrFlags');
const { enrichRepeatIssueFlags, enrichDealUrls, enrichOpenTickets, getTicketSummaryForCompany, getDealSummaryForCompany } = require('../services/hubspotTickets');

// GET /api/qbr/benchmarks?quarter=2026-Q2 — current (or specified) ALIS 500 benchmark dataset
router.get('/benchmarks', (req, res) => {
  try {
    const { quarter } = req.query;
    const data = quarter ? getBenchmarksForQuarter(quarter) : getLatestBenchmarks();
    res.json({ ...data, availableQuarters: listAvailableQuarters() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbr/:jobId — normalized KPI snapshot + benchmark diffs + tickets + flags for a completed kpi-export job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbr/:jobId/dso-history?scope=company|region|community&scopeKey=...
// — DSO trend for one scope across every past kpi-export job for this
// job's company, oldest first. scope='company' ignores scopeKey (always
// 'portfolio'). First-ever pull for a company legitimately returns a
// single-row (or empty, if this job predates DSO) array — that's expected,
// not an error; a real trend appears once a second job has run.
router.get('/:jobId/dso-history', (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });

    const scope = req.query.scope || 'company';
    if (!['company', 'region', 'community'].includes(scope)) {
      return res.status(400).json({ error: `Invalid scope "${scope}" — expected "company", "region", or "community".` });
    }
    const scopeKey = scope === 'company' ? 'portfolio' : req.query.scopeKey;
    if (!scopeKey) return res.status(400).json({ error: 'scopeKey is required for region/community scope.' });

    const history = getDsoHistory({ companyName: snapshot.company_name, scope, scopeKey, limit: Number(req.query.limit) || 12 });
    res.json({ scope, scopeKey, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbr/:jobId/ppd-history?scope=company|region|community&scopeKey=...
// — PPD trend for one scope, same shape/rules as /dso-history above.
router.get('/:jobId/ppd-history', (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });

    const scope = req.query.scope || 'company';
    if (!['company', 'region', 'community'].includes(scope)) {
      return res.status(400).json({ error: `Invalid scope "${scope}" — expected "company", "region", or "community".` });
    }
    const scopeKey = scope === 'company' ? 'portfolio' : req.query.scopeKey;
    if (!scopeKey) return res.status(400).json({ error: 'scopeKey is required for region/community scope.' });

    const history = getPpdHistory({ companyName: snapshot.company_name, scope, scopeKey, limit: Number(req.query.limit) || 12 });
    res.json({ scope, scopeKey, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbr/:jobId/refresh-hubspot — re-pulls live ticket + deal data
// for the company this job was linked to and overwrites ticketSummary/
// dealSummary in place, so closing/updating something in HubSpot during
// meeting prep is reflected here (and in the next PPTX export) without
// re-running the whole kpi-export job. hubspotCompanyId isn't stored on
// snapshots taken before this route existed, so it falls back to the
// job's original payload.
router.post('/:jobId/refresh-hubspot', async (req, res) => {
  try {
    const existing = getKpiSnapshot(req.params.jobId);
    if (!existing) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });

    const hubspotCompanyId = existing.summary.hubspotCompanyId || getJob(req.params.jobId)?.payload?.hubspotCompanyId;
    if (!hubspotCompanyId) {
      return res.status(400).json({ error: 'No HubSpot company was linked for this pull — nothing to refresh.' });
    }

    const [ticketSummary, dealSummary] = await Promise.all([
      getTicketSummaryForCompany(hubspotCompanyId),
      getDealSummaryForCompany(hubspotCompanyId),
    ]);

    const summary = { ...existing.summary, ticketSummary, dealSummary, hubspotCompanyId };
    // Ticket/deal counts feed several flags (aging tickets, open deal
    // value, etc.) — regenerate so a ticket closed just now during meeting
    // prep also clears any flag that referenced it, same as health-import
    // already does after merging in new data.
    summary.flags = generateFlags(summary.normalized, summary.diffs, summary.ticketSummary, summary.dealSummary, summary.hubspotHealth);
    updateKpiSnapshotSummary(req.params.jobId, summary);

    res.json({ summary });
  } catch (err) {
    console.error('[qbr POST /:jobId/refresh-hubspot] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbr/:jobId/health-import — attach an account-health-export
// skill JSON (HubSpot Service/Financial health) to an already-completed
// kpi-export job's snapshot. See server/services/HUBSPOT_BRIDGE_SCHEMA.md
// for the expected shape (produced by the "account-health-export" skill).
router.post('/:jobId/health-import', async (req, res) => {
  try {
    const healthExport = req.body;

    if (!healthExport || typeof healthExport !== 'object' || (!healthExport.service_health && !healthExport.financial_health)) {
      return res.status(400).json({ error: 'Body does not look like an account-health-export JSON — expected top-level service_health and/or financial_health keys.' });
    }

    const existing = getKpiSnapshot(req.params.jobId);
    if (!existing) return res.status(404).json({ error: 'No KPI snapshot found for this job yet — run the kpi-export job first, then import the health export.' });

    // Resolve repeat_issue_flags' bare ticket IDs to real subjects/links via
    // a live HubSpot lookup — the skill's export only carries numeric IDs.
    if (healthExport.service_health) {
      healthExport.service_health = await enrichRepeatIssueFlags(healthExport.service_health);
      healthExport.service_health = enrichOpenTickets(healthExport.service_health);
    }
    // Same direct-link treatment for the Open/Closed Deals lists — no API
    // call needed, just the deal ID + HUBSPOT_PORTAL_ID.
    if (healthExport.financial_health) {
      healthExport.financial_health = enrichDealUrls(healthExport.financial_health);
    }

    // Soft check, not a hard block — display names commonly drift between
    // systems ("Hearth & Truss" vs "Hearth and Truss" bit us once already
    // this project), and blocking on it would make the import less useful
    // than just flagging it for a human to glance at.
    let warning = null;
    const importedName = (healthExport.account?.name || '').trim().toLowerCase();
    const snapshotName = (existing.company_name || '').trim().toLowerCase();
    if (importedName && snapshotName && importedName !== snapshotName) {
      warning = `Company name mismatch: this health export is for "${healthExport.account.name}", but this QBR snapshot is for "${existing.company_name}" — double-check you imported the right file.`;
    }

    // Regenerate flags with this import included, not just merge the raw
    // data in — otherwise service/financial/relationship signals from the
    // import (aged tickets, escalations, revenue leakage, etc.) would never
    // surface in Discussion Points, since that job-run-time flag pass had
    // no idea this import was coming.
    const summary = { ...existing.summary, hubspotHealth: healthExport };
    summary.flags = generateFlags(summary.normalized, summary.diffs, summary.ticketSummary, summary.dealSummary, healthExport);
    updateKpiSnapshotSummary(req.params.jobId, summary);

    res.json({ summary, warning });
  } catch (err) {
    console.error('[qbr POST /:jobId/health-import] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbr/:jobId/release-import — attach a release-recommendations
// JSON (curated by the release-recommendations Claude Project — see
// server/services/RELEASE_RECOMMENDATIONS_SCHEMA.md) to an already-completed
// kpi-export job's snapshot, populating the "Recent ALIS Platform Releases"
// slide in the exported deck.
router.post('/:jobId/release-import', (req, res) => {
  try {
    const releaseRecommendations = req.body;

    if (!releaseRecommendations || typeof releaseRecommendations !== 'object' || !Array.isArray(releaseRecommendations.releases)) {
      return res.status(400).json({ error: 'Body does not look like a release-recommendations JSON — expected a top-level "releases" array.' });
    }

    const existing = getKpiSnapshot(req.params.jobId);
    if (!existing) return res.status(404).json({ error: 'No KPI snapshot found for this job yet — run the kpi-export job first, then import the release recommendations.' });

    // Soft check, same rationale as health-import's — display names commonly
    // drift between systems, so flag rather than block.
    let warning = null;
    const importedName = (releaseRecommendations.account?.name || '').trim().toLowerCase();
    const snapshotName = (existing.company_name || '').trim().toLowerCase();
    if (importedName && snapshotName && importedName !== snapshotName) {
      warning = `Company name mismatch: this release-recommendations export is for "${releaseRecommendations.account.name}", but this QBR snapshot is for "${existing.company_name}" — double-check you imported the right file.`;
    }

    const summary = { ...existing.summary, releaseRecommendations };
    updateKpiSnapshotSummary(req.params.jobId, summary);

    res.json({ summary, warning });
  } catch (err) {
    console.error('[qbr POST /:jobId/release-import] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbr/:jobId/export-pptx?includeBilling=false&includeHubspot=false&truncateEmptySlides=true
// — generate and download the QBR deck. includeBilling defaults to true;
// pass exactly "false" to exclude ALIS-native billing content. includeHubspot
// defaults to true; pass exactly "false" to exclude every HubSpot-sourced
// slide (Support Review, HubSpot Deals, Account Health, Project Status,
// Enhancement Requests, Deal-Related Activity). truncateEmptySlides defaults
// to false (the full deck, with manual-fill placeholders, meant to be
// printed and customized); pass exactly "true" for a lighter deck with
// every no-data slide (and its agenda line) dropped — see buildQbrDeck.
router.post('/:jobId/export-pptx', async (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });

    const includeBilling = req.query.includeBilling !== 'false';
    const includeHubspot = req.query.includeHubspot !== 'false';
    const truncateEmptySlides = req.query.truncateEmptySlides === 'true';
    const buffer = await buildQbrDeck(snapshot.summary, { includeBilling, includeHubspot, truncateEmptySlides });
    const filename = `${snapshot.company_name || 'QBR'}-${snapshot.period_start}-${snapshot.period_end}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[qbr POST /:jobId/export-pptx] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
