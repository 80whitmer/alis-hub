const express = require('express');
const router = express.Router();

const { getAuditHistorySnapshot } = require('../db/database');
const { renderAuditHistoryPdf } = require('../services/auditHistoryPdf');

// GET /api/audit-history/:jobId — snapshot for a completed audit-history job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getAuditHistorySnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No audit-history snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audit-history/:jobId/export-pdf — render and download the report as a PDF
router.get('/:jobId/export-pdf', async (req, res) => {
  try {
    const snapshot = getAuditHistorySnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No audit-history snapshot found for this job (has it completed yet?)' });

    const buffer = await renderAuditHistoryPdf(snapshot.summary);
    const filename = `${snapshot.company_name || 'Audit-History'}-${new Date(snapshot.summary.generatedAt).toISOString().slice(0, 10)}.pdf`.replace(/[^a-z0-9.\-]/gi, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[audit-history GET /:jobId/export-pdf] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
