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

function flattenArrAddedDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      rows.push({ ...d, companyName: a.company_name });
    }
  }
  return rows;
}

/**
 * Downloadable template for mapping each account to its ALIS subdomain —
 * the one piece of information needed (server/api/companyHosts.js) to
 * pull capacity/census data, which otherwise has no connection to
 * anything HubSpot already gave this dashboard. Pre-fills the ALIS
 * Subdomain column wherever a mapping is already known, so Aaron only
 * has to fill in the blanks before re-uploading via
 * exportAccountHealthPortfolioExcel's counterpart, ImportCompanyHostsButton.
 */
export async function exportCompanyHostTemplate(accounts, existingHosts) {
  const hostByCompanyId = new Map((existingHosts || []).map((h) => [h.hubspot_company_id, h.company_host]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('ALIS Subdomains');
  sheet.columns = [
    { header: 'Company Name', key: 'companyName', width: 34 },
    { header: 'HubSpot Company ID', key: 'hubspotCompanyId', width: 20 },
    { header: 'ALIS Subdomain(s)', key: 'companyHost', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };
  // Multiple ALIS instances for one HubSpot company (grew through M&A,
  // communities split across two ALIS subdomains) — comma-separate them
  // in the same cell, e.g. "vivaeast,vivawest". Same convention the QBR/
  // Wellness/Usage Audit pipelines already use for this table.
  sheet.getCell('C1').note = 'Multiple ALIS instances for one company? Comma-separate them in the same cell, e.g. "vivaeast,vivawest".';
  for (const a of accounts) {
    sheet.addRow({
      companyName: a.company_name,
      hubspotCompanyId: a.hubspot_company_id,
      companyHost: hostByCompanyId.get(a.hubspot_company_id) || '',
    });
  }

  await download(workbook, 'Account-Health-ALIS-Subdomains-Template.xlsx');
}

/**
 * Reads a completed copy of the template above back into
 * `{ companyName, hubspotCompanyId, companyHost }` rows — same field
 * names server/db/database.js's bulkImportCompanyHosts expects, so the
 * result can be POSTed to /api/company-hosts/import as-is. Rows with no
 * ALIS Subdomain filled in are skipped rather than sent as empty
 * mappings (bulkImportCompanyHosts would skip them anyway, but there's
 * no reason to send them).
 */
export async function parseCompanyHostTemplate(file) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in this file.');

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const companyName = row.getCell(1).text?.trim();
    const hubspotCompanyId = row.getCell(2).text?.trim();
    const companyHost = row.getCell(3).text?.trim();
    if (companyHost) rows.push({ companyName, hubspotCompanyId, companyHost });
  });
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
    ['Total Communities (active child companies)', rollup.totalCommunities],
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
    [`Total Capacity${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`, rollup.occupancyAccountCount > 0 ? rollup.totalCapacity : ''],
    ['Current Census', rollup.occupancyAccountCount > 0 ? rollup.currentCensus : ''],
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
    { header: 'Total Capacity', key: 'totalCapacity', width: 14 },
    { header: 'Current Census', key: 'currentCensus', width: 14 },
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
      totalCapacity: a.total_capacity ?? '',
      currentCensus: a.current_census ?? '',
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

  const arrAddedDeals = flattenArrAddedDeals(accounts);
  const arrAddedSheet = workbook.addWorksheet('ARR Added Deals');
  arrAddedSheet.columns = [
    { header: 'Account', key: 'companyName', width: 30 },
    { header: 'Deal', key: 'name', width: 40 },
    { header: 'Pipeline', key: 'pipeline', width: 22 },
    { header: 'Stage', key: 'stage', width: 20 },
    { header: 'ARR Value', key: 'arrValue', width: 14 },
    { header: 'Close Date', key: 'closeDate', width: 14 },
    { header: 'Link', key: 'url', width: 40 },
  ];
  arrAddedSheet.getRow(1).font = { bold: true };
  for (const d of arrAddedDeals) {
    arrAddedSheet.addRow({
      companyName: d.companyName,
      name: d.name,
      pipeline: d.pipeline,
      stage: d.stage,
      arrValue: usd(d.arrValueCents),
      closeDate: d.closeDate ? d.closeDate.slice(0, 10) : '',
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
    [`Total Capacity${account.occupancy_as_of_date ? ` (as of ${account.occupancy_as_of_date})` : ''}`, account.total_capacity ?? ''],
    ['Current Census', account.current_census ?? ''],
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

  const occupancySheet = workbook.addWorksheet('Occupancy');
  occupancySheet.columns = [
    { header: 'Breakdown', key: 'breakdown', width: 14 },
    { header: 'Group', key: 'group', width: 24 },
    { header: '% of Census', key: 'pct', width: 14 },
    { header: 'Occupied', key: 'occupied', width: 12 },
    { header: 'Total', key: 'total', width: 12 },
  ];
  occupancySheet.getRow(1).font = { bold: true };
  for (const r of account.occupancyByProductType || []) {
    occupancySheet.addRow({ breakdown: 'Product Type', group: r.productType, pct: r.pct != null ? Number((r.pct * 100).toFixed(1)) : '', occupied: r.occupied, total: r.total });
  }
  for (const r of account.occupancyByClassification || []) {
    occupancySheet.addRow({ breakdown: 'Classification', group: r.classification, pct: r.pct != null ? Number((r.pct * 100).toFixed(1)) : '', occupied: r.occupied, total: r.total });
  }
  if (account.occupancy_as_of_date) {
    occupancySheet.addRow({});
    occupancySheet.addRow({ breakdown: `As of ${account.occupancy_as_of_date}` });
  }

  await download(workbook, `${(account.company_name || 'Account').replace(/[^a-z0-9.\-]/gi, '_')}-Account-Health.xlsx`);
}
