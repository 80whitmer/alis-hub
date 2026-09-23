/**
 * Resident acuity history — per-resident, per-month care level / points /
 * care-level fee for one community, built for Leisure Care's "detailed
 * acuity report by month" ask (Sep 2026) and meant to back a reusable job
 * template.
 *
 * Sources (all confirmed live against leisurecare/Empress before building):
 *  - unitOccupancies (v1, one call per month): daily per-bed rows with the
 *    occupying resident's care level + points as of that day. Matched the
 *    evaluation in effect 56/56 on a spot-checked date, so this is the
 *    backbone for "what level was this resident at in month X".
 *  - evaluations (one account-wide call, full history): fee per assessment,
 *    plus the Evaluation Log tab.
 *  - residents?status=CurrentResident: careLevelFee for the current month —
 *    matched evaluation fee 55/55, and also covers a resident whose level is
 *    set without a current evaluation.
 *
 * The fee here is the ALIS care-level fee, NOT an invoiced amount — some
 * accounts (Leisure Care among them) don't bill in ALIS at all.
 *
 * ALIS date strings ("2026-08-01T00:00:00.0000000") are handled as plain
 * strings (slice), never parsed through Date, to avoid timezone drift.
 */
const ExcelJS = require('exceljs');
const { alisApiGet, getEvaluations, getResidents, getCommunities, getInvoiceCharges } = require('./alisApiClient');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const CHANGED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const MONEY_FMT = '"$"#,##0.00';

const round2 = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const day = (s) => (s ? String(s).slice(0, 10) : null);
const asArray = (res) => (Array.isArray(res) ? res : res?.items || []);

/** ['2025-10', ..., '2026-09'] — `count` calendar months ending with endMonth (YYYY-MM). */
function monthRange(endMonth, count) {
  let [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };

/**
 * The account-wide pulls (communities, full evaluation history, current
 * residents, and — when `months` is given — invoice charges per month) —
 * done once per job and shared across every community in it, since each
 * one returns the whole host regardless of community. invoiceCharges caps
 * at one month per call, hence the loop.
 */
async function pullSharedAcuityData(companyHost, { onProgress = () => {}, months = [] } = {}) {
  onProgress('Pulling communities…');
  const communities = asArray(await getCommunities(companyHost));
  onProgress('Pulling evaluations…');
  const evaluations = asArray(await getEvaluations(companyHost));
  onProgress('Pulling current residents…');
  const currentResidents = asArray(await getResidents(companyHost));
  const invoiceChargesByMonth = {};
  for (const month of months) {
    onProgress(`Pulling invoice charges for ${month}…`);
    invoiceChargesByMonth[month] = asArray(await getInvoiceCharges(companyHost, {
      invoiceStartDate: `${month}-01`,
      invoiceEndDate: `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
    }));
  }
  return { communities, evaluations, currentResidents, invoiceChargesByMonth };
}

/**
 * Finds a community by ALIS ID, or failing that by name (exact, then
 * unique partial match) — the job form lets people type a name they know
 * instead of looking up the numeric ID.
 */
function resolveCommunity(communities, { communityId, name }) {
  if (communityId) {
    const byId = communities.find((c) => String(c.communityId) === String(communityId).trim());
    if (byId) return byId;
  }
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = communities.find((c) => (c.communityName || '').toLowerCase() === wanted);
  if (exact) return exact;
  const partial = communities.filter((c) => (c.communityName || '').toLowerCase().includes(wanted));
  if (partial.length > 1) throw new Error(`"${name}" matches more than one community (${partial.map((c) => c.communityName).join(', ')}) — use the ALIS Community ID instead`);
  return partial[0] || null;
}

/** Raw pulls for one community. Months are pulled sequentially — some hosts reset connections under concurrency (see alisApiClient.js). */
async function pullAcuityData(companyHost, communityId, months, { onProgress = () => {}, shared } = {}) {
  const { communities, evaluations: allEvaluations, currentResidents: allResidents, invoiceChargesByMonth: allInvoices = {} } =
    shared || await pullSharedAcuityData(companyHost, { onProgress, months });
  const community = communities.find((c) => String(c.communityId) === String(communityId));
  if (!community) throw new Error(`Community ${communityId} not found on host ${companyHost}`);

  const occupancyByMonth = {};
  for (const month of months) {
    onProgress(`Pulling unit occupancy for ${month}…`);
    const rows = asArray(await alisApiGet(companyHost, '/v1/export/communities/floorPlan/unitOccupancies', { monthAndYear: `${month}-01`, communityId }));
    occupancyByMonth[month] = rows;
  }

  const evaluations = allEvaluations.filter((e) => String(e.communityId) === String(communityId));
  const currentResidents = allResidents.filter((r) => String(r.communityId) === String(communityId));
  const invoiceChargesByMonth = Object.fromEntries(Object.entries(allInvoices).map(([m, rows]) =>
    [m, rows.filter((r) => String(r.communityId) === String(communityId))]));

  return { community, occupancyByMonth, evaluations, currentResidents, invoiceChargesByMonth };
}

/**
 * Pure transform: raw pulls → report rows. `asOfDate` (YYYY-MM-DD) caps the
 * last month so future-dated occupancy rows (if any) aren't read as fact.
 * `currentMonth` (YYYY-MM, defaults to today's) is the only month whose fee
 * comes from the current resident record — for a report ending in a past
 * month, every month uses the evaluation in effect at the time.
 */
function buildAcuityReport(raw, { months, asOfDate, currentMonth = new Date().toLocaleDateString('en-CA').slice(0, 7), careItemNames = [] }) {
  const { community, occupancyByMonth, evaluations, currentResidents, invoiceChargesByMonth = {} } = raw;

  // Completed evaluations with a level, oldest → newest per resident.
  const evalsByResident = new Map();
  for (const e of evaluations) {
    if (!e.isCompleted || !e.careLevel || !e.evaluationDate) continue;
    if (!evalsByResident.has(e.residentId)) evalsByResident.set(e.residentId, []);
    evalsByResident.get(e.residentId).push(e);
  }
  for (const list of evalsByResident.values()) list.sort((a, b) => (a.evaluationDate < b.evaluationDate ? -1 : 1));

  // Per-level fee schedule. Some accounts use a fixed fee per level
  // (Leisure Care: "AL Level 3" is always $2,500); others price a single
  // level by points (Tenfold's "AL Resident Care" ranges $520–$5,590 per
  // resident). A level only counts as fixed-fee — and is only used as a
  // fallback fee — when ≥90% of its evaluations share one fee.
  const feeCounts = {};
  for (const list of evalsByResident.values()) for (const e of list) {
    feeCounts[e.careLevel] ||= {};
    feeCounts[e.careLevel][e.fee] = (feeCounts[e.careLevel][e.fee] || 0) + 1;
  }
  const levelFeeSchedule = Object.fromEntries(Object.entries(feeCounts).map(([lvl, counts]) => {
    const entries = Object.entries(counts).map(([fee, n]) => [Number(fee), n]).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const fees = entries.map(([fee]) => fee);
    return [lvl, {
      fixedFee: entries[0][1] / total >= 0.9 ? entries[0][0] : null,
      minFee: Math.min(...fees),
      maxFee: Math.max(...fees),
      evaluations: total,
    }];
  }));

  const currentById = new Map(currentResidents.map((r) => [r.residentId, r]));
  const nameById = new Map();
  for (const e of evaluations) if (e.residentName) nameById.set(e.residentId, e.residentName);
  for (const r of currentResidents) if (r.fullName) nameById.set(r.residentId, r.fullName);

  function resolveFee(residentId, level, onDate, month) {
    if (!level) return { fee: null, feeSource: '' };
    if (month === currentMonth) {
      const cur = currentById.get(residentId);
      if (cur && cur.careLevelName === level && cur.careLevelFee !== null && cur.careLevelFee !== '') {
        return { fee: round2(cur.careLevelFee), feeSource: 'Current resident record' };
      }
    }
    const inEffect = (evalsByResident.get(residentId) || []).filter((e) => day(e.evaluationDate) <= onDate).pop();
    if (inEffect && inEffect.careLevel === level) {
      return { fee: round2(inEffect.fee), feeSource: 'Evaluation in effect', evaluation: inEffect };
    }
    const sched = levelFeeSchedule[level];
    if (sched?.fixedFee !== null && sched?.fixedFee !== undefined) return { fee: sched.fixedFee, feeSource: 'Level fee schedule (no matching evaluation)' };
    if (sched) return { fee: null, feeSource: 'Unknown — no matching evaluation, and this level\'s fee varies by resident' };
    return { fee: null, feeSource: 'Unknown — no matching evaluation' };
  }

  const detail = [];
  const monthsWithNoData = [];
  for (const month of months) {
    const rows = (occupancyByMonth[month] || []).filter((r) => day(r.date) <= asOfDate);
    if (rows.length === 0) { monthsWithNoData.push(month); continue; }

    // Collapse per-bed daily rows into one record per resident for the month.
    const byResident = new Map();
    for (const r of rows) for (const side of ['primary', 'secondary']) {
      const rid = r[`${side}ResidentID`];
      if (!rid) continue;
      const d = day(r.date);
      if (!byResident.has(rid)) byResident.set(rid, { days: new Set(), levels: [], last: null });
      const acc = byResident.get(rid);
      acc.days.add(d);
      const level = r[`${side}ResidentCareLevel`] || '';
      if (acc.levels[acc.levels.length - 1] !== level) acc.levels.push(level);
      if (!acc.last || d >= acc.last.date) {
        acc.last = {
          date: d,
          name: r[`${side}Resident`],
          productType: r[`${side}ResidentProductType`] || '',
          level,
          points: round2(r[`${side}ResidentCarePoints`]),
          room: [r.doorNumber, r.bedNumber].filter(Boolean).join('-'),
        };
      }
    }

    for (const [residentId, acc] of byResident) {
      const { fee, feeSource, evaluation } = resolveFee(residentId, acc.last.level, acc.last.date, month);
      const distinctLevels = [...new Set(acc.levels.filter(Boolean))];
      detail.push({
        month,
        residentId,
        residentName: nameById.get(residentId) || acc.last.name || '',
        productType: acc.last.productType,
        room: acc.last.room,
        daysInCommunity: acc.days.size,
        asOfDate: acc.last.date,
        level: acc.last.level,
        points: acc.last.points,
        fee,
        feeSource,
        overrideNote: evaluation?.preOverrideCareLevel ? `Overridden from ${evaluation.preOverrideCareLevel}${evaluation.preOverrideFee != null ? ` ($${evaluation.preOverrideFee})` : ''}` : '',
        midMonthChange: distinctLevels.length > 1 ? distinctLevels.join(' → ') : '',
      });
    }
  }

  // Month-over-month change flag, per resident. A first-ever level (blank →
  // level, i.e. the initial evaluation being entered) is tracked separately
  // so it doesn't inflate the level-change count during go-live months.
  const sorted = [...detail].sort((a, b) => (a.residentId - b.residentId) || (a.month < b.month ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const r = sorted[i];
    const samePerson = prev && prev.residentId === r.residentId;
    r.changeFromPrior = samePerson && prev.level && r.level && prev.level !== r.level ? `${prev.level} → ${r.level}` : '';
    r.firstLevel = !!r.level && (!samePerson || !prev.level);
  }
  detail.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.residentName.localeCompare(b.residentName)));

  // ── Invoiced care vs care level fee (only for communities that bill in ALIS) ──
  // ALIS invoice lines carry no care tag/category, so care items are picked
  // by name: an explicit list if the job gave one, otherwise any item with
  // "care" in its name. Every billing item seen is listed on the Billing
  // Items tab with whether it was counted, so the filtering is auditable.
  const invoiceRows = months.flatMap((m) => (invoiceChargesByMonth[m] || []).map((r) => ({ ...r, month: m })));
  const hasBilling = invoiceRows.length > 0;
  const explicitCareItems = careItemNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const isCareItem = (name) => (explicitCareItems.length
    ? explicitCareItems.includes((name || '').trim().toLowerCase())
    // Whole word only — "Care Plan Fees" counts, "Caregiver Escort" (a Tenfold escort service, not care-level billing) doesn't.
    : /\bcare\b/i.test(name || ''));

  const billingItems = [];
  const varianceRows = [];
  if (hasBilling) {
    const itemAgg = new Map();
    const careByResidentMonth = new Map();
    for (const r of invoiceRows) {
      const name = r.itemName || '(no item name)';
      if (!itemAgg.has(name)) itemAgg.set(name, { itemName: name, counted: isCareItem(name), lines: 0, charges: 0, credits: 0, residents: new Set() });
      const agg = itemAgg.get(name);
      agg.lines++;
      agg.residents.add(r.residentId);
      if ((r.amount || 0) < 0) agg.credits += r.amount; else agg.charges += r.amount || 0;
      if (agg.counted) {
        const key = `${r.residentId}|${r.month}`;
        if (!careByResidentMonth.has(key)) careByResidentMonth.set(key, { amount: 0, items: new Set(), name: r.residentName });
        const c = careByResidentMonth.get(key);
        c.amount += r.amount || 0;
        c.items.add(name);
      }
    }
    for (const a of itemAgg.values()) {
      billingItems.push({ ...a, residents: a.residents.size, charges: round2(a.charges), credits: round2(a.credits), net: round2(a.charges + a.credits) });
    }
    billingItems.sort((a, b) => (b.counted - a.counted) || (b.net - a.net));

    const periodDays = (month) => (month === asOfDate.slice(0, 7) ? Number(asOfDate.slice(8, 10)) : daysInMonth(month));
    const seen = new Set();
    for (const r of detail) {
      const key = `${r.residentId}|${r.month}`;
      seen.add(key);
      const billed = careByResidentMonth.get(key);
      r.invoicedCare = round2(billed?.amount || 0);
      r.careItemsBilled = billed ? [...billed.items].join(', ') : '';
      r.variance = round2(r.invoicedCare - (r.fee || 0));
      const partial = r.daysInCommunity < periodDays(r.month);
      if (Math.abs(r.variance) < 1) r.varianceNote = '';
      else if (!r.fee && r.invoicedCare) r.varianceNote = 'Care billed, but no care level fee';
      else if (r.fee && !r.invoicedCare) r.varianceNote = 'Care level fee, but no care charge invoiced';
      else if (partial && r.invoicedCare < r.fee) r.varianceNote = 'Partial month — likely prorated';
      else r.varianceNote = 'Invoiced differs from care level fee';
      if (r.varianceNote) varianceRows.push(r);
    }
    // Care billed to a resident who wasn't in the community that month (advance/arrears billing, move-out adjustments).
    for (const [key, billed] of careByResidentMonth) {
      if (seen.has(key) || Math.abs(billed.amount) < 1) continue;
      const [residentId, month] = key.split('|');
      varianceRows.push({
        month, residentId: Number(residentId), residentName: nameById.get(Number(residentId)) || billed.name || '',
        productType: '', level: '', fee: null, invoicedCare: round2(billed.amount), variance: round2(billed.amount),
        careItemsBilled: [...billed.items].join(', '), daysInCommunity: 0,
        varianceNote: 'Care billed, but resident not in the community this month',
      });
    }
    varianceRows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }

  const summary = months.filter((m) => !monthsWithNoData.includes(m)).map((month) => {
    const rows = detail.filter((r) => r.month === month);
    const leveled = rows.filter((r) => r.level);
    // Leveled residents only — Independent residents carry token points with no level and would drag the average down.
    const withPoints = leveled.filter((r) => r.points !== null);
    return {
      month,
      residents: rows.length,
      withLevel: leveled.length,
      noLevel: rows.length - leveled.length,
      avgPoints: withPoints.length ? round2(withPoints.reduce((s, r) => s + r.points, 0) / withPoints.length) : null,
      totalFees: round2(leveled.reduce((s, r) => s + (r.fee || 0), 0)),
      levelChanges: rows.filter((r) => r.changeFromPrior).length,
      firstLevels: rows.filter((r) => r.firstLevel).length,
      ...(hasBilling ? {
        invoicedCare: round2(rows.reduce((s, r) => s + (r.invoicedCare || 0), 0)),
        variance: round2(rows.reduce((s, r) => s + (r.variance || 0), 0)),
        residentsWithVariance: rows.filter((r) => r.varianceNote).length,
      } : {}),
    };
  });

  const evaluationLog = evaluations
    .filter((e) => e.evaluationDate)
    .sort((a, b) => (a.evaluationDate < b.evaluationDate ? 1 : -1))
    .map((e) => ({
      evaluationDate: day(e.evaluationDate),
      residentId: e.residentId,
      residentName: nameById.get(e.residentId) || e.residentName || '',
      productType: e.residentProductType || '',
      reason: e.reason || '',
      status: e.isCompleted ? 'Completed' : e.isInProgress ? 'In progress' : (e.status || ''),
      level: e.careLevel || '',
      points: round2(e.carePoints),
      fee: e.careLevel ? round2(e.fee) : null,
      preOverrideLevel: e.preOverrideCareLevel || '',
      preOverrideFee: round2(e.preOverrideFee),
      isMostCurrent: e.isMostCurrent ? 'Yes' : '',
      expirationDate: day(e.expirationDate) || '',
    }));

  return {
    communityName: community.communityName,
    communityId: community.communityId,
    months,
    asOfDate,
    monthsWithNoData,
    firstEvaluationDate: evaluationLog.length ? evaluationLog[evaluationLog.length - 1].evaluationDate : null,
    levelFeeSchedule,
    summary,
    detail,
    evaluationLog,
    hasBilling,
    careItemFilter: explicitCareItems.length ? `Explicit list: ${careItemNames.filter((n) => n.trim()).join(', ')}` : 'Default: any billing item with the word "care" in its name (e.g. "Care Plan Fees" counts, "Caregiver Escort" does not)',
    billingItems,
    varianceRows,
  };
}

function styleHeader(sheet) {
  sheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

function buildAcuityWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';

  // Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Residents', key: 'residents', width: 11 },
    { header: 'With Care Level', key: 'withLevel', width: 15 },
    { header: 'No Care Level', key: 'noLevel', width: 14 },
    { header: 'Avg Care Points', key: 'avgPoints', width: 15 },
    { header: 'Total Monthly Care Level Fees', key: 'totalFees', width: 28, style: { numFmt: MONEY_FMT } },
    { header: 'Level Changes vs Prior Month', key: 'levelChanges', width: 27 },
    { header: 'First Level Assigned', key: 'firstLevels', width: 20 },
    ...(report.hasBilling ? [
      { header: 'Invoiced Care Charges', key: 'invoicedCare', width: 21, style: { numFmt: MONEY_FMT } },
      { header: 'Variance (Invoiced − Fee)', key: 'variance', width: 24, style: { numFmt: MONEY_FMT } },
      { header: 'Residents with Variance', key: 'residentsWithVariance', width: 22 },
    ] : []),
  ];
  for (const r of report.summary) s.addRow({ ...r, month: monthLabel(r.month) });
  styleHeader(s);

  // Monthly Detail
  const d = wb.addWorksheet('Monthly Detail');
  d.columns = [
    { header: 'Month', key: 'month', width: 11 },
    { header: 'Resident', key: 'residentName', width: 26 },
    { header: 'Resident ID', key: 'residentId', width: 11 },
    { header: 'Product Type', key: 'productType', width: 13 },
    { header: 'Room', key: 'room', width: 9 },
    { header: 'Days in Month', key: 'daysInCommunity', width: 13 },
    { header: 'As Of', key: 'asOfDate', width: 11 },
    { header: 'Care Level', key: 'level', width: 13 },
    { header: 'Care Points', key: 'points', width: 11 },
    { header: 'Care Level Fee', key: 'fee', width: 14, style: { numFmt: MONEY_FMT } },
    { header: 'Change vs Prior Month', key: 'changeFromPrior', width: 26 },
    { header: 'Mid-Month Level Change', key: 'midMonthChange', width: 26 },
    { header: 'Override', key: 'overrideNote', width: 28 },
    { header: 'Fee Source', key: 'feeSource', width: 30 },
    ...(report.hasBilling ? [
      { header: 'Invoiced Care Charges', key: 'invoicedCare', width: 21, style: { numFmt: MONEY_FMT } },
      { header: 'Variance (Invoiced − Fee)', key: 'variance', width: 24, style: { numFmt: MONEY_FMT } },
      { header: 'Variance Note', key: 'varianceNote', width: 40 },
      { header: 'Care Items Billed', key: 'careItemsBilled', width: 36 },
    ] : []),
  ];
  for (const r of report.detail) {
    const row = d.addRow({ ...r, month: monthLabel(r.month) });
    if (r.changeFromPrior) row.getCell('changeFromPrior').fill = CHANGED_FILL;
    if (r.varianceNote) row.getCell('variance').fill = CHANGED_FILL;
  }
  styleHeader(d);

  // Resident × Month grids
  const residents = new Map();
  for (const r of report.detail) {
    if (!residents.has(r.residentId)) residents.set(r.residentId, { name: r.residentName, productType: r.productType, byMonth: {} });
    const x = residents.get(r.residentId);
    x.byMonth[r.month] = r;
    x.productType = r.productType || x.productType;
  }
  const residentList = [...residents.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const gridMonths = report.months.filter((m) => !report.monthsWithNoData.includes(m));

  for (const [title, pick, numFmt] of [
    ['Level by Month', (r) => (r.level ? `${r.level} (${r.points ?? '—'} pts)` : (r.points !== null ? `(${r.points} pts)` : '')), null],
    ['Fee by Month', (r) => r.fee, MONEY_FMT],
    ...(report.hasBilling ? [['Invoiced Care by Month', (r) => r.invoicedCare, MONEY_FMT]] : []),
  ]) {
    const g = wb.addWorksheet(title);
    g.columns = [
      { header: 'Resident', key: 'name', width: 26 },
      { header: 'Resident ID', key: 'id', width: 11 },
      { header: 'Product Type', key: 'productType', width: 13 },
      ...gridMonths.map((m) => ({ header: monthLabel(m), key: m, width: numFmt ? 12 : 22, style: numFmt ? { numFmt } : {} })),
    ];
    for (const [id, x] of residentList) {
      const row = { name: x.name, id, productType: x.productType };
      for (const m of gridMonths) if (x.byMonth[m]) row[m] = pick(x.byMonth[m]);
      const added = g.addRow(row);
      gridMonths.forEach((m, i) => { if (x.byMonth[m]?.changeFromPrior) added.getCell(4 + i).fill = CHANGED_FILL; });
    }
    if (numFmt) {
      const totals = { name: 'Total' };
      for (const m of gridMonths) totals[m] = round2(report.detail.filter((r) => r.month === m).reduce((sum, r) => sum + (pick(r) || 0), 0));
      g.addRow(totals).font = { bold: true };
    }
    styleHeader(g);
  }

  if (report.hasBilling) {
    const v = wb.addWorksheet('Care Fee Variance');
    v.columns = [
      { header: 'Month', key: 'month', width: 11 },
      { header: 'Resident', key: 'residentName', width: 26 },
      { header: 'Resident ID', key: 'residentId', width: 11 },
      { header: 'Product Type', key: 'productType', width: 13 },
      { header: 'Days in Month', key: 'daysInCommunity', width: 13 },
      { header: 'Care Level', key: 'level', width: 16 },
      { header: 'Care Level Fee', key: 'fee', width: 14, style: { numFmt: MONEY_FMT } },
      { header: 'Invoiced Care Charges', key: 'invoicedCare', width: 21, style: { numFmt: MONEY_FMT } },
      { header: 'Variance (Invoiced − Fee)', key: 'variance', width: 24, style: { numFmt: MONEY_FMT } },
      { header: 'Variance Note', key: 'varianceNote', width: 44 },
      { header: 'Care Items Billed', key: 'careItemsBilled', width: 36 },
    ];
    for (const r of report.varianceRows) v.addRow({ ...r, month: monthLabel(r.month) });
    if (report.varianceRows.length === 0) v.addRow({ residentName: 'No variances — every resident-month\'s invoiced care matched its care level fee.' });
    styleHeader(v);

    const b = wb.addWorksheet('Billing Items');
    b.columns = [
      { header: 'Billing Item', key: 'itemName', width: 40 },
      { header: 'Counted as Care?', key: 'countedLabel', width: 16 },
      { header: 'Invoice Lines', key: 'lines', width: 13 },
      { header: 'Residents', key: 'residents', width: 11 },
      { header: 'Charges', key: 'charges', width: 14, style: { numFmt: MONEY_FMT } },
      { header: 'Credits', key: 'credits', width: 14, style: { numFmt: MONEY_FMT } },
      { header: 'Net', key: 'net', width: 14, style: { numFmt: MONEY_FMT } },
    ];
    for (const r of report.billingItems) {
      const row = b.addRow({ ...r, countedLabel: r.counted ? 'Yes' : 'No' });
      if (r.counted) row.getCell('countedLabel').fill = CHANGED_FILL;
    }
    styleHeader(b);
  }

  // Evaluation Log
  const e = wb.addWorksheet('Evaluation Log');
  e.columns = [
    { header: 'Evaluation Date', key: 'evaluationDate', width: 15 },
    { header: 'Resident', key: 'residentName', width: 26 },
    { header: 'Resident ID', key: 'residentId', width: 11 },
    { header: 'Product Type', key: 'productType', width: 13 },
    { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Care Level', key: 'level', width: 13 },
    { header: 'Care Points', key: 'points', width: 11 },
    { header: 'Care Level Fee', key: 'fee', width: 14, style: { numFmt: MONEY_FMT } },
    { header: 'Pre-Override Level', key: 'preOverrideLevel', width: 18 },
    { header: 'Pre-Override Fee', key: 'preOverrideFee', width: 16, style: { numFmt: MONEY_FMT } },
    { header: 'Most Current', key: 'isMostCurrent', width: 12 },
    { header: 'Expires', key: 'expirationDate', width: 11 },
  ];
  for (const r of report.evaluationLog) e.addRow(r);
  styleHeader(e);

  // Level Fee Schedule
  const f = wb.addWorksheet('Level Fee Schedule');
  f.columns = [
    { header: 'Care Level', key: 'level', width: 30 },
    { header: 'Fee Type', key: 'type', width: 26 },
    { header: 'Fee', key: 'fee', width: 12, style: { numFmt: MONEY_FMT } },
    { header: 'Lowest Fee', key: 'minFee', width: 12, style: { numFmt: MONEY_FMT } },
    { header: 'Highest Fee', key: 'maxFee', width: 12, style: { numFmt: MONEY_FMT } },
    { header: 'Evaluations', key: 'evaluations', width: 12 },
  ];
  for (const [level, s] of Object.entries(report.levelFeeSchedule).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const fixed = s.fixedFee !== null;
    f.addRow({
      level,
      type: fixed ? 'Fixed per level' : 'Varies by resident (points)',
      fee: fixed ? s.fixedFee : null,
      minFee: s.minFee,
      maxFee: s.maxFee,
      evaluations: s.evaluations,
    });
  }
  styleHeader(f);

  // Methodology Notes
  const n = wb.addWorksheet('Methodology Notes');
  n.columns = [{ header: 'Methodology Notes', key: 'note', width: 120 }];
  const covered = report.months.filter((m) => !report.monthsWithNoData.includes(m));
  const notes = [
    `Community: ${report.communityName} (ALIS community ${report.communityId}). Report period: ${monthLabel(report.months[0])} – ${monthLabel(report.months[report.months.length - 1])}, data through ${report.asOfDate}.`,
    '',
    'WHAT EACH ROW MEANS',
    'Monthly Detail has one row per resident per month for every resident who occupied a room in the community on at least one day that month. Care level and points are as of the resident\'s last day in the community that month (month-end for residents who stayed all month; their final day for residents who moved out). "Days in Month" is how many days they were in the community.',
    'If a resident\'s level changed partway through a month, the "Mid-Month Level Change" column shows the sequence; the row reports the later level.',
    '"Change vs Prior Month" (highlighted) flags a different level from the resident\'s previous month in this report. A resident receiving their first care level (e.g. the initial evaluation being entered) is counted under "First Level Assigned" on the Summary tab instead, not as a level change.',
    'Average Care Points on the Summary tab is across residents with a care level only.',
    '',
    'CARE LEVEL FEES',
    report.hasBilling
      ? 'The "Care Level Fee" is the ALIS care-level fee attached to each care level — the benchmark for what care should cost. It is NOT necessarily what was invoiced; see CARE FEE VARIANCE below for the invoiced comparison.'
      : 'Fees are the ALIS care-level fee attached to each care level — they are NOT invoiced or billed amounts. No ALIS invoice data was found for this community in the report period (the account may bill outside ALIS), so there is nothing in ALIS to compare against.',
    'Current month: fee from the resident\'s current record in ALIS. Prior months: fee from the resident\'s evaluation in effect on that date. If no evaluation matches (rare), the standard fee for that level is used when the level has one, and the Fee Source column says so.',
    'Some care levels have one fixed fee (e.g. every "Level 3" resident pays the same); others are priced by each resident\'s care points, so residents at the same level pay different fees. The Level Fee Schedule tab shows which type each level is, with the fee (fixed) or the lowest-to-highest range seen (varies). A varying level\'s fee is never guessed — it is left blank if no evaluation supports it.',
    'Because prior months use the fee on the evaluation in effect at the time, a fee-schedule change during the year would show up as the old rate in earlier months — that is the historically correct figure.',
    '"Total Monthly Care Level Fees" on the Summary tab is a simple sum of each resident\'s monthly care level fee; it is not prorated for partial months.',
    '',
    'DATA HISTORY',
    `Care level history in ALIS for this community starts with the first evaluation on ${report.firstEvaluationDate || 'n/a'}. Months before evaluations were entered show residents with no care level (points may still appear for some residents).`,
    report.monthsWithNoData.length ? `No occupancy data was returned for: ${report.monthsWithNoData.map(monthLabel).join(', ')}.` : `Occupancy data was available for all ${covered.length} months.`,
    'Independent Living residents may show care points with no care level — this is how they are set up in ALIS.',
    ...(report.hasBilling ? [
      '',
      'CARE FEE VARIANCE',
      'This community bills in ALIS, so each resident-month compares the care level fee (the benchmark) to the care charges actually invoiced. Variance = Invoiced Care Charges − Care Level Fee. The Care Fee Variance tab lists every resident-month where the two differ by $1 or more, largest first.',
      `IMPORTANT — how care charges were identified: ALIS invoice lines have no "care" tag or category, so care charges are picked out by billing item name. Filter used for this report: ${report.careItemFilter}. The Billing Items tab lists every billing item invoiced in the period and whether it was counted as care — check it first. An item that is really a care charge but wasn't counted (or a non-care item that was) will show up as variance across many residents.`,
      'If care charges are hard to pick out by name (e.g. care is billed under generic or mixed-purpose items, or rolled into rent), that is itself a signal that the billing item setup may need to be cleaned up so care charges are clearly identifiable.',
      'Invoiced amounts are matched to a month by invoice date, net of credits on care items. Accounts that bill in advance (e.g. a September invoice dated 9/1) line up month to month; accounts that bill in arrears, or credits applied to a prior month\'s charge, will show timing variances that net out over time.',
      'Common, expected variances: partial months (move-ins/move-outs are usually prorated — flagged "Partial month — likely prorated"), level changes mid-month, and one-off credits. "Care level fee, but no care charge invoiced" and "Care billed, but no care level fee" are the ones most worth a closer look.',
      'The current month may not be fully invoiced yet, so its variance can be overstated.',
    ] : []),
    '',
    'SOURCES',
    `ALIS export API: daily unit occupancy (care level and points per resident per day), resident evaluations (full history), and current resident records (current care level fee)${report.hasBilling ? ', and invoice charge lines (per month, by invoice date)' : ''}.`,
  ];
  for (const note of notes) {
    const row = n.addRow({ note });
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (/^[A-Z ]+$/.test(note) && note) row.font = { bold: true };
  }
  n.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });

  return wb;
}

module.exports = { monthRange, monthLabel, pullSharedAcuityData, resolveCommunity, pullAcuityData, buildAcuityReport, buildAcuityWorkbook };
