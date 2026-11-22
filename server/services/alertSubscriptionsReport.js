const ExcelJS = require('exceljs');

/**
 * Turns an alert-subscriptions results.json into (a) a JSON summary for the Job Board
 * side panel / job page and (b) an Excel workbook. Pure functions — no I/O here.
 *
 * result row: { person, staffId?, community, communityId, status, detail, flags[], labelFound?, routes? }
 *   status: set | already-set | partial | dry-run | skipped-no-route | failed
 */

const NAVY = 'FF1F3A5F';

/** Classify a pair into a follow-up category, or null if nothing needs attention. */
function classify(r) {
  const text = `${r.detail || ''} ${(r.flags || []).join(' ')}`;
  if (r.status === 'failed') {
    if (/No hired staff named/i.test(text)) return { category: 'Staff not found', action: 'Check the spelling against ALIS (and that they are Hired). Fix the name in the mapping, then re-run.' };
    if (/ambiguous/i.test(text)) return { category: 'Ambiguous staff match', action: 'More than one ALIS staff matches the name. Add a distinguishing detail or run this person by hand.' };
    if (/not offered/i.test(text)) return { category: 'Category not offered', action: 'Sentinel Event is not available in this community (likely disabled there). Check the community alert settings.' };
    if (/not in this person's community picker/i.test(text)) return { category: 'Not associated with community', action: 'Associate this person with the community in ALIS (changes their access), then re-run.' };
    if (/Alerts tab did not load/i.test(text)) return { category: 'Alerts tab would not load', action: 'Preferences may not be set up for this person, or they are not hired.' };
    return { category: 'Failed', action: 'See the error text; screenshot saved with the run.' };
  }
  if (/MISSING CELL/i.test(text) && /MISSING EMAIL/i.test(text)) return { category: 'No email or cell', action: 'Add an email and a cell to the ALIS profile, then re-run.' };
  if (/MISSING CELL/i.test(text)) return { category: 'Missing cell phone (Email only)', action: 'Add a cell to the ALIS staff profile, then re-run — it will add Text without touching Email.' };
  if (/MISSING EMAIL/i.test(text)) return { category: 'Missing email (Text only)', action: 'Add an email to the ALIS staff profile, then re-run.' };
  if (r.status === 'skipped-no-route') return { category: 'No email or cell', action: 'Add an email and a cell to the ALIS profile, then re-run.' };
  return null;
}

function summarize(payloadOrMeta) {
  const { results = [], dryRun = false } = payloadOrMeta;
  const counts = { set: 0, 'already-set': 0, partial: 0, 'dry-run': 0, 'skipped-no-route': 0, failed: 0 };
  const people = new Map();
  const followUps = new Map();

  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (!people.has(r.person)) people.set(r.person, { person: r.person, staffId: r.staffId || null, total: 0, counts: {} });
    const p = people.get(r.person);
    p.total++;
    p.counts[r.status] = (p.counts[r.status] || 0) + 1;

    const c = classify(r);
    if (c) {
      const key = `${r.person}||${c.category}`;
      if (!followUps.has(key)) followUps.set(key, { person: r.person, category: c.category, action: c.action, communities: [], example: r.detail || '' });
      followUps.get(key).communities.push(r.community);
    }
  }

  return {
    dryRun,
    total: results.length,
    counts,
    people: [...people.values()],
    followUps: [...followUps.values()].sort((a, b) => a.person.localeCompare(b.person) || a.category.localeCompare(b.category)),
  };
}

const STATUS_LABEL = {
  set: 'Set', 'already-set': 'Already set', partial: 'Set (one route only)',
  'dry-run': 'Dry run — would set', 'skipped-no-route': 'Skipped — no route', failed: 'Failed',
};

function styleHeader(ws, rowNum, width) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  row.height = 22;
}

function buildWorkbook({ results = [], dryRun = false, alertLabel = 'Sentinel Event', jobLabel = '', generatedAt = new Date() }) {
  const s = summarize({ results, dryRun });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';

  // ── Summary (by person) ────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Summary');
  ws1.mergeCells('A1:H1');
  ws1.getCell('A1').value = `${alertLabel} alert subscriptions${dryRun ? ' — DRY RUN (nothing was changed)' : ''}`;
  ws1.getCell('A1').font = { bold: true, size: 14 };
  ws1.mergeCells('A2:H2');
  ws1.getCell('A2').value = `${jobLabel ? `${jobLabel} · ` : ''}Generated ${new Date(generatedAt).toLocaleString('en-US')} · ${s.total} person/community pairs`;
  ws1.getCell('A2').font = { italic: true, size: 10 };
  ws1.getCell('A3').value = [
    `Set: ${s.counts.set}`, `Set (one route only): ${s.counts.partial}`, `Already set: ${s.counts['already-set']}`,
    dryRun ? `Dry run: ${s.counts['dry-run']}` : null, `Skipped: ${s.counts['skipped-no-route']}`, `Failed: ${s.counts.failed}`,
  ].filter(Boolean).join('   ·   ');
  ws1.mergeCells('A3:H3');
  const H1 = 5;
  ['Person', 'Communities', 'Set', 'Set (one route only)', 'Already set', dryRun ? 'Dry run' : 'Skipped', 'Failed', 'Needs follow-up'].forEach((h, i) => { ws1.getCell(H1, i + 1).value = h; });
  styleHeader(ws1, H1, 8);
  const followByPerson = new Map();
  s.followUps.forEach((f) => followByPerson.set(f.person, [...(followByPerson.get(f.person) || []), f.category]));
  s.people.forEach((p, i) => {
    const row = ws1.getRow(H1 + 1 + i);
    row.values = [p.person, p.total, p.counts.set || 0, p.counts.partial || 0, p.counts['already-set'] || 0,
      dryRun ? (p.counts['dry-run'] || 0) : (p.counts['skipped-no-route'] || 0), p.counts.failed || 0,
      (followByPerson.get(p.person) || []).join('; ') || '—'];
    if (p.counts.failed) row.getCell(7).font = { bold: true, color: { argb: 'FFB00020' } };
  });
  ws1.columns = [{ width: 26 }, { width: 13 }, { width: 8 }, { width: 20 }, { width: 13 }, { width: 11 }, { width: 8 }, { width: 60 }];

  // ── Needs follow-up ────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Needs follow-up');
  ws2.addRow(['Person', 'Issue', 'Communities affected', 'What to do', 'Example detail']);
  styleHeader(ws2, 1, 5);
  if (!s.followUps.length) ws2.addRow(['Nothing needs follow-up.']);
  s.followUps.forEach((f) => {
    const where = f.communities.length > 6
      ? `${f.communities.length} communities (see "All results")`
      : `${f.communities.length} — ${f.communities.join(', ')}`;
    ws2.addRow([f.person, f.category, where, f.action, f.example]);
  });
  ws2.columns = [{ width: 24 }, { width: 32 }, { width: 44 }, { width: 70 }, { width: 70 }];
  ws2.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  ws2.views = [{ state: 'frozen', ySplit: 1 }];

  // ── All results ────────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('All results');
  ws3.addRow(['Person', 'ALIS staff ID', 'Community', 'Community ID', 'Result', 'Email', 'Text', 'Flags', 'Detail']);
  styleHeader(ws3, 1, 9);
  results.forEach((r) => {
    const row = ws3.addRow([
      r.person, r.staffId || '', r.community, r.communityId, STATUS_LABEL[r.status] || r.status,
      r.routes ? (r.routes.email ? 'Yes' : 'No') : '', r.routes ? (r.routes.text ? 'Yes' : 'No') : '',
      (r.flags || []).join('; '), r.detail || '',
    ]);
    if (r.status === 'failed') row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEC' } }; });
    else if (r.status === 'partial') row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6DD' } }; });
  });
  ws3.columns = [{ width: 24 }, { width: 13 }, { width: 32 }, { width: 13 }, { width: 22 }, { width: 8 }, { width: 8 }, { width: 50 }, { width: 80 }];
  ws3.views = [{ state: 'frozen', ySplit: 1 }];
  ws3.autoFilter = { from: 'A1', to: 'I1' };

  return wb;
}

module.exports = { summarize, buildWorkbook, classify };
