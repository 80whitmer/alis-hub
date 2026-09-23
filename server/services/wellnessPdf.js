/**
 * Renders a Weekly Wellness Scorecard snapshot to a print-formatted HTML
 * string, then to a PDF buffer via Playwright's page.pdf() — reusing the
 * project's existing Playwright dependency (server/automation/playwright/browser.js)
 * rather than adding a new PDF library. No ALIS login needed here, since
 * this only ever loads a local HTML string, not alisonline.com.
 */
const { newPage } = require('../automation/playwright/browser');
const { WELLNESS_ROWS, resolveWellnessRow, NOT_TRACKED } = require('./wellnessRowDefinitions');
const ALIS_CONTACT = require('./alisContactInfo');
const { bandFor } = require('./wellnessHealthScoring');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Every row here is a risk/concern count, so ↑ (more this week) reads as a
// warning color, ↓ as success, → as neutral — same rule as the on-screen
// table's TrendArrow component (client/src/pages/WellnessScorecard.jsx).
const TREND_CLASS = { '↑': 'trend-up', '↓': 'trend-down', '→': 'trend-flat' };
function trendCell(trend) {
  if (!trend || trend === '—') return '<td class="center trend-none">—</td>';
  return `<td class="center ${TREND_CLASS[trend] || ''}">${escapeHtml(trend)}</td>`;
}

// Same signal as DocCompletionBadge in the on-screen table
// (client/src/pages/WellnessScorecard.jsx) — how many of this row's
// incidents this week still have an incomplete form or intervention.
function docCompletionNote(row, v) {
  if (!row.hasDocCompletion || !v.openDocsTotal) return '';
  const reporterNote = v.openDocsReporters?.length
    ? ` (${v.openDocsReporters.map((r) => `${escapeHtml(r.name)}${r.count > 1 ? ` x${r.count}` : ''}`).join(', ')})`
    : '';
  return ` <span class="doc-completion">⚠ ${v.openDocsTotal} undocumented${reporterNote}</span>`;
}

const AGE_BANDS = ['<60', '60s', '70s', '80s', '90s', '100+'];

/** Same per-scope "average age + decade bands" line as the on-screen ResidentAgeSummary (WellnessScorecard.jsx) — mirrors that placement (inside each scope's table, not a separate portfolio-only section) since normalizeResidentAge computes both portfolio and per-community. */
function residentAgeLine(snapshot, communityId) {
  const ageData = communityId ? snapshot.residentAge?.byCommunity?.[communityId] : snapshot.residentAge?.portfolio;
  if (!ageData || ageData.countedForAge === 0) return '';
  const coverage = ageData.countedForAge < ageData.totalResidents ? ` (${ageData.countedForAge} of ${ageData.totalResidents} with age on file)` : '';
  const bands = AGE_BANDS.map((b) => `${b}: ${ageData.bandCounts[b]}`).join('  ·  ');
  return `<p style="font-size:10px; color:#4a4a4c; margin:0 0 8px;"><strong>${ageData.avgAge.toFixed(1)}</strong> avg resident age${coverage}  —  ${escapeHtml(bands)}</p>`;
}

/**
 * Same per-community occupancy breakdown as the Excel export's Occupancy
 * sheet and the on-screen WellnessTable (Aaron, Sep 2026: "add the
 * occupancy breakdown per community on the community sections") — only
 * when there's a communityId; the portfolio gets its own full-width
 * buildOccupancySection instead, so this doesn't duplicate that.
 * wellnessNormalizer.js's normalizeOccupancySnapshot scopes
 * byProductType/byClassification to each community's own occupied count
 * now, not just the portfolio's.
 */
function communityOccupancyBlock(snapshot, communityId) {
  if (!communityId) return '';
  const cOcc = snapshot.rows?.occupancy?.byCommunity?.[communityId];
  if (!cOcc?.total) return '';

  const pctStr = (p) => (p != null ? `${(p * 100).toFixed(1)}%` : '—');
  const breakdownTable = (title, rows, keyField) => rows?.length ? `
    <div style="flex:1">
      <h4 style="font-size:9.5px;margin:0 0 4px;color:#4a4a4c;">${escapeHtml(title)}</h4>
      <table>
        <thead><tr><th>${keyField === 'productType' ? 'Product Type' : 'Classification'}</th><th class="num">% of Census</th><th class="num">Occupied / Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(String(r[keyField]))}</td><td class="num">${pctStr(r.pct)}</td><td class="num">${r.occupied} / ${r.total}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>` : '';

  return `
    <div style="margin:0 0 8px;">
      <p style="font-size:10px; color:#4a4a4c; margin:0 0 6px;"><strong>${pctStr(cOcc.occupied / cOcc.total)}</strong> occupied — ${cOcc.occupied} / ${cOcc.total}</p>
      <div style="display:flex; gap:16px;">
        ${breakdownTable('By Product Type', cOcc.byProductType, 'productType')}
        ${breakdownTable('By Classification', cOcc.byClassification, 'classification')}
      </div>
    </div>`;
}

function buildTable(title, snapshot, communityId, hideUntracked) {
  let currentCategory = null;
  // Resolve-then-filter, not a filter on the row's static `source` — see
  // client/src/utils/wellnessScorecardExport.js's identical reasoning
  // (Sep 2026, Aaron): a `source: 'rows'` row can still have no real data
  // for this account/week, and the hide toggle is meant to catch those
  // too, not just the always-manual rows.
  const rows = WELLNESS_ROWS
    .map((row) => ({ row, v: resolveWellnessRow(row, snapshot, communityId) }))
    .filter(({ v }) => !hideUntracked || v.total !== NOT_TRACKED)
    .map(({ row, v }) => {
      const showCategory = row.category !== currentCategory;
      currentCategory = row.category;
      return `<tr>
      <td class="cat">${showCategory ? escapeHtml(row.category) : ''}</td>
      <td>${escapeHtml(row.label)}${docCompletionNote(row, v)}</td>
      <td class="num">${escapeHtml(v.al)}</td>
      <td class="num">${escapeHtml(v.mc)}</td>
      <td class="num total">${escapeHtml(v.total)}</td>
      <td class="num">${escapeHtml(v.prior)}</td>
      ${trendCell(v.trend)}
    </tr>`;
    }).join('\n');

  return `
    <section class="scorecard">
      <h2>${escapeHtml(title)}</h2>
      ${residentAgeLine(snapshot, communityId)}
      ${communityOccupancyBlock(snapshot, communityId)}
      <table>
        <thead>
          <tr>
            <th>Category</th><th>Key Indicator</th><th>AL</th><th>MC</th><th>Total</th><th>Prior Week</th><th>Trend</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/** Last page of the PDF — ALIS contact info, kept in sync with the QBR PPTX's closing slide via server/services/alisContactInfo.js. */
function buildClosingPage(companyName) {
  return `
    <section class="closing-page">
      <h1 class="closing-title">Thank You / Next Steps</h1>
      <p class="closing-sub">${escapeHtml(companyName)} — see you next week.</p>
      <div class="closing-columns">
        <div>
          <h3>Contact ALIS Support</h3>
          <h4>Email</h4>
          <p>${escapeHtml(ALIS_CONTACT.email)}  &bull;  ${escapeHtml(ALIS_CONTACT.emailNote)}</p>
          <h4>Phone</h4>
          <p>${escapeHtml(ALIS_CONTACT.phone)}  &bull;  ${escapeHtml(ALIS_CONTACT.phoneNote)}</p>
          <h4>Mailings</h4>
          <p>${escapeHtml(ALIS_CONTACT.mailing)}</p>
        </div>
        <div>
          <h4>Comments</h4>
          <p>Have a comment or suggestion? Visit the <a href="${ALIS_CONTACT.helpdeskUrl}">ALIS Helpdesk site</a> and <a href="${ALIS_CONTACT.helpdeskRequestUrl}">submit a request</a>!</p>
          <h4>ALIS Emails</h4>
          <p>Interested in ALIS updates and training webinars? <a href="${ALIS_CONTACT.emailSignupUrl}">Sign up today!</a></p>
        </div>
      </div>
    </section>`;
}

// Same 0-100/red-orange-blue-green convention as the on-screen ScoreBadge
// (WellnessScorecard.jsx) and wellnessHealthScoring.js's SCORE_BANDS.
const BAND_COLOR = { red: '#dc2626', orange: '#ea580c', blue: '#2563eb', green: '#16a34a' };

/**
 * One row per community — same fields as the on-screen CommunitiesTable
 * (WellnessScorecard.jsx), so a Wellness Director skimming the printed
 * report gets the same rollup as the dashboard, not just the per-community
 * detail tables below.
 */
function buildCommunitiesSection(snapshot) {
  const communityHealth = snapshot.communityHealth;
  if (!communityHealth?.length) return '';

  const pctStr = (p) => (p != null ? `${(p * 100).toFixed(1)}%` : '—');
  const scoreCell = (c) => {
    if (c.score == null) return '<td class="center">—</td>';
    const color = BAND_COLOR[c.band?.color] || '#737373';
    return `<td class="center"><span style="display:inline-block; min-width:22px; padding:1px 6px; border-radius:10px; color:#fff; font-weight:700; background:${color};" title="${escapeHtml(c.band?.label || '')}">${c.score}</span></td>`;
  };

  const rows = communityHealth.map((c) => `<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.region || '—')}</td>
      ${scoreCell(c)}
      <td class="num">${pctStr(c.occupancyPct)}</td>
      <td class="num">${c.census}</td>
      <td class="num">${c.fallsTotal}</td>
      <td class="num">${c.hospitalTotal}</td>
      <td class="num">${c.medExceptionsTotal}</td>
      <td class="num">${c.evaluationsOverdueTotal}</td>
    </tr>`).join('\n');

  return `
    <section class="scorecard">
      <h2>Communities</h2>
      <table>
        <thead>
          <tr>
            <th>Community</th><th>Region</th><th class="num">Health Score</th><th class="num">Occupancy</th><th class="num">Census</th><th class="num">Falls</th><th class="num">Hospital/ER</th><th class="num">Med Exceptions</th><th class="num">Evals Overdue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/**
 * Same region grouping as wellnessScorecardExport.js's groupByRegion — kept
 * as a separate copy rather than shared, matching how this whole
 * client-export/server-PDF pair already duplicates its row-building logic
 * (see buildTable above vs. addScorecardSheet). Communities with no region
 * on file group under 'Unassigned', same as wellnessHealthScoring.js's
 * computeRollup.
 */
function groupByRegion(communityHealth) {
  const map = new Map();
  for (const c of communityHealth) {
    const region = c.region || 'Unassigned';
    if (!map.has(region)) map.set(region, []);
    map.get(region).push(c);
  }
  const avg = (list, field) => {
    const vals = list.map((c) => c[field]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const sum = (list, field) => list.reduce((a, c) => a + (c[field] || 0), 0);
  return Array.from(map.entries())
    .map(([region, list]) => ({
      region,
      communityCount: list.length,
      avgScore: avg(list, 'score') != null ? Math.round(avg(list, 'score')) : null,
      avgOccupancyPct: avg(list, 'occupancyPct'),
      census: sum(list, 'census'),
      fallsTotal: sum(list, 'fallsTotal'),
      hospitalTotal: sum(list, 'hospitalTotal'),
      medExceptionsTotal: sum(list, 'medExceptionsTotal'),
      evaluationsOverdueTotal: sum(list, 'evaluationsOverdueTotal'),
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/**
 * Regional roll-up (Aaron, Sep 2026: "add a regional roll up for the
 * communities") — same grouping as the on-screen RegionComparisonSection
 * but with the underlying KPI totals, not just avgScore, same rationale as
 * the Excel export's Regional Rollup sheet.
 */
function buildRegionalRollupSection(snapshot) {
  const communityHealth = snapshot.communityHealth;
  if (!communityHealth?.length) return '';

  const pctStr = (p) => (p != null ? `${(p * 100).toFixed(1)}%` : '—');
  const scoreCell = (r) => {
    if (r.avgScore == null) return '<td class="center">—</td>';
    const color = BAND_COLOR[bandFor(r.avgScore).color] || '#737373';
    return `<td class="center"><span style="display:inline-block; min-width:22px; padding:1px 6px; border-radius:10px; color:#fff; font-weight:700; background:${color};">${r.avgScore}</span></td>`;
  };

  const rows = groupByRegion(communityHealth).map((r) => `<tr>
      <td>${escapeHtml(r.region)}</td>
      <td class="num">${r.communityCount}</td>
      ${scoreCell(r)}
      <td class="num">${pctStr(r.avgOccupancyPct)}</td>
      <td class="num">${r.census}</td>
      <td class="num">${r.fallsTotal}</td>
      <td class="num">${r.hospitalTotal}</td>
      <td class="num">${r.medExceptionsTotal}</td>
      <td class="num">${r.evaluationsOverdueTotal}</td>
    </tr>`).join('\n');

  return `
    <section class="scorecard">
      <h2>Regional Rollup</h2>
      <table>
        <thead>
          <tr>
            <th>Region</th><th class="num">Communities</th><th class="num">Avg Health Score</th><th class="num">Avg Occupancy</th><th class="num">Total Census</th><th class="num">Total Falls</th><th class="num">Total Hospital/ER</th><th class="num">Total Med Exceptions</th><th class="num">Total Evals Overdue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/**
 * Occupancy as of the week-ending date, by product type and
 * classification — not part of the original mirrored spreadsheet
 * (unlike buildTable above), so its own small section rather than forced
 * into that fixed row shape. Portfolio-level only, matching what
 * wellnessNormalizer.js's normalizeOccupancySnapshot computes today.
 */
function buildOccupancySection(snapshot) {
  const occupancy = snapshot.rows?.occupancy;
  if (!occupancy?.hasOccupancyData) return '';

  const pctStr = (p) => (p != null ? `${(p * 100).toFixed(1)}%` : '—');
  const breakdownTable = (title, rows, keyField) => rows?.length ? `
    <div style="flex:1">
      <h3 style="font-size:11px;margin:0 0 6px;">${escapeHtml(title)}</h3>
      <table>
        <thead><tr><th>${keyField === 'productType' ? 'Product Type' : 'Classification'}</th><th class="num">% of Census</th><th class="num">Occupied / Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(String(r[keyField]))}</td><td class="num">${pctStr(r.pct)}</td><td class="num">${r.occupied} / ${r.total}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>` : '';

  return `
  <div class="scorecard">
    <h2>Occupancy — as of ${escapeHtml(snapshot.weekEnding)}</h2>
    <div style="padding:10px; border:1px solid #e5e5e5; border-top:none;">
      <p style="font-size:13px; margin:0 0 10px;"><strong>${pctStr(occupancy.pct)}</strong> overall — ${occupancy.occupied} / ${occupancy.total} occupied</p>
      <div style="display:flex; gap:24px;">
        ${breakdownTable('By Product Type', occupancy.byProductType, 'productType')}
        ${breakdownTable('By Classification', occupancy.byClassification, 'classification')}
      </div>
    </div>
  </div>`;
}

/**
 * Next 14 days, mirroring the on-screen UpcomingBirthdaysPanel
 * (client/src/components/UpcomingBirthdaysPanel.jsx) and its data source,
 * server/services/kpiNormalizer.js's normalizeUpcomingBirthdays. Kept as
 * its own small section rather than forced into buildTable's fixed
 * AL/MC/Total row shape, same rationale as buildOccupancySection above.
 */
function buildBirthdaysSection(snapshot) {
  const data = snapshot.upcomingBirthdays;
  const residents = data?.residents || [];
  const staff = data?.staff || [];
  if (residents.length === 0 && staff.length === 0) return '';

  const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const list = (items, describe) => items.length
    ? `<ul style="margin:0; padding-left:16px; font-size:10px; line-height:1.6;">
        ${items.map((item) => `<li>${escapeHtml(item.name || '—')} — ${escapeHtml(describe(item))} <span style="color:#909295;">(${fmtDate(item.birthdayDate)})</span></li>`).join('\n')}
      </ul>`
    : '<p style="font-size:10px; color:#909295; margin:0;">None in this window.</p>';

  // Decade milestones (80, 90, 100...) — same tile as the on-screen MilestoneCountTile.
  const milestones = residents.filter((r) => r.isDecadeMilestone);
  const byAge = milestones.reduce((acc, r) => {
    acc[r.turningAge] = (acc[r.turningAge] || 0) + 1;
    return acc;
  }, {});
  const milestoneBreakdown = Object.entries(byAge)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([age, count]) => `Turning ${age}: ${count}`)
    .join(' &middot; ');
  const milestoneTile = `
    <div style="display:inline-block; border:1px solid #e5e5e5; border-radius:6px; padding:8px 12px; margin-bottom:10px;">
      <p style="font-size:9px; color:#909295; text-transform:uppercase; margin:0;">Decade Milestones (next 14 days)</p>
      <p style="font-size:18px; font-weight:700; margin:2px 0 0;">${milestones.length}</p>
      ${milestoneBreakdown ? `<p style="font-size:9px; color:#909295; margin:2px 0 0;">${milestoneBreakdown}</p>` : ''}
    </div>`;

  return `
  <div class="scorecard">
    <h2>Upcoming Birthdays &amp; Milestones — next 14 days</h2>
    ${milestoneTile}
    <div style="padding:10px; border:1px solid #e5e5e5; border-top:none; display:flex; gap:24px;">
      <div style="flex:1">
        <h3 style="font-size:11px;margin:0 0 6px;">Residents</h3>
        ${list(residents, (r) => `${r.productType ? `${r.productType}, ` : ''}turning ${r.turningAge}${r.isDecadeMilestone ? ' 🎉' : ''}`)}
      </div>
      <div style="flex:1">
        <h3 style="font-size:11px;margin:0 0 6px;">Staff</h3>
        ${list(staff, (s) => s.jobRole || 'Staff')}
      </div>
    </div>
  </div>`;
}

function buildHtml(snapshot, hideUntracked) {
  const sections = [buildCommunitiesSection(snapshot), buildRegionalRollupSection(snapshot), buildOccupancySection(snapshot), buildBirthdaysSection(snapshot), buildTable('Portfolio', snapshot, null, hideUntracked)]
    .concat(snapshot.communities.map((c) => buildTable(c.name, snapshot, String(c.communityId), hideUntracked)))
    .join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend+Exa:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Lexend Exa', Arial, Helvetica, sans-serif; color: #000000; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; font-weight: 700; }
  .meta { font-size: 11px; color: #6d6e71; margin-bottom: 20px; }
  .scorecard { page-break-inside: avoid; margin-bottom: 28px; }
  .scorecard h2 { font-size: 14px; background: #000000; color: #fff; padding: 6px 10px; margin: 0 0 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  th, td { border: 1px solid #e5e5e5; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; font-size: 9px; text-transform: uppercase; letter-spacing: 0.02em; color: #4a4a4c; }
  td.cat { color: #909295; white-space: nowrap; }
  td.num { text-align: right; }
  td.total { font-weight: bold; }
  .trend-up, .trend-down, .trend-flat { font-size: 13px; font-weight: 700; }
  .trend-up { color: #e22405; }
  .trend-down { color: #10b981; }
  .trend-flat { color: #909295; }
  .trend-none { color: #d4d4d4; }
  .doc-completion { color: #e22405; font-weight: 600; white-space: nowrap; }
  td.center { text-align: center; }
  .closing-page { page-break-before: always; padding-top: 8px; }
  .closing-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .closing-sub { font-size: 11px; color: #6d6e71; margin: 0 0 24px; }
  .closing-columns { display: flex; gap: 40px; }
  .closing-columns > div { flex: 1; }
  .closing-columns h3 { color: #f06022; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; margin: 0 0 14px; }
  .closing-columns h4 { color: #56a5c9; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; margin: 14px 0 3px; }
  .closing-columns p { font-size: 10px; margin: 0; line-height: 1.5; color: #333; }
  .closing-columns a { color: #56a5c9; text-decoration: none; }
</style>
</head>
<body>
  <h1>${escapeHtml(snapshot.companyName)} — Weekly Wellness Scorecard</h1>
  <p class="meta">Week ending ${escapeHtml(snapshot.weekEnding)} · benchmarked against ALIS 500 (${escapeHtml(snapshot.benchmarkQuarter)}) where published</p>
  ${sections}
  ${buildClosingPage(snapshot.companyName)}
</body>
</html>`;
}

async function renderWellnessPdf(snapshot, hideUntracked = false) {
  const page = await newPage();
  try {
    await page.setContent(buildHtml(snapshot, hideUntracked), { waitUntil: 'load' });
    // 'load' fires once the Google Fonts stylesheet is fetched, but the
    // WOFF2 files it references can still be downloading — without this,
    // the PDF risks snapshotting the Arial fallback instead of Lexend Exa.
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' }, printBackground: true });
  } finally {
    await page.context().close().catch(() => {});
  }
}

module.exports = { renderWellnessPdf };
