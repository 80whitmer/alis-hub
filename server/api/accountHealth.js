const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { getOwnerId, getOwnedCompanies } = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal, hubspotRecordUrl } = require('../services/hubspotTickets');
const { computeHealthScore, computeDsoDays } = require('../services/accountHealthScoring');
const {
  pruneAccountHealthSnapshots, upsertAccountHealthSnapshot, listAccountHealthSnapshots, findRecentKpiSnapshotsByHubspotCompanyId,
  updateAccountHealthAging, updateAccountHealthOccupancy, setAccountHealthOccupancyError, createJob, setJobStatus, setItemStatus,
  listRecurringCalls, upsertRecurringCall, deleteRecurringCall,
} = require('../db/database');
const { broadcast } = require('./broadcaster');
const { parseAgingReportPdf } = require('../services/agingReportParser');
const { matchAgingRows } = require('../services/agingReportMatcher');
const { renderAccountHealthPortfolioPdf, renderAccountHealthAccountPdf } = require('../services/accountHealthPdf');
const { getOccupancySnapshotForAccount } = require('../services/accountHealthOccupancy');

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
    // createdAt/closedAt/isOpen added (Sep 2026) for the shared Top 3
    // Enhancement Requests drawer (TopThreeEnhancementsCard.jsx, used by
    // both this dashboard and the new Team AM Dashboard) — the raw
    // ticket already carries these fields, just wasn't forwarding them.
    enhancementTopItems: ticketSummary.enhancementTickets.top.map((t) => ({
      ticketId: t.id, subject: t.subject, rank: t.topThreeRank, stage: t.pipelineStageLabel, url: t.url,
      createdAt: t.createdAt || null, closedAt: t.closedAt || null, isOpen: t.isOpen ?? null,
    })),
    enhancementLesserCount: ticketSummary.enhancementTickets.lesser.length,
    otherOpenCount: ticketSummary.otherOpenTickets.length,
    // Flat per-account list for the portfolio-wide Enhancement Requests
    // section (EnhancementRequestsSection.jsx, shared with teamAm.js) —
    // broader than enhancementTopItems above (see hubspotTickets.js's
    // isEnhancementRequest), open tickets only.
    enhancementRequests: ticketSummary.enhancementRequests.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url,
      createdAt: t.createdAt, daysOpen: t.daysOpen,
      nextStep: t.nextStep, isTopThree: t.isTopThree,
    })),
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

  const currentYear = new Date().getFullYear();
  const arrAddedThisYearDeals = dealSummary.deals
    .filter((d) => d.isWon && d.closeDate && new Date(d.closeDate).getFullYear() === currentYear)
    .map((d) => ({ ...d, arrValueCents: Math.round((d.arrValue || 0) * 100) }));
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
    // {count, valueCents} per type rather than a bare count — Aaron asked
    // (Sep 2026) for total deal value alongside count on the Deals by Type
    // chart, since a type with few but large deals reads very differently
    // than one with many small ones. valueCents sums `arr_value`, not
    // `amount` — Aaron asked (Sep 2026, same session as the ARR Added fix
    // below) for this chart to read the same way the rest of the
    // dashboard now does. Summed over dealSummary.deals (the full
    // history, already fetched) — same as arrAddedThisYearCents just
    // below, no extra HubSpot calls.
    dealsByType: dealSummary.deals.reduce((acc, d) => {
      const key = d.dealType || 'unspecified';
      if (!acc[key]) acc[key] = { count: 0, valueCents: 0 };
      acc[key].count += 1;
      acc[key].valueCents += Math.round((d.arrValue || 0) * 100);
      return acc;
    }, {}),
    // "ARR added this calendar year" — gross sum of closed-won deals'
    // `arr_value` (the portal's own "ARR (Total Potential Value)" property
    // — confirmed live, Sep 2026, to be exactly what HubSpot's own "2026
    // Booked Revenue" dashboard card sums) whose close date falls in the
    // current year. NOT netted against cancellations/churn (the "Deals by
    // Type" chart already has a real "cancellation" bucket) — a deliberate
    // simplification: Aaron asked for "ARR added," and a true net figure
    // would need cancellation deals' lost-ARR values, which isn't
    // confirmed to be populated consistently. Previously summed the
    // deal's plain `amount` field instead — fixed (Sep 2026) after Aaron
    // found alis-hub's figure didn't match his HubSpot "Booked Revenue"
    // card; `amount` is just a deal's raw contract-value field (a one-time
    // fee, a partial add-on, anything), not an annualized figure at all,
    // while `arr_value` is purpose-built for exactly this ((AL/IL capacity
    // × negotiated rate) × 12) — still "at capacity" potential value, not
    // necessarily today's actual billed revenue, and can be null on deals
    // that predate this property or were entered without capacity/rate
    // fields, same caveat as the rest of this file's deal-derived numbers.
    // Reuses dealSummary.deals (already fetched, the full history) — no
    // new HubSpot calls.
    arrAddedThisYearCents: arrAddedThisYearDeals.reduce((sum, d) => sum + d.arrValueCents, 0),
    // The actual deals behind arrAddedThisYearCents — Aaron asked (Sep
    // 2026) for a drill-down after the ARR Added figure jumped once
    // arr_value replaced amount, since a portfolio-wide sum with no way
    // to see what's in it isn't trustworthy on its own.
    arrAddedThisYearDeals: arrAddedThisYearDeals.map((d) => ({
      name: d.name, arrValueCents: d.arrValueCents, closeDate: d.closeDate,
      pipeline: d.pipeline, stage: d.stage, url: d.url,
    })),
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
          activeCommunityCount: company.activeCommunityCount,
          healthScore: score,
          healthBand: band?.label || null,
          tier: company.tier,
          lastActivityDate: company.lastActivityDate,
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

/**
 * Shared by GET / and the PDF export routes below — score/subScores
 * aren't trusted from the stored health_score/health_band columns here,
 * recomputed on every read, a pure in-memory calculation (no HubSpot
 * calls), from whatever's currently cached (serviceHealth/financialHealth
 * from the last /refresh, aging from the last /import-aging-report).
 * Those two run on completely independent schedules, so the stored
 * columns (last set by whichever ran most recently) would otherwise
 * silently miss aging's contribution until the next full HubSpot refresh
 * happened to run after it.
 */
function getEnrichedAccounts() {
  const accounts = listAccountHealthSnapshots();
  const priorQbrByCompanyId = findRecentKpiSnapshotsByHubspotCompanyId();
  // Manually-entered, never touched by a HubSpot refresh — see the
  // recurring_calls CREATE TABLE comment (database.js) for why this is
  // hand-maintained rather than calendar-synced.
  const recurringCallByCompanyId = new Map(listRecurringCalls().map((r) => [r.hubspot_company_id, r]));
  return accounts.map((a) => {
    const { score, band, subScores } = computeHealthScore({
      serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, arrCents: a.arr_cents,
    });
    const recurringCall = recurringCallByCompanyId.get(a.hubspot_company_id);
    return {
      ...a,
      health_score: score,
      health_band: band?.label || null,
      subScores,
      dsoDays: computeDsoDays(a.aging, a.arr_cents),
      hubspotUrl: hubspotRecordUrl('company', a.hubspot_company_id),
      priorQbr: priorQbrByCompanyId.get(a.hubspot_company_id) || null,
      recurringCall: recurringCall ? {
        cadence: recurringCall.cadence,
        nextCallDate: recurringCall.next_call_date,
        calendarLink: recurringCall.calendar_link,
        notes: recurringCall.notes,
        updatedAt: recurringCall.updated_at,
      } : null,
    };
  });
}

/**
 * Same shape as AccountHealthDashboard.jsx's client-side `rollup` useMemo
 * — duplicated rather than shared across the client/server module
 * boundary (matching this codebase's established small-helper-duplication
 * pattern elsewhere), since the PDF export needs the identical roll-up
 * numbers the on-screen dashboard shows.
 */
function computePortfolioRollup(accounts) {
  const scored = accounts.filter((a) => a.health_score != null);
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;

  const dsoEligible = accounts.filter((a) => a.aging_total_cents != null && a.arr_cents);
  const dsoAgingTotal = dsoEligible.reduce((s, a) => s + a.aging_total_cents, 0);
  const dsoArrTotal = dsoEligible.reduce((s, a) => s + a.arr_cents, 0);
  const portfolioDsoDays = dsoArrTotal > 0 ? Math.round(dsoAgingTotal / (dsoArrTotal / 365)) : null;

  return {
    totalAccounts: accounts.length,
    openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
    closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
    enhancementTop: accounts.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
    enhancementLesser: accounts.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
    otherOpen: accounts.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
    openDeals: accounts.reduce((s, a) => s + (a.open_deal_count || 0), 0),
    openDealValueCents: accounts.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
    arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
    arrAddedThisYearCents: accounts.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
    agingTotalCents: accounts.reduce((s, a) => s + (a.aging_total_cents || 0), 0),
    pastDue61PlusCents: accounts.reduce((s, a) => s + (a.aging_past_due_61_plus_cents || 0), 0),
    agingAsOfDate: accounts.find((a) => a.aging_as_of_date)?.aging_as_of_date || null,
    portfolioDsoDays,
    totalCapacity: accounts.reduce((s, a) => s + (a.total_capacity || 0), 0),
    currentCensus: accounts.reduce((s, a) => s + (a.current_census || 0), 0),
    occupancyAccountCount: accounts.filter((a) => a.total_capacity != null).length,
    occupancyAsOfDate: accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null,
    totalCommunities: accounts.reduce((s, a) => s + (a.active_community_count || 0), 0),
    avgScore,
  };
}

/**
 * Runs the actual per-account occupancy pull in the background, reporting
 * live progress through the same job/SSE plumbing the Playwright automation
 * jobs already use (server/db/database.js's createJob/setItemStatus,
 * server/api/broadcaster.js's broadcast, consumed via GET /api/stream/:id)
 * — reused as-is rather than inventing a second progress mechanism. Aaron
 * asked for this (Sep 2026) after a real 93-account run gave no sense of
 * whether the button was hung; each account here is its own external ALIS
 * API call (unlike the HubSpot refresh's bulk-friendly calls), so a run
 * over the real portfolio takes long enough that "proof of life" matters.
 *
 * job_items only has 'success'/'failed'/'skipped' terminal statuses, but
 * updateJobCounts (database.js) only counts 'success' toward `completed`
 * and 'failed' toward `failed` — 'skipped' items would never count as
 * done and the progress bar would stall short of 100% forever for the
 * ~87 no-mapping accounts. So "no ALIS subdomain mapped" is recorded as
 * job_item status 'success' (it's an expected, non-error outcome, not a
 * failure) — the skipped-vs-updated distinction is only carried in the
 * SSE payload / final summary, not the persisted per-item status.
 */
async function runOccupancyRefreshJob(jobId, accounts) {
  const emit = (event, data) => broadcast(jobId, event, data);
  setJobStatus(jobId, 'running');

  const errors = [];
  let updated = 0;
  let skippedNoMapping = 0;

  await mapWithConcurrency(accounts, 3, async (a) => {
    setItemStatus(jobId, a.company_name, 'running');
    emit('item_start', { name: a.company_name });
    try {
      const occupancy = await getOccupancySnapshotForAccount(a.company_name, a.hubspot_company_id);
      if (!occupancy) {
        skippedNoMapping += 1;
        setItemStatus(jobId, a.company_name, 'success');
        emit('item_done', { name: a.company_name, skipped: true });
        return;
      }
      updateAccountHealthOccupancy(a.hubspot_company_id, occupancy);
      updated += 1;
      setItemStatus(jobId, a.company_name, 'success');
      emit('item_done', { name: a.company_name, skipped: false });
    } catch (err) {
      errors.push({ company: a.company_name, error: err.message });
      setItemStatus(jobId, a.company_name, 'failed', err.message);
      setAccountHealthOccupancyError(a.hubspot_company_id, err.message);
      emit('item_fail', { name: a.company_name, error: err.message });
    }
  });

  setJobStatus(jobId, 'done');
  emit('job_done', {
    refreshedAt: new Date().toISOString(),
    accountsUpdated: updated,
    accountsSkippedNoMapping: skippedNoMapping,
    errorCount: errors.length,
    errors,
  });
}

// POST /api/account-health/refresh-occupancy — today's total capacity /
// current census (+ product-type/classification breakdown) for every
// account with a known ALIS subdomain mapping (server/api/companyHosts.js).
// A genuinely separate, heavier external API (Basic Auth per subdomain,
// not HubSpot) with much sparser coverage today than the HubSpot data —
// kept as its own action/cadence, same reasoning as the aging-report
// import, so it never slows down or blocks the main refresh. Fires the
// actual pull off as a tracked background job (see runOccupancyRefreshJob)
// and responds immediately with the job id, same 202-and-don't-await
// pattern POST /api/jobs/create already uses — the client follows
// progress via GET /api/stream/:id.
router.post('/refresh-occupancy', (req, res) => {
  try {
    const accounts = listAccountHealthSnapshots();
    const id = uuidv4();
    createJob({
      id,
      type: 'account-health-occupancy',
      label: 'Account Health — Occupancy Refresh',
      payload: {},
      total: accounts.length,
      items: accounts.map((a) => ({ name: a.company_name })),
    });

    runOccupancyRefreshJob(id, accounts).catch((err) => {
      console.error(`[account-health-occupancy:${id}] Unhandled error:`, err);
      setJobStatus(id, 'failed', err.message);
      broadcast(id, 'job_error', { error: err.message });
    });

    res.status(202).json({ id, total: accounts.length });
  } catch (err) {
    console.error('[accountHealth] Occupancy refresh failed to start:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health — the cached portfolio, instant read, plus a
// best-effort "prior QBR" pointer per company (see
// findRecentKpiSnapshotsByHubspotCompanyId's doc comment for why this
// isn't folded into the health score itself).
router.get('/', (req, res) => {
  try {
    res.json({ accounts: getEnrichedAccounts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health/export-pdf — the portfolio report (roll-up +
// every account), rendered server-side via Playwright (see
// accountHealthPdf.js). Re-derives from the same cached snapshots GET /
// reads — no HubSpot calls, same instant-read guarantee.
router.get('/export-pdf', async (req, res) => {
  try {
    const accounts = getEnrichedAccounts();
    const rollup = computePortfolioRollup(accounts);
    const buffer = await renderAccountHealthPortfolioPdf(accounts, rollup);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Account-Health-Portfolio.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[accountHealth] Portfolio PDF export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/account-health/:hubspotCompanyId/refresh-occupancy — a
// single-account version of the portfolio-wide job above. Aaron asked
// for this (Sep 2026) after finding wrong ALIS subdomain mappings
// (Hickory Senior Living was mapped to a real but completely unrelated
// company's subdomain) via the drawer's new inline host editor — fixing
// one mapping shouldn't require re-running the full ~5-minute,
// 93-account job just to confirm the fix worked. Synchronous (one or two
// external calls, not ~93) — no job-tracking needed at this scale.
router.post('/:hubspotCompanyId/refresh-occupancy', async (req, res) => {
  try {
    const account = listAccountHealthSnapshots().find((a) => a.hubspot_company_id === req.params.hubspotCompanyId);
    if (!account) return res.status(404).json({ error: 'No cached account health data for this company — try Refresh first.' });

    const occupancy = await getOccupancySnapshotForAccount(account.company_name, account.hubspot_company_id);
    if (!occupancy) return res.status(400).json({ error: 'No ALIS subdomain mapped for this account.' });

    updateAccountHealthOccupancy(account.hubspot_company_id, occupancy);
    res.json({ occupancy });
  } catch (err) {
    setAccountHealthOccupancyError(req.params.hubspotCompanyId, err.message);
    console.error(`[accountHealth] Single-account occupancy refresh failed for ${req.params.hubspotCompanyId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account-health/:hubspotCompanyId/recurring-call — Aaron asked
// (Sep 2026) for a way to track recurring client call cadence
// (weekly/bi-weekly/monthly) on the dashboard. No calendar API
// integration exists in this app (see the recurring_calls CREATE TABLE
// comment in database.js), so this is hand-entered from the drawer
// rather than synced — cadence, next call date, and an optional pasted
// link to the actual recurring calendar event/series (works with any
// calendar provider, since it's just a stored URL, not a live API call).
router.put('/:hubspotCompanyId/recurring-call', (req, res) => {
  try {
    const { hubspotCompanyId } = req.params;
    const account = listAccountHealthSnapshots().find((a) => a.hubspot_company_id === hubspotCompanyId);
    if (!account) return res.status(404).json({ error: 'No cached account health data for this company — try Refresh first.' });

    const { cadence, nextCallDate, calendarLink, notes } = req.body;
    upsertRecurringCall({ hubspotCompanyId, cadence, nextCallDate, calendarLink, notes });
    res.json({ ok: true });
  } catch (err) {
    console.error('[accountHealth] Recurring-call save failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/account-health/:hubspotCompanyId/recurring-call — clears
// the row entirely (vs. saving with blank fields) so the account drops
// out of the Recurring Calls table.
router.delete('/:hubspotCompanyId/recurring-call', (req, res) => {
  try {
    deleteRecurringCall(req.params.hubspotCompanyId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[accountHealth] Recurring-call delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health/:hubspotCompanyId/export-pdf — a single
// account's drill-down report, mirroring the dashboard's drawer.
router.get('/:hubspotCompanyId/export-pdf', async (req, res) => {
  try {
    const account = getEnrichedAccounts().find((a) => a.hubspot_company_id === req.params.hubspotCompanyId);
    if (!account) return res.status(404).json({ error: 'No cached account health data for this company — try Refresh first.' });

    const buffer = await renderAccountHealthAccountPdf(account);
    const filename = `${account.company_name}-Account-Health.pdf`.replace(/[^a-z0-9.\-]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[accountHealth] Single-account PDF export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
