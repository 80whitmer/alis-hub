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

  // One row per resident per community per week — the rolling history the
  // "activity-pattern risk" Wellness Scorecard row needs to tell a real
  // baseline from a normal week (nothing else in this app persists
  // multi-week history; every other trend is a single prior-snapshot
  // comparison). Plain append table like community_revenue_snapshots, but
  // deduped by (company_host, week_ending) at write time via
  // replaceResidentActivityWeekly rather than by job_id, since this table is
  // read back by resident+week history, not by job_id.
  db.run(`
    CREATE TABLE IF NOT EXISTS resident_activity_weekly (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id                 TEXT NOT NULL,
      company_host           TEXT NOT NULL,
      community_id           INTEGER NOT NULL,
      resident_id            INTEGER NOT NULL,
      resident_name          TEXT,
      resident_product_type  TEXT,
      week_ending            TEXT NOT NULL,
      activity_count         INTEGER NOT NULL,
      activity_skipped_count INTEGER NOT NULL,
      created_at             TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_resident_activity_weekly_lookup ON resident_activity_weekly(company_host, resident_id, week_ending);`);

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

  // One row per crm-id-audit job — a point-in-time snapshot comparing ALIS
  // Admin's "CRM ID" field (company + each community) against the matching
  // HubSpot Record ID, same one-blob-per-job shape as usage_audit_snapshots.
  db.run(`
    CREATE TABLE IF NOT EXISTS crm_id_audit_snapshots (
      job_id                TEXT PRIMARY KEY,
      company_name          TEXT,
      alis_admin_company_id TEXT NOT NULL,
      report_json           TEXT NOT NULL,
      created_at            TEXT DEFAULT (datetime('now'))
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

  // Monthly per-community revenue/occupancy rollup (Aaron, Sep 2026) — a
  // new report cadence (kpi-export is quarterly, wellness-scorecard is
  // weekly; nothing in this app runs monthly). Modeled directly on
  // dso_snapshots/ppd_snapshots above (same one-row-per-(job,scope) shape,
  // same delete-then-reinsert-by-job_id convention, same never-pruned
  // accumulate-history intent) rather than a new pattern — this table is
  // always community-scoped (no portfolio/region rollup rows), since the
  // Team AM Dashboard rollup this feeds sums across whichever communities
  // have data itself, and per-community is the one shape nothing else in
  // this app already stores as history.
  db.run(`
    CREATE TABLE IF NOT EXISTS community_revenue_snapshots (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id               TEXT NOT NULL,
      company_name         TEXT NOT NULL,
      company_host         TEXT NOT NULL,
      community_id         INTEGER NOT NULL,
      community_name       TEXT,
      month                TEXT NOT NULL,
      charges              REAL,
      credits              REAL,
      discounts            REAL,
      net_revenue          REAL,
      unit_capacity        INTEGER,
      move_ins             INTEGER,
      move_outs            INTEGER,
      total_occupied_units INTEGER,
      occupancy_unit_days  INTEGER,
      census_days          INTEGER,
      ppd_unit_days        REAL,
      ppd_census           REAL,
      created_at           TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_community_revenue_snapshots_lookup ON community_revenue_snapshots(company_name, community_id, month);`);

  // Occupancy by product type (AL/MC/etc.) and by classification, per
  // community, for this same monthly snapshot (Aaron, Sep 2026 — Crissy's
  // team's monthly census-by-product-type/classification pull). Small JSON
  // arrays ([{ productType, occupied, pct }, ...]), not a new table — same
  // reasoning as evaluation_config_versions vs. a fully-normalized schema:
  // this is a point-in-time breakdown read back whole, never queried by
  // productType/classification value, so a join-able table would add
  // complexity with no real benefit. Added via ALTER TABLE (not in the
  // CREATE TABLE above) since this table already has real snapshot history
  // in it — same migration convention as account_health_snapshots below.
  try {
    db.run(`ALTER TABLE community_revenue_snapshots ADD COLUMN occupancy_by_product_type_json TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE community_revenue_snapshots ADD COLUMN occupancy_by_classification_json TEXT;`);
  } catch {
    // Column already exists — fine.
  }

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
      arr_added_this_year_cents INTEGER,
      arr_personally_closed_this_year_cents INTEGER,
      aging_json             TEXT,
      aging_total_cents       INTEGER,
      aging_past_due_61_plus_cents INTEGER,
      aging_as_of_date        TEXT,
      enhancement_top_count    INTEGER,
      enhancement_lesser_count INTEGER,
      other_open_ticket_count  INTEGER,
      alis_escalation_open_count INTEGER,
      active_community_count  INTEGER,
      total_capacity          INTEGER,
      current_census          INTEGER,
      occupancy_pct           REAL,
      occupancy_by_product_type_json TEXT,
      occupancy_by_classification_json TEXT,
      occupancy_as_of_date    TEXT,
      occupancy_error         TEXT,
      occupancy_error_at      TEXT,
      health_score         INTEGER,
      health_band          TEXT,
      tier                  INTEGER,
      last_activity_date    TEXT,
      refreshed_at          TEXT DEFAULT (datetime('now'))
    );
  `);
  // arr_cents/arr_added_this_year_cents/aging_* were added after this
  // table's first release — a plain CREATE TABLE IF NOT EXISTS above
  // won't retrofit them onto a DB file created before these columns
  // existed (confirmed: this session's own earlier verification run
  // already created the table without them).
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN arr_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN aging_json TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN aging_total_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN aging_past_due_61_plus_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN aging_as_of_date TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN arr_added_this_year_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  // "Added to Book" (arr_added_this_year_cents, above) vs. "Personally
  // Closed" (Sep 2026, Aaron) — see accountHealth.js's /refresh handler
  // for how this is computed (dealOwnerName === my own resolved name).
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN arr_personally_closed_this_year_cents INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN enhancement_top_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN enhancement_lesser_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN other_open_ticket_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN alis_escalation_open_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN active_community_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN total_capacity INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN current_census INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_pct REAL;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_by_product_type_json TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_by_classification_json TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_as_of_date TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_error TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN occupancy_error_at TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN tier INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN last_activity_date TEXT;`);
  } catch {
    // Column already exists — fine.
  }

  // Manually-maintained recurring-call cadence per account (Aaron, Sep
  // Avg Health Score over time (Sep 2026, Aaron: "capture the progress of
  // this kpi over time... I plan on improving my average 85 and want to
  // capture the effort and result") — a brand-new metric with no
  // historical backfill possible, so the trail legitimately starts thin
  // and grows one point per day from here. One row per (scope, scope_key,
  // day): scope_key='portfolio' is the roll-up average that feeds Account
  // Health's/Team AM's own "Avg Health Score" KPI tile trend, while a
  // per-company row (scope_key=hubspot_company_id) lets the single-account
  // QBR/KPI dashboard show ITS OWN score's trend without recomputing a
  // score there at all — it just looks up whichever portfolio dashboard
  // (Team AM's scope covers all accounts; Account Health's is the owned
  // subset) already scored that company. A captured point is written once
  // per calendar day per (scope, scope_key) — same delete-then-insert
  // convention as dso_snapshots/ppd_snapshots' job-scoped rows, just keyed
  // by day instead of job_id, so re-refreshing twice in one day overwrites
  // that day's point instead of piling up noise.
  db.run(`
    CREATE TABLE IF NOT EXISTS health_score_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      scope            TEXT NOT NULL,
      scope_key        TEXT NOT NULL,
      scope_label      TEXT,
      recorded_date    TEXT NOT NULL,
      avg_health_score REAL NOT NULL,
      account_count    INTEGER,
      created_at       TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_health_score_history_daily ON health_score_history(scope, scope_key, recorded_date);`);

  // General-purpose companion to health_score_history above — one row per
  // (scope, scope_key, metric_key, day) instead of a single fixed
  // avg_health_score column, so the AM KPI section's whole metric dropdown
  // (Total Communities, Capacity, Census, Tickets, ARR, ...) can each get
  // a trend line without a new table per metric (Aaron, Sep 2026: "add a
  // tracking/trending over time feature so the data is... put in
  // perspective with recent volumes"). Same "one point per calendar day,
  // delete-then-insert on re-refresh" convention as health_score_history.
  db.run(`
    CREATE TABLE IF NOT EXISTS kpi_metric_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      scope          TEXT NOT NULL,
      scope_key      TEXT NOT NULL,
      metric_key     TEXT NOT NULL,
      recorded_date  TEXT NOT NULL,
      value          REAL NOT NULL,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_metric_history_daily ON kpi_metric_history(scope, scope_key, metric_key, recorded_date);`);

  // 2026) — this app has no calendar API integration (no OAuth flow for
  // any provider exists anywhere in the codebase; HubSpot's own
  // private-app token is a static-token pattern, not something a
  // calendar OAuth flow could be modeled on), so this is hand-entered
  // rather than synced. A separate table, not columns on
  // account_health_snapshots, for the same reason aging_json/occupancy_*
  // are already independent of the refresh cycle there: this data has
  // its own update cadence (whenever Aaron edits it), completely
  // decoupled from HubSpot refreshes, and must never be touched by
  // pruneAccountHealthSnapshots. Account Health Dashboard only, per
  // Aaron's own scoping — not mirrored into team_am_snapshots.
  // One-time structural migration, not a plain ADD COLUMN (Sep 2026,
  // Aaron: a few real accounts genuinely have more than one recurring
  // call) — the OLD shape below had hubspot_company_id as the PRIMARY KEY
  // itself, capping this table at one row per company. SQLite can't ALTER
  // a primary key in place, so an existing old-shape table (detected by
  // the absence of an `id` column) is renamed, its rows copied into a
  // fresh multi-call-capable table, then dropped. Guarded so this only
  // ever runs once; a fresh install just creates the new shape directly.
  const recurringCallsCols = (() => {
    try {
      return queryAll("PRAGMA table_info(recurring_calls)");
    } catch {
      return [];
    }
  })();
  const recurringCallsExists = recurringCallsCols.length > 0;
  const recurringCallsHasId = recurringCallsCols.some((c) => c.name === 'id');

  if (recurringCallsExists && !recurringCallsHasId) {
    db.run(`ALTER TABLE recurring_calls RENAME TO recurring_calls_old_single_pk;`);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS recurring_calls (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      hubspot_company_id  TEXT NOT NULL,
      label               TEXT,
      cadence             TEXT,
      next_call_date      TEXT,
      calendar_link       TEXT,
      notes               TEXT,
      day_of_week         TEXT,
      time                TEXT,
      updated_at          TEXT DEFAULT (datetime('now'))
    );
  `);

  if (recurringCallsExists && !recurringCallsHasId) {
    db.run(`
      INSERT INTO recurring_calls (hubspot_company_id, cadence, next_call_date, calendar_link, notes, day_of_week, time, updated_at)
      SELECT hubspot_company_id, cadence, next_call_date, calendar_link, notes, day_of_week, time, updated_at FROM recurring_calls_old_single_pk;
    `);
    db.run(`DROP TABLE recurring_calls_old_single_pk;`);
  }

  // One row per (company, contact) HubSpot association that carries at
  // least one Key Contact label (Sep 2026 — see hubspotContacts.js's doc
  // comment for the "labeled association," not contact-property, mechanism
  // this mirrors). Replaced wholesale per company on every HubSpot refresh
  // (replaceKeyContactsForCompany), same "current state, not history"
  // reasoning as account_health_snapshots — labels_json holds the array
  // since one contact can carry more than one label at once. A composite
  // key (not a single contactId PK) because the same person can in theory
  // be a labeled contact at more than one owned company.
  db.run(`
    CREATE TABLE IF NOT EXISTS key_contacts (
      hubspot_company_id TEXT NOT NULL,
      hubspot_contact_id  TEXT NOT NULL,
      name                TEXT,
      title               TEXT,
      email               TEXT,
      phone               TEXT,
      labels_json         TEXT,
      fun_facts           TEXT,
      notes               TEXT,
      last_activity_date  TEXT,
      hubspot_url         TEXT,
      refreshed_at        TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hubspot_company_id, hubspot_contact_id)
    );
  `);

  // A deliberately SEPARATE table from account_health_snapshots above, not
  // an added column — Aaron's call (Sep 2026): the personal Account Health
  // Dashboard's refresh already does a destructive prune
  // (pruneAccountHealthSnapshots deletes any row not in that one refresh's
  // company list), scoped to just his own ~94 accounts. Unifying the two
  // would mean the Team AM Dashboard's portal-wide refresh (611+ Home
  // Offices) and Aaron's own refresh could each wipe the other's cached
  // rows. Same shape as account_health_snapshots minus the occupancy_*
  // columns (the Team AM Dashboard never pulls ALIS occupancy directly —
  // it cross-references account_health_snapshots read-only for whatever
  // Aaron has already refreshed there), plus account_manager_id/_name.
  db.run(`
    CREATE TABLE IF NOT EXISTS team_am_snapshots (
      hubspot_company_id TEXT PRIMARY KEY,
      company_name       TEXT NOT NULL,
      account_manager_id   TEXT,
      account_manager_name TEXT,
      lifecycle_stage     TEXT,
      service_health_json  TEXT,
      financial_health_json TEXT,
      open_ticket_count    INTEGER DEFAULT 0,
      closed_ticket_count  INTEGER DEFAULT 0,
      open_deal_count      INTEGER DEFAULT 0,
      open_deal_value_cents INTEGER DEFAULT 0,
      arr_cents             INTEGER,
      arr_added_this_year_cents INTEGER,
      aging_json             TEXT,
      aging_total_cents       INTEGER,
      aging_past_due_61_plus_cents INTEGER,
      aging_as_of_date        TEXT,
      enhancement_top_count    INTEGER,
      enhancement_lesser_count INTEGER,
      other_open_ticket_count  INTEGER,
      alis_escalation_open_count INTEGER,
      active_community_count  INTEGER,
      health_score         INTEGER,
      health_band          TEXT,
      tier                  INTEGER,
      last_activity_date    TEXT,
      refreshed_at          TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.run(`ALTER TABLE team_am_snapshots ADD COLUMN alis_escalation_open_count INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  // tier/last_activity_date were added after this table's first release —
  // same retrofit reasoning as account_health_snapshots above.
  try {
    db.run(`ALTER TABLE team_am_snapshots ADD COLUMN tier INTEGER;`);
  } catch {
    // Column already exists — fine.
  }
  try {
    db.run(`ALTER TABLE team_am_snapshots ADD COLUMN last_activity_date TEXT;`);
  } catch {
    // Column already exists — fine.
  }
  // occupancy_* were added once this dashboard got its OWN "Refresh
  // Occupancy Data" button (Sep 2026) instead of only cross-referencing
  // account_health_snapshots read-only — same shape as that table's
  // occupancy columns above, same retrofit pattern. hubspot_capacity is a
  // genuinely different, always-free number (HubSpot's own
  // company_total_capacity property, pulled on every regular /refresh,
  // no ALIS call involved) — kept in its own column, never summed
  // together with the ALIS-derived total_capacity.
  for (const col of [
    'total_capacity INTEGER',
    'current_census INTEGER',
    'occupancy_pct REAL',
    'occupancy_by_product_type_json TEXT',
    'occupancy_by_classification_json TEXT',
    'occupancy_as_of_date TEXT',
    'occupancy_error TEXT',
    'occupancy_error_at TEXT',
    'hubspot_capacity INTEGER',
  ]) {
    try {
      db.run(`ALTER TABLE team_am_snapshots ADD COLUMN ${col};`);
    } catch {
      // Column already exists — fine.
    }
  }

  // The Home Office's own pinned note (hs_pinned_engagement_id) — id only;
  // the note is fetched live on open. Same retrofit pattern as above.
  for (const table of ['account_health_snapshots', 'team_am_snapshots']) {
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN pinned_note_id TEXT;`);
    } catch {
      // Column already exists — fine.
    }
  }

  // HubSpot's alis_products/alis_package, for the ported Account Truth
  // model's "Enabled — per HubSpot's alis_products field" comparison
  // against the live entitlements check. Same retrofit pattern as above.
  for (const table of ['account_health_snapshots', 'team_am_snapshots']) {
    for (const col of ['products_json TEXT', 'package TEXT']) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${col};`);
      } catch {
        // Column already exists — fine.
      }
    }
  }

  // account_health_snapshots never had hubspot_capacity (team_am_snapshots
  // already does, from its own OWN "Refresh Occupancy Data" retrofit
  // above) — added so Account Health's Tier KPIs can fall back to it the
  // same way Team AM's tierKpiRollup.js already does.
  try {
    db.run(`ALTER TABLE account_health_snapshots ADD COLUMN hubspot_capacity INTEGER;`);
  } catch {
    // Column already exists — fine.
  }

  // Clicks from the ALIS Internal section (ticket link or a resource link
  // inside it). HubSpot's API doesn't expose record view counts, so "hot
  // topics" can only measure clicks made from this dashboard.
  db.run(`
    CREATE TABLE IF NOT EXISTS internal_ticket_clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id  TEXT NOT NULL,
      target     TEXT,
      clicked_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_internal_ticket_clicks_ticket ON internal_ticket_clicks (ticket_id);`);

  // Account Truth model, ported from alis-product-ops (Aaron, Sep 2026:
  // "digging the account truth model -- could we bring it over and
  // integrate it with the team am / account health dashboards"). The
  // numeric ALIS Admin Company ID (the id in
  // .../Customers/EntitlementSets/EditCompany/{id}) this app has no
  // automated way to resolve on its own — entered by hand, via the bulk
  // Excel template, or via alisCompanyDiscovery.js's directory scrape.
  // Always keyed on hubspot_company_id (unlike company_hosts' fuzzy
  // name_key scheme above) since every caller here already has it.
  db.run(`
    CREATE TABLE IF NOT EXISTS alis_admin_ids (
      hubspot_company_id    TEXT PRIMARY KEY,
      company_name          TEXT,
      alis_admin_company_id TEXT NOT NULL,
      updated_at            TEXT DEFAULT (datetime('now'))
    );
  `);

  // Latest live ALIS admin entitlement flag state per account, from the
  // portfolio-wide "Run portfolio entitlement check" job
  // (server/services/portfolioEntitlementsJob.js). One row per
  // {company, flag}, upserted (whole set replaced) each run — a snapshot,
  // not a history, since "what % of live environments have X enabled" is
  // a current-state question, not a trend. category rides along
  // pre-computed (entitlementCategories.js) so the rollup query never
  // needs to re-run the keyword matcher.
  db.run(`
    CREATE TABLE IF NOT EXISTS entitlement_snapshots (
      hubspot_company_id TEXT NOT NULL,
      company_name        TEXT,
      flag_id              TEXT NOT NULL,
      label                 TEXT,
      category              TEXT,
      enabled               INTEGER NOT NULL,
      captured_at           TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hubspot_company_id, flag_id)
    );
  `);

  saveToDisk();
}

function listAlisAdminIds() {
  return queryAll('SELECT hubspot_company_id, alis_admin_company_id FROM alis_admin_ids');
}

function getAlisAdminId(hubspotCompanyId) {
  const rows = queryAll('SELECT alis_admin_company_id FROM alis_admin_ids WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  return rows[0]?.alis_admin_company_id ?? null;
}

function setAlisAdminId({ hubspotCompanyId, companyName, alisAdminCompanyId }) {
  run(
    `INSERT INTO alis_admin_ids (hubspot_company_id, company_name, alis_admin_company_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(hubspot_company_id) DO UPDATE SET company_name = excluded.company_name, alis_admin_company_id = excluded.alis_admin_company_id, updated_at = excluded.updated_at`,
    [hubspotCompanyId, companyName || null, alisAdminCompanyId]
  );
}

/** Bulk upsert for the Download/Upload template flow and alisCompanyDiscovery.js's reviewed results — skips any row with no ID or no HubSpot id to key on. */
function bulkSetAlisAdminIds(rows) {
  let imported = 0;
  for (const r of rows) {
    if (!r.alisAdminCompanyId || !r.hubspotCompanyId) continue;
    setAlisAdminId(r);
    imported += 1;
  }
  return imported;
}

function deleteAlisAdminId(hubspotCompanyId) {
  run('DELETE FROM alis_admin_ids WHERE hubspot_company_id = ?', [hubspotCompanyId]);
}

/** Replaces one company's whole flag set in one go — a portfolio check re-derives every flag each run, so a stale flag from a company's previous, differently-configured run should disappear rather than linger. */
function replaceEntitlementSnapshot(hubspotCompanyId, companyName, flags) {
  db.run('DELETE FROM entitlement_snapshots WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  for (const f of flags) {
    db.run(
      `INSERT INTO entitlement_snapshots (hubspot_company_id, company_name, flag_id, label, category, enabled, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [hubspotCompanyId, companyName || null, f.id, f.label, f.category, f.enabled ? 1 : 0]
    );
  }
  saveToDisk();
}

/** Every captured flag row, portfolio-wide — the portfolio-entitlements rollup groups/percentages this client-side (in the API route) rather than in SQL, same "shape it in JS" convention this codebase already uses for its other rollups. */
function listEntitlementSnapshots() {
  return queryAll('SELECT hubspot_company_id, company_name, flag_id, label, category, enabled, captured_at FROM entitlement_snapshots');
}

function countEntitlementSnapshotCompanies() {
  const rows = queryAll('SELECT COUNT(DISTINCT hubspot_company_id) AS n FROM entitlement_snapshots');
  return rows[0]?.n ?? 0;
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

/**
 * Returns db.getRowsModified() (rows actually touched by this statement)
 * — no existing caller used run()'s return value before this, so adding
 * it is safe; bulkImportRecurringCalls is the first to actually need it
 * (detecting an UPDATE that silently matched zero rows). Real bug caught
 * live while verifying that exact feature: db.getRowsModified() MUST be
 * read before saveToDisk() — saveToDisk() calls db.export() internally,
 * and export() resets the modified-rows counter to 0 as a side effect
 * (confirmed directly against sql.js). Reading it after saveToDisk(), as
 * a first draft of this function did, made every UPDATE look like it
 * matched zero rows even when it had genuinely succeeded.
 */
function run(sql, params = []) {
  db.run(sql, params);
  const rowsModified = db.getRowsModified();
  saveToDisk();
  return rowsModified;
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
  // Skip names /api/jobs/create already inserted from payload.communities —
  // a duplicate row gets matched by setItemStatus's UPDATE-by-name too,
  // double-counting completed/failed.
  const existing = new Set(queryAll('SELECT name FROM job_items WHERE job_id = ?', [jobId]).map((r) => r.name));
  for (const name of itemNames) {
    if (!existing.has(name)) run(`INSERT INTO job_items (job_id, name) VALUES (?, ?)`, [jobId, name]);
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
 * Replaces this host's resident_activity_weekly rows for one week_ending —
 * deletes any existing rows for (companyHost, weekEnding) first so re-running
 * the Wellness Scorecard job for a week that's already been captured doesn't
 * double-count that week in the rolling baseline (see
 * computeActivityPatternRisk in wellnessNormalizer.js, which pools counts
 * across several weeks of history).
 */
function replaceResidentActivityWeekly(companyHost, weekEnding, rows) {
  run(`DELETE FROM resident_activity_weekly WHERE company_host = ? AND week_ending = ?`, [companyHost, weekEnding]);
  const now = new Date().toISOString();
  for (const r of rows) {
    run(
      `INSERT INTO resident_activity_weekly (job_id, company_host, community_id, resident_id, resident_name, resident_product_type, week_ending, activity_count, activity_skipped_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.jobId, companyHost, r.communityId, r.residentId, r.residentName ?? null, r.residentProductType ?? null, weekEnding, r.activityCount, r.activitySkippedCount, now]
    );
  }
}

/** This resident's weekly Activities aggregates through (and including) throughWeekEnding, most recent first — the raw material computeActivityPatternRisk splits into a "current" and "baseline" window. */
function getResidentActivityHistory(companyHost, residentId, throughWeekEnding, limit = 8) {
  return queryAll(
    `SELECT week_ending, activity_count, activity_skipped_count FROM resident_activity_weekly
     WHERE company_host = ? AND resident_id = ? AND week_ending <= ?
     ORDER BY week_ending DESC LIMIT ?`,
    [companyHost, residentId, throughWeekEnding, limit]
  );
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

/** Bulk-writes one job's per-community rows for one month — see addDsoSnapshots above for the delete-then-insert rationale (job_id is never reused for a different run). */
function addCommunityRevenueSnapshots(jobId, rows) {
  run(`DELETE FROM community_revenue_snapshots WHERE job_id = ?`, [jobId]);
  const now = new Date().toISOString();
  for (const r of rows) {
    run(
      `INSERT INTO community_revenue_snapshots (job_id, company_name, company_host, community_id, community_name, month, charges, credits, discounts, net_revenue, unit_capacity, move_ins, move_outs, total_occupied_units, occupancy_unit_days, census_days, ppd_unit_days, ppd_census, occupancy_by_product_type_json, occupancy_by_classification_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId, r.companyName, r.companyHost, r.communityId, r.communityName ?? null, r.month,
        r.charges ?? null, r.credits ?? null, r.discounts ?? null, r.netRevenue ?? null,
        r.unitCapacity ?? null, r.moveIns ?? null, r.moveOuts ?? null, r.totalOccupiedUnits ?? null,
        r.occupancyUnitDays ?? null, r.censusDays ?? null, r.ppdUnitDays ?? null, r.ppdCensus ?? null,
        r.occupancyByProductType ? JSON.stringify(r.occupancyByProductType) : null,
        r.occupancyByClassification ? JSON.stringify(r.occupancyByClassification) : null,
        now,
      ]
    );
  }
}

/** Most recent snapshot strictly before `month` for one community — same "prior period, or null on a first-ever run" shape as getPriorWellnessSnapshot. */
function getPriorCommunityRevenueSnapshot({ companyName, communityId, month }) {
  return queryOne(
    `SELECT * FROM community_revenue_snapshots WHERE company_name = ? AND community_id = ? AND month < ? ORDER BY month DESC LIMIT 1`,
    [companyName, communityId, month]
  );
}

/** Every community's snapshot for one month — the Account Health Dashboard rollup's data source, or (with `companyName`) one account's own rows for the KPI/QBR Dashboard. One row per (company, community); if a job was re-run for the same month, the most recent job_id's rows win (MAX(id) over job_id's own rowid, which increases with insert order). */
function listCommunityRevenueSnapshots({ month, companyName }) {
  if (companyName) {
    return queryAll(
      `SELECT * FROM community_revenue_snapshots
       WHERE month = ? AND company_name = ? AND id IN (
         SELECT MAX(id) FROM community_revenue_snapshots WHERE month = ? AND company_name = ? GROUP BY company_name, community_id
       )
       ORDER BY community_name`,
      [month, companyName, month, companyName]
    );
  }
  return queryAll(
    `SELECT * FROM community_revenue_snapshots
     WHERE month = ? AND id IN (
       SELECT MAX(id) FROM community_revenue_snapshots WHERE month = ? GROUP BY company_name, community_id
     )
     ORDER BY company_name, community_name`,
    [month, month]
  );
}

/** Distinct months with at least one stored snapshot, newest first — portfolio-wide by default (used by the Account Health Dashboard's "overdue" banner to find the latest available month and check whether last calendar month is missing for any actively-tracked account), or scoped to one company (used by the KPI/QBR Dashboard to find that account's own latest month, and to decide whether to show the section at all). */
function listCommunityRevenueMonths({ companyName } = {}) {
  if (companyName) {
    return queryAll(`SELECT DISTINCT month FROM community_revenue_snapshots WHERE company_name = ? ORDER BY month DESC`, [companyName]).map((r) => r.month);
  }
  return queryAll(`SELECT DISTINCT month FROM community_revenue_snapshots ORDER BY month DESC`).map((r) => r.month);
}

/** Distinct company names that have EVER been snapshotted (at least one month, any month) — the "actively tracked" set the overdue banner should nag about; an account that's never opted into this report shouldn't be flagged just because it has no data. */
function listCommunityRevenueTrackedCompanies() {
  return queryAll(`SELECT DISTINCT company_name FROM community_revenue_snapshots ORDER BY company_name`).map((r) => r.company_name);
}

/** Latest month with a snapshot, per company — what the "overdue" banner compares against "last calendar month" to decide which actively-tracked accounts are behind. */
function listCommunityRevenueLatestMonthByCompany() {
  return queryAll(`SELECT company_name AS companyName, MAX(month) AS latestMonth FROM community_revenue_snapshots GROUP BY company_name`);
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
    existing = queryOne('SELECT id, hubspot_company_id FROM company_hosts WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  }
  if (!existing) {
    existing = queryOne('SELECT id, hubspot_company_id FROM company_hosts WHERE name_key = ?', [nameKey]);
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
    // A caller that doesn't know the HubSpot ID (e.g. the admin.alisonline.com
    // directory scrape, which only has a company name) must not blank out
    // an ID a previous, better-informed caller already recorded on this row.
    const resolvedHubspotCompanyId = hubspotCompanyId || existing.hubspot_company_id || null;
    run(
      `UPDATE company_hosts SET name_key = ?, company_name = ?, hubspot_company_id = ?, company_host = ?, updated_at = ? WHERE id = ?`,
      [nameKey, companyName, resolvedHubspotCompanyId, companyHost, now, existing.id]
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

/** Removes one company_hosts row by id — e.g. to clear out a bad mapping (wrong subdomain, duplicate/garbled name) without touching the rest of the table. */
function deleteCompanyHost(id) {
  return run('DELETE FROM company_hosts WHERE id = ?', [id]);
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

function addCrmIdAuditSnapshot(jobId, { companyName, alisAdminCompanyId, report }) {
  const now = new Date().toISOString();
  run(
    `INSERT OR REPLACE INTO crm_id_audit_snapshots (job_id, company_name, alis_admin_company_id, report_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [jobId, companyName, alisAdminCompanyId, JSON.stringify(report), now]
  );
}

function getCrmIdAuditSnapshot(jobId) {
  const row = queryOne('SELECT * FROM crm_id_audit_snapshots WHERE job_id = ?', [jobId]);
  if (!row) return null;
  row.report = JSON.parse(row.report_json);
  delete row.report_json;
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
 * Removes any cached account NOT in `currentIds` — called AFTER a
 * refresh's company list is known (not a blanket wipe beforehand
 * anymore): a company that fell out of scope (e.g. the "my accounts"
 * query narrowing from 371 to 109 once Home Office scoping was added)
 * would otherwise sit here forever as stale, never-cleaned-up data,
 * silently inflating every read. Deliberately NOT a delete-everything-
 * then-reinsert — that would also wipe aging_* columns (populated on
 * their own independent weekly upload cadence, not by the HubSpot
 * refresh) for accounts that are still very much in scope.
 */
function pruneAccountHealthSnapshots(currentIds) {
  if (currentIds.length === 0) {
    run('DELETE FROM account_health_snapshots');
    return;
  }
  const placeholders = currentIds.map(() => '?').join(',');
  run(`DELETE FROM account_health_snapshots WHERE hubspot_company_id NOT IN (${placeholders})`, currentIds);
}

/**
 * Upserts a company's HubSpot-derived fields only — aging_* columns are
 * deliberately left out of the UPDATE clause (though still set on a
 * genuine first INSERT, as NULL) so a refresh never clobbers aging data
 * uploaded separately. Uses SQLite's ON CONFLICT upsert rather than
 * INSERT OR REPLACE specifically because REPLACE deletes-then-reinserts
 * the whole row, which would reset every column not in this statement —
 * ON CONFLICT DO UPDATE only touches the columns actually listed.
 */
function upsertAccountHealthSnapshot({
  hubspotCompanyId, companyName, lifecycleStage, serviceHealth, financialHealth,
  openTicketCount, closedTicketCount, openDealCount, openDealValueCents, arrCents, arrAddedThisYearCents, arrPersonallyClosedThisYearCents,
  enhancementTopCount, enhancementLesserCount, otherOpenTicketCount, alisEscalationOpenCount, activeCommunityCount, healthScore, healthBand,
  tier, lastActivityDate, pinnedNoteId, products, package: pkg, hubspotCapacity,
}) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO account_health_snapshots (
       hubspot_company_id, company_name, lifecycle_stage, service_health_json, financial_health_json,
       open_ticket_count, closed_ticket_count, open_deal_count, open_deal_value_cents, arr_cents, arr_added_this_year_cents, arr_personally_closed_this_year_cents,
       enhancement_top_count, enhancement_lesser_count, other_open_ticket_count, alis_escalation_open_count, active_community_count,
       health_score, health_band, tier, last_activity_date, pinned_note_id, products_json, package, hubspot_capacity, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hubspot_company_id) DO UPDATE SET
       company_name = excluded.company_name,
       lifecycle_stage = excluded.lifecycle_stage,
       service_health_json = excluded.service_health_json,
       financial_health_json = excluded.financial_health_json,
       open_ticket_count = excluded.open_ticket_count,
       closed_ticket_count = excluded.closed_ticket_count,
       open_deal_count = excluded.open_deal_count,
       open_deal_value_cents = excluded.open_deal_value_cents,
       arr_cents = excluded.arr_cents,
       arr_added_this_year_cents = excluded.arr_added_this_year_cents,
       arr_personally_closed_this_year_cents = excluded.arr_personally_closed_this_year_cents,
       enhancement_top_count = excluded.enhancement_top_count,
       enhancement_lesser_count = excluded.enhancement_lesser_count,
       other_open_ticket_count = excluded.other_open_ticket_count,
       alis_escalation_open_count = excluded.alis_escalation_open_count,
       active_community_count = excluded.active_community_count,
       health_score = excluded.health_score,
       health_band = excluded.health_band,
       tier = excluded.tier,
       last_activity_date = excluded.last_activity_date,
       pinned_note_id = excluded.pinned_note_id,
       products_json = excluded.products_json,
       package = excluded.package,
       hubspot_capacity = excluded.hubspot_capacity,
       refreshed_at = excluded.refreshed_at`,
    [
      hubspotCompanyId, companyName, lifecycleStage,
      JSON.stringify(serviceHealth || null), JSON.stringify(financialHealth || null),
      openTicketCount || 0, closedTicketCount || 0, openDealCount || 0, openDealValueCents || 0, arrCents ?? null, arrAddedThisYearCents ?? null, arrPersonallyClosedThisYearCents ?? null,
      enhancementTopCount || 0, enhancementLesserCount || 0, otherOpenTicketCount || 0, alisEscalationOpenCount || 0, activeCommunityCount ?? null,
      healthScore ?? null, healthBand || null, tier ?? null, lastActivityDate ?? null, pinnedNoteId ?? null,
      JSON.stringify(products || []), pkg || null, hubspotCapacity ?? null, now,
    ]
  );
}

function listAccountHealthSnapshots() {
  return queryAll('SELECT * FROM account_health_snapshots ORDER BY company_name').map((row) => ({
    ...row,
    serviceHealth: row.service_health_json ? JSON.parse(row.service_health_json) : null,
    financialHealth: row.financial_health_json ? JSON.parse(row.financial_health_json) : null,
    aging: row.aging_json ? JSON.parse(row.aging_json) : null,
    occupancyByProductType: row.occupancy_by_product_type_json ? JSON.parse(row.occupancy_by_product_type_json) : null,
    occupancyByClassification: row.occupancy_by_classification_json ? JSON.parse(row.occupancy_by_classification_json) : null,
    products: row.products_json ? JSON.parse(row.products_json) : [],
  }));
}

/**
 * Records one calendar day's worth of Avg Health Score points for a scope
 * ('account_health' or 'team_am') — see the health_score_history table's
 * own doc comment for the (scope, scope_key, day) shape and why a
 * per-company row exists alongside the portfolio-wide 'portfolio' row.
 * Delete-then-insert per row (same convention as dso_snapshots/
 * ppd_snapshots, just keyed by today's date instead of a job_id) so
 * re-running a refresh twice in one day overwrites that day's point
 * rather than accumulating multiple points per day.
 */
function recordHealthScoreSnapshots(scope, rows) {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    run(`DELETE FROM health_score_history WHERE scope = ? AND scope_key = ? AND recorded_date = ?`, [scope, r.scopeKey, today]);
    run(
      `INSERT INTO health_score_history (scope, scope_key, scope_label, recorded_date, avg_health_score, account_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [scope, r.scopeKey, r.scopeLabel ?? null, today, r.avgHealthScore, r.accountCount ?? null]
    );
  }
}

/** Avg Health Score history for one scope/scope_key, oldest first — the data source for the Health Score Trend chart on all three dashboards. */
function getHealthScoreHistory(scope, scopeKey, limit = 366) {
  return queryAll(
    `SELECT recorded_date, avg_health_score, account_count FROM health_score_history WHERE scope = ? AND scope_key = ? ORDER BY recorded_date ASC LIMIT ?`,
    [scope, scopeKey, limit]
  );
}

/**
 * Records one calendar day's worth of KPI metric points for a scope —
 * `rows` is [{ scopeKey, metricKey, value }, ...]. Same delete-then-insert-
 * per-day convention as recordHealthScoreSnapshots above, just keyed by
 * metric_key too since one scope/day now carries several metrics' worth of
 * points instead of a single fixed column.
 */
function recordKpiMetricSnapshots(scope, rows) {
  const today = new Date().toISOString().slice(0, 10);
  // db.run + one saveToDisk at the end, not run() per statement — run()
  // rewrites the whole DB file each call, and the tier KPI rollup records
  // ~150 rows per refresh.
  for (const r of rows) {
    db.run(`DELETE FROM kpi_metric_history WHERE scope = ? AND scope_key = ? AND metric_key = ? AND recorded_date = ?`, [scope, r.scopeKey, r.metricKey, today]);
    db.run(
      `INSERT INTO kpi_metric_history (scope, scope_key, metric_key, recorded_date, value) VALUES (?, ?, ?, ?, ?)`,
      [scope, r.scopeKey, r.metricKey, today, r.value]
    );
  }
  if (rows.length > 0) saveToDisk();
}

/** Every point for a scope as flat rows [{scope_key, metric_key, recorded_date, value}], oldest first — the shape the tier KPI charts pivot client-side. */
function getKpiMetricHistoryRows(scope) {
  return queryAll(
    `SELECT scope_key, metric_key, recorded_date, value FROM kpi_metric_history WHERE scope = ? ORDER BY recorded_date ASC`,
    [scope]
  );
}

/** All KPI metrics' history for one scope/scope_key, oldest first, grouped by metric_key — the data source for the AM KPI section's trend chart. */
function getKpiMetricHistory(scope, scopeKey, limit = 366) {
  const rows = queryAll(
    `SELECT metric_key, recorded_date, value FROM kpi_metric_history WHERE scope = ? AND scope_key = ? ORDER BY recorded_date ASC LIMIT ?`,
    [scope, scopeKey, limit * 20]
  );
  const byMetric = {};
  for (const r of rows) {
    (byMetric[r.metric_key] ||= []).push({ recorded_date: r.recorded_date, value: r.value });
  }
  return byMetric;
}

/**
 * Writes (or clears, if occupancy is null) one account's capacity/census
 * snapshot — a plain UPDATE on its own independent cadence (an ALIS API
 * pull, not a HubSpot one), same reasoning as updateAccountHealthAging.
 */
function updateAccountHealthOccupancy(hubspotCompanyId, occupancy) {
  run(
    `UPDATE account_health_snapshots
     SET total_capacity = ?, current_census = ?, occupancy_pct = ?,
         occupancy_by_product_type_json = ?, occupancy_by_classification_json = ?, occupancy_as_of_date = ?,
         occupancy_error = NULL, occupancy_error_at = NULL
     WHERE hubspot_company_id = ?`,
    [
      occupancy?.totalRoomDays ?? null,
      occupancy?.occupiedRoomDays ?? null,
      occupancy?.pct ?? null,
      occupancy?.byProductType ? JSON.stringify(occupancy.byProductType) : null,
      occupancy?.byClassification ? JSON.stringify(occupancy.byClassification) : null,
      occupancy?.asOfDate ?? null,
      hubspotCompanyId,
    ]
  );
}

/** Every manually-entered recurring-call row — see the recurring_calls CREATE TABLE comment above for why this is hand-entered rather than calendar-synced. */
function listRecurringCalls() {
  return queryAll('SELECT * FROM recurring_calls');
}

/** Every cached Key Contact row, portfolio-wide — labels_json parsed back into an array for callers. */
function listKeyContacts() {
  return queryAll('SELECT * FROM key_contacts').map((row) => ({
    ...row,
    labels: row.labels_json ? JSON.parse(row.labels_json) : [],
  }));
}

/**
 * Replaces one company's ENTIRE set of Key Contact rows with `contacts` —
 * delete-then-reinsert scoped to just this company, not a table-wide wipe,
 * so a slow/failing refresh for one company can never affect another's
 * already-cached contacts. Matches the "current state, not history"
 * reasoning behind account_health_snapshots, applied per-company since
 * that's the natural unit hubspotContacts.getKeyContactsForCompany already
 * fetches in.
 */
function replaceKeyContactsForCompany(hubspotCompanyId, contacts) {
  const now = new Date().toISOString();
  run('DELETE FROM key_contacts WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  for (const c of contacts) {
    run(
      `INSERT INTO key_contacts (hubspot_company_id, hubspot_contact_id, name, title, email, phone, labels_json, fun_facts, notes, last_activity_date, hubspot_url, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hubspotCompanyId, c.contactId, c.name || null, c.title || null, c.email || null, c.phone || null,
        JSON.stringify(c.labels || []), c.funFacts || null, c.notes || null, c.lastActivityDate || null, c.hubspotUrl || null, now,
      ]
    );
  }
}

/** Drops every cached Key Contact row for a company NOT in `currentCompanyIds` — same after-the-refresh-loop cleanup as pruneAccountHealthSnapshots, so a company that fell out of the owned portfolio doesn't leave its contacts behind forever. */
function pruneKeyContacts(currentCompanyIds) {
  if (currentCompanyIds.length === 0) {
    run('DELETE FROM key_contacts');
    return;
  }
  const placeholders = currentCompanyIds.map(() => '?').join(',');
  run(`DELETE FROM key_contacts WHERE hubspot_company_id NOT IN (${placeholders})`, currentCompanyIds);
}

/**
 * Creates ONE new recurring call for an account (Sep 2026 — accounts can
 * now have more than one, e.g. a weekly ops sync AND a separate monthly
 * QBR-prep call). `label` is the one new field: optional, exists purely to
 * distinguish multiple calls on the same account in the UI/rollup/export
 * — meaningless and left blank for an account with only one. Returns the
 * new row's id (SELECT last_insert_rowid() right after the insert is safe
 * here — sql.js runs single-threaded/synchronous in this process, no
 * concurrent writer could interleave between the two statements).
 */
function createRecurringCall({ hubspotCompanyId, label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time }) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO recurring_calls (hubspot_company_id, label, cadence, next_call_date, calendar_link, notes, day_of_week, time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [hubspotCompanyId, label || null, cadence || null, nextCallDate || null, calendarLink || null, notes || null, dayOfWeek || null, time || null, now]
  );
  // MAX(id), not last_insert_rowid() — confirmed live (Sep 2026) that
  // sql.js's `db.run()` wrapper doesn't leave last_insert_rowid() queryable
  // via a separate db.prepare() call the way raw sqlite3 does (it came
  // back 0). MAX(id) is just as safe here — single-threaded/synchronous
  // process, no concurrent insert could land between the statement above
  // and this one.
  return queryOne('SELECT MAX(id) AS id FROM recurring_calls').id;
}

/** Updates ONE existing recurring call by its own id — same "null clears a field" convention the old per-company upsert used, just targeted at a specific call now instead of a whole account. */
/** Returns true if a row with this id actually existed and was updated — false means the id didn't match anything (a real case, not just theoretical: a bulk-template row can arrive with a stale/fabricated/typo'd Call ID, and silently doing nothing there is how "I filled in 13 rows and only 2 changed" bugs happen — see bulkImportRecurringCalls's fallback-to-create). */
function updateRecurringCall(id, { label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time }) {
  const now = new Date().toISOString();
  const rowsModified = run(
    `UPDATE recurring_calls
     SET label = ?, cadence = ?, next_call_date = ?, calendar_link = ?, notes = ?, day_of_week = ?, time = ?, updated_at = ?
     WHERE id = ?`,
    [label || null, cadence || null, nextCallDate || null, calendarLink || null, notes || null, dayOfWeek || null, time || null, now, id]
  );
  return rowsModified > 0;
}

/** Deletes ONE recurring call by its own id (vs. the old per-company delete) — used by a call card's "Delete" action so removing one call never touches any other call on the same account. */
function deleteRecurringCall(id) {
  run('DELETE FROM recurring_calls WHERE id = ?', [id]);
}

/**
 * Mirrors bulkImportCompanyHosts — same "skip rows with nothing usable,
 * import the rest" bulk-seed pattern, for the Recurring Calls bulk
 * download-template/upload-completed-template flow. A row carrying an
 * `id` (Call ID) updates that specific existing call; a row with no id
 * creates a brand new one — this is how the same account can pick up a
 * 2nd/3rd call from the template, by hand-adding extra rows with the same
 * HubSpot Company ID and a blank Call ID. Rows with no hubspotCompanyId,
 * or with every other field blank, are skipped either way.
 *
 * **Real bug found and fixed (Sep 2026):** a re-uploaded template had 13
 * filled-in rows, but only 2 actually took effect — the other 11 carried
 * fabricated/stale Call IDs (sequential numbers that were never real,
 * apparently assigned by whatever filled the template in rather than
 * left blank as the header instructs) that didn't match any existing
 * row. `updateRecurringCall` against a nonexistent id is a real, valid
 * SQL UPDATE that just matches zero rows — no error, no exception, just
 * silently nothing — so this failed completely invisibly. Now checks
 * `updateRecurringCall`'s own true/false result (whether a row actually
 * existed) and falls back to creating a brand-new call for that
 * company when the id didn't resolve to anything, rather than treating
 * "has an id" as a guarantee that id is real. Reports how many rows hit
 * this fallback so it's visible on the dashboard, not just something a
 * future person has to discover by noticing data went missing.
 */
function bulkImportRecurringCalls(rows) {
  let imported = 0;
  let staleIdFallbackCount = 0;
  for (const row of rows) {
    const { id, hubspotCompanyId, label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time } = row;
    if (!cadence && !nextCallDate && !calendarLink && !notes && !dayOfWeek && !time && !label) continue;
    const fields = { label, cadence, nextCallDate, calendarLink, notes, dayOfWeek, time };
    if (id) {
      const updated = updateRecurringCall(id, fields);
      if (updated) {
        imported++;
      } else if (hubspotCompanyId) {
        createRecurringCall({ hubspotCompanyId, ...fields });
        imported++;
        staleIdFallbackCount++;
      }
      // id given, update matched nothing, AND no hubspotCompanyId to fall
      // back on — genuinely unrecoverable, correctly not counted as imported.
    } else if (hubspotCompanyId) {
      createRecurringCall({ hubspotCompanyId, ...fields });
      imported++;
    }
  }
  return { imported, staleIdFallbackCount };
}

/**
 * Records why the last occupancy pull failed for one account — Aaron
 * asked (Sep 2026) after a real 94-account run came back "2 failed"
 * with no way to tell which two from the dashboard itself (the error
 * only ever lived inside that one job run's job_items rows, gone from
 * view once a newer job started). Cleared automatically by
 * updateAccountHealthOccupancy's own UPDATE the next time a pull for
 * this account succeeds — never needs an explicit "clear" call.
 */
function setAccountHealthOccupancyError(hubspotCompanyId, errorMessage) {
  run(
    `UPDATE account_health_snapshots SET occupancy_error = ?, occupancy_error_at = ? WHERE hubspot_company_id = ?`,
    [errorMessage, new Date().toISOString(), hubspotCompanyId]
  );
}

/**
 * Writes (or clears, if aging is null) one account's aging-report data —
 * a plain UPDATE, not part of upsertAccountHealthSnapshot's insert/upsert,
 * since this runs on its own independent weekly-upload cadence (see
 * server/services/agingReportParser.js/agingReportMatcher.js), completely
 * decoupled from the HubSpot refresh cycle.
 */
function updateAccountHealthAging(hubspotCompanyId, aging) {
  run(
    `UPDATE account_health_snapshots
     SET aging_json = ?, aging_total_cents = ?, aging_past_due_61_plus_cents = ?, aging_as_of_date = ?
     WHERE hubspot_company_id = ?`,
    [
      aging ? JSON.stringify(aging) : null,
      aging?.totalCents ?? null,
      aging?.pastDue61PlusCents ?? null,
      aging?.asOfDate ?? null,
      hubspotCompanyId,
    ]
  );
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

/**
 * Same "most recent job per company, for a same-day link out" reduction as
 * findRecentKpiSnapshotsByHubspotCompanyId above, generalized for the other
 * per-company job types (wellness_snapshots, usage_audit_snapshots,
 * crm_id_audit_snapshots) that also stamp their own hubspotCompanyId into
 * their JSON blob — just nested differently per job, so the caller passes
 * getHubspotCompanyId to pull it out of whatever shape that job's own
 * normalizer produces. Returns the parsed JSON too (as `data`) so the
 * caller can pull whatever job-specific headline figure it wants without
 * this function needing to know each job's shape.
 */
function findRecentJobSnapshotsByHubspotCompanyId(table, jsonColumn, getHubspotCompanyId) {
  const rows = queryAll(`SELECT job_id, company_name, ${jsonColumn} AS data_json, created_at FROM ${table} ORDER BY created_at DESC`);
  const byCompanyId = new Map();
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      continue;
    }
    const hubspotCompanyId = getHubspotCompanyId(data);
    if (!hubspotCompanyId || byCompanyId.has(hubspotCompanyId)) continue; // rows are DESC by created_at — first hit per id is the latest
    byCompanyId.set(hubspotCompanyId, { jobId: row.job_id, companyName: row.company_name, createdAt: row.created_at, data });
  }
  return byCompanyId;
}

/**
 * Most recent Audit History job per company_host. Audit History jobs don't
 * stamp hubspotCompanyId into their own JSON (see auditHistoryJob.js — the
 * payload only ever carries companyHost), so this is the one deliverable
 * of these keyed by company_host instead of hubspotCompanyId — joined the
 * same way getEnrichedAccounts (accountHealth.js) already resolves each
 * account's company_host for AlisQuickLinks.
 */
function findRecentAuditHistorySnapshotsByCompanyHost() {
  const rows = queryAll('SELECT job_id, company_host, company_name, created_at FROM audit_history_snapshots ORDER BY created_at DESC');
  const byHost = new Map();
  for (const row of rows) {
    if (!row.company_host || byHost.has(row.company_host)) continue; // rows are DESC by created_at — first hit per host is the latest
    byHost.set(row.company_host, { jobId: row.job_id, companyName: row.company_name, createdAt: row.created_at });
  }
  return byHost;
}

/** Same reasoning as pruneAccountHealthSnapshots — deleting rows for companies no longer in the fresh team-wide pull, without touching aging_json (its own independent upload cadence). This table has exactly one writer (the Team AM Dashboard's own refresh), so a full-list prune here is safe in a way it wouldn't be if this table were shared. */
function pruneTeamAmSnapshots(currentIds) {
  if (currentIds.length === 0) {
    run('DELETE FROM team_am_snapshots');
    return;
  }
  const placeholders = currentIds.map(() => '?').join(',');
  run(`DELETE FROM team_am_snapshots WHERE hubspot_company_id NOT IN (${placeholders})`, currentIds);
}

/** Mirrors upsertAccountHealthSnapshot — see that function's comment for why ON CONFLICT DO UPDATE (not INSERT OR REPLACE) and why aging_* stays out of the UPDATE clause. */
function upsertTeamAmSnapshot({
  hubspotCompanyId, companyName, accountManagerId, accountManagerName, lifecycleStage, serviceHealth, financialHealth,
  openTicketCount, closedTicketCount, openDealCount, openDealValueCents, arrCents, arrAddedThisYearCents,
  enhancementTopCount, enhancementLesserCount, otherOpenTicketCount, alisEscalationOpenCount, activeCommunityCount, healthScore, healthBand,
  tier, lastActivityDate, hubspotCapacity, pinnedNoteId, products, package: pkg,
}) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO team_am_snapshots (
       hubspot_company_id, company_name, account_manager_id, account_manager_name, lifecycle_stage,
       service_health_json, financial_health_json,
       open_ticket_count, closed_ticket_count, open_deal_count, open_deal_value_cents, arr_cents, arr_added_this_year_cents,
       enhancement_top_count, enhancement_lesser_count, other_open_ticket_count, alis_escalation_open_count, active_community_count,
       health_score, health_band, tier, last_activity_date, hubspot_capacity, pinned_note_id, products_json, package, refreshed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hubspot_company_id) DO UPDATE SET
       company_name = excluded.company_name,
       account_manager_id = excluded.account_manager_id,
       account_manager_name = excluded.account_manager_name,
       lifecycle_stage = excluded.lifecycle_stage,
       service_health_json = excluded.service_health_json,
       financial_health_json = excluded.financial_health_json,
       open_ticket_count = excluded.open_ticket_count,
       closed_ticket_count = excluded.closed_ticket_count,
       open_deal_count = excluded.open_deal_count,
       open_deal_value_cents = excluded.open_deal_value_cents,
       arr_cents = excluded.arr_cents,
       arr_added_this_year_cents = excluded.arr_added_this_year_cents,
       enhancement_top_count = excluded.enhancement_top_count,
       enhancement_lesser_count = excluded.enhancement_lesser_count,
       other_open_ticket_count = excluded.other_open_ticket_count,
       alis_escalation_open_count = excluded.alis_escalation_open_count,
       active_community_count = excluded.active_community_count,
       health_score = excluded.health_score,
       health_band = excluded.health_band,
       tier = excluded.tier,
       last_activity_date = excluded.last_activity_date,
       hubspot_capacity = excluded.hubspot_capacity,
       pinned_note_id = excluded.pinned_note_id,
       products_json = excluded.products_json,
       package = excluded.package,
       refreshed_at = excluded.refreshed_at`,
    [
      hubspotCompanyId, companyName, accountManagerId ?? null, accountManagerName ?? null, lifecycleStage,
      JSON.stringify(serviceHealth || null), JSON.stringify(financialHealth || null),
      openTicketCount || 0, closedTicketCount || 0, openDealCount || 0, openDealValueCents || 0, arrCents ?? null, arrAddedThisYearCents ?? null,
      enhancementTopCount || 0, enhancementLesserCount || 0, otherOpenTicketCount || 0, alisEscalationOpenCount || 0, activeCommunityCount ?? null,
      healthScore ?? null, healthBand || null, tier ?? null, lastActivityDate ?? null, hubspotCapacity ?? null, pinnedNoteId ?? null,
      JSON.stringify(products || []), pkg || null, now,
    ]
  );
}

function listTeamAmSnapshots() {
  return queryAll('SELECT * FROM team_am_snapshots ORDER BY company_name').map((row) => ({
    ...row,
    serviceHealth: row.service_health_json ? JSON.parse(row.service_health_json) : null,
    financialHealth: row.financial_health_json ? JSON.parse(row.financial_health_json) : null,
    aging: row.aging_json ? JSON.parse(row.aging_json) : null,
    occupancyByProductType: row.occupancy_by_product_type_json ? JSON.parse(row.occupancy_by_product_type_json) : null,
    occupancyByClassification: row.occupancy_by_classification_json ? JSON.parse(row.occupancy_by_classification_json) : null,
    products: row.products_json ? JSON.parse(row.products_json) : [],
  }));
}

/** Mirrors updateAccountHealthAging — its own independent upload cadence, decoupled from the HubSpot refresh cycle. */
function updateTeamAmAging(hubspotCompanyId, aging) {
  run(
    `UPDATE team_am_snapshots
     SET aging_json = ?, aging_total_cents = ?, aging_past_due_61_plus_cents = ?, aging_as_of_date = ?
     WHERE hubspot_company_id = ?`,
    [
      aging ? JSON.stringify(aging) : null,
      aging?.totalCents ?? null,
      aging?.pastDue61PlusCents ?? null,
      aging?.asOfDate ?? null,
      hubspotCompanyId,
    ]
  );
}

/**
 * Mirrors updateAccountHealthOccupancy verbatim, targeting team_am_snapshots
 * instead — this dashboard's own ALIS occupancy pull (Sep 2026), added
 * alongside the existing read-only cross-reference into
 * account_health_snapshots (see getEnrichedTeamAmAccounts in teamAm.js),
 * not as a replacement for it.
 */
function updateTeamAmOccupancy(hubspotCompanyId, occupancy) {
  run(
    `UPDATE team_am_snapshots
     SET total_capacity = ?, current_census = ?, occupancy_pct = ?,
         occupancy_by_product_type_json = ?, occupancy_by_classification_json = ?, occupancy_as_of_date = ?,
         occupancy_error = NULL, occupancy_error_at = NULL
     WHERE hubspot_company_id = ?`,
    [
      occupancy?.totalRoomDays ?? null,
      occupancy?.occupiedRoomDays ?? null,
      occupancy?.pct ?? null,
      occupancy?.byProductType ? JSON.stringify(occupancy.byProductType) : null,
      occupancy?.byClassification ? JSON.stringify(occupancy.byClassification) : null,
      occupancy?.asOfDate ?? null,
      hubspotCompanyId,
    ]
  );
}

/** Mirrors setAccountHealthOccupancyError verbatim, targeting team_am_snapshots. */
function setTeamAmOccupancyError(hubspotCompanyId, errorMessage) {
  run(
    `UPDATE team_am_snapshots SET occupancy_error = ?, occupancy_error_at = ? WHERE hubspot_company_id = ?`,
    [errorMessage, new Date().toISOString(), hubspotCompanyId]
  );
}

function recordInternalTicketClick(ticketId, target) {
  run(`INSERT INTO internal_ticket_clicks (ticket_id, target, clicked_at) VALUES (?, ?, ?)`, [String(ticketId), target || null, new Date().toISOString()]);
}

/** Map<ticketId, {clicks, clicks30d, lastClickedAt}>. */
function getInternalTicketClickStats() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = queryAll(
    `SELECT ticket_id, COUNT(*) AS clicks, SUM(CASE WHEN clicked_at >= ? THEN 1 ELSE 0 END) AS clicks_30d, MAX(clicked_at) AS last_clicked_at
     FROM internal_ticket_clicks GROUP BY ticket_id`,
    [since]
  );
  return new Map(rows.map((r) => [r.ticket_id, { clicks: r.clicks, clicks30d: r.clicks_30d || 0, lastClickedAt: r.last_clicked_at }]));
}

function getTeamAmSnapshot(hubspotCompanyId) {
  const row = queryOne('SELECT * FROM team_am_snapshots WHERE hubspot_company_id = ?', [hubspotCompanyId]);
  if (!row) return null;
  return {
    ...row,
    serviceHealth: row.service_health_json ? JSON.parse(row.service_health_json) : null,
    financialHealth: row.financial_health_json ? JSON.parse(row.financial_health_json) : null,
    aging: row.aging_json ? JSON.parse(row.aging_json) : null,
    occupancyByProductType: row.occupancy_by_product_type_json ? JSON.parse(row.occupancy_by_product_type_json) : null,
    occupancyByClassification: row.occupancy_by_classification_json ? JSON.parse(row.occupancy_by_classification_json) : null,
  };
}

module.exports = {
  initDb, getDb, createJob, getJob, listJobs, setJobStatus, setItemStatus,
  deleteJob, cancelJob, pauseJob, resumeJob, addGLSyncDetail, getGLSyncDetails,
  addKpiSnapshot, getKpiSnapshot, updateKpiSnapshotSummary, syncJobItems,
  upsertCompanyHost, getCompanyHost, bulkImportCompanyHosts, listCompanyHosts, deleteCompanyHost,
  addWellnessSnapshot, getWellnessSnapshot, getPriorWellnessSnapshot,
  replaceResidentActivityWeekly, getResidentActivityHistory,
  addDsoSnapshots, getDsoHistory,
  addPpdSnapshots, getPpdHistory,
  addCommunityRevenueSnapshots, getPriorCommunityRevenueSnapshot,
  listCommunityRevenueSnapshots, listCommunityRevenueMonths, listCommunityRevenueTrackedCompanies,
  listCommunityRevenueLatestMonthByCompany,
  addUsageAuditSnapshot, getUsageAuditSnapshot,
  addCrmIdAuditSnapshot, getCrmIdAuditSnapshot,
  upsertEvaluationConfigVersion, getEvaluationConfigVersions,
  addAuditHistorySnapshot, getAuditHistorySnapshot,
  pruneAccountHealthSnapshots, upsertAccountHealthSnapshot, listAccountHealthSnapshots, getAccountHealthSnapshot,
  updateAccountHealthAging, updateAccountHealthOccupancy, setAccountHealthOccupancyError,
  recordHealthScoreSnapshots, getHealthScoreHistory,
  recordKpiMetricSnapshots, getKpiMetricHistory, getKpiMetricHistoryRows,
  listRecurringCalls, createRecurringCall, updateRecurringCall, deleteRecurringCall, bulkImportRecurringCalls,
  listKeyContacts, replaceKeyContactsForCompany, pruneKeyContacts,
  pruneTeamAmSnapshots, upsertTeamAmSnapshot, listTeamAmSnapshots, updateTeamAmAging, getTeamAmSnapshot,
  updateTeamAmOccupancy, setTeamAmOccupancyError,
  findRecentKpiSnapshotsByHubspotCompanyId,
  findRecentJobSnapshotsByHubspotCompanyId, findRecentAuditHistorySnapshotsByCompanyHost,
  recordInternalTicketClick, getInternalTicketClickStats,
  listAlisAdminIds, getAlisAdminId, setAlisAdminId, bulkSetAlisAdminIds, deleteAlisAdminId,
  replaceEntitlementSnapshot, listEntitlementSnapshots, countEntitlementSnapshotCompanies,
};
