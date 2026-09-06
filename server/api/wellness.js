const express = require('express');
const router = express.Router();

const { getWellnessSnapshot } = require('../db/database');
const { renderWellnessPdf } = require('../services/wellnessPdf');

// GET /api/wellness/:jobId — snapshot for a completed wellness-scorecard job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getWellnessSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No wellness snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wellness/:jobId/export-pdf — render and download the scorecard as a PDF
router.get('/:jobId/export-pdf', async (req, res) => {
  try {
    const snapshot = getWellnessSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No wellness snapshot found for this job (has it completed yet?)' });

    const buffer = await renderWellnessPdf(snapshot.summary);
    const filename = `${snapshot.company_name || 'Wellness-Scorecard'}-${snapshot.week_ending}.pdf`.replace(/[^a-z0-9.\-]/gi, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[wellness GET /:jobId/export-pdf] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
