/**
 * Viva Senior Living — year-over-year clinical/operational metrics, STAGE 1:
 * pull from the ALIS Export/Integration API into a resumable on-disk cache.
 * Stage 2 (vivaYoyReport.js) turns the cache into the Excel workbook.
 *
 * Usage: node server/automation/vivaYoyPull.js [occ] [inc] [meds] [obs] [evals]
 *        (no args = all stages; already-cached files are skipped, so re-running
 *        resumes after a crash/timeout)
 *
 * Window: 24 FULL calendar months, 2024-11 .. 2026-10 (trailing 12 = 2025-11..
 * 2026-10, prior 12 = 2024-11..2025-10). Aggregated per day as it's pulled so
 * the cache stays small (a community-month of MAR rows is ~15k rows).
 *
 * Nothing is interpolated: a failed/empty pull is recorded (errors.json /
 * zero-row markers) so the report can flag the community instead of filling in.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const {
  getCommunities, getOccupancy, getIncidentsV2, getOrderAdministration, getObservations, getEvaluations,
} = require('../services/alisApiClient');

const HOST = 'viva';
const CACHE = path.join(__dirname, 'data', 'viva-yoy', 'cache');
const FIRST_MONTH = '2024-11';
const LAST_MONTH = '2026-10';
const CONCURRENCY = 4;

const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');

function monthsBetween(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${pad(m)}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const dayStr = (v) => (v ? String(v).slice(0, 10) : null);

async function pool(items, worker, label) {
  let i = 0; let done = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      try { await worker(item); } catch (e) { logError(label, item, e); }
      done++;
      if (done % 25 === 0 || done === items.length) console.log(`[${label}] ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

const errFile = path.join(CACHE, 'errors.json');
function logError(stage, item, e) {
  let errs = []; try { errs = JSON.parse(fs.readFileSync(errFile, 'utf8')); } catch { /* none yet */ }
  errs.push({ stage, item, error: String(e.message || e).slice(0, 300), at: new Date().toISOString() });
  fs.writeFileSync(errFile, JSON.stringify(errs, null, 1));
  console.log(`[${stage}] ERROR`, JSON.stringify(item), String(e.message || e).slice(0, 160));
}

const cached = (f) => fs.existsSync(f);
const readCheckpoint = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const save = (f, o) => { ensure(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o)); };

async function main() {
  ensure(CACHE);
  const stages = process.argv.slice(2).length ? process.argv.slice(2) : ['occ', 'inc', 'meds', 'obs', 'evals'];
  const communities = await getCommunities(HOST);
  save(path.join(CACHE, 'communities.json'), communities);
  const scope = communities.filter((c) => c.status === 'active' && !/training|management/i.test(c.communityName));
  console.log(`Communities: ${communities.length} total, ${scope.length} in scope (active, excl. training/management)`);
  const months = monthsBetween(FIRST_MONTH, LAST_MONTH);

  if (stages.includes('occ')) {
    const jobs = scope.flatMap((c) => months.map((m) => ({ cid: c.communityId, m })));
    await pool(jobs, async ({ cid, m }) => {
      const f = path.join(CACHE, 'occ', `${cid}-${m}.json`);
      if (cached(f)) return;
      const rows = await getOccupancy(HOST, { communityId: cid, monthAndYear: m });
      const days = {};
      for (const r of rows) {
        if (r.dataSet !== 'Occupied' && r.dataSet !== 'Vacant') continue;
        const d = dayStr(r.date); if (!d) continue;
        const b = (days[d] = days[d] || { occ: 0, cap: 0, census: 0 });
        b.cap++;
        if (r.dataSet === 'Occupied') { b.occ++; if (r.censusOcc === 1) b.census++; }
      }
      save(f, { rows: rows.length, days });
    }, 'occ');
  }

  if (stages.includes('inc')) {
    await pool(scope, async (c) => {
      const f = path.join(CACHE, 'inc', `${c.communityId}.json`);
      if (cached(f)) return;
      const rows = await getIncidentsV2(HOST, { communityId: c.communityId, startDate: `${FIRST_MONTH}-01`, endDate: lastDayOf(LAST_MONTH) });
      save(f, rows.map((r) => ({ id: r.incidentId, date: dayStr(r.incidentDateTime), status: r.status, type: r.incidentType, typeId: r.incidentTypeId })));
    }, 'inc');
  }

  if (stages.includes('meds')) {
    const jobs = scope.flatMap((c) => months.map((m) => ({ cid: c.communityId, m })));
    await pool(jobs, async ({ cid, m }) => {
      const f = path.join(CACHE, 'meds', `${cid}-${m}.json`);
      if (cached(f)) return;
      const rows = await getOrderAdministration(HOST, { communityId: cid, startDate: `${m}-01`, endDate: lastDayOf(m) });
      const days = {};
      for (const r of rows) {
        if (r.isPrn === true || r.orderType === 'PRN' || r.status === 'prn') continue;
        const d = dayStr(r.scheduledDate); if (!d) continue;
        const b = (days[d] = days[d] || { sched: 0, exception: 0, new: 0 });
        b.sched++;
        if (r.status === 'exception') b.exception++;
        else if (r.status === 'new') b.new++;
      }
      save(f, { rows: rows.length, days });
    }, 'meds');
  }

  if (stages.includes('obs')) {
    // Account-wide, no date filter, and ordering is NOT reliably newest-first
    // (a probe saw 2020 rows mixed into the first 20k) — so page to the end
    // rather than trusting an early stop, keeping only wound/skin rows.
    const f = path.join(CACHE, 'obs.json');
    if (!cached(f)) {
      const { alisApiGet } = require('../services/alisApiClient');
      // Checkpointed every 10 pages (a 500 at page 156 once lost a 300k-row
      // pull); a page that still fails after retries is recorded in
      // `failedPages` so the report can flag the gap rather than hide it.
      const ck = path.join(CACHE, 'obs.checkpoint.json');
      const saved = readCheckpoint(ck);
      let { wound, byCommunity, types, total, failedPages } = saved || { wound: [], byCommunity: {}, types: {}, total: 0, failedPages: [] };
      for (let p = (saved?.nextPage || 1); p <= 400; p++) {
        let page = null;
        for (let attempt = 0; attempt < 4 && !page; attempt++) {
          try { page = await alisApiGet(HOST, '/v2/export/residents/observations', { pageNumber: p, pageSize: 2000 }); } catch (e) { console.log(`[obs] page ${p} attempt ${attempt + 1} failed: ${String(e.message).slice(0, 80)}`); await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); }
        }
        if (!page) { failedPages.push(p); continue; }
        const rows = page?.items || [];
        for (const r of rows) {
          total++;
          const d = dayStr(r.occurredOn);
          const b = (byCommunity[r.communityId] = byCommunity[r.communityId] || { n: 0, min: d, max: d });
          b.n++; if (d && d < b.min) b.min = d; if (d && d > b.max) b.max = d;
          types[r.observationType] = (types[r.observationType] || 0) + 1;
          if (/wound|skin/i.test(r.observationType || '')) wound.push({ id: r.observationId, cid: r.communityId, date: d, type: r.observationType });
        }
        if (p % 5 === 0) console.log(`[obs] page ${p} (${total} rows, ${wound.length} wound/skin)`);
        if (p % 10 === 0) save(ck, { wound, byCommunity, types, total, failedPages, nextPage: p + 1 });
        if (!page?.hasNextPage) { save(f, { complete: failedPages.length === 0, failedPages, total, pages: p, byCommunity, types, wound }); break; }
        if (p === 400) save(f, { complete: false, failedPages, total, pages: p, byCommunity, types, wound });
      }
    }
  }

  if (stages.includes('evals')) {
    const f = path.join(CACHE, 'evals.json');
    if (!cached(f)) {
      const rows = await getEvaluations(HOST);
      save(f, { pulledAt: new Date().toISOString(), rows: rows.map((r) => ({
        cid: r.communityId, residentId: r.residentId, residentStatus: r.residentStatus, status: r.status, reason: r.reason,
        expirationDate: dayStr(r.expirationDate), evaluationDate: dayStr(r.evaluationDate), carePlanStatus: r.carePlanStatus,
        isMostCurrent: r.isMostCurrent, isCompleted: r.isCompleted, isExpired: r.isExpired, isInProgress: r.isInProgress,
      })) });
    }
  }
  console.log('PULL DONE', stages.join(','));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
