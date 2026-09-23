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
 * Requests, and HubSpot Deals, matching the report's own section buckets
 * (see KpiDashboard.jsx). `summary` is the exact snapshot object this page
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
export async function exportKpiOverviewExcel(summary, options = {}) {
  const { normalized, ticketSummary, dealSummary, flags } = summary;
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
    // gate on Support Review/Enhancement Requests/HubSpot Deals.
    ...(includeHubspot ? [
      ['Open Tickets', ticketSummary?.open ?? ''],
      ['Closed Tickets', ticketSummary?.closed ?? ''],
      ['Open Escalation Tickets', ticketSummary?.escalationTickets?.length ?? ''],
      ['Enhancement Requests: Top 3', ticketSummary?.topThreeEnhancements?.items?.length ?? ''],
      ['Open Enhancement Requests', ticketSummary?.enhancementRequests?.length ?? ''],
      ['Open Deals', dealSummary?.open ?? ''],
      ['Open Deal Value', dealSummary ? money(dealSummary.totalOpenValue) : ''],
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

    if (keep(dealSummary?.deals?.length > 0)) {
      const dealsSheet = workbook.addWorksheet('HubSpot Deals');
      dealsSheet.columns = [
        { header: 'Deal', key: 'name', width: 40 },
        { header: 'Pipeline', key: 'pipeline', width: 22 },
        { header: 'Stage', key: 'stage', width: 20 },
        { header: 'Value', key: 'value', width: 12 },
        { header: 'Close Date', key: 'closeDate', width: 14 },
        { header: 'Open?', key: 'isOpen', width: 8 },
        { header: 'Next Step', key: 'nextStep', width: 40 },
        { header: 'Link', key: 'url', width: 40 },
      ];
      dealsSheet.getRow(1).font = { bold: true };
      for (const d of dealSummary?.deals || []) {
        dealsSheet.addRow({
          name: d.name || '',
          pipeline: d.pipeline || '',
          stage: d.stage || '',
          value: money(d.amount),
          closeDate: d.closeDate ? d.closeDate.slice(0, 10) : '',
          isOpen: d.isClosed ? 'Closed' : 'Open',
          nextStep: d.nextStep || '',
          url: d.url || '',
        });
      }
      if (!dealSummary?.deals?.length) dealsSheet.addRow({ name: 'None' });
    }
  }

  await download(workbook, `${(summary.companyName || 'QBR').replace(/[^a-z0-9.\-]/gi, '_')}-QBR-Overview.xlsx`);
}
