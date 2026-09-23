/**
 * Excel export for the Team AM Dashboard — built entirely client-side
 * (accounts/rollups are already loaded in memory), same ExcelJS +
 * Blob-download pattern as accountHealthExport.js. Duplicated helpers
 * rather than shared, matching this codebase's established per-file
 * small-helper-duplication convention.
 */
import ExcelJS from 'exceljs';

function usd(cents) {
  return cents == null ? '' : Number((cents / 100).toFixed(2));
}

function download(workbook, filename) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}

const TERMINAL_PROJECT_STATUSES = new Set(['Completed', 'Cancelled', 'Merged']);
function isOpenProject(p) {
  return !TERMINAL_PROJECT_STATUSES.has(p.projectStatus);
}

/**
 * One row per client_tier (1-4 + Unassigned), same "clean" (non-lifecycle-
 * flagged) scoping as the on-screen rollup — Aaron's core "what does each
 * tier actually need vs. what are we spending on it" question: account/AM
 * coverage, ticket load, ARR, and capacity/census side by side per tier.
 */
function buildTierRows(accounts) {
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const byTier = new Map();
  for (const a of clean) {
    const key = tierLabel(a.tier);
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(a);
  }
  const order = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Unassigned'];
  return order
    .filter((key) => byTier.has(key))
    .map((key) => {
      const rows = byTier.get(key);
      const scored = rows.filter((a) => a.health_score != null);
      const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
      const distinctAms = new Set(rows.map((a) => a.account_manager_name).filter((n) => n && n !== 'Unassigned' && !n.startsWith('Other AM')));
      const occupancyEligible = rows.filter((a) => a.total_capacity != null);
      return {
        tier: key,
        accountCount: rows.length,
        amCount: distinctAms.size,
        totalCommunities: rows.reduce((s, a) => s + (a.active_community_count || 0), 0),
        avgHealthScore: avgScore,
        openTickets: rows.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
        closedTickets: rows.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
        escalationOpen: rows.reduce((s, a) => s + (a.alis_escalation_open_count || 0), 0),
        enhancementTop: rows.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
        enhancementLesser: rows.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
        otherOpenTickets: rows.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
        arrCents: rows.reduce((s, a) => s + (a.arr_cents || 0), 0),
        arrAddedThisYearCents: rows.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
        totalCapacity: occupancyEligible.reduce((s, a) => s + a.total_capacity, 0),
        currentCensus: occupancyEligible.reduce((s, a) => s + (a.current_census || 0), 0),
      };
    });
}

function flattenImplementationProjects(accounts) {
  return accounts.flatMap((a) => (a.financialHealth?.implementationProjects || []).map((p) => ({
    ...p, tier: a.tier, companyName: a.company_name, accountManagerName: a.account_manager_name, companyHubspotUrl: a.hubspotUrl,
  })));
}

/**
 * Portfolio-wide Team AM workbook (Sep 2026, Aaron) — meant to travel
 * outside this app (e.g. into a separate analysis conversation), so every
 * sheet is a flat, self-describing table rather than anything tied to this
 * dashboard's own UI shape: portfolio KPIs, the AM-level rollup (the core
 * "departmental accountability" view), a tier-level rollup (what each of
 * the 4 tiers actually looks like today), the full account list, and every
 * tracked onboarding/implementation project.
 */
export async function exportTeamAmPortfolioExcel(accounts, rollup, rollupByAccountManager) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [{ header: 'Metric', key: 'metric', width: 34 }, { header: 'Value', key: 'value', width: 24 }];
  summarySheet.getRow(1).font = { bold: true };
  const summaryRows = [
    ['Total Account Managers', rollup.totalAms],
    ['Total Accounts', rollup.totalAccounts],
    ['Flagged Accounts (excluded from sums below)', rollup.flaggedAccountCount],
    ['Total Communities (active child companies)', rollup.totalCommunities],
    ['Open Tickets (Client Submitted + In Progress, excl. enhancement requests)', rollup.openTickets],
    ['Closed Tickets', rollup.closedTickets],
    ['Open Escalation Tickets', rollup.escalationCount],
    ['Enhancement Requests — Top 3', rollup.enhancementTop],
    ['Enhancement Requests — Long-Term', rollup.enhancementLesser],
    ['Other Open Tickets', rollup.otherOpen],
    ['Avg Health Score', rollup.avgScore ?? ''],
    ['Total ARR', usd(rollup.arrCents)],
    ['ARR Added This Year', usd(rollup.arrAddedThisYearCents)],
    ['HubSpot-Reported Capacity ("Total Beds on ALIS")', rollup.hubspotCapacity],
    [`Total Capacity (ALIS occupancy pull${rollup.occupancyAsOfDate ? `, as of ${rollup.occupancyAsOfDate}` : ''})`, rollup.occupancyAccountCount > 0 ? rollup.totalCapacity : ''],
    ['Current Census', rollup.occupancyAccountCount > 0 ? rollup.currentCensus : ''],
    ['Occupancy %', rollup.occupancyPct != null ? `${(rollup.occupancyPct * 100).toFixed(1)}%` : ''],
    ['Last HubSpot Refresh', rollup.lastHubspotRefreshAt || ''],
  ];
  for (const [metric, value] of summaryRows) summarySheet.addRow({ metric, value });

  const amSheet = workbook.addWorksheet('By Account Manager');
  amSheet.columns = [
    { header: 'Account Manager', key: 'accountManagerName', width: 26 },
    { header: 'Total Accounts', key: 'totalAccounts', width: 14 },
    { header: 'Flagged Accounts', key: 'flaggedAccountCount', width: 15 },
    { header: 'Total Communities', key: 'totalCommunities', width: 16 },
    { header: 'Avg Health Score', key: 'avgScore', width: 15 },
    { header: 'Open Tickets', key: 'openTickets', width: 13 },
    { header: 'Closed Tickets', key: 'closedTickets', width: 14 },
    { header: 'Deals Closed This Year', key: 'dealsThisYearClosed', width: 18 },
    { header: 'Deals Open This Year', key: 'dealsThisYearOpen', width: 17 },
    { header: 'ARR', key: 'arr', width: 14 },
    // Two different questions (Sep 2026, Aaron): "Added to Book" is
    // account-owner-based — ARR added on accounts this AM currently owns,
    // regardless of who closed the deal (a workload signal, matches the
    // Accounts tab's own per-account sums). "Personally Closed" is
    // deal-owner-based — ARR from deals this AM actually closed, on any
    // account (a productivity/growth signal). See
    // computeRollupByAccountManager's doc comment (server/api/teamAm.js).
    { header: 'ARR Added to Book This Year', key: 'arrAddedToBook', width: 22 },
    { header: 'ARR Personally Closed This Year', key: 'arrPersonallyClosed', width: 24 },
    { header: 'Total Capacity', key: 'totalCapacity', width: 14 },
    { header: 'Current Census', key: 'currentCensus', width: 14 },
  ];
  amSheet.getRow(1).font = { bold: true };
  for (const am of rollupByAccountManager) {
    amSheet.addRow({
      accountManagerName: am.accountManagerName,
      totalAccounts: am.totalAccounts,
      flaggedAccountCount: am.flaggedAccountCount || 0,
      totalCommunities: am.totalCommunities,
      avgScore: am.avgScore ?? '',
      openTickets: am.openTickets,
      closedTickets: am.closedTickets,
      dealsThisYearClosed: am.dealsThisYearClosed || 0,
      dealsThisYearOpen: am.dealsThisYearOpen || 0,
      arr: usd(am.arrCents),
      arrAddedToBook: usd(am.arrAddedToBookCents),
      arrPersonallyClosed: usd(am.arrPersonallyClosedCents),
      totalCapacity: am.totalCapacity ?? '',
      currentCensus: am.currentCensus ?? '',
    });
  }

  const tierSheet = workbook.addWorksheet('By Tier');
  tierSheet.columns = [
    { header: 'Tier', key: 'tier', width: 12 },
    { header: 'Accounts', key: 'accountCount', width: 11 },
    { header: 'Account Managers', key: 'amCount', width: 16 },
    { header: 'Total Communities', key: 'totalCommunities', width: 16 },
    { header: 'Avg Health Score', key: 'avgHealthScore', width: 15 },
    { header: 'Open Tickets', key: 'openTickets', width: 13 },
    { header: 'Closed Tickets', key: 'closedTickets', width: 14 },
    { header: 'Open Escalations', key: 'escalationOpen', width: 15 },
    { header: 'Enhancement Requests — Top 3', key: 'enhancementTop', width: 22 },
    { header: 'Enhancement Requests — Long-Term', key: 'enhancementLesser', width: 25 },
    { header: 'Other Open Tickets', key: 'otherOpenTickets', width: 16 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'ARR Added This Year', key: 'arrAdded', width: 17 },
    { header: 'Total Capacity', key: 'totalCapacity', width: 14 },
    { header: 'Current Census', key: 'currentCensus', width: 14 },
  ];
  tierSheet.getRow(1).font = { bold: true };
  for (const t of buildTierRows(accounts)) {
    tierSheet.addRow({
      tier: t.tier,
      accountCount: t.accountCount,
      amCount: t.amCount,
      totalCommunities: t.totalCommunities,
      avgHealthScore: t.avgHealthScore ?? '',
      openTickets: t.openTickets,
      closedTickets: t.closedTickets,
      escalationOpen: t.escalationOpen,
      enhancementTop: t.enhancementTop,
      enhancementLesser: t.enhancementLesser,
      otherOpenTickets: t.otherOpenTickets,
      arr: usd(t.arrCents),
      arrAdded: usd(t.arrAddedThisYearCents),
      totalCapacity: t.totalCapacity,
      currentCensus: t.currentCensus,
    });
  }

  const accountsSheet = workbook.addWorksheet('Accounts');
  accountsSheet.columns = [
    { header: 'Account', key: 'name', width: 34 },
    { header: 'HubSpot Link', key: 'hubspotUrl', width: 40 },
    { header: 'Account Manager', key: 'accountManagerName', width: 22 },
    { header: 'Tier', key: 'tier', width: 10 },
    { header: 'Data Quality Flag', key: 'lifecycleFlagLabel', width: 24 },
    { header: 'Total Communities', key: 'totalCommunities', width: 16 },
    { header: 'Health Score', key: 'healthScore', width: 12 },
    { header: 'Health Band', key: 'healthBand', width: 12 },
    { header: 'Open Tickets', key: 'openTickets', width: 12 },
    { header: 'Closed Tickets', key: 'closedTickets', width: 13 },
    { header: 'Open Escalations', key: 'escalationOpen', width: 15 },
    { header: 'Top 3 Enhancements', key: 'enhTop', width: 16 },
    { header: 'Long-Term Enhancements', key: 'enhLesser', width: 18 },
    { header: 'Other Open Tickets', key: 'otherOpen', width: 15 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'ARR Added This Year', key: 'arrAdded', width: 16 },
    { header: 'Aging Balance', key: 'agingTotal', width: 14 },
    { header: 'DSO (days)', key: 'dso', width: 11 },
    { header: 'HubSpot Capacity', key: 'hubspotCapacity', width: 15 },
    { header: 'Total Capacity', key: 'totalCapacity', width: 14 },
    { header: 'Current Census', key: 'currentCensus', width: 14 },
    { header: 'Last Activity', key: 'lastActivity', width: 14 },
  ];
  accountsSheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    accountsSheet.addRow({
      name: a.company_name,
      hubspotUrl: a.hubspotUrl || '',
      accountManagerName: a.account_manager_name || '',
      tier: tierLabel(a.tier),
      lifecycleFlagLabel: a.lifecycle_flag_label || '',
      totalCommunities: a.active_community_count ?? '',
      healthScore: a.health_score ?? '',
      healthBand: a.health_band || '',
      openTickets: a.open_ticket_count || 0,
      closedTickets: a.closed_ticket_count || 0,
      escalationOpen: a.alis_escalation_open_count || 0,
      enhTop: a.enhancement_top_count || 0,
      enhLesser: a.enhancement_lesser_count || 0,
      otherOpen: a.other_open_ticket_count || 0,
      arr: usd(a.arr_cents),
      arrAdded: usd(a.arr_added_this_year_cents),
      agingTotal: usd(a.aging_total_cents),
      dso: a.dsoDays ?? '',
      hubspotCapacity: a.hubspot_capacity ?? '',
      totalCapacity: a.total_capacity ?? '',
      currentCensus: a.current_census ?? '',
      lastActivity: a.last_activity_date ? a.last_activity_date.slice(0, 10) : '',
    });
  }

  const projects = flattenImplementationProjects(accounts);
  const projectsSheet = workbook.addWorksheet('Implementation Projects');
  projectsSheet.columns = [
    { header: 'Account', key: 'companyName', width: 30 },
    { header: 'Account Manager', key: 'accountManagerName', width: 22 },
    { header: 'Tier', key: 'tier', width: 10 },
    { header: 'Project', key: 'name', width: 40 },
    { header: 'RAG', key: 'rag', width: 8 },
    { header: 'Progress %', key: 'progress', width: 11 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Owner', key: 'owner', width: 20 },
    { header: 'Projected Go-Live', key: 'goLive', width: 16 },
    { header: 'Open?', key: 'isOpen', width: 8 },
    { header: 'Link', key: 'url', width: 40 },
  ];
  projectsSheet.getRow(1).font = { bold: true };
  for (const p of projects) {
    projectsSheet.addRow({
      companyName: p.companyName,
      accountManagerName: p.accountManagerName || '',
      tier: tierLabel(p.tier),
      name: p.name || '',
      rag: p.projectHealthRag || '',
      progress: p.projectProgress ?? '',
      status: p.projectStatus || '',
      owner: p.projectOwner || '',
      goLive: p.projectedGoLiveDate ? p.projectedGoLiveDate.slice(0, 10) : '',
      isOpen: isOpenProject(p) ? 'Open' : 'Closed',
      url: p.url || '',
    });
  }

  await download(workbook, 'Team-AM-Dashboard.xlsx');
}
