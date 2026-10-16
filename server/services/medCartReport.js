/**
 * Community Med Cart Report — ties ALIS's "Default Med Cart" floor-plan field
 * (exported manually from the ALIS admin Floor Plan report — not available
 * via the export API; confirmed against ALIS_EXPORT_API_REFERENCE.md's
 * /v1/export/communities/floorPlan schema, which has no cart field at all)
 * to actual medication-pass activity from getOrderAdministration, broken out
 * by med pass shift (byShift).
 *
 * The floor plan file only gives a resident's display name ("Last, First")
 * and unit number — no stable ALIS resident ID — so residents are matched to
 * getResidents() by name-token comparison, cross-checked against ALIS's own
 * `rooms` field when a name matches more than one resident. Same "flag,
 * don't guess" philosophy as agingReportMatcher.js: anything that doesn't
 * confidently match is surfaced on the Flagged sheet, not silently dropped.
 */
const ExcelJS = require('exceljs');
const { getCommunities, getResidents, getOrderAdministration } = require('./alisApiClient');
const { resolveCommunity } = require('./acuityHistory');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const FLAG_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };

const asArray = (res) => (Array.isArray(res) ? res : res?.items || []);

// AM/Noon/PM/HS-style labels sort first in that order; anything else (a
// blank or an unrecognized label ALIS might use at a given client) sorts
// after, alphabetically, rather than being hidden or guessed at.
const SHIFT_ORDER = ['AM', 'Noon', 'PM', 'HS'];
function shiftSortKey(shift) {
  const i = SHIFT_ORDER.indexOf(shift);
  return i === -1 ? [1, shift || ''] : [0, i];
}
function compareShifts(a, b) {
  const [ap, ai] = shiftSortKey(a);
  const [bp, bi] = shiftSortKey(b);
  if (ap !== bp) return ap - bp;
  return typeof ai === 'number' ? ai - bi : String(ai).localeCompare(String(bi));
}

function normalizeNameTokens(name) {
  return new Set(
    (name || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function sameTokenSet(a, b) {
  if (a.size === 0 || b.size === 0 || a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/** True if every token of the shorter set appears in the longer one. */
function subsetMatch(a, b) {
  if (a.size === 0 || b.size === 0) return false;
  const [shorter, longer] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of shorter) if (!longer.has(t)) return false;
  return true;
}

function normalizeUnit(unit) {
  return (unit || '').toString().toUpperCase().replace(/\s+/g, '');
}

/** ALIS's `rooms` field is a free-text string, sometimes holding more than one room (room changes, second occupant). */
function roomMatches(residentRooms, unitKey) {
  if (!residentRooms || !unitKey) return false;
  return residentRooms
    .split(/[,/]/)
    .map((r) => normalizeUnit(r))
    .includes(unitKey);
}

function residentDisplayName(resident) {
  return resident.fullName || [resident.firstName, resident.lastName].filter(Boolean).join(' ');
}

/**
 * Matches floor-plan rows (Unit #, Assigned To, Default Med Cart) to ALIS
 * residents for one community. Vacant units (blank Assigned To) are skipped
 * entirely — they aren't residents and shouldn't be flagged as unmatched.
 */
function matchFloorPlanToResidents(floorPlanRows, residents) {
  const matched = [];
  const unmatchedFloorPlan = [];
  const matchedResidentIds = new Set();

  for (const row of floorPlanRows) {
    const assignedTo = (row.assignedTo || '').trim();
    if (!assignedTo) continue;

    const unitKey = normalizeUnit(row.unitNumber);
    const rowTokens = normalizeNameTokens(assignedTo);

    let candidates = residents.filter((r) => sameTokenSet(rowTokens, normalizeNameTokens(residentDisplayName(r))));
    let confidence = 'exact-name';

    if (candidates.length === 0) {
      candidates = residents.filter((r) => subsetMatch(rowTokens, normalizeNameTokens(residentDisplayName(r))));
      confidence = 'fuzzy-name';
    }

    let resident = null;
    if (candidates.length === 1) {
      resident = candidates[0];
    } else if (candidates.length > 1) {
      resident = candidates.find((r) => roomMatches(r.rooms, unitKey)) || null;
      if (!resident) {
        unmatchedFloorPlan.push({
          unitNumber: row.unitNumber,
          assignedTo,
          defaultMedCart: row.defaultMedCart,
          reason: `Name matches ${candidates.length} ALIS residents (${candidates.map(residentDisplayName).join(', ')}) and none is on Unit ${row.unitNumber} — ambiguous`,
        });
        continue;
      }
      confidence = 'fuzzy-name-room-disambiguated';
    }

    if (!resident) {
      unmatchedFloorPlan.push({
        unitNumber: row.unitNumber,
        assignedTo,
        defaultMedCart: row.defaultMedCart,
        reason: 'No ALIS resident name matched',
      });
      continue;
    }

    matchedResidentIds.add(resident.residentId);
    matched.push({
      unitNumber: row.unitNumber,
      assignedTo,
      defaultMedCart: (row.defaultMedCart || '').trim(),
      residentId: resident.residentId,
      residentName: residentDisplayName(resident),
      alisRoom: resident.rooms || null,
      matchConfidence: confidence,
      roomMismatch: !roomMatches(resident.rooms, unitKey),
    });
  }

  const missingFromFloorPlan = residents.filter((r) => !matchedResidentIds.has(r.residentId));

  return { matched, unmatchedFloorPlan, missingFromFloorPlan };
}

/**
 * Groups order-administration rows by (cart, shift) for every matched
 * resident. Status strings aren't enumerated in ALIS's own API docs, so
 * counts are kept as a dynamic breakdown rather than guessing fixed category
 * names (e.g. assuming "Missed" is the literal string ALIS uses).
 */
function buildCartShiftSummary(matched, orderRows) {
  const byResidentId = new Map(matched.map((m) => [m.residentId, m]));
  const buckets = new Map();
  const detail = [];

  for (const row of orderRows) {
    const m = byResidentId.get(row.residentId);
    if (!m) continue;

    const cart = m.defaultMedCart || '(No Cart Assigned)';
    const shift = row.byShift || '(Unspecified Shift)';
    const key = `${cart}||${shift}`;
    if (!buckets.has(key)) buckets.set(key, { cart, shift, residentIds: new Set(), statusCounts: {}, exceptions: 0, total: 0 });
    const b = buckets.get(key);
    b.residentIds.add(m.residentId);
    b.total++;
    const status = row.status || '(No Status)';
    b.statusCounts[status] = (b.statusCounts[status] || 0) + 1;
    if (row.exceptionReason) b.exceptions++;

    detail.push({
      cart,
      shift,
      unitNumber: m.unitNumber,
      residentName: m.residentName,
      orderName: row.orderName,
      orderType: row.orderType,
      status: row.status,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      exceptionReason: row.exceptionReason,
      recorderName: row.recorderName,
    });
  }

  const summary = [...buckets.values()]
    .map((b) => ({
      cart: b.cart,
      shift: b.shift,
      residents: b.residentIds.size,
      totalOrders: b.total,
      exceptions: b.exceptions,
      statusBreakdown: Object.entries(b.statusCounts)
        .sort((a, bb) => bb[1] - a[1])
        .map(([status, count]) => `${status}: ${count}`)
        .join(', '),
    }))
    .sort((a, b) => a.cart.localeCompare(b.cart) || compareShifts(a.shift, b.shift));

  detail.sort((a, b) => a.cart.localeCompare(b.cart) || compareShifts(a.shift, b.shift) || a.residentName.localeCompare(b.residentName));

  return { summary, detail };
}

/**
 * Full pull + match + aggregate for one community.
 * @param {string} companyHost
 * @param {{communityId?: string, communityName?: string}} communityRef
 * @param {Array<{unitNumber, assignedTo, defaultMedCart}>} floorPlanRows
 * @param {{startDate: string, endDate: string}} period
 */
async function buildMedCartReport(companyHost, communityRef, floorPlanRows, { startDate, endDate }) {
  const communities = asArray(await getCommunities(companyHost));
  const community = resolveCommunity(communities, communityRef);
  if (!community) {
    throw new Error(`No community matching "${communityRef.communityId || communityRef.name}" on host "${companyHost}"`);
  }

  const allResidents = asArray(await getResidents(companyHost));
  const residents = allResidents.filter((r) => String(r.communityId) === String(community.communityId));

  const { matched, unmatchedFloorPlan, missingFromFloorPlan } = matchFloorPlanToResidents(floorPlanRows, residents);

  const cartsAssigned = matched.filter((m) => m.defaultMedCart).length;
  const missingCart = matched.filter((m) => !m.defaultMedCart);

  const orderRows = asArray(await getOrderAdministration(companyHost, { communityId: community.communityId, startDate, endDate }));
  const { summary, detail } = buildCartShiftSummary(matched, orderRows);

  return {
    community: { communityId: community.communityId, communityName: community.communityName },
    period: { startDate, endDate },
    roster: matched,
    summary,
    detail,
    flagged: {
      unmatchedFloorPlan,
      missingCart,
      missingFromFloorPlan: missingFromFloorPlan.map((r) => ({
        residentId: r.residentId,
        residentName: residentDisplayName(r),
        alisRoom: r.rooms || null,
      })),
    },
    counts: {
      floorPlanResidents: floorPlanRows.filter((r) => (r.assignedTo || '').trim()).length,
      matchedResidents: matched.length,
      cartsAssigned,
      unmatchedFloorPlan: unmatchedFloorPlan.length,
      missingCart: missingCart.length,
      missingFromFloorPlan: missingFromFloorPlan.length,
      ordersCovered: orderRows.length,
    },
  };
}

function styleHeader(sheet) {
  sheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
}

function buildMedCartWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALIS Hub';

  const s = wb.addWorksheet('Summary');
  s.columns = [
    { header: 'Med Cart', key: 'cart', width: 22 },
    { header: 'Shift', key: 'shift', width: 12 },
    { header: 'Residents', key: 'residents', width: 11 },
    { header: 'Total Orders', key: 'totalOrders', width: 13 },
    { header: 'Exceptions', key: 'exceptions', width: 12 },
    { header: 'Status Breakdown', key: 'statusBreakdown', width: 45 },
  ];
  for (const r of report.summary) s.addRow(r);
  styleHeader(s);

  const roster = wb.addWorksheet('Resident Roster');
  roster.columns = [
    { header: 'Med Cart', key: 'defaultMedCart', width: 22 },
    { header: 'Unit', key: 'unitNumber', width: 10 },
    { header: 'Resident', key: 'residentName', width: 26 },
    { header: 'Resident ID', key: 'residentId', width: 12 },
    { header: 'ALIS Room', key: 'alisRoom', width: 12 },
    { header: 'Match Confidence', key: 'matchConfidence', width: 22 },
  ];
  for (const r of report.roster) {
    const row = roster.addRow(r);
    if (!r.defaultMedCart) row.getCell('defaultMedCart').fill = FLAG_FILL;
    if (r.roomMismatch) row.getCell('alisRoom').fill = FLAG_FILL;
  }
  styleHeader(roster);

  const d = wb.addWorksheet('Med Pass Detail');
  d.columns = [
    { header: 'Med Cart', key: 'cart', width: 22 },
    { header: 'Shift', key: 'shift', width: 10 },
    { header: 'Unit', key: 'unitNumber', width: 9 },
    { header: 'Resident', key: 'residentName', width: 26 },
    { header: 'Order Name', key: 'orderName', width: 30 },
    { header: 'Order Type', key: 'orderType', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Scheduled Date', key: 'scheduledDate', width: 16 },
    { header: 'Scheduled Time', key: 'scheduledTime', width: 16 },
    { header: 'Exception Reason', key: 'exceptionReason', width: 30 },
    { header: 'Recorded By', key: 'recorderName', width: 20 },
  ];
  for (const r of report.detail) {
    const row = d.addRow(r);
    if (r.exceptionReason) row.getCell('exceptionReason').fill = FLAG_FILL;
  }
  styleHeader(d);

  const f = wb.addWorksheet('Flagged');
  f.columns = [
    { header: 'Flag Type', key: 'flagType', width: 24 },
    { header: 'Unit', key: 'unitNumber', width: 10 },
    { header: 'Resident / Name', key: 'name', width: 28 },
    { header: 'Detail', key: 'detail', width: 60 },
  ];
  for (const row of report.flagged.unmatchedFloorPlan) {
    f.addRow({ flagType: 'Unmatched Floor Plan Resident', unitNumber: row.unitNumber, name: row.assignedTo, detail: row.reason });
  }
  for (const row of report.flagged.missingCart) {
    f.addRow({ flagType: 'No Med Cart Assigned', unitNumber: row.unitNumber, name: row.residentName, detail: 'Matched to ALIS, but Default Med Cart is blank on the floor plan — set it in ALIS\'s Floor Plan page.' });
  }
  for (const row of report.flagged.missingFromFloorPlan) {
    f.addRow({ flagType: 'Resident Not On Floor Plan', unitNumber: row.alisRoom || '', name: row.residentName, detail: `ALIS has this resident (ID ${row.residentId}) in the community but the floor plan file didn't include them — re-export the floor plan if this is unexpected.` });
  }
  f.eachRow((row, i) => { if (i > 1) row.eachCell((cell) => { cell.fill = FLAG_FILL; }); });
  styleHeader(f);

  return wb;
}

module.exports = { buildMedCartReport, buildMedCartWorkbook, matchFloorPlanToResidents, buildCartShiftSummary };
