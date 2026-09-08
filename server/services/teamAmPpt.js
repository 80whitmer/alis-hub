const path = require('path');
const pptxgen = require('pptxgenjs');

/**
 * PPTX export for the Team AM Dashboard — Aaron asked for this
 * specifically shaped as "each graph gets a slide, the cards get a
 * slide" (Sep 2026), not a full QBR-style deck. Reuses qbrExport.js's
 * brand palette/fonts for visual consistency, but is otherwise a
 * self-contained, much smaller file — this page has no per-account
 * narrative content the way a QBR does, just the same rollup numbers
 * already on screen.
 */
const BRAND = {
  onyx: '000000',
  white: 'FFFFFF',
  slate: '6D6E71',
  smoke: '909295',
  marigold: 'FBB219',
  amber: 'F06022',
  flame: 'EC4303',
  scarlet: 'E22405',
  glacier: '56A5C9',
  mint: '7CC7A6',
  cardBg: 'FFFFFF',
  cardBorder: 'E5E5E5',
};

const FONT_HEAD = 'Lexend Exa';
const FONT_BODY = 'Gotham Rounded';
const LOGO_DARK = path.join(__dirname, '..', 'assets', 'brand', 'alis-logo-dark-bg.png');
const CHART_PALETTE = [BRAND.amber, BRAND.glacier, BRAND.mint, BRAND.marigold, BRAND.slate, BRAND.flame, BRAND.scarlet];

// health_band label -> hex, matching the client's BAND_COLOR/BAND_LABEL_TO_COLOR exactly.
const BAND_HEX = { Unhealthy: 'DC2626', 'At Risk': 'EA580C', Stable: '2563EB', Healthy: '16A34A' };
const HEALTH_BANDS = ['Unhealthy', 'At Risk', 'Stable', 'Healthy'];

// Mirrors TeamAmDashboard.jsx's tierLabel/TIER_ORDER — see that file's copy
// for the "0 reads as unset, not Tier 0" reasoning behind client_tier.
// Duplicated rather than shared, same client/server small-helper pattern
// as the rest of this file (isAtRisk below, etc.).
const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];
function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}
function tierSortIndex(name) {
  const i = TIER_ORDER.indexOf(name);
  return i === -1 ? 999 : i;
}

// `n` is CENTS (matching every arr_cents/arr_added_this_year_cents field
// this file reads) — dividing by 100 here, not just formatting the raw
// value, was missing on the first pass and inflated every dollar figure
// on the Cards slide 100x (confirmed live: "$1,568,053,428" instead of
// the real $15,680,534).
function usd(cents) {
  return cents == null ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function addSectionHeader(slide, title) {
  slide.background = { color: BRAND.white };
  slide.addText(title.toUpperCase(), {
    x: 0.5, y: 0.4, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 28, bold: true, color: BRAND.onyx,
  });
}

function addTitleSlide(pptx, { totalAccounts, totalAms }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.onyx };
  const logoH = 1.75;
  const logoW = logoH * (2464 / 2037);
  slide.addImage({ path: LOGO_DARK, x: (10 - logoW) / 2, y: 0.6, w: logoW, h: logoH });
  slide.addText('Team AM Dashboard', {
    x: 0.5, y: 2.6, w: 9, h: 0.8, fontFace: FONT_HEAD, fontSize: 32, bold: true, color: BRAND.white, align: 'center',
  });
  slide.addText(`${totalAccounts} accounts across ${totalAms} Account Managers`, {
    x: 0.5, y: 3.3, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 16, color: BRAND.marigold, align: 'center',
  });
  slide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 0.5, y: 3.85, w: 9, h: 0.4, fontFace: FONT_BODY, fontSize: 12, color: BRAND.slate, align: 'center',
  });
}

/**
 * Table of contents (Aaron, Sep 2026) — the real slide list this deck
 * builds, not a separately-maintained guess: `KPI_METRICS`/
 * `METRIC_LABELS` (defined below) are the exact same arrays the KPI
 * slide loop itself iterates, so this can never drift out of sync with
 * what's actually in the deck. One line per literal slide would mean
 * listing every metric twice (once for its bar slide, once for pie) —
 * shown instead as one indented line per KPI, noting both chart types
 * exist for it, which is what's actually useful to skim.
 */
function addIndexSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Contents');

  const atRiskCount = accounts.filter(isAtRisk).length;
  const atRiskPages = Math.max(1, Math.ceil(atRiskCount / AT_RISK_PER_SLIDE));

  const runs = [
    { text: 'Overview', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    { text: 'KPI by Account Manager', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    ...KPI_METRICS.map((key) => ({
      text: `${METRIC_LABELS[key]}  (Bar + Pie)`,
      options: { bullet: true, indentLevel: 1, color: BRAND.slate, breakLine: true },
    })),
    { text: 'Health Score Distribution', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    { text: 'Companies by Tier', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    { text: 'Tickets by Tier', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    { text: 'ARR by Tier', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    ...TIER_METRICS.map((key) => ({
      text: `${TIER_METRIC_LABELS[key]}  (Bar + Pie)`,
      options: { bullet: true, indentLevel: 1, color: BRAND.slate, breakLine: true },
    })),
    { text: 'Ticket Volume by Account Manager by Tier', options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } },
    {
      text: `At-Risk Accounts  (${atRiskCount} account${atRiskCount === 1 ? '' : 's'}${atRiskPages > 1 ? `, ${atRiskPages} slides` : ''})`,
      options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true },
    },
  ];

  slide.addText(runs, {
    x: 0.7, y: 1.2, w: 8.5, h: 4.0, fontFace: FONT_BODY, fontSize: 13, lineSpacingMultiple: 1.25,
  });
}

function statCard(slide, x, y, label, valueStr) {
  slide.addShape('roundRect', { x, y, w: 2.75, h: 1.3, rectRadius: 0.08, fill: { color: BRAND.cardBg }, line: { color: BRAND.cardBorder, width: 1 } });
  slide.addText(label, { x: x + 0.15, y: y + 0.1, w: 2.45, h: 0.5, fontFace: FONT_BODY, fontSize: 10, color: BRAND.slate });
  slide.addText(valueStr, { x: x + 0.15, y: y + 0.55, w: 2.45, h: 0.6, fontFace: FONT_HEAD, fontSize: 22, bold: true, color: BRAND.onyx });
}

// Census/capacity deliberately left out — Aaron's own scoping call (Sep
// 2026): this dashboard never pulls fresh occupancy data, and the
// opportunistic cross-referenced numbers it does have only cover a
// fraction of accounts, so they don't belong in a portfolio-wide export
// yet.
function addCardsSlide(pptx, rollup) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Overview');

  const row1Y = 1.15;
  const row2Y = 2.6;
  const row3Y = 4.05;
  statCard(slide, 0.5, row1Y, 'Account Managers', String(rollup.totalAms));
  statCard(slide, 3.4, row1Y, 'Total Accounts', String(rollup.totalAccounts));
  statCard(slide, 6.3, row1Y, 'Total Communities', String(rollup.totalCommunities));

  statCard(slide, 0.5, row2Y, 'Avg Health Score', rollup.avgScore != null ? String(rollup.avgScore) : '—');
  statCard(slide, 3.4, row2Y, 'Open Tickets', String(rollup.openTickets));
  statCard(slide, 6.3, row2Y, 'Closed Tickets', String(rollup.closedTickets));

  statCard(slide, 0.5, row3Y, 'Top 3 Enhancement Requests', String(rollup.enhancementTopCount ?? 0));
  statCard(slide, 3.4, row3Y, 'Total ARR', usd(rollup.arrCents));
  statCard(slide, 6.3, row3Y, `ARR Added (${new Date().getFullYear()})`, usd(rollup.arrAddedThisYearCents));
}

const METRIC_LABELS = {
  totalAccounts: 'Total Accounts',
  totalCommunities: 'Total Communities',
  openTickets: 'Open Tickets',
  closedTickets: 'Closed Tickets',
  dealsThisYearOpen: `${new Date().getFullYear()} Open Deals`,
  dealsThisYearClosed: `${new Date().getFullYear()} Closed Deals`,
  arrCents: 'Total ARR',
  arrAddedThisYearCents: `ARR Added (${new Date().getFullYear()})`,
  avgScore: 'Avg Health Score',
};
const CURRENCY_METRICS = new Set(['arrCents', 'arrAddedThisYearCents']);

// Every metric the on-screen KPI-by-Account-Manager dropdown offers,
// same order — census/capacity excluded, same scoping as the Cards
// slide (Aaron's own call: this dashboard doesn't pull fresh occupancy
// data, so it doesn't belong in a portfolio-wide export yet).
const KPI_METRICS = [
  'avgScore', 'totalAccounts', 'totalCommunities', 'openTickets', 'closedTickets',
  'dealsThisYearOpen', 'dealsThisYearClosed', 'arrCents', 'arrAddedThisYearCents',
];

/** One metric/chart-type combination on the KPI-by-Account-Manager chart. */
function addKpiByAmSlide(pptx, rollupByAccountManager, metricKey, chartType) {
  const slide = pptx.addSlide();
  const label = METRIC_LABELS[metricKey] || metricKey;
  addSectionHeader(slide, `KPI by Account Manager — ${label}`);

  const data = rollupByAccountManager
    .map((r) => ({ name: r.accountManagerName, value: r[metricKey] || 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    slide.addText('No data for this metric.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const labels = data.map((d) => d.name);
  const values = data.map((d) => (CURRENCY_METRICS.has(metricKey) ? Math.round(d.value / 100) : d.value));

  if (chartType === 'pie') {
    slide.addChart(pptx.ChartType.doughnut, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      chartColors: CHART_PALETTE,
      showLegend: true, legendPos: 'r', legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: BRAND.slate,
      showValue: true, dataLabelColor: BRAND.white, dataLabelFontSize: 9,
    });
  } else {
    slide.addChart(pptx.ChartType.bar, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      barDir: 'bar',
      chartColors: [BRAND.glacier],
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 10, dataLabelColor: BRAND.onyx,
      catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
      valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
      showLegend: false,
    });
  }
}

/** Mirrors the on-screen Health Score Distribution chart — fixed Unhealthy→Healthy order, same band colors as the dashboard's ScoreBadge. */
function addHealthDistributionSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Health Score Distribution');

  const data = HEALTH_BANDS
    .map((band) => ({ name: band, value: accounts.filter((a) => a.health_band === band).length }))
    .filter((d) => d.value > 0);

  if (data.length === 0) {
    slide.addText('No scored accounts yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [{ name: 'Accounts', labels: data.map((d) => d.name), values: data.map((d) => d.value) }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'col',
    // pptxgenjs applies chartColors per data POINT only when there's a
    // single series and `valAxisTitle`-style per-point coloring is
    // requested via `chartColors` on a bar chart with one series — matches
    // the same per-slice coloring addBreakdownDoughnut already relies on.
    chartColors: data.map((d) => BAND_HEX[d.name]),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: false,
  });
}

/** Mirrors the on-screen Companies by Tier chart — straight headcount per client_tier bucket. */
function addCompaniesByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Companies by Tier');

  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => tierSortIndex(a.name) - tierSortIndex(b.name));

  if (data.length === 0) {
    slide.addText('No account data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [{ name: 'Companies', labels: data.map((d) => d.name), values: data.map((d) => d.value) }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'col',
    chartColors: [BRAND.flame],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: false,
  });
}

/** Mirrors the on-screen Tickets by Tier chart — open/closed as two clustered (side-by-side) series, not stacked, same reasoning as the client version: a tier heavy on closed tickets and one heavy on OPEN tickets read very differently for triage. */
function addTicketsByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Tickets by Tier');

  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    if (!byTier[key]) byTier[key] = { open: 0, closed: 0 };
    byTier[key].open += a.open_ticket_count || 0;
    byTier[key].closed += a.closed_ticket_count || 0;
  }
  const names = Object.keys(byTier)
    .filter((k) => byTier[k].open > 0 || byTier[k].closed > 0)
    .sort((a, b) => tierSortIndex(a) - tierSortIndex(b));

  if (names.length === 0) {
    slide.addText('No ticket data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [
    { name: 'Open', labels: names, values: names.map((n) => byTier[n].open) },
    { name: 'Closed', labels: names, values: names.map((n) => byTier[n].closed) },
  ], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'col',
    barGrouping: 'clustered',
    chartColors: [BRAND.scarlet, BRAND.glacier],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: BRAND.slate,
  });
}

const TIER_METRIC_LABELS = {
  arrCents: 'Total ARR',
  arrAddedThisYearCents: `ARR Added (${new Date().getFullYear()})`,
};
const TIER_METRICS = ['arrCents', 'arrAddedThisYearCents'];

/** One metric/chart-type combination on the ARR-by-Tier chart — same bar+pie-per-metric shape as addKpiByAmSlide, just grouped by client_tier instead of Account Manager. */
function addTierByArrSlide(pptx, accounts, metricKey, chartType) {
  const slide = pptx.addSlide();
  const label = TIER_METRIC_LABELS[metricKey] || metricKey;
  addSectionHeader(slide, `ARR by Tier — ${label}`);

  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    const value = metricKey === 'arrAddedThisYearCents' ? (a.arr_added_this_year_cents || 0) : (a.arr_cents || 0);
    byTier[key] = (byTier[key] || 0) + value;
  }
  const data = Object.entries(byTier)
    .map(([name, cents]) => ({ name, cents }))
    .filter((d) => d.cents !== 0)
    .sort((a, b) => tierSortIndex(a.name) - tierSortIndex(b.name));

  if (data.length === 0) {
    slide.addText('No data for this metric.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const labels = data.map((d) => d.name);
  const values = data.map((d) => Math.round(d.cents / 100));

  if (chartType === 'pie') {
    slide.addChart(pptx.ChartType.doughnut, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      chartColors: CHART_PALETTE,
      showLegend: true, legendPos: 'r', legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: BRAND.slate,
      showValue: true, dataLabelColor: BRAND.white, dataLabelFontSize: 9,
    });
  } else {
    slide.addChart(pptx.ChartType.bar, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      barDir: 'bar',
      chartColors: [BRAND.mint],
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 10, dataLabelColor: BRAND.onyx,
      catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
      valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
      showLegend: false,
    });
  }
}

/** Mirrors the on-screen Ticket Volume by AM by Tier chart — horizontal stacked bar, one series per tier, same combined open+closed-per-segment reasoning as the client version (the Tickets by Tier slide above already covers the open/closed split at the portfolio level). */
function addTicketsByAmByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Ticket Volume by Account Manager by Tier');

  const byAm = new Map();
  const tiersSeen = new Set();
  for (const a of accounts) {
    const am = a.account_manager_name || 'Unassigned';
    const tier = tierLabel(a.tier);
    tiersSeen.add(tier);
    if (!byAm.has(am)) byAm.set(am, {});
    const row = byAm.get(am);
    row[tier] = (row[tier] || 0) + (a.open_ticket_count || 0) + (a.closed_ticket_count || 0);
  }
  const tierKeys = [...tiersSeen].sort((a, b) => tierSortIndex(a) - tierSortIndex(b));
  const amNames = Array.from(byAm.keys())
    .filter((am) => tierKeys.some((t) => byAm.get(am)[t] > 0))
    .sort((a, b) => tierKeys.reduce((s, t) => s + (byAm.get(b)[t] || 0), 0) - tierKeys.reduce((s, t) => s + (byAm.get(a)[t] || 0), 0));

  if (amNames.length === 0) {
    slide.addText('No ticket data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const series = tierKeys.map((t) => ({
    name: t,
    labels: amNames,
    values: amNames.map((am) => byAm.get(am)[t] || 0),
  }));

  slide.addChart(pptx.ChartType.bar, series, {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'bar',
    barGrouping: 'stacked',
    chartColors: CHART_PALETTE,
    showValue: false,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 9, legendColor: BRAND.slate,
  });
}

const AT_RISK_PER_SLIDE = 5;
// Same reasoning as the client's isAtRisk (TeamAmDashboard.jsx) —
// Unhealthy and At Risk together, score < 60. Kept as a separate literal
// check here rather than imported, matching this codebase's established
// client/server duplication pattern for small predicates like this.
function isAtRisk(a) {
  return a.health_band === 'Unhealthy' || a.health_band === 'At Risk';
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * One page of the at-risk-accounts list — company/AM/score plus up to 3
 * "why" bullets. `riskReasons` is computed server-side once (see
 * explainRisk in accountHealthScoring.js, attached to each account by
 * getEnrichedTeamAmAccounts in teamAm.js) and reused as-is here — the
 * exact same reasons the on-screen At-Risk drawer shows, not a
 * separately-derived explanation.
 */
function addAtRiskAccountsSlide(pptx, pageAccounts, pageNum, totalPages) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, totalPages > 1 ? `At-Risk Accounts (${pageNum} of ${totalPages})` : 'At-Risk Accounts');

  let y = 1.05;
  for (const a of pageAccounts) {
    const scoreColor = a.health_band === 'Unhealthy' ? BAND_HEX.Unhealthy : BAND_HEX['At Risk'];
    slide.addText(
      [
        { text: a.company_name, options: { bold: true, color: BRAND.onyx, fontSize: 13 } },
        { text: `   ${a.account_manager_name || 'Unassigned'}   ·   Score ${a.health_score ?? '—'}`, options: { color: scoreColor, fontSize: 11, bold: true } },
      ],
      { x: 0.6, y, w: 8.8, h: 0.3, fontFace: FONT_BODY }
    );
    y += 0.32;

    const reasons = a.riskReasons?.length > 0 ? a.riskReasons.slice(0, 3) : ['No specific driver captured — score reflects the weighted composite'];
    slide.addText(
      reasons.map((r) => ({ text: r, options: { bullet: true, breakLine: true } })),
      { x: 0.8, y, w: 8.4, h: 0.6, fontFace: FONT_BODY, fontSize: 10, color: BRAND.slate, lineSpacingMultiple: 1.1 }
    );
    y += reasons.length * 0.2 + 0.18;
    if (a.riskReasons?.length > 3) {
      slide.addText(`+${a.riskReasons.length - 3} more factor(s)`, { x: 0.8, y: y - 0.18, w: 8.4, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.smoke });
    }
  }
}

/** Paginates the at-risk list across as many slides as needed (Aaron, Sep 2026: "multiple slides if needed"), sorted weakest-first. */
function addAtRiskSlides(pptx, accounts) {
  const atRisk = accounts.filter(isAtRisk).sort((a, b) => (a.health_score ?? 999) - (b.health_score ?? 999));

  if (atRisk.length === 0) {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'At-Risk Accounts');
    slide.addText('No at-risk accounts this refresh.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const pages = chunk(atRisk, AT_RISK_PER_SLIDE);
  pages.forEach((page, i) => addAtRiskAccountsSlide(pptx, page, i + 1, pages.length));
}

/**
 * @param {object} rollup - portfolio-wide rollup (same shape as the client's `rollup` useMemo)
 * @param {Array} rollupByAccountManager - per-AM rollup array (from GET /api/team-am)
 * @param {Array} accounts - enriched accounts (from GET /api/team-am)
 */
async function renderTeamAmPpt(rollup, rollupByAccountManager, accounts) {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'ALIS_HUB', width: 10, height: 5.63 });
  pptx.layout = 'ALIS_HUB';

  addTitleSlide(pptx, rollup);
  addIndexSlide(pptx, accounts);
  addCardsSlide(pptx, rollup);
  // One KPI per slide (Aaron, Sep 2026) — both a bar and a pie slide for
  // every metric the on-screen dropdown offers, bar immediately followed
  // by its pie counterpart so reviewing metric-by-metric reads naturally,
  // rather than grouping all bars first then all pies.
  for (const metricKey of KPI_METRICS) {
    addKpiByAmSlide(pptx, rollupByAccountManager, metricKey, 'bar');
    addKpiByAmSlide(pptx, rollupByAccountManager, metricKey, 'pie');
  }
  addHealthDistributionSlide(pptx, accounts);
  addCompaniesByTierSlide(pptx, accounts);
  addTicketsByTierSlide(pptx, accounts);
  for (const metricKey of TIER_METRICS) {
    addTierByArrSlide(pptx, accounts, metricKey, 'bar');
    addTierByArrSlide(pptx, accounts, metricKey, 'pie');
  }
  addTicketsByAmByTierSlide(pptx, accounts);
  addAtRiskSlides(pptx, accounts);

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { renderTeamAmPpt };
