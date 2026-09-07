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
      ${stat('Open Tickets', rollup.openTickets, 'Client Submitted + In Progress')}
      ${stat('Closed Tickets', rollup.closedTickets)}
      ${stat('Avg Health Score', rollup.avgScore ?? '—')}
      ${stat('Enhancement Requests', rollup.enhancementTop + rollup.enhancementLesser, `${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`)}
      ${stat('Open Deals', rollup.openDeals)}
      ${stat('Open Deal Value', usd(rollup.openDealValueCents))}
      ${stat('Total ARR', usd(rollup.arrCents))}
      ${stat('ARR Added This Year', usd(rollup.arrAddedThisYearCents))}
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

function buildArrAddedDealsTable(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) rows.push({ ...d, companyName: a.company_name });
  }
  if (rows.length === 0) return '<p class="italic-muted">No closed-won deals with an ARR value this year yet.</p>';

  const totalCents = rows.reduce((s, d) => s + d.arrValueCents, 0);
  return `
    <p class="meta">${rows.length} deal(s) totaling ${usd(totalCents)}</p>
    <table>
      <thead><tr><th>Account</th><th>Deal</th><th>Stage</th><th class="num">ARR Value</th><th>Close Date</th></tr></thead>
      <tbody>
        ${rows.map((d) => `<tr>
          <td>${escapeHtml(d.companyName)}</td>
          <td>${d.url ? `<a href="${d.url}">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}</td>
          <td>${escapeHtml(d.stage || '')}</td>
          <td class="num">${usd(d.arrValueCents)}</td>
          <td>${d.closeDate ? escapeHtml(d.closeDate.slice(0, 10)) : '—'}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
}

/** Portfolio-wide export — every account Aaron owns, one row each, plus the same roll-up stats shown on the dashboard. */
async function renderAccountHealthPortfolioPdf(accounts, rollup) {
  const body = `
    <h1>Account Health — Portfolio Report</h1>
    <p class="meta">Generated ${escapeHtml(new Date().toISOString().slice(0, 10))} · ${accounts.length} accounts</p>
    ${buildSummarySection(rollup)}
    ${buildAccountsTable(accounts)}
    <section class="section">
      <h2>ARR Added This Year — Contributing Deals</h2>
      ${buildArrAddedDealsTable(accounts)}
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
        <thead><tr><th>${keyField === 'productType' ? 'Product Type' : 'Classification'}</th><th class="num">Occupancy %</th><th class="num">Occupied / Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(String(r[keyField]))}</td><td class="num">${r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—'}</td><td class="num">${r.occupied} / ${r.total}</td></tr>`).join('\n')}
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

/** Single-account export — mirrors the dashboard's drill-down drawer. */
async function renderAccountHealthAccountPdf(account) {
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
      ${stat('Open Tickets', account.open_ticket_count ?? 0, 'Client Submitted + In Progress')}
      ${stat('Closed Tickets', account.closed_ticket_count ?? 0)}
      ${stat('Open Deals', account.open_deal_count ?? 0)}
      ${stat('Open Deal Value', usd(account.open_deal_value_cents))}
      ${stat('ARR', account.arr_cents != null ? usd(account.arr_cents) : '—')}
      ${stat(`ARR Added (${new Date().getFullYear()})`, usd(account.arr_added_this_year_cents))}
      ${stat('Aging Balance', account.aging_total_cents != null ? usd(account.aging_total_cents) : '—')}
      ${stat('DSO', account.dsoDays != null ? `${account.dsoDays}d` : '—', 'Rudimentary — not true invoice-to-payment DSO')}
      ${stat('Total Capacity', account.total_capacity ?? '—', account.occupancy_as_of_date ? `As of ${account.occupancy_as_of_date}` : 'No ALIS subdomain mapped')}
      ${stat('Current Census', account.current_census ?? '—')}
    </section>

    <section class="section">
      <h2>Service Health</h2>
      ${svc?.avgTicketAgeDays != null ? `<p class="meta">Average open ticket age: ${svc.avgTicketAgeDays.toFixed(1)} days</p>` : ''}
      ${buildTicketList(svc?.agedTickets, 'No tickets open past 45 days.')}
    </section>

    <section class="section">
      <h2>Enhancement Tracking</h2>
      ${buildTicketList((svc?.enhancementTopItems || []).map((t) => ({ ...t, ageDays: null })), 'No enhancement requests tracked.')}
      ${svc?.enhancementLesserCount > 0 ? `<p class="italic-muted">${svc.enhancementLesserCount} additional Long-Term Project(s) tracked as lesser enhancements.</p>` : ''}
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
