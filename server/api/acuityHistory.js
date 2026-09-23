const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { REPORTS_ROOT } = require('../automation/acuityHistoryJob');

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

// GET /api/acuity-history/:jobId — manifest of generated workbooks for a completed job
router.get('/:jobId', (req, res) => {
  try {
    const summary = readSummary(req.params.jobId);
    if (!summary) return res.status(404).json({ error: 'No acuity report found for this job (has it completed yet?)' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/acuity-history/:jobId/download/:index — one community's .xlsx
router.get('/:jobId/download/:index', (req, res) => {
  try {
    const summary = readSummary(req.params.jobId);
    const entry = summary?.files?.[Number(req.params.index)];
    if (!entry || entry.error) return res.status(404).json({ error: 'No workbook at that index for this job.' });
    // Filename comes from our own manifest, but still resolve through basename so it can't escape the job dir.
    const file = path.join(jobDir(req.params.jobId), path.basename(entry.filename));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Workbook file is missing on disk.' });
    res.download(file, entry.filename);
  } catch (err) {
    console.error('[acuity-history GET /:jobId/download] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
