/**
 * database.js
 * Uses sql.js (pure JS SQLite — no native compilation required).
 * DB is persisted to disk manually on every write via saveToDisk().
 */

const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, 'alis-hub.sqlite');

let db;
let SQL;

async function initDb() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅  DB loaded from disk:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('✅  DB created (new):', DB_PATH);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      label       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'queued',
      total       INTEGER DEFAULT 0,
      completed   INTEGER DEFAULT 0,
      failed      INTEGER DEFAULT 0,
      payload     TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
  `);
  // A job that fails fatally (setJobStatus(id, 'failed', error)) used to
  // only ever announce why over the live SSE job_error event — once the
  // browser tab closed, the reason was gone for good, and diagnosing a
  // failed run after the fact meant re-running live API calls by hand to
  // guess at it. Persisting it here is the same fix as dataWarnings on the
  // kpi_snapshots summary, just for the fatal (job never produced a
  // snapshot at all) case instead of the partial-data case.
  try {
    db.run(`ALTER TABLE jobs ADD COLUMN error TEXT;`);
  } catch {
    // Column already exists (every run after the first on a given DB file) — fine.
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS job_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      error       TEXT,
      started_at  TEXT,
      finished_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gl_sync_details (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id        TEXT NOT NULL,
      account_number TEXT,
      account_name  TEXT,
      old_value     TEXT,
      new_value     TEXT,
      field_changed TEXT,
      status        TEXT DEFAULT 'success',
      error         TEXT,
      synced_at     TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
      job_id        TEXT PRIMARY KEY,
      company_name  TEXT,
      period_start  TEXT,
      period_end    TEXT,
      benchmark_quarter TEXT,
      summary_json  TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // Remembers each account's ALIS export-API subdomain so it doesn't have
  // to be hand-typed on every kpi-export job. Looked up by hubspot_company_id
  // when available (stable even if the display name changes), falling back
  // to name_key (lowercased company_name) for jobs run without a HubSpot
  // link. Rows are written automatically the first time a companyHost is
  // proven to work (see kpiExport.js), plus optionally seeded in bulk.
  db.run(`
    CREATE TABLE IF NOT EXISTS company_hosts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name_key           TEXT NOT NULL,
      company_name       TEXT NOT NULL,
      hubspot_company_id TEXT,
      company_host       TEXT NOT NULL,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_company_hosts_name_key ON company_hosts(name_key);`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_company_hosts_hubspot_id ON company_hosts(hubspot_company_id);`);

  // One row per wellness-scorecard job — kept separate from kpi_snapshots
  // (different cadence: weekly vs quarterly) and different shape
  // (per-community-structured JSON vs account-aggregate). The
  // company_host/week_ending index is what lets a new run look up the prior
  // week's snapshot for trend arrows without the user re-typing last week's
  // counts by hand, the way ISL's own spreadsheet requires today.
  db.run(`
    CREATE TABLE IF NOT EXISTS wellness_snapshots (
      job_id            TEXT PRIMARY KEY,
      company_host      TEXT NOT NULL,
      company_name      TEXT,
      week_ending       TEXT NOT NULL,
      benchmark_quarter TEXT,
      summary_json      TEXT NOT NULL,
      created_at        TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wellness_snapshots_host_week ON wellness_snapshots(company_host, week_ending);`);

  // One row per company-usage-audit job — a point-in-time snapshot of the
  // feature x community RAG grid (contracted/enabled/used), same
  // one-blob-per-job shape as wellness_snapshots. company_host holds only
  // the first host of a possibly-multi-host run (see usageAudit.js); the
  // full host list lives inside summary_json.
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_audit_snapshots (
      job_id            TEXT PRIMARY KEY,
      company_host      TEXT NOT NULL,
      company_name      TEXT,
      summary_json      TEXT NOT NULL,
      created_at        TEXT DEFAULT (datetime('now'))
    );
  `);

  // One row per (job, scope, scope_key) — 'company'/'region'/'community'
  // rollups of a kpi-export job's DSO figures (see normalizeDso in
  // kpiNormalizer.js). Unlike kpi_snapshots' one-blob-per-job model, this
  // is real relational history: querying by company_name+scope+scope_key
  // ordered by period_start gives a genuine month/quarter/year DSO trend
  // as more jobs run over time, which a JSON blob with no cross-job query
  // can't support. Resident-level DSO is intentionally NOT persisted here
  // (high cardinality, little long-term trend value) — it stays live-only
  // inside the job's kpi_snapshots summary_json.
  db.run(`
    CREATE TABLE IF NOT EXISTS dso_snapshots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT NOT NULL,
      company_name   TEXT NOT NULL,
      scope          TEXT NOT NULL,
      scope_key      TEXT NOT NULL,
      scope_label    TEXT,
      period_start   TEXT NOT NULL,
      period_end     TEXT NOT NULL,
      billed_revenue REAL,
      ar_balance     REAL,
      dso_days       REAL,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_dso_snapshots_lookup ON dso_snapshots(company_name, scope, scope_key, period_start);`);

  // PPD (revenue per occupied/census day) rollups — same one-row-per-
  // (job, scope, scope_key) shape and trend-query purpose as dso_snapshots
  // above, just for a different KPI (normalizePpd in kpiNormalizer.js).
  db.run(`
    CREATE TABLE IF NOT EXISTS ppd_snapshots (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT NOT NULL,
      company_name   TEXT NOT NULL,
      scope          TEXT NOT NULL,
      scope_key      TEXT NOT NULL,
      scope_label    TEXT,
      period_start   TEXT NOT NULL,
      period_end     TEXT NOT NULL,
      billed_revenue REAL,
      occupied_days  INTEGER,
      census_days    INTEGER,
      ppd_unit_days  REAL,
      ppd_census     REAL,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ppd_snapshots_lookup ON ppd_snapshots(company_name, scope, scope_key, period_start);`);

  // Cache of RET (Resident Evaluation Tool) config XML, keyed by
  // (host, config_id) — never overwritten once captured (see
  // upsertEvaluationConfigVersion's INSERT OR IGNORE). Confirmed live (Sep
  // 2026): the ALIS export API's evaluationConfiguration endpoint only ever
  // returns each community's CURRENTLY-active config — once ALIS's admins
  // revise an instrument, the old config's evaluationConfigurationId (and
  // the CarePoints/answer catalog needed to score any evaluation answered
  // against it) is gone from that endpoint for good. 75% of one real
  // client's on-file evaluations already reference a config version older
  // than whatever's currently live. This table is the only way CarePoints
  // scoring (see evaluationScoring.js) stays possible for evaluations
  // answered under a since-superseded config — every job that pulls
  // evaluationConfiguration should upsert its rows here so future runs can
  // still resolve them after ALIS moves on. Evaluations answered against a
  // config version from BEFORE this cache existed can never be scored
  // retroactively; that's a real gap, not a bug, unless ALIS can provide a
  // historical export on request.
  db.run(`
    CREATE TABLE IF NOT EXISTS evaluation_config_versions (
      host          TEXT NOT NULL,
      config_id     INTEGER NOT NULL,
      version       TEXT,
      name          TEXT,
      xml           TEXT NOT NULL,
      captured_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (host, config_id)
    );
  `);

  // One row per audit-history job — a point-in-time snapshot of every
  // Audit History row pulled across this job's targets (company page,
  // community profile(s), resident profile(s)), same one-blob-per-job shape
  // as usage_audit_snapshots/wellness_snapshots.
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_history_snapshots (
      job_id       TEXT PRIMARY KEY,
      company_host TEXT NOT NULL,
      company_name TEXT,
      summary_json TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);

  // One row per HubSpot company in the Account Health Dashboard's owned
  // portfolio — replaced wholesale on each manual refresh (POST
  // /api/account-health/refresh), not appended to, since this is always a
  // "current state" snapshot, not a trend history. Flat summary columns
  // (open/closed ticket counts, open deal value, health_score) exist
  // alongside the JSON blobs so the roll-up view can read/sort/aggregate
  // without parsing every row's JSON — same reasoning as kpi_snapshots'
  // sibling trend tables (dso_snapshots/ppd_snapshots) needing their own
  // flat columns for the same kind of query.
  db.run(`
    CREATE TABLE IF NOT EXISTS account_health_snapshots (
      hubspot_company_id TEXT PRIMARY KEY,
      company_name       TEXT NOT NULL,
      lifecycle_stage     TEXT,
      service_health_json  TEXT,
      financial_health_json TEXT,
      open_ticket_count    INTEGER DEFAULT 0,
      closed_ticket_count  INTEGER DEFAULT 0,
      open_deal_count      INTEGER DEFAULT 0,
      open_deal_value_cents INTEGER DEFAULT 0,
      arr_cents             INTEGER,
      health_score         INTEGER,
      health_band          TEXT,
      refreshed_at          TEXT DEFAULT (datetime('now'))
    );
  `);
  // arr_cents was added after this table's first release — a plain CREATE
  // TABLE IF NOT EXISTS above won't retrofit it onto a DB file created
  // before this column existed (confirmed: this session's own earlier
  // verification run already created the table without it).
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN arr_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }

  saveToDisk();
}

function getDb() {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

function saveToDisk() {
  const data = db.export();
  const buf  = Buffer.from(data);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, buf);
}

function queryAll(sql, params = []) {
  const stmt   = db.prepare(sql);
  const result = [];
  stmt.bind(params);
  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveToDisk();
}

function createJob({ id, type, label, payload, total, items = [] }) {
  // Insert job record with total count (use ISO 8601 for created_at for proper timezone handling)
  const now = new Date().toISOString();
  run(
    `INSERT INTO jobs (id, type, label, status, total, payload, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [id, type, label, total, JSON.stringify(payload), now, now]
  );

  // Create job_items for each item in the list
  // items can be communities, billing items, or any array of objects with a 'name' property
  for (const item of items) {
    run(`INSERT INTO job_items (job_id, name) VALUES (?, ?)`, [id, item.name]);
  }
}

/**
 * Backfills job_items rows and the jobs.total count for a job whose real
 * item list wasn't known at creation time (e.g. kpi-export auto-resolving
 * "all communities" after the job already exists with communities: []).
 * Without this, setItemStatus's UPDATE-by-name matches zero rows and
 * per-item success/failure tracking silently does nothing.
 */
function syncJobItems(jobId, itemNames) {
  const now = new Date().toISOString();
  run(`UPDATE jobs SET total = ?, updated_at = ? WHERE id = ?`, [itemNames.length, now, jobId]);
  for (const name of itemNames) {
    run(`INSERT INTO job_items (job_id, name) VALUES (?, ?)`, [jobId, name]);
  }
}

function getJob(id) {
  const job = queryOne('SELECT * FROM jobs WHERE id = ?', [id]);
  if (!job) return null;
  job.payload = JSON.parse(job.payload || '{}');
  job.items   = queryAll('SELECT * FROM job_items WHERE job_id = ? ORDER BY id', [id]);
  return job;
}

function listJobs() {
  return queryAll(
    `SELECT id, type, label, status, total, completed, failed, error, created_at, updated_at
     FROM jobs ORDER BY created_at DESC`
  );
}

function setJobStatus(id, status, error = null) {
  const now = new Date().toISOString();
  run(`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`, [status, error, now, id]);
}

function updateJobCounts(jobId) {
  const { completed } = queryOne(
    `SELECT COUNT(*) AS completed FROM job_items WHERE job_id = ? AND status = 'success'`, [jobId]
  );
  const { failed } = queryOne(
    `SELECT COUNT(*) AS failed FROM job_items WHERE job_id = ? AND status = 'failed'`, [jobId]
  );
  const now = new Date().toISOString();
  run(
    `UPDATE jobs SET completed = ?, failed = ?, updated_at = ? WHERE id = ?`,
    [completed, failed, now, jobId]
  );
}

function setItemStatus(jobId, name, status, error = null) {
  const now = new Date().toISOString();
  if (status === 'running') {
    run(
      `UPDATE job_items SET status = 'running', started_at = ? WHERE job_id = ? AND name = ?`,
      [now, jobId, name]
    );
  } else {
    run(
      `UPDATE job_items SET status = ?, error = ?, finished_at = ? WHERE job_id = ? AND name = ?`,
      [status, error, now, jobId, name]
    );
    updateJobCounts(jobId);
  }
}

function deleteJob(id) {
  // Delete job items first (foreign key)
  run(`DELETE FROM job_items WHERE job_id = ?`, [id]);
  // Then delete the job itself
  run(`DELETE FROM jobs WHERE id = ?`, [id]);
}

function cancelJob(id) {
  // Mark job as cancelled/stopped (update status to failed to indicate it didn't complete)
  run(`UPDATE jobs SET status = 'failed', updated_at = datetime('now') WHERE id = ?`, [id]);
  // Mark any running items as failed
  run(`UPDATE job_items SET status = 'failed', error = 'Cancelled by user', finished_at = datetime('now') WHERE job_id = ? AND status = 'running'`, [id]);
}

function pauseJob(id) {
  // Mark job as paused
  run(`UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?`, [id]);
}

function resumeJob(id) {
  // Mark job as running (resume from pause)
  run(`UPDATE jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`, [id]);
}

function addGLSyncDetail(jobId, { accountNumber, accountName, oldValue, newValue, fieldChanged, status = 'success', error = null }) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO gl_sync_details (job_id, account_number, account_name, old_value, new_value, field_changed, status, error, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, accountNumber, accountName, oldValue, newValue, fieldChanged, status, error, now]
  );
}

function getGLSyncDetails(jobId) {
  return queryAll(
    `SELECT * FROM gl_sync_details WHERE job_id = ? ORDER BY synced_at DESC`,
    [jobId]
  );
}

function addKpiSnapshot(jobId, { companyName, periodStart, periodEnd, benchmarkQuarter, summary }) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO kpi_snapshots (job_id, company_name, period_start, period_end, benchmark_quarter, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobId, companyName, periodStart, periodEnd, benchmarkQuarter, JSON.stringify(summary), now]
  );
}

function getKpiSnapshot(jobId) {
  const row = queryOne('SELECT * FROM kpi_snapshots WHERE job_id = ?', [jobId]);
  if (!row) return null;
  row.summary = JSON.parse(row.summary_json);
  delete row.summary_json;
  return row;
}

/**
 * Overwrites an existing kpi_snapshot's summary wholesale. Used by callers
 * that need to merge in new data (e.g. a qbr-export health import) AND
 * recompute derived fields (e.g. flags) in one write — see
 * server/api/qbr.js's /health-import route for the orchestration.
 */
function updateKpiSnapshotSummary(jobId, summary) {
  run(`UPDATE kpi_snapshots SET summary_json = ? WHERE job_id = ?`, [JSON.stringify(summary), jobId]);
}

function addWellnessSnapshot(jobId, { companyHost, companyName, weekEnding, benchmarkQuarter, summary }) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO wellness_snapshots (job_id, company_host, company_name, week_ending, benchmark_quarter, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobId, companyHost, companyName, weekEnding, benchmarkQuarter, JSON.stringify(summary), now]
  );
}

function getWellnessSnapshot(jobId) {
  const row = queryOne('SELECT * FROM wellness_snapshots WHERE job_id = ?', [jobId]);
  if (!row) return null;
  row.summary = JSON.parse(row.summary_json);
  delete row.summary_json;
  return row;
}

/** Most recent wellness snapshot for this host strictly before weekEnding — the source for "Prior Week" counts and trend arrows. */
function getPriorWellnessSnapshot(companyHost, weekEnding) {
  const row = queryOne(
    `SELECT * FROM wellness_snapshots WHERE company_host = ? AND week_ending < ? ORDER BY week_ending DESC LIMIT 1`,
    [companyHost, weekEnding]
  );
  if (!row) return null;
  row.summary = JSON.parse(row.summary_json);
  delete row.summary_json;
  return row;
}

/**
 * Bulk-writes a job's DSO rollup rows (see kpiExport.js — one row each for
 * 'company', every 'region', and every 'community' scope). Deletes any
 * existing rows for this job_id first rather than INSERT OR REPLACE (no
 * natural single-column primary key across scope/scope_key/job_id) — safe
 * because a job_id is never reused for a different run.
 */
function addDsoSnapshots(jobId, rows) {
  run(`DELETE FROM dso_snapshots WHERE job_id = ?`, [jobId]);
  const now = new Date().toISOString();
  for (const r of rows) {
    run(
      `INSERT INTO dso_snapshots (job_id, company_name, scope, scope_key, scope_label, period_start, period_end, billed_revenue, ar_balance, dso_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, r.companyName, r.scope, r.scopeKey, r.scopeLabel ?? null, r.periodStart, r.periodEnd, r.billedRevenue ?? null, r.arBalance ?? null, r.dsoDays ?? null, now]
    );
  }
}

/** DSO history for one scope (e.g. scope='community', scopeKey='host::123'), oldest first — the data source for a MoM/QoQ/YoY trend chart. */
function getDsoHistory({ companyName, scope, scopeKey, limit = 12 }) {
  return queryAll(
    `SELECT * FROM dso_snapshots WHERE company_name = ? AND scope = ? AND scope_key = ? ORDER BY period_start ASC LIMIT ?`,
    [companyName, scope, scopeKey, limit]
  );
}

/** Bulk-writes a job's PPD rollup rows — see addDsoSnapshots above for the delete-then-insert rationale (no natural single-column PK across scope/scope_key/job_id, and job_id is never reused). */
function addPpdSnapshots(jobId, rows) {
  run(`DELETE FROM ppd_snapshots WHERE job_id = ?`, [jobId]);
  const now = new Date().toISOString();
  for (const r of rows) {
    run(
      `INSERT INTO ppd_snapshots (job_id, company_name, scope, scope_key, scope_label, period_start, period_end, billed_revenue, occupied_days, census_days, ppd_unit_days, ppd_census, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, r.companyName, r.scope, r.scopeKey, r.scopeLabel ?? null, r.periodStart, r.periodEnd, r.billedRevenue ?? null, r.occupiedDays ?? null, r.censusDays ?? null, r.ppdByUnitDays ?? null, r.ppdByCensus ?? null, now]
    );
  }
}

/** PPD history for one scope, oldest first — same shape/use as getDsoHistory. */
function getPpdHistory({ companyName, scope, scopeKey, limit = 12 }) {
  return queryAll(
    `SELECT * FROM ppd_snapshots WHERE company_name = ? AND scope = ? AND scope_key = ? ORDER BY period_start ASC LIMIT ?`,
    [companyName, scope, scopeKey, limit]
  );
}

function normalizeNameKey(name) {
  return (name || '').trim().toLowerCase();
}

/** Splits a (possibly comma-separated) companyHost string into a clean list — same shape as kpiExport.js's parseHosts, duplicated here to avoid a cross-module dependency for one string split. */
function parseHostList(companyHost) {
  return String(companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
}

/**
 * Remembers (or updates) which ALIS subdomain a company uses. Matches by
 * hubspot_company_id first (stable across a company being renamed in
 * HubSpot), falling back to name_key for accounts run without a HubSpot
 * link. Call this only once companyHost has been proven to work (see
 * kpiExport.js) — upserting on every attempt would let a typo overwrite a
 * previously-correct mapping.
 */
function upsertCompanyHost({ companyName, hubspotCompanyId, companyHost }) {
  if (!companyName || !companyHost) return;
  const nameKey = normalizeNameKey(companyName);
  const now = new Date().toISOString();

  let existing = null;
  if (hubspotCompanyId) {
    existing = queryOne('SELECT id FROM company_hosts WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  }
  if (!existing) {
    existing = queryOne('SELECT id FROM company_hosts WHERE name_key = ?', [nameKey]);
  }

  // A row matched by hubspot_company_id can belong to a different name_key
  // than the one this call is about to write (e.g. an account onboarded
  // once as "Hearth and Truss" and again, unlinked, as "Hearth & Truss" —
  // real case that crashed a job here) — the UPDATE below would then
  // collide with that other row's unique name_key index. Merge the
  // duplicate's hosts into this row and remove it instead of letting that
  // collision throw and take the whole job down over a data-hygiene issue.
  if (existing) {
    const duplicate = queryOne('SELECT * FROM company_hosts WHERE name_key = ? AND id != ?', [nameKey, existing.id]);
    if (duplicate) {
      const merged = Array.from(new Set([...parseHostList(companyHost), ...parseHostList(duplicate.company_host)]));
      companyHost = merged.join(',');
      run('DELETE FROM company_hosts WHERE id = ?', [duplicate.id]);
    }
  }

  if (existing) {
    run(
      `UPDATE company_hosts SET name_key = ?, company_name = ?, hubspot_company_id = ?, company_host = ?, updated_at = ? WHERE id = ?`,
      [nameKey, companyName, hubspotCompanyId || null, companyHost, now, existing.id]
    );
  } else {
    run(
      `INSERT INTO company_hosts (name_key, company_name, hubspot_company_id, company_host, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [nameKey, companyName, hubspotCompanyId || null, companyHost, now, now]
    );
  }
}

/** Looks up a remembered companyHost by hubspot_company_id first, then by company name. */
function getCompanyHost({ companyName, hubspotCompanyId } = {}) {
  if (hubspotCompanyId) {
    const row = queryOne('SELECT * FROM company_hosts WHERE hubspot_company_id = ?', [hubspotCompanyId]);
    if (row) return row;
  }
  if (companyName) {
    return queryOne('SELECT * FROM company_hosts WHERE name_key = ?', [normalizeNameKey(companyName)]);
  }
  return null;
}

/** Bulk-seed the mapping (e.g. from an exported client list). Returns the number of rows written. */
function bulkImportCompanyHosts(rows) {
  let imported = 0;
  for (const row of rows) {
    const { companyName, hubspotCompanyId, companyHost } = row;
    if (!companyName || !companyHost) continue;
    upsertCompanyHost({ companyName, hubspotCompanyId, companyHost });
    imported++;
  }
  return imported;
}

function listCompanyHosts() {
  return queryAll('SELECT * FROM company_hosts ORDER BY company_name');
}

function addUsageAuditSnapshot(jobId, { companyHost, companyName, summary }) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO usage_audit_snapshots (job_id, company_host, company_name, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [jobId, companyHost, companyName, JSON.stringify(summary), now]
  );
}

function getUsageAuditSnapshot(jobId) {
  const row = queryOne('SELECT * FROM usage_audit_snapshots WHERE job_id = ?', [jobId]);
  if (!row) return null;
  row.summary = JSON.parse(row.summary_json);
  delete row.summary_json;
  return row;
}

/**
 * Upserts one evaluation config's XML into the historical cache —
 * INSERT OR IGNORE so an already-captured (host, config_id) is never
 * overwritten (see the table's doc comment above for why: we want the
 * version that was live *when we first saw it*, not whatever's live now).
 */
function upsertEvaluationConfigVersion(host, configId, { version, name, xml }) {
  run(
    `INSERT OR IGNORE INTO evaluation_config_versions (host, config_id, version, name, xml, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [host, configId, version ?? null, name ?? null, xml, new Date().toISOString()]
  );
}

/** All cached config versions for a host — { evaluationConfigurationId, evaluationConfigurationName, evaluationConfigurationVersion, evaluationConfigurationXml } shaped to match a live getEvaluationConfigurations() row, so buildConfigCatalog() can consume either (or both, concatenated) without caring which. */
function getEvaluationConfigVersions(host) {
  return queryAll('SELECT * FROM evaluation_config_versions WHERE host = ?', [host]).map((row) => ({
    evaluationConfigurationId: row.config_id,
    evaluationConfigurationName: row.name,
    evaluationConfigurationVersion: row.version,
    evaluationConfigurationXml: row.xml,
  }));
}

function addAuditHistorySnapshot(jobId, { companyHost, companyName, summary }) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO audit_history_snapshots (job_id, company_host, company_name, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [jobId, companyHost, companyName, JSON.stringify(summary), now]
  );
}

function getAuditHistorySnapshot(jobId) {
  const row = queryOne('SELECT * FROM audit_history_snapshots WHERE job_id = ?', [jobId]);
  if (!row) return null;
  row.summary = JSON.parse(row.summary_json);
  delete row.summary_json;
  return row;
}

/**
 * Clears every row before a fresh portfolio pull — this table is meant to
 * be "current state," replaced wholesale each refresh (see its CREATE
 * TABLE comment), but nothing actually enforced that before: a company
 * that fell out of scope (e.g. the "my accounts" query narrowed from 371
 * to 109 companies once Home Office scoping was added) would otherwise
 * sit here forever as stale, never-cleaned-up data, silently inflating
 * every read.
 */
function clearAccountHealthSnapshots() {
  run('DELETE FROM account_health_snapshots');
}

function upsertAccountHealthSnapshot({
  hubspotCompanyId, companyName, lifecycleStage, serviceHealth, financialHealth,
  openTicketCount, closedTicketCount, openDealCount, openDealValueCents, arrCents, healthScore, healthBand,
}) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO account_health_snapshots (
       hubspot_company_id, company_name, lifecycle_stage, service_health_json, financial_health_json,
       open_ticket_count, closed_ticket_count, open_deal_count, open_deal_value_cents, arr_cents,
       health_score, health_band, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hubspotCompanyId, companyName, lifecycleStage,
      JSON.stringify(serviceHealth || null), JSON.stringify(financialHealth || null),
      openTicketCount || 0, closedTicketCount || 0, openDealCount || 0, openDealValueCents || 0, arrCents ?? null,
      healthScore ?? null, healthBand || null, now,
    ]
  );
}

function listAccountHealthSnapshots() {
  return queryAll('SELECT * FROM account_health_snapshots ORDER BY company_name').map((row) => ({
    ...row,
    serviceHealth: row.service_health_json ? JSON.parse(row.service_health_json) : null,
    financialHealth: row.financial_health_json ? JSON.parse(row.financial_health_json) : null,
  }));
}

function getAccountHealthSnapshot(hubspotCompanyId) {
  const row = queryOne('SELECT * FROM account_health_snapshots WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  if (!row) return null;
  return {
    ...row,
    serviceHealth: row.service_health_json ? JSON.parse(row.service_health_json) : null,
    financialHealth: row.financial_health_json ? JSON.parse(row.financial_health_json) : null,
  };
}

/**
 * Best-effort "you've already run a QBR for this account" signal for the
 * Account Health drill-down — deliberately NOT fed into the health score
 * (see accountHealthScoring.js's comments on why): a kpi-export job's
 * summary_json stores hubspotCompanyId and flags in whatever shape
 * kpiNormalizer/qbrFlags actually produce today, which doesn't line up
 * field-for-field with HUBSPOT_BRIDGE_SCHEMA.md's aspirational shape.
 * Rather than guess at a mapping, this just surfaces "N flags from the
 * most recent QBR, run on this date" plus a link to that job's own
 * dashboard, where the real detail already renders correctly. Reads the
 * whole (typically small) kpi_snapshots table once per portfolio refresh,
 * not once per company.
 */
function findRecentKpiSnapshotsByHubspotCompanyId() {
  const rows = queryAll('SELECT job_id, company_name, summary_json, created_at FROM kpi_snapshots ORDER BY created_at DESC');
  const byCompanyId = new Map();
  for (const row of rows) {
    let summary;
    try {
      summary = JSON.parse(row.summary_json);
    } catch {
      continue;
    }
    const hubspotCompanyId = summary?.hubspotCompanyId;
    if (!hubspotCompanyId || byCompanyId.has(hubspotCompanyId)) continue; // rows are DESC by created_at — first hit per id is the latest
    byCompanyId.set(hubspotCompanyId, {
      jobId: row.job_id,
      companyName: row.company_name,
      createdAt: row.created_at,
      flagCount: Array.isArray(summary.flags) ? summary.flags.length : 0,
    });
  }
  return byCompanyId;
}

module.exports = {
  initDb, getDb, createJob, getJob, listJobs, setJobStatus, setItemStatus,
  deleteJob, cancelJob, pauseJob, resumeJob, addGLSyncDetail, getGLSyncDetails,
  addKpiSnapshot, getKpiSnapshot, updateKpiSnapshotSummary, syncJobItems,
  upsertCompanyHost, getCompanyHost, bulkImportCompanyHosts, listCompanyHosts,
  addWellnessSnapshot, getWellnessSnapshot, getPriorWellnessSnapshot,
  addDsoSnapshots, getDsoHistory,
  addPpdSnapshots, getPpdHistory,
  addUsageAuditSnapshot, getUsageAuditSnapshot,
  upsertEvaluationConfigVersion, getEvaluationConfigVersions,
  addAuditHistorySnapshot, getAuditHistorySnapshot,
  clearAccountHealthSnapshots, upsertAccountHealthSnapshot, listAccountHealthSnapshots, getAccountHealthSnapshot,
  findRecentKpiSnapshotsByHubspotCompanyId,
};
