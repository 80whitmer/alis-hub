const express = require('express');
const router = express.Router();

const { getCrmIdAuditSnapshot } = require('../db/database');

// GET /api/crm-id-audit/:jobId — snapshot for a completed crm-id-audit job
router.get('/:jobId', (req, res) => {
  try {
    const snapshot = getCrmIdAuditSnapshot(req.params.jobId);
    if (!snapshot) return res.status(404).json({ error: 'No CRM ID audit snapshot found for this job (has it completed yet?)' });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
