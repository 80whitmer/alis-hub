const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { REPORTS_ROOT } = require('../automation/alertSubscriptionsJob');
const { summarize, buildWorkbook } = require('../services/alertSubscriptionsReport');
const { getJob } = require('../db/database');

/** jobIds are UUIDs — reject anything else before it touches the filesystem. */
function readResults(jobId) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const file = path.join(REPORTS_ROOT, jobId, 'results.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// GET /api/alert-subscriptions/:jobId — headline counts, per-person rollup, follow-up list
router.get('/:jobId', (req, res) => {
  try {
    const data = readResults(req.params.jobId);
    if (!data) return res.status(404).json({ error: 'No results file for this job yet (has it processed any pairs?).' });
    res.json({ jobId: data.jobId, alertLabel: data.alertLabel, ...summarize(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alert-subscriptions/:jobId/download — Excel: Summary, Needs follow-up, All results
router.get('/:jobId/download', async (req, res) => {
  try {
    const data = readResults(req.params.jobId);
    if (!data) return res.status(404).json({ error: 'No results file for this job yet.' });
    const job = getJob(req.params.jobId);
    const wb = buildWorkbook({ ...data, jobLabel: job?.label || '' });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `Sentinel Event alert subscriptions${data.dryRun ? ' (dry run)' : ''} - ${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
