/**
 * Moved-Out Residents With Open Billing — flags moved-out residents who still
 * have money moving in ALIS, so Community staff can wrap up billing.
 *
 * ALIS shows a "Resident still has billing enabled!" banner on a moved-out
 * resident's profile, but that flag is NOT in the export API (confirmed
 * against ALIS_EXPORT_API_REFERENCE.md and a live Saga pull, Oct 2026 — the
 * banner can be on for a resident with zero recurring charges and zero
 * invoices). So this is a proxy built from three signals that ARE exported:
 *
 *   High    — a recurring charge still Active/Future that is open-ended or runs
 *             past the financial move-out date (billing genuinely scheduled)
 *   Medium  — no live charge, but an outstanding invoice balance > 0
 *   Low     — all charges ended, but at least one ended AFTER the financial
 *             move-out date (possible over-billing / final prorate)
 *
 * Charges that end on or before the financial move-out date are treated as
 * correctly wrapped up — otherwise every upcoming move-out looks "High".
 */
const ExcelJS = require('exceljs');
const { alisApiGet, getOutstandingInvoices, getHistoricalMoveInMoveOuts } = require('./alisApiClient');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const PRIORITY_FILL = {
  High: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } },
  Medium: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
};
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

const asArray = (res) => (Array.isArray(res) ? res : res?.items || []);
const day = (s) => (s ? String(s).slice(0, 10) : '');
const isTraining = (name) => (name || '').toLowerCase().includes('training');

/**
 * Build the report data for one ALIS company host.
 * @param {string} companyHost
 * @param {{ communityName?: string, includeTraining?: boolean }} [opts]
 *   communityName — optional case-insensitive substring filter on community.
 */
async function buildMovedOutBillingReport(companyHost, { communityName, includeTraining = false } = {}) {
  const [charges, invoices, stays] = await Promise.all([
    alisApiGet(companyHost, '/v1/export/billing/recurringCharges', { residentStatus: 'MovedOut' }).then(asArray),
    getOutstandingInvoices(companyHost).then(asArray),
    getHistoricalMoveInMoveOuts(companyHost).then(asArray),
  ]);

  const nameFilter = (communityName || '').trim().toLowerCase();
  const keep = (name) => (includeTraining || !isTraining(name)) && (!nameFilter || (name || '').toLowerCase().includes(nameFilter));
  const today = new Date().toISOString().slice(0, 10);

  // Latest stay per moved-out resident (a resident can have several stays).
  const moveOut = new Map();
  for (const s of stays) {
    if (s.residentStatus !== 'Moved Out') continue;
    const cur = moveOut.get(s.residentId);
    if (!cur || String(s.financialMoveOutDate || '') > String(cur.financialMoveOutDate || '')) moveOut.set(s.residentId, s);
  }

  const residents = new Map();
  const ensure = (id, name, community) => {
    if (!residents.has(id)) residents.set(id, { residentId: id, name, community, liveCharges: [], pastMoveOut: [], invoices: [] });
    return residents.get(id);
  };

  for (const c of charges) {
    if (!keep(c.communityName)) continue;
    const mo = moveOut.get(c.residentId);
    const rec = ensure(c.residentId, c.residentName, c.communityName);
    const endsAsScheduled = mo?.financialMoveOutDate && c.serviceEndDate && day(c.serviceEndDate) <= day(mo.financialMoveOutDate);
    if ((c.chargeStatus === 'Active' || c.chargeStatus === 'Future') && !endsAsScheduled) rec.liveCharges.push(c);
    else if (mo?.financialMoveOutDate && c.serviceEndDate && day(c.serviceEndDate) > day(mo.financialMoveOutDate)) rec.pastMoveOut.push(c);
  }
  for (const i of invoices) {
    if (i.residentStatus !== 'Moved Out' || !(i.invoiceBalance > 0) || !keep(i.communityName)) continue;
    ensure(i.residentId, i.residentFullName, i.communityName).invoices.push(i);
  }

  const rows = [];
  for (const r of residents.values()) {
    if (!r.liveCharges.length && !r.invoices.length && !r.pastMoveOut.length) continue;
    const mo = moveOut.get(r.residentId) || {};
    const flags = [];
    if (r.liveCharges.length) flags.push('Active/Future recurring charge');
    if (r.invoices.length) flags.push('Open invoice balance');
    if (r.pastMoveOut.length) flags.push('Charge ran past financial move-out');
    rows.push({
      priority: r.liveCharges.length ? 'High' : r.invoices.length ? 'Medium' : 'Low',
      community: r.community,
      resident: r.name,
      residentId: r.residentId,
      physicalMoveOut: day(mo.physicalMoveOutDate),
      financialMoveOut: day(mo.financialMoveOutDate),
      daysSinceMoveOut: mo.financialMoveOutDate
        ? Math.floor((Date.parse(today) - Date.parse(day(mo.financialMoveOutDate))) / 864e5)
        : null,
      moveOutReason: mo.moveOutReason || '',
      flags: flags.join('; '),
      liveCharges: r.liveCharges.length,
      liveMonthly: r.liveCharges.reduce((a, c) => a + (c.isPerDiem ? 0 : c.unitPrice * (c.quantity || 1)), 0),
      latestChargeEnd: r.liveCharges.map((c) => day(c.serviceEndDate) || 'open-ended').sort().pop() || '',
      openInvoices: r.invoices.length,
      openBalance: r.invoices.reduce((a, i) => a + i.invoiceBalance, 0),
      pastMoveOutCharges: r.pastMoveOut.length,
      _liveCharges: r.liveCharges,
      _pastMoveOut: r.pastMoveOut,
      _invoices: r.invoices,
    });
  }
  rows.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.community || '').localeCompare(b.community || '')
    || (b.daysSinceMoveOut || 0) - (a.daysSinceMoveOut || 0));

  const byCommunity = new Map();
  for (const r of rows) {
    const o = byCommunity.get(r.community) || { community: r.community, flagged: 0, high: 0, medium: 0, low: 0, openBalance: 0 };
    o.flagged++;
    o[r.priority.toLowerCase()]++;
    o.openBalance += r.openBalance;
    byCommunity.set(r.community, o);
  }

  const counts = {
    movedOutResidentsWithCharges: new Set(charges.filter((c) => keep(c.communityName)).map((c) => c.residentId)).size,
    flagged: rows.length,
    high: rows.filter((r) => r.priority === 'High').length,
    medium: rows.filter((r) => r.priority === 'Medium').length,
    low: rows.filter((r) => r.priority === 'Low').length,
    openBalance: rows.reduce((a, r) => a + r.openBalance, 0),
  };

  return {
    companyHost,
    communityFilter: communityName || null,
    generatedOn: today,
    counts,
    communities: [...byCommunity.values()].sort((a, b) => b.high - a.high || b.medium - a.medium || b.flagged - a.flagged),
    rows,
  };
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
}

function buildMovedOutBillingWorkbook(report) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet('Summary by Community');
  sum.columns = [
    { header: 'Community', key: 'community', width: 44 },
    { header: 'Residents Flagged', key: 'flagged', width: 16 },
    { header: 'High (live charge)', key: 'high', width: 18 },
    { header: 'Medium (open invoice)', key: 'medium', width: 20 },
    { header: 'Low (charge past move-out)', key: 'low', width: 24 },
    { header: 'Open Invoice $', key: 'openBalance', width: 16, style: { numFmt: '$#,##0.00' } },
  ];
  report.communities.forEach((c) => sum.addRow(c));
  styleHeader(sum);

  const ws = wb.addWorksheet('Residents to Review');
  ws.columns = [
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Community', key: 'community', width: 36 },
    { header: 'Resident', key: 'resident', width: 26 },
    { header: 'Resident ID', key: 'residentId', width: 12 },
    { header: 'Physical Move-Out', key: 'physicalMoveOut', width: 16 },
    { header: 'Financial Move-Out', key: 'financialMoveOut', width: 17 },
    { header: 'Days Since Financial Move-Out', key: 'daysSinceMoveOut', width: 18 },
    { header: 'Move-Out Reason', key: 'moveOutReason', width: 20 },
    { header: 'Flags', key: 'flags', width: 44 },
    { header: '# Live Charges', key: 'liveCharges', width: 12 },
    { header: 'Live Monthly $ (non per-diem)', key: 'liveMonthly', width: 18, style: { numFmt: '$#,##0.00' } },
    { header: 'Latest Charge End', key: 'latestChargeEnd', width: 16 },
    { header: '# Open Invoices', key: 'openInvoices', width: 12 },
    { header: 'Open Invoice Balance', key: 'openBalance', width: 16, style: { numFmt: '$#,##0.00' } },
    { header: '# Charges Past Move-Out', key: 'pastMoveOutCharges', width: 14 },
  ];
  report.rows.forEach((r) => {
    const row = ws.addRow(r);
    if (PRIORITY_FILL[r.priority]) row.getCell(1).fill = PRIORITY_FILL[r.priority];
  });
  styleHeader(ws);

  const det = wb.addWorksheet('Charge Detail');
  det.columns = ['Community', 'Resident', 'Resident ID', 'Type', 'Charge', 'Charge Status', 'Service Start', 'Service End', 'Unit Price', 'Qty', 'Per Diem', 'Payer']
    .map((h) => ({ header: h, width: h === 'Charge' ? 34 : h === 'Community' ? 36 : 16 }));
  for (const r of report.rows) {
    for (const [type, list] of [['Live (Active/Future)', r._liveCharges], ['Ended past move-out', r._pastMoveOut]]) {
      for (const c of list) {
        det.addRow([r.community, r.resident, r.residentId, type, c.chargeName, c.chargeStatus, day(c.serviceStartDate), day(c.serviceEndDate) || 'open-ended', c.unitPrice, c.quantity, c.isPerDiem ? 'Y' : 'N', c.payerType]);
      }
    }
  }
  styleHeader(det);

  const inv = wb.addWorksheet('Open Invoice Detail');
  inv.columns = ['Community', 'Resident', 'Resident ID', 'Invoice ID', 'Invoice Date', 'Due Date', 'Total', 'Payments', 'Credits', 'Balance', 'Payer']
    .map((h) => ({ header: h, width: h === 'Community' ? 36 : 16 }));
  for (const r of report.rows) {
    for (const i of r._invoices) {
      inv.addRow([r.community, r.resident, r.residentId, i.invoiceId, day(i.invoiceDate), day(i.invoiceDueDate), i.invoiceTotal, i.appliedPayments, i.appliedCredits, i.invoiceBalance, i.payerFullName]);
    }
  }
  styleHeader(inv);

  const notes = wb.addWorksheet('Methodology Notes');
  notes.getColumn(1).width = 120;
  [
    `Company host: ${report.companyHost}${report.communityFilter ? ` · community filter: "${report.communityFilter}"` : ''}. Pulled live from the ALIS export API on ${report.generatedOn}. Training communities are excluded.`,
    '',
    'WHAT THIS REPORT IS: a proxy for "moved-out resident whose billing is still open." ALIS shows a "Resident still has billing enabled!" banner on the resident profile, but that flag is not exposed in the export API, so it cannot be pulled directly.',
    '',
    'Sources: /v1/export/billing/recurringCharges (residentStatus=MovedOut), /v1/export/billing/outstandingInvoices (status Moved Out, balance > 0), /v1/export/residents/historicalMoveInMoveOuts (latest stay per resident for move-out dates and reason).',
    '',
    'High: a recurring charge is still Active or Future and is open-ended or runs past the financial move-out date. Billing is genuinely still scheduled. Charges ending on or before the financial move-out date are treated as correctly wrapped up (e.g. an upcoming move-out).',
    'Medium: no live charge, but an invoice balance is still open. May be unfinished final billing, a refund/credit, or ordinary collections; the community should confirm.',
    'Medium balances are the sum of open INVOICE balances. They can differ from the ALIS Collections Report, which nets in credits and payments not applied to an invoice. The export API does not expose those, so a moved-out resident who only has a credit balance (refund owed) will not appear here either.',
    'Low: all charges are ended, but at least one ended after the financial move-out date. Possible over-billing or a final prorate. Informational.',
    '',
    'KNOWN GAP: the banner is a resident-level flag and can be on even when the resident has no live charges and no open invoices (confirmed on a Saga resident whose profile showed the banner with no recurring charges or invoices in the API). Those residents will NOT appear here. This report finds residents with real money still moving; it cannot find banner-only residents.',
    '',
    'Move-out dates use the resident\'s most recent stay. Readmitted residents have status Resident, not Moved Out, so they are excluded.',
    'Live Monthly $ excludes per-diem charges (unit price x quantity of non per-diem live charges only).',
  ].forEach((t) => { notes.addRow([t]).alignment = { wrapText: true, vertical: 'top' }; });

  return wb;
}

module.exports = { buildMovedOutBillingReport, buildMovedOutBillingWorkbook };
