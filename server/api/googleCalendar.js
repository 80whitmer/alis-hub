const express = require('express');
const router = express.Router();

const { getAuthUrl, exchangeCodeForTokens, loadTokens } = require('../services/googleAuth');
const { listEvents } = require('../services/googleCalendar');

// GET /api/google/oauth/status — whether the one-time consent has been done yet.
router.get('/oauth/status', (req, res) => {
  res.json({ connected: !!loadTokens() });
});

// GET /api/google/oauth/start — open this in a real browser (logged in as
// aaron@go-alis.com) to grant alis-hub read-only calendar access. Not
// something Claude can complete on your behalf — Google's consent screen
// requires your own logged-in browser session.
router.get('/oauth/start', (req, res) => {
  try {
    res.redirect(getAuthUrl());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/google/oauth/callback — GOOGLE_REDIRECT_URI must point here exactly.
router.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google returned an error: ${error}`);
  if (!code) return res.status(400).send('Missing ?code from Google redirect');
  try {
    await exchangeCodeForTokens(code);
    res.send('Google Calendar connected. You can close this tab.');
  } catch (err) {
    res.status(500).send(`Token exchange failed: ${err.message}`);
  }
});

// GET /api/google/calendar/events?calendarId=&timeMin=&timeMax=
router.get('/calendar/events', async (req, res) => {
  try {
    const { calendarId, timeMin, timeMax } = req.query;
    const events = await listEvents({ calendarId, timeMin, timeMax });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
