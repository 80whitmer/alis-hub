/**
 * Exports a Weekly Wellness Scorecard snapshot to .xlsx — one sheet per
 * community plus a Portfolio rollup, columns matching Imagine Senior
 * Living's own "Weekly Wellness Report" layout so this reads as a
 * digitized version of the document a Wellness Director already fills in
 * by hand, not a redesign. Computed rows are pre-filled; manual rows
 * (skin/wound, infection control, narrative fields, etc.) are left
 * genuinely blank for them to complete, same as today — see
 * client/src/utils/wellnessRows.js for the row/category list and
 * server/services/wellnessNormalizer.js for how the computed values are
 * produced.
 */
import ExcelJS from 'exceljs';
import { resolveWellnessRow, getVisibleWellnessRows, NOT_TRACKED } from './wellnessRows';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

const COLUMNS = [
  { header: 'Category', key: 'category', width: 26 },
  { header: 'Key Indicator', key: 'indicator', width: 42 },
  { header: 'AL', key: 'al', width: 8 },
  { header: 'MC', key: 'mc', width: 8 },
  { header: 'Total', key: 'total', width: 10 },
  { header: 'Prior Week', key: 'prior', width: 12 },
  { header: 'Trend', key: 'trend', width: 8 },
  { header: 'Status', key: 'status', width: 10 },
  { header: 'Residents / Details', key: 'details', width: 30 },
  { header: 'Action / Intervention', key: 'action', width: 30 },
  { header: 'Owner', key: 'owner', width: 16 },
  { header: 'Due Date', key: 'due', width: 12 },
  { header: 'Escalated?', key: 'escalated', width: 12 },
  { header: 'Leadership Notes', key: 'notes', width: 30 },
];

function addScorecardSheet(workbook, sheetName, snapshot, communityId, hideUntracked) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = COLUMNS;
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  // Same resolve-then-filter as WellnessTable's on-screen "Hide rows with
  // no data" checkbox (WellnessScorecard.jsx) — checks the RESOLVED value,
  // not the row's static `source`, so a `source: 'rows'` row that just
  // happens to have no data for this account/week (needs more history, a
  // module not populated yet, etc.) is caught by the toggle too, not just
  // the always-manual rows (Aaron, Sep 2026: "the flexibility to hide the
  // under construction / not yet captured pieces in the report").
  for (const row of getVisibleWellnessRows(snapshot)) {
    const v = resolveWellnessRow(row, snapshot, communityId);
    if (hideUntracked && v.total === NOT_TRACKED) continue;
    // Details stays blank for every row except the four incident-based ones
    // with a real, ALIS-computed open-documentation count (not judgment,
    // unlike Status/Action/Owner/etc. below) — see wellnessNormalizer.js's
    // withOpenDocs and DocCompletionBadge in WellnessScorecard.jsx for the
    // same signal rendered on screen.
    const reporterNote = v.openDocsReporters?.length
      ? ` — reported by ${v.openDocsReporters.map((r) => `${r.name}${r.count > 1 ? ` x${r.count}` : ''}`).join(', ')}`
      : '';
    const details = row.hasDocCompletion && v.openDocsTotal > 0
      ? `${v.openDocsTotal} of ${v.total} incident report(s) missing a completed form or intervention${reporterNote}`
      : '';
    sheet.addRow({
      category: row.category,
      indicator: row.label,
      al: v.al,
      mc: v.mc,
      total: v.total,
      prior: v.prior,
      trend: v.trend,
      // Status/Action/Owner/Due/Escalated/Notes are always left blank — no
      // threshold engine exists yet to compute a Green/Yellow/Red status,
      // and the narrative fields are inherently the Wellness Director's
      // judgment, same as the original sheet.
      status: '',
      details,
      action: '',
      owner: '',
      due: '',
      escalated: '',
      notes: '',
    });
  }
}

/**
 * Occupancy as of the report's week-ending date, by product type and
 * classification — not part of the original mirrored sheet (unlike
 * addScorecardSheet above), so it gets its own sheet with its own simple
 * layout rather than forced into the fixed AL/MC/Total/Status/... columns
 * every other row uses. Portfolio breakdown first, then the same breakdown
 * per community (Aaron, Sep 2026: "add the occupancy breakdown per
 * community on the community sections") — wellnessNormalizer.js's
 * normalizeOccupancySnapshot now computes byProductType/byClassification
 * scoped to each community's own occupied count, not just the portfolio's.
 */
function addOccupancySheet(workbook, snapshot) {
  const occupancy = snapshot.rows?.occupancy;
  if (!occupancy?.hasOccupancyData) return;

  const sheet = workbook.addWorksheet('Occupancy');
  sheet.addRow(['Occupancy as of', snapshot.weekEnding]);
  sheet.addRow(['Overall', `${(occupancy.pct * 100).toFixed(1)}%`, `${occupancy.occupied} / ${occupancy.total}`]);
  sheet.addRow([]);

  const addBreakdown = (title, rows, keyField) => {
    const headerRow = sheet.addRow([title]);
    headerRow.font = { bold: true };
    sheet.addRow([keyField === 'productType' ? 'Product Type' : 'Classification', '% of Census', 'Occupied', 'Total']).font = { bold: true };
    for (const r of rows) {
      sheet.addRow([r[keyField], r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—', r.occupied, r.total]);
    }
    sheet.addRow([]);
  };

  if (occupancy.byProductType?.length > 0) addBreakdown('By Product Type', occupancy.byProductType, 'productType');
  if (occupancy.byClassification?.length > 0) addBreakdown('By Classification', occupancy.byClassification, 'classification');

  for (const c of snapshot.communities) {
    const cOcc = occupancy.byCommunity?.[String(c.communityId)];
    if (!cOcc?.total) continue;
    const sectionHeader = sheet.addRow([c.name]);
    sectionHeader.font = { bold: true, color: { argb: 'FF2F5D50' }, size: 13 };
    sheet.addRow(['Overall', `${((cOcc.occupied / cOcc.total) * 100).toFixed(1)}%`, `${cOcc.occupied} / ${cOcc.total}`]);
    sheet.addRow([]);
    if (cOcc.byProductType?.length > 0) addBreakdown('By Product Type', cOcc.byProductType, 'productType');
    if (cOcc.byClassification?.length > 0) addBreakdown('By Classification', cOcc.byClassification, 'classification');
  }

  sheet.columns.forEach((col) => { col.width = 18; });
}

/**
 * One row per community, same fields as the on-screen CommunitiesTable
 * (WellnessScorecard.jsx) — a rollup sheet meant to be sorted/filtered in
 * Excel rather than read top-to-bottom like the per-community scorecard
 * sheets below, so real numbers + autoFilter/frozen header instead of the
 * formatted strings the rest of this file uses (Aaron, Sep 2026: "add the
 * Communities table... to allow for review and sort in excel").
 */
function addCommunitiesSheet(workbook, snapshot) {
  const communityHealth = snapshot.communityHealth;
  if (!communityHealth?.length) return;

  const sheet = workbook.addWorksheet('Communities');
  sheet.columns = [
    { header: 'Community', key: 'name', width: 30 },
    { header: 'Region', key: 'region', width: 18 },
    { header: 'Health Score', key: 'score', width: 14 },
    { header: 'Band', key: 'band', width: 12 },
    { header: 'Occupancy', key: 'occupancyPct', width: 12 },
    { header: 'Census', key: 'census', width: 10 },
    { header: 'Falls', key: 'fallsTotal', width: 10 },
    { header: 'Hospital/ER', key: 'hospitalTotal', width: 12 },
    { header: 'Med Exceptions', key: 'medExceptionsTotal', width: 15 },
    { header: 'Evals Overdue', key: 'evaluationsOverdueTotal', width: 14 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const c of communityHealth) {
    sheet.addRow({
      name: c.name,
      region: c.region || '—',
      score: c.score,
      band: c.band?.label || '—',
      occupancyPct: c.occupancyPct,
      census: c.census,
      fallsTotal: c.fallsTotal,
      hospitalTotal: c.hospitalTotal,
      medExceptionsTotal: c.medExceptionsTotal,
      evaluationsOverdueTotal: c.evaluationsOverdueTotal,
    });
  }
  sheet.getColumn('occupancyPct').numFmt = '0.0%';

  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Groups communityHealth by ALIS region — same 'Unassigned' bucket for
 * communities with no region on file as wellnessHealthScoring.js's
 * computeRollup, but with the raw KPI totals that rollup's `byRegion`
 * doesn't carry (it only needs avgScore for the on-screen comparison
 * tiles), so this export table is a real roll-up, not just scores.
 */
function groupByRegion(communityHealth) {
  const map = new Map();
  for (const c of communityHealth) {
    const region = c.region || 'Unassigned';
    if (!map.has(region)) map.set(region, []);
    map.get(region).push(c);
  }
  const avg = (list, field) => {
    const vals = list.map((c) => c[field]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const sum = (list, field) => list.reduce((a, c) => a + (c[field] || 0), 0);
  return Array.from(map.entries())
    .map(([region, list]) => ({
      region,
      communityCount: list.length,
      avgScore: avg(list, 'score') != null ? Math.round(avg(list, 'score')) : null,
      avgOccupancyPct: avg(list, 'occupancyPct'),
      census: sum(list, 'census'),
      fallsTotal: sum(list, 'fallsTotal'),
      hospitalTotal: sum(list, 'hospitalTotal'),
      medExceptionsTotal: sum(list, 'medExceptionsTotal'),
      evaluationsOverdueTotal: sum(list, 'evaluationsOverdueTotal'),
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/**
 * Regional roll-up, same grouping as the on-screen RegionComparisonSection
 * but with the underlying KPI totals rolled up too (Aaron, Sep 2026: "add a
 * regional roll up for the communities") — sits next to the Communities
 * sheet since it's the same data at a coarser grain.
 */
function addRegionalRollupSheet(workbook, snapshot) {
  const communityHealth = snapshot.communityHealth;
  if (!communityHealth?.length) return;

  const sheet = workbook.addWorksheet('Regional Rollup');
  sheet.columns = [
    { header: 'Region', key: 'region', width: 20 },
    { header: 'Communities', key: 'communityCount', width: 13 },
    { header: 'Avg Health Score', key: 'avgScore', width: 16 },
    { header: 'Avg Occupancy', key: 'avgOccupancyPct', width: 14 },
    { header: 'Total Census', key: 'census', width: 13 },
    { header: 'Total Falls', key: 'fallsTotal', width: 12 },
    { header: 'Total Hospital/ER', key: 'hospitalTotal', width: 16 },
    { header: 'Total Med Exceptions', key: 'medExceptionsTotal', width: 18 },
    { header: 'Total Evals Overdue', key: 'evaluationsOverdueTotal', width: 17 },
  ];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const r of groupByRegion(communityHealth)) {
    sheet.addRow(r);
  }
  sheet.getColumn('avgOccupancyPct').numFmt = '0.0%';

  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

const AGE_BANDS = ['<60', '60s', '70s', '80s', '90s', '100+'];

/**
 * Average resident age + decade-band counts, portfolio-wide and per
 * community (Aaron, Sep 2026) — same "own sheet, not forced into the fixed
 * scorecard columns" treatment as addOccupancySheet above, but per-scope
 * rather than portfolio-only since normalizeResidentAge computes both.
 */
function addResidentAgeSheet(workbook, snapshot) {
  const ageData = snapshot.residentAge;
  if (!ageData || ageData.portfolio.countedForAge === 0) return;

  const sheet = workbook.addWorksheet('Resident Age');
  const headerRow = sheet.addRow(['Scope', 'Avg Age', 'Residents w/ Age on File', 'Total Residents', ...AGE_BANDS]);
  headerRow.font = { bold: true };

  const addScopeRow = (label, data) => {
    sheet.addRow([label, data.avgAge != null ? Number(data.avgAge.toFixed(1)) : '—', data.countedForAge, data.totalResidents, ...AGE_BANDS.map((b) => data.bandCounts[b])]);
  };
  addScopeRow('Portfolio', ageData.portfolio);
  for (const c of snapshot.communities) {
    const data = ageData.byCommunity?.[String(c.communityId)];
    if (data) addScopeRow(c.name, data);
  }

  sheet.columns.forEach((col) => { col.width = 16; });
  sheet.getColumn(1).width = 26;
}

/**
 * Upcoming Birthdays & Milestones, folded into the main workbook (Aaron,
 * Sep 2026: "make sure that the milestone tags flow through to the...
 * excel exports") — this report previously had no birthdays coverage at
 * all (only the section's own standalone export, upcomingBirthdaysExport.js,
 * did); same Resident/Staff sheet split and "Decade Milestone" tag column
 * as that export, so the tag survives here too. Portfolio-wide, same
 * source (snapshot.upcomingBirthdays) as the on-screen panel and PDF.
 */
function addBirthdaysSheets(workbook, snapshot) {
  const data = snapshot.upcomingBirthdays;
  const residents = data?.residents || [];
  const staff = data?.staff || [];
  if (residents.length === 0 && staff.length === 0) return;

  const communityName = (communityId) => {
    if (communityId == null) return '';
    return snapshot.communities?.find((c) => String(c.communityId) === String(communityId))?.name || '';
  };

  if (residents.length > 0) {
    const sheet = workbook.addWorksheet('Birthdays - Residents');
    sheet.columns = [
      { header: 'Resident', key: 'name', width: 28 },
      { header: 'Community', key: 'community', width: 26 },
      { header: 'Product Type', key: 'productType', width: 14 },
      { header: 'Turning', key: 'turningAge', width: 10 },
      { header: 'Decade Milestone', key: 'milestone', width: 16 },
      { header: 'Birthday', key: 'birthdayDate', width: 14 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
    for (const r of residents) {
      sheet.addRow({
        name: r.name || '',
        community: communityName(r.communityId),
        productType: r.productType || '',
        turningAge: r.turningAge,
        milestone: r.isDecadeMilestone ? `Turning ${r.turningAge}` : '',
        birthdayDate: r.birthdayDate || '',
      });
    }
  }

  if (staff.length > 0) {
    const sheet = workbook.addWorksheet('Birthdays - Staff');
    sheet.columns = [
      { header: 'Staff', key: 'name', width: 28 },
      { header: 'Community', key: 'community', width: 26 },
      { header: 'Job Role', key: 'jobRole', width: 24 },
      { header: 'Birthday', key: 'birthdayDate', width: 14 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });
    for (const s of staff) {
      sheet.addRow({
        name: s.name || '',
        community: communityName(s.communityId),
        jobRole: s.jobRole || '',
        birthdayDate: s.birthdayDate || '',
      });
    }
  }
}

export async function exportWellnessScorecard(snapshot, hideUntracked = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'alis-hub';
  workbook.created = new Date();

  addCommunitiesSheet(workbook, snapshot);
  addRegionalRollupSheet(workbook, snapshot);
  addBirthdaysSheets(workbook, snapshot);
  addResidentAgeSheet(workbook, snapshot);
  addOccupancySheet(workbook, snapshot);
  addScorecardSheet(workbook, 'Portfolio', snapshot, null, hideUntracked);
  for (const c of snapshot.communities) {
    // Sheet names can't exceed 31 chars or contain :\/?*[] — trim and strip.
    const safeName = c.name.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
    addScorecardSheet(workbook, safeName, snapshot, String(c.communityId), hideUntracked);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(snapshot.companyName || 'Wellness-Scorecard').replace(/[^a-z0-9.\-]/gi, '_')}-${snapshot.weekEnding}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
