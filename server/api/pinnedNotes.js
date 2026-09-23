const express = require('express');
const router = express.Router();
const { getPinnedNotes } = require('../services/pinnedNotes');

// GET /api/pinned-notes?ids=1,2,3 — live pinned-note content for the ids
// stored on ticket/deal/company snapshots. Up to 100 per call.
router.get('/', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 100 || !ids.every((id) => /^\d+$/.test(id))) {
      return res.status(400).json({ error: 'ids must be 1–100 comma-separated numeric HubSpot ids' });
    }
    const notes = await getPinnedNotes(ids);
    res.json({ notes: Object.fromEntries(notes) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
