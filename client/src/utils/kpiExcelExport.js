/**
 * "Export Excel" for the QBR/KPI Dashboard — single-account overview
 * workbook, same ExcelJS + Blob-download pattern as accountHealthExport.js
 * (built entirely client-side, the snapshot is already loaded in memory).
 * Different buckets than Account Health's own single-account export
 * (Overview/Key Contacts/Service Health/Financial Health/AR Aging/
 * Occupancy) since this page's data shape is this account's own KPI
 * snapshot (normalized/ticketSummary/dealSummary/flags), not a HubSpot
 * accounts-table row — see KpiDashboard.jsx's own field usage for where
 * each value below comes from.
 */
import ExcelJS from 'exceljs';

// KpiDashboard.jsx's normalized/ticketSummary/dealSummary figures are
// already plain dollars/ratios/days (see its own currencyStr/pctStr/
// dsoStr/ppdStr helpers) — unlike accountHealthExport.js's `usd(cents)`,
// nothing here needs a /100 conversion.
function money(n) {
  return n == null ? '' : Number(n.toFixed(2));
}

function pct(n) {
  return n == null ? '' : Number((n * 100).toFixed(1));
}

function round1(n) {
  return n == null ? '' : Number(n.toFixed(1));
}

// Mirrors KpiDashboard.jsx's own EVAL_REASON_LABEL (not shared/exported —
// duplicated here since this module has no access to that component file).
const EVAL_REASON_LABEL = {
  expired: 'Expired',
  incomplete: 'Incomplete',
  overdue: 'Not evaluated in 12+ months',
  neverEvaluated: 'Never evaluated',
};

function download(workbook, filename) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function addTicketSheet(workbook, title, tickets, { showTopThree = false } = {}) {
  const sheet = workbook.addWorksheet(title);
  const columns = [
    { header: 'Ticket', key: 'subject', width: 50 },
    { header: 'Stage', key: 'stage', width: 20 },
  ];
  if (showTopThree) columns.push({ header: 'Top 3?', key: 'topThree', width: 8 });
  columns.push(
    { header: 'Days Open', key: 'daysOpen', width: 11 },
    { header: 'Next Step', key: 'nextStep', width: 50 },
    { header: 'Link', key: 'url', width: 40 },
  );
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  for (const t of tickets || []) {
    sheet.addRow({
      subject: t.subject || `Ticket #${t.id}`,
      stage: t.pipelineStageLabel || '',
      topThree: showTopThree ? (t.isTopThree ? 'Yes' : '') : undefined,
      daysOpen: t.daysOpen ?? '',
      nextStep: t.nextStep || '',
      url: t.url || '',
    });
  }
  if (!tickets || tickets.length === 0) sheet.addRow({ subject: 'None' });
  return sheet;
}

/**
 * Single-account workbook for one QBR/KPI snapshot — Overview, Alerts &
 * Flags, Escalation Tickets, Enhancement Requests: Top 3, Enhancement
 * Requests (HubSpot Deals deliberately dropped, Sep 2026, Aaron: deal data
 * doesn't belong in a QBR handed to the client), and (Sep 2026, Aaron: "much
 * more depth...much more of the detail contained in the report") a detail
 * sheet per section
 * mirroring every on-screen breakdown — Occupancy Detail, Length of Stay
 * Detail, Admissions & Discharges Trend, Care Level Evaluations + Residents
 * Needing Attention + Revenue Leakage, Staffing Detail, Revenue Breakdown,
 * AR Aging Detail — instead of just the single rolled-up number each
 * contributes to Overview. See addDetailSheets(). `summary` is the exact
 * snapshot object this page
 * already has in state (`snapshot.summary`) — no extra fetch needed.
 *
 * `options` mirror the same three Utilities-drawer checkboxes that already
 * govern the PPTX export (Sep 2026, Aaron: "confirm the checkbox options
 * work as controls for the excel export as well") — includeBilling/
 * includeHubspot use the exact same bucket split as
 * server/services/qbrExport.js's buildQbrDeck (billingRelated-tagged flags
 * and billing-derived Overview rows vs. every HubSpot-sourced ticket/deal
 * sheet), and truncateEmptySlides drops a sheet entirely instead of
 * shipping an empty "None" placeholder row — the Excel-native equivalent
 * of "drop the empty slide."
 */
function addKeyValueSheet(workbook, title, rows) {
  const sheet = workbook.addWorksheet(title);
  sheet.columns = [{ header: 'Metric', key: 'metric', width: 40 }, { header: 'Value', key: 'value', width: 26 }];
  sheet.getRow(1).font = { bold: true };
  for (const [metric, value] of rows) sheet.addRow({ metric, value });
  return sheet;
}

/**
 * "Much more depth ... much more of the detail contained in the report"
 * (Sep 2026, Aaron) — one detail sheet per report section, mirroring the
 * on-screen breakdowns (by product type, by community, flagged-resident
 * rows, month-by-month trend) instead of just the single rolled-up number
 * each of those sections contributes to the Overview sheet above. Every
 * sheet here is additive — Overview keeps its existing rows unchanged.
 */
function addDetailSheets(workbook, { normalized, summary, keep, includeBilling }) {
  const communityNameByKey = new Map((summary.communities || []).map((c) => [`${c.host}::${c.communityId}`, c.name]));

  // Occupancy by product type / classification
  const occ = normalized.occupancy;
  if (keep(occ?.byProductType?.length > 0 || occ?.byClassification?.length > 0)) {
    const sheet = workbook.addWorksheet('Occupancy Detail');
    sheet.columns = [
      { header: 'Breakdown', key: 'kind', width: 16 },
      { header: 'Group', key: 'group', width: 26 },
      { header: '% of Census', key: 'pct', width: 12 },
      { header: 'Occupied', key: 'occupied', width: 10 },
      { header: 'Total', key: 'total', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of occ?.byProductType || []) {
      sheet.addRow({ kind: 'Product Type', group: r.productType, pct: pct(r.pct), occupied: r.occupied, total: r.total });
    }
    for (const r of occ?.byClassification || []) {
      sheet.addRow({ kind: 'Classification', group: r.classification, pct: pct(r.pct), occupied: r.occupied, total: r.total });
    }
    if (sheet.rowCount === 1) sheet.addRow({ kind: 'None' });
  }

  // Length of stay by product type + move-out reasons
  const los = normalized.lengthOfStay;
  if (keep(los?.byProductType?.length > 0 || Object.keys(los?.moveOutReasons || {}).length > 0)) {
    const sheet = workbook.addWorksheet('Length of Stay Detail');
    sheet.columns = [
      { header: 'Product Type', key: 'productType', width: 26 },
      { header: 'Avg LOS (days)', key: 'avgDays', width: 14 },
      { header: 'Median LOS (days)', key: 'medianDays', width: 16 },
      { header: '12mo Move-Out %', key: 'moveOut12mo', width: 16 },
      { header: 'Move-Outs', key: 'totalMoveOuts', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    if (los?.totalMoveOuts != null) {
      sheet.addRow({
        productType: 'All Product Types (Portfolio)', avgDays: round1(los.avgDays), medianDays: round1(los.medianDays),
        moveOut12mo: pct(los.moveOutWithin?.['12mo']), totalMoveOuts: los.totalMoveOuts,
      });
    }
    for (const p of los?.byProductType || []) {
      sheet.addRow({
        productType: p.productType, avgDays: round1(p.avgDays), medianDays: round1(p.medianDays),
        moveOut12mo: pct(p.moveOutWithin?.['12mo']), totalMoveOuts: p.totalMoveOuts,
      });
    }
    const reasonEntries = Object.entries(los?.moveOutReasons || {}).sort((a, b) => b[1] - a[1]);
    if (reasonEntries.length > 0) {
      sheet.addRow({});
      sheet.addRow({ productType: 'Discharges by reason (this period)' }).font = { bold: true };
      for (const [reason, p] of reasonEntries) sheet.addRow({ productType: reason, avgDays: pct(p) });
    }
  }

  // Admissions/discharges monthly trend
  const ad = normalized.admissionsDischarges;
  if (keep(ad?.months?.length > 0)) {
    const sheet = workbook.addWorksheet('Admissions & Discharges Trend');
    sheet.columns = [
      { header: 'Month', key: 'month', width: 14 },
      { header: 'Admissions', key: 'admissions', width: 12 },
      { header: 'Discharges', key: 'discharges', width: 12 },
      { header: 'Net', key: 'net', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const m of ad?.months || []) {
      sheet.addRow({ month: m.month, admissions: m.admissions, discharges: m.discharges, net: m.net });
    }
    if (!ad?.months?.length) sheet.addRow({ month: 'None' });
  }

  // Care level evaluations — by community + every flagged resident (not capped at 25 like the on-screen table)
  const cle = normalized.careLevelEvaluations;
  if (keep(cle?.byCommunity?.length > 0 || cle?.flagged?.length > 0)) {
    const sheet = workbook.addWorksheet('Care Level Evaluations');
    sheet.columns = [
      { header: 'Community', key: 'community', width: 26 },
      { header: 'Needs Attention', key: 'needsAttention', width: 16 },
      { header: 'Total Residents', key: 'totalResidents', width: 14 },
      { header: '% Needs Attention', key: 'pctNeedsAttention', width: 16 },
      { header: 'Never Evaluated', key: 'neverEvaluated', width: 14 },
      { header: 'Expired', key: 'expired', width: 10 },
      { header: 'Incomplete', key: 'incomplete', width: 12 },
      { header: '12+ mo Overdue', key: 'overdue', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const c of cle?.byCommunity || []) {
      sheet.addRow({
        community: c.name, needsAttention: c.needsAttention, totalResidents: c.totalResidents,
        pctNeedsAttention: pct(c.pctNeedsAttention), neverEvaluated: c.neverEvaluated, expired: c.expired,
        incomplete: c.incomplete, overdue: c.overdue,
      });
    }
    if (cle?.flagged?.length > 0) {
      const flaggedSheet = workbook.addWorksheet('Residents Needing Attention');
      flaggedSheet.columns = [
        { header: 'Resident', key: 'name', width: 26 },
        { header: 'Community', key: 'community', width: 24 },
        { header: 'Status', key: 'reason', width: 20 },
        { header: 'Care Level', key: 'careLevel', width: 16 },
        { header: 'Product Type', key: 'productType', width: 18 },
        { header: 'Fee', key: 'fee', width: 12 },
        { header: 'Move-In', key: 'moveIn', width: 12 },
        { header: 'Expiration', key: 'expiration', width: 12 },
      ];
      flaggedSheet.getRow(1).font = { bold: true };
      for (const f of cle.flagged) {
        flaggedSheet.addRow({
          name: f.name || `Resident ${f.residentId}`,
          community: communityNameByKey.get(`${f.host}::${f.communityId}`) || f.communityId || '',
          reason: EVAL_REASON_LABEL[f.reason] || f.reason,
          careLevel: f.careLevel || '',
          productType: f.productType || '',
          fee: money(f.fee),
          moveIn: f.moveInDate ? f.moveInDate.slice(0, 10) : '',
          expiration: f.expirationDate ? f.expirationDate.slice(0, 10) : '',
        });
      }
    }
    if (cle?.revenueLeakage?.items?.length > 0) {
      const leakSheet = workbook.addWorksheet('Revenue Leakage');
      leakSheet.columns = [
        { header: 'Resident', key: 'name', width: 26 },
        { header: 'Current Fee', key: 'currentFee', width: 14 },
        { header: 'Recommended Fee', key: 'recommendedFee', width: 16 },
        { header: 'Monthly Gap', key: 'gap', width: 14 },
      ];
      leakSheet.getRow(1).font = { bold: true };
      for (const item of cle.revenueLeakage.items) {
        leakSheet.addRow({
          name: item.name || `Resident ${item.residentId}`, currentFee: money(item.currentFee),
          recommendedFee: money(item.recommendedFee), gap: money(item.recommendedFee - item.currentFee),
        });
      }
    }
  }

  // Staffing — every inactive staff member (not capped like the on-screen table)
  const staff = normalized.staffActivity;
  if (keep(staff?.inactive?.length > 0)) {
    const sheet = workbook.addWorksheet('Staffing Detail');
    sheet.columns = [
      { header: 'Staff Member', key: 'name', width: 26 },
      { header: 'Community', key: 'community', width: 24 },
      { header: 'Role', key: 'role', width: 20 },
      { header: 'Last Login', key: 'lastLogin', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const s of staff.inactive) {
      sheet.addRow({
        name: s.name || `Staff ${s.staffId}`,
        community: communityNameByKey.get(`${s.host}::${s.communityId}`) || s.communityId || '',
        role: s.role || '',
        lastLogin: s.lastLoginDate ? s.lastLoginDate.slice(0, 10) : 'Never',
      });
    }
  }

  // Revenue by payer type / product type
  const rev = normalized.billedRevenue?.hasBillingData ? normalized.billedRevenue : normalized.recurringRevenue;
  if (includeBilling && keep(rev?.hasBillingData && (Object.keys(rev.byPayerType || {}).length > 0 || Object.keys(rev.byProductType || {}).length > 0))) {
    const sheet = workbook.addWorksheet('Revenue Breakdown');
    sheet.columns = [
      { header: 'Breakdown', key: 'kind', width: 16 },
      { header: 'Group', key: 'group', width: 26 },
      { header: 'Amount', key: 'amount', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const [payer, amount] of Object.entries(rev?.byPayerType || {}).sort((a, b) => b[1] - a[1])) {
      sheet.addRow({ kind: 'Payer Type', group: payer, amount: money(amount) });
    }
    for (const [product, amount] of Object.entries(rev?.byProductType || {}).sort((a, b) => b[1] - a[1])) {
      sheet.addRow({ kind: 'Product Type', group: product, amount: money(amount) });
    }
  }

  // AR aging bucket detail (Overview only has the total)
  const ar = normalized.outstandingInvoiceSummary;
  if (includeBilling && keep(ar?.hasBillingData && ar?.total > 0)) {
    addKeyValueSheet(workbook, 'AR Aging Detail', [
      ['Current', money(ar.aging?.current)],
      ['1-30 days', money(ar.aging?.days1to30)],
      ['31-60 days', money(ar.aging?.days31to60)],
      ['61-90 days', money(ar.aging?.days61to90)],
      ['90+ days', money(ar.aging?.days90plus)],
      ['Total Outstanding', money(ar.total)],
      ['Outstanding Invoices', ar.invoiceCount ?? ''],
    ]);
  }
}

export async function exportKpiOverviewExcel(summary, options = {}) {
  const { normalized, ticketSummary, flags } = summary;
  const includeBilling = options.includeBilling !== false;
  const includeHubspot = options.includeHubspot !== false;
  const truncate = options.truncateEmptySlides === true;
  // Under truncate, only keep a sheet if it has real content; otherwise
  // (the default) every sheet ships even if it just says "None" — same
  // on/off shape as qbrExport.js's own `keep()` helper.
  const keep = (hasData) => !truncate || hasData;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const overview = workbook.addWorksheet('Overview');
  overview.columns = [{ header: 'Metric', key: 'metric', width: 40 }, { header: 'Value', key: 'value', width: 26 }];
  overview.getRow(1).font = { bold: true };
  const overviewRows = [
    ['Account', summary.companyName],
    ['Period', `${summary.periodStart} – ${summary.periodEnd}`],
    ['Benchmark', summary.benchmarkQuarter ? `ALIS 500 (${summary.benchmarkQuarter})` : ''],
    ['Occupancy %', pct(normalized.occupancy?.pct)],
    ['Median Length of Stay (days)', normalized.lengthOfStay?.medianDays != null ? Math.round(normalized.lengthOfStay.medianDays) : ''],
    ['Total Residents', normalized.demographics?.totalResidents ?? ''],
    ['Admissions', normalized.admissionsDischarges?.totalAdmissions ?? ''],
    ['Discharges', normalized.admissionsDischarges?.totalDischarges ?? ''],
    ['Net Change', normalized.admissionsDischarges?.netChange ?? ''],
    ['Falls / 1,000 Resident-Days', round1(normalized.falls?.per1000ResidentDays)],
    ['Hospital/SNF Visits / 1,000 Resident-Days', round1(normalized.hospitalVisits?.per1000ResidentDays)],
    ['PRN Administrations / 1,000 Resident-Days', round1(normalized.prnAdministration?.overall)],
    ['Incident Reports Fully Documented', normalized.incidentCompletion?.hasData ? pct(normalized.incidentCompletion.overall.pctComplete) : ''],
    ['Levels of Care Needing Attention', normalized.careLevelEvaluations?.needsAttention ?? ''],
    ['Staff Active (30d)', pct(normalized.staffActivity?.pct)],
    ['Staff : Census Ratio', normalized.staffActivity?.staffToCensusRatio != null ? `1 : ${(1 / normalized.staffActivity.staffToCensusRatio).toFixed(1)}` : ''],
    // Billing-derived figures (ALIS billing module) — same split as
    // qbrExport.js's `includeBilling` gate on the Financial slide.
    ...(includeBilling ? [
      ['Billed Revenue', money(normalized.billedRevenue?.total)],
      ['Revenue / Resident', money(normalized.billedRevenue?.revenuePerResident)],
      ['Company Avg DSO (days)', round1(normalized.dso?.portfolio?.dsoDays)],
      ['PPD (Census)', money(normalized.ppd?.portfolio?.ppdByCensus)],
      ['Total Outstanding', money(normalized.outstandingInvoiceSummary?.total)],
    ] : []),
    // HubSpot-sourced counts — same split as qbrExport.js's `includeHubspot`
    // gate on Support Review/Enhancement Requests (Sep 2026, Aaron: drop
    // HubSpot Deals from this export entirely — deal data doesn't belong in
    // a QBR handed to the client).
    ...(includeHubspot ? [
      ['Open Tickets', ticketSummary?.open ?? ''],
      ['Closed Tickets', ticketSummary?.closed ?? ''],
      ['Open Escalation Tickets', ticketSummary?.escalationTickets?.length ?? ''],
      ['Enhancement Requests: Top 3', ticketSummary?.topThreeEnhancements?.items?.length ?? ''],
      ['Open Enhancement Requests', ticketSummary?.enhancementRequests?.length ?? ''],
    ] : []),
  ];
  for (const [metric, value] of overviewRows) overview.addRow({ metric, value });

  // Discussion-point flags span clinical/service/financial signals, not
  // HubSpot-only — unaffected by includeHubspot, same as
  // qbrExport.js's own showDiscussionPoints. includeBilling filters out
  // just the billingRelated-tagged ones (see qbrFlags.js).
  const flagRows = (flags || []).filter((f) => includeBilling || !f.billingRelated);
  if (keep(flagRows.length > 0)) {
    const flagsSheet = workbook.addWorksheet('Alerts & Flags');
    flagsSheet.columns = [
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Severity', key: 'severity', width: 12 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Detail', key: 'detail', width: 60 },
      { header: 'Talking Point', key: 'talkingPoint', width: 60 },
    ];
    flagsSheet.getRow(1).font = { bold: true };
    for (const f of flagRows) {
      flagsSheet.addRow({
        category: f.category || '',
        severity: f.severity || '',
        title: f.title || '',
        detail: f.detail || '',
        talkingPoint: f.talkingPoint || '',
      });
    }
    if (flagRows.length === 0) flagsSheet.addRow({ category: 'None this period — all tracked KPIs are at or ahead of the ALIS 500 benchmark.' });
  }

  if (includeHubspot) {
    if (keep(ticketSummary?.escalationTickets?.length > 0)) {
      addTicketSheet(workbook, 'Escalation Tickets', ticketSummary?.escalationTickets);
    }
    if (keep(ticketSummary?.topThreeEnhancements?.items?.length > 0)) {
      addTicketSheet(workbook, 'Enhancement Requests - Top 3', ticketSummary?.topThreeEnhancements?.items);
    }
    if (keep(ticketSummary?.enhancementRequests?.length > 0)) {
      addTicketSheet(workbook, 'Enhancement Requests', ticketSummary?.enhancementRequests, { showTopThree: true });
    }
  }

  addDetailSheets(workbook, { normalized, summary, keep, includeBilling });

  await download(workbook, `${(summary.companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-QBR-Overview.xlsx`);
}
