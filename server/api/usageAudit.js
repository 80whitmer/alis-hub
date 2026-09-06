const express = require('express');
const router = express.Router();

const { getUsageAuditSnapshot } = require('../db/database');

// GET /api/usage-audit/:jobId — snapshot for a completed company-usage-audit job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getUsageAuditSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No usage-audit snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
