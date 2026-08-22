const express = require('express');
const router = express.Router();

const { getKpiSnapshot } = require('../db/database');
const { getLatestBenchmarks, getBenchmarksForQuarter, listAvailableQuarters } = require('../services/alis500Benchmarks');
const { buildQbrDeck } = require('../services/qbrExport');

// GET /api/qbr/benchmarks?quarter=2026-Q2 — current (or specified) ALIS 500 benchmark dataset
router.get('/benchmarks', (req, res) => {
  try {
    const { quarter } = req.query;
    const data = quarter ? getBenchmarksForQuarter(quarter) : getLatestBenchmarks();
    res.json({ ...data, availableQuarters: listAvailableQuarters() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbr/:jobId — normalized KPI snapshot + benchmark diffs + tickets + flags for a completed kpi-export job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbr/:jobId/export-pptx — generate and download the QBR deck
router.post('/:jobId/export-pptx', async (req, res) => {
  try {
    const snapshot = getKpiSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No KPI snapshot found for this job (has it completed yet?)' });

    const buffer = await buildQbrDeck(snapshot.summary);
    const filename = `${snapshot.company_name || 'QBR'}-${snapshot.period_start}-${snapshot.period_end}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[qbr POST /:jobId/export-pptx] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
