/**
 * Renders a Weekly Wellness Scorecard snapshot to a print-formatted HTML
 * string, then to a PDF buffer via Playwright's page.pdf() — reusing the
 * project's existing Playwright dependency (server/automation/playwright/browser.js)
 * rather than adding a new PDF library. No ALIS login needed here, since
 * this only ever loads a local HTML string, not alisonline.com.
 */
const { newPage } = require('../automation/playwright/browser');
const { WELLNESS_ROWS, resolveWellnessRow } = require('./wellnessRowDefinitions');
const ALIS_CONTACT = require('./alisContactInfo');

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

function buildTable(title, snapshot, communityId) {
  let currentCategory = null;
  const rows = WELLNESS_ROWS.map((row) => {
    const v = resolveWellnessRow(row, snapshot, communityId);
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

  return `
  <div class="scorecard">
    <h2>Upcoming Birthdays &amp; Milestones — next 14 days</h2>
    <div style="padding:10px; border:1px solid #e5e5e5; border-top:none; display:flex; gap:24px;">
      <div style="flex:1">
        <h3 style="font-size:11px;margin:0 0 6px;">Residents</h3>
        ${list(residents, (r) => `turning ${r.turningAge}${r.isMajorMilestone ? ' 🎉' : ''}`)}
      </div>
      <div style="flex:1">
        <h3 style="font-size:11px;margin:0 0 6px;">Staff</h3>
        ${list(staff, (s) => s.jobRole || 'Staff')}
      </div>
    </div>
  </div>`;
}

function buildHtml(snapshot) {
  const sections = [buildOccupancySection(snapshot), buildBirthdaysSection(snapshot), buildTable('Portfolio', snapshot, null)]
    .concat(snapshot.communities.map((c) => buildTable(c.name, snapshot, String(c.communityId))))
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

async function renderWellnessPdf(snapshot) {
  const page = await newPage();
  try {
    await page.setContent(buildHtml(snapshot), { waitUntil: 'load' });
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
