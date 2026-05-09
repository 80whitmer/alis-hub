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
  // Insert job record with total count
  run(
    `INSERT INTO jobs (id, type, label, status, total, payload) VALUES (?, ?, ?, 'queued', ?, ?)`,
    [id, type, label, total, JSON.stringify(payload)]
  );

  // Create job_items for each item in the list
  // items can be communities, billing items, or any array of objects with a 'name' property
  for (const item of items) {
    run(`INSERT INTO job_items (job_id, name) VALUES (?, ?)`, [id, item.name]);
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
    `SELECT id, type, label, status, total, completed, failed, created_at, updated_at
     FROM jobs ORDER BY created_at DESC`
  );
}

function setJobStatus(id, status) {
  run(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
}

function updateJobCounts(jobId) {
  const { completed } = queryOne(
    `SELECT COUNT(*) AS completed FROM job_items WHERE job_id = ? AND status = 'success'`, [jobId]
  );
  const { failed } = queryOne(
    `SELECT COUNT(*) AS failed FROM job_items WHERE job_id = ? AND status = 'failed'`, [jobId]
  );
  run(
    `UPDATE jobs SET completed = ?, failed = ?, updated_at = datetime('now') WHERE id = ?`,
    [completed, failed, jobId]
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

module.exports = { initDb, getDb, createJob, getJob, listJobs, setJobStatus, setItemStatus };
