const fs = require('fs');
const path = require('path');
const {
  monthRange, monthLabel, pullSharedAcuityData, resolveCommunity, pullAcuityData, buildAcuityReport, buildAcuityWorkbook,
} = require('../services/acuityHistory');
const { setJobStatus, setItemStatus, syncJobItems, getJob } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * Finished workbooks + a summary.json manifest live on disk per job, not in
 * the DB — they hold resident-level data (names, care levels, fees) and
 * sql.js rewrites the whole DB file on every write (see database.js), so
 * bulky output belongs in files. Gitignored for the same reason as kpi-cache/.
 */
const REPORTS_ROOT = path.join(__dirname, 'acuity-reports');

const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];

/** Same reasoning/contract as kpiExport.js's identical helper. */
function isCancelled(jobId) {
  return getJob(jobId)?.status === 'failed';
}

function safeFilename(s) {
  return s.replace(/[^a-z0-9 .\-()]/gi, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Run the resident-acuity-history job: one account-wide pull (communities,
 * evaluations, current residents), then per community a month-by-month
 * unit-occupancy pull → one .xlsx each.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runAcuityHistoryJob(jobId, payload) {
  const { companyName, companyHost, communities = [] } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);
  const monthCount = Math.min(Math.max(Math.round(Number(payload.months) || 12), 1), 36);
  // Local date, not UTC — the current month is capped at "today" as the
  // person running this sees it.
  const asOfDate = new Date().toLocaleDateString('en-CA');
  const endMonth = /^\d{4}-\d{2}$/.test(payload.endMonth || '') ? payload.endMonth : asOfDate.slice(0, 7);
  const months = monthRange(endMonth, monthCount);
  // A past end month is fully closed — only cap at today when the range reaches the current month.
  const cap = endMonth < asOfDate.slice(0, 7) ? `${endMonth}-31` : asOfDate;
  // Optional override for which billing items count as care (comma or newline separated, exact names).
  const careItemNames = String(payload.careItemNames || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

  setJobStatus(jobId, 'running');

  if (!companyHost) {
    const error = 'ALIS Company Host is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  let shared;
  try {
    shared = await pullSharedAcuityData(companyHost, { months, onProgress: (message) => emit('progress', { message }) });
  } catch (err) {
    console.error(`[acuity-history:${jobId}] Shared pull failed:`, err);
    setJobStatus(jobId, 'failed', err.message);
    emit('job_error', { error: err.message });
    return;
  }

  // No communities specified → every community on the host, minus Training
  // (by name) and canceled/suspended (by status) — same convention as
  // kpiExport.js's auto-resolve.
  let requested = communities.filter((c) => String(c.communityId || '').trim() || (c.name || '').trim());
  if (requested.length === 0) {
    requested = shared.communities
      .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
      .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
      .map((c) => ({ name: c.communityName, communityId: String(c.communityId) }));
    emit('progress', { message: `No communities specified — auto-resolved ${requested.length} of ${shared.communities.length} communities on "${companyHost}" (excluded Training and canceled/suspended).` });
    if (requested.length === 0) {
      const error = `No eligible communities found on host "${companyHost}".`;
      setJobStatus(jobId, 'failed', error);
      emit('job_error', { error });
      return;
    }
  }

  const itemNames = requested.map((c) => c.name?.trim() || `Community ${c.communityId}`);
  syncJobItems(jobId, itemNames);
  emit('job_start', { jobId, total: requested.length, company: companyName });

  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];

  for (let i = 0; i < requested.length; i++) {
    if (isCancelled(jobId)) break;
    const name = itemNames[i];
    setItemStatus(jobId, name, 'running');
    emit('item_start', { name });

    try {
      const community = resolveCommunity(shared.communities, requested[i]);
      if (!community) throw new Error(`No community matching "${requested[i].communityId || requested[i].name}" on host ${companyHost}`);

      const raw = await pullAcuityData(companyHost, community.communityId, months, {
        shared,
        onProgress: (message) => emit('progress', { message: `${community.communityName}: ${message}` }),
      });
      const report = buildAcuityReport(raw, { months, asOfDate: cap, currentMonth: asOfDate.slice(0, 7), careItemNames });
      const filename = safeFilename(`${community.communityName} - Resident Acuity by Month (${monthLabel(months[0])} - ${monthLabel(months[months.length - 1])}).xlsx`);
      await buildAcuityWorkbook(report).xlsx.writeFile(path.join(outDir, filename));

      const latest = report.summary[report.summary.length - 1];
      files.push({
        communityId: community.communityId,
        communityName: community.communityName,
        filename,
        residentMonths: report.detail.length,
        latestMonth: latest?.month ?? null,
        latestResidents: latest?.residents ?? 0,
        latestTotalFees: latest?.totalFees ?? 0,
        firstEvaluationDate: report.firstEvaluationDate,
        monthsWithNoData: report.monthsWithNoData,
        hasBilling: report.hasBilling,
        latestInvoicedCare: latest?.invoicedCare ?? null,
        latestVariance: latest?.variance ?? null,
        latestResidentsWithVariance: latest?.residentsWithVariance ?? null,
        careItemsCounted: report.billingItems.filter((b) => b.counted).map((b) => b.itemName),
      });
      setItemStatus(jobId, name, 'success');
      emit('item_done', { name });
    } catch (err) {
      console.error(`[acuity-history:${jobId}] "${name}" failed:`, err);
      files.push({ communityName: name, error: err.message });
      setItemStatus(jobId, name, 'failed', err.message);
      emit('item_fail', { name, error: err.message });
    }
  }

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    companyName, companyHost, months, asOfDate: cap, generatedAt: new Date().toISOString(), files,
  }, null, 2));

  if (files.every((f) => f.error)) {
    const error = `No reports generated: ${files.map((f) => `${f.communityName}: ${f.error}`).join('; ')}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runAcuityHistoryJob, REPORTS_ROOT };
