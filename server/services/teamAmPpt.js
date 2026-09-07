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

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { renderTeamAmPpt };
