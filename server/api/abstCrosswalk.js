const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { REPORTS_ROOT } = require('../automation/abstCrosswalkJob');

/** jobIds are UUIDs — reject anything else before it touches the filesystem. */
function jobDir(jobId) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return path.join(REPORTS_ROOT, jobId);
}

function readReport(jobId) {
  const dir = jobDir(jobId);
  const file = dir && path.join(dir, 'report.json');
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// GET /api/abst-crosswalk/:jobId — header, community summary, resident picker list (no per-element detail)
router.get('/:jobId', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job (has it completed yet?)' });
    res.json({
      meta: report.meta,
      filename: report.filename,
      summary: report.summary,
      residents: report.residents.map((r) => ({
        residentId: r.residentId,
        name: r.name,
        unit: r.unit,
        productType: r.productType,
        evaluationDate: r.evaluation?.date ?? null,
        weeklyCaregiverMinutes: r.weeklyCaregiverMinutes,
        gaps: r.elements.filter((e) => e.status === 'assessed_no_minutes').length,
        notAssessed: r.elements.filter((e) => e.status === 'not_assessed').length,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/resident/:residentId — one resident, all 22 elements
router.get('/:jobId/resident/:residentId', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    const resident = report.residents.find((r) => String(r.residentId) === req.params.residentId);
    if (!resident) return res.status(404).json({ error: 'Resident not found in this report.' });
    res.json({ meta: report.meta, resident });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/download — the .xlsx
router.get('/:jobId/download', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    const file = path.join(jobDir(req.params.jobId), path.basename(report.filename));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Workbook file is missing on disk.' });
    res.download(file, report.filename);
  } catch (err) {
    console.error('[abst-crosswalk GET /:jobId/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
