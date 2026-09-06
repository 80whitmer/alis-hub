/**
 * Renders an Audit History snapshot to a print-formatted HTML string, then
 * to a PDF buffer via Playwright's page.pdf() — same approach as
 * wellnessPdf.js (reuses the existing Playwright dependency, no ALIS login
 * needed since this only ever loads a local HTML string).
 */
const { newPage } = require('../automation/playwright/browser');
const ALIS_CONTACT = require('./alisContactInfo');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildRowsHtml(rows, { showTarget = false } = {}) {
  if (rows.length === 0) return `<tr><td colspan="${showTarget ? 4 : 3}" class="empty">No matching audit rows.</td></tr>`;
  return rows.map((r) => `<tr>
    ${showTarget ? `<td class="target">${escapeHtml(r.targetLabel)}</td>` : ''}
    <td>${escapeHtml(r.note)}</td>
    <td class="nowrap">${escapeHtml(r.updatedAt)}</td>
    <td class="nowrap">${escapeHtml(r.updatedByName)}${r.updatedByUsername ? ` <span class="muted">(${escapeHtml(r.updatedByUsername)})</span>` : ''}</td>
  </tr>`).join('\n');
}

function buildHtml(snapshot) {
  const filterParts = [];
  if (snapshot.filters?.startDate || snapshot.filters?.endDate) filterParts.push(`${snapshot.filters.startDate || '…'} – ${snapshot.filters.endDate || '…'}`);
  if (snapshot.filters?.category) filterParts.push(`Type: ${snapshot.filters.category}`);
  if (snapshot.filters?.staffId) filterParts.push(`Staff ID: ${snapshot.filters.staffId}`);
  if (snapshot.filters?.notes) filterParts.push(`Notes contains: "${snapshot.filters.notes}"`);

  const combinedSection = `
    <section class="block">
      <h2>Combined (${snapshot.totalRows})</h2>
      <table>
        <thead><tr><th>Target</th><th>Note</th><th>Updated At</th><th>Updated By</th></tr></thead>
        <tbody>${buildRowsHtml(snapshot.combined, { showTarget: true })}</tbody>
      </table>
    </section>`;

  const perTargetSections = snapshot.targets.map((t) => `
    <section class="block">
      <h2>${escapeHtml(t.targetLabel)} (${t.rowCount})${t.truncated ? ' <span class="warn">— truncated at safety cap</span>' : ''}${t.error ? ` <span class="warn">— ${escapeHtml(t.error)}</span>` : ''}</h2>
      <table>
        <thead><tr><th>Note</th><th>Updated At</th><th>Updated By</th></tr></thead>
        <tbody>${buildRowsHtml(t.rows || [])}</tbody>
      </table>
    </section>`).join('\n');

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
  .block { page-break-inside: avoid; margin-bottom: 24px; }
  .block h2 { font-size: 13px; background: #000000; color: #fff; padding: 6px 10px; margin: 0; font-weight: 600; }
  .block h2 .warn { color: #ffb4a8; font-weight: 500; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th, td { border: 1px solid #e5e5e5; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.02em; color: #4a4a4c; }
  td.target { white-space: nowrap; color: #909295; }
  td.nowrap { white-space: nowrap; }
  td.empty { text-align: center; color: #a0a0a3; font-style: italic; }
  .muted { color: #909295; }
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
  <h1>${escapeHtml(snapshot.companyName)} — ALIS Audit History</h1>
  <p class="meta">Host: ${escapeHtml(snapshot.companyHost)} · Generated ${new Date(snapshot.generatedAt).toLocaleString()}${filterParts.length ? ` · Filters: ${filterParts.map(escapeHtml).join(' · ')}` : ' · No filters applied'}</p>
  ${combinedSection}
  ${perTargetSections}
  <section class="closing-page">
    <h1 class="closing-title">Thank You / Next Steps</h1>
    <p class="closing-sub">${escapeHtml(snapshot.companyName)}</p>
    <div class="closing-columns">
      <div>
        <h3>Contact ALIS Support</h3>
        <h4>Email</h4>
        <p>${escapeHtml(ALIS_CONTACT.email)}  &bull;  ${escapeHtml(ALIS_CONTACT.emailNote)}</p>
        <h4>Phone</h4>
        <p>${escapeHtml(ALIS_CONTACT.phone)}  &bull;  ${escapeHtml(ALIS_CONTACT.phoneNote)}</p>
      </div>
      <div>
        <h4>Comments</h4>
        <p>Have a comment or suggestion? Visit the <a href="${ALIS_CONTACT.helpdeskUrl}">ALIS Helpdesk site</a> and <a href="${ALIS_CONTACT.helpdeskRequestUrl}">submit a request</a>!</p>
      </div>
    </div>
  </section>
</body>
</html>`;
}

async function renderAuditHistoryPdf(snapshot) {
  const page = await newPage();
  try {
    await page.setContent(buildHtml(snapshot), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' }, printBackground: true });
  } finally {
    await page.context().close().catch(() => {});
  }
}

module.exports = { renderAuditHistoryPdf };
