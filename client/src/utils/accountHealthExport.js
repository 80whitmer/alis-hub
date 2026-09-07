/**
 * Excel exports for the Account Health Dashboard — built entirely
 * client-side (accounts are already loaded in memory), same ExcelJS +
 * Blob-download pattern as dsoExport.js.
 */
import ExcelJS from 'exceljs';

function usd(cents) {
  return cents == null ? '' : Number((cents / 100).toFixed(2));
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

function flattenDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) {
      rows.push({ ...d, companyName: a.company_name });
    }
  }
  return rows;
}

/** Portfolio-wide workbook — Summary, Accounts, and Deals sheets, matching the on-screen roll-up/table/All Deals section. */
export async function exportAccountHealthPortfolioExcel(accounts, rollup) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [{ header: 'Metric', key: 'metric', width: 30 }, { header: 'Value', key: 'value', width: 24 }];
  summarySheet.getRow(1).font = { bold: true };
  const summaryRows = [
    ['Total Accounts', rollup.totalAccounts],
    ['Open Tickets (Client Submitted + In Progress)', rollup.openTickets],
    ['Closed Tickets', rollup.closedTickets],
    ['Enhancement Requests — Top 3', rollup.enhancementTop],
    ['Enhancement Requests — Long-Term', rollup.enhancementLesser],
    ['Other Open Tickets', rollup.otherOpen],
    ['Avg Health Score', rollup.avgScore ?? ''],
    ['Open Deals', rollup.openDeals],
    ['Open Deal Value', usd(rollup.openDealValueCents)],
    ['Total ARR', usd(rollup.arrCents)],
    ['ARR Added This Year', usd(rollup.arrAddedThisYearCents)],
    [`Aging Balance${rollup.agingAsOfDate ? ` (as of ${rollup.agingAsOfDate})` : ''}`, rollup.agingAsOfDate ? usd(rollup.agingTotalCents) : ''],
    ['Past Due 61+ Days', rollup.agingAsOfDate ? usd(rollup.pastDue61PlusCents) : ''],
    ['Portfolio DSO (days, rudimentary)', rollup.portfolioDsoDays ?? ''],
  ];
  for (const [metric, value] of summaryRows) summarySheet.addRow({ metric, value });

  const accountsSheet = workbook.addWorksheet('Accounts');
  accountsSheet.columns = [
    { header: 'Account', key: 'name', width: 34 },
    { header: 'HubSpot Link', key: 'hubspotUrl', width: 40 },
    { header: 'Health Score', key: 'healthScore', width: 12 },
    { header: 'Health Band', key: 'healthBand', width: 12 },
    { header: 'Open Tickets', key: 'openTickets', width: 12 },
    { header: 'Closed Tickets', key: 'closedTickets', width: 13 },
    { header: 'Top 3 Enhancements', key: 'enhTop', width: 16 },
    { header: 'Long-Term Enhancements', key: 'enhLesser', width: 18 },
    { header: 'Other Open Tickets', key: 'otherOpen', width: 15 },
    { header: 'Open Deals', key: 'openDeals', width: 11 },
    { header: 'Open Deal Value', key: 'openDealValue', width: 15 },
    { header: 'ARR', key: 'arr', width: 14 },
    { header: 'ARR Added This Year', key: 'arrAdded', width: 16 },
    { header: 'Aging Balance', key: 'agingTotal', width: 14 },
    { header: 'Past Due 61+', key: 'pastDue', width: 13 },
    { header: 'DSO (days)', key: 'dso', width: 11 },
  ];
  accountsSheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    accountsSheet.addRow({
      name: a.company_name,
      hubspotUrl: a.hubspotUrl || '',
      healthScore: a.health_score ?? '',
      healthBand: a.health_band || '',
      openTickets: a.open_ticket_count || 0,
      closedTickets: a.closed_ticket_count || 0,
      enhTop: a.enhancement_top_count || 0,
      enhLesser: a.enhancement_lesser_count || 0,
      otherOpen: a.other_open_ticket_count || 0,
      openDeals: a.open_deal_count || 0,
      openDealValue: usd(a.open_deal_value_cents),
      arr: usd(a.arr_cents),
      arrAdded: usd(a.arr_added_this_year_cents),
      agingTotal: usd(a.aging_total_cents),
      pastDue: usd(a.aging_past_due_61_plus_cents),
      dso: a.dsoDays ?? '',
    });
  }

  const deals = flattenDeals(accounts);
  const dealsSheet = workbook.addWorksheet('Deals');
  dealsSheet.columns = [
    { header: 'Account', key: 'companyName', width: 30 },
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
  for (const d of deals) {
    dealsSheet.addRow({
      companyName: d.companyName,
      name: d.name,
      pipeline: d.pipeline,
      stage: d.stage,
      value: usd(d.valueCents),
      closeDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
      isOpen: d.isOpen ? 'Open' : 'Closed',
      nextStep: d.nextStep || '',
      url: d.url || '',
    });
  }

  await download(workbook, 'Account-Health-Portfolio.xlsx');
}

/** Single-account workbook — Overview, Service Health, Financial Health, and AR Aging sheets, matching the drill-down drawer. */
export async function exportAccountHealthSingleExcel(account) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const overview = workbook.addWorksheet('Overview');
  overview.columns = [{ header: 'Metric', key: 'metric', width: 30 }, { header: 'Value', key: 'value', width: 30 }];
  overview.getRow(1).font = { bold: true };
  const overviewRows = [
    ['Account', account.company_name],
    ['HubSpot Link', account.hubspotUrl || ''],
    ['Health Score', account.health_score ?? ''],
    ['Health Band', account.health_band || ''],
    ['Open Tickets (Client Submitted + In Progress)', account.open_ticket_count || 0],
    ['Closed Tickets', account.closed_ticket_count || 0],
    ['Open Deals', account.open_deal_count || 0],
    ['Open Deal Value', usd(account.open_deal_value_cents)],
    ['ARR', usd(account.arr_cents)],
    ['ARR Added This Year', usd(account.arr_added_this_year_cents)],
    ['Aging Balance', usd(account.aging_total_cents)],
    ['DSO (days, rudimentary)', account.dsoDays ?? ''],
  ];
  for (const [metric, value] of overviewRows) overview.addRow({ metric, value });
  overview.addRow({});
  overview.addRow({ metric: 'Sub-scores' }).font = { bold: true };
  for (const [k, v] of Object.entries(account.subScores || {})) {
    overview.addRow({ metric: k, value: v ?? '' });
  }

  const svc = account.serviceHealth;
  const serviceSheet = workbook.addWorksheet('Service Health');
  serviceSheet.columns = [
    { header: 'Ticket', key: 'subject', width: 50 },
    { header: 'Age (days)', key: 'ageDays', width: 12 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Link', key: 'url', width: 40 },
  ];
  serviceSheet.getRow(1).font = { bold: true };
  for (const t of svc?.agedTickets || []) {
    serviceSheet.addRow({ subject: t.subject, ageDays: t.ageDays, stage: t.stage, rank: '', url: t.url || '' });
  }
  for (const t of svc?.enhancementTopItems || []) {
    serviceSheet.addRow({ subject: t.subject, ageDays: '', stage: t.stage, rank: t.rank || '', url: t.url || '' });
  }

  const fin = account.financialHealth;
  const dealsSheet = workbook.addWorksheet('Financial Health');
  dealsSheet.columns = [
    { header: 'Deal', key: 'name', width: 40 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'Value', key: 'value', width: 12 },
    { header: 'Close Date', key: 'closeDate', width: 14 },
    { header: 'Open?', key: 'isOpen', width: 8 },
    { header: 'Next Step', key: 'nextStep', width: 40 },
    { header: 'Link', key: 'url', width: 40 },
  ];
  dealsSheet.getRow(1).font = { bold: true };
  for (const d of fin?.expansionPipeline?.deals || []) {
    dealsSheet.addRow({
      name: d.name, stage: d.stage, value: usd(d.valueCents),
      closeDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
      isOpen: d.isOpen ? 'Open' : 'Closed', nextStep: d.nextStep || '', url: d.url || '',
    });
  }

  const agingSheet = workbook.addWorksheet('AR Aging');
  agingSheet.columns = [
    { header: 'Current', key: 'current', width: 14 },
    { header: '1-30', key: 'd1_30', width: 14 },
    { header: '31-60', key: 'd31_60', width: 14 },
    { header: '61-90', key: 'd61_90', width: 14 },
    { header: '91-120', key: 'd91_120', width: 14 },
    { header: '121+', key: 'd121Plus', width: 14 },
    { header: 'Total', key: 'total', width: 14 },
  ];
  agingSheet.getRow(1).font = { bold: true };
  if (account.aging) {
    agingSheet.addRow({
      current: usd(account.aging.currentCents), d1_30: usd(account.aging.d1_30Cents), d31_60: usd(account.aging.d31_60Cents),
      d61_90: usd(account.aging.d61_90Cents), d91_120: usd(account.aging.d91_120Cents), d121Plus: usd(account.aging.d121PlusCents),
      total: usd(account.aging.totalCents),
    });
    agingSheet.addRow({});
    agingSheet.addRow({ current: `As of ${account.aging.asOfDate} — from: ${(account.aging.sourceRows || []).map((r) => r.customerName).join(', ')}` });
  }

  await download(workbook, `${(account.company_name || 'Account').replace(/[^a-z0-9.\-]/gi, '_')}-Account-Health.xlsx`);
}
