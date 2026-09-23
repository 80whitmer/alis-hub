const express = require('express');
const router = express.Router();

const { getCompanyHost, bulkImportCompanyHosts, listCompanyHosts, deleteCompanyHost } = require('../db/database');
const { newPage, ensureLoggedIn } = require('../automation/playwright/browser');
const { captureCompanyDirectory } = require('../automation/playwright/companiesPage');

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

// POST /api/company-hosts/refresh-from-admin
// Logs in to admin.alisonline.com and scrapes the Companies directory
// (Company Name + Text Key/subdomain) directly, bulk-upserting the result
// the same way the template-upload path does — this is the automated
// alternative to the Download/Upload Template flow, not a replacement for
// it (the template export is still how Aaron shares a subdomain list with
// colleagues on the branched ALIS Hub).
router.post('/refresh-from-admin', async (req, res) => {
  let page;
  try {
    page = await newPage();
    await ensureLoggedIn(page);
    const rows = await captureCompanyDirectory(page);
    if (rows.length === 0) {
      return res.status(500).json({ error: 'No companies with a subdomain found on admin.alisonline.com/Customers/Companies — page structure may have changed.' });
    }
    const imported = bulkImportCompanyHosts(rows);
    res.json({ imported, skipped: rows.length - imported, found: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.context().close().catch(() => {});
  }
});

// DELETE /api/company-hosts/:id — remove one bad mapping (e.g. a garbled
// name or wrong subdomain) without touching the rest of the table.
router.delete('/:id', (req, res) => {
  try {
    const rowsModified = deleteCompanyHost(req.params.id);
    res.json({ deleted: rowsModified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
