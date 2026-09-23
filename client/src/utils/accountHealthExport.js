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

/**
 * Shared by every parseXTemplate below (Sep 2026) — ExcelJS has a known
 * bug reading a workbook's cell comments back out once real Excel has
 * re-saved the file (throws "Cannot read properties of undefined
 * (reading 'comments')" deep inside its own xlsx reader; confirmed live
 * reproducing a real user's re-uploaded template). Our own templates no
 * longer write cell comments for exactly this reason, but an already-
 * downloaded older template floating around on someone's machine could
 * still hit this — this turns that specific crash into an actionable
 * message instead of a raw internal stack trace.
 */
async function loadWorkbookSafely(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    if (/reading 'comments'/.test(err.message)) {
      throw new Error('This file has an Excel comment ExcelJS can\'t read back (a known issue once Excel re-saves a file with comments). Please re-download a fresh template and re-enter your changes — the current template no longer uses comments, so this won\'t happen again.');
    }
    throw err;
  }
  return workbook;
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

/** Every labeled Key Contact across every account, one row each — same flattening shape as flattenDeals above, feeding both the portfolio Key Contacts sheet and the dashboard's own Key Contacts section/export. `account` carries the whole parent account object (unused by the export functions, which only read named fields) so the dashboard's own table can jump straight to that account's drawer on row-click, same convention as flattenRecurringCalls. */
export function flattenKeyContacts(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const c of a.keyContacts || []) {
      rows.push({ ...c, companyName: a.company_name, tier: a.tier, hubspotCompanyId: a.hubspot_company_id, account: a });
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
  const hostByCompanyId = new Map();
  const hostByNameKey = new Map();
  for (const h of existingHosts || []) {
    if (h.hubspot_company_id) hostByCompanyId.set(h.hubspot_company_id, h.company_host);
    const nameKey = (h.company_name || '').trim().toLowerCase();
    if (nameKey) hostByNameKey.set(nameKey, h.company_host);
  }
  // The admin.alisonline.com directory scrape (companyHosts.js's
  // refresh-from-admin route) only knows a company's NAME, not its
  // HubSpot ID, so its rows land in company_hosts with hubspot_company_id
  // null — an ID-only join would silently skip every one of them here.
  // Falling back to a name match (same normalization as the server's
  // normalizeNameKey) surfaces those rows too.
  const hostFor = (a) => hostByCompanyId.get(a.hubspot_company_id) || hostByNameKey.get((a.company_name || '').trim().toLowerCase()) || '';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('ALIS Subdomains');
  // Multiple ALIS instances for one HubSpot company (grew through M&A,
  // communities split across two ALIS subdomains) — comma-separate them
  // in the same cell, e.g. "vivaeast,vivawest". Same convention the QBR/
  // Wellness/Usage Audit pipelines already use for this table. This
  // guidance USED to be a cell .note (an Excel comment) — moved into the
  // plain header text instead (Sep 2026): ExcelJS has a known round-trip
  // bug reading a workbook's cell comments back in once real Excel has
  // re-saved the file, throwing "Cannot read properties of undefined
  // (reading 'comments')" deep inside its own xlsx reader — confirmed
  // live reproducing a real user's re-uploaded template. A plain header
  // has no such failure mode, and is arguably more discoverable than a
  // hover-only comment anyway.
  sheet.columns = [
    { header: 'Company Name', key: 'companyName', width: 34 },
    { header: 'HubSpot Company ID', key: 'hubspotCompanyId', width: 20 },
    { header: 'ALIS Subdomain(s) — comma-separate multiple, e.g. "vivaeast,vivawest"', key: 'companyHost', width: 55 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    sheet.addRow({
      companyName: a.company_name,
      hubspotCompanyId: a.hubspot_company_id,
      companyHost: hostFor(a),
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
  const workbook = await loadWorkbookSafely(buffer);
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

/**
 * Plain read-only export of the current Recurring Calls rollup (Sep 2026)
 * — exactly the flattened one-row-per-call list RecurringCallsSection
 * already renders (an account with two calls contributes two rows here
 * too), no round-trip intent. See exportRecurringCallsTemplate below for
 * the separate editable bulk-update/create flow.
 */
export async function exportRecurringCallsExcel(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Recurring Calls');
  sheet.columns = [
    { header: 'Account', key: 'account', width: 34 },
    { header: 'Call', key: 'callLabel', width: 20 },
    { header: 'Cadence', key: 'cadence', width: 14 },
    { header: 'Day of Week', key: 'dayOfWeek', width: 14 },
    { header: 'Time', key: 'time', width: 12 },
    { header: 'Next Call', key: 'nextCallDate', width: 14 },
    { header: 'Calendar Link', key: 'calendarLink', width: 40 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow({
      account: r.company_name,
      callLabel: r.callLabel,
      cadence: r.cadence || '',
      dayOfWeek: r.dayOfWeek || '',
      time: r.time || '',
      nextCallDate: r.nextCallDate ? r.nextCallDate.slice(0, 10) : '',
      calendarLink: r.calendarLink || '',
      notes: r.notes || '',
    });
  }

  await download(workbook, 'Account-Health-Recurring-Calls.xlsx');
}

/**
 * Plain read-only export of the portfolio-wide Key Contacts rollup (Sep
 * 2026) — one row per labeled contact, same flattened shape
 * flattenKeyContacts produces and the dashboard's own Key Contacts section
 * renders. Deliberately includes email/phone (not shown in the on-screen
 * table) since Aaron asked for contact info specifically in the export.
 */
export async function exportKeyContactsExcel(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Key Contacts');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Title', key: 'title', width: 24 },
    { header: 'Account', key: 'companyName', width: 30 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Label(s)', key: 'labels', width: 30 },
    { header: 'Fun Facts', key: 'funFacts', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Last Activity', key: 'lastActivityDate', width: 14 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const c of rows) {
    sheet.addRow({
      name: c.name || '',
      title: c.title || '',
      companyName: c.companyName,
      tier: c.tier ?? '',
      labels: (c.labels || []).join(', '),
      funFacts: c.funFacts || '',
      notes: c.notes || '',
      lastActivityDate: c.lastActivityDate ? c.lastActivityDate.slice(0, 10) : '',
      email: c.email || '',
      phone: c.phone || '',
    });
  }

  await download(workbook, 'Account-Health-Key-Contacts.xlsx');
}

/**
 * Downloadable bulk template for setting/updating recurring calls across
 * many accounts at once (Sep 2026) — same philosophy as
 * exportCompanyHostTemplate above, adapted for one-account-to-many-calls:
 * every EXISTING call gets its own pre-filled row (carrying its own Call
 * ID, so re-uploading updates that specific call rather than creating a
 * duplicate), plus one blank convenience row for any account with ZERO
 * calls yet (preserving the "every account listed, fill in the blanks"
 * flow for first-time setup). A blank Call ID always means "create a new
 * call" on import — so Aaron can also just hand-type extra rows in Excel,
 * repeating the same HubSpot Company ID, to give an account a 2nd/3rd
 * call. HubSpot Company ID is the account-matching key; Call ID is the
 * specific-call-matching key — neither is meant to be hand-edited.
 */
export async function exportRecurringCallsTemplate(accounts) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  // Guidance baked into the header text itself, not a cell .note (Excel
  // comment) — ExcelJS has a known bug reading comments back out of a
  // workbook once real Excel has re-saved it ("Cannot read properties of
  // undefined (reading 'comments')", thrown deep inside its own xlsx
  // reader), confirmed live reproducing a real re-uploaded template.
  const sheet = workbook.addWorksheet('Recurring Calls');
  sheet.columns = [
    { header: 'Company Name', key: 'companyName', width: 34 },
    { header: 'HubSpot Company ID', key: 'hubspotCompanyId', width: 20 },
    { header: 'Call ID (blank = new call)', key: 'id', width: 22 },
    { header: 'Label', key: 'label', width: 24 },
    { header: 'Cadence', key: 'cadence', width: 14 },
    { header: 'Day of Week (Mon-Sun)', key: 'dayOfWeek', width: 20 },
    { header: 'Time (24h HH:MM)', key: 'time', width: 16 },
    { header: 'Next Call', key: 'nextCallDate', width: 14 },
    { header: 'Calendar Link', key: 'calendarLink', width: 40 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const a of accounts) {
    const calls = a.recurringCalls || [];
    if (calls.length === 0) {
      sheet.addRow({ companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id });
      continue;
    }
    for (const rc of calls) {
      sheet.addRow({
        companyName: a.company_name,
        hubspotCompanyId: a.hubspot_company_id,
        id: rc.id,
        label: rc.label || '',
        cadence: rc.cadence || '',
        dayOfWeek: rc.dayOfWeek || '',
        time: rc.time || '',
        nextCallDate: rc.nextCallDate ? rc.nextCallDate.slice(0, 10) : '',
        calendarLink: rc.calendarLink || '',
        notes: rc.notes || '',
      });
    }
  }

  await download(workbook, 'Account-Health-Recurring-Calls-Template.xlsx');
}

/**
 * Reads a completed copy of the template above back into
 * `{ id, hubspotCompanyId, label, cadence, dayOfWeek, time, nextCallDate,
 * calendarLink, notes }` rows — same field names
 * server/db/database.js's bulkImportRecurringCalls expects (a present
 * `id` updates that specific call, a blank one creates a new call for
 * `hubspotCompanyId`), so the result can be POSTed to
 * /api/account-health/recurring-calls/import as-is. Rows with no HubSpot
 * Company ID (can't match to an account), or with every other column
 * blank (nothing to import), are skipped.
 */
export async function parseRecurringCallsTemplate(file) {
  const buffer = await file.arrayBuffer();
  const workbook = await loadWorkbookSafely(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in this file.');

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const hubspotCompanyId = row.getCell(2).text?.trim();
    const id = row.getCell(3).text?.trim();
    const label = row.getCell(4).text?.trim();
    const cadence = row.getCell(5).text?.trim();
    const dayOfWeek = row.getCell(6).text?.trim();
    const time = row.getCell(7).text?.trim();
    const nextCallDate = row.getCell(8).text?.trim();
    const calendarLink = row.getCell(9).text?.trim();
    const notes = row.getCell(10).text?.trim();
    if (!hubspotCompanyId) return;
    if (!label && !cadence && !dayOfWeek && !time && !nextCallDate && !calendarLink && !notes) return;
    rows.push({ id: id || undefined, hubspotCompanyId, label, cadence, dayOfWeek, time, nextCallDate, calendarLink, notes });
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
    ['Open Tickets (Client Submitted + In Progress, excl. enhancement requests)', rollup.openTickets],
    ['Closed Tickets', rollup.closedTickets],
    ['Enhancement Requests — Top 3', rollup.enhancementTop],
    ['Enhancement Requests — Long-Term', rollup.enhancementLesser],
    ['Other Open Tickets', rollup.otherOpen],
    ['Avg Health Score', rollup.avgScore ?? ''],
    ['Open Deals', rollup.openDeals],
    ['Open Deal Value', usd(rollup.openDealValueCents)],
    ['Total ARR', usd(rollup.arrCents)],
    ['ARR Added to Book This Year (workload — counts inherited deals)', usd(rollup.arrAddedThisYearCents)],
    ['ARR Personally Closed This Year (productivity — deals you closed)', usd(rollup.arrPersonallyClosedThisYearCents)],
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
    { header: 'ARR Added to Book This Year', key: 'arrAdded', width: 22 },
    { header: 'ARR Personally Closed This Year', key: 'arrPersonallyClosed', width: 24 },
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
      arrPersonallyClosed: usd(a.arr_personally_closed_this_year_cents),
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

  const keyContacts = flattenKeyContacts(accounts);
  const keyContactsSheet = workbook.addWorksheet('Key Contacts');
  keyContactsSheet.columns = [
    { header: 'Account', key: 'companyName', width: 30 },
    { header: 'Tier', key: 'tier', width: 8 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Title', key: 'title', width: 24 },
    { header: 'Label(s)', key: 'labels', width: 30 },
    { header: 'Fun Facts', key: 'funFacts', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Last Activity', key: 'lastActivityDate', width: 14 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Link', key: 'hubspotUrl', width: 40 },
  ];
  keyContactsSheet.getRow(1).font = { bold: true };
  for (const c of keyContacts) {
    keyContactsSheet.addRow({
      companyName: c.companyName,
      tier: c.tier ?? '',
      name: c.name || '',
      title: c.title || '',
      labels: (c.labels || []).join(', '),
      funFacts: c.funFacts || '',
      notes: c.notes || '',
      lastActivityDate: c.lastActivityDate ? c.lastActivityDate.slice(0, 10) : '',
      email: c.email || '',
      phone: c.phone || '',
      hubspotUrl: c.hubspotUrl || '',
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
    { header: 'Closed By', key: 'dealOwnerName', width: 20 },
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
      dealOwnerName: d.dealOwnerName || '',
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
    ['Open Tickets (Client Submitted + In Progress, excl. enhancement requests)', account.open_ticket_count || 0],
    ['Closed Tickets', account.closed_ticket_count || 0],
    ['Open Deals', account.open_deal_count || 0],
    ['Open Deal Value', usd(account.open_deal_value_cents)],
    ['ARR', usd(account.arr_cents)],
    ['ARR Added to Book This Year (workload — counts inherited deals)', usd(account.arr_added_this_year_cents)],
    ['ARR Personally Closed This Year (productivity — deals you closed)', usd(account.arr_personally_closed_this_year_cents)],
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

  const keyContactsSheet = workbook.addWorksheet('Key Contacts');
  keyContactsSheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Title', key: 'title', width: 24 },
    { header: 'Label(s)', key: 'labels', width: 30 },
    { header: 'Fun Facts', key: 'funFacts', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Last Activity', key: 'lastActivityDate', width: 14 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Link', key: 'hubspotUrl', width: 40 },
  ];
  keyContactsSheet.getRow(1).font = { bold: true };
  for (const c of account.keyContacts || []) {
    keyContactsSheet.addRow({
      name: c.name || '',
      title: c.title || '',
      labels: (c.labels || []).join(', '),
      funFacts: c.funFacts || '',
      notes: c.notes || '',
      lastActivityDate: c.lastActivityDate ? c.lastActivityDate.slice(0, 10) : '',
      email: c.email || '',
      phone: c.phone || '',
      hubspotUrl: c.hubspotUrl || '',
    });
  }
  if (account.missingKeyContactLabels?.length > 0) {
    keyContactsSheet.addRow({});
    keyContactsSheet.addRow({ name: `No contact tagged as: ${account.missingKeyContactLabels.join(', ')}` });
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
  for (const t of svc?.enhancementLesserItems || []) {
    serviceSheet.addRow({ subject: t.subject, ageDays: '', stage: t.stage, rank: '', url: t.url || '' });
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
