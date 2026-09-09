const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { getAllHomeOfficeCompanies, getAccountManagerName } = require('../services/hubspotAccounts');
const { getTicketSummaryForCompany, getDealSummaryForCompany, getOpenTasksForDeal, hubspotRecordUrl } = require('../services/hubspotTickets');
const { computeHealthScore, computeDsoDays, explainRisk } = require('../services/accountHealthScoring');
const {
  pruneTeamAmSnapshots, upsertTeamAmSnapshot, listTeamAmSnapshots, updateTeamAmAging,
  listAccountHealthSnapshots, createJob, setJobStatus, setItemStatus,
} = require('../db/database');
const { broadcast } = require('./broadcaster');
const { parseAgingReportPdf } = require('../services/agingReportParser');
const { matchAgingRows } = require('../services/agingReportMatcher');
const { renderTeamAmPpt } = require('../services/teamAmPpt');

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
        activeCommunityCount: company.activeCommunityCount,
        healthScore: score,
        healthBand: band?.label || null,
        tier: company.tier,
        lastActivityDate: company.lastActivityDate,
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
 * reasoning as accountHealth.js's getEnrichedAccounts. Additionally
 * cross-references account_health_snapshots (Aaron's personal dashboard's
 * table) by hubspot_company_id — READ-ONLY, never written here — to
 * opportunistically attach Total Capacity/Current Census/occupancy % for
 * whichever of these companies Aaron has already refreshed occupancy for
 * from his own dashboard. This table never calls ALIS directly (Aaron's
 * own scoping ask, Sep 2026 — a fresh per-company ALIS pull across 600+
 * Home Offices was explicitly ruled out), so most accounts will show no
 * census/capacity here, same as they do today outside Aaron's own ~94.
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
    const occupancySource = occupancyByCompanyId.get(a.hubspot_company_id);
    const dsoDays = computeDsoDays(a.aging, a.arr_cents);
    return {
      ...a,
      health_score: score,
      health_band: band?.label || null,
      subScores,
      dsoDays,
      // Only meaningful for the two lower bands — kept off Stable/Healthy
      // accounts rather than computed-and-ignored, since "no reasons" for
      // a healthy account isn't a finding worth carrying around.
      riskReasons: (band?.label === 'Unhealthy' || band?.label === 'At Risk')
        ? explainRisk({ serviceHealth: a.serviceHealth, financialHealth: a.financialHealth, aging: a.aging, dsoDays })
        : [],
      hubspotUrl: hubspotRecordUrl('company', a.hubspot_company_id),
      total_capacity: occupancySource?.total_capacity ?? null,
      current_census: occupancySource?.current_census ?? null,
      occupancy_pct: occupancySource?.occupancy_pct ?? null,
    };
  });
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
    const scored = amAccounts.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
    const dealMetrics = dealMetricsByOwner.get(accountManagerName);
    dealMetricsByOwner.delete(accountManagerName); // consumed — any left over get their own row below
    return {
      accountManagerName,
      totalAccounts: amAccounts.length,
      totalCommunities: amAccounts.reduce((s, a) => s + (a.active_community_count || 0), 0),
      openTickets: amAccounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: amAccounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      dealsThisYearOpen: dealMetrics?.dealsThisYearOpen || 0,
      dealsThisYearClosed: dealMetrics?.dealsThisYearClosed || 0,
      arrCents: amAccounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
      arrAddedThisYearCents: dealMetrics?.arrAddedThisYearCents || 0,
      totalCapacity: amAccounts.reduce((s, a) => s + (a.total_capacity || 0), 0),
      currentCensus: amAccounts.reduce((s, a) => s + (a.current_census || 0), 0),
      avgScore,
    };
  });

  // Anyone left in dealMetricsByOwner closed/is working a deal but
  // doesn't currently own any account outright (e.g. their deal's
  // account was since reassigned to a different AM) — still surfaced as
  // its own row so the ARR/deal count isn't silently dropped, just with
  // no account-level stats (they aren't an "account manager" in the
  // accounts-owned sense here, only a deal owner).
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
      arrAddedThisYearCents: dealMetrics.arrAddedThisYearCents,
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

/** Same shape as the client's `rollup` useMemo in TeamAmDashboard.jsx — duplicated rather than shared, same reasoning as computePortfolioRollup in accountHealth.js. Needed server-side only for the PPT export's Cards slide. */
function computePortfolioRollup(accounts) {
  const scored = accounts.filter((a) => a.health_score != null);
  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
  const distinctAms = new Set(accounts.map((a) => a.account_manager_name).filter((n) => n && !n.startsWith('Other AM') && n !== 'Unassigned'));
  return {
    totalAms: distinctAms.size,
    totalAccounts: accounts.length,
    totalCommunities: accounts.reduce((s, a) => s + (a.active_community_count || 0), 0),
    openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
    closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
    enhancementTopCount: accounts.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
    arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
    arrAddedThisYearCents: accounts.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
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

    const buffer = await renderTeamAmPpt(rollup, rollupByAccountManager, accounts);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="Team-AM-Dashboard.pptx"');
    res.send(buffer);
  } catch (err) {
    console.error('[teamAm] PPT export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
