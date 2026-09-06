const express = require('express');
const router = express.Router();

const { getCompanyHost, bulkImportCompanyHosts, listCompanyHosts } = require('../db/database');

// GET /api/company-hosts/lookup?companyName=...&hubspotCompanyId=...
// Returns the remembered ALIS subdomain for a company, if any.
router.get('/lookup', (req, res) => {
  try {
    const { companyName, hubspotCompanyId } = req.query;
    if (!companyName && !hubspotCompanyId) {
      return res.status(400).json({ error: 'companyName or hubspotCompanyId is required' });
    }
    const row = getCompanyHost({ companyName, hubspotCompanyId });
    if (!row) return res.status(404).json({ error: 'No remembered companyHost for this company' });
    res.json({ companyName: row.company_name, hubspotCompanyId: row.hubspot_company_id, companyHost: row.company_host });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/company-hosts — list every remembered mapping
router.get('/', (req, res) => {
  try {
    res.json(listCompanyHosts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/company-hosts/import
// Body: { rows: [{ companyName, hubspotCompanyId?, companyHost }, ...] }
// One-time (or repeatable) bulk seed — e.g. from an exported client list.
router.post('/import', (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty rows[] array' });
    }
    const imported = bulkImportCompanyHosts(rows);
    res.json({ imported, skipped: rows.length - imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
