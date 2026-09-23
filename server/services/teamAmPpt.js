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

// Canonical tier palette (Sep 2026, Aaron: "verify that all tier related
// reports are consistent with 1 = green, 2 = blue, 3 = orange, 4 = red")
// — same hex values as the client's TIER_COST_COLOR (TeamAmDashboard.jsx),
// just without the leading '#' pptxgenjs expects. _DARK mirrors
// TIER_COST_COLOR_DARK, used for "Closed" series so they read as the same
// tier at a glance while staying visually distinct from "Open". No Tier 5
// entry (matches the client — falls back to Unassigned's gray via the
// helpers below, same `|| '#737373'` pattern used on-screen).
const TIER_COLOR = { 'Tier 1': '16A34A', 'Tier 2': '2563EB', 'Tier 3': 'EA580C', 'Tier 4': 'DC2626', Unassigned: '737373' };
const TIER_COLOR_DARK = { 'Tier 1': '15803D', 'Tier 2': '1D4ED8', 'Tier 3': 'C2410C', 'Tier 4': 'B91C1C', Unassigned: '525252' };
function tierColor(name) {
  return TIER_COLOR[name] || TIER_COLOR.Unassigned;
}
function tierColorDark(name) {
  return TIER_COLOR_DARK[name] || TIER_COLOR_DARK.Unassigned;
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
  slide.addText(`${totalAccounts} accounts across ${totalAms} AMs`, {
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
 *
 * Rendered as two columns (Aaron, Sep 2026) — the full run list ran to
 * ~19 lines, which overflowed a single 4.0"-tall column and collided
 * with the title. Split at the KPI-by-AM section boundary so each
 * column holds one coherent group of top-level entries rather than an
 * arbitrary line-count midpoint.
 */
function addIndexSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Contents');

  const sortedAtRisk = getSortedAtRisk(accounts);
  const atRiskCount = sortedAtRisk.length;
  const atRiskPages = paginateAtRisk(sortedAtRisk).length || 1;

  const heading = (text) => ({ text, options: { bullet: true, bold: true, color: BRAND.onyx, breakLine: true } });
  const subItem = (text) => ({ text, options: { bullet: true, indentLevel: 1, color: BRAND.slate, breakLine: true } });

  const column1 = [
    heading('Overview'),
    heading('KPI by AM'),
    ...KPI_METRICS.map((key) => subItem(`${METRIC_LABELS[key]}  (Bar + Pie)`)),
    heading('Onboarding'),
    heading('Health Score Distribution  (+ Trend)'),
    heading('Tickets: Escalation'),
    heading('Enhancement Requests: Top 3'),
    heading('Enhancement Requests'),
    heading('Tickets: Open by Category 2.0'),
    heading('Tickets: Closed by Category 2.0'),
  ];

  const column2 = [
    heading('Ticket Activity'),
    heading('Companies by Tier'),
    heading('Communities by Tier'),
    heading('Companies by Tier by AM'),
    heading('Communities by AM by Tier'),
    heading('ARR by Tier per AM'),
    heading('Tickets by Tier'),
    heading('Cost to Serve by Tier'),
    heading('Deals by Type  (Bar + Pie)'),
    subItem('Trend'),
    heading('ARR Added This Year'),
    heading('All Deals'),
    heading('ARR by Tier'),
    ...TIER_METRICS.map((key) => subItem(`${TIER_METRIC_LABELS[key]}  (Bar + Pie)`)),
    heading('Ticket Volume by AM by Tier'),
    heading('Unassigned Tier Companies'),
    heading('Needs an AM'),
    heading(`At-Risk Accounts  (${atRiskCount} account${atRiskCount === 1 ? '' : 's'}${atRiskPages > 1 ? `, ${atRiskPages} slides` : ''})`),
  ];

  slide.addText(column1, { x: 0.6, y: 1.2, w: 4.2, h: 4.35, fontFace: FONT_BODY, fontSize: 11, lineSpacingMultiple: 1.2 });
  slide.addText(column2, { x: 5.2, y: 1.2, w: 4.2, h: 4.35, fontFace: FONT_BODY, fontSize: 11, lineSpacingMultiple: 1.2 });
}

// Rotating accent per card (Aaron, Sep 2026: "make it pop a bit more") —
// warm/cool brand accents used as a thin highlight bar + colored value
// text, per the brand guide's tile/card rule ("Fuego gradient or Amber
// as accent bars... only" — cards stay white, color is an accent, not
// a dominant background). Scarlet and slate are skipped: scarlet is an
// alert-only shade per the brand guide, slate is already the label color.
const CARD_ACCENTS = [BRAND.amber, BRAND.glacier, BRAND.mint, BRAND.marigold, BRAND.flame];

function statCard(slide, x, y, label, valueStr, accent) {
  slide.addShape('roundRect', { x, y, w: 2.75, h: 1.3, rectRadius: 0.08, fill: { color: BRAND.cardBg }, line: { color: BRAND.cardBorder, width: 1 } });
  slide.addShape('rect', { x: x + 0.15, y: y + 0.12, w: 0.4, h: 0.06, fill: { color: accent }, line: { type: 'none' } });
  slide.addText(label, { x: x + 0.15, y: y + 0.28, w: 2.45, h: 0.4, fontFace: FONT_BODY, fontSize: 10, color: BRAND.slate });
  slide.addText(valueStr, { x: x + 0.15, y: y + 0.68, w: 2.45, h: 0.55, fontFace: FONT_HEAD, fontSize: 22, bold: true, color: accent });
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
  statCard(slide, 0.5, row1Y, 'AMs', String(rollup.totalAms), CARD_ACCENTS[0]);
  statCard(slide, 3.4, row1Y, 'Total Accounts', String(rollup.totalAccounts), CARD_ACCENTS[1]);
  statCard(slide, 6.3, row1Y, 'Total Communities', String(rollup.totalCommunities), CARD_ACCENTS[2]);

  statCard(slide, 0.5, row2Y, 'Avg Health Score', rollup.avgScore != null ? String(rollup.avgScore) : '—', CARD_ACCENTS[3]);
  statCard(slide, 3.4, row2Y, 'Open Tickets', String(rollup.openTickets), CARD_ACCENTS[4]);
  statCard(slide, 6.3, row2Y, 'Closed Tickets', String(rollup.closedTickets), CARD_ACCENTS[0]);

  statCard(slide, 0.5, row3Y, 'Enhancement Requests: Top 3', String(rollup.enhancementTopCount ?? 0), CARD_ACCENTS[1]);
  statCard(slide, 3.4, row3Y, 'Total ARR', usd(rollup.arrCents), CARD_ACCENTS[2]);
  statCard(slide, 6.3, row3Y, `ARR Added (${new Date().getFullYear()})`, usd(rollup.arrAddedThisYearCents), CARD_ACCENTS[3]);
}

const METRIC_LABELS = {
  totalAccounts: 'Total Accounts',
  totalCommunities: 'Total Communities',
  openTickets: 'Open Tickets',
  closedTickets: 'Closed Tickets',
  dealsThisYearOpen: `${new Date().getFullYear()} Open Deals`,
  dealsThisYearClosed: `${new Date().getFullYear()} Closed Deals`,
  arrCents: 'Total ARR',
  // Split (Sep 2026, Aaron) — see computeRollupByAccountManager's own doc
  // comment (server/api/teamAm.js) for why these are two different
  // numbers, not a rename of one: "Added to Book" is account-owner-based
  // (workload), "Personally Closed" is deal-owner-based (productivity).
  arrAddedToBookCents: `ARR Added to Book (${new Date().getFullYear()})`,
  arrPersonallyClosedCents: `ARR Personally Closed (${new Date().getFullYear()})`,
  avgScore: 'Avg Health Score',
};
const CURRENCY_METRICS = new Set(['arrCents', 'arrAddedToBookCents', 'arrPersonallyClosedCents']);

// Every metric the on-screen KPI-by-Account-Manager dropdown offers,
// same order — census/capacity excluded, same scoping as the Cards
// slide (Aaron's own call: this dashboard doesn't pull fresh occupancy
// data, so it doesn't belong in a portfolio-wide export yet).
const KPI_METRICS = [
  'avgScore', 'totalAccounts', 'totalCommunities', 'openTickets', 'closedTickets',
  'dealsThisYearOpen', 'dealsThisYearClosed', 'arrCents', 'arrAddedToBookCents', 'arrPersonallyClosedCents',
];

/** One metric/chart-type combination on the KPI-by-Account-Manager chart. */
function addKpiByAmSlide(pptx, rollupByAccountManager, metricKey, chartType) {
  const slide = pptx.addSlide();
  const label = METRIC_LABELS[metricKey] || metricKey;
  addSectionHeader(slide, `KPI by AM — ${label}`);

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
    // Per-tier colors (Sep 2026 tier-color pass) — a single-series chart
    // colors per CATEGORY when chartColors is an array, same trick
    // addHealthDistributionSlide already relies on for its per-band colors.
    chartColors: data.map((d) => tierColor(d.name)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: false,
  });
}

/**
 * Compact "● Tier — N (P%)" text list rendered beside/under a bar chart —
 * the pragmatic way to add percentage context to a pptxgenjs BAR chart,
 * whose native data labels can only show the raw series value, not a
 * custom combined "N (P%)" string per point (doughnut/pie charts support
 * `showPercent` natively; bar charts don't have an equivalent). One line
 * per tier, colored to match that tier's bar.
 */
function addTierPercentLegend(slide, x, y, w, items) {
  const lines = items.map((it) => ({
    text: `●  ${it.name} — ${it.value} (${it.pct}%)`,
    options: { color: it.color, breakLine: true },
  }));
  slide.addText(lines, { x, y, w, h: items.length * 0.22 + 0.1, fontFace: FONT_BODY, fontSize: 10, lineSpacingMultiple: 1.15 });
}

/**
 * Mirrors the on-screen Tickets by Tier chart's tier-colored redesign
 * (Sep 2026, Aaron: "use the tier colors to recolor this red and blue
 * graph... darker shades of the tier colors representing closed
 * tickets," then "add percentages to the labels"). Rendered as two
 * single-series bar charts side by side (Open tier-colored, Closed a
 * darker shade of the same tier colors) rather than one clustered
 * two-series chart — pptxgenjs only colors per-CATEGORY when a chart has
 * a single series (see tierColor's callers elsewhere in this file); a
 * clustered two-series chart colors per-series instead, which can't
 * reproduce the client's per-Cell "every bar its own tier color"
 * treatment. Percentages shown via addTierPercentLegend beneath each
 * chart (Open % of open total, Closed % of closed total — same
 * denominator the on-screen pctOf uses).
 */
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

  const openTotal = names.reduce((s, n) => s + byTier[n].open, 0);
  const closedTotal = names.reduce((s, n) => s + byTier[n].closed, 0);
  const pctOf = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

  slide.addText('Open', { x: 0.4, y: 1.0, w: 4.3, h: 0.28, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx, align: 'center' });
  slide.addChart(pptx.ChartType.bar, [{ name: 'Open', labels: names, values: names.map((n) => byTier[n].open) }], {
    x: 0.4, y: 1.3, w: 4.3, h: 2.5,
    barDir: 'col',
    chartColors: names.map((n) => tierColor(n)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 9,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });
  addTierPercentLegend(slide, 0.4, 3.9, 4.3, names.map((n) => ({ name: n, value: byTier[n].open, pct: pctOf(byTier[n].open, openTotal), color: tierColor(n) })));

  slide.addText('Closed', { x: 5.3, y: 1.0, w: 4.3, h: 0.28, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx, align: 'center' });
  slide.addChart(pptx.ChartType.bar, [{ name: 'Closed', labels: names, values: names.map((n) => byTier[n].closed) }], {
    x: 5.3, y: 1.3, w: 4.3, h: 2.5,
    barDir: 'col',
    chartColors: names.map((n) => tierColorDark(n)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 9,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });
  addTierPercentLegend(slide, 5.3, 3.9, 4.3, names.map((n) => ({ name: n, value: byTier[n].closed, pct: pctOf(byTier[n].closed, closedTotal), color: tierColorDark(n) })));
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
  const grandTotal = values.reduce((s, v) => s + v, 0);
  const pctOf = (v) => (grandTotal > 0 ? Math.round((v / grandTotal) * 100) : 0);

  if (chartType === 'pie') {
    slide.addChart(pptx.ChartType.doughnut, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      // Per-tier colors (Sep 2026 tier-color pass), replacing the generic
      // rotating CHART_PALETTE this used before.
      chartColors: labels.map((l) => tierColor(l)),
      showLegend: true, legendPos: 'r', legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: BRAND.slate,
      // showPercent (Sep 2026, Aaron: "add percentages to the labels") —
      // pptxgenjs doughnut/pie charts natively combine showValue+showPercent
      // into one "$X (Y%)"-style label, unlike bar charts (see the bar
      // branch below, which needs addTierPercentLegend instead).
      showValue: true, showPercent: true, dataLabelColor: BRAND.white, dataLabelFontSize: 9,
    });
  } else {
    slide.addChart(pptx.ChartType.bar, [{ name: label, labels, values }], {
      x: 0.5, y: 1.1, w: 6.3, h: 4.0,
      barDir: 'bar',
      chartColors: labels.map((l) => tierColor(l)),
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 10, dataLabelColor: BRAND.onyx,
      catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
      valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
      showLegend: false,
    });
    addTierPercentLegend(slide, 7.0, 1.6, 2.6, data.map((d) => ({ name: d.name, value: usd(d.cents), pct: pctOf(Math.round(d.cents / 100)), color: tierColor(d.name) })));
  }
}

/** Mirrors the on-screen Ticket Volume by AM by Tier chart — horizontal stacked bar, one series per tier, same combined open+closed-per-segment reasoning as the client version (the Tickets by Tier slide above already covers the open/closed split at the portfolio level). */
function addTicketsByAmByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Ticket Volume by AM by Tier');

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
    // Per-tier colors (Sep 2026 tier-color pass) — each SERIES here is one
    // tier (tierKeys.map above), so chartColors[i] naturally lines up with
    // series i without needing the single-series per-category trick the
    // other tier charts in this file use.
    chartColors: tierKeys.map((t) => tierColor(t)),
    showValue: false,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 9, legendColor: BRAND.slate,
  });
}

// Same unset handling as tierLabel's "Unassigned" bucket — no client_tier
// property set (or the literal 0) in HubSpot. Duplicated from the
// client's identical isUnassignedTier (TeamAmDashboard.jsx).
function isUnassignedTier(a) {
  return a.tier == null || a.tier === 0;
}

/**
 * "Unassigned Tier Companies" (Sep 2026, Aaron: "add a view unassigned
 * Tier companies link") — mirrors the on-screen UnassignedTierDrawer's
 * AM-then-company sort. Capped at UNASSIGNED_TIER_SLIDE_CAP rows across
 * two columns rather than paginated like At-Risk: a portfolio-wide "needs
 * tiering" list can run long, and this snapshot is meant to prompt
 * follow-up, not replace the drawer's own "Export to Excel" button for a
 * complete, workable list.
 */
const UNASSIGNED_TIER_SLIDE_CAP = 24;

function addUnassignedTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Unassigned Tier Companies');

  const unassigned = accounts
    .filter(isUnassignedTier)
    .sort((a, b) => (a.account_manager_name || '').localeCompare(b.account_manager_name || '') || a.company_name.localeCompare(b.company_name));

  if (unassigned.length === 0) {
    slide.addText('Every account has a Client Tier set — nothing to clean up.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addText(`${unassigned.length} account${unassigned.length === 1 ? '' : 's'} with no Client Tier set in HubSpot`, {
    x: 0.5, y: 0.95, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });

  const shown = unassigned.slice(0, UNASSIGNED_TIER_SLIDE_CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];

  cols.forEach((col, i) => {
    const lines = col.map((a) => ({
      text: `${a.company_name}  ·  ${a.account_manager_name || 'Unassigned'}  ·  ${usd(a.arr_cents)} ARR`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 1.35, w: 4.4, h: 3.9, fontFace: FONT_BODY, fontSize: 10, color: BRAND.onyx, lineSpacingMultiple: 1.25 });
  });

  if (unassigned.length > UNASSIGNED_TIER_SLIDE_CAP) {
    slide.addText(`+${unassigned.length - UNASSIGNED_TIER_SLIDE_CAP} more — see the on-screen drawer's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.25, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.smoke,
    });
  }
}

// Same reasoning as the client's isAtRisk (TeamAmDashboard.jsx) —
// Unhealthy and At Risk together, score < 60. Kept as a separate literal
// check here rather than imported, matching this codebase's established
// client/server duplication pattern for small predicates like this.
function isAtRisk(a) {
  return a.health_band === 'Unhealthy' || a.health_band === 'At Risk';
}

function getSortedAtRisk(accounts) {
  return accounts.filter(isAtRisk).sort((a, b) => (a.health_score ?? 999) - (b.health_score ?? 999));
}

// Two columns per slide (Aaron, Sep 2026), paginated by estimated
// rendered height rather than a fixed account count — a fixed
// AT_RISK_PER_SLIDE=5 in a single column was overflowing the slide
// (accounts with 3 reasons run ~1.1" tall; 5 of them is ~5.5" against a
// ~5.63"-tall slide with no room for the title). Height-based pagination
// with a bottom buffer means a slide can never run off the page
// regardless of how many risk reasons a given account has.
const AT_RISK_TOP_Y = 1.05;
const AT_RISK_BOTTOM_BUFFER = 0.35;
const AT_RISK_MAX_COL_HEIGHT = 5.63 - AT_RISK_TOP_Y - AT_RISK_BOTTOM_BUFFER;
const AT_RISK_COL_X = [0.5, 5.2];
const AT_RISK_COL_W = 4.3;

function atRiskAccountHeight(a) {
  const reasons = a.riskReasons?.length > 0 ? Math.min(a.riskReasons.length, 3) : 1;
  const moreFactorsLine = a.riskReasons?.length > 3 ? 0.2 : 0;
  return 0.32 + reasons * 0.2 + 0.18 + moreFactorsLine;
}

/** Greedily fills column 1 then column 2 up to AT_RISK_MAX_COL_HEIGHT per slide, spilling to a new slide/page once both columns are full. */
function paginateAtRisk(atRisk) {
  const pages = [];
  let i = 0;
  while (i < atRisk.length) {
    const cols = [[], []];
    for (const col of cols) {
      let h = 0;
      while (i < atRisk.length) {
        const accH = atRiskAccountHeight(atRisk[i]);
        if (h + accH > AT_RISK_MAX_COL_HEIGHT && col.length > 0) break;
        col.push(atRisk[i]);
        h += accH;
        i++;
      }
    }
    pages.push(cols);
  }
  return pages;
}

/**
 * One page of the at-risk-accounts list, rendered as two columns —
 * company/AM/score plus up to 3 "why" bullets. `riskReasons` is computed
 * server-side once (see explainRisk in accountHealthScoring.js, attached
 * to each account by getEnrichedTeamAmAccounts in teamAm.js) and reused
 * as-is here — the exact same reasons the on-screen At-Risk drawer
 * shows, not a separately-derived explanation.
 */
function addAtRiskAccountsSlide(pptx, pageCols, pageNum, totalPages) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, totalPages > 1 ? `At-Risk Accounts (${pageNum} of ${totalPages})` : 'At-Risk Accounts');

  pageCols.forEach((colAccounts, colIdx) => {
    const x = AT_RISK_COL_X[colIdx];
    let y = AT_RISK_TOP_Y;
    for (const a of colAccounts) {
      const scoreColor = a.health_band === 'Unhealthy' ? BAND_HEX.Unhealthy : BAND_HEX['At Risk'];
      slide.addText(
        [
          { text: a.company_name, options: { bold: true, color: BRAND.onyx, fontSize: 12 } },
          { text: `   ${a.account_manager_name || 'Unassigned'}   ·   Score ${a.health_score ?? '—'}`, options: { color: scoreColor, fontSize: 10, bold: true } },
        ],
        { x, y, w: AT_RISK_COL_W, h: 0.3, fontFace: FONT_BODY }
      );
      y += 0.32;

      const reasons = a.riskReasons?.length > 0 ? a.riskReasons.slice(0, 3) : ['No specific driver captured — score reflects the weighted composite'];
      slide.addText(
        reasons.map((r) => ({ text: r, options: { bullet: true, breakLine: true } })),
        { x: x + 0.2, y, w: AT_RISK_COL_W - 0.2, h: 0.6, fontFace: FONT_BODY, fontSize: 9, color: BRAND.slate, lineSpacingMultiple: 1.1 }
      );
      y += reasons.length * 0.2 + 0.18;
      if (a.riskReasons?.length > 3) {
        slide.addText(`+${a.riskReasons.length - 3} more factor(s)`, { x: x + 0.2, y: y - 0.18, w: AT_RISK_COL_W - 0.2, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.smoke });
        y += 0.2;
      }
    }
  });
}

/** Paginates the at-risk list across as many slides as needed (Aaron, Sep 2026: "multiple slides if needed"), sorted weakest-first, two columns per slide. */
function addAtRiskSlides(pptx, accounts) {
  const atRisk = getSortedAtRisk(accounts);

  if (atRisk.length === 0) {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'At-Risk Accounts');
    slide.addText('No at-risk accounts this refresh.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const pages = paginateAtRisk(atRisk);
  pages.forEach((cols, i) => addAtRiskAccountsSlide(pptx, cols, i + 1, pages.length));
}

// Same terminal-status set as the client's isOpenProject (TeamAmDashboard.jsx)
// — Completed/Cancelled/Merged read as closed, everything else as open.
const TERMINAL_PROJECT_STATUSES = new Set(['Completed', 'Cancelled', 'Merged']);
function isOpenProject(p) {
  return !TERMINAL_PROJECT_STATUSES.has(p.projectStatus);
}
function daysSince(iso) {
  return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

/**
 * Trailing-12-months volume of implementation-tracked deals, by creation
 * month — same non-tier "total" shape and creation-date-bucketing caveat
 * as the client's computeProjectVolumeSeries (KpiDashboard.jsx): HubSpot
 * only exposes project_status's CURRENT value, not a history of when a
 * project actually changed status, so this is the closest honest trend
 * available. `cumulative` seeds the first month with every matching item
 * created before the visible window, then adds a running total — used
 * for "Total Open Projects" so the final month lands on the same count
 * as the Onboarding stat card; "Closed Projects (that month)" stays a
 * plain per-month count.
 */
function computeProjectVolumeSeries(items, cumulative) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  let running = cumulative
    ? items.filter((p) => p.createdAt && new Date(p.createdAt) < months[0]).length
    : 0;

  return months.map((monthStart) => {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    let count = 0;
    for (const p of items) {
      if (!p.createdAt) continue;
      const d = new Date(p.createdAt);
      if (d < monthStart || d > monthEnd) continue;
      count += 1;
    }
    if (!cumulative) return { label, total: count };
    running += count;
    return { label, total: running };
  });
}

/**
 * "Onboarding" (Sep 2026) — portfolio-wide implementation-tracked deals,
 * mirroring the on-screen OnboardingVolumeChart's default (non-tier-broken-
 * out) view: a "Total Open Projects" line (cumulative, so it ends on the
 * same count as the stat row) plus a "Closed Projects (that month)" line
 * (plain per-month count). Sourced from each account's
 * financialHealth.implementationProjects — already attached to every
 * enriched account by getEnrichedTeamAmAccounts, so no extra data pull is
 * needed here. Tier breakout and per-project detail stay on-screen only
 * (see ImplementationProjectsSection) — a portfolio-wide export is about
 * the trend, not the full worklist.
 */
function addOnboardingSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Onboarding');

  const projects = accounts.flatMap((a) => (a.financialHealth?.implementationProjects || []).map((p) => ({ ...p, tier: a.tier })));
  if (projects.length === 0) {
    slide.addText('No implementation-tracked deals yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const openProjects = projects.filter(isOpenProject);
  const closedProjects = projects.filter((p) => !isOpenProject(p));
  const avgDaysOpen = openProjects.length > 0
    ? Math.round(openProjects.reduce((s, p) => s + (daysSince(p.createdAt) || 0), 0) / openProjects.length)
    : null;

  statCard(slide, 0.5, 0.95, 'Open Projects', String(openProjects.length), CARD_ACCENTS[0]);
  statCard(slide, 3.4, 0.95, 'Closed Projects', String(closedProjects.length), CARD_ACCENTS[1]);
  statCard(slide, 6.3, 0.95, 'Avg Days Open', avgDaysOpen != null ? String(avgDaysOpen) : '—', CARD_ACCENTS[2]);

  const openSeries = computeProjectVolumeSeries(openProjects, true);
  const closedMonthly = computeProjectVolumeSeries(closedProjects, false);
  const labels = openSeries.map((r) => r.label);

  slide.addText('Total Open Projects vs. Closed Projects (that month) — trailing 12 months', {
    x: 0.5, y: 2.45, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });
  slide.addChart(pptx.ChartType.line, [
    { name: 'Total Open Projects', labels, values: openSeries.map((r) => r.total) },
    { name: 'Closed Projects (that month)', labels, values: closedMonthly.map((r) => r.total) },
  ], {
    x: 0.5, y: 2.8, w: 9, h: 2.6,
    chartColors: ['7C3AED', '0891B2'],
    lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    showValue: false,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 8,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 9, legendColor: BRAND.slate,
  });
}

/**
 * "Health Score Trend" (Sep 2026, Aaron: "capture the progress of this
 * kpi over time... I plan on improving my average 85 and want to capture
 * the effort and result") — portfolio Avg Health Score, one point per day
 * a portal-wide refresh has run (health_score_history, scope='team_am').
 * A brand-new metric with no backfill possible, so a short/empty history
 * is expected at first, not an error.
 */
function addHealthScoreTrendSlide(pptx, healthScoreHistory) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Health Score Trend');

  if (!healthScoreHistory || healthScoreHistory.length < 2) {
    slide.addText('Not enough history yet — a point is captured every time this dashboard is refreshed.', {
      x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center',
    });
    return;
  }

  slide.addChart(pptx.ChartType.line, [{
    name: 'Avg Health Score',
    labels: healthScoreHistory.map((h) => h.recorded_date),
    values: healthScoreHistory.map((h) => h.avg_health_score),
  }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    chartColors: ['7C3AED'],
    lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    showValue: true, dataLabelPosition: 't', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 10, dataLabelColor: BRAND.onyx,
    valAxisMinVal: 0, valAxisMaxVal: 100,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 9,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });
}

// ---------------------------------------------------------------------
// New slides (Sep 2026) — the on-screen dashboard picked up a long list
// of sections (Companies/Communities/ARR by Tier by AM, Communities by
// Tier, Cost to Serve, Deals by Type, ARR Added This Year, All Deals,
// Enhancement Requests, Tickets: Escalation, Needs an AM, Ticket
// Activity, Category 2.0 mix) that this export never caught up to.
// Grouped in one block rather than interleaved throughout the file so
// this diff stays reviewable — call order inside renderTeamAmPpt is
// what actually determines where each one lands in the deck, not its
// position here.
// ---------------------------------------------------------------------

/** Mirrors addCompaniesByTierSlide, summing active_community_count instead of counting accounts. */
function addCommunitiesByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Communities by Tier');

  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    byTier[key] = (byTier[key] || 0) + (a.active_community_count || 0);
  }
  const data = Object.entries(byTier)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => tierSortIndex(a.name) - tierSortIndex(b.name));

  if (data.length === 0) {
    slide.addText('No community data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [{ name: 'Communities', labels: data.map((d) => d.name), values: data.map((d) => d.value) }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'col',
    chartColors: data.map((d) => tierColor(d.name)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: false,
  });
}

/**
 * Shared stacked-bar-per-AM-by-tier builder, generalizing
 * addTicketsByAmByTierSlide's body for the 3 new "X by Tier by AM"
 * slides (Companies, Communities, ARR) — same sort-AMs-by-total-desc,
 * stacked/per-tier-colored shape, just parameterized on what gets
 * summed per account (`valueFn`) and whether that sum is cents
 * (`isCurrency`, for $-formatted data labels and a /100 conversion).
 * addTicketsByAmByTierSlide itself is left untouched rather than
 * rewritten to call this, per the "don't touch existing slides" rule.
 */
function addStackedByAmByTierSlide(pptx, accounts, { title, valueFn, isCurrency }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, title);

  const byAm = new Map();
  const tiersSeen = new Set();
  for (const a of accounts) {
    const am = a.account_manager_name || 'Unassigned';
    const tier = tierLabel(a.tier);
    tiersSeen.add(tier);
    if (!byAm.has(am)) byAm.set(am, {});
    const row = byAm.get(am);
    row[tier] = (row[tier] || 0) + valueFn(a);
  }
  const tierKeys = [...tiersSeen].sort((a, b) => tierSortIndex(a) - tierSortIndex(b));
  const amNames = Array.from(byAm.keys())
    .filter((am) => tierKeys.some((t) => byAm.get(am)[t] > 0))
    .sort((a, b) => tierKeys.reduce((s, t) => s + (byAm.get(b)[t] || 0), 0) - tierKeys.reduce((s, t) => s + (byAm.get(a)[t] || 0), 0));

  if (amNames.length === 0) {
    slide.addText('No data for this chart yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const series = tierKeys.map((t) => ({
    name: t,
    labels: amNames,
    values: amNames.map((am) => {
      const raw = byAm.get(am)[t] || 0;
      return isCurrency ? Math.round(raw / 100) : raw;
    }),
  }));

  slide.addChart(pptx.ChartType.bar, series, {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'bar',
    barGrouping: 'stacked',
    chartColors: tierKeys.map((t) => tierColor(t)),
    showValue: true, dataLabelFormatCode: isCurrency ? '"$"#,##0' : '#,##0', dataLabelPosition: 'ctr', dataLabelColor: BRAND.white, dataLabelFontSize: 8,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 9, legendColor: BRAND.slate,
  });
}

/** Bar-chart mirror of the on-screen CostToServeByTierChart — tickets (open + closed-this-year) per $1,000 of tier ARR, tiers with no ARR excluded. */
function addCostToServeByTierSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Cost to Serve by Tier');

  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    if (!byTier[key]) byTier[key] = { tickets: 0, arrCents: 0 };
    byTier[key].tickets += (a.open_ticket_count || 0) + (a.serviceHealth?.closedTicketCountThisYear || 0);
    byTier[key].arrCents += (a.arr_cents || 0);
  }
  const data = Object.entries(byTier)
    .filter(([, d]) => d.arrCents > 0)
    .map(([name, d]) => ({ name, ratio: (d.tickets * 100000) / d.arrCents }))
    .sort((a, b) => tierSortIndex(a.name) - tierSortIndex(b.name));

  if (data.length === 0) {
    slide.addText('No ARR/ticket data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [{ name: 'Tickets per $1,000 ARR', labels: data.map((d) => d.name), values: data.map((d) => Math.round(d.ratio * 100) / 100) }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'col',
    chartColors: data.map((d) => tierColor(d.name)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
    valAxisTitle: 'Tickets per $1,000 ARR', showValAxisTitle: true, valAxisTitleFontFace: FONT_BODY, valAxisTitleFontSize: 10, valAxisTitleColor: BRAND.slate,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 10,
    showLegend: false,
  });
}

/** Mirrors the on-screen DealTypeChart — every account's financialHealth.dealsByType summed portfolio-wide, plotting deal COUNT (the metric the on-screen tooltip leads with), sorted desc. Bar/pie pair, same shape as addKpiByAmSlide. */
function addDealsByTypeSlide(pptx, accounts, chartType) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Deals by Type');

  const byType = {};
  for (const a of accounts) {
    const mix = a.financialHealth?.dealsByType || {};
    for (const [type, v] of Object.entries(mix)) {
      if (!byType[type]) byType[type] = { count: 0, valueCents: 0 };
      byType[type].count += v.count || 0;
      byType[type].valueCents += v.valueCents || 0;
    }
  }
  const data = Object.entries(byType)
    .map(([name, v]) => ({ name, count: v.count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    slide.addText('No deal data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const labels = data.map((d) => d.name);
  const values = data.map((d) => d.count);

  if (chartType === 'pie') {
    slide.addChart(pptx.ChartType.doughnut, [{ name: 'Deals', labels, values }], {
      x: 0.5, y: 1.1, w: 9, h: 4.2,
      chartColors: CHART_PALETTE,
      showLegend: true, legendPos: 'r', legendFontFace: FONT_BODY, legendFontSize: 10, legendColor: BRAND.slate,
      showValue: true, dataLabelColor: BRAND.white, dataLabelFontSize: 9,
    });
  } else {
    slide.addChart(pptx.ChartType.bar, [{ name: 'Deals', labels, values }], {
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

/**
 * "Deals by Type — Total ARR Trend" — same single-line-trend shape as
 * addHealthScoreTrendSlide, fed by kpiMetricHistory.dealsByTypeTotalArr
 * (recorded in cents — see getKpiMetricHistory). Values converted to
 * dollars for display and NOT clamped to a 0-100 axis (unlike the
 * health score trend) since ARR has no natural ceiling.
 */
function addDealsByTypeTrendSlide(pptx, kpiMetricHistory) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Deals by Type — Total ARR Trend');

  const history = kpiMetricHistory?.dealsByTypeTotalArr;
  if (!history || history.length < 2) {
    slide.addText('Not enough history yet — a point is captured every time this dashboard is refreshed.', {
      x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center',
    });
    return;
  }

  slide.addChart(pptx.ChartType.line, [{
    name: 'Total ARR (all deal types)',
    labels: history.map((h) => h.recorded_date),
    values: history.map((h) => Math.round((h.value || 0) / 100)),
  }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    chartColors: ['7C3AED'],
    lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    showValue: true, dataLabelFormatCode: '"$"#,##0', dataLabelPosition: 't', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 9,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });
}

/** Same shape as the client's flattenArrAddedDeals (TeamAmDashboard.jsx) — every account's financialHealth.arrAddedThisYearDeals, tagged with company/AM/tier context. */
function flattenArrAddedThisYearDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      rows.push({ ...d, companyName: a.company_name, accountManagerName: a.account_manager_name || 'Unassigned', tier: a.tier });
    }
  }
  return rows;
}

const DEAL_LIST_SLIDE_CAP = 24;

/** "ARR Added This Year" — stat line + capped two-column list, same visual pattern as addUnassignedTierSlide, sorted largest ARR first. */
function addArrAddedThisYearSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'ARR Added This Year');

  const deals = flattenArrAddedThisYearDeals(accounts).sort((a, b) => (b.arrValueCents || 0) - (a.arrValueCents || 0));

  if (deals.length === 0) {
    slide.addText('No closed-won deals added this year yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const totalCents = deals.reduce((s, d) => s + (d.arrValueCents || 0), 0);
  slide.addText(`${deals.length} closed-won deal${deals.length === 1 ? '' : 's'} totaling ${usd(totalCents)}`, {
    x: 0.5, y: 0.95, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });

  const shown = deals.slice(0, DEAL_LIST_SLIDE_CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];
  cols.forEach((col, i) => {
    const lines = col.map((d) => ({
      text: `${d.companyName}  ·  ${d.accountManagerName}  ·  ${tierLabel(d.tier)}  ·  ${d.pipeline || '—'}  ·  ${usd(d.arrValueCents)}  ·  closes ${d.closeDate ? d.closeDate.slice(0, 10) : '—'}`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 1.35, w: 4.4, h: 3.9, fontFace: FONT_BODY, fontSize: 9, color: BRAND.onyx, lineSpacingMultiple: 1.2 });
  });

  if (deals.length > DEAL_LIST_SLIDE_CAP) {
    slide.addText(`+${deals.length - DEAL_LIST_SLIDE_CAP} more — see the on-screen section's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.25, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.smoke,
    });
  }
}

/** Same shape as the client's flattenDeals (TeamAmDashboard.jsx) — every account's financialHealth.expansionPipeline.deals (open + last-90-days-closed), tagged with company/AM/tier context. */
function flattenAllDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) {
      rows.push({ ...d, companyName: a.company_name, accountManagerName: a.account_manager_name || 'Unassigned', tier: a.tier });
    }
  }
  return rows;
}

/** "All Deals" — same capped-list-slide pattern as addArrAddedThisYearSlide, sorted by value desc. */
function addAllDealsSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'All Deals');

  const deals = flattenAllDeals(accounts).sort((a, b) => (b.valueCents || 0) - (a.valueCents || 0));

  if (deals.length === 0) {
    slide.addText('No open or recently-closed deals found.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addText(`Open + recently-closed (90 days) — ${deals.length} deal${deals.length === 1 ? '' : 's'}`, {
    x: 0.5, y: 0.95, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });

  const shown = deals.slice(0, DEAL_LIST_SLIDE_CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];
  cols.forEach((col, i) => {
    const lines = col.map((d) => ({
      text: `${d.companyName}  ·  ${d.accountManagerName}  ·  ${tierLabel(d.tier)}  ·  ${d.stage || '—'}  ·  ${usd(d.valueCents)}  ·  ${d.isOpen ? 'Open' : 'Closed'}`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 1.35, w: 4.4, h: 3.9, fontFace: FONT_BODY, fontSize: 9, color: BRAND.onyx, lineSpacingMultiple: 1.2 });
  });

  if (deals.length > DEAL_LIST_SLIDE_CAP) {
    slide.addText(`+${deals.length - DEAL_LIST_SLIDE_CAP} more — see the on-screen section's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.25, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.smoke,
    });
  }
}

/** Same shape as the client's flattenEnhancementRequests (EnhancementRequestsSection.jsx) — every account's serviceHealth.enhancementRequests, optionally filtered to isTopThree. */
function flattenEnhancementRequestsPpt(accounts, topThreeOnly) {
  const rows = [];
  for (const a of accounts) {
    for (const t of a.serviceHealth?.enhancementRequests || []) {
      if (topThreeOnly && !t.isTopThree) continue;
      rows.push({ ...t, companyName: a.company_name });
    }
  }
  return rows;
}

const ENHANCEMENT_LIST_SLIDE_CAP = 24;

/** "Enhancement Requests: Top 3" / "Enhancement Requests" — stat card + capped two-column list, same visual pattern as addUnassignedTierSlide. `topThreeOnly` mirrors EnhancementRequestsSection.jsx's own prop. */
function addEnhancementRequestsSlide(pptx, accounts, topThreeOnly) {
  const slide = pptx.addSlide();
  const title = topThreeOnly ? 'Enhancement Requests: Top 3' : 'Enhancement Requests';
  addSectionHeader(slide, title);

  const items = flattenEnhancementRequestsPpt(accounts, topThreeOnly)
    .sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

  if (items.length === 0) {
    slide.addText(topThreeOnly ? 'No accounts have a Top 3 Enhancement Request set yet.' : 'No open enhancement requests found.', {
      x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center',
    });
    return;
  }

  statCard(slide, 0.5, 1.0, topThreeOnly ? 'Enhancement Requests: Top 3' : 'Open Enhancement Requests', String(items.length), CARD_ACCENTS[0]);

  const shown = items.slice(0, ENHANCEMENT_LIST_SLIDE_CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];
  cols.forEach((col, i) => {
    const lines = col.map((t) => ({
      text: `${t.companyName}  ·  ${t.subject || 'Untitled'}  ·  ${t.stage || '—'}`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 2.55, w: 4.4, h: 2.65, fontFace: FONT_BODY, fontSize: 10, color: BRAND.onyx, lineSpacingMultiple: 1.25 });
  });

  if (items.length > ENHANCEMENT_LIST_SLIDE_CAP) {
    slide.addText(`+${items.length - ENHANCEMENT_LIST_SLIDE_CAP} more — see the on-screen section's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.25, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.smoke,
    });
  }
}

/** Same shape as the client's flattenEscalationTickets (EscalationRequestsSection.jsx) — every account's serviceHealth.alisEscalationOpenItems, tagged with company/tier context. */
function flattenEscalationOpenItems(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const t of a.serviceHealth?.alisEscalationOpenItems || []) {
      rows.push({ ...t, companyName: a.company_name, tier: a.tier });
    }
  }
  return rows;
}

/**
 * "Tickets: Escalation" — 2 stat cards (Open count, Average Age),
 * followed by a single tier-colored bar chart (unlike
 * addTicketsByTierSlide's open/closed pair — escalations here are
 * open-only, same scoping as the on-screen EscalationRequestsSection),
 * then a capped two-column list, longest-open first.
 */
function addEscalationTicketsSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Tickets: Escalation');

  const items = flattenEscalationOpenItems(accounts);
  if (items.length === 0) {
    slide.addText('No open escalation tickets found.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const avgAgeDays = Math.round(items.reduce((s, t) => s + (t.daysOpen || 0), 0) / items.length);
  statCard(slide, 0.5, 0.95, 'Open Escalation Tickets', String(items.length), CARD_ACCENTS[0]);
  statCard(slide, 3.4, 0.95, 'Average Age', `${avgAgeDays}d`, CARD_ACCENTS[1]);

  const byTier = {};
  for (const t of items) {
    const key = tierLabel(t.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const tierData = Object.entries(byTier).map(([name, value]) => ({ name, value })).sort((a, b) => tierSortIndex(a.name) - tierSortIndex(b.name));

  slide.addChart(pptx.ChartType.bar, [{ name: 'Open Escalation Tickets', labels: tierData.map((d) => d.name), values: tierData.map((d) => d.value) }], {
    x: 0.5, y: 2.35, w: 9, h: 1.6,
    barDir: 'col',
    chartColors: tierData.map((d) => tierColor(d.name)),
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 10, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });

  const sorted = [...items].sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0));
  const CAP = 20;
  const shown = sorted.slice(0, CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];
  cols.forEach((col, i) => {
    const lines = col.map((t) => ({
      text: `${t.companyName}  ·  ${t.subject || 'Untitled'}  ·  ${t.daysOpen ?? '—'}d open`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 4.1, w: 4.4, h: 1.3, fontFace: FONT_BODY, fontSize: 8.5, color: BRAND.onyx, lineSpacingMultiple: 1.15 });
  });

  if (sorted.length > CAP) {
    slide.addText(`+${sorted.length - CAP} more — see the on-screen section's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.42, w: 9, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.smoke,
    });
  }
}

/** Mirrors the on-screen CategoryMixChart — every account's serviceHealth.ticketCategoryMix summed portfolio-wide for the given status ('open'/'closed'), sorted desc, flat single-color bars (category isn't a tier concept). */
function addCategoryMixSlide(pptx, accounts, status) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, status === 'open' ? 'Tickets: Open by Category 2.0' : 'Tickets: Closed by Category 2.0');

  const byCategory = {};
  for (const a of accounts) {
    const mix = a.serviceHealth?.ticketCategoryMix || {};
    for (const [cat, counts] of Object.entries(mix)) {
      byCategory[cat] = (byCategory[cat] || 0) + (counts[status] || 0);
    }
  }
  const data = Object.entries(byCategory)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    slide.addText(`No ${status} ticket data yet.`, { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  slide.addChart(pptx.ChartType.bar, [{ name: status === 'open' ? 'Open Tickets' : 'Closed Tickets', labels: data.map((d) => d.name), values: data.map((d) => d.value) }], {
    x: 0.5, y: 1.1, w: 9, h: 4.2,
    barDir: 'bar',
    chartColors: [BRAND.glacier],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: BRAND.onyx,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 9,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: false,
  });
}

/**
 * "Ticket Activity" — trailing-12-months line chart, reusing
 * computeProjectVolumeSeries unchanged (it's already generic over any
 * `items` array with createdAt/closedAt, not implementation-project-
 * specific despite living just above the Onboarding slide). Sourced
 * from every account's serviceHealth.ticketDates — open items have no
 * closedAt, closed items do. Same stat-cards-then-line-chart layout as
 * addOnboardingSlide, just 2 stat cards instead of 3 (no "Avg Days
 * Open" equivalent asked for here).
 */
function addTicketActivitySlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Ticket Activity');

  const tickets = accounts.flatMap((a) => a.serviceHealth?.ticketDates || []);
  if (tickets.length === 0) {
    slide.addText('No ticket date data yet.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const openTickets = tickets.filter((t) => !t.closedAt);
  const closedTickets = tickets.filter((t) => t.closedAt);

  statCard(slide, 0.5, 0.95, 'Open Tickets', String(openTickets.length), CARD_ACCENTS[0]);
  statCard(slide, 3.4, 0.95, 'Closed Tickets', String(closedTickets.length), CARD_ACCENTS[1]);

  const openSeries = computeProjectVolumeSeries(openTickets, true);
  const closedMonthly = computeProjectVolumeSeries(closedTickets, false);
  const labels = openSeries.map((r) => r.label);

  slide.addText('Total Open Tickets vs. Closed Tickets (that month) — trailing 12 months', {
    x: 0.5, y: 2.45, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });
  slide.addChart(pptx.ChartType.line, [
    { name: 'Total Open Tickets', labels, values: openSeries.map((r) => r.total) },
    { name: 'Closed Tickets (that month)', labels, values: closedMonthly.map((r) => r.total) },
  ], {
    x: 0.5, y: 2.8, w: 9, h: 2.6,
    chartColors: ['7C3AED', '0891B2'],
    lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5,
    showValue: false,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 8,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9,
    showLegend: true, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 9, legendColor: BRAND.slate,
  });
}

/** Same predicate as the client's isUnmappedAm (TeamAmDashboard.jsx) — no real Account Manager name attached. */
function isUnmappedAm(account) {
  return account.account_manager_name === 'Unassigned' || account.account_manager_name?.startsWith('Other AM');
}

/** "Needs an AM" — mirrors addUnassignedTierSlide closely: capped two-column list, sorted largest ARR first (most valuable accounts needing attention first). */
function addNeedsAnAmSlide(pptx, accounts) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Needs an AM');

  const unmapped = accounts.filter(isUnmappedAm).sort((a, b) => (b.arr_cents || 0) - (a.arr_cents || 0));

  if (unmapped.length === 0) {
    slide.addText('Every account has a real AM name mapped — nothing to clean up.', { x: 0.5, y: 2.5, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.slate, align: 'center' });
    return;
  }

  const unassignedCount = unmapped.filter((a) => a.account_manager_name === 'Unassigned').length;
  const otherAmCount = unmapped.length - unassignedCount;
  slide.addText(`${unmapped.length} accounts with no real AM name — ${unassignedCount} Unassigned, ${otherAmCount} with an unmapped ID`, {
    x: 0.5, y: 0.95, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.slate,
  });

  const shown = unmapped.slice(0, UNASSIGNED_TIER_SLIDE_CAP);
  const half = Math.ceil(shown.length / 2);
  const cols = [shown.slice(0, half), shown.slice(half)];
  const colX = [0.5, 5.2];
  cols.forEach((col, i) => {
    const lines = col.map((a) => ({
      text: `${a.company_name}  ·  ${a.account_manager_name || 'Unassigned'}  ·  ${usd(a.arr_cents)} ARR`,
      options: { breakLine: true, color: BRAND.onyx },
    }));
    slide.addText(lines, { x: colX[i], y: 1.35, w: 4.4, h: 3.9, fontFace: FONT_BODY, fontSize: 10, color: BRAND.onyx, lineSpacingMultiple: 1.25 });
  });

  if (unmapped.length > UNASSIGNED_TIER_SLIDE_CAP) {
    slide.addText(`+${unmapped.length - UNASSIGNED_TIER_SLIDE_CAP} more — see the on-screen section's "Export to Excel" for the complete list.`, {
      x: 0.5, y: 5.25, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.smoke,
    });
  }
}

/**
 * @param {object} rollup - portfolio-wide rollup (same shape as the client's `rollup` useMemo)
 * @param {Array} rollupByAccountManager - per-AM rollup array (from GET /api/team-am)
 * @param {Array} accounts - enriched accounts (from GET /api/team-am)
 * @param {Array} healthScoreHistory - portfolio Avg Health Score trend (from GET /api/team-am/health-score-history)
 * @param {Array} kpiMetricHistory - portfolio KPI metric snapshots (from GET /api/team-am/kpi-metric-history) — only dealsByTypeTotalArr is used here, by the Deals by Type trend slide
 */
async function renderTeamAmPpt(rollup, rollupByAccountManager, accounts, healthScoreHistory, kpiMetricHistory) {
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
  addOnboardingSlide(pptx, accounts);
  addHealthDistributionSlide(pptx, accounts);
  addHealthScoreTrendSlide(pptx, healthScoreHistory);
  addEscalationTicketsSlide(pptx, accounts);
  addEnhancementRequestsSlide(pptx, accounts, true);
  addEnhancementRequestsSlide(pptx, accounts, false);
  addCategoryMixSlide(pptx, accounts, 'open');
  addCategoryMixSlide(pptx, accounts, 'closed');
  addTicketActivitySlide(pptx, accounts);
  addCompaniesByTierSlide(pptx, accounts);
  addCommunitiesByTierSlide(pptx, accounts);
  addStackedByAmByTierSlide(pptx, accounts, { title: 'Companies by Tier by AM', valueFn: () => 1, isCurrency: false });
  addStackedByAmByTierSlide(pptx, accounts, { title: 'Communities by AM by Tier', valueFn: (a) => a.active_community_count || 0, isCurrency: false });
  addStackedByAmByTierSlide(pptx, accounts, { title: 'ARR by Tier per AM', valueFn: (a) => a.arr_cents || 0, isCurrency: true });
  addTicketsByTierSlide(pptx, accounts);
  addCostToServeByTierSlide(pptx, accounts);
  addDealsByTypeSlide(pptx, accounts, 'bar');
  addDealsByTypeSlide(pptx, accounts, 'pie');
  addDealsByTypeTrendSlide(pptx, kpiMetricHistory);
  addArrAddedThisYearSlide(pptx, accounts);
  addAllDealsSlide(pptx, accounts);
  for (const metricKey of TIER_METRICS) {
    addTierByArrSlide(pptx, accounts, metricKey, 'bar');
    addTierByArrSlide(pptx, accounts, metricKey, 'pie');
  }
  addTicketsByAmByTierSlide(pptx, accounts);
  addUnassignedTierSlide(pptx, accounts);
  addNeedsAnAmSlide(pptx, accounts);
  addAtRiskSlides(pptx, accounts);

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { renderTeamAmPpt };
