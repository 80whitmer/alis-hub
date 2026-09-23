const express = require('express');
const router = express.Router();
const { getInternalTickets } = require('../services/hubspotInternalTickets');
const { recordInternalTicketClick, getInternalTicketClickStats } = require('../db/database');

// A handful of HubSpot calls (~2s), shared by Account Health and Team AM.
// Cached in memory so switching dashboards doesn't re-pull; ?refresh=1
// forces a fresh pull.
let cache = null;

function withClicks(tickets) {
  const stats = getInternalTicketClickStats();
  return tickets.map((t) => ({ ...t, clicks: 0, clicks30d: 0, lastClickedAt: null, ...stats.get(t.ticketId) }));
}

// GET /api/internal-tickets
router.get('/', async (req, res, next) => {
  try {
    if (!cache || req.query.refresh === '1') {
      cache = { tickets: await getInternalTickets(), fetchedAt: new Date().toISOString() };
    }
    res.json({ fetchedAt: cache.fetchedAt, tickets: withClicks(cache.tickets) });
  } catch (err) {
    next(err);
  }
});

// POST /api/internal-tickets/:ticketId/click  { target: 'hubspot' | <resource url> }
router.post('/:ticketId/click', (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.ticketId)) return res.status(400).json({ error: 'Invalid ticket id' });
    const target = typeof req.body?.target === 'string' ? req.body.target.slice(0, 2000) : null;
    recordInternalTicketClick(req.params.ticketId, target);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
