const express = require('express');
const router = express.Router();

const { getOwnerId, getOwnedCompanies } = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal, hubspotRecordUrl } = require('../services/hubspotTickets');
const { computeHealthScore, computeDsoDays } = require('../services/accountHealthScoring');
const {
  pruneAccountHealthSnapshots, upsertAccountHealthSnapshot, listAccountHealthSnapshots, findRecentKpiSnapshotsByHubspotCompanyId,
  updateAccountHealthAging,
} = require('../db/database');
const { parseAgingReportPdf } = require('../services/agingReportParser');
const { matchAgingRows } = require('../services/agingReportMatcher');

/**
 * Maps getTicketSummaryForCompany's output onto the serviceHealth shape
 * accountHealthScoring.js knows how to score (see HUBSPOT_BRIDGE_SCHEMA.md
 * for the aspirational full shape) — only the subset live HubSpot ticket
 * data can actually supply. escalationCount/repeatIssues/slaAdherencePct
 * stay null (Jira- and judgment-based, not available from this API), which
 * scoreServiceHealth already treats as "no penalty," not a fabricated risk.
 *
 * "Open" here (openTicketCount, avgTicketAgeDays, agedTickets) means
 * specifically the focused working queue — "Client Submitted"/"In
 * Progress" tickets — per Aaron (Sep 2026), not every non-closed ticket:
 * a Long-Term Project or Top 3 Enhancement sitting open for months isn't
 * the same "stuck ticket" problem an unanswered Client Submitted ticket
 * is, and scoring/aging stats that blended them together would have
 * masked the actual SLA signal. Enhancement/other-status tickets are
 * still fully counted, just in their own buckets below, not the aging
 * calculation.
 */
function mapLiveServiceHealth(ticketSummary) {
  const openTickets = ticketSummary.focusedOpenTickets;
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
    openTicketCount: openTickets.length,
    closedTicketCount: ticketSummary.closed,
    // Every open ticket NOT in the focused queue above, split into the
    // buckets Aaron asked to track separately: ranked-1/2/3 (or
    // "Top 3 Enhancements" stage) tickets, everything else parked in
    // "Long-Term Projects," and a catch-all for lower-volume statuses
    // (Not Started, Waiting for confirmation, Check In, ALIS Internal
    // Finance, Done - waiting for confirmation, Insignificant Ticket
    // Updates, SPAM, New) so nothing open is silently uncounted.
    enhancementTopCount: ticketSummary.enhancementTickets.top.length,
    enhancementTopItems: ticketSummary.enhancementTickets.top.map((t) => ({
      ticketId: t.id, subject: t.subject, rank: t.topThreeRank, stage: t.pipelineStageLabel, url: t.url,
    })),
    enhancementLesserCount: ticketSummary.enhancementTickets.lesser.length,
    otherOpenCount: ticketSummary.otherOpenTickets.length,
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
    // "ARR added this calendar year" — gross sum of closed-won deal amounts
    // whose close date falls in the current year, not netted against
    // cancellations/churn (the "Deals by Type" chart already has a real
    // "cancellation" bucket) — a deliberate simplification, not an
    // oversight: Aaron asked for "ARR added," and a true net figure would
    // need cancellation deals' amounts to represent the ARR actually lost,
    // which isn't confirmed to be populated/signed consistently. Reuses
    // dealSummary.deals (already fetched, the full history) — no new
    // HubSpot calls. "amount" is a deal's own contract value, not always
    // guaranteed to be a true annualized figure, same caveat as the rest
    // of this file's deal-derived numbers.
    arrAddedThisYearCents: dealSummary.deals
      .filter((d) => d.isWon && d.closeDate && new Date(d.closeDate).getFullYear() === new Date().getFullYear())
      .reduce((sum, d) => sum + Math.round((d.amount || 0) * 100), 0),
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
    const { companies, excludedInactiveCommunities } = await getOwnedCompanies(ownerId);
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
        const { score, band } = computeHealthScore({ serviceHealth, financialHealth, arrCents: company.arrCents });

        upsertAccountHealthSnapshot({
          hubspotCompanyId: company.id,
          companyName: company.name,
          lifecycleStage: company.lifecycleStage,
          serviceHealth,
          financialHealth,
          openTicketCount: serviceHealth.openTicketCount,
          closedTicketCount: ticketSummary.closed,
          openDealCount: dealSummary.open,
          openDealValueCents: Math.round((dealSummary.totalOpenValue || 0) * 100),
          arrCents: company.arrCents,
          arrAddedThisYearCents: financialHealth.arrAddedThisYearCents,
          enhancementTopCount: serviceHealth.enhancementTopCount,
          enhancementLesserCount: serviceHealth.enhancementLesserCount,
          otherOpenTicketCount: serviceHealth.otherOpenCount,
          healthScore: score,
          healthBand: band?.label || null,
        });
      } catch (err) {
        errors.push({ company: company.name, error: err.message });
      }
    });

    // Pruned AFTER the loop, using the company list this refresh actually
    // confirmed — not a blanket clear beforehand, which would also wipe
    // aging_* data (see pruneAccountHealthSnapshots' doc comment) for
    // accounts that are still very much in scope.
    pruneAccountHealthSnapshots(companies.map((c) => c.id));

    res.json({
      refreshedAt: new Date().toISOString(),
      companyCount: companies.length,
      errorCount: errors.length,
      errors,
      priorQbrCount: priorQbrByCompanyId.size,
      excludedInactiveCommunities,
    });
  } catch (err) {
    console.error('[accountHealth] Refresh failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Groups matched aging rows by the account they resolved to — several
 * rows commonly map to the same Home Office (confirmed live: 6 different
 * "Viva Senior Living X" individual-community rows all matched the same
 * "Viva Senior Living" Home Office account), so their bucket amounts are
 * summed, not just the last one kept.
 */
function aggregateAgingByAccount(matched, asOfDate) {
  const byAccountId = new Map();
  for (const { row, account, confidence } of matched) {
    const key = account.hubspot_company_id;
    if (!byAccountId.has(key)) {
      byAccountId.set(key, {
        current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, d121Plus: 0, total: 0,
        sourceRows: [],
      });
    }
    const agg = byAccountId.get(key);
    agg.current += row.current;
    agg.d1_30 += row.d1_30;
    agg.d31_60 += row.d31_60;
    agg.d61_90 += row.d61_90;
    agg.d91_120 += row.d91_120;
    agg.d121Plus += row.d121Plus;
    agg.total += row.total;
    agg.sourceRows.push({ customerId: row.customerId, customerName: row.customerName, total: row.total, confidence });
  }

  const cents = (n) => Math.round(n * 100);
  const result = new Map();
  for (const [hubspotCompanyId, agg] of byAccountId) {
    result.set(hubspotCompanyId, {
      asOfDate,
      currentCents: cents(agg.current),
      d1_30Cents: cents(agg.d1_30),
      d31_60Cents: cents(agg.d31_60),
      d61_90Cents: cents(agg.d61_90),
      d91_120Cents: cents(agg.d91_120),
      d121PlusCents: cents(agg.d121Plus),
      totalCents: cents(agg.total),
      pastDue61PlusCents: cents(agg.d61_90 + agg.d91_120 + agg.d121Plus),
      sourceRows: agg.sourceRows,
    });
  }
  return result;
}

// POST /api/account-health/import-aging-report — Dave Johnson's weekly
// Intacct "Customer Aging Report" PDF (manual upload — see
// agingReportParser.js's doc comment for why this is manual, not
// automatic Gmail ingestion). Body: { pdfBase64 }. Matches rows against
// the CACHED portfolio (no live HubSpot calls) and writes per-account
// aging_* columns directly — completely decoupled from /refresh.
router.post('/import-aging-report', async (req, res) => {
  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) {
      return res.status(400).json({ error: 'Body must include pdfBase64 (the PDF file, base64-encoded).' });
    }

    const buffer = Buffer.from(pdfBase64, 'base64');
    const { asOfDate, rows, grandTotal, warnings } = await parseAgingReportPdf(buffer);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No rows parsed from this PDF — is it a Customer Aging Report in the expected format?' });
    }

    const accounts = listAccountHealthSnapshots();
    const { matched, unmatched } = matchAgingRows(rows, accounts);
    const aggregated = aggregateAgingByAccount(matched, asOfDate);
    for (const [hubspotCompanyId, aging] of aggregated) {
      updateAccountHealthAging(hubspotCompanyId, aging);
    }

    res.json({
      asOfDate,
      rowsParsed: rows.length,
      rowsMatched: matched.length,
      accountsUpdated: aggregated.size,
      unmatchedCount: unmatched.length,
      unmatchedNames: unmatched.map((r) => r.customerName),
      grandTotal,
      parseWarnings: warnings,
    });
  } catch (err) {
    console.error('[accountHealth] Aging report import failed:', err);
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
    // score/subScores aren't trusted from the stored health_score/
    // health_band columns here — recomputed on every read, a pure
    // in-memory calculation (no HubSpot calls), from whatever's currently
    // cached (serviceHealth/financialHealth from the last /refresh,
    // aging from the last /import-aging-report). Those two run on
    // completely independent schedules, so the stored columns (last set
    // by whichever ran most recently) would otherwise silently miss
    // aging's contribution until the next full HubSpot refresh happened
    // to run after it.
    const enriched = accounts.map((a) => {
      const { score, band, subScores } = computeHealthScore({
        serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, arrCents: a.arr_cents,
      });
      return {
        ...a,
        health_score: score,
        health_band: band?.label || null,
        subScores,
        dsoDays: computeDsoDays(a.aging, a.arr_cents),
        hubspotUrl: hubspotRecordUrl('company', a.hubspot_company_id),
        priorQbr: priorQbrByCompanyId.get(a.hubspot_company_id) || null,
      };
    });
    res.json({ accounts: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
