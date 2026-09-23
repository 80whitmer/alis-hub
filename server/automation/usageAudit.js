const {
  getCommunities, getRecurringCharges, getInvoiceCharges, getOutstandingInvoices,
  getEvaluations, getStaffComplianceDetails, getObservations, getResidents, getProspects,
  getRecordedCare, getOrderAdministration,
} = require('../services/alisApiClient');
const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { captureEntitlements } = require('./playwright/entitlementsPage');
const { captureDailyStandUp } = require('./playwright/dailyStandUpPage');
const { captureCareTracking } = require('./playwright/careTrackingPage');
const { computeUsageSignals, setUsageCount } = require('../services/usageSignals');
const { getSignalDescriptions } = require('../services/usageAuditCatalog');
const { buildAuditGrid } = require('../services/usageAuditNormalizer');
const { setJobStatus, setItemStatus, syncJobItems, addUsageAuditSnapshot, getJob } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/** Same reasoning/contract as kpiExport.js's identical helper — see that file's doc comment. Folded into this job runner too (Sep 2026) since it shares the same "Cancel Job is cosmetic" gap. */
function isCancelled(jobId) {
  return getJob(jobId)?.status === 'failed';
}

const asArray = (v) => (Array.isArray(v) ? v : v?.items || []);

// `target.push(...items)` blows V8's call-stack argument limit once `items`
// gets into the tens of thousands (confirmed live: a 90-day recordedCare
// pull for one community alone triggered "Maximum call stack size
// exceeded") — high-volume export endpoints like recordedCare/observations
// are exactly the case this needs to survive, so every bulk-append below
// goes through this instead of the spread form.
function pushAll(target, items) {
  for (const item of items) target.push(item);
}

/** Same comma-separated-list convention as kpiExport.js/wellnessExport.js's parseHosts. */
function parseList(str) {
  return String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// invoiceCharges and orderAdministration both cap their date-range query at
// 1 month per call (confirmed live — a 90-day lookback in one call 400s
// with "Date range cannot exceed 1 month") — same constraint kpiExport.js
// already works around for invoiceCharges; monthsInRange/clipMonthToPeriod
// duplicated here rather than imported since kpiExport.js doesn't export
// them (kept local/unexported there too).
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

function clipMonthToPeriod(monthStartIso, periodStart, periodEnd) {
  const monthStart = new Date(monthStartIso);
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const lastDayOfMonth = new Date(nextMonthStart.getTime() - 86400000).toISOString().slice(0, 10);
  const rangeStart = monthStartIso > periodStart ? monthStartIso : periodStart;
  const rangeEnd = lastDayOfMonth < periodEnd ? lastDayOfMonth : periodEnd;
  return { rangeStart, rangeEnd };
}

/** Pulls `fn(host, {startKey, endKey})` one calendar month at a time across [startDate, endDate], concatenating results — the shared workaround for the two export endpoints capped at a 1-month range per call. */
async function pullByMonth(fn, startDate, endDate, startKey, endKey) {
  const rows = [];
  for (const monthStart of monthsInRange(startDate, endDate)) {
    const { rangeStart, rangeEnd } = clipMonthToPeriod(monthStart, startDate, endDate);
    const page = await fn({ [startKey]: rangeStart, [endKey]: rangeEnd });
    pushAll(rows, asArray(page));
  }
  return rows;
}

/**
 * Builds { [host]: adminCompanyId } by zipping companyHost and
 * alisAdminCompanyIds positionally — the same account can span multiple
 * ALIS hosts/subdomains that are actually separate ALIS company records
 * (own Entitlements page, own admin company ID), which is the "two URLs to
 * compare side by side" case. A host with no corresponding admin company ID
 * (short list, or an empty slot) simply isn't scraped for Enabled state —
 * Contracted and Used still populate for it.
 */
function zipHostsToAdminIds(hosts, adminIdsStr) {
  const adminIds = parseList(adminIdsStr);
  const map = {};
  hosts.forEach((host, i) => {
    if (adminIds[i]) map[host] = adminIds[i];
  });
  return map;
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the company-usage-audit job: pull contracted modules (HubSpot deals +
 * line items), enabled modules (ALIS Entitlements page scrape, one per
 * distinct admin company ID), and real usage activity (ALIS export API,
 * zero-rows-in-window heuristic) for every community across one or more
 * ALIS hosts, and assemble the feature x community RAG grid defined in
 * usageAuditCatalog.js.
 *
 * Mirrors wellnessExport.js's structure (multi-host, _host-tagged account-
 * wide pulls via Promise.allSettled, per-community item tracking for the
 * endpoints that need a communityId).
 *
 * Emits SSE events: job_start | progress | item_start | item_done | item_fail | job_done
 */
async function runCompanyUsageAuditJob(jobId, payload) {
  const { companyName, hubspotCompanyId } = payload;
  const lookbackDays = Number(payload.lookbackDays) || 90;
  const hosts = parseList(payload.companyHost);
  const adminIdByHost = zipHostsToAdminIds(hosts, payload.alisAdminCompanyIds);
  const multiHost = hosts.length > 1;
  const emit = (event, data) => broadcast(jobId, event, data);
  const dataWarnings = [];

  setJobStatus(jobId, 'running');

  if (hosts.length === 0) {
    const error = 'ALIS Company Host is required — fill that field in before running the job.';
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
    return;
  }

  // ── Resolve communities (explicit list, or auto-pull every community per host) ──
  const EXCLUDED_STATUSES = ['canceled', 'cancelled', 'suspended'];
  let communities = payload.communities;
  if (communities && communities.length > 0) {
    communities = communities.map((c) => ({ ...c, host: c.host || hosts[0] }));
  } else {
    emit('progress', { message: `No communities specified — pulling the full community list for ${multiHost ? `${hosts.length} hosts (${hosts.join(', ')})` : `host "${hosts[0]}"`}…` });
    communities = [];
    const hostErrors = [];
    for (const host of hosts) {
      if (isCancelled(jobId)) {
        emit('job_error', { error: 'Job was cancelled.' });
        return;
      }
      try {
        const all = await getCommunities(host);
        const resolved = all
          .filter((c) => !(c.communityName || '').toLowerCase().includes('training'))
          .filter((c) => !EXCLUDED_STATUSES.includes((c.status || '').toLowerCase()))
          .map((c) => ({ name: c.communityName, communityId: c.communityId, host }));
        communities.push(...resolved);
        emit('progress', { message: `Auto-resolved ${resolved.length} of ${all.length} communities from host "${host}".` });
      } catch (err) {
        hostErrors.push(`${host}: ${err.message}`);
        console.error(`[company-usage-audit:${jobId}] Failed to auto-resolve communities for host "${host}":`, err);
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
  }
  syncJobItems(jobId, communities.map((c) => (multiHost ? `${c.name} [${c.host}]` : c.name)));
  emit('job_start', { jobId, total: communities.length, company: companyName });

  // ── Enabled: scrape the Entitlements page once per distinct admin company ID ──
  const entitlementsByHost = {};
  for (const host of hosts) entitlementsByHost[host] = null;

  const hostsNeedingEntitlements = hosts.filter((h) => adminIdByHost[h]);
  if (hostsNeedingEntitlements.length > 0) {
    emit('progress', { message: `Logging in to admin.alisonline.com to read Entitlements for ${hostsNeedingEntitlements.length} host(s)…` });
    let page;
    try {
      page = await newPage();
      await ensureLoggedIn(page);
      for (const host of hostsNeedingEntitlements) {
        if (isCancelled(jobId)) break;
        try {
          const snapshot = await captureEntitlements(page, adminIdByHost[host]);
          entitlementsByHost[host] = snapshot;
          emit('progress', { message: `Captured ${Object.keys(snapshot.flags).length} entitlement flags for host "${host}" (admin company ${adminIdByHost[host]}).` });
        } catch (err) {
          const msg = `Entitlements scrape failed for host "${host}" (admin company ${adminIdByHost[host]}): ${err.message}`;
          console.error(`[company-usage-audit:${jobId}] ${msg}`, err);
          dataWarnings.push(msg);
        }
      }
    } catch (err) {
      const msg = `Could not log in to admin.alisonline.com — Enabled column will be blank for every host: ${err.message}`;
      console.error(`[company-usage-audit:${jobId}] ${msg}`, err);
      dataWarnings.push(msg);
    } finally {
      if (page) await page.context().close().catch(() => {});
    }
  } else {
    dataWarnings.push('No ALIS Admin Company ID(s) provided — the Enabled column will be blank for every feature.');
  }

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  // ── Contracted: disabled for now (Aaron, 2026-09-03) — the HubSpot
  // private app token is missing the crm.objects.line_items.read /
  // crm.schemas.line_items.read scopes this needs, and the column isn't
  // rendered in the dashboard/export while that's true. The pull logic
  // itself (getContractedModulesForCompany, deal-to-community fuzzy
  // matching in usageAuditNormalizer.js) is untouched — flip this back on
  // once those scopes are granted, no other changes needed.
  const deals = [];
  const dealsAvailable = false;

  // ── Used: account-wide export API pulls (one call per host, tagged _host) ──
  const startDate = dateNDaysAgo(lookbackDays);
  const endDate = new Date().toISOString().slice(0, 10);

  const ACCOUNT_WIDE_ENDPOINTS = [
    { key: 'recurringCharges', fn: (host) => getRecurringCharges(host, { serviceStartDate: startDate, serviceEndDate: endDate }) },
    { key: 'invoiceCharges', fn: (host) => pullByMonth((range) => getInvoiceCharges(host, range), startDate, endDate, 'invoiceStartDate', 'invoiceEndDate') },
    { key: 'outstandingInvoices', fn: (host) => getOutstandingInvoices(host) },
    { key: 'evaluations', fn: (host) => getEvaluations(host) },
    { key: 'staffComplianceDetails', fn: (host) => getStaffComplianceDetails(host) },
    { key: 'observations', fn: (host) => getObservations(host, { stopBeforeDate: startDate }) },
    { key: 'residents', fn: (host) => getResidents(host) },
    // 3-month cap per call (same class of constraint as invoiceCharges) —
    // chunked by month like invoiceCharges above.
    { key: 'prospects', fn: (host) => pullByMonth((range) => getProspects(host, range), startDate, endDate, 'createdAtStartDate', 'createdAtEndDate') },
  ];

  emit('progress', { message: `Pulling ${lookbackDays}-day activity (billing, evaluations, staff compliance, observations, residents, prospects) from ${hosts.length} host(s)…` });

  const pulled = { recurringCharges: [], invoiceCharges: [], outstandingInvoices: [], evaluations: [], staffComplianceDetails: [], observations: [], residents: [], prospects: [] };
  const endpointErrors = [];
  for (const host of hosts) {
    if (isCancelled(jobId)) {
      emit('job_error', { error: 'Job was cancelled.' });
      return;
    }
    const settled = await Promise.allSettled(ACCOUNT_WIDE_ENDPOINTS.map((e) => e.fn(host)));
    settled.forEach((result, i) => {
      const { key } = ACCOUNT_WIDE_ENDPOINTS[i];
      if (result.status === 'fulfilled') {
        pushAll(pulled[key], asArray(result.value).map((r) => ({ ...r, _host: host })));
      } else {
        endpointErrors.push(`${key}@${host}: ${result.reason.message}`);
        console.error(`[company-usage-audit:${jobId}] "${key}" pull failed for host "${host}":`, result.reason);
      }
    });
  }
  if (endpointErrors.length > 0) {
    const msg = `${endpointErrors.length} of ${hosts.length * ACCOUNT_WIDE_ENDPOINTS.length} account-wide pulls failed and will be treated as empty: ${endpointErrors.join('; ')}`;
    emit('progress', { message: msg });
    dataWarnings.push(msg);
  }

  // ── Used, per-community: recordedCare + orderAdministration (need a communityId) ──
  const recordedCare = [];
  const orderAdministration = [];
  for (const community of communities) {
    const { name, communityId, host } = community;
    const itemName = multiHost ? `${name} [${host}]` : name;
    if (isCancelled(jobId)) {
      setItemStatus(jobId, itemName, 'failed', 'Job was cancelled.');
      continue;
    }
    setItemStatus(jobId, itemName, 'running');
    emit('item_start', { name: itemName });

    const [careResult, orderResult] = await Promise.allSettled([
      getRecordedCare(host, { communityId, careStartDate: startDate, careEndDate: endDate }),
      pullByMonth((range) => getOrderAdministration(host, { communityId, ...range }), startDate, endDate, 'startDate', 'endDate'),
    ]);

    let failed = false;
    if (careResult.status === 'fulfilled') {
      pushAll(recordedCare, asArray(careResult.value).map((r) => ({ ...r, _host: host, communityId })));
    } else {
      failed = true;
      console.error(`[company-usage-audit:${jobId}] "recordedCare" pull failed for "${itemName}":`, careResult.reason);
    }
    if (orderResult.status === 'fulfilled') {
      pushAll(orderAdministration, asArray(orderResult.value).map((r) => ({ ...r, _host: host, communityId })));
    } else {
      failed = true;
      console.error(`[company-usage-audit:${jobId}] "orderAdministration" pull failed for "${itemName}":`, orderResult.reason);
    }

    if (failed) {
      setItemStatus(jobId, itemName, 'failed', 'One or more usage-signal pulls failed for this community — see server logs.');
      emit('item_fail', { name: itemName, error: 'Partial usage-signal pull failure' });
    } else {
      setItemStatus(jobId, itemName, 'success');
      emit('item_done', { name: itemName });
    }
  }

  // ── Used, per-community: Daily Stand-Up (live page-scrape — no export
  // endpoint or entitlement flag exists for this feature) + Care Tracking
  // page confirmation (corroborates the recordedCare export signal — see
  // usageAuditNormalizer.js). Confirmed live (Sep 2026): a community's ALIS
  // subdomain does NOT share admin.alisonline.com's login session (the one
  // captureEntitlements above uses) — logging in once per distinct host via
  // ensureLoggedIn(page, targetUrl) covers every community under that host,
  // so this only re-logs-in when the host actually changes.
  emit('progress', { message: 'Confirming Daily Stand-Up and Care Tracking activity directly on each community\'s ALIS page…' });
  const dailyStandUpByKey = {};
  const careTrackingByKey = {};
  {
    let page;
    let loggedInHost = null;
    try {
      page = await newPage();
      for (const community of communities) {
        if (isCancelled(jobId)) break;
        const { communityId, host } = community;
        if (loggedInHost !== host) {
          // Confirmed live: a transient ERR_NETWORK_CHANGED / interrupted-
          // navigation error on the first login attempt for a host is
          // usually just headless-Chromium flakiness — the very next
          // community's login (same host) succeeds immediately after. One
          // retry before giving up on the whole host.
          let loginErr;
          for (let attempt = 1; attempt <= 2 && loggedInHost !== host; attempt++) {
            try {
              await ensureLoggedIn(page, `https://${host}.alisonline.com/`);
              loggedInHost = host;
            } catch (err) {
              loginErr = err;
            }
          }
          if (loggedInHost !== host) {
            const msg = `Could not log in to ${host}.alisonline.com for Daily Stand-Up confirmation (tried twice): ${loginErr.message}`;
            console.error(`[company-usage-audit:${jobId}] ${msg}`, loginErr);
            dataWarnings.push(msg);
            continue;
          }
        }
        try {
          const capture = await captureDailyStandUp(page, host, communityId);
          dailyStandUpByKey[`${host}::${communityId}`] = capture.rowCount;
        } catch (err) {
          console.error(`[company-usage-audit:${jobId}] Daily Stand-Up capture failed for community ${communityId} [${host}]:`, err);
        }
        try {
          const capture = await captureCareTracking(page, host, communityId);
          careTrackingByKey[`${host}::${communityId}`] = capture.rowCount;
        } catch (err) {
          console.error(`[company-usage-audit:${jobId}] Care Tracking page capture failed for community ${communityId} [${host}]:`, err);
        }
      }
    } catch (err) {
      const msg = `Daily Stand-Up/Care Tracking page confirmation skipped entirely — could not launch a browser page: ${err.message}`;
      console.error(`[company-usage-audit:${jobId}] ${msg}`, err);
      dataWarnings.push(msg);
    } finally {
      if (page) await page.context().close().catch(() => {});
    }
  }

  if (isCancelled(jobId)) {
    emit('job_error', { error: 'Job was cancelled.' });
    return;
  }

  const billing = [...pulled.recurringCharges, ...pulled.invoiceCharges, ...pulled.outstandingInvoices];
  // A prospect "has a referral source" if either the source or the parent
  // organization field is populated — some are logged as one but not the
  // other (a walk-in referred "by a friend" with no organization, vs. a
  // hospital-organization referral with no named individual).
  const referralSourcesUsed = pulled.prospects.filter((p) => p.referralSourceName || p.referralOrganization);
  const usageMap = computeUsageSignals(
    {
      billing, orderAdministration, recordedCare,
      evaluations: pulled.evaluations, staffComplianceDetails: pulled.staffComplianceDetails, observations: pulled.observations,
      residents: pulled.residents, prospects: pulled.prospects, referralSourcesUsed,
    },
    communities
  );
  for (const [key, rowCount] of Object.entries(dailyStandUpByKey)) {
    const [host, communityId] = key.split('::');
    setUsageCount(usageMap, host, communityId, 'dailyStandUp', rowCount);
  }

  // ── Assemble the grid and persist ──
  emit('progress', { message: 'Assembling the feature x community grid…' });

  const entitlementsForNormalizer = Object.fromEntries(
    hosts.map((h) => [h, entitlementsByHost[h] ? { flags: entitlementsByHost[h].flags } : null])
  );

  const summary = buildAuditGrid({
    companyName,
    communities,
    entitlementsByHost: entitlementsForNormalizer,
    deals,
    dealsAvailable,
    usageMap,
    careTrackingPageConfirmedByCommunity: careTrackingByKey,
  });
  summary.hubspotCompanyId = hubspotCompanyId || null;
  summary.lookbackDays = lookbackDays;
  summary.usageWindow = { startDate, endDate };
  summary.signalDescriptions = getSignalDescriptions();
  summary.dataWarnings = dataWarnings;
  summary.adminCompanyIdsByHost = adminIdByHost;

  addUsageAuditSnapshot(jobId, {
    companyName,
    companyHost: hosts[0],
    summary,
  });

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}

module.exports = { runCompanyUsageAuditJob };
