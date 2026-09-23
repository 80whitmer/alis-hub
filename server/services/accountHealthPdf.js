/**
 * Renders the Account Health Dashboard to PDF — a portfolio-wide report and
 * a single-account report — via Playwright's page.pdf(), same pattern as
 * wellnessPdf.js (no ALIS login needed, this only ever loads a local HTML
 * string). Reuses that file's house style (Lexend Exa, ALIS orange/blue
 * accents) for visual consistency with the other PDF this app produces,
 * trimmed down (no closing/contact page — this report is Aaron's own
 * internal tool, not a client-facing deliverable).
 */
const { newPage } = require('../automation/playwright/browser');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function usd(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Matches accountHealthScoring.js's SCORE_BANDS / the dashboard's BAND_COLOR.
const BAND_COLOR = { Unhealthy: '#dc2626', 'At Risk': '#ea580c', Stable: '#2563eb', Healthy: '#16a34a' };

function scoreBadge(score, band) {
  if (score == null) return '<span class="badge badge-none">No data</span>';
  const color = BAND_COLOR[band] || '#737373';
  return `<span class="badge" style="background:${color}">${score}</span>`;
}

// Canonical tier palette (Sep 2026, Aaron: "verify that all tier related
// reports are consistent with 1 = green, 2 = blue, 3 = orange, 4 = red")
// — same hex values as the dashboard's TIER_COST_COLOR. _DARK mirrors
// TIER_COST_COLOR_DARK, used for "Closed" rows so they read as the same
// tier while staying visually distinct from "Open".
const TIER_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unassigned: '#737373' };
const TIER_COLOR_DARK = { 'Tier 1': '#15803d', 'Tier 2': '#1d4ed8', 'Tier 3': '#c2410c', 'Tier 4': '#b91c1c', Unassigned: '#525252' };
function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}
function tierBadge(name, dark) {
  const color = (dark ? TIER_COLOR_DARK[name] : TIER_COLOR[name]) || (dark ? TIER_COLOR_DARK.Unassigned : TIER_COLOR.Unassigned);
  return `<span class="badge" style="background:${color}">${escapeHtml(name)}</span>`;
}
function pctStr(v, total) {
  return total > 0 ? `${Math.round((v / total) * 100)}%` : '—';
}

function stat(label, value, sub) {
  return `
    <div class="stat">
      <p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value">${escapeHtml(String(value))}</p>
      ${sub ? `<p class="stat-sub">${escapeHtml(sub)}</p>` : ''}
    </div>`;
}

const SHARED_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Lexend Exa', Arial, Helvetica, sans-serif; color: #000000; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; font-weight: 700; }
  h2 { font-size: 14px; background: #000000; color: #fff; padding: 6px 10px; margin: 24px 0 0; font-weight: 600; }
  .meta { font-size: 11px; color: #6d6e71; margin-bottom: 18px; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .stat { flex: 1 1 22%; min-width: 130px; border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px 10px; }
  .stat-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.03em; color: #6d6e71; margin: 0; }
  .stat-value { font-size: 16px; font-weight: 700; margin: 3px 0 0; }
  .stat-sub { font-size: 8px; color: #909295; margin: 2px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 6px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #e5e5e5; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; font-size: 8px; text-transform: uppercase; letter-spacing: 0.02em; color: #4a4a4c; }
  td.center, th.center { text-align: center; }
  td.num, th.num { text-align: right; }
  td.error { color: #e22405; font-weight: 600; }
  .badge { display: inline-block; min-width: 20px; padding: 2px 6px; border-radius: 10px; color: #fff; font-size: 10px; font-weight: 700; text-align: center; }
  .badge-none { background: #d4d4d4; color: #6d6e71; }
  a { color: #56a5c9; text-decoration: none; }
  .section { page-break-inside: avoid; margin-bottom: 18px; }
  .list { font-size: 9.5px; margin: 6px 0 0; padding: 0; list-style: none; }
  .list li { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-bottom: 1px solid #f2f2f2; }
  .list .muted { color: #909295; }
  .italic-muted { font-size: 9.5px; color: #909295; font-style: italic; margin: 6px 0 0; }
`;

function htmlShell(title, body) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend+Exa:wght@400;600;700&display=swap" rel="stylesheet">
<style>${SHARED_STYLE}</style>
</head>
<body>${body}</body>
</html>`;
}

async function renderHtmlToPdf(html) {
  const page = await newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' }, printBackground: true });
  } finally {
    await page.context().close().catch(() => {});
  }
}

function buildSummarySection(rollup) {
  return `
    <section class="stats-grid">
      ${stat('Total Accounts', rollup.totalAccounts)}
      ${stat('Total Communities', rollup.totalCommunities, 'Active child companies')}
      ${stat('Open Tickets', rollup.openTickets, 'Client Submitted + In Progress, excl. enhancements')}
      ${stat('Closed Tickets', rollup.closedTickets)}
      ${stat('Avg Health Score', rollup.avgScore ?? '—')}
      ${stat('Enhancement Requests', rollup.enhancementTop + rollup.enhancementLesser, `${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`)}
      ${stat('Open Deals', rollup.openDeals)}
      ${stat('Open Deal Value', usd(rollup.openDealValueCents))}
      ${stat('Total ARR', usd(rollup.arrCents))}
      ${stat('ARR Added to Book This Year', usd(rollup.arrAddedThisYearCents), 'Workload — counts inherited deals')}
      ${stat('ARR Personally Closed This Year', usd(rollup.arrPersonallyClosedThisYearCents), 'Productivity — deals you closed')}
      ${stat(`Aging Balance${rollup.agingAsOfDate ? ` (as of ${rollup.agingAsOfDate})` : ''}`, rollup.agingAsOfDate ? usd(rollup.agingTotalCents) : '—')}
      ${stat('Past Due 61+ Days', rollup.agingAsOfDate ? usd(rollup.pastDue61PlusCents) : '—')}
      ${stat('Portfolio DSO', rollup.portfolioDsoDays != null ? `${rollup.portfolioDsoDays}d` : '—', 'Rudimentary — not true invoice-to-payment DSO')}
      ${stat(`Total Capacity${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`, rollup.occupancyAccountCount > 0 ? rollup.totalCapacity : '—', rollup.occupancyAccountCount > 0 ? `${rollup.occupancyAccountCount} accounts mapped` : 'No ALIS subdomains mapped')}
      ${stat('Current Census', rollup.occupancyAccountCount > 0 ? rollup.currentCensus : '—')}
    </section>`;
}

function buildAccountsTable(accounts) {
  const rows = accounts.map((a) => `
    <tr>
      <td>${a.hubspotUrl ? `<a href="${a.hubspotUrl}">${escapeHtml(a.company_name)}</a>` : escapeHtml(a.company_name)}</td>
      <td class="center">${scoreBadge(a.health_score, a.health_band)}</td>
      <td class="num">${a.open_ticket_count ?? 0}</td>
      <td class="num">${a.closed_ticket_count ?? 0}</td>
      <td class="num">${a.enhancement_top_count || 0}</td>
      <td class="num">${a.enhancement_lesser_count || 0}</td>
      <td class="num">${a.open_deal_count ?? 0}</td>
      <td class="num">${usd(a.open_deal_value_cents)}</td>
      <td class="num">${a.arr_cents != null ? usd(a.arr_cents) : '—'}</td>
      <td class="num ${a.aging_past_due_61_plus_cents > 0 ? 'error' : ''}">${a.aging_total_cents != null ? usd(a.aging_total_cents) : '—'}</td>
      <td class="num">${a.dsoDays != null ? `${a.dsoDays}d` : '—'}</td>
    </tr>`).join('\n');

  return `
    <section class="section">
      <h2>Accounts (${accounts.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Account</th><th class="center">Health</th><th class="num">Open</th><th class="num">Closed</th>
            <th class="num">Top 3</th><th class="num">Long-Term</th>
            <th class="num">Open Deals</th><th class="num">Open Value</th><th class="num">ARR</th>
            <th class="num">Aging Balance</th><th class="num">DSO</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/** Portfolio Companies by Tier — headcount per tier, tier-colored badges matching the dashboard's Companies by Tier chart. */
function buildCompaniesByTierSection(accounts) {
  const byTier = {};
  for (const a of accounts) byTier[tierLabel(a.tier)] = (byTier[tierLabel(a.tier)] || 0) + 1;
  const names = Object.keys(byTier).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));
  const total = accounts.length;
  return `
    <table>
      <thead><tr><th>Tier</th><th class="num">Accounts</th><th class="num">% of Portfolio</th></tr></thead>
      <tbody>
        ${names.map((n) => `<tr><td>${tierBadge(n)}</td><td class="num">${byTier[n]}</td><td class="num">${pctStr(byTier[n], total)}</td></tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** Portfolio ARR by Tier — dollar total + % of portfolio ARR per tier, tier-colored badges, matching the dashboard's ARR by Tier chart (Sep 2026: "(percentage)" labels). */
function buildArrByTierSection(accounts) {
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    byTier[key] = (byTier[key] || 0) + (a.arr_cents || 0);
  }
  const names = Object.keys(byTier).filter((n) => byTier[n] !== 0).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));
  if (names.length === 0) return '<p class="italic-muted">No ARR data yet.</p>';
  const total = names.reduce((s, n) => s + byTier[n], 0);
  return `
    <table>
      <thead><tr><th>Tier</th><th class="num">ARR</th><th class="num">% of Total ARR</th></tr></thead>
      <tbody>
        ${names.map((n) => `<tr><td>${tierBadge(n)}</td><td class="num">${usd(byTier[n])}</td><td class="num">${pctStr(byTier[n], total)}</td></tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** Portfolio Ticket Volume by Client Tier — Open (tier-colored) / Closed (darker shade) counts and each's share of its own total, matching the dashboard's redesigned Ticket Volume by Client Tier chart. */
function buildTicketsByTierSection(accounts) {
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    if (!byTier[key]) byTier[key] = { open: 0, closed: 0 };
    byTier[key].open += a.open_ticket_count || 0;
    byTier[key].closed += a.closed_ticket_count || 0;
  }
  const names = Object.keys(byTier).filter((n) => byTier[n].open > 0 || byTier[n].closed > 0).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));
  if (names.length === 0) return '<p class="italic-muted">No ticket data yet.</p>';
  const openTotal = names.reduce((s, n) => s + byTier[n].open, 0);
  const closedTotal = names.reduce((s, n) => s + byTier[n].closed, 0);
  return `
    <table>
      <thead><tr><th>Tier</th><th class="num">Open</th><th class="num">% of Open</th><th class="num">Closed</th><th class="num">% of Closed</th></tr></thead>
      <tbody>
        ${names.map((n) => `<tr>
          <td>${tierBadge(n)}</td>
          <td class="num">${byTier[n].open}</td>
          <td class="num">${pctStr(byTier[n].open, openTotal)}</td>
          <td class="num">${byTier[n].closed}</td>
          <td class="num">${pctStr(byTier[n].closed, closedTotal)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

// Same unset handling as tierLabel's "Unassigned" bucket — no client_tier
// property set (or the literal 0) in HubSpot. Duplicated from the
// dashboard's identical isUnassignedTier.
function isUnassignedTier(a) {
  return a.tier == null || a.tier === 0;
}

/** "Unassigned Tier Companies" (Sep 2026, Aaron: "add a view unassigned Tier companies link") — every owned account with no Client Tier set, mirroring the dashboard's UnassignedTierDrawer. */
function buildUnassignedTierSection(accounts) {
  const unassigned = accounts.filter(isUnassignedTier).sort((a, b) => a.company_name.localeCompare(b.company_name));
  if (unassigned.length === 0) return '<p class="italic-muted">Every account has a Client Tier set — nothing to clean up.</p>';
  return `
    <p class="meta">${unassigned.length} account(s) with no Client Tier set in HubSpot</p>
    <table>
      <thead><tr><th>Account</th><th class="num">ARR</th><th class="num">Open Tickets</th><th class="num">Closed Tickets</th></tr></thead>
      <tbody>
        ${unassigned.map((a) => `<tr>
          <td>${a.hubspotUrl ? `<a href="${a.hubspotUrl}">${escapeHtml(a.company_name)}</a>` : escapeHtml(a.company_name)}</td>
          <td class="num">${a.arr_cents != null ? usd(a.arr_cents) : '—'}</td>
          <td class="num">${a.open_ticket_count ?? 0}</td>
          <td class="num">${a.closed_ticket_count ?? 0}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

// Same terminal-status set as the dashboard's isOpenProject
// (AccountHealthDashboard.jsx) — Completed/Cancelled/Merged read as
// closed, everything else as open.
const TERMINAL_PROJECT_STATUSES = new Set(['Completed', 'Cancelled', 'Merged']);
function isOpenProject(p) {
  return !TERMINAL_PROJECT_STATUSES.has(p.projectStatus);
}
function daysSince(iso) {
  return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

/** "Onboarding" (Sep 2026) — every implementation-tracked deal across the portfolio, sourced from each account's financialHealth.implementationProjects (already attached by getEnrichedAccounts, no extra pull needed). Open projects worst-first (Red RAG, then Amber, then Green/unset, then soonest Projected Go-Live), same ordering as the dashboard's default sort. */
function buildOnboardingSection(accounts) {
  const projects = accounts.flatMap((a) => (a.financialHealth?.implementationProjects || []).map((p) => ({ ...p, companyName: a.company_name })));
  if (projects.length === 0) return '<p class="italic-muted">No implementation-tracked deals yet.</p>';

  const openProjects = projects.filter(isOpenProject);
  const closedCount = projects.length - openProjects.length;
  const avgDaysOpen = openProjects.length > 0
    ? Math.round(openProjects.reduce((s, p) => s + (daysSince(p.createdAt) || 0), 0) / openProjects.length)
    : null;
  const ragWeight = { red: 0, amber: 1, green: 2 };
  const sorted = [...openProjects].sort((a, b) => {
    const ragDiff = (ragWeight[a.projectHealthRag] ?? 3) - (ragWeight[b.projectHealthRag] ?? 3);
    if (ragDiff !== 0) return ragDiff;
    const aDate = a.projectedGoLiveDate ? new Date(a.projectedGoLiveDate) : null;
    const bDate = b.projectedGoLiveDate ? new Date(b.projectedGoLiveDate) : null;
    if (aDate && bDate) return aDate - bDate;
    return aDate ? -1 : bDate ? 1 : 0;
  });
  const ragBadge = (rag) => rag ? `<span class="badge" style="background:${{ red: '#dc2626', amber: '#ea580c', green: '#16a34a' }[rag] || '#737373'}">${escapeHtml(rag)}</span>` : '—';

  return `
    <section class="stats-grid">
      ${stat('Open Projects', openProjects.length)}
      ${stat('Closed Projects', closedCount)}
      ${stat('Avg Days Open', avgDaysOpen != null ? avgDaysOpen : '—')}
    </section>
    <table>
      <thead><tr><th>Account</th><th>Project</th><th class="center">Health</th><th>Projected Go-Live</th></tr></thead>
      <tbody>
        ${sorted.map((p) => `<tr>
          <td>${escapeHtml(p.companyName)}</td>
          <td>${p.url ? `<a href="${p.url}">${escapeHtml(p.name || p.projectStatus || '—')}</a>` : escapeHtml(p.name || p.projectStatus || '—')}</td>
          <td class="center">${ragBadge(p.projectHealthRag)}</td>
          <td>${p.projectedGoLiveDate ? escapeHtml(p.projectedGoLiveDate.slice(0, 10)) : '—'}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** "Recurring Calls" (Sep 2026) — every account's scheduled recurring calls, soonest-first, portfolio-wide. A static PDF can't reproduce the on-screen forward-looking heatmap's calendar shape, so this surfaces the same underlying data as a sorted list instead — the next 12 months of scheduled calls, which is what the heatmap visualizes. */
function buildRecurringCallsSection(accounts) {
  const calls = accounts.flatMap((a) => (a.recurringCalls || []).map((c) => ({ ...c, companyName: a.company_name })));
  if (calls.length === 0) return '<p class="italic-muted">No recurring calls tracked yet.</p>';
  const sorted = [...calls].sort((a, b) => (a.nextCallDate || '9999').localeCompare(b.nextCallDate || '9999'));
  return `
    <table>
      <thead><tr><th>Account</th><th>Call</th><th>Cadence</th><th>Next Call</th></tr></thead>
      <tbody>
        ${sorted.map((c) => `<tr>
          <td>${escapeHtml(c.companyName)}</td>
          <td>${escapeHtml(c.label || '—')}</td>
          <td>${escapeHtml(c.cadence || '—')}</td>
          <td>${c.nextCallDate ? escapeHtml(c.nextCallDate.slice(0, 10)) : '—'}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * "Health Score Trend" (Sep 2026, Aaron: "capture the progress of this
 * kpi over time... I plan on improving my average 85 and want to capture
 * the effort and result") — a brand-new metric with no backfill possible,
 * so a short/empty history is expected at first, not an error. Rendered
 * as a minimal inline SVG sparkline (no charting library in this file —
 * Playwright renders plain SVG fine) rather than a table, since a trend's
 * shape is the point.
 */
// Shared by every "point captured on refresh" trend section below (Health
// Score, AM KPI's Deals by Type $ trend) — a brand-new metric genuinely has
// no backfill possible, so a short/empty history is expected, not an error.
const TREND_EMPTY_MSG = 'Not enough history yet — a point is captured every time this dashboard is refreshed. Check back after a couple more refreshes to see the trend.';

/**
 * Generalized inline-SVG line sparkline — originally hardcoded to a 0-100
 * health-score axis, now accepts any numeric series. `min`/`max` default to
 * the series' own range (auto-scale) when omitted; `format` renders the
 * trailing point's label (defaults to the raw number, e.g. for a plain
 * health score) and callers needing currency pass `usd`.
 */
function buildSparklineSvg(values, { color = '#7c3aed', width = 500, height = 90, min: minOpt, max: maxOpt, format = (v) => v } = {}) {
  const pad = 8;
  const min = minOpt != null ? minOpt : Math.min(...values);
  const max = maxOpt != null ? maxOpt : Math.max(...values);
  const range = (max - min) || 1;
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastX = pad + (values.length - 1) * stepX;
  const lastVal = values[values.length - 1];
  const lastY = pad + (1 - (lastVal - min) / range) * (height - pad * 2);
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" />
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="${color}" />
      <text x="${lastX.toFixed(1)}" y="${(lastY - 8).toFixed(1)}" font-size="10" fill="#000" text-anchor="end">${escapeHtml(String(format(lastVal)))}</text>
    </svg>`;
}

function buildHealthScoreTrendSection(history) {
  if (!history || history.length < 2) {
    return `<p class="italic-muted">${TREND_EMPTY_MSG}</p>`;
  }
  return `
    ${buildSparklineSvg(history.map((h) => h.avg_health_score), { min: 0, max: 100 })}
    <p class="meta">${escapeHtml(history[0].recorded_date)} → ${escapeHtml(history[history.length - 1].recorded_date)}</p>`;
}

/** "Deals by Type" $ trend (Sep 2026) — one overall ARR-across-all-types line, sourced from the general-purpose kpi_metric_history table's `dealsByTypeTotalArr` metric (values in cents — usd() converts). Mirrors buildHealthScoreTrendSection's shape/empty-state, just on the generalized sparkline. */
function buildDealsByTypeTrendSection(kpiMetricHistory) {
  const history = kpiMetricHistory?.dealsByTypeTotalArr || [];
  if (history.length < 2) {
    return `<p class="italic-muted">${TREND_EMPTY_MSG}</p>`;
  }
  return `
    ${buildSparklineSvg(history.map((h) => h.value), { format: usd })}
    <p class="meta">${escapeHtml(history[0].recorded_date)} → ${escapeHtml(history[history.length - 1].recorded_date)}</p>`;
}

/** Extended (Sep 2026) with Pipeline + Tier columns — the deal objects already carry `.pipeline` (see accountHealth.js's mapLiveFinancialHealth), tier attached the same way buildOnboardingSection attaches companyName. */
function buildArrAddedDealsTable(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) rows.push({ ...d, companyName: a.company_name, tier: a.tier });
  }
  if (rows.length === 0) return '<p class="italic-muted">No closed-won deals with an ARR value this year yet.</p>';

  const totalCents = rows.reduce((s, d) => s + d.arrValueCents, 0);
  return `
    <p class="meta">${rows.length} deal(s) totaling ${usd(totalCents)}</p>
    <table>
      <thead><tr><th>Account</th><th>Tier</th><th>Deal</th><th>Pipeline</th><th>Stage</th><th class="num">ARR Value</th><th>Close Date</th><th>Closed By</th></tr></thead>
      <tbody>
        ${rows.map((d) => `<tr>
          <td>${escapeHtml(d.companyName)}</td>
          <td>${tierBadge(tierLabel(d.tier))}</td>
          <td>${d.url ? `<a href="${d.url}">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.pipeline || '—')}</td>
          <td>${escapeHtml(d.stage || '')}</td>
          <td class="num">${usd(d.arrValueCents)}</td>
          <td>${d.closeDate ? escapeHtml(d.closeDate.slice(0, 10)) : '—'}</td>
          <td>${escapeHtml(d.dealOwnerName || '—')}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * "All Deals" (Sep 2026) — every account's open + recently-closed (90 day)
 * deal, flattened portfolio-wide, mirroring the dashboard's DealsSection
 * table. Un-capped, like buildUnassignedTierSection — a PDF paginates fine,
 * unlike the sibling Team AM PPT export's per-slide cap. Open-first, then
 * value desc (matches the dashboard's default close-date sort loosely, but
 * a static report reads better worst/biggest-first than by date).
 */
function buildAllDealsTable(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) rows.push({ ...d, companyName: a.company_name, tier: a.tier });
  }
  if (rows.length === 0) return '<p class="italic-muted">No deals yet.</p>';

  const sorted = [...rows].sort((a, b) => {
    const rankDiff = (a.isOpen ? 0 : 1) - (b.isOpen ? 0 : 1);
    if (rankDiff !== 0) return rankDiff;
    return (b.valueCents || 0) - (a.valueCents || 0);
  });
  return `
    <p class="meta">${rows.length} deal(s)</p>
    <table>
      <thead><tr><th>Account</th><th>Tier</th><th>Deal</th><th>Pipeline</th><th>Stage</th><th class="num">Value</th><th>Close Date</th><th class="center">Status</th><th>Next Step</th></tr></thead>
      <tbody>
        ${sorted.map((d) => `<tr>
          <td>${escapeHtml(d.companyName)}</td>
          <td>${tierBadge(tierLabel(d.tier))}</td>
          <td>${d.url ? `<a href="${d.url}">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.pipeline || '—')}</td>
          <td>${escapeHtml(d.stage || '—')}</td>
          <td class="num">${usd(d.valueCents)}</td>
          <td>${d.expectedCloseDate ? escapeHtml(d.expectedCloseDate.slice(0, 10)) : '—'}</td>
          <td class="center">${d.isOpen ? 'Open' : 'Closed'}</td>
          <td>${escapeHtml(d.nextStep || '—')}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** Deals by Type (Sep 2026) — sums every account's financialHealth.dealsByType (over the FULL deal history, per mapLiveFinancialHealth), sorted by count desc, mirroring DealTypeChart's aggregation. */
function buildDealsByTypeTable(accounts) {
  const byType = {};
  for (const a of accounts) {
    const mix = a.financialHealth?.dealsByType || {};
    for (const [type, v] of Object.entries(mix)) {
      if (!byType[type]) byType[type] = { count: 0, valueCents: 0 };
      byType[type].count += v.count || 0;
      byType[type].valueCents += v.valueCents || 0;
    }
  }
  const rows = Object.entries(byType).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
  if (rows.length === 0) return '<p class="italic-muted">No deal data yet.</p>';

  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  return `
    <table>
      <thead><tr><th>Deal Type</th><th class="num">Count</th><th class="num">% of Count</th><th class="num">ARR Value</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.count}</td><td class="num">${pctStr(r.count, totalCount)}</td><td class="num">${usd(r.valueCents)}</td></tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** Deals by Type section — the table plus its $ trend (see buildDealsByTypeTrendSection), same "table + trend below a divider" shape the AM KPI section uses. */
function buildDealsByTypeSection(accounts, kpiMetricHistory) {
  return `
    ${buildDealsByTypeTable(accounts)}
    <h3 style="font-size:11px;margin:14px 0 4px;">ARR Trend (All Deal Types)</h3>
    ${buildDealsByTypeTrendSection(kpiMetricHistory)}`;
}

/** Portfolio-wide flat Key Contacts table — one row per labeled contact, across every account, same fields as the dashboard's Key Contacts section/export. */
function buildKeyContactsTable(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const c of a.keyContacts || []) rows.push({ ...c, companyName: a.company_name, tier: a.tier });
  }
  if (rows.length === 0) return '<p class="italic-muted">No Key Contacts tagged yet — see the ALIS Help Desk\'s General SOP article for the role labels to apply in HubSpot.</p>';

  return `
    <p class="meta">${rows.length} labeled contact(s) across ${new Set(rows.map((r) => r.companyName)).size} account(s)</p>
    <table>
      <thead>
        <tr>
          <th>Company</th><th>Name</th><th>Title</th><th>Label(s)</th><th>Email</th><th>Phone</th><th>Fun Facts</th><th>Notes</th><th>Last Activity</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${escapeHtml(r.companyName)}</td>
          <td>${r.hubspotUrl ? `<a href="${r.hubspotUrl}">${escapeHtml(r.name || '—')}</a>` : escapeHtml(r.name || '—')}</td>
          <td>${escapeHtml(r.title || '—')}</td>
          <td>${escapeHtml((r.labels || []).join(', '))}</td>
          <td>${escapeHtml(r.email || '—')}</td>
          <td>${escapeHtml(r.phone || '—')}</td>
          <td>${escapeHtml(r.funFacts || '—')}</td>
          <td>${escapeHtml(r.notes || '—')}</td>
          <td>${r.lastActivityDate ? escapeHtml(r.lastActivityDate.slice(0, 10)) : '—'}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * AM KPI (Sep 2026) — Aaron's own accounts broken out by Client Tier, one
 * small table per metric, mirroring the dashboard's AmKpiChart/AM_KPI_METRICS
 * dropdown but rendered as every metric's table stacked rather than one
 * chart with a picker (a static PDF can't offer a dropdown). Labels/keys/
 * fields/aggregation kept in exact sync with the dashboard's own
 * AM_KPI_METRICS/AM_KPI_COMBOS (client/src/pages/AccountHealthDashboard.jsx)
 * — duplicated, not shared, per this codebase's per-file convention. No
 * per-metric trend sparklines here (13 of them would be excessive for a
 * static PDF) — deliberately scoped out, see AmKpiTrendSection on the
 * dashboard for the live equivalent.
 */
const AM_KPI_METRICS = [
  { key: 'totalAccounts', label: 'Accounts', agg: 'count', format: (v) => v },
  { key: 'arrAddedThisYearCents', label: `ARR: Added (${new Date().getFullYear()})`, field: 'arr_added_this_year_cents', agg: 'sum', format: usd },
  { key: 'arrCents', label: 'ARR: Total', field: 'arr_cents', agg: 'sum', format: usd },
  { key: 'avgScore', label: 'Avg Health Score', field: 'health_score', agg: 'avg', format: (v) => v },
  { key: 'totalCommunities', label: 'Communities', field: 'active_community_count', agg: 'sum', format: (v) => v },
  { key: 'openDealCount', label: 'Deals: Open', field: 'open_deal_count', agg: 'sum', format: (v) => v },
  { key: 'openDealValueCents', label: 'Deals: Open Value (ARR)', field: 'open_deal_value_cents', agg: 'sum', format: usd },
  { key: 'totalCapacity', label: 'Occupancy: Capacity', field: 'total_capacity', agg: 'sum', format: (v) => v },
  { key: 'capacityCensus', label: 'Occupancy: Capacity & Census' },
  { key: 'currentCensus', label: 'Occupancy: Census', field: 'current_census', agg: 'sum', format: (v) => v },
  { key: 'closedTickets', label: 'Tickets: Closed', field: 'closed_ticket_count', agg: 'sum', format: (v) => v },
  { key: 'enhancementVsOther', label: 'Tickets: Enhancement vs. Other' },
  { key: 'openTickets', label: 'Tickets: Open', field: 'open_ticket_count', agg: 'sum', format: (v) => v },
];

// Same two "combo" (two-series) entries as the dashboard's AM_KPI_COMBOS —
// compute(list) reduces one tier's accounts down to { a, b }.
const AM_KPI_COMBOS = {
  capacityCensus: {
    seriesALabel: 'Total Capacity',
    seriesBLabel: 'Current Census',
    compute: (list) => ({
      a: list.reduce((s, a) => s + (a.total_capacity || 0), 0),
      b: list.reduce((s, a) => s + (a.current_census || 0), 0),
    }),
    emptyMessage: 'No occupancy data yet.',
  },
  enhancementVsOther: {
    seriesALabel: 'Other Open Tickets',
    seriesBLabel: 'Enhancement Tickets',
    compute: (list) => {
      const enhancement = list.reduce((s, a) => s + (a.enhancement_top_count || 0) + (a.enhancement_lesser_count || 0), 0);
      const totalOpen = list.reduce((s, a) => s + (a.open_ticket_count || 0), 0);
      return { a: Math.max(0, totalOpen - enhancement), b: enhancement };
    },
    emptyMessage: 'No ticket data yet.',
  },
};

// Same "exclude lifecycle_flag'd accounts, group by Client Tier" rule as
// the dashboard's own tierGroups.
function amKpiTierGroups(accounts) {
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const byTier = {};
  for (const a of clean) {
    const key = tierLabel(a.tier);
    (byTier[key] ||= []).push(a);
  }
  return byTier;
}

function sortedTierNames(byTier) {
  return Object.keys(byTier).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));
}

// Same aggregation rule as the dashboard's aggregateMetric — 'avg' averages
// (skipping unscored accounts), everything else sums.
function aggregateAmKpiMetric(list, metric) {
  if (metric.agg === 'count') return list.length;
  if (metric.agg === 'avg') {
    const scored = list.filter((a) => a[metric.field] != null);
    return scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a[metric.field], 0) / scored.length) : null;
  }
  return list.reduce((s, a) => s + (a[metric.field] || 0), 0);
}

function buildAmKpiMetricTable(byTier, metric) {
  const names = sortedTierNames(byTier);
  const rows = names.map((n) => ({ name: n, value: aggregateAmKpiMetric(byTier[n], metric) })).filter((r) => r.value != null && r.value !== 0);
  if (rows.length === 0) return '<p class="italic-muted">No data yet for this metric.</p>';
  const total = metric.agg === 'avg' ? null : rows.reduce((s, r) => s + r.value, 0);
  return `
    <table>
      <thead><tr><th>Tier</th><th class="num">${escapeHtml(metric.label)}</th>${total != null ? '<th class="num">% of Total</th>' : ''}</tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${tierBadge(r.name)}</td><td class="num">${metric.format(r.value)}</td>${total != null ? `<td class="num">${pctStr(r.value, total)}</td>` : ''}</tr>`).join('\n')}
      </tbody>
    </table>`;
}

function buildAmKpiComboTable(byTier, combo) {
  const names = sortedTierNames(byTier);
  const rows = names.map((n) => { const { a, b } = combo.compute(byTier[n]); return { name: n, a, b }; }).filter((r) => r.a > 0 || r.b > 0);
  if (rows.length === 0) return `<p class="italic-muted">${escapeHtml(combo.emptyMessage)}</p>`;
  const totalA = rows.reduce((s, r) => s + r.a, 0);
  const totalB = rows.reduce((s, r) => s + r.b, 0);
  return `
    <table>
      <thead><tr><th>Tier</th><th class="num">${escapeHtml(combo.seriesALabel)}</th><th class="num">%</th><th class="num">${escapeHtml(combo.seriesBLabel)}</th><th class="num">%</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${tierBadge(r.name)}</td>
          <td class="num">${r.a}</td>
          <td class="num">${pctStr(r.a, totalA)}</td>
          <td class="num">${r.b}</td>
          <td class="num">${pctStr(r.b, totalB)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

function buildAmKpiSection(accounts) {
  const byTier = amKpiTierGroups(accounts);
  return AM_KPI_METRICS.map((metric) => {
    const combo = AM_KPI_COMBOS[metric.key];
    const body = combo ? buildAmKpiComboTable(byTier, combo) : buildAmKpiMetricTable(byTier, metric);
    return `<h3 style="font-size:11px;margin:14px 0 4px;">${escapeHtml(metric.label)}</h3>${body}`;
  }).join('\n');
}

/**
 * Escalation Tickets (Sep 2026) — every account's open ALIS Escalation
 * items, portfolio-wide, mirroring EscalationRequestsSection.jsx's stat
 * tiles + table (the tier bar chart / trend line / calendar heatmaps there
 * don't translate to a static page, so this keeps the table, which is the
 * actionable part). Account column added beyond the section's own column
 * list — every other flattened portfolio table in this file (Onboarding,
 * Key Contacts, ARR Added Deals) carries one, and without it a multi-
 * account table isn't usable.
 */
function buildEscalationTicketsSection(accounts) {
  const items = accounts.flatMap((a) => (a.serviceHealth?.alisEscalationOpenItems || []).map((t) => ({ ...t, companyName: a.company_name, tier: a.tier })));
  const avgAgeDays = items.length ? Math.round(items.reduce((s, t) => s + (t.daysOpen || 0), 0) / items.length) : null;
  const statsHtml = `
    <section class="stats-grid">
      ${stat('Open Escalation Tickets', items.length)}
      ${stat('Average Age', avgAgeDays != null ? `${avgAgeDays}d` : '—')}
    </section>`;
  if (items.length === 0) return `${statsHtml}<p class="italic-muted">No open escalation tickets.</p>`;

  const sorted = [...items].sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0));
  return `
    ${statsHtml}
    <table>
      <thead><tr><th>Account</th><th>Escalation</th><th>Request Date</th><th class="num">Days Open</th><th>Next Step</th><th>Tier</th></tr></thead>
      <tbody>
        ${sorted.map((t) => `<tr>
          <td>${escapeHtml(t.companyName)}</td>
          <td>${t.url ? `<a href="${t.url}">${escapeHtml(t.subject)}</a>` : escapeHtml(t.subject)}</td>
          <td>${t.createdAt ? escapeHtml(t.createdAt.slice(0, 10)) : '—'}</td>
          <td class="num">${t.daysOpen ?? '—'}</td>
          <td>${escapeHtml(t.nextStep || '—')}</td>
          <td>${tierBadge(tierLabel(t.tier))}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * Enhancement Requests (Sep 2026) — same shape as buildEscalationTicketsSection,
 * shared by the dedicated "Top 3" section and the full "all open enhancement
 * requests" section (mirroring EnhancementRequestsSection.jsx's topThreeOnly
 * prop), with a "Top 3?" column and "Also Ranked Top 3" stat added only in
 * the unfiltered (full) mode, matching the live component.
 */
function buildEnhancementRequestsSection(accounts, { topThreeOnly = false } = {}) {
  let items = accounts.flatMap((a) => (a.serviceHealth?.enhancementRequests || []).map((t) => ({ ...t, companyName: a.company_name, tier: a.tier })));
  if (topThreeOnly) items = items.filter((t) => t.isTopThree);
  const avgAgeDays = items.length ? Math.round(items.reduce((s, t) => s + (t.daysOpen || 0), 0) / items.length) : null;
  const topThreeCount = items.filter((t) => t.isTopThree).length;
  const statsHtml = `
    <section class="stats-grid">
      ${stat(topThreeOnly ? 'Enhancement Requests: Top 3' : 'Open Enhancement Requests', items.length)}
      ${stat('Average Age', avgAgeDays != null ? `${avgAgeDays}d` : '—')}
      ${!topThreeOnly ? stat('Also Ranked Top 3', topThreeCount) : ''}
    </section>`;
  if (items.length === 0) {
    return `${statsHtml}<p class="italic-muted">${topThreeOnly ? 'No accounts have a Top 3 Enhancement Request set yet.' : 'No open enhancement requests tracked yet.'}</p>`;
  }

  const sorted = [...items].sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0));
  return `
    ${statsHtml}
    <table>
      <thead><tr><th>Account</th><th>Enhancement</th><th>Request Date</th><th class="num">Days Open</th><th>Next Step</th>${!topThreeOnly ? '<th class="center">Top 3?</th>' : ''}<th>Tier</th></tr></thead>
      <tbody>
        ${sorted.map((t) => `<tr>
          <td>${escapeHtml(t.companyName)}</td>
          <td>${t.url ? `<a href="${t.url}">${escapeHtml(t.subject)}</a>` : escapeHtml(t.subject)}</td>
          <td>${t.createdAt ? escapeHtml(t.createdAt.slice(0, 10)) : '—'}</td>
          <td class="num">${t.daysOpen ?? '—'}</td>
          <td>${escapeHtml(t.nextStep || '—')}</td>
          ${!topThreeOnly ? `<td class="center">${t.isTopThree ? 'Yes' : 'No'}</td>` : ''}
          <td>${tierBadge(tierLabel(t.tier))}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/**
 * Portfolio-wide export — every account Aaron owns, one row each, plus the
 * same roll-up stats shown on the dashboard. `kpiMetricHistory` (Sep 2026)
 * is the general-purpose kpi_metric_history table's per-metric-key history
 * (see database.js's getKpiMetricHistory) — only the Deals by Type $ trend
 * currently reads it.
 */
async function renderAccountHealthPortfolioPdf(accounts, rollup, healthScoreHistory, kpiMetricHistory) {
  const body = `
    <h1>Account Health — Portfolio Report</h1>
    <p class="meta">Generated ${escapeHtml(new Date().toISOString().slice(0, 10))} · ${accounts.length} accounts</p>
    ${buildSummarySection(rollup)}
    <section class="section">
      <h2>Health Score Trend</h2>
      ${buildHealthScoreTrendSection(healthScoreHistory)}
    </section>
    ${buildAccountsTable(accounts)}
    <section class="section">
      <h2>Onboarding</h2>
      ${buildOnboardingSection(accounts)}
    </section>
    <section class="section">
      <h2>Recurring Calls</h2>
      ${buildRecurringCallsSection(accounts)}
    </section>
    <section class="section">
      <h2>Companies by Tier</h2>
      ${buildCompaniesByTierSection(accounts)}
    </section>
    <section class="section">
      <h2>AM KPI</h2>
      ${buildAmKpiSection(accounts)}
    </section>
    <section class="section">
      <h2>ARR by Tier</h2>
      ${buildArrByTierSection(accounts)}
    </section>
    <section class="section">
      <h2>Deals by Type</h2>
      ${buildDealsByTypeSection(accounts, kpiMetricHistory)}
    </section>
    <section class="section">
      <h2>Ticket Volume by Client Tier</h2>
      ${buildTicketsByTierSection(accounts)}
    </section>
    <section class="section">
      <h2>Escalation Tickets</h2>
      ${buildEscalationTicketsSection(accounts)}
    </section>
    <section class="section">
      <h2>Enhancement Requests: Top 3</h2>
      ${buildEnhancementRequestsSection(accounts, { topThreeOnly: true })}
    </section>
    <section class="section">
      <h2>Enhancement Requests</h2>
      ${buildEnhancementRequestsSection(accounts)}
    </section>
    <section class="section">
      <h2>Unassigned Tier Companies</h2>
      ${buildUnassignedTierSection(accounts)}
    </section>
    <section class="section">
      <h2>Key Contacts</h2>
      ${buildKeyContactsTable(accounts)}
    </section>
    <section class="section">
      <h2>ARR Added This Year — Contributing Deals</h2>
      ${buildArrAddedDealsTable(accounts)}
    </section>
    <section class="section">
      <h2>All Deals</h2>
      ${buildAllDealsTable(accounts)}
    </section>
  `;
  return renderHtmlToPdf(htmlShell('Account Health — Portfolio Report', body));
}

function buildTicketList(items, emptyText) {
  if (!items?.length) return `<p class="italic-muted">${escapeHtml(emptyText)}</p>`;
  return `<ul class="list">${items.map((t) => `
    <li>
      <span>${t.url ? `<a href="${t.url}">${escapeHtml(t.subject)}</a>` : escapeHtml(t.subject)}</span>
      <span class="muted">${t.ageDays != null ? `${t.ageDays}d · ` : ''}${escapeHtml(t.stage || '')}${t.rank ? ` · #${escapeHtml(t.rank)}` : ''}</span>
    </li>`).join('\n')}</ul>`;
}

function buildDealsList(deals) {
  if (!deals?.length) return '<p class="italic-muted">No open deals.</p>';
  return `<ul class="list">${deals.map((d) => `
    <li>
      <span>${d.url ? `<a href="${d.url}">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}${d.nextStep ? `<br><span class="muted">↳ ${escapeHtml(d.nextStep)}</span>` : ''}</span>
      <span class="muted">${escapeHtml(d.stage || '')} · ${usd(d.valueCents)}${d.expectedCloseDate ? ` · due ${escapeHtml(d.expectedCloseDate.slice(0, 10))}` : ''}</span>
    </li>`).join('\n')}</ul>`;
}

function buildAgingSection(aging) {
  if (!aging) return '<p class="italic-muted">No aging data imported for this account yet.</p>';
  const cell = (v, flag) => `<td class="num${flag ? ' error' : ''}">${usd(v)}</td>`;
  return `
    <p class="meta">As of ${escapeHtml(aging.asOfDate)} — ${aging.sourceRows?.length || 0} Intacct line(s) rolled up</p>
    <table>
      <thead><tr><th>Current</th><th class="num">1-30</th><th class="num">31-60</th><th class="num">61-90</th><th class="num">91-120</th><th class="num">121+</th><th class="num">Total</th></tr></thead>
      <tbody>
        <tr>
          <td class="num">${usd(aging.currentCents)}</td>
          ${cell(aging.d1_30Cents)}${cell(aging.d31_60Cents)}${cell(aging.d61_90Cents, aging.d61_90Cents > 0)}${cell(aging.d91_120Cents, aging.d91_120Cents > 0)}${cell(aging.d121PlusCents, aging.d121PlusCents > 0)}
          <td class="num"><strong>${usd(aging.totalCents)}</strong></td>
        </tr>
      </tbody>
    </table>
    <p class="italic-muted">From: ${escapeHtml((aging.sourceRows || []).map((r) => r.customerName).join(', '))}</p>`;
}

function buildOccupancyBreakdownTable(title, rows, keyField) {
  if (!rows?.length) return '';
  return `
    <div style="flex:1">
      <h3 style="font-size:11px;margin:0 0 6px;">${escapeHtml(title)}</h3>
      <table>
        <thead><tr><th>${keyField === 'productType' ? 'Product Type' : 'Classification'}</th><th class="num">% of Census</th><th class="num">Occupied / Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(String(r[keyField]))}</td><td class="num">${r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—'}</td><td class="num">${r.occupied} / ${r.total ?? '—'}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>`;
}

function buildOccupancySection(account) {
  if (!account.occupancyByProductType?.length && !account.occupancyByClassification?.length) {
    return `<p class="italic-muted">${account.occupancy_as_of_date ? 'No product-type/classification breakdown available.' : 'No ALIS subdomain mapped for this account yet.'}</p>`;
  }
  return `
    <div style="display:flex; gap:24px;">
      ${buildOccupancyBreakdownTable('By Product Type', account.occupancyByProductType, 'productType')}
      ${buildOccupancyBreakdownTable('By Classification', account.occupancyByClassification, 'classification')}
    </div>`;
}

/** One account's labeled contacts, plus a callout for any known role label nobody there is tagged with — mirrors the drawer's Key Contacts section. */
function buildKeyContactsSection(account) {
  const contacts = account.keyContacts || [];
  const missing = account.missingKeyContactLabels || [];
  const list = contacts.length === 0
    ? '<p class="italic-muted">No Key Contacts tagged for this account yet.</p>'
    : `<ul class="list">${contacts.map((c) => `
      <li>
        <span>${c.hubspotUrl ? `<a href="${c.hubspotUrl}">${escapeHtml(c.name || '—')}</a>` : escapeHtml(c.name || '—')}${c.title ? ` — ${escapeHtml(c.title)}` : ''}<br>
          <span class="muted">${escapeHtml((c.labels || []).join(', '))}</span></span>
        <span class="muted">${escapeHtml(c.email || '')}${c.email && c.phone ? ' · ' : ''}${escapeHtml(c.phone || '')}</span>
      </li>`).join('\n')}</ul>`;
  const missingNote = missing.length > 0
    ? `<p class="italic-muted">No contact tagged as: ${escapeHtml(missing.join(', '))}.</p>`
    : '';
  return list + missingNote;
}

/** Single-account export — mirrors the dashboard's drill-down drawer. */
async function renderAccountHealthAccountPdf(account, healthScoreHistory) {
  const svc = account.serviceHealth;
  const fin = account.financialHealth;
  const openDeals = (fin?.expansionPipeline?.deals || []).filter((d) => d.isOpen);

  const body = `
    <h1>${escapeHtml(account.company_name)}</h1>
    <p class="meta">
      ${account.hubspotUrl ? `<a href="${account.hubspotUrl}">Open in HubSpot</a> · ` : ''}
      Generated ${escapeHtml(new Date().toISOString().slice(0, 10))}
      ${account.lifecycle_stage ? ` · lifecycle stage ${escapeHtml(account.lifecycle_stage)}` : ''}
      &nbsp;&nbsp;${scoreBadge(account.health_score, account.health_band)}
    </p>

    <section class="stats-grid">
      ${stat('Open Tickets', account.open_ticket_count ?? 0, 'Client Submitted + In Progress, excl. enhancements')}
      ${stat('Closed Tickets', account.closed_ticket_count ?? 0)}
      ${stat('Open Deals', account.open_deal_count ?? 0)}
      ${stat('Open Deal Value', usd(account.open_deal_value_cents))}
      ${stat('ARR', account.arr_cents != null ? usd(account.arr_cents) : '—')}
      ${stat(`ARR Added to Book (${new Date().getFullYear()})`, usd(account.arr_added_this_year_cents), 'Workload — counts inherited deals')}
      ${stat(`ARR Personally Closed (${new Date().getFullYear()})`, usd(account.arr_personally_closed_this_year_cents), 'Productivity — deals you closed')}
      ${stat('Aging Balance', account.aging_total_cents != null ? usd(account.aging_total_cents) : '—')}
      ${stat('DSO', account.dsoDays != null ? `${account.dsoDays}d` : '—', 'Rudimentary — not true invoice-to-payment DSO')}
      ${stat('Total Capacity', account.total_capacity ?? '—', account.occupancy_as_of_date ? `As of ${account.occupancy_as_of_date}` : 'No ALIS subdomain mapped')}
      ${stat('Current Census', account.current_census ?? '—')}
    </section>

    <section class="section">
      <h2>Health Score Trend</h2>
      ${buildHealthScoreTrendSection(healthScoreHistory)}
    </section>

    <section class="section">
      <h2>Key Contacts</h2>
      ${buildKeyContactsSection(account)}
    </section>

    <section class="section">
      <h2>Service Health</h2>
      ${svc?.avgTicketAgeDays != null ? `<p class="meta">Average open ticket age: ${svc.avgTicketAgeDays.toFixed(1)} days</p>` : ''}
      ${buildTicketList(svc?.agedTickets, 'No tickets open past 45 days.')}
    </section>

    <section class="section">
      <h2>Enhancement Tracking</h2>
      ${buildTicketList((svc?.enhancementTopItems || []).map((t) => ({ ...t, ageDays: null })), 'No enhancement requests tracked.')}
      ${svc?.enhancementLesserCount > 0 ? `<p class="italic-muted">${svc.enhancementLesserCount} additional Long-Term Project(s) tracked as lesser enhancements:</p>${buildTicketList((svc?.enhancementLesserItems || []).map((t) => ({ ...t, ageDays: null })), '')}` : ''}
      ${svc?.otherOpenCount > 0 ? `<p class="italic-muted">${svc.otherOpenCount} other open ticket(s) in lower-volume statuses, not counted above.</p>` : ''}
    </section>

    <section class="section">
      <h2>Financial Health</h2>
      ${buildDealsList(openDeals)}
    </section>

    <section class="section">
      <h2>AR Aging</h2>
      ${buildAgingSection(account.aging)}
    </section>

    <section class="section">
      <h2>Occupancy</h2>
      ${buildOccupancySection(account)}
    </section>

    <section class="section">
      <h2>Sub-scores</h2>
      <ul class="list">
        ${Object.entries(account.subScores || {}).map(([k, v]) => `<li><span style="text-transform:capitalize">${escapeHtml(k)}</span><span class="muted">${v == null ? '—' : v}</span></li>`).join('\n')}
      </ul>
    </section>
  `;
  return renderHtmlToPdf(htmlShell(account.company_name, body));
}

module.exports = { renderAccountHealthPortfolioPdf, renderAccountHealthAccountPdf };
