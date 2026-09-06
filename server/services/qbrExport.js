const path = require('path');
const pptxgen = require('pptxgenjs');
const ALIS_CONTACT = require('./alisContactInfo');

/**
 * Builds a QBR deck from a kpi_snapshots summary, following the section
 * structure of the real Viva Senior Living QBR deck (extracted this
 * session) rather than a guessed structure: Title -> Agenda -> Client
 * Overview -> Key Stats -> Support Review -> Enhancement Requests ->
 * [placeholder sections the AM fills in manually] -> Closing.
 *
 * Only Key Stats / Support Review / Enhancement Requests are populated
 * from real data; the rest render as labeled placeholder slides so the
 * deck's shape matches what account managers already expect.
 */

// Per ALIS_BrandGuide_2025.pdf (confirmed authoritative over any cached
// "2026 update" — see the brand-rollout plan doc). Glacier/Mint are the
// guide's cool secondary accents, replacing an earlier pass through this
// file that used an unverified skyline/electricPlum/aqua palette.
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
  pageBg: 'F8F8F8',
  cardBorder: 'E5E5E5',
};

const FONT_HEAD = 'Lexend Exa';
const FONT_BODY = 'Gotham Rounded';

const LOGO_DARK = path.join(__dirname, '..', 'assets', 'brand', 'alis-logo-dark-bg.png');
const LOGO_LIGHT_HORIZONTAL = path.join(__dirname, '..', 'assets', 'brand', 'alis-logo-light-bg-horizontal.png');

const SEVERITY_COLOR = {
  risk: BRAND.flame,
  opportunity: BRAND.glacier,
  watch: BRAND.amber,
  info: BRAND.slate,
};

// NOTE: a prior version of this file claimed this same 7-color sequence
// was "found in the real Leisure Care QBR deck's category doughnut chart"
// using skyline/electricPlum/aqua (the brand-guidelines skill's cached
// "2026 update" palette) — that's real-world evidence potentially in
// tension with going with the 2025 PDF here. Swapped to glacier/mint (the
// PDF's actual cool accents) per an explicit decision to follow the
// uploaded document over the skill's unverified cache, but if a real
// current-production deck really does use skyline/electric-plum, that's
// worth reconciling with whoever owns the brand guide.
const CHART_PALETTE = [BRAND.amber, BRAND.glacier, BRAND.mint, BRAND.marigold, BRAND.slate, BRAND.flame, BRAND.scarlet];

function pctStr(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function usd(n) {
  return n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Mixes a hex color toward white by `amount` (0-1) — used to derive a status pill's tint background from its (bold) text color. */
function lightenHex(hex, amount = 0.85) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const toHex = (c) => c.toString(16).padStart(2, '0').toUpperCase();
  return toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
}

/** Small rounded-pill badge — light tint of `color` behind bold `color` text, matching the real Leisure Care deck's status-indicator pattern. */
function statusPill(slide, x, y, w, label, color) {
  const h = 0.26;
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.06, fill: { color: lightenHex(color) }, line: { type: 'none' } });
  slide.addText(label, { x, y, w, h, fontFace: FONT_BODY, fontSize: 9, bold: true, color, align: 'center', valign: 'middle', margin: 0 });
}

/** Native doughnut chart with a right-side legend — skips rendering entirely on empty data rather than emitting a broken chart. */
function addBreakdownDoughnut(pptx, slide, x, y, w, h, title, dataMap) {
  const labels = Object.keys(dataMap);
  if (labels.length === 0) return;
  const values = labels.map((k) => Math.round(dataMap[k]));
  slide.addChart(pptx.ChartType.doughnut, [{ name: title, labels, values }], {
    x, y, w, h,
    chartColors: CHART_PALETTE,
    showTitle: true, title, titleFontFace: FONT_HEAD, titleFontSize: 11, titleColor: BRAND.onyx,
    showLegend: true, legendPos: 'r', legendFontFace: FONT_BODY, legendFontSize: 8, legendColor: BRAND.slate,
    showValue: false,
    dataLabelColor: BRAND.white,
  });
}

function addFooter(slide, text) {
  slide.addImage({ path: LOGO_LIGHT_HORIZONTAL, x: 0.3, y: 5.25, h: 0.25, w: 0.53 });
  slide.addText(text, {
    x: 1, y: 5.2, w: 8, h: 0.3, fontFace: FONT_BODY, fontSize: 8, color: BRAND.slate, align: 'left', valign: 'middle',
  });
}

// No accent bar under the title — whitespace alone separates it from body
// content (an accent stripe here is exactly the AI-generated-slide tell
// worth avoiding, and the real Leisure Care QBR deck doesn't use one either).
function addSectionHeader(slide, title) {
  slide.background = { color: BRAND.white };
  slide.addText(title.toUpperCase(), {
    x: 0.5, y: 0.4, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 28, bold: true, color: BRAND.onyx,
  });
}

function addTitleSlide(pptx, { companyName, periodStart, periodEnd, benchmarkQuarter }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.onyx };
  // True pixel ratio 2464x2037 (1.21:1) — height-derived width, not the
  // previous hardcoded 3.7x1.75 (2.11:1), which stretched the logo. The
  // guide is explicit: never force logo dimensions manually.
  {
    const logoH = 1.75;
    const logoW = logoH * (2464 / 2037);
    slide.addImage({ path: LOGO_DARK, x: (10 - logoW) / 2, y: 0.6, w: logoW, h: logoH });
  }
  slide.addText(`${companyName}`, {
    x: 0.5, y: 2.6, w: 9, h: 0.8, fontFace: FONT_HEAD, fontSize: 32, bold: true, color: BRAND.white, align: 'center',
  });
  slide.addText('Quarterly Business Review', {
    x: 0.5, y: 3.3, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 20, color: BRAND.marigold, align: 'center',
  });
  slide.addText(`${periodStart} – ${periodEnd}  ·  Benchmarked against ALIS 500 (${benchmarkQuarter})`, {
    x: 0.5, y: 3.85, w: 9, h: 0.4, fontFace: FONT_BODY, fontSize: 12, color: BRAND.slate, align: 'center',
  });
}

/**
 * `items` is the definitive, pre-computed ordered list of {label, populated}
 * entries — buildQbrDeck decides exactly once (per slide it actually calls)
 * what belongs here, so the agenda can never drift from the real slide list
 * the way two independently-maintained conditionals could.
 */
function addAgendaSlide(pptx, items) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Agenda');
  slide.addText(
    items.map(({ label, populated }) => ({
      text: `${label}${populated ? '  (data included)' : ''}`,
      options: { bullet: true, color: populated ? BRAND.onyx : BRAND.slate },
    })),
    { x: 0.7, y: 1.3, w: 8.5, h: 3.8, fontFace: FONT_BODY, fontSize: 14, lineSpacingMultiple: 1.3 }
  );
}

/** `Region ${n}` for a bare numeric region code (real accounts — Viva confirmed live — store region as "1".."5", not a name); any other value (a real region name) passes through unchanged. `null`/missing becomes "Unassigned", matching the same convention normalizePpd/normalizeDso already use for region grouping. */
function regionLabel(region) {
  const r = region || 'Unassigned';
  return /^\d+$/.test(r) ? `Region ${r}` : r;
}

/**
 * Splits `lines` (see addClientOverviewSlide) into pages of at most
 * `perPage`, never letting a page end on a header line with nothing under
 * it — that header just holds over to start the next page instead.
 */
function paginateCommunityLines(lines, perPage) {
  const pages = [];
  let i = 0;
  while (i < lines.length) {
    let end = Math.min(i + perPage, lines.length);
    if (end < lines.length && lines[end - 1].header) end -= 1;
    pages.push(lines.slice(i, end));
    i = end;
  }
  return pages;
}

/** Renders one page's worth of community lines into up to `columns` side-by-side text boxes on `slide`, `linesPerColumn` each, spanning `startY` to `endY`. */
function renderCommunityColumns(slide, pageLines, { columns, linesPerColumn, startY, endY }) {
  const totalW = 8.5;
  const gap = 0.25;
  const colW = (totalW - gap * (columns - 1)) / columns;
  for (let col = 0; col < columns; col++) {
    const colLines = pageLines.slice(col * linesPerColumn, (col + 1) * linesPerColumn);
    if (colLines.length === 0) continue;
    slide.addText(
      colLines.map((l) => ({
        text: l.text,
        options: l.header
          ? { bold: true, breakLine: true, bullet: false, color: BRAND.amber }
          : { bullet: true, breakLine: true, color: BRAND.onyx },
      })),
      {
        x: 0.7 + col * (colW + gap), y: startY, w: colW, h: endY - startY,
        fontFace: FONT_BODY, fontSize: 10.5, valign: 'top', lineSpacingMultiple: 1.15,
      }
    );
  }
}

function addAccountNotesBox(slide, y) {
  slide.addShape('roundRect', { x: 0.7, y, w: 8.5, h: 1.6, rectRadius: 0.06, fill: { color: BRAND.pageBg }, line: { color: BRAND.cardBorder, width: 1 } });
  slide.addText('ACCOUNT NOTES', { x: 0.9, y: y + 0.15, w: 8.1, h: 0.3, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
  slide.addText('[ Account manager: add relationship narrative, contract status, and executive sponsor notes here ]', {
    x: 0.9, y: y + 0.5, w: 8.1, h: 1.0, fontFace: FONT_BODY, fontSize: 11, italic: true, color: BRAND.slate, valign: 'top',
  });
}

/**
 * Per client feedback (Viva Senior Living, 47 communities across 5 regions,
 * 2026-09-02): every community should show, grouped by region when the
 * account has one (Viva's real region field is a bare numeric code — see
 * regionLabel above), spread across multiple columns and — if it still
 * doesn't fit — additional slides, rather than the old hard cap of 10 with
 * a "+ N more" line. A short list (fits within SHORT_CAPACITY) keeps
 * exactly the original compact look with Account Notes on the same slide;
 * a long one gets the fuller column band across as many "Communities
 * (cont'd)" slides as needed, with Account Notes moved to its own trailing
 * slide once there's no longer a reliable gap left to put it in.
 */
function addClientOverviewSlide(pptx, { companyName, communities, periodStart, periodEnd, benchmarkQuarter }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Client Overview');

  slide.addShape('rect', { x: 0.7, y: 1.15, w: 0.06, h: 0.55, fill: { color: BRAND.amber }, line: { type: 'none' } });
  slide.addText(companyName, { x: 0.9, y: 1.12, w: 8.3, h: 0.6, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: BRAND.onyx });

  // Meta pills row — reporting period, benchmark quarter, community count —
  // real report metadata instead of a single line of grey text, filling
  // the header area with something that reads as designed rather than a
  // gap above the (also newly boxed) narrative section below.
  statusPill(slide, 0.7, 1.85, 2.4, `${periodStart} – ${periodEnd}`, BRAND.slate);
  statusPill(slide, 3.25, 1.85, 1.9, `ALIS 500: ${benchmarkQuarter}`, BRAND.glacier);
  statusPill(slide, 5.3, 1.85, 2.0, `${communities.length} ${communities.length === 1 ? 'Community' : 'Communities'}`, BRAND.mint);

  // Group by region only if at least one community actually has one —
  // otherwise every account would show a lone "Unassigned" header for no
  // reason.
  const hasRegions = communities.some((c) => c.region);
  let groups;
  if (hasRegions) {
    const byRegion = new Map();
    for (const c of communities) {
      const key = c.region || 'Unassigned';
      if (!byRegion.has(key)) byRegion.set(key, []);
      byRegion.get(key).push(c.name);
    }
    const sortedKeys = [...byRegion.keys()].sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    groups = sortedKeys.map((key) => ({ label: regionLabel(key), names: [...byRegion.get(key)].sort((a, b) => a.localeCompare(b)) }));
  } else {
    groups = [{ label: null, names: [...communities.map((c) => c.name)].sort((a, b) => a.localeCompare(b)) }];
  }

  const lines = [];
  for (const g of groups) {
    if (g.label) lines.push({ text: g.label.toUpperCase(), header: true });
    for (const name of g.names) lines.push({ text: name, header: false });
  }

  // Short lists keep the original single-slide layout (columns + notes box
  // together); anything bigger needs the fuller band and — once that's not
  // enough either — its own continuation slides.
  const SHORT_COLUMNS = 3;
  const SHORT_LINES_PER_COLUMN = 6;
  const SHORT_CAPACITY = SHORT_COLUMNS * SHORT_LINES_PER_COLUMN;
  const FULL_COLUMNS = 3;
  const FULL_LINES_PER_COLUMN = 15;

  if (lines.length <= SHORT_CAPACITY) {
    renderCommunityColumns(slide, lines, { columns: SHORT_COLUMNS, linesPerColumn: SHORT_LINES_PER_COLUMN, startY: 2.35, endY: 3.5 });
    addAccountNotesBox(slide, 3.65);
    return;
  }

  const pages = paginateCommunityLines(lines, FULL_COLUMNS * FULL_LINES_PER_COLUMN);
  renderCommunityColumns(slide, pages[0], { columns: FULL_COLUMNS, linesPerColumn: FULL_LINES_PER_COLUMN, startY: 2.35, endY: 5.3 });
  for (const page of pages.slice(1)) {
    const contdSlide = pptx.addSlide();
    addSectionHeader(contdSlide, 'Client Overview — Communities (cont’d)');
    renderCommunityColumns(contdSlide, page, { columns: FULL_COLUMNS, linesPerColumn: FULL_LINES_PER_COLUMN, startY: 1.1, endY: 5.3 });
  }

  const notesSlide = pptx.addSlide();
  addSectionHeader(notesSlide, 'Client Overview — Account Notes');
  addAccountNotesBox(notesSlide, 1.3);
}

function statCard(slide, x, y, label, valueStr, diff) {
  slide.addShape('roundRect', { x, y, w: 2.75, h: 1.5, rectRadius: 0.08, fill: { color: BRAND.cardBg }, line: { color: BRAND.cardBorder, width: 1 } });
  slide.addText(label, { x: x + 0.15, y: y + 0.1, w: 2.45, h: 0.3, fontFace: FONT_BODY, fontSize: 10, color: BRAND.slate });
  slide.addText(valueStr, { x: x + 0.15, y: y + 0.35, w: 2.45, h: 0.6, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: BRAND.onyx });
  if (diff) {
    const good = diff.better;
    slide.addText(`${good ? '▲' : '▼'} vs. ALIS 500: ${typeof diff.benchmark === 'number' ? diff.benchmark.toFixed(1) : diff.benchmark}`, {
      x: x + 0.15, y: y + 1.0, w: 2.45, h: 0.35, fontFace: FONT_BODY, fontSize: 9, color: good ? BRAND.glacier : BRAND.flame,
    });
  }
}

function addKeyStatsSlide(pptx, { normalized, diffs }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Key Stats');

  statCard(slide, 0.5, 1.1, 'Occupancy', pctStr(normalized.occupancy?.pct), diffs.occupancyPct);
  statCard(slide, 3.4, 1.1, 'Median Length of Stay', normalized.lengthOfStay?.medianDays != null ? `${Math.round(normalized.lengthOfStay.medianDays)}d` : '—', diffs.medianLosDays);
  statCard(slide, 6.3, 1.1, '12mo Move-Out Rate', pctStr(normalized.lengthOfStay?.moveOutWithin?.['12mo']), diffs.moveOutWithin12mo);

  statCard(slide, 0.5, 2.65, 'Falls / 1,000 res-days', normalized.falls?.per1000ResidentDays != null ? normalized.falls.per1000ResidentDays.toFixed(1) : '—', diffs.fallsPer1000ResidentDays);
  statCard(slide, 3.4, 2.65, 'Hospital/SNF visits / 1,000 res-days', normalized.hospitalVisits?.per1000ResidentDays != null ? normalized.hospitalVisits.per1000ResidentDays.toFixed(1) : '—', diffs.hospitalVisitsPer1000ResidentDays);
  statCard(slide, 6.3, 2.65, 'PRN Admin / 1,000 res-days', normalized.prnAdministration?.overall != null ? normalized.prnAdministration.overall.toFixed(1) : '—', diffs.prnAdministrationPer1000ResidentDays);

  // No ALIS 500 benchmark exists for these yet — shown without the
  // ▲/▼-vs-benchmark line the cards above get.
  statCard(slide, 0.5, 4.0, 'Care Tasks Completed', pctStr(normalized.careCompletion?.pct), null);
  statCard(slide, 3.4, 4.0, 'Staff Active (30d)', pctStr(normalized.staffActivity?.pct), null);
  statCard(slide, 6.3, 4.0, 'Active Staff : Census', normalized.staffActivity?.staffToCensusRatio != null ? `1 : ${(1 / normalized.staffActivity.staffToCensusRatio).toFixed(1)}` : '—', null);
}

/** Only called when admissionsDischarges has real movement this period — see buildQbrDeck's gating. */
function addResidentMovementSlide(pptx, { admissionsDischarges, demographics, lengthOfStay }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Resident Movement');

  statCard(slide, 0.5, 1.1, 'Total Residents', String(demographics?.totalResidents ?? '—'), null);
  statCard(slide, 3.4, 1.1, 'Admissions', String(admissionsDischarges.totalAdmissions), null);
  statCard(slide, 6.3, 1.1, 'Discharges', String(admissionsDischarges.totalDischarges), null);

  const rows = [[
    { text: 'Month', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Admissions', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Discharges', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Net', options: { bold: true, fill: { color: BRAND.pageBg } } },
  ]];
  for (const m of admissionsDischarges.months) {
    rows.push([m.month, String(m.admissions), String(m.discharges), (m.net > 0 ? '+' : '') + m.net]);
  }
  slide.addTable(rows, { x: 0.5, y: 2.9, w: 9, fontFace: FONT_BODY, fontSize: 11, border: { type: 'solid', color: BRAND.cardBorder, pt: 1 } });

  // Per client feedback (Gallaher QBR), a single blended LOS number isn't
  // enough — cut by product type here too, capped to the busiest few so it
  // fits below the admissions/discharges table without running past the
  // bottom of the slide (cap of 3 measured against real pptxgenjs table
  // row height at this fontSize — 4+ rows below y=4.6 overflows 5.63in
  // slide height). Any truncation note folds into the header line rather
  // than a separate textbox, since there's no vertical room left for one.
  // Full community x product-type detail is Excel-only (see
  // client/src/utils/losExport.js).
  if (lengthOfStay?.byProductType?.length > 0) {
    const LOS_CAP = 3;
    const shown = lengthOfStay.byProductType.slice(0, LOS_CAP);
    const truncated = lengthOfStay.byProductType.length > LOS_CAP;
    const header = truncated
      ? `LENGTH OF STAY BY PRODUCT TYPE (top ${LOS_CAP} of ${lengthOfStay.byProductType.length} — full breakdown in the KPI Dashboard Excel export)`
      : 'LENGTH OF STAY BY PRODUCT TYPE';
    slide.addText(header, { x: 0.5, y: 4.35, w: 9, h: 0.22, fontFace: FONT_BODY, fontSize: 9, bold: true, color: BRAND.slate });
    const losRows = [[
      { text: 'Product Type', options: { bold: true, fill: { color: BRAND.pageBg } } },
      { text: 'Avg LOS', options: { bold: true, fill: { color: BRAND.pageBg } } },
      { text: 'Median LOS', options: { bold: true, fill: { color: BRAND.pageBg } } },
      { text: '12mo Move-Out %', options: { bold: true, fill: { color: BRAND.pageBg } } },
    ]];
    for (const p of shown) {
      losRows.push([
        p.productType,
        p.avgDays != null ? `${Math.round(p.avgDays)}d` : '—',
        p.medianDays != null ? `${Math.round(p.medianDays)}d` : '—',
        pctStr(p.moveOutWithin?.['12mo']),
      ]);
    }
    slide.addTable(losRows, { x: 0.5, y: 4.6, w: 9, fontFace: FONT_BODY, fontSize: 9, border: { type: 'solid', color: BRAND.cardBorder, pt: 1 } });
  }
}

/** Only called when hasEvaluationData is true — see buildQbrDeck's gating. `includeBilling` suppresses the revenue-leakage dollar callout (a billing-derived figure) without touching the compliance stats, which aren't billing. */
function addLevelsOfCareSlide(pptx, careLevelEvaluations, includeBilling) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Levels of Care');

  const c = careLevelEvaluations;
  statCard(slide, 0.5, 1.1, 'Residents Considered', String(c.totalResidents), null);
  statCard(slide, 3.4, 1.1, 'Needs Attention', `${c.needsAttention} (${pctStr(c.pctNeedsAttention)})`, null);
  statCard(slide, 6.3, 1.1, 'Never Evaluated', String(c.neverEvaluated), null);

  if (includeBilling && c.revenueLeakage?.affectedResidents > 0) {
    slide.addText(
      `Potential revenue opportunity: ${c.revenueLeakage.affectedResidents} resident(s) billed below their evaluation-recommended fee — ~${usd(c.revenueLeakage.totalMonthlyGap)}/mo.`,
      { x: 0.5, y: 2.8, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.glacier }
    );
  }

  slide.addText('Excludes Independent Living residents. "Needs attention" = expired, incomplete, or not evaluated in 12+ months.', {
    x: 0.5, y: 3.4, w: 9, h: 0.4, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate,
  });
}

/**
 * Leisure Care-only (see companyFeatures.js / kpiNormalizer.js's
 * normalizeSentinelIncidents) — only called when
 * normalized.sentinelIncidents.total > 0, see buildQbrDeck's gating.
 * Same overflow-pagination pattern as addSupportReviewSlide (a "cont'd"
 * slide once the list runs past the bottom margin) since a bad quarter
 * could plausibly list more than one slide's worth of these.
 */
function addSentinelIncidentsSlide(pptx, sentinelIncidents) {
  let slide = pptx.addSlide();
  addSectionHeader(slide, 'Sentinel Incidents');

  slide.addText(
    `${sentinelIncidents.total} Sentinel-tagged incident(s) this period, per Leisure Care's own ALIS incident-type configuration.`,
    { x: 0.7, y: 1.1, w: 8.5, h: 0.35, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.flame }
  );

  const BOTTOM = 5.35;
  let y = 1.6;
  const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

  for (const item of sentinelIncidents.items) {
    if (y + 0.5 > BOTTOM) {
      slide = pptx.addSlide();
      addSectionHeader(slide, 'Sentinel Incidents (cont’d)');
      y = 1.2;
    }
    slide.addText([
      { text: item.incidentType || 'Unknown type', options: { bold: true, color: BRAND.onyx } },
      { text: `   ${item.residentName || 'Unknown resident'} · ${item.communityName || 'Unknown community'} · ${dateFmt(item.incidentDateTime)}`, options: { color: BRAND.slate } },
    ], { x: 0.7, y, w: 8.5, h: 0.24, fontFace: FONT_BODY, fontSize: 10 });
    y += 0.28;
  }

  slide.addText(
    'Matched on ALIS incident-type names containing "Sentinel" — this is Leisure Care\'s own incident-type tagging, not an ALIS 500 benchmark category.',
    { x: 0.7, y: Math.min(y + 0.1, BOTTOM), w: 8.5, h: 0.3, fontFace: FONT_BODY, fontSize: 8, italic: true, color: BRAND.slate }
  );
}

/** Only called when includeBilling is true AND recurringRevenue/billedRevenue/outstandingInvoiceSummary has real data — see buildQbrDeck's gating. */
function addFinancialSlide(pptx, { billedRevenue, recurringRevenue, outstandingInvoiceSummary, dso, ppd }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Financial');

  // Prefer billedRevenue (real invoiced charges for the period) — fall
  // back to recurringRevenue's active-schedule run-rate only when no
  // billed-invoice data is available at all (see kpiNormalizer.js).
  const primary = billedRevenue?.hasBillingData ? billedRevenue : recurringRevenue;
  const primaryLabel = billedRevenue?.hasBillingData ? 'Billed Revenue' : 'Active Billing Schedule';

  if (billedRevenue?.hasBillingData) {
    statCard(slide, 0.5, 1.1, 'Billed Revenue', usd(billedRevenue.total), null);
    statCard(slide, 3.4, 1.1, 'Revenue / Resident', usd(billedRevenue.revenuePerResident), null);
    if (recurringRevenue?.hasBillingData) {
      statCard(slide, 6.3, 1.1, 'Active Billing Schedule', usd(recurringRevenue.total), null);
    }
  } else if (recurringRevenue?.hasBillingData) {
    statCard(slide, 0.5, 1.1, 'Active Billing Schedule', usd(recurringRevenue.total), null);
    statCard(slide, 3.4, 1.1, 'Revenue / Resident', usd(recurringRevenue.revenuePerResident), null);
    statCard(slide, 6.3, 1.1, 'Per-Diem Revenue', usd(recurringRevenue.perDiemTotal), null);
  }

  // DSO days, appended to whichever AR line renders below — dso.portfolio
  // is null when there's no billing data at all, which lines up exactly
  // with outstandingInvoiceSummary.hasBillingData (both come from the same
  // outstandingInvoiceRows pull — see kpiExport.js).
  const dsoSuffix = dso?.portfolio?.dsoDays != null ? ` DSO: ${dso.portfolio.dsoDays.toFixed(1)} days.` : '';
  // PPD doesn't depend on AR data (occupancy + billed revenue only), so it
  // gets its own standalone line when there's no AR block to append onto —
  // see kpiNormalizer.js's normalizePpd.
  const ppdText = ppd?.portfolio?.ppdByUnitDays != null ? ` PPD: ${usd(ppd.portfolio.ppdByUnitDays)}/day.` : '';

  if (outstandingInvoiceSummary?.hasBillingData) {
    if (outstandingInvoiceSummary.total > 0) {
      const pastDue60 = (outstandingInvoiceSummary.aging.days61to90 || 0) + (outstandingInvoiceSummary.aging.days90plus || 0);
      slide.addText(
        `Accounts receivable: ${usd(outstandingInvoiceSummary.total)} outstanding across ${outstandingInvoiceSummary.invoiceCount} invoice(s) — ${usd(pastDue60)} is 60+ days past due.${dsoSuffix}${ppdText}`,
        { x: 0.5, y: 2.75, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: pastDue60 > 0 ? BRAND.flame : BRAND.onyx }
      );
    } else {
      slide.addText(`✓ No outstanding balance — fully collected as of this period.${dsoSuffix}${ppdText}`, {
        x: 0.5, y: 2.75, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.glacier,
      });
    }
  } else if (ppdText) {
    slide.addText(`Revenue yield:${ppdText}`, { x: 0.5, y: 2.75, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 11, color: BRAND.onyx });
  }

  if (primary) {
    addBreakdownDoughnut(pptx, slide, 0.5, 3.15, 4.3, 1.9, `${primaryLabel} by Payer Type`, primary.byPayerType);
    addBreakdownDoughnut(pptx, slide, 5.2, 3.15, 4.3, 1.9, `${primaryLabel} by Product Type`, primary.byProductType);
  }

  const note = billedRevenue?.hasBillingData
    ? 'Billed Revenue reflects actual invoiced charges for the period. Active Billing Schedule (if shown) is a forward-looking run rate, not what was billed. Revenue per bed and cost analysis still require GL sync data or HQ Dashboard reports.'
    : 'Recurring revenue reflects active billing charges for the period — a run rate, not a reconciled invoice total. Revenue per bed and cost analysis still require GL sync data or HQ Dashboard reports.';
  slide.addText(note, {
    x: 0.5, y: 5.1, w: 9, h: 0.35, fontFace: FONT_BODY, fontSize: 8, italic: true, color: BRAND.slate,
  });
}

/** Only called when a qbr-export skill JSON has been imported for this job — see buildQbrDeck's gating. */
function addAccountHealthImportSlide(pptx, hubspotHealth) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Account Health (HubSpot Import)');

  slide.addText(`Imported as of ${hubspotHealth.meta?.as_of_date || '—'} — a point-in-time snapshot, not live data.`, {
    x: 0.5, y: 1.0, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate,
  });

  const svc = hubspotHealth.service_health;
  const fin = hubspotHealth.financial_health;

  if (svc) {
    statCard(slide, 0.5, 1.4, 'Avg Ticket Age', svc.avg_open_ticket_age_days?.value != null ? `${svc.avg_open_ticket_age_days.value}d` : '—', null);
    statCard(slide, 3.4, 1.4, 'Over 45 Days', String(svc.tickets_over_45_days?.value ?? '—'), null);
    statCard(slide, 6.3, 1.4, 'Escalations (Qtr)', String(svc.escalation_count_this_quarter?.value ?? '—'), null);
  }
  if (fin) {
    statCard(slide, 0.5, 3.0, 'Split Pay Pending', String(fin.split_pay_pending_count?.value ?? '—'), null);
    statCard(slide, 3.4, 3.0, 'Open Deals', String(fin.open_deals?.value?.length ?? 0), null);
    statCard(slide, 6.3, 3.0, 'Rate Dispute', fin.rate_dispute_active?.value ? 'Active' : 'None', null);
  }
}

/**
 * Only called when a release-recommendations import has been attached — see
 * buildQbrDeck's gating. Mirrors the real Leisure Care QBR deck's "Recent
 * ALIS Platform Releases" slide (extracted this session): alternating
 * F8F8F8/FFFFFF row cards, bold amber release title on the left, gray body
 * copy with the account-specific relevance note on the right.
 */
function addReleaseRecommendationsSlide(pptx, releaseRecommendations, companyName) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Recent ALIS Platform Releases');

  const meta = releaseRecommendations.meta || {};
  const subtitle = [meta.release_range, meta.period_label, `Highlights most relevant to ${companyName}`]
    .filter(Boolean)
    .join('  |  ');
  slide.addText(subtitle, {
    x: 0.5, y: 1.05, w: 9, h: 0.3, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate,
  });

  // Capped at 6 — matches the real deck's row layout and keeps a single
  // slide from overflowing; the import can hold more; only the top 6 show.
  const releases = (releaseRecommendations.releases || []).slice(0, 6);
  const rowH = 0.6;
  let y = 1.5;
  releases.forEach((release, i) => {
    slide.addShape('roundRect', {
      x: 0.5, y, w: 9, h: rowH - 0.08, rectRadius: 0.05,
      fill: { color: i % 2 === 0 ? BRAND.pageBg : BRAND.white },
      line: { color: BRAND.cardBorder, width: 1 },
    });
    slide.addText(release.title, {
      x: 0.65, y: y + 0.06, w: 2.6, h: rowH - 0.2, fontFace: FONT_HEAD, fontSize: 11, bold: true, color: BRAND.amber, valign: 'top', margin: 0,
    });
    slide.addText(release.description, {
      x: 3.4, y: y + 0.06, w: 5.9, h: rowH - 0.2, fontFace: FONT_BODY, fontSize: 9, color: BRAND.slate, valign: 'top', margin: 0,
    });
    y += rowH;
  });

  if (meta.release_notes_url) {
    slide.addText(`Full release notes: ${meta.release_notes_url}`, {
      x: 0.5, y: y + 0.1, w: 9, h: 0.25, fontFace: FONT_BODY, fontSize: 8, italic: true, color: BRAND.slate,
    });
  }
}

/**
 * Lists this period's tickets individually, separated by status — Open
 * first (each linked straight to its HubSpot record, sorted worst-aging
 * first), Closed after in a more compact form since there's nothing
 * actionable left. The live HubSpot pull itself has no "next step"
 * property configured — only an imported account-health-export's
 * open_tickets carries one — so an open ticket that's also been triaged
 * by that skill gets its next step cross-referenced by ticket id and
 * carried straight through onto this slide. Same "merge live + imported,
 * don't keep them separate" approach as addEnhancementRequestsSlide below.
 *
 * Every open ticket gets shown — per client feedback this is the working
 * list an AM walks through live at the QBR, so nothing should be silently
 * dropped the way it used to be (capped at 5 per slide). Overflows onto as
 * many "(cont'd)" slides as needed, tracked by running `y` against `BOTTOM`
 * the same way addDealRelatedTicketsSlide guards its own overflow. Only the
 * much-less-actionable Recently Closed list below stays capped.
 */
function addSupportReviewSlide(pptx, ticketSummary, hubspotHealth) {
  let slide = pptx.addSlide();
  addSectionHeader(slide, 'Support Review');

  if (!ticketSummary) {
    slide.addText('No HubSpot company was linked for this KPI pull — ticket data not available.', {
      x: 0.7, y: 1.5, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  slide.addText(`${ticketSummary.total} total tickets this period  ·  ${ticketSummary.open} open  ·  ${ticketSummary.closed} closed`, {
    x: 0.7, y: 1.2, w: 8.5, h: 0.35, fontFace: FONT_BODY, fontSize: 13, bold: true, color: BRAND.onyx,
  });

  const importedById = new Map(
    (hubspotHealth?.service_health?.open_tickets?.value || []).map((t) => [String(t.id), t])
  );
  const openTickets = [...ticketSummary.tickets].filter((t) => t.isOpen).sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0));
  const closedTickets = [...ticketSummary.tickets].filter((t) => !t.isOpen).sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0));

  const BOTTOM = 5.35; // leave a margin before the 5.63in slide edge
  let y = 1.65;
  slide.addText('OPEN', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
  y += 0.26;
  if (openTickets.length === 0) {
    slide.addText('No open tickets this period.', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
    y += 0.28;
  }
  for (const t of openTickets) {
    const nextStep = importedById.get(String(t.id))?.next_step || null;
    const rowHeight = nextStep ? 0.52 : 0.28;
    if (y + rowHeight > BOTTOM) {
      slide = pptx.addSlide();
      addSectionHeader(slide, 'Support Review (cont’d)');
      y = 1.2;
      slide.addText('OPEN (continued)', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
      y += 0.26;
    }
    slide.addText([
      { text: t.subject || `Ticket #${t.id}`, options: { bold: true, color: t.url ? BRAND.glacier : BRAND.onyx, hyperlink: t.url ? { url: t.url } : undefined } },
      { text: `   ${t.category}${t.daysOpen != null ? ` · ${t.daysOpen}d open` : ''}`, options: { color: BRAND.slate } },
    ], { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 10 });
    y += 0.22;
    if (nextStep) {
      slide.addText(`Next step: ${nextStep}`, { x: 0.9, y, w: 8.3, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
      y += 0.24;
    } else {
      y += 0.06;
    }
  }

  y += 0.1;
  const CLOSED_CAP = 4;
  // The closed-section header plus at least a line or two needs ~0.9in —
  // start a fresh slide rather than let the header land right at the
  // bottom edge with no room underneath it.
  if (y + 0.9 > BOTTOM) {
    slide = pptx.addSlide();
    addSectionHeader(slide, 'Support Review (cont’d)');
    y = 1.2;
  }
  slide.addText('RECENTLY CLOSED', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
  y += 0.26;
  if (closedTickets.length === 0) {
    slide.addText('No tickets closed this period.', { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
  } else {
    for (const t of closedTickets.slice(0, CLOSED_CAP)) {
      slide.addText([
        { text: t.subject || `Ticket #${t.id}`, options: { color: t.url ? BRAND.glacier : BRAND.slate, hyperlink: t.url ? { url: t.url } : undefined } },
        { text: `   ${t.category}`, options: { color: BRAND.slate } },
      ], { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9 });
      y += 0.22;
    }
    if (closedTickets.length > CLOSED_CAP) {
      slide.addText(`+ ${closedTickets.length - CLOSED_CAP} more closed ticket(s) not shown`, { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
    }
  }
}

/**
 * Live HubSpot deal pipeline for this company — the deal records
 * themselves (open + recently closed, each linked straight to HubSpot),
 * as opposed to addDealRelatedTicketsSlide below (imported health-export
 * ticket next-steps that happen to be tagged to a deal). Mirrors the
 * dashboard's "HubSpot Deals" panel (client/src/pages/KpiDashboard.jsx).
 */
function addDealActivitySlide(pptx, dealSummary) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'HubSpot Deals');

  if (!dealSummary) {
    slide.addText('No HubSpot company was linked for this KPI pull — deal data not available.', {
      x: 0.7, y: 1.5, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  slide.addText(`${dealSummary.open} open (${usd(dealSummary.totalOpenValue)})  ·  ${dealSummary.closed} closed in the last 90 days`, {
    x: 0.7, y: 1.2, w: 8.5, h: 0.35, fontFace: FONT_BODY, fontSize: 13, bold: true, color: BRAND.onyx,
  });

  let y = 1.65;
  const OPEN_CAP = 6;
  slide.addText('OPEN', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
  y += 0.26;
  if (dealSummary.openDeals.length === 0) {
    slide.addText('No open deals.', { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
    y += 0.26;
  }
  for (const d of dealSummary.openDeals.slice(0, OPEN_CAP)) {
    slide.addText([
      { text: d.name || `Deal #${d.id}`, options: { bold: true, color: d.url ? BRAND.glacier : BRAND.onyx, hyperlink: d.url ? { url: d.url } : undefined } },
      { text: `   ${d.stage}${d.amount != null ? ` · ${usd(d.amount)}` : ''}`, options: { color: BRAND.slate } },
    ], { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10 });
    y += 0.26;
  }
  if (dealSummary.openDeals.length > OPEN_CAP) {
    slide.addText(`+ ${dealSummary.openDeals.length - OPEN_CAP} more open deal(s) not shown`, { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
    y += 0.24;
  }

  y += 0.1;
  const CLOSED_CAP = 4;
  slide.addText('CLOSED (LAST 90 DAYS)', { x: 0.7, y, w: 8.5, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.slate });
  y += 0.26;
  if (dealSummary.closedDeals.length === 0) {
    slide.addText('No deals closed in the last 90 days.', { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
  } else {
    for (const d of dealSummary.closedDeals.slice(0, CLOSED_CAP)) {
      slide.addText([
        { text: d.name || `Deal #${d.id}`, options: { color: d.url ? BRAND.glacier : BRAND.slate, hyperlink: d.url ? { url: d.url } : undefined } },
        { text: `   ${d.isWon ? 'Won' : 'Lost'}${d.amount != null ? ` · ${usd(d.amount)}` : ''}`, options: { color: BRAND.slate } },
      ], { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9 });
      y += 0.22;
    }
    if (dealSummary.closedDeals.length > CLOSED_CAP) {
      slide.addText(`+ ${dealSummary.closedDeals.length - CLOSED_CAP} more closed deal(s) not shown`, { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
    }
  }
}

/**
 * Two independent sources feed the Enhancement Requests slide: the live
 * ALIS-linked ticket pull (`ticketSummary`, category text-matched on
 * "enhancement") and the imported health-export's `service_health.open_tickets`
 * entries the skill explicitly tagged `next_step_type: "enhancement"`.
 * Extracted so buildQbrDeck can check "would this slide have anything to
 * show" for the truncateEmptySlides option without duplicating (and risking
 * drift from) the merge logic itself.
 */
function getEnhancementLines(ticketSummary, hubspotHealth) {
  const liveEnhancements = (ticketSummary?.tickets || [])
    .filter((t) => (t.category || '').toLowerCase().includes('enhancement'))
    .map((t) => `${t.subject}${t.isOpen ? `  (open, ${t.daysOpen}d)` : '  (closed)'}`);

  const importedEnhancements = (hubspotHealth?.service_health?.open_tickets?.value || [])
    .filter((t) => t.next_step_type === 'enhancement')
    .map((t) => `${t.subject}${t.next_step ? `  — ${t.next_step}` : ''}`);

  return [...liveEnhancements, ...importedEnhancements];
}

/** Merges the two sources — see getEnhancementLines above. */
function addEnhancementRequestsSlide(pptx, ticketSummary, hubspotHealth) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Enhancement Requests');

  const enhancementLines = getEnhancementLines(ticketSummary, hubspotHealth);

  if (enhancementLines.length === 0) {
    slide.addText('No enhancement-tagged tickets found for this period.', {
      x: 0.7, y: 1.5, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  slide.addText(
    enhancementLines.slice(0, 8).map((text) => ({ text, options: { bullet: true } })),
    { x: 0.7, y: 1.4, w: 8.5, h: 3.6, fontFace: FONT_BODY, fontSize: 13, color: BRAND.onyx, lineSpacingMultiple: 1.3 }
  );
}

/**
 * Distinct from addEnhancementRequestsSlide above (which lists every
 * enhancement-CATEGORY ticket) — this is specifically the client's own
 * ranked Top 3 asks, tracked via two independent HubSpot signals (see
 * hubspotTickets.js): the "Top 3" tag property (rank 1/2/3) and a ticket
 * sitting in the "Top 3 Enhancements" pipeline stage. Always shown when a
 * HubSpot company is linked (see showTopThreeEnhancements in buildQbrDeck —
 * deliberately not gated by truncateEmptySlides), including the "none
 * found" case, since that absence is itself the signal worth surfacing to
 * the account team.
 */
function addTopThreeEnhancementsSlide(pptx, ticketSummary) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Top 3 Enhancement Requests');

  const top3 = ticketSummary?.topThreeEnhancements;
  if (!top3?.hasAny) {
    slide.addText(
      'No tickets are currently tagged (Top 3 rank) or staged ("Top 3 Enhancements") as a Top 3 enhancement request for this account. Worth confirming with the client whether that’s accurate, or whether their asks just haven’t been captured in HubSpot yet.',
      { x: 0.7, y: 1.5, w: 8.5, h: 1, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.flame }
    );
    return;
  }

  let y = 1.3;
  if (top3.misaligned.length > 0) {
    slide.addText(
      `⚠ ${top3.misaligned.length} ticket(s) have only one of the two Top 3 signals set — worth reconciling.`,
      { x: 0.7, y, w: 8.5, h: 0.3, fontFace: FONT_BODY, fontSize: 11, bold: true, color: BRAND.flame }
    );
    y += 0.45;
  }

  for (const t of top3.items.slice(0, 8)) {
    const rankLabel = t.taggedTop3 ? `Top ${t.topThreeRank}` : '(no rank tag)';
    slide.addText([
      { text: `${rankLabel}  `, options: { bold: true, color: BRAND.glacier } },
      { text: t.subject || `Ticket #${t.id}`, options: { bold: true, color: BRAND.onyx, hyperlink: t.url ? { url: t.url } : undefined } },
      { text: t.aligned ? '' : '  ⚠ unaligned', options: { color: BRAND.flame, bold: true } },
    ], { x: 0.7, y, w: 8.5, h: 0.24, fontFace: FONT_BODY, fontSize: 11 });
    y += 0.24;
    slide.addText(`${t.category} · ${t.pipelineStageLabel}${t.isOpen ? '' : ' (closed)'}`, {
      x: 0.9, y, w: 8.3, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate,
    });
    y += 0.32;
  }
  if (top3.items.length > 8) {
    slide.addText(`+ ${top3.items.length - 8} more not shown`, { x: 0.7, y, w: 8.5, h: 0.2, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
  }
}

/**
 * Populated from the health-export's `open_tickets` entries with
 * `next_step_type: "project"` (or no type at all — "project" is the
 * catch-all default per the schema). Extracted for the same reason as
 * getEnhancementLines above — lets buildQbrDeck check for real content
 * without duplicating the filter.
 */
function getProjectStatusTickets(hubspotHealth) {
  return (hubspotHealth?.service_health?.open_tickets?.value || [])
    .filter((t) => !t.next_step_type || t.next_step_type === 'project');
}

/**
 * Falls back to the original manual-fill placeholder when there's no
 * imported data to work with, so an account without a health import yet
 * doesn't get a slide that just reads "no data" instead of a clear prompt
 * for the AM to fill in by hand.
 */
function addProjectStatusSlide(pptx, hubspotHealth) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Project Status');

  const projectTickets = getProjectStatusTickets(hubspotHealth);

  if (projectTickets.length === 0) {
    slide.addText('[ Account manager: list completed and in-flight projects for this account ]', {
      x: 0.7, y: 1.5, w: 8.5, h: 1, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  let y = 1.3;
  for (const t of projectTickets.slice(0, 6)) {
    slide.addText(t.subject, { x: 0.7, y, w: 8.5, h: 0.3, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx });
    if (t.next_step) {
      slide.addText(t.next_step, { x: 0.7, y: y + 0.28, w: 8.5, h: 0.27, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
    }
    y += t.next_step ? 0.62 : 0.4;
  }
  if (projectTickets.length > 6) {
    slide.addText(`+ ${projectTickets.length - 6} more not shown`, { x: 0.7, y, w: 8.5, h: 0.3, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
  }
}

/**
 * Only called when there's at least one open deal or deal-tagged next-step
 * to show — see buildQbrDeck's gating. Ties the two together: each open
 * deal gets its linked ticket next-steps listed underneath it (matched via
 * `next_step_type: "deal"` + `related_deal_id`); a deal-tagged ticket with
 * no resolvable deal ID falls into a general catch-all at the bottom
 * rather than being dropped.
 */
function addDealRelatedTicketsSlide(pptx, hubspotHealth) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Deal-Related Activity');

  const openDeals = hubspotHealth?.financial_health?.open_deals?.value || [];
  const dealTickets = (hubspotHealth?.service_health?.open_tickets?.value || [])
    .filter((t) => t.next_step_type === 'deal');

  const ticketsByDealId = new Map();
  const unlinkedTickets = [];
  for (const t of dealTickets) {
    const matchesKnownDeal = t.related_deal_id && openDeals.some((d) => String(d.id) === String(t.related_deal_id));
    if (matchesKnownDeal) {
      const key = String(t.related_deal_id);
      if (!ticketsByDealId.has(key)) ticketsByDealId.set(key, []);
      ticketsByDealId.get(key).push(t);
    } else {
      unlinkedTickets.push(t);
    }
  }

  let y = 1.3;
  for (const deal of openDeals.slice(0, 4)) {
    slide.addText(deal.dealname || deal.name, { x: 0.7, y, w: 8.5, h: 0.26, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx });
    y += 0.28;
    const linked = ticketsByDealId.get(String(deal.id)) || [];
    if (linked.length === 0) {
      slide.addText('No open tickets referencing this deal.', { x: 0.9, y, w: 8, h: 0.22, fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.slate });
      y += 0.28;
    } else {
      for (const t of linked.slice(0, 3)) {
        slide.addText(`•  ${t.subject}${t.next_step ? `  —  ${t.next_step}` : ''}`, { x: 0.9, y, w: 8, h: 0.22, fontFace: FONT_BODY, fontSize: 9, color: BRAND.slate });
        y += 0.24;
      }
    }
    y += 0.12;
  }

  if (unlinkedTickets.length > 0 && y < 5.0) {
    slide.addText('General deal-related follow-ups', { x: 0.7, y, w: 8.5, h: 0.24, fontFace: FONT_BODY, fontSize: 11, bold: true, color: BRAND.onyx });
    y += 0.26;
    for (const t of unlinkedTickets.slice(0, 3)) {
      slide.addText(`•  ${t.subject}${t.next_step ? `  —  ${t.next_step}` : ''}`, { x: 0.9, y, w: 8, h: 0.22, fontFace: FONT_BODY, fontSize: 9, color: BRAND.slate });
      y += 0.24;
    }
  }
}

/** `includeBilling` filters out ALIS-billing-specific flags (see qbrFlags.js's billingRelated tag) — other "Financial"-category flags (e.g. from a HubSpot import) are a different data source and stay regardless. Extracted (same reasoning as getEnhancementLines/getProjectStatusTickets above) so buildQbrDeck can check for real content without duplicating the filter. */
function getDiscussionFlags(allFlags, includeBilling) {
  return includeBilling ? allFlags : allFlags.filter((f) => !f.billingRelated);
}

function addDiscussionPointsSlide(pptx, allFlags, includeBilling) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Discussion Points — Draft for AM Review');

  slide.addText('Generated from this period\'s KPI benchmark diffs and ticket history. Edit before presenting — not client-facing as-is.', {
    x: 0.5, y: 1.1, w: 9, h: 0.35, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate,
  });

  const flags = getDiscussionFlags(allFlags, includeBilling);

  if (flags.length === 0) {
    slide.addText('No flags this period — all tracked KPIs are at or ahead of the ALIS 500 benchmark.', {
      x: 0.7, y: 1.7, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, color: BRAND.onyx,
    });
    return;
  }

  let y = 1.55;
  for (const flag of flags.slice(0, 6)) {
    const color = SEVERITY_COLOR[flag.severity] || BRAND.slate;
    slide.addShape('rect', { x: 0.5, y, w: 0.08, h: 0.55, fill: { color } });
    slide.addText(flag.title, { x: 0.7, y, w: 7.3, h: 0.3, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx });
    statusPill(slide, 8.1, y + 0.01, 1.2, flag.category.toUpperCase(), color);
    slide.addText(flag.talkingPoint, { x: 0.7, y: y + 0.28, w: 8.6, h: 0.27, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate });
    y += 0.62;
  }
}

function addPlaceholderSlide(pptx, title, hint) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, title);
  slide.addText(hint || '[ Account manager: fill in this section manually ]', {
    x: 0.7, y: 1.5, w: 8.5, h: 1, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
  });
}

/** Last slide of every deck — ALIS contact info, kept in sync with the Wellness Scorecard PDF's closing page via server/services/alisContactInfo.js. */
function addClosingSlide(pptx, { companyName }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.onyx };
  slide.addText('Thank You / Next Steps', {
    x: 0.5, y: 0.5, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 26, bold: true, color: BRAND.white, align: 'center',
  });
  slide.addText(`${companyName} — see you next quarter.`, {
    x: 0.5, y: 1.1, w: 9, h: 0.4, fontFace: FONT_BODY, fontSize: 13, color: BRAND.marigold, align: 'center',
  });

  // Left column — direct contact info.
  slide.addText('CONTACT ALIS SUPPORT', { x: 0.6, y: 1.9, w: 4.3, h: 0.3, fontFace: FONT_HEAD, fontSize: 13, bold: true, color: BRAND.amber });

  slide.addText('EMAIL', { x: 0.6, y: 2.3, w: 4.3, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.glacier });
  slide.addText(`${ALIS_CONTACT.email}   •   ${ALIS_CONTACT.emailNote}`, { x: 0.6, y: 2.53, w: 4.3, h: 0.24, fontFace: FONT_BODY, fontSize: 9.5, color: BRAND.white });

  slide.addText('PHONE', { x: 0.6, y: 2.9, w: 4.3, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.glacier });
  slide.addText(`${ALIS_CONTACT.phone}   •   ${ALIS_CONTACT.phoneNote}`, { x: 0.6, y: 3.13, w: 4.3, h: 0.5, fontFace: FONT_BODY, fontSize: 9.5, color: BRAND.white });

  slide.addText('MAILINGS', { x: 0.6, y: 3.78, w: 4.3, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.glacier });
  slide.addText(ALIS_CONTACT.mailing, { x: 0.6, y: 4.01, w: 4.3, h: 0.4, fontFace: FONT_BODY, fontSize: 9.5, color: BRAND.white });

  // Right column — comments + email sign-up, each linked straight out.
  slide.addText('COMMENTS', { x: 5.2, y: 2.3, w: 4.2, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.glacier });
  slide.addText([
    { text: 'Have a comment or suggestion? Visit the ALIS Helpdesk site', options: { hyperlink: { url: ALIS_CONTACT.helpdeskUrl } } },
    { text: ' and ' },
    { text: 'submit a request', options: { hyperlink: { url: ALIS_CONTACT.helpdeskRequestUrl } } },
    { text: '!' },
  ], { x: 5.2, y: 2.53, w: 4.2, h: 0.6, fontFace: FONT_BODY, fontSize: 9.5, color: BRAND.white, valign: 'top' });

  slide.addText('ALIS EMAILS', { x: 5.2, y: 3.3, w: 4.2, h: 0.22, fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.glacier });
  slide.addText([
    { text: 'Interested in ALIS updates and training webinars? ' },
    { text: 'Sign up today!', options: { hyperlink: { url: ALIS_CONTACT.emailSignupUrl } } },
  ], { x: 5.2, y: 3.53, w: 4.2, h: 0.5, fontFace: FONT_BODY, fontSize: 9.5, color: BRAND.white, valign: 'top' });
}

async function buildQbrDeck(snapshot, options = {}) {
  const { companyName, communities, periodStart, periodEnd, benchmarkQuarter, normalized, diffs, ticketSummary, dealSummary, flags, hubspotHealth, releaseRecommendations } = snapshot;
  // Defaults to true — an explicit `false` (from the dashboard's billing
  // toggle) is the only thing that suppresses ALIS-native billing content.
  // Does not affect the HubSpot import slide's financial_health, which is
  // a different data source (CRM sales/service, not the ALIS billing
  // module) — see qbrFlags.js's billingRelated tag for the same distinction
  // applied to Discussion Points.
  const includeBilling = options.includeBilling !== false;
  // Default on — off entirely excludes every slide sourced from the
  // HubSpot ticket/deal pull or a health-export import (Support Review,
  // HubSpot Deals, Account Health, Project Status, Enhancement Requests,
  // Deal-Related Activity), same on/off shape as includeBilling above.
  // "Recent ALIS Platform Releases" is a separate release-recommendations
  // import, not HubSpot, so it's unaffected.
  const includeHubspot = options.includeHubspot !== false;
  // Default off — the full deck (every section, including bracketed
  // "[ Account manager: fill in... ]" placeholders) is the normal export,
  // meant to be printed and customized by hand for an actual QBR. Turning
  // this on drops every slide with nothing real to show — built for a
  // lighter monthly/bi-weekly touchpoint deck instead of a full quarterly
  // review.
  const truncateEmptySlides = Boolean(options.truncateEmptySlides);

  // Each of these mirrors a real data-availability signal from the
  // normalizers (hasBillingData / hasEvaluationData / real movement this
  // period), not just "did the field exist" — an account that doesn't run
  // billing through ALIS should never see a Financial slide claiming $0,
  // and one that doesn't use the evaluation module shouldn't see a
  // misleading 100%-non-compliant Levels of Care slide. Skipped entirely
  // rather than shown empty — a client-facing deck with a "no data" slide
  // reads as an ALIS gap, not as "not applicable to you." (These are always
  // gated this way, regardless of truncateEmptySlides — that option only
  // changes the "always-shown-with-a-no-data-fallback" slides below. The
  // HubSpot-sourced ones among these are additionally gated on
  // includeHubspot.)
  const hasResidentMovement = normalized.admissionsDischarges && (normalized.admissionsDischarges.totalAdmissions > 0 || normalized.admissionsDischarges.totalDischarges > 0);
  const hasLevelsOfCareData = normalized.careLevelEvaluations?.hasEvaluationData && normalized.careLevelEvaluations.totalResidents > 0;
  const hasSentinelIncidents = Boolean(normalized.sentinelIncidents?.hasData && normalized.sentinelIncidents.total > 0);
  const hasFinancialData = includeBilling && Boolean(normalized.billedRevenue?.hasBillingData || normalized.recurringRevenue?.hasBillingData || normalized.outstandingInvoiceSummary?.hasBillingData);
  const hasHubspotHealth = includeHubspot && Boolean(hubspotHealth);
  const hasReleaseRecommendations = Boolean(releaseRecommendations?.releases?.length);
  const openTickets = hubspotHealth?.service_health?.open_tickets?.value || [];
  const hasDealActivity = includeHubspot && Boolean(
    hubspotHealth?.financial_health?.open_deals?.value?.length || openTickets.some((t) => t.next_step_type === 'deal')
  );
  // Per client feedback: unlike Support Review/Project Status/Enhancement
  // Requests below, HubSpot Deals doesn't get the "always show, even empty,
  // with a no-data placeholder" treatment — a linked HubSpot company with
  // zero open and zero closed deals just isn't worth a slide, in the full
  // deck or the truncated one.
  const hasRealDealsData = Boolean(dealSummary) && (dealSummary.open > 0 || dealSummary.closed > 0);
  const showHubspotDeals = includeHubspot && hasRealDealsData;

  // These three always render — even with nothing real to show, they fall
  // back to their own "no data"/"[ fill in by hand ]" copy (see each
  // function above) — so whether they're truly empty has to be checked
  // separately via the same getX() helper each slide function itself uses,
  // rather than re-deriving the condition and risking it drifting out of
  // sync with what the slide actually renders.
  const hasSupportReviewData = Boolean(ticketSummary);
  const hasProjectStatusData = getProjectStatusTickets(hubspotHealth).length > 0;
  const hasEnhancementRequestsData = getEnhancementLines(ticketSummary, hubspotHealth).length > 0;
  const hasDiscussionPointsData = getDiscussionFlags(flags, includeBilling).length > 0;

  // Include an always-shown-but-sometimes-empty slide unless truncating AND
  // it's actually empty. All three of these are HubSpot-sourced, so
  // includeHubspot is a hard override on top regardless of truncate mode.
  const keep = (hasData) => !truncateEmptySlides || hasData;
  const showSupportReview = includeHubspot && keep(hasSupportReviewData);
  // Deliberately NOT gated by keep()/truncateEmptySlides like the others —
  // per Aaron (Sep 2026), an account with nothing tagged/staged Top 3 needs
  // that absence called out explicitly, in every deck variant, not hidden
  // in the lighter truncated one. Only requires a HubSpot company to be
  // linked at all (same base gate as Support Review).
  const showTopThreeEnhancements = includeHubspot && hasSupportReviewData;
  const showProjectStatus = includeHubspot && keep(hasProjectStatusData);
  const showEnhancementRequests = includeHubspot && keep(hasEnhancementRequestsData);
  const showDiscussionPoints = keep(hasDiscussionPointsData); // spans clinical/financial too, not HubSpot-only — unaffected by includeHubspot

  // Built once, in the same section order as the slide-adding calls below,
  // so the agenda can never list (or omit) something the deck doesn't
  // actually contain — see addAgendaSlide's doc comment.
  const agendaItems = [
    { label: 'Welcome and Objectives', populated: false },
    { label: 'Client Overview', populated: false },
    { label: 'Key Stats', populated: true },
  ];
  for (const [label, has] of [
    ['Resident Movement', hasResidentMovement],
    ['Levels of Care', hasLevelsOfCareData],
    ['Sentinel Incidents', hasSentinelIncidents],
    ['Financial', hasFinancialData],
    ['Account Health (HubSpot)', hasHubspotHealth],
    ['Recent ALIS Platform Releases', hasReleaseRecommendations],
    ['Deal-Related Activity', hasDealActivity],
  ]) {
    if (has) agendaItems.push({ label, populated: true });
  }
  for (const [label, show, populated] of [
    ['Support Review', showSupportReview, hasSupportReviewData],
    ['Top 3 Enhancement Requests', showTopThreeEnhancements, Boolean(ticketSummary?.topThreeEnhancements?.hasAny)],
    ['HubSpot Deals', showHubspotDeals, true],
    ['Project Status', showProjectStatus, hasProjectStatusData],
    ['Enhancement Requests', showEnhancementRequests, hasEnhancementRequestsData],
  ]) {
    if (show) agendaItems.push({ label, populated });
  }
  if (!truncateEmptySlides) {
    agendaItems.push({ label: 'AM Alignment', populated: false });
    agendaItems.push({ label: 'Strategic Initiatives', populated: false });
    agendaItems.push({ label: 'Industry Updates', populated: false });
  }

  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'QBR', width: 10, height: 5.63 });
  pptx.layout = 'QBR';

  addTitleSlide(pptx, { companyName, periodStart, periodEnd, benchmarkQuarter });
  addAgendaSlide(pptx, agendaItems);
  addClientOverviewSlide(pptx, { companyName, communities, periodStart, periodEnd, benchmarkQuarter });
  addKeyStatsSlide(pptx, { normalized, diffs });
  if (hasResidentMovement) addResidentMovementSlide(pptx, { admissionsDischarges: normalized.admissionsDischarges, demographics: normalized.demographics, lengthOfStay: normalized.lengthOfStay });
  if (hasLevelsOfCareData) addLevelsOfCareSlide(pptx, normalized.careLevelEvaluations, includeBilling);
  if (hasSentinelIncidents) addSentinelIncidentsSlide(pptx, normalized.sentinelIncidents);
  if (hasFinancialData) addFinancialSlide(pptx, { billedRevenue: normalized.billedRevenue, recurringRevenue: normalized.recurringRevenue, outstandingInvoiceSummary: normalized.outstandingInvoiceSummary, dso: normalized.dso, ppd: normalized.ppd });
  if (showSupportReview) addSupportReviewSlide(pptx, ticketSummary, hubspotHealth);
  if (showTopThreeEnhancements) addTopThreeEnhancementsSlide(pptx, ticketSummary);
  if (showHubspotDeals) addDealActivitySlide(pptx, dealSummary);
  if (hasHubspotHealth) addAccountHealthImportSlide(pptx, hubspotHealth);
  if (hasReleaseRecommendations) addReleaseRecommendationsSlide(pptx, releaseRecommendations, companyName);
  if (showProjectStatus) addProjectStatusSlide(pptx, hubspotHealth);
  if (showEnhancementRequests) addEnhancementRequestsSlide(pptx, ticketSummary, hubspotHealth);
  if (hasDealActivity) addDealRelatedTicketsSlide(pptx, hubspotHealth);
  if (showDiscussionPoints) addDiscussionPointsSlide(pptx, flags, includeBilling);
  if (!truncateEmptySlides) {
    addPlaceholderSlide(pptx, 'AM Alignment', '[ Account manager: communication cadence, executive sponsor, single point of contact ]');
    addPlaceholderSlide(pptx, 'Strategic Initiatives', '[ Account manager: 2026 roadmap items relevant to this account ]');
    addPlaceholderSlide(pptx, 'Industry Updates', '[ Account manager: market trends relevant to this account ]');
  }
  addClosingSlide(pptx, { companyName });

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildQbrDeck };
