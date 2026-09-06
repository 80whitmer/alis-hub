const fs = require('fs');
const path = require('path');

const {
  getOccupancy, getCommunities, getStaff, getResidents, getMoveInsAndOuts, getHistoricalMoveInMoveOuts, getIncidents,
  getLeaves, getDiagnosesAndAllergies, getEvaluations, getRecurringCharges, getInvoiceCharges, getOutstandingInvoices, getScheduledCareTasks,
  getOrderAdministration,
} = require('../services/alisApiClient');
const {
  normalizeOccupancy, normalizeDemographics, normalizeLengthOfStayAndMoveOuts,
  normalizeAdmissionsDischarges, normalizeCareLevelEvaluations, normalizeRecurringRevenue, normalizeInvoiceCharges, normalizeOutstandingInvoices,
  normalizeDso, normalizePpd,
  normalizeFalls, normalizeIncidentCompletion, normalizeSentinelIncidents, normalizeHospitalVisits, normalizeDiagnoses, normalizeCareCompletion,
  normalizeStaffActivity, normalizePrnAdministration, estimateResidentDays, computeBenchmarkDiffs,
  filterByDateRange,
} = require('../services/kpiNormalizer');
const { shouldTrackSentinelIncidents } = require('../services/companyFeatures');

/**
 * 'YYYY-MM-01' for each calendar month between two ISO dates, inclusive.
 *
 * Builds the cursor entirely in UTC (Date.UTC / getUTC*) rather than mixing
 * a UTC-parsed `new Date('2026-04-01')` with local-timezone getters — on
 * any host west of UTC, `.getMonth()` on that value reads back March, not
 * April, silently pulling one extra month of occupancy data before the
 * real period start on every single job.
 */
function monthsInRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** 'YYYY-MM-DD' for each calendar day between two ISO dates, inclusive. Same UTC-safety note as monthsInRange above. */
function daysInRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const days = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * For a given 'YYYY-MM-01' month start, returns the [start, end] ISO date
 * range for that calendar month clipped to periodStart/periodEnd — used by
 * invoiceCharges, which caps its own date-range query at 1 month per call
 * (confirmed against the live v2 spec), so a multi-month period needs one
 * call per month with boundary months clipped to the real period.
 */
function clipMonthToPeriod(monthStartIso, periodStart, periodEnd) {
  const monthStart = new Date(monthStartIso);
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const lastDayOfMonth = new Date(nextMonthStart.getTime() - 86400000).toISOString().slice(0, 10);
  // ISO 'YYYY-MM-DD' strings compare lexicographically the same as
  // chronologically, so plain string comparison is safe here.
  const rangeStart = monthStartIso > periodStart ? monthStartIso : periodStart;
  const rangeEnd = lastDayOfMonth < periodEnd ? lastDayOfMonth : periodEnd;
  return { rangeStart, rangeEnd };
}

const CARE_TASK_BATCH_SIZE = 8;

// Disabled for now: scheduledCareTasks has no date-range param, so this is
// a day-by-day loop with no scalable ceiling (91 days × N communities for
// a quarter — thousands of calls for a multi-community account). Revisit
// once care completion is sourced from an ALIS HQ Dashboard report upload
// instead of the raw API. See feature/kpi-qbr-pipeline commit history.
const CARE_COMPLETION_ENABLED = false;

// Per-community pulls (occupancy + order administration) used to run one
// community at a time — a real account with dozens of communities took
// 2+ hours (observed live: 46 communities × ~170s average = ~130 minutes,
// entirely from sequential `await`s with no overlap). ALIS's own docs only
// document a concurrency cap for one specific streaming endpoint
// (invoiceCharges: "1 active stream per user, up to 5 queued") — occupancy
// and orderAdministration aren't documented either way, so this is a
// deliberately conservative number, not a measured safe ceiling. Raise it
// if a real run shows no 429s/errors at this level.
const COMMUNITY_CONCURRENCY = 4;

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Order of
 * completion doesn't matter to any caller here — each community pushes to
 * shared arrays and updates its own job_item independently.
 *
 * `fn` here always catches its own errors internally (see the per-community
 * try/catch below — this is the same "one bad community shouldn't take down
 * the job" contract the original sequential loop already had). The extra
 * try/catch below is defense in depth, not the primary safety net: without
 * it, one escaped rejection would reject this whole Promise.all and abort
 * every other community still mid-flight in other workers, silently losing
 * their progress — worse than the original sequential loop, not just as
 * bad.
 */
async function mapWithConcurrency(items, limit, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch (err) {
        console.error('[kpi-export] mapWithConcurrency: fn should never throw (errors should be caught internally) — item may be incomplete:', err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);

/**
 * residents/moveInsAndOuts/incidents/leaves/diagnosesAndAllergies are
 * account-wide (no communityId query param exists for them) — without this
 * filter, a job scoped to one community would silently report numbers for
 * the whole account.
 *
 * Keyed by "host::communityId" rather than bare communityId — a couple of
 * accounts run two separate ALIS hosts (e.g. after a portfolio merge), and
 * community IDs are only unique *within* a host. Filtering on the bare ID
 * risks a host-B community accidentally matching a same-numbered host-A ID.
 * Every row must already carry a `_host` tag (see pullAccountWide below).
 */
function filterByCommunity(rows, communityKeys) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((r) => communityKeys.has(`${r._host}::${r.communityId}`));
}
const { getLatestBenchmarks } = require('../services/alis500Benchmarks');
const { getTicketSummaryForCompany, getDealSummaryForCompany, enrichRepeatIssueFlags, enrichDealUrls, enrichOpenTickets } = require('../services/hubspotTickets');
const { generateFlags } = require('../services/qbrFlags');
const { setJobStatus, setItemStatus, addKpiSnapshot, addDsoSnapshots, addPpdSnapshots, syncJobItems, upsertCompanyHost, getCompanyHost } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

const CACHE_ROOT = path.join(__dirname, 'kpi-cache');

/**
 * Local-dev debug convenience only (dumps a raw API pull to disk for
 * inspection) — must never be able to take down the actual job. A 48+
 * community enterprise account's occupancy pull (one row per room per day,
 * across every community) is large enough that JSON.stringify throws
 * "RangeError: Invalid string length" past V8's max string size — confirmed
 * live against Leisure Care (48 communities), where this crashed the whole
 * report after all the real work (every API pull, every normalizer) had
 * already succeeded. Compact (no pretty-print) to buy real headroom before
 * hitting that ceiling again on an even bigger account, but the try/catch
 * is the actual fix — caching is diagnostic, not part of the report itself.
 */
function cacheRaw(jobId, name, data) {
  try {
    const dir = path.join(CACHE_ROOT, jobId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));
  } catch (err) {
    console.error(`[kpi-export:${jobId}] cacheRaw("${name}") failed — continuing without the debug cache for this pull:`, err.message);
  }
}

/** Splits the (possibly comma-separated) companyHost field into a clean list of subdomains. */
function parseHosts(companyHost) {
  return String(companyHost || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Run the kpi-export job: pull ALIS export-API data for an account's
 * communities, normalize it, diff against the latest ALIS 500 benchmark,
 * pull HubSpot ticket history if a company is linked, and generate
 * rule-based discussion-point flags. Writes one compact snapshot row to
 * `kpi_snapshots`; raw API payloads are cached to disk (see kpi-cache/)
 * rather than the DB — see plan doc for why (sql.js rewrites the whole
 * file on every write).
 *
 * Supports accounts split across more than one ALIS host (companyHost as a
 * comma-separated list, e.g. "viva, viva-secondary") — data from every host
 * is pulled and merged into a single combined snapshot, since that's what a
 * QBR needs to show regardless of how many separate ALIS accounts the
 * client's communities happen to live under.
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runKpiExportJob(jobId, payload) {
  const { companyName, periodStart, periodEnd, hubspotCompanyId, pendingHealthImport, pendingReleaseImport } = payload;
  const hosts = parseHosts(payload.companyHost);
  const multiHost = hosts.length > 1;
  const emit = (event, data) => broadcast(jobId, event, data);
  // Host/endpoint pull failures below only reach the user as ephemeral SSE
  // `progress` events during the live run — once the job finishes and the
  // QBR page is reopened later, that log is gone. Collecting the same
  // messages here and persisting them onto the snapshot (see `summary`
  // below) is what lets the QBR page show "this report is missing data
  // from host X" instead of silently presenting partial data as complete.
  const dataWarnings = [];

  setJobStatus(jobId, 'running');

  if (!periodStart || !periodEnd) {
    const error = 'Period Start and Period End are both required — fill those fields in before running the job.';
    setJobStatus(jobId, 'failed', error);
    console.error(`[kpi-export:${jobId}] ${error}`);
    emit('job_error', { error });
    return;
  }

  if (hosts.length === 0) {
    const error = 'ALIS Company Host is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    console.error(`[kpi-export:${jobId}] ${error}`);
    emit('job_error', { error });
    return;
  }

  // No communities specified → pull every community across every host for
  // this account, minus Training communities (by name) and canceled/
  // suspended ones (by status). Only "canceled" and "active" have been seen
  // in real data so far — "suspended" isn't confirmed yet, matched
  // defensively in case a different account uses it.
  const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];
  let communities = payload.communities;
  if (communities && communities.length > 0) {
    // Manually-specified communities may omit `host` for single-host jobs
    // (the common case) — default to the first configured host.
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));
    // Manually-typed communities don't carry `region` (the form only asks
    // for name + ID) — pull the full community list per host once (cheap,
    // account-wide, same call the auto-resolve branch below already makes)
    // and join region by communityId, so region-rollup KPIs (DSO) work
    // regardless of which path a job took to get its community list.
    const regionByHostAndCommunity = new Map();
    for (const host of new Set(communities.map((c) => c.host))) {
      try {
        const all = await getCommunities(host);
        for (const c of all) regionByHostAndCommunity.set(`${host}::${c.communityId}`, c.region || null);
      } catch (err) {
        console.error(`[kpi-export:${jobId}] Failed to look up regions for host "${host}" (manually-specified communities will show no region):`, err);
      }
    }
    communities = communities.map((c) => ({ ...c, region: regionByHostAndCommunity.get(`${c.host}::${c.communityId}`) ?? null }));
  } else {
    emit('progress', { message: `No communities specified — pulling the full community list for ${hosts.length > 1 ? `${hosts.length} hosts (${hosts.join(', ')})` : `host "${hosts[0]}"`}…` });
    communities = [];
    const hostErrors = [];
    for (const host of hosts) {
      try {
        const all = await getCommunities(host);
        const resolved = all
          .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
          .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host, region: c.region || null }));
        communities.push(...resolved);
        emit('progress', { message: `Auto-resolved ${resolved.length} of ${all.length} communities from host "${host}" (excluded Training and canceled/suspended communities).` });
      } catch (err) {
        hostErrors.push(`${host}: ${err.message}`);
        console.error(`[kpi-export:${jobId}] Failed to auto-resolve communities for host "${host}":`, err);
      }
    }
    if (communities.length === 0) {
      const error = `Failed to auto-resolve any communities across host(s) ${hosts.join(', ')}: ${hostErrors.join('; ')}`;
      setJobStatus(jobId, 'failed', error);
      emit('job_error', { error });
      return;
    }
    if (hostErrors.length > 0) {
      const msg = `${hostErrors.length} of ${hosts.length} host(s) failed to auto-resolve and were skipped: ${hostErrors.join('; ')}`;
      emit('progress', { message: msg });
      dataWarnings.push(msg);
    }
    // The job record was created with communities: [] before this
    // resolved — backfill job_items now, or setItemStatus's UPDATE-by-name
    // silently matches nothing and per-community tracking never works.
    // Tracked by "name [host]" (not bare name) whenever more than one host
    // is in play, so two hosts with an identically-named community don't
    // collide on the same job_items row.
    syncJobItems(jobId, communities.map((c) => (multiHost ? `${c.name} [${c.host}]` : c.name)));
  }

  emit('job_start', { jobId, total: communities.length, company: companyName });

  const missingId = communities.find((c) => !c.communityId);
  if (missingId) {
    const error = `Community "${missingId.name}" is missing an ALIS Community ID — fill that field in before running the job.`;
    setJobStatus(jobId, 'failed', error);
    console.error(`[kpi-export:${jobId}] ${error}`);
    emit('job_error', { error });
    return;
  }

  // ── Account-wide pulls (one call each per host, not per-community) ─────
  // Promise.allSettled (not Promise.all) so one endpoint 401ing doesn't hide
  // whether the others also failed — Promise.all would short-circuit on the
  // first rejection and silently drop the rest. Run per host so one bad
  // host doesn't take down data pulled successfully from a working one.
  const ACCOUNT_WIDE_ENDPOINTS = [
    { key: 'residents', fn: (host) => getResidents(host) },
    // getMoveInsAndOuts has intermittently returned a bare "Unknown error"
    // 500 on some accounts, with no query params to narrow the request and
    // work around it. historicalMoveInMoveOuts returns the same shape (see
    // ALIS_EXPORT_API_REFERENCE.md) and was sitting unused in
    // alisApiClient.js — falling back to it here costs nothing on the
    // common case (primary succeeds) and gives a real shot at recovering
    // the data on the failure case, instead of just losing it.
    {
      key: 'moveInsAndOuts',
      fn: async (host) => {
        try {
          return await getMoveInsAndOuts(host);
        } catch (err) {
          console.error(`[kpi-export] moveInsAndOuts failed for host "${host}", falling back to historicalMoveInMoveOuts:`, err.message);
          return await getHistoricalMoveInMoveOuts(host);
        }
      },
    },
    { key: 'incidents', fn: (host) => getIncidents(host) },
    { key: 'leaves', fn: (host) => getLeaves(host) },
    { key: 'diagnosesAndAllergies', fn: (host) => getDiagnosesAndAllergies(host) },
    { key: 'staff', fn: (host) => getStaff(host) },
    { key: 'evaluations', fn: (host) => getEvaluations(host) },
  ];

  emit('progress', { message: `Pulling resident roster, move-ins/outs, incidents, leaves, diagnoses, staff, and evaluations from ${hosts.length} host(s)…` });

  const pulled = { residents: [], moveInsAndOuts: [], incidents: [], leaves: [], diagnosesAndAllergies: [], staff: [], evaluations: [] };
  const endpointErrors = [];
  const hostWorked = {}; // host -> did at least one account-wide endpoint succeed for it

  for (const host of hosts) {
    const settled = await Promise.allSettled(ACCOUNT_WIDE_ENDPOINTS.map((e) => e.fn(host)));
    hostWorked[host] = false;
    settled.forEach((result, i) => {
      const { key } = ACCOUNT_WIDE_ENDPOINTS[i];
      if (result.status === 'fulfilled') {
        hostWorked[host] = true;
        const rows = asArray(result.value).map((r) => ({ ...r, _host: host }));
        pulled[key].push(...rows);
        cacheRaw(jobId, multiHost ? `${key}_${host}` : key, result.value);
      } else {
        endpointErrors.push(`${key}@${host}: ${result.reason.message}`);
        console.error(`[kpi-export:${jobId}] "${key}" pull failed for host "${host}":`, result.reason);
      }
    });
  }

  const totalEndpointAttempts = hosts.length * ACCOUNT_WIDE_ENDPOINTS.length;
  if (endpointErrors.length === totalEndpointAttempts) {
    const error = `All account-wide ALIS API pulls failed across every host: ${endpointErrors.join('; ')}`;
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  // Remember whichever hosts just proved they work — merged with any
  // hosts already on file, never replacing them, so a host that happens to
  // be down for this one run doesn't get silently dropped from a
  // previously-working multi-host mapping.
  const workingHosts = hosts.filter((h) => hostWorked[h]);
  if (workingHosts.length > 0) {
    const existing = getCompanyHost({ companyName, hubspotCompanyId });
    const existingHosts = existing ? parseHosts(existing.company_host) : [];
    const mergedHosts = Array.from(new Set([...existingHosts, ...workingHosts]));
    upsertCompanyHost({ companyName, hubspotCompanyId, companyHost: mergedHosts.join(',') });
  }

  if (endpointErrors.length > 0) {
    const msg = `${endpointErrors.length} of ${totalEndpointAttempts} account-wide pulls failed and will be treated as empty: ${endpointErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  const { residents, moveInsAndOuts, incidents, leaves, diagnosesAndAllergies, staff, evaluations } = pulled;

  // hqOccupancies takes a single `monthAndYear`, not a range, so a
  // multi-month period needs one call per calendar month — also needed
  // below for invoiceCharges, which caps its date range at 1 month per call.
  const months = monthsInRange(periodStart, periodEnd);

  // ── Recurring charges (billing) — separate from the account-wide loop
  // above since this is the one export endpoint that actually supports
  // server-side date filtering, so it's scoped directly to the reporting
  // period instead of pulling full history and filtering client-side.
  emit('progress', { message: 'Pulling recurring billing charges…' });
  const recurringCharges = [];
  const chargeErrors = [];
  for (const host of hosts) {
    try {
      const rows = await getRecurringCharges(host, { residentStatus: 'CurrentResident', chargeStatus: 'Active', serviceStartDate: periodStart, serviceEndDate: periodEnd });
      const tagged = asArray(rows).map((r) => ({ ...r, _host: host }));
      recurringCharges.push(...tagged);
      cacheRaw(jobId, multiHost ? `recurringCharges_${host}` : 'recurringCharges', rows);
    } catch (err) {
      chargeErrors.push(`${host}: ${err.message}`);
      console.error(`[kpi-export:${jobId}] "recurringCharges" pull failed for host "${host}":`, err);
    }
  }
  if (chargeErrors.length > 0) {
    const msg = `Recurring charges pull failed for ${chargeErrors.length} of ${hosts.length} host(s) — revenue figures will be partial: ${chargeErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  // ── Invoice charges (actual billed revenue) — real invoiceStartDate/
  // invoiceEndDate scoping, unlike recurringCharges above. The preferred
  // revenue figure over the active-schedule run-rate. v2's invoiceCharges
  // caps the date range at 1 month per call (confirmed against the live
  // spec), so this loops one call per calendar month in the period —
  // unlike recurringCharges/outstandingInvoices, which accept the full
  // period or need no date range at all.
  emit('progress', { message: 'Pulling billed invoice charges…' });
  const invoiceCharges = [];
  const invoiceChargeErrors = [];
  for (const host of hosts) {
    for (const monthStartIso of months) {
      const { rangeStart, rangeEnd } = clipMonthToPeriod(monthStartIso, periodStart, periodEnd);
      try {
        const rows = await getInvoiceCharges(host, { invoiceStartDate: rangeStart, invoiceEndDate: rangeEnd });
        const tagged = asArray(rows).map((r) => ({ ...r, _host: host }));
        invoiceCharges.push(...tagged);
        cacheRaw(jobId, multiHost ? `invoiceCharges_${host}_${monthStartIso.slice(0, 7)}` : `invoiceCharges_${monthStartIso.slice(0, 7)}`, rows);
      } catch (err) {
        invoiceChargeErrors.push(`${host}/${monthStartIso.slice(0, 7)}: ${err.message}`);
        console.error(`[kpi-export:${jobId}] "invoiceCharges" pull failed for host "${host}" month ${monthStartIso.slice(0, 7)}:`, err);
      }
    }
  }
  if (invoiceChargeErrors.length > 0) {
    const msg = `Invoice charges pull failed for ${invoiceChargeErrors.length} of ${hosts.length * months.length} host/month combination(s) — billed-revenue figures will be partial: ${invoiceChargeErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  // ── Outstanding invoices (AR aging) — account-wide, paginated ──────────
  emit('progress', { message: 'Pulling outstanding invoices…' });
  const outstandingInvoices = [];
  const invoiceErrors = [];
  for (const host of hosts) {
    try {
      const rows = await getOutstandingInvoices(host);
      outstandingInvoices.push(...rows.map((r) => ({ ...r, _host: host })));
      cacheRaw(jobId, multiHost ? `outstandingInvoices_${host}` : 'outstandingInvoices', rows);
    } catch (err) {
      invoiceErrors.push(`${host}: ${err.message}`);
      console.error(`[kpi-export:${jobId}] "outstandingInvoices" pull failed for host "${host}":`, err);
    }
  }
  if (invoiceErrors.length > 0) {
    const msg = `Outstanding invoices pull failed for ${invoiceErrors.length} of ${hosts.length} host(s) — AR figures will be partial: ${invoiceErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  // ── Per-community pulls (occupancy + recorded care + care completion) ──
  // scheduledCareTasks has no date-range param at all — one call per day,
  // batched to avoid hammering the API. Only compact per-day counts are
  // kept (a full quarter is ~90 calls × ~700-800 tasks each — too much to
  // hold as raw rows).
  const days = daysInRange(periodStart, periodEnd);
  const occupancyRows = [];
  // Collected across every community/month, then surfaced once via
  // dataWarnings below — mirrors chargeErrors/invoiceChargeErrors/
  // invoiceErrors above. Previously these only reached a console.error,
  // meaning a genuine getOccupancy failure (as opposed to an account that
  // simply doesn't populate ALIS's floor-plan module — see hasOccupancyData
  // in kpiNormalizer.js) went completely unreported on the finished report.
  const occupancyErrors = [];
  const careCompletionDailySummaries = [];
  // orderAdministration is high-volume (tens of thousands of rows per
  // community-month) but only PRN rows matter for the PRN-rate KPI — filtered
  // down immediately below rather than accumulating the full response, the
  // same "don't hold more than the KPI needs" discipline as
  // careCompletionDailySummaries above.
  const prnAdministrationRows = [];

  await mapWithConcurrency(communities, COMMUNITY_CONCURRENCY, async (community) => {
    const { name, communityId, host } = community;
    const itemName = multiHost ? `${name} [${host}]` : name;
    setItemStatus(jobId, itemName, 'running');
    emit('item_start', { name: itemName });

    // One community's pull erroring out (a genuine bug, not just an API
    // 401/500 — those are already caught via allSettled below) used to take
    // down the entire job: the exception propagated past this loop, left
    // this item stuck at "running" forever with no error recorded, and
    // silently skipped every remaining community. Catch here instead so a
    // single bad community fails on its own and the rest still run.
    try {
      const [occupancyMonthResults, orderAdministrationMonthResults] = await Promise.all([
        Promise.allSettled(months.map((m) => getOccupancy(host, { communityId, monthAndYear: m }))),
        // v3 caps the date range at 1 month per call (confirmed live — a
        // full-quarter range 400s with "Date range cannot exceed 1 month"),
        // same constraint as occupancy above — one call per calendar month,
        // clipped to the real period at the boundaries.
        Promise.allSettled(months.map((m) => {
          const { rangeStart, rangeEnd } = clipMonthToPeriod(m, periodStart, periodEnd);
          return getOrderAdministration(host, { communityId, startDate: rangeStart, endDate: rangeEnd });
        })),
      ]);

      let occupancySuccessCount = 0;
      occupancyMonthResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          occupancySuccessCount++;
          const occupancy = result.value;
          occupancyRows.push(...(Array.isArray(occupancy) ? occupancy : [occupancy]).filter(Boolean).map((r) => ({ ...r, _host: host })));
        } else {
          occupancyErrors.push(`${itemName} / ${months[i].slice(0, 7)}: ${result.reason.message}`);
          console.error(`[kpi-export:${jobId}] "occupancy" pull failed for "${itemName}" / ${months[i]}:`, result.reason);
        }
      });

      // Supplementary KPI, not part of the item-level success/failure
      // determination below — a missing PRN rate shouldn't mark an
      // otherwise-successful community as failed.
      orderAdministrationMonthResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const rows = asArray(result.value).filter((r) => r.isPrn === true);
          prnAdministrationRows.push(...rows);
        } else {
          console.error(`[kpi-export:${jobId}] "orderAdministration" pull failed for "${itemName}" / ${months[i]}:`, result.reason);
        }
      });

      let careTaskDaysSucceeded = 0;
      if (CARE_COMPLETION_ENABLED) {
        for (let i = 0; i < days.length; i += CARE_TASK_BATCH_SIZE) {
          const batch = days.slice(i, i + CARE_TASK_BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map((d) => getScheduledCareTasks(host, { communityId, localCareDate: d }))
          );
          batchResults.forEach((result, j) => {
            const date = batch[j];
            if (result.status === 'fulfilled') {
              careTaskDaysSucceeded++;
              const tasks = (result.value || []).flatMap((r) => r.careTrackingItems || []);
              const recorded = tasks.filter((t) => String(t.taskStatus) === '1');
              const completed = recorded.filter((t) => String(t.outcome) === '1').length;
              careCompletionDailySummaries.push({ communityId, date, total: recorded.length, completed });
            } else {
              console.error(`[kpi-export:${jobId}] "scheduledCareTasks" pull failed for "${itemName}" / ${date}:`, result.reason);
            }
          });
          emit('progress', { message: `Care completion: ${Math.min(i + CARE_TASK_BATCH_SIZE, days.length)}/${days.length} days pulled for "${itemName}"` });
        }
      }

      // Fails the item only when occupancy itself completely failed (every
      // month's getOccupancy call rejected — not merely returned zero rows,
      // which Promise.allSettled still counts as fulfilled; see
      // hasOccupancyData in kpiNormalizer.js for that distinct "account
      // doesn't track this" case). Previously this only fired when BOTH
      // occupancy AND care completion failed — but care completion is
      // hard-disabled (CARE_COMPLETION_ENABLED) and used to default its
      // counter to a fake "1 succeeded" specifically so it wouldn't be
      // blamed, which had the side effect of making this condition
      // permanently unreachable: a real, total occupancy outage was always
      // reported as item success while the feature stayed disabled. Care
      // completion's own failure is only weighed in at all while the
      // feature is actually enabled.
      const occupancyFullyFailed = months.length > 0 && occupancySuccessCount === 0;
      const careCompletionFullyFailed = CARE_COMPLETION_ENABLED && days.length > 0 && careTaskDaysSucceeded === 0;
      const itemFailed = CARE_COMPLETION_ENABLED ? (occupancyFullyFailed && careCompletionFullyFailed) : occupancyFullyFailed;

      if (itemFailed) {
        const error = CARE_COMPLETION_ENABLED
          ? `occupancy: all ${months.length} month(s) failed; care completion: all ${days.length} day(s) failed`
          : `occupancy: all ${months.length} month(s) failed`;
        setItemStatus(jobId, itemName, 'failed', error);
        emit('item_fail', { name: itemName, error });
      } else {
        setItemStatus(jobId, itemName, 'success');
        emit('item_done', { name: itemName });
      }
    } catch (err) {
      console.error(`[kpi-export:${jobId}] Unexpected error processing "${itemName}":`, err);
      setItemStatus(jobId, itemName, 'failed', err.message);
      emit('item_fail', { name: itemName, error: err.message });
    }
  });
  cacheRaw(jobId, 'occupancy', occupancyRows);
  cacheRaw(jobId, 'careCompletionDailySummaries', careCompletionDailySummaries);
  cacheRaw(jobId, 'prnAdministration', prnAdministrationRows);

  if (occupancyErrors.length > 0) {
    const msg = `Occupancy pull failed for ${occupancyErrors.length} community/month combination(s) — occupancy figures may be partial: ${occupancyErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  // hqOccupancies carries physicalMoveInDate/financialMoveInDate per
  // resident (duplicated across every day-in-month row, since it's a daily
  // occupancy snapshot) — some accounts' /residents pull doesn't carry a
  // move-in date field at all, and the dedicated moveInsAndOuts endpoint
  // has been unreliable (see the retry/fallback added to that pull). This
  // costs no extra API call: occupancyRows is already pulled for the
  // Occupancy % KPI, so it's just a free fallback source for a field
  // normalizeCareLevelEvaluations already knows how to read (see its
  // firstDefined candidate list, which already includes 'moveInDate').
  const moveInDateByResident = new Map();
  for (const row of occupancyRows) {
    const key = `${row._host}::${row.residentId}`;
    if (!moveInDateByResident.has(key)) {
      const moveIn = row.physicalMoveInDate || row.financialMoveInDate;
      if (moveIn) moveInDateByResident.set(key, moveIn);
    }
  }
  const MOVE_IN_DATE_KEYS = ['physicalMoveInDate', 'financialMoveInDate', 'moveInDate', 'admissionDate'];
  for (const resident of residents) {
    if (MOVE_IN_DATE_KEYS.some((k) => resident[k] != null)) continue;
    const fallback = moveInDateByResident.get(`${resident._host}::${resident.residentId}`);
    if (fallback) resident.moveInDate = fallback;
  }

  // ── Normalize ─────────────────────────────────────────────────────────
  emit('progress', { message: 'Normalizing KPIs and diffing against ALIS 500 benchmarks…' });

  // residents/moveInsAndOuts/incidents/leaves/diagnosesAndAllergies are
  // account-wide pulls — filter down to the communities this job actually
  // asked about before normalizing, or a single-community job would report
  // whole-account numbers. Keyed by host+communityId (see filterByCommunity)
  // so two hosts can't collide on the same numeric community ID.
  const requestedCommunityKeys = new Set(communities.map((c) => `${c.host}::${c.communityId}`));
  const scopedResidents = filterByCommunity(residents, requestedCommunityKeys);
  const scopedDiagnoses = filterByCommunity(diagnosesAndAllergies, requestedCommunityKeys);
  const scopedStaff = filterByCommunity(staff, requestedCommunityKeys);
  // Not date-filtered — a resident's isMostCurrent evaluation may predate
  // this reporting period (that's the whole point of flagging it overdue),
  // so restricting to periodStart..periodEnd would hide exactly the
  // residents this KPI exists to surface.
  const scopedEvaluations = filterByCommunity(evaluations, requestedCommunityKeys);
  // Already scoped to periodStart..periodEnd server-side via serviceStartDate/
  // serviceEndDate — only needs the community filter here.
  const scopedRecurringCharges = filterByCommunity(recurringCharges, requestedCommunityKeys);
  // Already scoped to periodStart..periodEnd server-side via invoiceStartDate/
  // invoiceEndDate — only needs the community filter here.
  const scopedInvoiceCharges = filterByCommunity(invoiceCharges, requestedCommunityKeys);
  // Not date-filtered — an invoice from any point in the past can still be
  // outstanding today, and aging is computed relative to periodEnd inside
  // normalizeOutstandingInvoices, not by excluding old invoices up front.
  const scopedOutstandingInvoices = filterByCommunity(outstandingInvoices, requestedCommunityKeys);

  // incidents and leaves have no server-side date filter at all (confirmed
  // against the live OpenAPI spec) — they return full history, so an
  // unfiltered pull would badly inflate any per-1000-resident-days rate.
  const scopedIncidents = filterByDateRange(
    filterByCommunity(incidents, requestedCommunityKeys),
    ['incidentDateTime', 'incidentDate'],
    periodStart, periodEnd
  );
  const scopedLeaves = filterByDateRange(
    filterByCommunity(leaves, requestedCommunityKeys),
    ['startDateTime', 'startDate', 'leaveStartDate'],
    periodStart, periodEnd
  );
  // Move-out cohort = residents who moved out during this period (matches
  // how the ALIS 500 benchmark frames its move-out reason breakdown), not
  // every historical stay for this community.
  const scopedMoveInsAndOuts = filterByDateRange(
    filterByCommunity(moveInsAndOuts, requestedCommunityKeys),
    ['physicalMoveOutDate', 'financialMoveOutDate', 'moveOutDate'],
    periodStart, periodEnd
  );
  // Unfiltered by date (unlike scopedMoveInsAndOuts above) — the
  // admissions/discharges trend buckets move-ins and move-outs
  // independently by month, so an admission with no discharge yet must
  // still show up as an admission.
  const communityScopedMoveInsAndOuts = filterByCommunity(moveInsAndOuts, requestedCommunityKeys);

  // Residents this account has actually billed this period, via the same
  // recurringCharges/invoiceCharges rows already pulled — per client
  // guidance, a resident profile with no billing activity is typically a
  // test/"fake" profile, not a real one (confirmed by a real client ticket:
  // Artegan reported exactly this inflating their resident-days figure).
  // Only used to adjust the falls/hospital/PRN rate denominator below, not
  // the headline occupancy % — see normalizeOccupancy's doc comment.
  //
  // Second-occupants and residents on leave legitimately have zero billing
  // records of their own (the primary occupant's charge covers the whole
  // unit) — without excluding them, this looked like a good signal until a
  // live check against a real account showed 81 residents flagged as
  // "unbilled," matching almost 1:1 with that account's 88
  // isSecondOccupant residents. Left unfixed, that would have flagged real
  // residents as fake account-wide and inflated the rate KPIs for a very
  // common, completely legitimate living arrangement — a worse regression
  // than the problem this was meant to fix.
  const billedResidentIds = new Set(
    [...scopedRecurringCharges, ...scopedInvoiceCharges]
      .filter((r) => r.residentId != null)
      .map((r) => String(r.residentId))
  );
  for (const r of scopedResidents) {
    if (r.isSecondOccupant || r.isOnLeave) billedResidentIds.add(String(r.residentId));
  }

  const occupancy = normalizeOccupancy(occupancyRows, { billedResidentIds });
  const demographics = normalizeDemographics(scopedResidents);
  const lengthOfStay = normalizeLengthOfStayAndMoveOuts(scopedMoveInsAndOuts, { communities });
  const admissionsDischarges = normalizeAdmissionsDischarges(communityScopedMoveInsAndOuts, periodStart, periodEnd);
  const careLevelEvaluations = normalizeCareLevelEvaluations(scopedEvaluations, scopedResidents, periodEnd);
  const recurringRevenue = normalizeRecurringRevenue(scopedRecurringCharges);
  const billedRevenue = normalizeInvoiceCharges(scopedInvoiceCharges);
  const outstandingInvoiceSummary = normalizeOutstandingInvoices(scopedOutstandingInvoices, periodEnd);
  if (occupancy.unbilledResidentCount > 0) {
    dataWarnings.push(
      `${occupancy.unbilledResidentCount} resident(s) with occupied room-days this period have no billing activity at all — likely test/"fake" profiles. Excluded from the falls/hospital/PRN per-1,000-resident-days denominator below; occupancy % is unaffected (still matches ALIS's own floor-plan report).`
    );
  }
  // billedOccupiedRoomDays (when there's billing data to check against) is
  // the resident-days figure with those excluded — occupiedRoomDays still
  // IS the real resident-days figure for the period otherwise (one resident
  // ≈ one occupied room-day) — prefer it over the avgCensus*days estimate,
  // which only kicks in if occupancy data is missing entirely.
  const residentDays = occupancy.billedOccupiedRoomDays ?? occupancy.occupiedRoomDays ?? estimateResidentDays({ avgCensus: occupancy.pct, periodStart, periodEnd });
  const falls = normalizeFalls(scopedIncidents, residentDays);
  const incidentCompletion = normalizeIncidentCompletion(scopedIncidents, { communities });
  // Leisure Care (by name) OR any account whose own incident-type config
  // already tags "(Sentinel)" types (see companyFeatures.js) — left
  // undefined for every other client so downstream consumers (qbrFlags.js,
  // qbrExport.js's PPT) gate on "does this exist" rather than re-checking
  // companyName themselves.
  const sentinelIncidents = shouldTrackSentinelIncidents(companyName, scopedIncidents)
    ? normalizeSentinelIncidents(scopedIncidents, { communities })
    : undefined;
  const hospitalVisits = normalizeHospitalVisits(scopedLeaves, residentDays);
  const diagnosisPrevalence = normalizeDiagnoses(scopedDiagnoses, demographics.totalResidents);
  const prnAdministration = normalizePrnAdministration(prnAdministrationRows, residentDays);
  const careCompletion = normalizeCareCompletion(careCompletionDailySummaries);
  // Average daily census over the period, for the staff-to-census ratio.
  const avgCensus = occupancy.occupiedRoomDays != null && days.length ? occupancy.occupiedRoomDays / days.length : null;
  const staffActivity = normalizeStaffActivity(scopedStaff, { residentCensus: avgCensus });
  const dso = normalizeDso(scopedInvoiceCharges, scopedOutstandingInvoices, { periodStart, periodEnd, communities });
  const ppd = normalizePpd(scopedInvoiceCharges, occupancyRows, { periodStart, periodEnd, communities });

  const normalized = { occupancy, demographics, lengthOfStay, admissionsDischarges, careLevelEvaluations, recurringRevenue, billedRevenue, outstandingInvoiceSummary, dso, ppd, falls, incidentCompletion, sentinelIncidents, hospitalVisits, diagnosisPrevalence, prnAdministration, careCompletion, staffActivity };

  const benchmark = getLatestBenchmarks();
  const diffs = computeBenchmarkDiffs(normalized, benchmark);

  // ── HubSpot tickets (optional) ────────────────────────────────────────
  let ticketSummary = null;
  if (hubspotCompanyId) {
    try {
      emit('progress', { message: 'Pulling HubSpot ticket history…' });
      ticketSummary = await getTicketSummaryForCompany(hubspotCompanyId);
      cacheRaw(jobId, 'ticketSummary', ticketSummary);
    } catch (err) {
      // Previously only an ephemeral SSE progress message — invisible on
      // the finished report, so a genuine failure (as opposed to no
      // HubSpot company being linked at all) read as "no tickets" with no
      // explanation. Confirmed live: an unchunked batch-read call
      // rejected outright for an account with 100+ tickets (see
      // hubspotTickets.js's batchReadTickets) did exactly this.
      const msg = `HubSpot ticket pull failed — Support Review/Enhancement Requests will be empty: ${err.message}`;
      emit('progress', { message: msg });
      dataWarnings.push(msg);
      console.error(`[kpi-export:${jobId}] HubSpot ticket pull failed for company ${hubspotCompanyId}:`, err);
    }
  }

  // ── HubSpot deals (optional) ────────────────────────────────────────────
  let dealSummary = null;
  if (hubspotCompanyId) {
    try {
      emit('progress', { message: 'Pulling HubSpot deal history…' });
      dealSummary = await getDealSummaryForCompany(hubspotCompanyId);
      cacheRaw(jobId, 'dealSummary', dealSummary);
    } catch (err) {
      const msg = `HubSpot deal pull failed — HubSpot Deals will be empty: ${err.message}`;
      emit('progress', { message: msg });
      dataWarnings.push(msg);
      console.error(`[kpi-export:${jobId}] HubSpot deal pull failed for company ${hubspotCompanyId}:`, err);
    }
  }

  // hubspotHealth is usually attached later via POST /api/qbr/:jobId/health-import
  // (see server/api/qbr.js) — but the New Job form also lets a user paste the
  // account-health-export skill's JSON in at creation time, since it's often
  // available before the export finishes. When present, fold it in now so
  // flags don't wait for a second manual import step.
  let hubspotHealth = null;
  let hubspotHealthImportWarning = null;
  if (pendingHealthImport && typeof pendingHealthImport === 'object' && (pendingHealthImport.service_health || pendingHealthImport.financial_health)) {
    hubspotHealth = pendingHealthImport;
    // Resolve repeat_issue_flags' bare ticket IDs to real subjects/links via
    // a live HubSpot lookup — same enrichment as the post-hoc import path
    // in server/api/qbr.js, so it doesn't matter which way the export was attached.
    if (hubspotHealth.service_health) {
      hubspotHealth.service_health = await enrichRepeatIssueFlags(hubspotHealth.service_health);
      hubspotHealth.service_health = enrichOpenTickets(hubspotHealth.service_health);
    }
    if (hubspotHealth.financial_health) {
      hubspotHealth.financial_health = enrichDealUrls(hubspotHealth.financial_health);
    }
    const importedName = (pendingHealthImport.account?.name || '').trim().toLowerCase();
    const snapshotName = (companyName || '').trim().toLowerCase();
    if (importedName && snapshotName && importedName !== snapshotName) {
      hubspotHealthImportWarning = `Company name mismatch: the attached health export is for "${pendingHealthImport.account.name}", but this QBR job is for "${companyName}" — double-check you attached the right file.`;
    }
  }

  // Same "paste it at creation time" convenience as pendingHealthImport
  // above, for the release-recommendations Claude Project's output — see
  // server/services/RELEASE_RECOMMENDATIONS_SCHEMA.md for the expected shape.
  let releaseRecommendations = null;
  let releaseImportWarning = null;
  if (pendingReleaseImport && typeof pendingReleaseImport === 'object' && Array.isArray(pendingReleaseImport.releases)) {
    releaseRecommendations = pendingReleaseImport;
    const importedName = (pendingReleaseImport.account?.name || '').trim().toLowerCase();
    const snapshotName = (companyName || '').trim().toLowerCase();
    if (importedName && snapshotName && importedName !== snapshotName) {
      releaseImportWarning = `Company name mismatch: the attached release-recommendations export is for "${pendingReleaseImport.account.name}", but this QBR job is for "${companyName}" — double-check you attached the right file.`;
    }
  }

  const flags = generateFlags(normalized, diffs, ticketSummary, dealSummary, hubspotHealth);

  const summary = {
    companyName,
    companyHost: hosts.join(', '),
    // Lets /api/qbr/:jobId/refresh-hubspot re-pull live ticket/deal data
    // without needing to fall back to the job's payload.
    hubspotCompanyId,
    communities,
    periodStart,
    periodEnd,
    benchmarkQuarter: benchmark.quarter,
    normalized,
    diffs,
    ticketSummary,
    dealSummary,
    hubspotHealth,
    releaseRecommendations,
    releaseImportWarning,
    hubspotHealthImportWarning,
    dataWarnings,
    flags,
  };

  addKpiSnapshot(jobId, { companyName, periodStart, periodEnd, benchmarkQuarter: benchmark.quarter, summary });

  // Company/region/community DSO rollups only — see addDsoSnapshots' doc
  // comment for why resident-level rows aren't persisted here. Skipped
  // entirely (not written as zeroed rows) when there's no billing data at
  // all, so a non-billing account's history stays genuinely empty rather
  // than filling with meaningless zero-DSO rows.
  if (dso.hasBillingData) {
    const dsoRows = [
      { scope: 'company', scopeKey: 'portfolio', scopeLabel: companyName, ...dso.portfolio },
      ...dso.byRegion.map((r) => ({ scope: 'region', scopeKey: r.region, scopeLabel: r.region, ...r })),
      ...dso.byCommunity.map((c) => ({ scope: 'community', scopeKey: `${c.host}::${c.communityId}`, scopeLabel: c.name, ...c })),
    ].map((r) => ({ companyName, periodStart, periodEnd, scope: r.scope, scopeKey: r.scopeKey, scopeLabel: r.scopeLabel, billedRevenue: r.billedRevenue, arBalance: r.arBalance, dsoDays: r.dsoDays }));
    addDsoSnapshots(jobId, dsoRows);
  }

  // Company/region/community PPD rollups — same reasoning as the DSO block
  // above (skip entirely rather than write meaningless zero rows when
  // there's no billing/occupancy data at all for this job).
  if (ppd.hasData) {
    const ppdRows = [
      { scope: 'company', scopeKey: 'portfolio', scopeLabel: companyName, ...ppd.portfolio },
      ...ppd.byRegion.map((r) => ({ scope: 'region', scopeKey: r.region, scopeLabel: r.region, ...r })),
      ...ppd.byCommunity.map((c) => ({ scope: 'community', scopeKey: `${c.host}::${c.communityId}`, scopeLabel: c.name, ...c })),
    ].map((r) => ({ companyName, periodStart, periodEnd, scope: r.scope, scopeKey: r.scopeKey, scopeLabel: r.scopeLabel, billedRevenue: r.billedRevenue, occupiedDays: r.occupiedDays, censusDays: r.censusDays, ppdByUnitDays: r.ppdByUnitDays, ppdByCensus: r.ppdByCensus }));
    addPpdSnapshots(jobId, ppdRows);
  }

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, flagCount: flags.length });
}

module.exports = { runKpiExportJob };
