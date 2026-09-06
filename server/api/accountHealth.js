const express = require('express');
const router = express.Router();

const { getOwnerId, getOwnedCompanies } = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal } = require('../services/hubspotTickets');
const { computeHealthScore } = require('../services/accountHealthScoring');
const {
  upsertAccountHealthSnapshot, listAccountHealthSnapshots, findRecentKpiSnapshotsByHubspotCompanyId,
} = require('../db/database');

/**
 * Maps getTicketSummaryForCompany's output onto the serviceHealth shape
 * accountHealthScoring.js knows how to score (see HUBSPOT_BRIDGE_SCHEMA.md
 * for the aspirational full shape) — only the subset live HubSpot ticket
 * data can actually supply. escalationCount/repeatIssues/slaAdherencePct
 * stay null (Jira- and judgment-based, not available from this API), which
 * scoreServiceHealth already treats as "no penalty," not a fabricated risk.
 */
function mapLiveServiceHealth(ticketSummary) {
  const openTickets = ticketSummary.tickets.filter((t) => t.isOpen);
  const avgTicketAgeDays = openTickets.length > 0
    ? openTickets.reduce((sum, t) => sum + (t.daysOpen || 0), 0) / openTickets.length
    : null;

  const stageCounts = {};
  for (const t of openTickets) {
    const stage = t.pipelineStageLabel || 'Unknown';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
  }

  return {
    openTicketsByStage: Object.entries(stageCounts).map(([stage, count]) => ({ stage, count })),
    avgTicketAgeDays,
    agedTickets: openTickets
      .filter((t) => (t.daysOpen || 0) > 45)
      .map((t) => ({ ticketId: t.id, subject: t.subject, ageDays: t.daysOpen, stage: t.pipelineStageLabel, url: t.url })),
    escalationCount: null,
    ticketCategoryMix: ticketSummary.byCategory,
    repeatIssues: null,
    slaAdherencePct: null,
    // Extras for the drill-down UI, outside the scored shape:
    totalTickets: ticketSummary.total,
    openTicketCount: ticketSummary.open,
    closedTicketCount: ticketSummary.closed,
  };
}

/**
 * Maps getDealSummaryForCompany's output onto the financialHealth shape —
 * renewal/rateDispute/unbilledAddendumBacklog/splitPayAddendumCompletion
 * stay null (billing-system/manual-bridge-only data, no such property
 * exists on a HubSpot deal in this portal); accountHealthScoring.js's
 * "bridgeOnlyFieldsAbsent" branch is what activates a lighter-touch signal
 * from expansionPipeline alone in that case.
 *
 * expansionPipeline.deals covers open + recently-closed (last 90 days —
 * whatever getDealSummaryForCompany already scoped closedDeals to), each
 * tagged `isOpen`, with per-deal open tasks fetched — bounded to this same
 * open+recent-closed set (confirmed live: ~19 open deals portfolio-wide
 * today), not the company's full deal history, which is what keeps this
 * affordable at 371 accounts. `dealsByType` still aggregates over EVERY
 * deal ever (dealSummary.deals) since that's just counting already-fetched
 * properties, no extra calls.
 */
async function mapLiveFinancialHealth(dealSummary) {
  const dealsForView = [
    ...dealSummary.openDeals.map((d) => ({ ...d, isOpen: true })),
    ...dealSummary.closedDeals.map((d) => ({ ...d, isOpen: false })),
  ];
  const dealsWithTasks = await Promise.all(dealsForView.map(async (d) => ({
    ...d,
    tasks: await getOpenTasksForDeal(d.id),
  })));

  return {
    unbilledAddendumBacklog: null,
    renewal: null,
    rateDispute: null,
    splitPayAddendumCompletion: null,
    expansionPipeline: {
      openDealsCount: dealSummary.open,
      totalPipelineValueCents: Math.round((dealSummary.totalOpenValue || 0) * 100),
      deals: dealsWithTasks.map((d) => ({
        name: d.name, stage: d.stage, pipeline: d.pipeline, dealType: d.dealType,
        valueCents: Math.round((d.amount || 0) * 100), expectedCloseDate: d.closeDate,
        isOpen: d.isOpen, nextStep: d.nextStep, nextActivityDate: d.nextActivityDate,
        tasks: d.tasks, url: d.url,
      })),
    },
    // Extras for the drill-down UI, outside the scored shape:
    totalDeals: dealSummary.total,
    dealsByType: dealSummary.deals.reduce((acc, d) => {
      const key = d.dealType || 'unspecified';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

/** Runs `fn` over `items` with at most `limit` in flight at once — HubSpot's private-app rate limit is generous, but there's no reason to fire 50+ companies' worth of requests all at once either. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// POST /api/account-health/refresh — re-pulls live ticket + deal health for
// every HubSpot company Aaron owns, scores each, and caches the result.
// Not routed through the Playwright job-queue system (jobs.js) — this is
// HubSpot API-only, no browser automation, and fast enough for a plain
// synchronous request (a few hundred HubSpot calls for a full portfolio,
// typically well under a minute).
router.post('/refresh', async (req, res) => {
  try {
    const ownerId = await getOwnerId();
    const companies = await getOwnedCompanies(ownerId);
    const priorQbrByCompanyId = findRecentKpiSnapshotsByHubspotCompanyId();

    // Confirmed live (Sep 2026): a full 371-company portfolio at
    // concurrency 8 hit HubSpot's ten_secondly_rolling rate limit hard —
    // 311 of 371 companies failed outright before hubspotRequest's 429
    // retry-with-backoff existed. That retry logic is a safety net now,
    // but a lower concurrency here is what actually keeps this refresh
    // from spending most of its time retrying in the first place.
    const errors = [];
    await mapWithConcurrency(companies, 3, async (company) => {
      try {
        const [ticketSummary, dealSummary] = await Promise.all([
          getTicketSummaryForCompany(company.id),
          getDealSummaryForCompany(company.id),
        ]);
        const serviceHealth = mapLiveServiceHealth(ticketSummary);
        const financialHealth = await mapLiveFinancialHealth(dealSummary);
        const { score, band } = computeHealthScore({ serviceHealth, financialHealth });

        upsertAccountHealthSnapshot({
          hubspotCompanyId: company.id,
          companyName: company.name,
          lifecycleStage: company.lifecycleStage,
          serviceHealth,
          financialHealth,
          openTicketCount: ticketSummary.open,
          closedTicketCount: ticketSummary.closed,
          openDealCount: dealSummary.open,
          openDealValueCents: Math.round((dealSummary.totalOpenValue || 0) * 100),
          arrCents: company.arrCents,
          healthScore: score,
          healthBand: band?.label || null,
        });
      } catch (err) {
        errors.push({ company: company.name, error: err.message });
      }
    });

    res.json({
      refreshedAt: new Date().toISOString(),
      companyCount: companies.length,
      errorCount: errors.length,
      errors,
      priorQbrCount: priorQbrByCompanyId.size,
    });
  } catch (err) {
    console.error('[accountHealth] Refresh failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health — the cached portfolio, instant read, plus a
// best-effort "prior QBR" pointer per company (see
// findRecentKpiSnapshotsByHubspotCompanyId's doc comment for why this
// isn't folded into the health score itself).
router.get('/', (req, res) => {
  try {
    const accounts = listAccountHealthSnapshots();
    const priorQbrByCompanyId = findRecentKpiSnapshotsByHubspotCompanyId();
    // subScores aren't persisted as their own column — recomputed here from
    // the stored serviceHealth/financialHealth, a pure in-memory calculation
    // (no HubSpot calls), so the drill-down always reflects the current
    // scoring logic rather than whatever version last ran a refresh.
    const enriched = accounts.map((a) => ({
      ...a,
      subScores: computeHealthScore({ serviceHealth: a.serviceHealth, financialHealth: a.financialHealth }).subScores,
      priorQbr: priorQbrByCompanyId.get(a.hubspot_company_id) || null,
    }));
    res.json({ accounts: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
