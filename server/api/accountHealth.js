const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const {
  getOwnerId, getOwnedCompanies, getAccountManagerName, getLifecycleDataQualityFlag, LIFECYCLE_FLAG_LABELS,
  shouldDropLifecycleFlaggedAccount,
} = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal, hubspotRecordUrl, computeContractTruth } = require('../services/hubspotTickets');
const { getKeyContactsForCompany } = require('../services/hubspotContacts');
const { getNextOccurrenceFromLink } = require('../services/googleCalendar');
const { computeHealthScore, computeDsoDays } = require('../services/accountHealthScoring');
const {
  pruneAccountHealthSnapshots, upsertAccountHealthSnapshot, listAccountHealthSnapshots, findRecentKpiSnapshotsByHubspotCompanyId,
  findRecentJobSnapshotsByHubspotCompanyId, findRecentAuditHistorySnapshotsByCompanyHost,
  updateAccountHealthAging, updateAccountHealthOccupancy, setAccountHealthOccupancyError, createJob, setJobStatus, setItemStatus,
  recordHealthScoreSnapshots, getHealthScoreHistory,
  recordKpiMetricSnapshots, getKpiMetricHistory,
  listRecurringCalls, createRecurringCall, updateRecurringCall, deleteRecurringCall, bulkImportRecurringCalls,
  listCommunityRevenueSnapshots, getPriorCommunityRevenueSnapshot, listCommunityRevenueMonths,
  listCommunityRevenueLatestMonthByCompany,
  listKeyContacts, replaceKeyContactsForCompany, pruneKeyContacts,
  listAlisAdminIds, listCompanyHosts,
} = require('../db/database');
const { broadcast } = require('./broadcaster');
const { parseAgingReportPdf } = require('../services/agingReportParser');
const { matchAgingRows } = require('../services/agingReportMatcher');
const { renderAccountHealthPortfolioPdf, renderAccountHealthAccountPdf } = require('../services/accountHealthPdf');
const { getOccupancySnapshotForAccount } = require('../services/accountHealthOccupancy');
const { recordTierKpis, getTierKpiPayload } = require('../services/tierKpiRollup');

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
 * Progress" tickets, excluding enhancement requests — per Aaron (Sep 2026),
 * not every non-closed ticket: a Long-Term Project or Top 3 Enhancement
 * sitting open for months isn't the same "stuck ticket" problem an
 * unanswered Client Submitted ticket is, and an Enhancement-categorized
 * ticket that just hasn't been staged into one of those yet is still an
 * enhancement ask, not working-queue support volume — both would have
 * masked the actual SLA signal, and double-counted against the separate
 * Enhancement Requests tile. Enhancement/other-status tickets are still
 * fully counted, just in their own buckets below, not the aging
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
      .map((t) => ({ ticketId: t.id, subject: t.subject, ageDays: t.daysOpen, stage: t.pipelineStageLabel, url: t.url, pinnedNoteId: t.pinnedNoteId })),
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
      ticketId: t.id, subject: t.subject, rank: t.topThreeRank, stage: t.pipelineStageLabel, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt || null, closedAt: t.closedAt || null, isOpen: t.isOpen ?? null,
    })),
    enhancementLesserCount: ticketSummary.enhancementTickets.lesser.length,
    enhancementLesserItems: ticketSummary.enhancementTickets.lesser.map((t) => ({
      ticketId: t.id, subject: t.subject, stage: t.pipelineStageLabel, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt || null, closedAt: t.closedAt || null, isOpen: t.isOpen ?? null,
    })),
    otherOpenCount: ticketSummary.otherOpenTickets.length,
    // Flat per-account list for the portfolio-wide Enhancement Requests
    // section (EnhancementRequestsSection.jsx, shared with teamAm.js) —
    // broader than enhancementTopItems above (see hubspotTickets.js's
    // isEnhancementRequest), open tickets only.
    enhancementRequests: ticketSummary.enhancementRequests.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt, daysOpen: t.daysOpen,
      nextStep: t.nextStep, isTopThree: t.isTopThree,
    })),
    // Closed enhancement requests (Sep 2026) — feeds
    // EnhancementRequestsSection.jsx's new Opened vs. Closed trend chart,
    // mirroring the alisEscalation Open/Closed pairing below. isTopThree
    // rides along so the Top-3-only view can filter closed items the same
    // way it filters open ones.
    enhancementClosedItems: ticketSummary.closedEnhancementRequests.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt, closedAt: t.closedAt, isTopThree: t.isTopThree,
    })),
    // For the Cost to Serve by Tier chart's "open + closed this calendar
    // year" ticket count — see hubspotTickets.js's closedThisYear.
    closedTicketCountThisYear: ticketSummary.closedThisYear,
    // Live ALIS Pay ticket volume (Sep 2026, Aaron) — the active
    // category_2_0='ALIS Pay' set, not the frozen old ALIS Pay pipeline
    // (see hubspotTickets.js's isAlisPayTicket for why). Feeds both the
    // dashboard rollup card and accountHealthScoring.js's service-health
    // deduction.
    alisPayOpenCount: ticketSummary.alisPayTickets.length,
    alisPayOpenItems: ticketSummary.alisPayTickets.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt, daysOpen: t.daysOpen, stage: t.pipelineStageLabel,
    })),
    // Open "Escalation" tickets (Sep 2026) — category_2_0 === "ALIS
    // Escalation" (see hubspotTickets.js's isEscalation). Named
    // alisEscalation* deliberately, NOT escalationCount/escalationRequests
    // — this object already has an unrelated `escalationCount: null`
    // field a few lines up (a different, Jira-ESC, bridge-schema-only
    // concept accountHealthScoring.js reads as a scoring input) — reusing
    // that name here would collide two different meanings under one key.
    alisEscalationOpenCount: ticketSummary.escalationTickets.length,
    alisEscalationOpenItems: ticketSummary.escalationTickets.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt, daysOpen: t.daysOpen, nextStep: t.nextStep,
    })),
    // Closed escalations (Sep 2026) — feeds EscalationRequestsSection.jsx's
    // "Closed — Trailing 12 Months" heatmap, mirroring alisEscalationOpenItems
    // above but sourced from ticketSummary.closedEscalationTickets (all-time
    // closed, not just this pull's open queue).
    alisEscalationClosedCount: ticketSummary.closedEscalationTickets.length,
    alisEscalationClosedItems: ticketSummary.closedEscalationTickets.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url, pinnedNoteId: t.pinnedNoteId,
      createdAt: t.createdAt, closedAt: t.closedAt,
    })),
    // Slim per-ticket date list (Sep 2026) for the Ticket Activity heatmap
    // and Open Ticket Volume chart — ticketSummary.tickets is the FULL,
    // unfiltered ticket population hubspotTickets.js already fetches every
    // refresh (see its own doc comment), just never persisted before since
    // every other field here only carries small named subsets. Kept
    // deliberately slim (not subject/content/etc.) — this is the one place
    // in serviceHealth that isn't a bounded bucket, so size matters across
    // ~100 accounts. pipelineStageLabel/isEnhancementRequest ride along so
    // the client can reconstruct a "focused queue" and "enhancement
    // requests" backlog-over-time series, not just an unfiltered total —
    // both are static per-ticket facts (not date-dependent), so they're
    // safe to pair with createdAt/closedAt for a historical reconstruction
    // even once the ticket later closes. isEnhancementRequest mirrors
    // hubspotTickets.js's own isEnhancementRequest predicate exactly
    // (duplicated, not shared — same per-file convention as everywhere
    // else in this app) — category_2_0 === 'Enhancement' OR the subject
    // mentions "enhancement".
    ticketDates: ticketSummary.tickets.map((t) => ({
      createdAt: t.createdAt || null,
      closedAt: t.closedAt || null,
      pipelineStageLabel: t.pipelineStageLabel || null,
      isEnhancementRequest: t.category === 'Enhancement' || /enhancement/i.test(t.subject || ''),
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
    .map((d) => ({ ...d, arrValueCents: Math.round((d.arrValue || 0) * 100), dealOwnerName: getAccountManagerName(d.dealOwnerId) }));
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
        valueCents: Math.round((d.amount || 0) * 100),
        // Added (Sep 2026) alongside the existing amount-based valueCents,
        // not in place of it — the "AM KPI" open-deals drill-down table
        // needs to tie back to the "Deals: Open Value (ARR)" chart above it
        // (open_deal_value_cents, summed from arrValue — see
        // getDealSummaryForCompany's totalOpenValue doc comment), which
        // valueCents alone can't do.
        arrValueCents: Math.round((d.arrValue || 0) * 100),
        expectedCloseDate: d.closeDate,
        isOpen: d.isOpen, nextStep: d.nextStep, nextActivityDate: d.nextActivityDate,
        tasks: d.tasks, url: d.url, pinnedNoteId: d.pinnedNoteId,
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
    // to see what's in it isn't trustworthy on its own. dealOwnerName
    // carried through here too (Sep 2026) — the caller (the /refresh
    // handler below) needs it to split this same list into "personally
    // closed by me" vs. "closed by someone else, inherited into my book"
    // (arrPersonallyClosedThisYearCents), same distinction Team AM
    // Dashboard's computeDealMetricsByOwner already draws.
    arrAddedThisYearDeals: arrAddedThisYearDeals.map((d) => ({
      name: d.name, arrValueCents: d.arrValueCents, closeDate: d.closeDate,
      pipeline: d.pipeline, stage: d.stage, url: d.url, pinnedNoteId: d.pinnedNoteId, dealOwnerName: d.dealOwnerName,
    })),
    // Onboarding/implementation tracking (Sep 2026, Aaron: "as long as the
    // tool pulls in any implementations with a project status -- if no
    // project status then we do not have to track"). Deliberately every
    // deal with a projectStatus, open OR closed (dealSummary.deals is the
    // account's FULL deal history, not just openDeals) — a HubSpot deal
    // usually closes (sales-wise) within days/weeks of being created, long
    // before the actual onboarding project it tracks finishes, so a
    // "closed" filter here would silently drop most real implementations.
    // One Home Office can have several of these at once (one per
    // community/batch added), so this stays a flat list rather than
    // collapsing to a single per-account status.
    implementationProjects: dealSummary.deals
      .filter((d) => d.projectStatus)
      .map((d) => ({
        dealId: d.id, name: d.name, projectStatus: d.projectStatus, projectHealthRag: d.projectHealthRag,
        projectProgress: d.projectProgress, projectOwner: d.projectOwner, projectedGoLiveDate: d.projectedGoLiveDate,
        createdAt: d.createdAt, url: d.url, pinnedNoteId: d.pinnedNoteId,
      })),
    // "Contract Truth" data-completeness (Sep 2026, Aaron — moved here from
    // alis-product-ops's Dashboard: "I don't think these really need to be
    // on the product board"). See hubspotTickets.js's computeContractTruth.
    contractTruth: computeContractTruth(dealSummary.deals),
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
    // Resolved once per refresh (Sep 2026) — every company in `companies`
    // is already scoped to this same ownerId (see getOwnedCompanies), so
    // "personally closed by me" vs. "closed by someone else, inherited
    // into my book" only needs this one name to compare each deal's own
    // dealOwnerName against, not a per-company lookup.
    const ownerName = getAccountManagerName(ownerId);
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
        const [ticketSummary, dealSummary, keyContacts] = await Promise.all([
          getTicketSummaryForCompany(company.id),
          getDealSummaryForCompany(company.id),
          // Its own catch, separate from the try/catch around this whole
          // company below — a Key Contacts fetch failure (e.g. a scope
          // issue, or one bad contact record) shouldn't also fail this
          // company's ticket/deal/health-score refresh. `null` here means
          // "couldn't fetch this time," distinct from `[]` ("fetched fine,
          // genuinely zero labeled contacts") — replaceKeyContactsForCompany
          // only runs below when this actually succeeded, so a transient
          // failure leaves whatever was already cached alone instead of
          // wiping it.
          getKeyContactsForCompany(company.id).catch((err) => {
            console.warn(`[accountHealth] Key Contacts fetch failed for ${company.name}: ${err.message}`);
            return null;
          }),
        ]);
        if (keyContacts) replaceKeyContactsForCompany(company.id, keyContacts);
        const serviceHealth = mapLiveServiceHealth(ticketSummary);
        const financialHealth = await mapLiveFinancialHealth(dealSummary);
        const { score, band } = computeHealthScore({ serviceHealth, financialHealth, arrCents: company.arrCents });
        // Splits arrAddedThisYearCents by who actually closed the deal
        // (Sep 2026, Aaron: total ARR added is a workload signal — it
        // shows up in your book whether you touched it or not — but ARR
        // YOU personally closed is a productivity/growth signal). Same
        // dealOwnerName-vs-current-owner distinction Team AM Dashboard's
        // computeDealMetricsByOwner already draws, just single-account-
        // owner here since every company in this refresh is already
        // Aaron's own.
        const arrPersonallyClosedThisYearCents = (financialHealth.arrAddedThisYearDeals || [])
          .filter((d) => d.dealOwnerName === ownerName)
          .reduce((sum, d) => sum + d.arrValueCents, 0);

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
          arrPersonallyClosedThisYearCents,
          enhancementTopCount: serviceHealth.enhancementTopCount,
          enhancementLesserCount: serviceHealth.enhancementLesserCount,
          otherOpenTicketCount: serviceHealth.otherOpenCount,
          alisEscalationOpenCount: serviceHealth.alisEscalationOpenCount,
          activeCommunityCount: company.activeCommunityCount,
          healthScore: score,
          healthBand: band?.label || null,
          tier: company.tier,
          lastActivityDate: company.lastActivityDate,
          pinnedNoteId: company.pinnedNoteId,
          products: company.products,
          package: company.package,
          hubspotCapacity: company.hubspotCapacity,
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
    pruneKeyContacts(companies.map((c) => c.id));

    // Avg Health Score trend point for today (Sep 2026, Aaron: "capture
    // the progress of this kpi over time") — reads through
    // getEnrichedAccounts (not the raw stored health_score column) since
    // that's what GET '/' — and so the on-screen "Avg Health Score" KPI
    // tile — actually shows: it recomputes the score live including
    // aging, which the raw column written by upsertAccountHealthSnapshot
    // above does not. Capturing anything else would let this trend
    // quietly drift from the number it's supposed to be tracking.
    const freshAccounts = getEnrichedAccounts();
    const cleanAccounts = freshAccounts.filter((a) => !a.lifecycle_flag);
    const scoredAccounts = cleanAccounts.filter((a) => a.health_score != null);
    let avgScore = null;
    if (scoredAccounts.length > 0) {
      avgScore = Math.round(scoredAccounts.reduce((s, a) => s + a.health_score, 0) / scoredAccounts.length);
      recordHealthScoreSnapshots('account_health', [
        { scopeKey: 'portfolio', scopeLabel: 'Portfolio (Owned Accounts)', avgHealthScore: avgScore, accountCount: scoredAccounts.length },
        ...scoredAccounts.map((a) => ({ scopeKey: a.hubspot_company_id, scopeLabel: a.company_name, avgHealthScore: a.health_score, accountCount: 1 })),
      ]);
    }

    // AM KPI section's trend chart (Sep 2026, Aaron: "add a tracking/
    // trending over time feature") — one portfolio-wide point per metric
    // per day, same `cleanAccounts` (lifecycle_flag'd accounts excluded)
    // scoping as the AM KPI dropdown itself uses client-side, so the trend
    // line for a metric never drifts from what the chart above it shows
    // today. avgScore is duplicated here (already captured above via
    // recordHealthScoreSnapshots) purely so the AM KPI trend chart can
    // fetch every metric's history — Avg Health Score included — from one
    // endpoint instead of special-casing it to health-score-history.
    const sum = (field) => cleanAccounts.reduce((s, a) => s + (a[field] || 0), 0);
    recordKpiMetricSnapshots('account_health', [
      ...(avgScore != null ? [{ scopeKey: 'portfolio', metricKey: 'avgScore', value: avgScore }] : []),
      { scopeKey: 'portfolio', metricKey: 'totalAccounts', value: cleanAccounts.length },
      { scopeKey: 'portfolio', metricKey: 'totalCommunities', value: sum('active_community_count') },
      { scopeKey: 'portfolio', metricKey: 'openTickets', value: sum('open_ticket_count') },
      { scopeKey: 'portfolio', metricKey: 'closedTickets', value: sum('closed_ticket_count') },
      { scopeKey: 'portfolio', metricKey: 'openDealCount', value: sum('open_deal_count') },
      { scopeKey: 'portfolio', metricKey: 'openDealValueCents', value: sum('open_deal_value_cents') },
      { scopeKey: 'portfolio', metricKey: 'arrAddedThisYearCents', value: sum('arr_added_this_year_cents') },
      { scopeKey: 'portfolio', metricKey: 'arrCents', value: sum('arr_cents') },
      { scopeKey: 'portfolio', metricKey: 'totalCapacity', value: sum('total_capacity') },
      { scopeKey: 'portfolio', metricKey: 'currentCensus', value: sum('current_census') },
      // Backs the "Enhancement vs. Other Open Tickets" combo's trend lines
      // — same enhancement_top_count + enhancement_lesser_count vs.
      // open_ticket_count split as AM_KPI_COMBOS.enhancementVsOther on the
      // client (AccountHealthDashboard.jsx), so the trend never drifts
      // from what the chart above it shows today.
      { scopeKey: 'portfolio', metricKey: 'enhancementTickets', value: sum('enhancement_top_count') + sum('enhancement_lesser_count') },
      { scopeKey: 'portfolio', metricKey: 'otherOpenTickets', value: Math.max(0, sum('open_ticket_count') - sum('enhancement_top_count') - sum('enhancement_lesser_count')) },
      // Backs the "Deals by Type" chart's trend line (Aaron, Sep 2026: "add
      // the tracking and trending feature" to that section) — one overall
      // total across every deal type, not a line per type (dealType is
      // open-ended, not a fixed enum, so a per-type metric_key per day
      // isn't a stable schema). Not on `cleanAccounts` (financialHealth
      // isn't a flat column `sum()` can read), summed directly instead.
      {
        scopeKey: 'portfolio',
        metricKey: 'dealsByTypeTotalArr',
        value: cleanAccounts.reduce((s, a) => s + Object.values(a.financialHealth?.dealsByType || {}).reduce((s2, t) => s2 + (t.valueCents || 0), 0), 0),
      },
    ]);

    // "ARR by Tier" / "Ticket Volume by Client Tier" / "Cost to Serve by
    // Tier" trend sections (Sep 2026, Aaron: "tracking and trending" on
    // these three sections too) — a separate recordKpiMetricSnapshots call
    // (kept out of the portfolio-wide one above) using Client Tier names as
    // scope_key instead of 'portfolio' — additive use of the same
    // kpi_metric_history table, no schema change. Grouping/label
    // reimplemented here to exactly match tierGroups' client-side
    // bucketing just below on this page (AccountHealthDashboard.jsx) —
    // unset/0 tiers labeled 'Unset' — so these trend keys line up with
    // what the charts above them show today; getting this string wrong
    // would silently produce an empty trend rather than an error.
    const tierBuckets = {};
    for (const a of cleanAccounts) {
      const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
      (tierBuckets[key] ||= []).push(a);
    }
    const tierRows = [];
    for (const [tierKey, list] of Object.entries(tierBuckets)) {
      const tierName = tierKey === 'unset' ? 'Unset' : `Tier ${tierKey}`;
      const arrCentsForTier = list.reduce((s, a) => s + (a.arr_cents || 0), 0);
      // Same "open + closed this calendar year" load as CostToServeByTierChart
      // (serviceHealth.closedTicketCountThisYear, not the all-time closed_
      // ticket_count column) so this trend line never drifts from what that
      // chart shows today.
      const ticketsThisYear = list.reduce((s, a) => s + (a.open_ticket_count || 0) + (a.serviceHealth?.closedTicketCountThisYear || 0), 0);
      tierRows.push(
        { scopeKey: tierName, metricKey: 'arrCents', value: arrCentsForTier },
        { scopeKey: tierName, metricKey: 'arrAddedThisYearCents', value: list.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0) },
        { scopeKey: tierName, metricKey: 'ticketsOpenCount', value: list.reduce((s, a) => s + (a.open_ticket_count || 0), 0) },
        { scopeKey: tierName, metricKey: 'ticketsClosedCount', value: list.reduce((s, a) => s + (a.closed_ticket_count || 0), 0) },
      );
      // $0-ARR tiers excluded (undefined ratio), same reasoning as
      // CostToServeByTierChart's own allData filter.
      if (arrCentsForTier > 0) {
        tierRows.push({ scopeKey: tierName, metricKey: 'costToServeRatio', value: (ticketsThisYear * 100000) / arrCentsForTier });
      }
    }
    recordKpiMetricSnapshots('account_health', tierRows);
    recordTierKpis('account_health', freshAccounts);

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
  // Same "most recent run, for a link-out" signal as priorQbr above, for
  // every other per-company deliverable this app produces (Sep 2026, Aaron:
  // "route [these] to the AH dashboard ... only need to save the most
  // recent of each type"). Shaped down to just what the drill-down actually
  // shows, right here rather than inline in the .map() below, so a job
  // that's never been run for a given company (the common case for most
  // accounts) is a cheap Map miss instead of re-deriving anything.
  const priorWellnessByCompanyId = new Map(
    [...findRecentJobSnapshotsByHubspotCompanyId('wellness_snapshots', 'summary_json', (d) => d?.hubspotCompanyId)]
      .map(([id, w]) => [id, {
        jobId: w.jobId,
        createdAt: w.createdAt,
        weekEnding: w.data.weekEnding || null,
        dataWarningCount: Array.isArray(w.data.dataWarnings) ? w.data.dataWarnings.length : 0,
      }]),
  );
  const priorUsageAuditByCompanyId = new Map(
    [...findRecentJobSnapshotsByHubspotCompanyId('usage_audit_snapshots', 'summary_json', (d) => d?.hubspotCompanyId)]
      .map(([id, u]) => [id, { jobId: u.jobId, createdAt: u.createdAt }]),
  );
  // report.company.hubspotRecordId (not a top-level hubspotCompanyId) —
  // see crmIdAuditNormalizer.js's buildCrmIdAuditReport. mismatchCount
  // counts every community status except MATCH (in sync) and
  // SKIPPED_NOT_LIVE (excluded from the audit on purpose), same as this
  // job's own report — see CrmIdAuditDashboard.jsx.
  const priorCrmIdAuditByCompanyId = new Map(
    [...findRecentJobSnapshotsByHubspotCompanyId('crm_id_audit_snapshots', 'report_json', (d) => d?.company?.hubspotRecordId)]
      .map(([id, c]) => {
        const communityStatusCounts = c.data.summary?.communities || {};
        const mismatchCount = Object.entries(communityStatusCounts).reduce(
          (sum, [status, count]) => (status === 'MATCH' || status === 'SKIPPED_NOT_LIVE' ? sum : sum + count), 0,
        );
        return [id, { jobId: c.jobId, createdAt: c.createdAt, mismatchCount }];
      }),
  );
  const priorAuditHistoryByCompanyHost = findRecentAuditHistorySnapshotsByCompanyHost();
  // Manually-entered, never touched by a HubSpot refresh — see the
  // recurring_calls CREATE TABLE comment (database.js) for why this is
  // hand-maintained rather than calendar-synced. One account can now have
  // more than one call (Sep 2026), so this groups into arrays instead of
  // one row per company.
  const recurringCallsByCompanyId = new Map();
  for (const r of listRecurringCalls()) {
    const list = recurringCallsByCompanyId.get(r.hubspot_company_id) || [];
    list.push(r);
    recurringCallsByCompanyId.set(r.hubspot_company_id, list);
  }
  // Key Contacts, grouped the same way — plus the set of every label seen
  // ANYWHERE in the cached portfolio, used below as the "known key-contact
  // roles" list for each account's missing-label gap check. Derived from
  // usage rather than a live HubSpot association-labels call (this
  // function must stay a pure cached-data read, no HubSpot round-trips —
  // see this function's own doc comment above), so a label currently
  // tagged on zero contacts anywhere in the portfolio won't show up here
  // and can't be flagged as "missing" — it starts counting the moment
  // anyone actually uses it.
  const keyContactsByCompanyId = new Map();
  const allKnownKeyContactLabels = new Set();
  for (const c of listKeyContacts()) {
    const list = keyContactsByCompanyId.get(c.hubspot_company_id) || [];
    list.push(c);
    keyContactsByCompanyId.set(c.hubspot_company_id, list);
    for (const label of c.labels) allKnownKeyContactLabels.add(label);
  }
  // Account Truth model (ported from alis-product-ops): the numeric ALIS
  // Admin Company ID this app has no automated way to resolve on its own
  // (see alis_admin_ids' own doc comment in database.js) — joined on here
  // so every account already carries it, same as products/package above.
  const alisAdminIdByCompanyId = new Map(listAlisAdminIds().map((r) => [r.hubspot_company_id, r.alis_admin_company_id]));
  // ALIS subdomain (company_hosts, server/api/companyHosts.js) — joined on
  // here too (Sep 2026, Aaron: quick links to ALIS Settings/App Store/
  // Reports/etc. on the accounts table) so AlisQuickLinks can build
  // https://{host}.alisonline.com/... links without every table needing
  // its own companyHosts prop threaded in just for this. Most of this
  // table's ~550 rows were bulk-imported by name only and were never
  // matched back to a hubspot_company_id (only 2 of 550 have one as of
  // Sep 2026) — same two-step lookup as getCompanyHost() in database.js
  // (id first, name second) so this join actually finds the other ~548.
  const companyHostRows = listCompanyHosts();
  const companyHostById = new Map(companyHostRows.filter((r) => r.hubspot_company_id).map((r) => [r.hubspot_company_id, r.company_host]));
  const companyHostByName = new Map(companyHostRows.map((r) => [r.name_key, r.company_host]));
  const resolveCompanyHost = (a) => companyHostById.get(a.hubspot_company_id) || companyHostByName.get((a.company_name || '').trim().toLowerCase()) || null;
  return accounts.map((a) => {
    const { score, band, subScores } = computeHealthScore({
      serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, arrCents: a.arr_cents,
    });
    const recurringCalls = recurringCallsByCompanyId.get(a.hubspot_company_id) || [];
    const keyContacts = keyContactsByCompanyId.get(a.hubspot_company_id) || [];
    const coveredLabels = new Set(keyContacts.flatMap((c) => c.labels));
    const lifecycleFlag = getLifecycleDataQualityFlag(a.lifecycle_stage);
    // A Lead/Canceled Home Office that still owes money is the one case
    // shouldDropLifecycleFlaggedAccount (applied in the .filter below)
    // keeps around — called out in the badge label so it's obvious WHY a
    // "Canceled" account is still sitting in this table.
    const keptForAgingBalance = (lifecycleFlag === 'lead' || lifecycleFlag === 'canceled') && (a.aging_total_cents || 0) > 0;
    const companyHost = resolveCompanyHost(a);
    return {
      ...a,
      health_score: score,
      health_band: band?.label || null,
      subScores,
      alis_admin_company_id: alisAdminIdByCompanyId.get(a.hubspot_company_id) || null,
      company_host: companyHost,
      dsoDays: computeDsoDays(a.aging, a.arr_cents),
      // See hubspotAccounts.js's getLifecycleDataQualityFlag — this Home
      // Office's own lifecycle stage isn't "Client - Home Office" (Sep
      // 2026, Aaron). A pure Lead/Canceled record is dropped from this
      // list entirely below (see the .filter after this .map) unless it
      // still carries an aging balance; every other flagged category
      // (Client - Community, no stage set) stays fully visible.
      // computePortfolioRollup below excludes every flagged account from
      // ARR/health/ticket sums regardless.
      lifecycle_flag: lifecycleFlag,
      lifecycle_flag_label: lifecycleFlag
        ? (keptForAgingBalance ? `${LIFECYCLE_FLAG_LABELS[lifecycleFlag]} — kept, owes a balance` : LIFECYCLE_FLAG_LABELS[lifecycleFlag])
        : null,
      hubspotUrl: hubspotRecordUrl('company', a.hubspot_company_id),
      priorQbr: priorQbrByCompanyId.get(a.hubspot_company_id) || null,
      priorWellness: priorWellnessByCompanyId.get(a.hubspot_company_id) || null,
      priorUsageAudit: priorUsageAuditByCompanyId.get(a.hubspot_company_id) || null,
      priorCrmIdAudit: priorCrmIdAuditByCompanyId.get(a.hubspot_company_id) || null,
      priorAuditHistory: companyHost ? (priorAuditHistoryByCompanyHost.get(companyHost) || null) : null,
      recurringCalls: recurringCalls.map((rc) => ({
        id: rc.id,
        label: rc.label,
        cadence: rc.cadence,
        nextCallDate: rc.next_call_date,
        calendarLink: rc.calendar_link,
        notes: rc.notes,
        dayOfWeek: rc.day_of_week,
        time: rc.time,
        updatedAt: rc.updated_at,
      })),
      keyContacts: keyContacts.map((c) => ({
        contactId: c.hubspot_contact_id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        labels: c.labels,
        funFacts: c.fun_facts,
        notes: c.notes,
        lastActivityDate: c.last_activity_date,
        hubspotUrl: c.hubspot_url,
      })),
      // Every known Key Contact label (see allKnownKeyContactLabels above)
      // that nobody at this account is currently tagged with — the
      // per-account "who's missing" gap the drawer surfaces.
      missingKeyContactLabels: [...allKnownKeyContactLabels].filter((l) => !coveredLabels.has(l)).sort(),
    };
  }).filter((a) => !shouldDropLifecycleFlaggedAccount(a.lifecycle_flag, a.aging_total_cents));
}

/**
 * Same shape as AccountHealthDashboard.jsx's client-side `rollup` useMemo
 * — duplicated rather than shared across the client/server module
 * boundary (matching this codebase's established small-helper-duplication
 * pattern elsewhere), since the PDF export needs the identical roll-up
 * numbers the on-screen dashboard shows.
 */
function computePortfolioRollup(accounts) {
  // lifecycle_flag'd accounts (Lead/Canceled/wrong-stage/no-stage Home
  // Offices — see hubspotAccounts.js's getLifecycleDataQualityFlag) stay
  // counted in totalAccounts (still fully visible on the Accounts table)
  // but are excluded from every other sum here, so a stray $0-ARR
  // non-client record can't skew portfolio ARR/health/DSO (Aaron, Sep 2026).
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const scored = clean.filter((a) => a.health_score != null);
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;

  const dsoEligible = clean.filter((a) => a.aging_total_cents != null && a.arr_cents);
  const dsoAgingTotal = dsoEligible.reduce((s, a) => s + a.aging_total_cents, 0);
  const dsoArrTotal = dsoEligible.reduce((s, a) => s + a.arr_cents, 0);
  const portfolioDsoDays = dsoArrTotal > 0 ? Math.round(dsoAgingTotal / (dsoArrTotal / 365)) : null;

  return {
    totalAccounts: accounts.length,
    flaggedAccountCount: accounts.length - clean.length,
    openTickets: clean.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
    closedTickets: clean.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
    enhancementTop: clean.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
    enhancementLesser: clean.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
    otherOpen: clean.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
    openDeals: clean.reduce((s, a) => s + (a.open_deal_count || 0), 0),
    openDealValueCents: clean.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
    arrCents: clean.reduce((s, a) => s + (a.arr_cents || 0), 0),
    // "Added to Book" (workload — ARR added on accounts you currently own,
    // regardless of who closed the deal) vs. "Personally Closed"
    // (productivity/growth — ARR from deals YOU actually closed, Sep
    // 2026, Aaron) — see the /refresh handler above for how the latter is
    // computed and stored per account.
    arrAddedThisYearCents: clean.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
    arrPersonallyClosedThisYearCents: clean.reduce((s, a) => s + (a.arr_personally_closed_this_year_cents || 0), 0),
    agingTotalCents: clean.reduce((s, a) => s + (a.aging_total_cents || 0), 0),
    pastDue61PlusCents: clean.reduce((s, a) => s + (a.aging_past_due_61_plus_cents || 0), 0),
    // Newest, not first-found — accounts missing from the latest report keep an older date. MM/DD/YYYY → compare year, then MM/DD.
    agingAsOfDate: accounts.reduce((latest, a) => {
      const d = a.aging_as_of_date;
      return d && (!latest || d.slice(6) + d.slice(0, 5) > latest.slice(6) + latest.slice(0, 5)) ? d : latest;
    }, null),
    portfolioDsoDays,
    totalCapacity: clean.reduce((s, a) => s + (a.total_capacity || 0), 0),
    currentCensus: clean.reduce((s, a) => s + (a.current_census || 0), 0),
    occupancyAccountCount: clean.filter((a) => a.total_capacity != null).length,
    occupancyAsOfDate: accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null,
    totalCommunities: clean.reduce((s, a) => s + (a.active_community_count || 0), 0),
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
    // Client-side "personally closed" filtering (ArrPersonallyClosedSection)
    // needs the exact same ownerName the /refresh handler used to compute
    // arr_personally_closed_this_year_cents (dealOwnerName === ownerName) —
    // recomputing it independently risks drifting from that number. Read
    // directly off HUBSPOT_OWNER_ID rather than the async getOwnerId(),
    // keeping this route's existing "instant cached read" behavior; null
    // if that env var isn't set (getOwnerId's owners-API fallback path),
    // which just hides the personally-closed section rather than blocking
    // the whole page.
    const ownerName = process.env.HUBSPOT_OWNER_ID ? getAccountManagerName(process.env.HUBSPOT_OWNER_ID) : null;
    res.json({ accounts: getEnrichedAccounts(), ownerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health/health-score-history — portfolio-wide Avg
// Health Score trend, one point per day a /refresh has run (see
// health_score_history's own doc comment in database.js). A brand-new
// metric as of Sep 2026, so an empty/short array here is expected, not
// an error — the trend fills in as refreshes accumulate over time.
router.get('/health-score-history', (req, res) => {
  try {
    res.json({ history: getHealthScoreHistory('account_health', 'portfolio') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health/kpi-metric-history — portfolio-wide trend for
// every AM KPI dropdown metric at once (keyed by metric_key), one point
// per day a /refresh has run — see kpi_metric_history's own doc comment in
// database.js. A brand-new metric as of Sep 2026, so a short/empty array
// per key is expected at first, not an error.
router.get('/kpi-metric-history', (req, res) => {
  try {
    res.json({ history: getKpiMetricHistory('account_health', 'portfolio') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/account-health/kpi-metric-history-by-tier — same idea as
// kpi-metric-history just above, but keyed by Client Tier (scope_key) for
// the "ARR by Tier" / "Ticket Volume by Client Tier" / "Cost to Serve by
// Tier" trend subsections (Sep 2026, Aaron: "tracking and trending" on
// those three sections too) — see the tier-grouped recordKpiMetricSnapshots
// call in the /refresh handler above for what populates each tier's rows.
// GET /api/account-health/tier-kpis — the "Tier KPIs" section, scoped to
// this page's own (owned) accounts: current rollup plus daily history.
router.get('/tier-kpis', (req, res) => {
  try {
    res.json(getTierKpiPayload('account_health', getEnrichedAccounts()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/kpi-metric-history-by-tier', (req, res) => {
  try {
    res.json({
      history: {
        'Tier 1': getKpiMetricHistory('account_health', 'Tier 1'),
        'Tier 2': getKpiMetricHistory('account_health', 'Tier 2'),
        'Tier 3': getKpiMetricHistory('account_health', 'Tier 3'),
        'Tier 4': getKpiMetricHistory('account_health', 'Tier 4'),
        Unset: getKpiMetricHistory('account_health', 'Unset'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 'YYYY-MM' minus one calendar month, e.g. '2026-09' -> '2026-08' — used to find "last calendar month" for the overdue banner. */
function priorCalendarMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = (m-1)-1
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole calendar months between two 'YYYY-MM' strings (b - a), for the overdue banner's "N months behind" figure. */
function monthsDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** { current, prior, deltaAbs, deltaPct } — null-safe, same convention as withTrend/trendArrow in wellnessNormalizer.js: never fabricates a prior value or a delta when no prior-month snapshot exists yet. */
function withDelta(current, prior) {
  if (current == null || prior == null) return { current: current ?? null, prior: prior ?? null, deltaAbs: null, deltaPct: null };
  const deltaAbs = current - prior;
  const deltaPct = prior !== 0 ? (deltaAbs / Math.abs(prior)) * 100 : null;
  return { current, prior, deltaAbs, deltaPct };
}

/**
 * Merges this month's occupancy-by-category rows (product type or
 * classification — same {occupied, pct} shape either way, keyed by
 * `categoryKey`) against the prior month's, diffing `occupied`/`pct` with
 * withDelta per category. A category present one month and gone the next
 * (e.g. a product type with zero residents this month) still gets a row —
 * current or prior simply comes back null for it, same "never fabricate,
 * never silently drop" convention as withDelta itself. Returns [] for
 * `null`/absent JSON (an account snapshotted before this column existed, or
 * a month with no occupancy data at all) rather than throwing.
 */
function withCategoryDelta(currentJson, priorJson, categoryKey) {
  const current = currentJson ? JSON.parse(currentJson) : [];
  const prior = priorJson ? JSON.parse(priorJson) : [];
  const priorByKey = new Map(prior.map((r) => [r[categoryKey], r]));
  const seen = new Set();
  const merged = current.map((r) => {
    seen.add(r[categoryKey]);
    const p = priorByKey.get(r[categoryKey]);
    return { [categoryKey]: r[categoryKey], occupied: withDelta(r.occupied, p?.occupied), pct: withDelta(r.pct, p?.pct) };
  });
  // Categories that existed last month but dropped to zero this month —
  // still worth showing so a "Memory Care went to zero" isn't silently
  // invisible, same reasoning current/prior null-handling follows elsewhere.
  for (const p of prior) {
    if (seen.has(p[categoryKey])) continue;
    merged.push({ [categoryKey]: p[categoryKey], occupied: withDelta(null, p.occupied), pct: withDelta(null, p.pct) });
  }
  return merged.sort((a, b) => (b.occupied.current ?? 0) - (a.occupied.current ?? 0));
}

// GET /api/account-health/community-revenue — the monthly Community
// Revenue & Occupancy Snapshot rollup (server/automation/
// communityRevenueSnapshot.js). Reads straight from
// community_revenue_snapshots rather than any cached "current state"
// table — that table already IS the history, so this just picks one
// month and diffs each row against its own prior-month row at request
// time. Defaults to the latest month with any data; `?month=YYYY-MM`
// picks a specific one. `?companyName=` scopes everything to one account
// (its own latest month, not the portfolio's) — used by the KPI/QBR
// Dashboard to show this account's own history, or hide the section
// entirely when `month` comes back null (no snapshot ever run for it).
router.get('/community-revenue', (req, res) => {
  try {
    const { companyName } = req.query;
    const availableMonths = listCommunityRevenueMonths(companyName ? { companyName } : undefined);
    if (availableMonths.length === 0) {
      return res.json({ month: null, availableMonths: [], rows: [], overdue: [] });
    }
    const month = availableMonths.includes(req.query.month) ? req.query.month : availableMonths[0];

    const rows = listCommunityRevenueSnapshots({ month, companyName }).map((r) => {
      const prior = getPriorCommunityRevenueSnapshot({ companyName: r.company_name, communityId: r.community_id, month });
      return {
        companyName: r.company_name,
        companyHost: r.company_host,
        communityId: r.community_id,
        communityName: r.community_name,
        month: r.month,
        charges: r.charges,
        credits: r.credits,
        discounts: r.discounts,
        moveIns: r.move_ins,
        moveOuts: r.move_outs,
        unitCapacity: r.unit_capacity,
        netRevenue: withDelta(r.net_revenue, prior?.net_revenue),
        totalOccupiedUnits: withDelta(r.total_occupied_units, prior?.total_occupied_units),
        occupancyUnitDays: withDelta(r.occupancy_unit_days, prior?.occupancy_unit_days),
        censusDays: withDelta(r.census_days, prior?.census_days),
        ppdUnitDays: withDelta(r.ppd_unit_days, prior?.ppd_unit_days),
        ppdCensus: withDelta(r.ppd_census, prior?.ppd_census),
        occupancyByProductType: withCategoryDelta(r.occupancy_by_product_type_json, prior?.occupancy_by_product_type_json, 'productType'),
        occupancyByClassification: withCategoryDelta(r.occupancy_by_classification_json, prior?.occupancy_by_classification_json, 'classification'),
      };
    });

    // Overdue banner is a portfolio-wide concept only — the QBR Dashboard's
    // single-company view has no use for "which OTHER accounts are behind."
    let overdue = [];
    if (!companyName) {
      const todayMonth = new Date().toISOString().slice(0, 7);
      const lastCalendarMonth = priorCalendarMonth(todayMonth);
      const latestByCompany = listCommunityRevenueLatestMonthByCompany();
      overdue = latestByCompany
        .filter((c) => c.latestMonth < lastCalendarMonth)
        .map((c) => ({
          companyName: c.companyName,
          latestMonth: c.latestMonth,
          monthsBehind: monthsDiff(c.latestMonth, lastCalendarMonth) + 1,
        }))
        .sort((a, b) => b.monthsBehind - a.monthsBehind);
    }

    res.json({ month, availableMonths, rows, overdue });
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
    const healthScoreHistory = getHealthScoreHistory('account_health', 'portfolio');
    const kpiMetricHistory = getKpiMetricHistory('account_health', 'portfolio');
    const buffer = await renderAccountHealthPortfolioPdf(accounts, rollup, healthScoreHistory, kpiMetricHistory);
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

// POST /api/account-health/:hubspotCompanyId/recurring-calls — Aaron asked
// (Sep 2026) for a way to track recurring client call cadence
// (weekly/bi-weekly/monthly) on the dashboard, and later confirmed some
// accounts genuinely have more than one (a weekly ops sync AND a separate
// monthly QBR-prep call, say) — so this creates ONE NEW call for the
// account rather than upserting a single per-company row. No calendar API
// integration exists in this app (see the recurring_calls CREATE TABLE
// comment in database.js), so this is hand-entered from the drawer rather
// than synced — cadence, day/time, next call date, and an optional pasted
// link to the actual recurring calendar event/series (works with any
// calendar provider, since it's just a stored URL, not a live API call).
router.post('/:hubspotCompanyId/recurring-calls', (req, res) => {
  try {
    const { hubspotCompanyId } = req.params;
    const account = listAccountHealthSnapshots().find((a) => a.hubspot_company_id === hubspotCompanyId);
    if (!account) return res.status(404).json({ error: 'No cached account health data for this company — try Refresh first.' });

    const { label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time } = req.body;
    const id = createRecurringCall({ hubspotCompanyId, label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[accountHealth] Recurring-call create failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/account-health/recurring-calls/:id — updates ONE existing call
// by its own id (not scoped by company — an account's calls are
// independent rows now, this only ever touches the one being edited).
router.put('/recurring-calls/:id', (req, res) => {
  try {
    const { label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time } = req.body;
    updateRecurringCall(req.params.id, { label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time });
    res.json({ ok: true });
  } catch (err) {
    console.error('[accountHealth] Recurring-call update failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/account-health/recurring-calls/:id — removes ONE call by
// its own id, leaving any other calls on the same account untouched.
router.delete('/recurring-calls/:id', (req, res) => {
  try {
    deleteRecurringCall(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[accountHealth] Recurring-call delete failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/account-health/recurring-calls/import — bulk create/update via
// the Download Template/Upload Completed Template flow, same shape as
// POST /company-hosts/import: { rows: [...] } in, { imported, skipped,
// staleIdFallbackCount } out. Create-vs-update branching (a row's own
// `id`, present or blank — and what happens when a given id doesn't
// actually match anything) lives entirely in bulkImportRecurringCalls.
router.post('/recurring-calls/import', (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty rows[] array' });
    }
    const { imported, staleIdFallbackCount } = bulkImportRecurringCalls(rows);
    res.json({ imported, skipped: rows.length - imported, staleIdFallbackCount });
  } catch (err) {
    console.error('[accountHealth] Recurring-calls bulk import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/account-health/recurring-calls/sync-from-calendar — the
// calendar-integration follow-up to the "hand-entered, not synced" comment
// on the recurring_calls table (database.js): for every call that has a
// pasted calendarLink, looks up that Google Calendar event/series' actual
// next occurrence and overwrites nextCallDate/dayOfWeek/time with it.
// label/cadence/notes/calendarLink stay exactly as Aaron entered them —
// updateRecurringCall is a full-row overwrite, not a patch, so every field
// not being refreshed here has to be read back off the existing row first.
router.post('/recurring-calls/sync-from-calendar', async (req, res) => {
  const calls = listRecurringCalls().filter((c) => c.calendar_link);
  let synced = 0;
  let unchanged = 0;
  const failures = [];

  for (const call of calls) {
    try {
      const occurrence = await getNextOccurrenceFromLink(call.calendar_link);
      if (!occurrence) {
        failures.push({ id: call.id, label: call.label, reason: 'Could not resolve this link to a Google Calendar event (deleted, not a Google link, or not accessible).' });
        continue;
      }
      updateRecurringCall(call.id, {
        label: call.label, cadence: call.cadence, calendarLink: call.calendar_link, notes: call.notes,
        nextCallDate: occurrence.nextCallDate, dayOfWeek: occurrence.dayOfWeek, time: occurrence.time,
      });
      synced += 1;
    } catch (err) {
      failures.push({ id: call.id, label: call.label, reason: err.message });
    }
  }
  unchanged = listRecurringCalls().filter((c) => !c.calendar_link).length;

  res.json({ synced, skippedNoLink: unchanged, failed: failures.length, failures });
});

// GET /api/account-health/:hubspotCompanyId/export-pdf — a single
// account's drill-down report, mirroring the dashboard's drawer.
router.get('/:hubspotCompanyId/export-pdf', async (req, res) => {
  try {
    const account = getEnrichedAccounts().find((a) => a.hubspot_company_id === req.params.hubspotCompanyId);
    if (!account) return res.status(404).json({ error: 'No cached account health data for this company — try Refresh first.' });

    const healthScoreHistory = getHealthScoreHistory('account_health', req.params.hubspotCompanyId);
    const buffer = await renderAccountHealthAccountPdf(account, healthScoreHistory);
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
