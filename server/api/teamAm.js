const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const {
  getAllHomeOfficeCompanies, getAccountManagerName, getLifecycleDataQualityFlag, LIFECYCLE_FLAG_LABELS,
  shouldDropLifecycleFlaggedAccount,
} = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal, hubspotRecordUrl } = require('../services/hubspotTickets');
const { computeHealthScore, computeDsoDays, explainRisk } = require('../services/accountHealthScoring');
const { getOccupancySnapshotForAccount } = require('../services/accountHealthOccupancy');
const {
  pruneTeamAmSnapshots, upsertTeamAmSnapshot, listTeamAmSnapshots, updateTeamAmAging,
  updateTeamAmOccupancy, setTeamAmOccupancyError,
  listAccountHealthSnapshots, createJob, setJobStatus, setItemStatus,
  recordHealthScoreSnapshots, getHealthScoreHistory,
  recordKpiMetricSnapshots, getKpiMetricHistory,
} = require('../db/database');
const { broadcast } = require('./broadcaster');
const { parseAgingReportPdf } = require('../services/agingReportParser');
const { matchAgingRows } = require('../services/agingReportMatcher');
const { renderTeamAmPpt } = require('../services/teamAmPpt');
const { recordTierKpis, getTierKpiPayload } = require('../services/tierKpiRollup');

/**
 * Deliberately duplicated from accountHealth.js's function of the same
 * name rather than imported — matching this codebase's established
 * pattern (kpiNormalizer.js/wellnessNormalizer.js, the occupancy
 * fallback duplication, etc.) of mirroring small per-page logic instead
 * of sharing it across modules, so this file has zero import surface
 * onto accountHealth.js and can never be broken by a change made there
 * (or vice versa) — the whole point of the separate-table decision this
 * feature was built around. Keep these two functions' shapes in sync by
 * hand if the scoring/mapping model changes; see accountHealth.js's own
 * copy for the full reasoning behind each field.
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
    totalTickets: ticketSummary.total,
    openTicketCount: openTickets.length,
    closedTicketCount: ticketSummary.closed,
    enhancementTopCount: ticketSummary.enhancementTickets.top.length,
    // createdAt/closedAt/isOpen added here (not present in accountHealth.js's
    // copy as of this writing) — the Top 3 Enhancement Requests drawer
    // (shared between both dashboards) needs dates/status per ticket that
    // the raw ticket already carries but this map didn't forward before.
    enhancementTopItems: ticketSummary.enhancementTickets.top.map((t) => ({
      ticketId: t.id, subject: t.subject, rank: t.topThreeRank, stage: t.pipelineStageLabel, url: t.url,
      createdAt: t.createdAt || null, closedAt: t.closedAt || null, isOpen: t.isOpen ?? null,
    })),
    enhancementLesserCount: ticketSummary.enhancementTickets.lesser.length,
    otherOpenCount: ticketSummary.otherOpenTickets.length,
    // Flat per-account list for the portfolio-wide Enhancement Requests
    // section (EnhancementRequestsSection.jsx, shared with accountHealth.js)
    // — broader than enhancementTopItems above (see hubspotTickets.js's
    // isEnhancementRequest), open tickets only.
    enhancementRequests: ticketSummary.enhancementRequests.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url,
      createdAt: t.createdAt, daysOpen: t.daysOpen,
      nextStep: t.nextStep, isTopThree: t.isTopThree,
    })),
    // Closed enhancement requests (Sep 2026) — mirrors accountHealth.js's
    // own copy; feeds EnhancementRequestsSection.jsx's new Opened vs. Closed
    // trend chart on this dashboard too (same shared component). isTopThree
    // rides along so the Top-3-only view can filter closed items the same
    // way it filters open ones.
    enhancementClosedItems: ticketSummary.closedEnhancementRequests.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url,
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
      ticketId: t.id, subject: t.subject, url: t.url,
      createdAt: t.createdAt, daysOpen: t.daysOpen, stage: t.pipelineStageLabel,
    })),
    // Open "Escalation" tickets (Sep 2026) — category_2_0 === "ALIS
    // Escalation" (see hubspotTickets.js's isEscalation). Mirrors
    // accountHealth.js's own copy of this exact field — same per-file
    // duplication convention this function already follows everywhere
    // else. Named alisEscalation* deliberately, not escalationCount — see
    // accountHealth.js's comment for why that name is already taken by an
    // unrelated, currently-unpopulated Jira-ESC bridge-schema concept.
    alisEscalationOpenCount: ticketSummary.escalationTickets.length,
    alisEscalationOpenItems: ticketSummary.escalationTickets.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url,
      createdAt: t.createdAt, daysOpen: t.daysOpen, nextStep: t.nextStep,
    })),
    // Closed escalations (Sep 2026) — mirrors accountHealth.js's own copy;
    // feeds EscalationRequestsSection.jsx's "Closed — Trailing 12 Months"
    // heatmap on this dashboard too (same shared component).
    alisEscalationClosedCount: ticketSummary.closedEscalationTickets.length,
    alisEscalationClosedItems: ticketSummary.closedEscalationTickets.map((t) => ({
      ticketId: t.id, subject: t.subject, url: t.url,
      createdAt: t.createdAt, closedAt: t.closedAt,
    })),
    // Slim per-ticket date list (Sep 2026) for this dashboard's own Ticket
    // Activity heatmap/Open Ticket Volume chart — mirrors accountHealth.js's
    // identical field exactly (see that file's doc comment for the full
    // reasoning). tier isn't riding along here since TicketActivitySection
    // tags each ticket with its own account's tier client-side, the same
    // way this file's other by-tier charts already do.
    ticketDates: ticketSummary.tickets.map((t) => ({
      createdAt: t.createdAt || null,
      closedAt: t.closedAt || null,
      pipelineStageLabel: t.pipelineStageLabel || null,
      isEnhancementRequest: t.category === 'Enhancement' || /enhancement/i.test(t.subject || ''),
    })),
  };
}

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
    totalDeals: dealSummary.total,
    dealsByType: dealSummary.deals.reduce((acc, d) => {
      const key = d.dealType || 'unspecified';
      if (!acc[key]) acc[key] = { count: 0, valueCents: 0 };
      acc[key].count += 1;
      acc[key].valueCents += Math.round((d.arrValue || 0) * 100);
      return acc;
    }, {}),
    arrAddedThisYearCents: arrAddedThisYearDeals.reduce((sum, d) => sum + d.arrValueCents, 0),
    arrAddedThisYearDeals: arrAddedThisYearDeals.map((d) => ({
      name: d.name, arrValueCents: d.arrValueCents, closeDate: d.closeDate,
      pipeline: d.pipeline, stage: d.stage, url: d.url, dealOwnerName: d.dealOwnerName,
    })),
    // "2026 deals" KPI (Aaron) — every deal (won or lost) with a
    // closedate in the current calendar year, tagged with its own Deal
    // Owner and open/closed status so computeRollupByAccountManager can
    // attribute it to whoever actually closed/is working the deal, not
    // to whoever currently owns the account (Aaron, Sep 2026: "deals
    // they closed personally instead of deals that may have been added
    // to portfolio but were not added by them personally"). Sourced from
    // dealSummary.deals — the account's full deal history, already
    // fetched, no extra HubSpot calls — rather than the 90-day-bounded
    // dealsForView/closedDeals set, so a deal closed back in February
    // isn't silently missed by September.
    dealsThisYear: dealSummary.deals
      .filter((d) => d.closeDate && new Date(d.closeDate).getFullYear() === currentYear)
      .map((d) => ({ isOpen: !d.isClosed, dealOwnerName: getAccountManagerName(d.dealOwnerId) })),
    // Onboarding/implementation tracking (Sep 2026) — same reasoning as
    // AccountHealthDashboard's identical field: every deal with a
    // projectStatus, open OR closed (a HubSpot deal usually closes sales-
    // wise long before its onboarding project actually finishes), one
    // Home Office can have several at once (one per community/batch).
    implementationProjects: dealSummary.deals
      .filter((d) => d.projectStatus)
      .map((d) => ({
        dealId: d.id, name: d.name, projectStatus: d.projectStatus, projectHealthRag: d.projectHealthRag,
        projectProgress: d.projectProgress, projectOwner: d.projectOwner, projectedGoLiveDate: d.projectedGoLiveDate,
        createdAt: d.createdAt, url: d.url,
      })),
  };
}

/** Same as accountHealth.js's helper of the same name — see that file for the rate-limit history behind concurrency 3. */
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

/**
 * Runs the portal-wide refresh in the background — every Home Office
 * across every Account Manager (611 confirmed live, Sep 2026 — several
 * times the ~94 Aaron's own personal dashboard covers), so this needs
 * real progress feedback the same way the occupancy refresh job does
 * (see accountHealth.js's runOccupancyRefreshJob) rather than a bare
 * synchronous request that could sit unresponsive for minutes.
 */
async function runTeamAmRefreshJob(jobId, companies) {
  const emit = (event, data) => broadcast(jobId, event, data);
  setJobStatus(jobId, 'running');

  const errors = [];
  await mapWithConcurrency(companies, 3, async (company) => {
    setItemStatus(jobId, company.name, 'running');
    emit('item_start', { name: company.name });
    try {
      const [ticketSummary, dealSummary] = await Promise.all([
        getTicketSummaryForCompany(company.id),
        getDealSummaryForCompany(company.id),
      ]);
      const serviceHealth = mapLiveServiceHealth(ticketSummary);
      const financialHealth = await mapLiveFinancialHealth(dealSummary);
      const { score, band } = computeHealthScore({ serviceHealth, financialHealth, arrCents: company.arrCents });

      upsertTeamAmSnapshot({
        hubspotCompanyId: company.id,
        companyName: company.name,
        accountManagerId: company.accountManagerId,
        accountManagerName: company.accountManagerName,
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
        alisEscalationOpenCount: serviceHealth.alisEscalationOpenCount,
        activeCommunityCount: company.activeCommunityCount,
        healthScore: score,
        healthBand: band?.label || null,
        tier: company.tier,
        lastActivityDate: company.lastActivityDate,
        hubspotCapacity: company.hubspotCapacity,
      });
      setItemStatus(jobId, company.name, 'success');
      emit('item_done', { name: company.name });
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
      setItemStatus(jobId, company.name, 'failed', err.message);
      emit('item_fail', { name: company.name, error: err.message });
    }
  });

  pruneTeamAmSnapshots(companies.map((c) => c.id));

  // Avg Health Score trend point for today — same reasoning/shape as
  // accountHealth.js's identical capture in its own /refresh handler (see
  // health_score_history's doc comment in database.js). Reads through
  // getEnrichedTeamAmAccounts (not the raw stored health_score column)
  // since that's what GET '/' — and so the on-screen "Avg Health Score"
  // KPI tile — actually shows: it recomputes the score live including
  // aging, which the raw column written by upsertTeamAmSnapshot above does
  // not. Capturing anything else would let this trend quietly drift from
  // the number it's supposed to be tracking.
  const freshAccounts = getEnrichedTeamAmAccounts();
  const cleanAccounts = freshAccounts.filter((a) => !a.lifecycle_flag);
  const scoredAccounts = cleanAccounts.filter((a) => a.health_score != null);
  if (scoredAccounts.length > 0) {
    const avgScore = Math.round(scoredAccounts.reduce((s, a) => s + a.health_score, 0) / scoredAccounts.length);
    recordHealthScoreSnapshots('team_am', [
      { scopeKey: 'portfolio', scopeLabel: 'Portfolio (All Accounts)', avgHealthScore: avgScore, accountCount: scoredAccounts.length },
      ...scoredAccounts.map((a) => ({ scopeKey: a.hubspot_company_id, scopeLabel: a.company_name, avgHealthScore: a.health_score, accountCount: 1 })),
    ]);
    recordKpiMetricSnapshots('team_am', [{ scopeKey: 'portfolio', metricKey: 'avgScore', value: avgScore }]);
  }

  // "KPI by AM" dropdown's trend chart (Aaron, Sep 2026: "wire up the KPI
  // by AM reports... with the tracking and trending treatment") — same
  // portfolio-wide, one-point-per-metric-per-day capture as
  // accountHealth.js's identical block, just against this file's own
  // team-wide `cleanAccounts` (every Home Office, not just owned ones) so
  // the trend never drifts from what KpiByAmChart shows today. Trended
  // per portfolio total here, not per-AM — same "answers how the team
  // overall is moving" scope as HealthScoreTrendSection already has.
  // dealsThisYear/arrAddedThisYearDeals aren't flat columns on `a` the way
  // ticket/capacity counts are (computeDealMetricsByOwner reads them off
  // financialHealth per-account), so they're summed directly here instead
  // of via the plain `sum(field)` helper.
  const sum = (field) => cleanAccounts.reduce((s, a) => s + (a[field] || 0), 0);
  let dealsThisYearOpen = 0;
  let dealsThisYearClosed = 0;
  let arrAddedThisYearCents = 0;
  for (const a of cleanAccounts) {
    for (const d of a.financialHealth?.dealsThisYear || []) {
      if (d.isOpen) dealsThisYearOpen += 1;
      else dealsThisYearClosed += 1;
    }
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      arrAddedThisYearCents += d.arrValueCents;
    }
  }
  recordKpiMetricSnapshots('team_am', [
    { scopeKey: 'portfolio', metricKey: 'totalAccounts', value: cleanAccounts.length },
    { scopeKey: 'portfolio', metricKey: 'totalCommunities', value: sum('active_community_count') },
    { scopeKey: 'portfolio', metricKey: 'openTickets', value: sum('open_ticket_count') },
    { scopeKey: 'portfolio', metricKey: 'closedTickets', value: sum('closed_ticket_count') },
    { scopeKey: 'portfolio', metricKey: 'dealsThisYearOpen', value: dealsThisYearOpen },
    { scopeKey: 'portfolio', metricKey: 'dealsThisYearClosed', value: dealsThisYearClosed },
    { scopeKey: 'portfolio', metricKey: 'arrAddedThisYearCents', value: arrAddedThisYearCents },
    { scopeKey: 'portfolio', metricKey: 'arrCents', value: sum('arr_cents') },
    { scopeKey: 'portfolio', metricKey: 'totalCapacity', value: sum('total_capacity') },
    { scopeKey: 'portfolio', metricKey: 'currentCensus', value: sum('current_census') },
    // Backs the "Deals by Type" chart's trend line (Aaron, Sep 2026: "add
    // the tracking and trending feature" to that section) — same overall-
    // total-not-per-type reasoning as accountHealth.js's identical capture.
    {
      scopeKey: 'portfolio',
      metricKey: 'dealsByTypeTotalArr',
      value: cleanAccounts.reduce((s, a) => s + Object.values(a.financialHealth?.dealsByType || {}).reduce((s2, t) => s2 + (t.valueCents || 0), 0), 0),
    },
  ]);

  // "ARR by Tier" trend subsection (Sep 2026, Aaron: "tracking and
  // trending" on that section too) — a separate recordKpiMetricSnapshots
  // call using Client Tier names as scope_key instead of 'portfolio' —
  // additive use of the same kpi_metric_history table, no schema change.
  // Only the two ARR metrics per Aaron's ask (Team AM doesn't need the
  // ticket/cost-to-serve tier trends accountHealth.js's own refresh handler
  // also captures). Grouping/label reimplemented here to exactly match this
  // page's own tierLabel() (TeamAmDashboard.jsx) — unset/0 tiers labeled
  // 'Unassigned', NOT 'Unset' (accountHealth.js's own convention) — so
  // these trend keys line up with what the chart above them shows today;
  // getting this string wrong would silently produce an empty trend rather
  // than an error.
  const tierBuckets = {};
  for (const a of cleanAccounts) {
    const key = (a.tier == null || a.tier === 0) ? 'Unassigned' : `Tier ${a.tier}`;
    (tierBuckets[key] ||= []).push(a);
  }
  const tierRows = [];
  for (const [tierName, list] of Object.entries(tierBuckets)) {
    tierRows.push(
      { scopeKey: tierName, metricKey: 'arrCents', value: list.reduce((s, a) => s + (a.arr_cents || 0), 0) },
      { scopeKey: tierName, metricKey: 'arrAddedThisYearCents', value: list.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0) },
    );
  }
  recordKpiMetricSnapshots('team_am', tierRows);
  recordTierKpis('team_am', freshAccounts, { includeAm: true });

  setJobStatus(jobId, 'done');
  emit('job_done', {
    refreshedAt: new Date().toISOString(),
    companyCount: companies.length,
    errorCount: errors.length,
    errors,
  });
}

// POST /api/team-am/refresh — job-tracked (see runTeamAmRefreshJob) portal-
// wide pull, every Home Office regardless of Account Manager. Responds
// immediately with the job id; client follows progress via
// GET /api/stream/:id, same plumbing accountHealth.js's occupancy refresh
// already uses.
router.post('/refresh', async (req, res) => {
  try {
    const { companies, excludedInactiveCommunities } = await getAllHomeOfficeCompanies();
    const id = uuidv4();
    createJob({
      id,
      type: 'team-am-refresh',
      label: 'Team AM Dashboard — Refresh',
      payload: {},
      total: companies.length,
      items: companies.map((c) => ({ name: c.name })),
    });

    runTeamAmRefreshJob(id, companies).catch((err) => {
      console.error(`[team-am-refresh:${id}] Unhandled error:`, err);
      setJobStatus(id, 'failed', err.message);
      broadcast(id, 'job_error', { error: err.message });
    });

    res.status(202).json({ id, total: companies.length, excludedInactiveCommunities });
  } catch (err) {
    console.error('[teamAm] Refresh failed to start:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * This dashboard's own occupancy pull (Sep 2026) — previously Team AM only
 * ever showed census/capacity opportunistically cross-referenced from
 * account_health_snapshots (Aaron's personal dashboard's own refresh), per
 * his original scoping worry about hitting ALIS for 600+ Home Offices at
 * once. That worry turned out to be smaller than feared: the ALIS pull is
 * per-subdomain HOST, not per-community, and only a fraction of this
 * portfolio has a mapped subdomain at all (company_hosts is a single
 * global table, same one Account Health Dashboard's mapping UI already
 * writes to) — so this job's real work scales with mapped-host count, not
 * with the 500+ company count, same as the personal dashboard's own job.
 * Mirrors accountHealth.js's runOccupancyRefreshJob exactly (same
 * concurrency, same getOccupancySnapshotForAccount call, unchanged), just
 * writing into team_am_snapshots via updateTeamAmOccupancy/
 * setTeamAmOccupancyError instead of the account-health equivalents.
 */
async function runTeamAmOccupancyRefreshJob(jobId, accounts) {
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
      updateTeamAmOccupancy(a.hubspot_company_id, occupancy);
      updated += 1;
      setItemStatus(jobId, a.company_name, 'success');
      emit('item_done', { name: a.company_name, skipped: false });
    } catch (err) {
      errors.push({ company: a.company_name, error: err.message });
      setItemStatus(jobId, a.company_name, 'failed', err.message);
      setTeamAmOccupancyError(a.hubspot_company_id, err.message);
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

// POST /api/team-am/refresh-occupancy — same job-tracked pattern as
// accountHealth.js's /refresh-occupancy, scoped to every company already
// cached in team_am_snapshots (i.e. run /refresh at least once first).
router.post('/refresh-occupancy', (req, res) => {
  try {
    const accounts = listTeamAmSnapshots();
    const id = uuidv4();
    createJob({
      id,
      type: 'team-am-occupancy',
      label: 'Team AM Dashboard — Occupancy Refresh',
      payload: {},
      total: accounts.length,
      items: accounts.map((a) => ({ name: a.company_name })),
    });

    runTeamAmOccupancyRefreshJob(id, accounts).catch((err) => {
      console.error(`[team-am-occupancy:${id}] Unhandled error:`, err);
      setJobStatus(id, 'failed', err.message);
      broadcast(id, 'job_error', { error: err.message });
    });

    res.status(202).json({ id, total: accounts.length });
  } catch (err) {
    console.error('[teamAm] Occupancy refresh failed to start:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Same reasoning/aggregation as accountHealth.js's aggregateAgingByAccount — several aging rows commonly roll up to the same Home Office. */
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

// POST /api/team-am/import-aging-report — same manual-PDF-upload flow as
// accountHealth.js's route, matched against THIS table's (much larger)
// company list instead — a company only needs to be uploaded once per
// dashboard it should appear on, since the two tables are independent.
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

    const accounts = listTeamAmSnapshots();
    const { matched, unmatched } = matchAgingRows(rows, accounts);
    const aggregated = aggregateAgingByAccount(matched, asOfDate);
    for (const [hubspotCompanyId, aging] of aggregated) {
      updateTeamAmAging(hubspotCompanyId, aging);
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
    console.error('[teamAm] Aging report import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Score/subScores recomputed on every read from whatever's cached, same
 * reasoning as accountHealth.js's getEnrichedAccounts. This table now runs
 * its OWN ALIS occupancy pull (see runTeamAmOccupancyRefreshJob/
 * POST /refresh-occupancy above, Sep 2026) — Aaron's original scoping
 * worry (a fresh per-company ALIS pull across 600+ Home Offices) turned
 * out to be smaller than feared, since the pull is per mapped subdomain
 * HOST, not per company or per community, and only a fraction of the
 * portfolio has one mapped at all. Additionally still cross-references
 * account_health_snapshots (Aaron's personal dashboard's table) by
 * hubspot_company_id — READ-ONLY, never written here — as a FALLBACK for
 * whichever accounts Team AM hasn't pulled occupancy for yet itself, so an
 * account Aaron already refreshed personally shows data immediately.
 * Most accounts will still show no census/capacity until subdomain mapping
 * coverage broadens beyond the ~98 of 514 mapped today — a data-coverage
 * gap, not a scoping one anymore.
 */
function getEnrichedTeamAmAccounts() {
  const accounts = listTeamAmSnapshots();
  const occupancyByCompanyId = new Map(
    listAccountHealthSnapshots().map((a) => [a.hubspot_company_id, a])
  );
  return accounts.map((a) => {
    const { score, band, subScores } = computeHealthScore({
      serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, arrCents: a.arr_cents,
    });
    // This table now runs its own ALIS occupancy pull (runTeamAmOccupancyRefreshJob
    // above) — its own occupancy_as_of_date wins when present. Falls back to
    // the account_health_snapshots cross-reference only when Team AM hasn't
    // pulled occupancy for this account yet, so an account Aaron already
    // refreshed from his own personal dashboard still shows data immediately
    // rather than waiting on a full Team AM-wide occupancy run.
    const crossRef = occupancyByCompanyId.get(a.hubspot_company_id);
    const hasOwnOccupancy = a.occupancy_as_of_date != null;
    const dsoDays = computeDsoDays(a.aging, a.arr_cents);
    const lifecycleFlag = getLifecycleDataQualityFlag(a.lifecycle_stage);
    // A Lead/Canceled Home Office that still owes money is the one case
    // shouldDropLifecycleFlaggedAccount keeps around (see its doc comment)
    // — called out in the badge label so it's obvious WHY a "Canceled"
    // account is still sitting in this table instead of just saying
    // "Canceled" and looking like a filtering bug.
    const keptForAgingBalance = (lifecycleFlag === 'lead' || lifecycleFlag === 'canceled') && (a.aging_total_cents || 0) > 0;
    return {
      ...a,
      health_score: score,
      health_band: band?.label || null,
      subScores,
      dsoDays,
      // Sep 2026 (Aaron): this Home Office's OWN lifecycle stage isn't
      // "Client - Home Office" — see getLifecycleDataQualityFlag's doc
      // comment. A pure Lead/Canceled record is dropped from this list
      // entirely below (see the .filter after this .map) unless it still
      // carries an aging balance; every other flagged category (Client -
      // Community, no stage set) stays fully visible/searchable in the
      // Accounts table. computeRollupByAccountManager and this page's own
      // client-side rollup exclude every flagged account from ARR/health/
      // ticket SUMS regardless, so a stray non-client record can't skew
      // "the real" portfolio numbers.
      lifecycle_flag: lifecycleFlag,
      lifecycle_flag_label: lifecycleFlag
        ? (keptForAgingBalance ? `${LIFECYCLE_FLAG_LABELS[lifecycleFlag]} — kept, owes a balance` : LIFECYCLE_FLAG_LABELS[lifecycleFlag])
        : null,
      // Only meaningful for the two lower bands — kept off Stable/Healthy
      // accounts rather than computed-and-ignored, since "no reasons" for
      // a healthy account isn't a finding worth carrying around.
      riskReasons: (band?.label === 'Unhealthy' || band?.label === 'At Risk')
        ? explainRisk({ serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, dsoDays, arrCents: a.arr_cents })
        : [],
      hubspotUrl: hubspotRecordUrl('company', a.hubspot_company_id),
      total_capacity: hasOwnOccupancy ? a.total_capacity : (crossRef?.total_capacity ?? null),
      current_census: hasOwnOccupancy ? a.current_census : (crossRef?.current_census ?? null),
      occupancy_pct: hasOwnOccupancy ? a.occupancy_pct : (crossRef?.occupancy_pct ?? null),
      occupancy_as_of_date: hasOwnOccupancy ? a.occupancy_as_of_date : (crossRef?.occupancy_as_of_date ?? null),
      // HubSpot's own "Total Beds on ALIS" property — a genuinely different,
      // always-free number (no ALIS call involved), never blended with the
      // ALIS-pull-derived total_capacity above.
      hubspot_capacity: a.hubspot_capacity ?? null,
    };
  }).filter((a) => !shouldDropLifecycleFlaggedAccount(a.lifecycle_flag, a.aging_total_cents));
}

/** One rollup bucket per Account Manager — reuses the exact same summable-fields shape accountHealth.js's computePortfolioRollup already established, just grouped first. */
/**
 * Deal-level metrics (2026 Open/Closed Deals, ARR Added) are attributed
 * to the deal's own HubSpot Deal Owner, not to whoever currently owns
 * the account — a deal an AM personally closed should count for them
 * even if the account was later reassigned to someone else, and an
 * account's current AM shouldn't get credit for a deal they didn't
 * touch (Aaron, Sep 2026). Built as one flat pass over every account's
 * raw per-deal data (financialHealth.dealsThisYear / .arrAddedThisYearDeals,
 * both tagged with dealOwnerName in mapLiveFinancialHealth above) rather
 * than the byAm account grouping below, since a deal's owner and its
 * account's owner are independent properties.
 */
function computeDealMetricsByOwner(accounts) {
  const byOwner = new Map();
  function bucket(ownerName) {
    const key = ownerName || 'Unassigned';
    if (!byOwner.has(key)) byOwner.set(key, { dealsThisYearOpen: 0, dealsThisYearClosed: 0, arrAddedThisYearCents: 0 });
    return byOwner.get(key);
  }
  for (const a of accounts) {
    const fin = a.financialHealth;
    for (const d of fin?.dealsThisYear || []) {
      const b = bucket(d.dealOwnerName);
      if (d.isOpen) b.dealsThisYearOpen += 1;
      else b.dealsThisYearClosed += 1;
    }
    for (const d of fin?.arrAddedThisYearDeals || []) {
      bucket(d.dealOwnerName).arrAddedThisYearCents += d.arrValueCents;
    }
  }
  return byOwner;
}

function computeRollupByAccountManager(accounts) {
  const byAm = new Map();
  for (const a of accounts) {
    const key = a.account_manager_name || 'Unassigned';
    if (!byAm.has(key)) byAm.set(key, []);
    byAm.get(key).push(a);
  }

  const dealMetricsByOwner = computeDealMetricsByOwner(accounts);

  const rows = Array.from(byAm.entries()).map(([accountManagerName, amAccounts]) => {
    // lifecycle_flag'd accounts (Lead/Canceled/wrong-stage/no-stage Home
    // Offices — see getLifecycleDataQualityFlag) stay counted in
    // totalAccounts (still fully visible on the Accounts table below) but
    // are excluded from every $/score/ticket SUM here, so a stray $0-ARR
    // non-client record can't drag down an AM's avg health score or ARR
    // total (Aaron, Sep 2026).
    const clean = amAccounts.filter((a) => !a.lifecycle_flag);
    const scored = clean.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
    const dealMetrics = dealMetricsByOwner.get(accountManagerName);
    dealMetricsByOwner.delete(accountManagerName); // consumed — any left over get their own row below
    return {
      accountManagerName,
      totalAccounts: amAccounts.length,
      flaggedAccountCount: amAccounts.length - clean.length,
      totalCommunities: clean.reduce((s, a) => s + (a.active_community_count || 0), 0),
      openTickets: clean.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: clean.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      dealsThisYearOpen: dealMetrics?.dealsThisYearOpen || 0,
      dealsThisYearClosed: dealMetrics?.dealsThisYearClosed || 0,
      arrCents: clean.reduce((s, a) => s + (a.arr_cents || 0), 0),
      // Two different questions, both worth asking separately (Sep 2026,
      // Aaron): "Added to Book" sums each of THIS AM's currently-owned
      // accounts' own arr_added_this_year_cents — a workload signal, since
      // ARR added to your book counts whether you personally touched the
      // deal or inherited it (a handoff, a manager assist, a house
      // account). "Personally Closed" instead comes from
      // dealMetricsByOwner above, grouped by the deal's own HubSpot Deal
      // Owner — a productivity/growth signal, since it only credits deals
      // this AM actually closed, on any account. These two used to be
      // conflated under one "ARR Added This Year" field sourced from
      // dealMetrics alone, which silently disagreed with the Accounts
      // tab's own per-account sums (an external audit caught this, Sep
      // 2026) for every AM who'd ever had a deal closed on their behalf,
      // or closed a deal on someone else's account.
      arrAddedToBookCents: clean.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      arrPersonallyClosedCents: dealMetrics?.arrAddedThisYearCents || 0,
      totalCapacity: clean.reduce((s, a) => s + (a.total_capacity || 0), 0),
      currentCensus: clean.reduce((s, a) => s + (a.current_census || 0), 0),
      avgScore,
    };
  });

  // Anyone left in dealMetricsByOwner closed/is working a deal but
  // doesn't currently own any account outright (e.g. their deal's
  // account was since reassigned to a different AM) — still surfaced as
  // its own row so the ARR/deal count isn't silently dropped, just with
  // no account-level stats (they aren't an "account manager" in the
  // accounts-owned sense here, only a deal owner). arrAddedToBookCents is
  // always 0 here — by definition they own no accounts to add book ARR to.
  for (const [accountManagerName, dealMetrics] of dealMetricsByOwner.entries()) {
    rows.push({
      accountManagerName,
      totalAccounts: 0,
      totalCommunities: 0,
      openTickets: 0,
      closedTickets: 0,
      dealsThisYearOpen: dealMetrics.dealsThisYearOpen,
      dealsThisYearClosed: dealMetrics.dealsThisYearClosed,
      arrCents: 0,
      arrAddedToBookCents: 0,
      arrPersonallyClosedCents: dealMetrics.arrAddedThisYearCents,
      totalCapacity: 0,
      currentCensus: 0,
      avgScore: null,
    });
  }

  return rows.sort((a, b) => b.totalAccounts - a.totalAccounts);
}

// GET /api/team-am — the cached portal-wide portfolio, instant read, plus
// a per-AM rollup array for the KPI-by-AM chart.
router.get('/', (req, res) => {
  try {
    const accounts = getEnrichedTeamAmAccounts();
    res.json({ accounts, rollupByAccountManager: computeRollupByAccountManager(accounts) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/team-am/health-score-history — portfolio-wide Avg Health
// Score trend, one point per day a portal-wide refresh has run — see
// accountHealth.js's identical route for the "brand-new metric, short
// history is expected" framing.
router.get('/health-score-history', (req, res) => {
  try {
    res.json({ history: getHealthScoreHistory('team_am', 'portfolio') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/team-am/kpi-metric-history — portfolio-wide trend for every KPI
// by AM dropdown metric at once (keyed by metric_key), one point per day a
// /refresh has run — see kpi_metric_history's own doc comment in
// database.js. A brand-new metric as of Sep 2026, so a short/empty array
// per key is expected at first, not an error.
router.get('/kpi-metric-history', (req, res) => {
  try {
    res.json({ history: getKpiMetricHistory('team_am', 'portfolio') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/team-am/kpi-metric-history-by-tier — same idea as
// kpi-metric-history just above, but keyed by Client Tier (scope_key) for
// the "ARR by Tier" trend subsection (Sep 2026, Aaron: "tracking and
// trending" on that section too) — see the tier-grouped
// recordKpiMetricSnapshots call in the refresh handler above for what
// populates each tier's rows. Last key is 'Unassigned', not 'Unset' —
// this page's own tierLabel() convention, different from accountHealth.js's.
// GET /api/team-am/tier-kpis — "Tier KPIs" + "Tier KPIs by AM" sections:
// current rollup plus daily history (recorded on each /refresh).
router.get('/tier-kpis', (req, res) => {
  try {
    res.json(getTierKpiPayload('team_am', getEnrichedTeamAmAccounts(), { includeAm: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/kpi-metric-history-by-tier', (req, res) => {
  try {
    res.json({
      history: {
        'Tier 1': getKpiMetricHistory('team_am', 'Tier 1'),
        'Tier 2': getKpiMetricHistory('team_am', 'Tier 2'),
        'Tier 3': getKpiMetricHistory('team_am', 'Tier 3'),
        'Tier 4': getKpiMetricHistory('team_am', 'Tier 4'),
        Unassigned: getKpiMetricHistory('team_am', 'Unassigned'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Same shape as the client's `rollup` useMemo in TeamAmDashboard.jsx — duplicated rather than shared, same reasoning as computePortfolioRollup in accountHealth.js. Needed server-side only for the PPT export's Cards slide. */
function computePortfolioRollup(accounts) {
  // Same lifecycle_flag exclusion as computeRollupByAccountManager above —
  // totalAccounts/totalAms still count everyone (nothing hidden), every
  // other sum is "clean" accounts only.
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const scored = clean.filter((a) => a.health_score != null);
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
  const distinctAms = new Set(accounts.map((a) => a.account_manager_name).filter((n) => n && !n.startsWith('Other AM') && n !== 'Unassigned'));
  return {
    totalAms: distinctAms.size,
    totalAccounts: accounts.length,
    flaggedAccountCount: accounts.length - clean.length,
    totalCommunities: clean.reduce((s, a) => s + (a.active_community_count || 0), 0),
    openTickets: clean.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
    closedTickets: clean.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
    enhancementTopCount: clean.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
    arrCents: clean.reduce((s, a) => s + (a.arr_cents || 0), 0),
    arrAddedThisYearCents: clean.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
    avgScore,
  };
}

// GET /api/team-am/export-ppt — a bar AND a pie slide for every metric
// the on-screen KPI-by-Account-Manager dropdown offers (Aaron, Sep
// 2026: "let's do a KPI per slide... both bar graphs and pie charts"),
// not just whichever one happens to be selected on screen. Census/
// capacity deliberately excluded from both the Cards slide and the KPI
// metric set — same scoping as the rest of this dashboard.
router.get('/export-ppt', async (req, res) => {
  try {
    const accounts = getEnrichedTeamAmAccounts();
    const rollupByAccountManager = computeRollupByAccountManager(accounts);
    const rollup = computePortfolioRollup(accounts);
    const healthScoreHistory = getHealthScoreHistory('team_am', 'portfolio');
    const kpiMetricHistory = getKpiMetricHistory('team_am', 'portfolio');

    const buffer = await renderTeamAmPpt(rollup, rollupByAccountManager, accounts, healthScoreHistory, kpiMetricHistory);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="Team-AM-Dashboard.pptx"');
    res.send(buffer);
  } catch (err) {
    console.error('[teamAm] PPT export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
