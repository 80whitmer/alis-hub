const express = require('express');
const router = express.Router();

const { validateOrganicAddPayload } = require('../services/organicAdd');
const { startFill, getFillStatus } = require('../services/jiraFormFill');
const { recordOrganicAddRun } = require('../db/database');
const options = require('../config/organicAddOptions.json');

const AUDIT_EVENTS = new Set(['opened_form', 'copied_field']);

// GET /api/organic-add/options — the live form's dropdown option lists
router.get('/options', (req, res) => res.json(options));

// POST /api/organic-add/validate — body: { payload: <object|string> }
// Pure validation, nothing leaves the hub. The review screen re-posts the
// payload with the human's dropdown picks merged in.
router.post('/validate', (req, res) => {
  try {
    const result = validateOrganicAddPayload(req.body && req.body.payload);
    const crmId = result.review && result.review.community.crm_id;
    recordOrganicAddRun(crmId, result.ok ? 'validated' : 'rejected', result.ok ? null : `${result.errors.length} error(s)`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organic-add/fill — body: { payload }
// Opens a visible browser window, fills the ODM form from the (re-validated)
// payload and stops. NEVER submits — the person reviews and clicks Submit.
// Refuses while anything still needs a human (picks, completion date, URL).
router.post('/fill', (req, res) => {
  try {
    const result = validateOrganicAddPayload(req.body && req.body.payload);
    if (!result.ok) return res.status(400).json({ error: 'Payload rejected', errors: result.errors });
    const { review } = result;
    const pending = [
      ...Object.entries(review.dropdowns).filter(([, d]) => d.needsPick).map(([k]) => k),
      ...review.formFields.filter((f) => f.needsDate || f.needsUrl).map((f) => f.label),
    ];
    if (pending.length) return res.status(400).json({ error: `Still needs a value: ${pending.join(', ')}` });
    const started = startFill(review);
    if (!started.started) return res.status(409).json({ error: started.reason });
    recordOrganicAddRun(review.community.crm_id, 'fill_started', null);
    res.json({ started: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/organic-add/fill/status — { status, results, error }
router.get('/fill/status', (req, res) => res.json(getFillStatus()));

// POST /api/organic-add/audit — body: { crmId, event, detail? }
// Short record of what was done with a review. `detail` is a field LABEL
// only, never a value — contact emails/phones stay out of the log.
router.post('/audit', (req, res) => {
  const { crmId, event, detail } = req.body || {};
  if (!AUDIT_EVENTS.has(event)) return res.status(400).json({ error: `event must be one of ${[...AUDIT_EVENTS].join(', ')}` });
  try {
    recordOrganicAddRun(crmId, event, typeof detail === 'string' ? detail.slice(0, 80) : null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
