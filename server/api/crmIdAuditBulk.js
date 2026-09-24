const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { REPORTS_ROOT } = require('../automation/crmIdAuditBulk');

/** jobIds are UUIDs — reject anything else before it touches the filesystem. */
function jobDir(jobId) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return path.join(REPORTS_ROOT, jobId);
}

function readSummary(jobId) {
  const dir = jobDir(jobId);
  const file = dir && path.join(dir, 'summary.json');
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// GET /api/crm-id-audit-bulk/:jobId — manifest for a completed bulk audit job
router.get('/:jobId', (req, res) => {
  try {
    const summary = readSummary(req.params.jobId);
    if (!summary) return res.status(404).json({ error: 'No CRM ID audit report found for this job (has it completed yet?)' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm-id-audit-bulk/:jobId/download — the portfolio-wide .xlsx
router.get('/:jobId/download', (req, res) => {
  try {
    const summary = readSummary(req.params.jobId);
    if (!summary) return res.status(404).json({ error: 'No CRM ID audit report found for this job.' });
    const file = path.join(jobDir(req.params.jobId), path.basename(summary.filename));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Workbook file is missing on disk.' });
    res.download(file, summary.filename);
  } catch (err) {
    console.error('[crm-id-audit-bulk GET /:jobId/download] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
