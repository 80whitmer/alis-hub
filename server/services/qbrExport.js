const path = require('path');
const pptxgen = require('pptxgenjs');

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

const BRAND = {
  onyx: '000000',
  white: 'FFFFFF',
  slate: '6D6E71',
  marigold: 'FBB219',
  amber: 'F06022',
  flame: 'EC4303',
  skyline: '2F8FFF',
  electricPlum: '6B4EFF',
  aqua: '3ECFCF',
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
  opportunity: BRAND.skyline,
  watch: BRAND.amber,
  info: BRAND.slate,
};

function pctStr(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function addFooter(slide, text) {
  slide.addImage({ path: LOGO_LIGHT_HORIZONTAL, x: 0.3, y: 5.25, h: 0.25, w: 0.53 });
  slide.addText(text, {
    x: 1, y: 5.2, w: 8, h: 0.3, fontFace: FONT_BODY, fontSize: 8, color: BRAND.slate, align: 'left', valign: 'middle',
  });
}

function addSectionHeader(slide, title) {
  slide.background = { color: BRAND.white };
  slide.addText(title.toUpperCase(), {
    x: 0.5, y: 0.4, w: 9, h: 0.6, fontFace: FONT_HEAD, fontSize: 28, bold: true, color: BRAND.onyx,
  });
  slide.addShape('rect', { x: 0.5, y: 1.05, w: 1.5, h: 0.05, fill: { color: BRAND.amber } });
}

function addTitleSlide(pptx, { companyName, periodStart, periodEnd, benchmarkQuarter }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.onyx };
  slide.addImage({ path: LOGO_DARK, x: 3.15, y: 0.6, w: 3.7, h: 1.75 });
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

function addAgendaSlide(pptx, populatedSections) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Agenda');
  const items = [
    'Welcome and Objectives',
    'Client Overview',
    'Key Stats',
    'Support Review',
    'Project Status',
    'Enhancement Requests',
    'AM Alignment',
    'Strategic Initiatives',
    'Industry Updates',
  ];
  slide.addText(
    items.map((label) => ({
      text: `${label}${populatedSections.includes(label) ? '  (data included)' : ''}`,
      options: { bullet: true, color: populatedSections.includes(label) ? BRAND.onyx : BRAND.slate },
    })),
    { x: 0.7, y: 1.3, w: 8.5, h: 3.8, fontFace: FONT_BODY, fontSize: 16, lineSpacingMultiple: 1.4 }
  );
}

function addClientOverviewSlide(pptx, { companyName, communities, periodStart, periodEnd }) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Client Overview');
  slide.addText(companyName, { x: 0.7, y: 1.3, w: 8.5, h: 0.5, fontFace: FONT_HEAD, fontSize: 20, bold: true, color: BRAND.onyx });
  slide.addText(`Reporting period: ${periodStart} – ${periodEnd}`, {
    x: 0.7, y: 1.8, w: 8.5, h: 0.35, fontFace: FONT_BODY, fontSize: 12, color: BRAND.slate,
  });
  slide.addText(`Communities (${communities.length}): ${communities.map((c) => c.name).join(', ')}`, {
    x: 0.7, y: 2.2, w: 8.5, h: 1, fontFace: FONT_BODY, fontSize: 12, color: BRAND.onyx,
  });
  slide.addText('[ Account manager: add relationship narrative, contract status, and executive sponsor notes here ]', {
    x: 0.7, y: 3.4, w: 8.5, h: 1.2, fontFace: FONT_BODY, fontSize: 11, italic: true, color: BRAND.slate,
  });
}

function statCard(slide, x, y, label, valueStr, diff) {
  slide.addShape('roundRect', { x, y, w: 2.75, h: 1.5, rectRadius: 0.08, fill: { color: BRAND.cardBg }, line: { color: BRAND.cardBorder, width: 1 } });
  slide.addText(label, { x: x + 0.15, y: y + 0.1, w: 2.45, h: 0.3, fontFace: FONT_BODY, fontSize: 10, color: BRAND.slate });
  slide.addText(valueStr, { x: x + 0.15, y: y + 0.35, w: 2.45, h: 0.6, fontFace: FONT_HEAD, fontSize: 24, bold: true, color: BRAND.onyx });
  if (diff) {
    const good = diff.better;
    slide.addText(`${good ? '▲' : '▼'} vs. ALIS 500: ${typeof diff.benchmark === 'number' ? diff.benchmark.toFixed(1) : diff.benchmark}`, {
      x: x + 0.15, y: y + 1.0, w: 2.45, h: 0.35, fontFace: FONT_BODY, fontSize: 9, color: good ? BRAND.skyline : BRAND.flame,
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
  statCard(slide, 6.3, 2.65, 'Sedative PRN / 1,000 res-days', normalized.prnAdministration?.sedativesAntipsychotics != null ? normalized.prnAdministration.sedativesAntipsychotics.toFixed(1) : '—', diffs.sedativePrnPer1000ResidentDays);

  // No ALIS 500 benchmark exists for care task completion yet — shown
  // without the ▲/▼-vs-benchmark line the other cards get.
  statCard(slide, 0.5, 4.0, 'Care Tasks Completed', pctStr(normalized.careCompletion?.pct), null);
}

function addSupportReviewSlide(pptx, ticketSummary) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Support Review');

  if (!ticketSummary) {
    slide.addText('No HubSpot company was linked for this KPI pull — ticket data not available.', {
      x: 0.7, y: 1.5, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  slide.addText(`${ticketSummary.total} total tickets this period  ·  ${ticketSummary.open} open  ·  ${ticketSummary.closed} closed`, {
    x: 0.7, y: 1.3, w: 8.5, h: 0.4, fontFace: FONT_BODY, fontSize: 14, bold: true, color: BRAND.onyx,
  });

  const rows = [[
    { text: 'Category', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Total', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Open', options: { bold: true, fill: { color: BRAND.pageBg } } },
    { text: 'Closed', options: { bold: true, fill: { color: BRAND.pageBg } } },
  ]];
  for (const [category, counts] of Object.entries(ticketSummary.byCategory || {})) {
    rows.push([category, String(counts.total), String(counts.open), String(counts.closed)]);
  }
  slide.addTable(rows, { x: 0.7, y: 1.9, w: 8.5, fontFace: FONT_BODY, fontSize: 11, border: { type: 'solid', color: BRAND.cardBorder, pt: 1 } });
}

function addEnhancementRequestsSlide(pptx, ticketSummary) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Enhancement Requests');

  const enhancementTickets = (ticketSummary?.tickets || []).filter((t) => (t.category || '').toLowerCase().includes('enhancement'));

  if (enhancementTickets.length === 0) {
    slide.addText('No enhancement-tagged tickets found for this period.', {
      x: 0.7, y: 1.5, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.slate,
    });
    return;
  }

  slide.addText(
    enhancementTickets.slice(0, 8).map((t) => ({
      text: `${t.subject}${t.isOpen ? `  (open, ${t.daysOpen}d)` : '  (closed)'}`,
      options: { bullet: true },
    })),
    { x: 0.7, y: 1.4, w: 8.5, h: 3.6, fontFace: FONT_BODY, fontSize: 13, color: BRAND.onyx, lineSpacingMultiple: 1.3 }
  );
}

function addDiscussionPointsSlide(pptx, flags) {
  const slide = pptx.addSlide();
  addSectionHeader(slide, 'Discussion Points — Draft for AM Review');

  slide.addText('Generated from this period\'s KPI benchmark diffs and ticket history. Edit before presenting — not client-facing as-is.', {
    x: 0.5, y: 1.1, w: 9, h: 0.35, fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.slate,
  });

  if (flags.length === 0) {
    slide.addText('No flags this period — all tracked KPIs are at or ahead of the ALIS 500 benchmark.', {
      x: 0.7, y: 1.7, w: 8.5, h: 0.5, fontFace: FONT_BODY, fontSize: 12, color: BRAND.onyx,
    });
    return;
  }

  let y = 1.55;
  for (const flag of flags.slice(0, 6)) {
    slide.addShape('rect', { x: 0.5, y, w: 0.08, h: 0.55, fill: { color: SEVERITY_COLOR[flag.severity] || BRAND.slate } });
    slide.addText(flag.title, { x: 0.7, y, w: 8.6, h: 0.3, fontFace: FONT_BODY, fontSize: 12, bold: true, color: BRAND.onyx });
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

function addClosingSlide(pptx, { companyName }) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.onyx };
  slide.addText('Thank You / Next Steps', {
    x: 0.5, y: 2.0, w: 9, h: 0.7, fontFace: FONT_HEAD, fontSize: 28, bold: true, color: BRAND.white, align: 'center',
  });
  slide.addText(`${companyName} — see you next quarter.`, {
    x: 0.5, y: 2.8, w: 9, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: BRAND.marigold, align: 'center',
  });
}

async function buildQbrDeck(snapshot) {
  const { companyName, communities, periodStart, periodEnd, benchmarkQuarter, normalized, diffs, ticketSummary, flags } = snapshot;

  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'QBR', width: 10, height: 5.63 });
  pptx.layout = 'QBR';

  addTitleSlide(pptx, { companyName, periodStart, periodEnd, benchmarkQuarter });
  addAgendaSlide(pptx, ['Key Stats', 'Support Review', 'Enhancement Requests']);
  addClientOverviewSlide(pptx, { companyName, communities, periodStart, periodEnd });
  addKeyStatsSlide(pptx, { normalized, diffs });
  addSupportReviewSlide(pptx, ticketSummary);
  addPlaceholderSlide(pptx, 'Project Status', '[ Account manager: list completed and in-flight projects for this account ]');
  addEnhancementRequestsSlide(pptx, ticketSummary);
  addDiscussionPointsSlide(pptx, flags);
  addPlaceholderSlide(pptx, 'AM Alignment', '[ Account manager: communication cadence, executive sponsor, single point of contact ]');
  addPlaceholderSlide(pptx, 'Strategic Initiatives', '[ Account manager: 2026 roadmap items relevant to this account ]');
  addPlaceholderSlide(pptx, 'Industry Updates', '[ Account manager: market trends relevant to this account ]');
  addClosingSlide(pptx, { companyName });

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildQbrDeck };
