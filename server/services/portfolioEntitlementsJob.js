/**
 * Manual, on-demand "Run portfolio entitlement check" job (Aaron, Sep
 * 2026, explicitly choosing this over folding it into the regular
 * Refresh: "a manual bulk-check button... you control when it hits
 * production" — a real ALIS admin login+scrape per account is slow and
 * shouldn't add to every 60-90s Refresh). In-memory job state only, not a
 * DB-backed queue — this is a single-process app and a job that's still
 * running when the server restarts is fine to just re-run; the scraped
 * RESULTS it writes along the way (entitlement_snapshots) do persist.
 */
const { getLiveEntitlementsBulk } = require('./alisEntitlements');
const { replaceEntitlementSnapshot, listEntitlementSnapshots, countEntitlementSnapshotCompanies } = require('../db/database');

let state = { status: 'idle', total: 0, processed: 0, currentCompany: null, startedAt: null, finishedAt: null, errors: [] };

function getStatus() {
  return { ...state, snapshotCompanyCount: countEntitlementSnapshotCompanies() };
}

/** Starts the job if one isn't already running. Fire-and-forget — progress is polled via getStatus(). Returns false if a run was already in progress. */
function startPortfolioEntitlementsCheck(accounts) {
  if (state.status === 'running') return false;
  state = { status: 'running', total: accounts.length, processed: 0, currentCompany: null, startedAt: new Date().toISOString(), finishedAt: null, errors: [] };

  getLiveEntitlementsBulk(accounts, {
    onProgress: ({ index, total, companyName, status, error }) => {
      state.currentCompany = companyName;
      state.total = total;
      if (status === 'done') state.processed = index + 1;
      if (status === 'error') {
        state.processed = index + 1;
        state.errors.push({ companyName, error });
      }
    },
    onSnapshot: async (hubspotCompanyId, companyName, flags) => {
      replaceEntitlementSnapshot(hubspotCompanyId, companyName, flags);
    },
  })
    .then(() => { state.status = 'done'; state.finishedAt = new Date().toISOString(); })
    .catch((err) => { state.status = 'error'; state.finishedAt = new Date().toISOString(); state.errors.push({ companyName: null, error: err.message }); });

  return true;
}

/**
 * Rolls the latest per-company snapshot rows into a portfolio-wide %
 * enabled per flag — the actual "callout of what percentage of ALIS live
 * environments have those specific entitlements enabled" (Aaron, Sep
 * 2026). Computed fresh from the stored rows on every call rather than
 * cached, since it's a cheap in-memory group-by over what's realistically
 * a few tens of thousands of rows at most.
 */
function getPortfolioEntitlementRollup() {
  const rows = listEntitlementSnapshots();
  const companiesChecked = new Set(rows.map((r) => r.hubspot_company_id)).size;

  // Grouped by (category, label), NOT flag_id — confirmed live (Sep 2026):
  // ALIS's entitlement checkbox ids carry a per-company numeric suffix
  // (e.g. "scheduling_assistant_entitlement_2" on one account,
  // "..._entitlement_3" on another) for the SAME feature, so only 91 of
  // 132 flag_ids actually matched across two test accounts while all 132
  // labels did. Grouping by flag_id would silently split one feature into
  // several n=1 "100%/0%" rows instead of a real portfolio percentage.
  const byFlag = new Map();
  for (const r of rows) {
    const key = `${r.category}::${r.label}`;
    if (!byFlag.has(key)) byFlag.set(key, { flagId: key, label: r.label, category: r.category, enabledCount: 0, totalCount: 0 });
    const f = byFlag.get(key);
    f.totalCount += 1;
    if (r.enabled) f.enabledCount += 1;
  }
  const flags = [...byFlag.values()]
    .map((f) => ({ ...f, pctEnabled: f.totalCount > 0 ? Math.round((f.enabledCount / f.totalCount) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pctEnabled - a.pctEnabled || b.totalCount - a.totalCount);

  const byCategory = new Map();
  for (const f of flags) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }
  const categories = [...byCategory.entries()]
    .map(([name, categoryFlags]) => ({ name, flags: categoryFlags }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { companiesChecked, categories };
}

module.exports = { startPortfolioEntitlementsCheck, getStatus, getPortfolioEntitlementRollup };
