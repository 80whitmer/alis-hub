/**
 * Builds the alert-subscriptions `assignments` payload from two uploads:
 *  1. The ALIS "Communities" export (.xlsx): DB ID | Community Name | ... | Region.
 *     Region = the regional director for that community. This is the authority for
 *     which communities each regional director gets (the mapping workbook's own
 *     director counts have disagreed with it).
 *  2. The mapping workbook (.xlsx): any row containing an "ALL" cell names a
 *     company admin who gets every community.
 *
 * Communities with no Region (Training Community) and anything in `excluded` are
 * never assigned. DB ID is the ALIS facility ID the job drives the picker with.
 */
import ExcelJS from 'exceljs';

async function loadWorkbook(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new Error(`"${file.name}" is an old-format .xls file. Open it in Excel and Save As .xlsx, then upload that.`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join('') : '') ?? '').trim();
  return String(v).trim();
};

/** -> [{ id, name, region }] from the ALIS Communities export. */
export async function parseCommunityExport(file) {
  const wb = await loadWorkbook(file);
  const ws = wb.worksheets[0];
  let cols = null;
  const out = [];
  ws.eachRow((row) => {
    const vals = row.values.slice(1).map(cellText);
    if (!cols) {
      const idI = vals.findIndex((v) => /^db id$/i.test(v));
      const nameI = vals.findIndex((v) => /^community name$/i.test(v));
      const regI = vals.findIndex((v) => /^region$/i.test(v));
      if (idI >= 0 && nameI >= 0) cols = { idI, nameI, regI };
      return;
    }
    const id = Number(vals[cols.idI]);
    if (!id || !vals[cols.nameI]) return;
    out.push({ id, name: vals[cols.nameI], region: cols.regI >= 0 ? vals[cols.regI] : '' });
  });
  if (!cols) throw new Error('Could not find the "DB ID" / "Community Name" header row in the community export.');
  if (cols.regI < 0) throw new Error('The community export has no "Region" column — export it with Region included.');
  return out;
}

/** -> { allNames: string[], allText: Set<lowercase cell text> } from the mapping workbook. */
export async function parseMappingWorkbook(file) {
  const wb = await loadWorkbook(file);
  const allNames = [];
  const allText = new Set();
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      const vals = row.values.slice(1).map(cellText).filter(Boolean);
      vals.forEach((v) => allText.add(v.toLowerCase()));
      if (vals.some((v) => v.toUpperCase() === 'ALL')) {
        const who = vals.filter((v) => v.toUpperCase() !== 'ALL' && /\s/.test(v)).pop();
        if (who && !allNames.some((n) => n.toLowerCase() === who.toLowerCase())) allNames.push(who);
      }
    });
  });
  return { allNames, allText };
}

/** Combine both uploads into assignments + a human preview with warnings. */
export function buildAssignments({ communities, mapping, excluded = [] }) {
  const exclude = new Set(excluded.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const eligible = communities.filter((c) => c.region && !exclude.has(c.name.toLowerCase()));
  const skipped = communities.filter((c) => !c.region || exclude.has(c.name.toLowerCase()));

  const warnings = [];
  const allNames = mapping?.allNames || [];
  const allSet = new Set(allNames.map((n) => n.toLowerCase()));
  const byDirector = new Map();
  for (const c of eligible) {
    if (allSet.has(c.region.toLowerCase())) continue;
    if (!byDirector.has(c.region)) byDirector.set(c.region, []);
    byDirector.get(c.region).push({ id: c.id, name: c.name });
  }

  const everyCommunity = eligible.map((c) => ({ id: c.id, name: c.name }));
  const assignments = [
    ...[...byDirector.entries()].map(([name, list]) => ({ name, communities: list, kind: 'Regional' })),
    ...allNames.map((name) => ({ name, communities: everyCommunity, kind: 'ALL' })),
  ];

  if (mapping?.allText) {
    for (const d of byDirector.keys()) {
      if (!mapping.allText.has(d.toLowerCase())) warnings.push(`Region "${d}" in the ALIS export is not mentioned anywhere in the mapping workbook.`);
    }
  }
  if (!allNames.length && mapping) warnings.push('No "ALL" rows found in the mapping workbook — only regional directors will be assigned.');
  return { assignments, skipped, warnings };
}
