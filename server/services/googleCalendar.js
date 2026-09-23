const { google } = require('googleapis');
const { getAuthorizedClient } = require('./googleAuth');

/**
 * Lists events on a calendar within a time window. Defaults to "now through
 * 30 days out" on the primary calendar, mirroring what a dashboard widget
 * would want (upcoming events), not a full historical export.
 */
async function listEvents({
  calendarId = 'primary',
  timeMin = new Date().toISOString(),
  timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  maxResults = 250,
} = {}) {
  const auth = getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true, // expand recurring events into individual instances
    orderBy: 'startTime',
  });
  return data.items || [];
}

// Google Calendar event links carry the calendar+event identity in an
// opaque "eid" query param -- base64 of "<eventId> <calendarId>", confirmed
// live (Sep 2026) against a real htmlLink from listEvents(). eventId for a
// recurring instance has the form "<masterEventId>_<YYYYMMDD>" (or
// "..._YYYYMMDDTHHMMSSZ" for a moved instance); INSTANCE_ID_SUFFIX strips
// that so we can look up the whole series instead of trusting one instance,
// which may since have been moved/cancelled.
const INSTANCE_ID_SUFFIX = /_\d{8}(T\d{6}Z)?$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseEventLink(link) {
  try {
    const eid = new URL(link).searchParams.get('eid');
    if (!eid) return null;
    const decoded = Buffer.from(eid, 'base64').toString('utf8');
    const spaceIdx = decoded.indexOf(' ');
    if (spaceIdx === -1) return null;
    return { eventId: decoded.slice(0, spaceIdx), calendarId: decoded.slice(spaceIdx + 1) };
  } catch {
    return null;
  }
}

// Reads the wall-clock date/time straight out of the event's own start
// string instead of converting through a JS Date -- event.start.dateTime
// already carries its local UTC offset (e.g. "2026-07-14T14:00:00-04:00"),
// so slicing it directly gives the meeting's actual local day/time with no
// timezone-shift bugs. Day-of-week is computed by parsing the date part as
// UTC noon-anchored midnight, which is safe because a calendar date's
// weekday doesn't depend on timezone.
function occurrenceFromEvent(event) {
  const start = event.start || {};
  const dateStr = (start.dateTime || start.date || '').slice(0, 10);
  if (!dateStr) return null;
  const dayOfWeek = DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
  const time = start.dateTime ? start.dateTime.slice(11, 16) : null;
  return { nextCallDate: dateStr, dayOfWeek, time };
}

/**
 * Given a pasted Google Calendar event link (recurring_calls.calendar_link),
 * returns { nextCallDate, dayOfWeek, time } for the series' next real
 * upcoming occurrence, or null if the link isn't a parseable/reachable
 * Google Calendar event (e.g. a non-Google link, or the event was deleted).
 */
// A resolved occurrence is only useful if it's actually upcoming -- without
// this, a series whose instances() call throws (e.g. the master looks
// gone) falls back to fetching the literal pasted eventId, which for a
// recurring instance link is a SPECIFIC past occurrence ("..._20251015"),
// and would otherwise get accepted as if it were "next."
function isInFuture({ nextCallDate, time }) {
  const iso = time ? `${nextCallDate}T${time}:00` : `${nextCallDate}T23:59:59`;
  return new Date(iso).getTime() >= Date.now();
}

async function getNextOccurrenceFromLink(link) {
  const parsed = parseEventLink(link);
  if (!parsed) return null;
  const { eventId, calendarId } = parsed;
  const auth = getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const masterId = eventId.replace(INSTANCE_ID_SUFFIX, '');

  if (masterId !== eventId) {
    try {
      const { data } = await calendar.events.instances({
        calendarId, eventId: masterId, timeMin: new Date().toISOString(), maxResults: 1, showDeleted: false,
      });
      const next = data.items?.[0];
      // instances() succeeded -- trust its verdict either way. An empty
      // result means the series has no more future occurrences (recurrence
      // ended), which is a real "nothing to report" case, not a reason to
      // fall back to the stale pasted instance below.
      const occurrence = next ? occurrenceFromEvent(next) : null;
      return occurrence && isInFuture(occurrence) ? occurrence : null;
    } catch {
      // instances() itself failed (e.g. the master event looks gone) --
      // only NOW is it worth trying the raw pasted eventId as a last resort.
    }
  }

  try {
    const { data } = await calendar.events.get({ calendarId, eventId });
    const occurrence = occurrenceFromEvent(data);
    return occurrence && isInFuture(occurrence) ? occurrence : null;
  } catch {
    return null;
  }
}

module.exports = { listEvents, getNextOccurrenceFromLink };
