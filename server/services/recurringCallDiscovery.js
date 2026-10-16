/**
 * Auto-discovers recurring client calls from Google Calendar and proposes
 * matches against the portfolio (Aaron, Sep 2026: "have a claude skill...
 * or [instead] a Discover button" — this app already had a live, connected
 * Calendar API and the exact fuzzy-name-matching this needs already built
 * for alisCompanyDiscovery.js, so a live in-app Discover flow needed no new
 * scraping/auth, just this comparison). A proposal only — nothing is
 * written until the reviewed result is POSTed to the existing
 * /recurring-calls/import route, same review-before-write shape as
 * alisCompanyDiscovery.js's own Discover flow.
 */
const { listEvents, resolveSeriesKey } = require('./googleCalendar');
const { normalizeName, similarity } = require('./alisCompanyDiscovery');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Same vocabulary as the client's own CADENCE_OPTIONS/CADENCE_INTERVAL_DAYS
// (AccountHealthDashboard.jsx) — kept in sync manually, there's no shared
// constants module between client and server in this app.
const CADENCE_CANDIDATES = [['Weekly', 7], ['Bi-Weekly', 14], ['Monthly', 28], ['Quarterly', 91]];

function guessCadence(gapDays) {
  if (gapDays == null) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const [name, days] of CADENCE_CANDIDATES) {
    const diff = Math.abs(gapDays - days);
    if (diff < bestDiff) { bestDiff = diff; best = name; }
  }
  // A gap further than halfway past Quarterly from every candidate is more
  // likely a one-off reschedule this discovery window happened to catch
  // twice than a real cadence — leave it for a human to label rather than
  // guessing "Quarterly" with no real support for it.
  return bestDiff <= 45 ? best : null;
}

// Words like "senior"/"living"/"care" show up in a huge fraction of this
// industry's company names — confirmed live (Sep 2026): without excluding
// them, "Colliers Senior Living" and "Bethesda Senior Living" score
// similarly against a title mentioning either, and a genuine match can lose
// out to an unrelated company that just happens to share the generic words.
// Built dynamically from the portfolio itself (not a hardcoded list) so it
// adapts to whatever's actually common in this book of business.
const GENERIC_WORD_THRESHOLD = 0.1; // a word in >10% of company names is "generic" for matching purposes
function buildGenericWordSet(companies) {
  const counts = new Map();
  for (const c of companies) {
    const words = new Set(normalizeName(c.name).split(' ').filter(Boolean));
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const minCount = Math.max(2, companies.length * GENERIC_WORD_THRESHOLD);
  return new Set([...counts.entries()].filter(([, n]) => n >= minCount).map(([w]) => w));
}

/** 1.0 = the company's full normalized name appears verbatim in the event title (e.g. "Weekly Ops Sync — Constant Care"); otherwise the fraction of the company name's own DISTINCTIVE words (excluding generic industry terms — see buildGenericWordSet) that appear in the title, so "Acme <> ALIS Biweekly" still scores well against "Acme Senior Living" without needing the legal-entity or industry words to match too. */
function titleMatchScore(title, companyNormalized, genericWords) {
  if (!companyNormalized) return 0;
  const t = normalizeName(title);
  if (!t) return 0;
  if (t.includes(companyNormalized)) return 1;
  const companyTokens = companyNormalized.split(' ').filter((tok) => tok && !genericWords.has(tok));
  if (companyTokens.length === 0) return 0;
  const titleTokens = new Set(t.split(' '));
  const matched = companyTokens.filter((tok) => titleTokens.has(tok)).length;
  return matched / companyTokens.length;
}

const AUTO_MATCH_THRESHOLD = 1; // the company's full name literally appears in the title
const CANDIDATE_THRESHOLD = 0.6; // most of the company's own name-words present
const MAX_CANDIDATES = 3;

function occurrenceFromEvent(event) {
  const start = event.start || {};
  const dateStr = (start.dateTime || start.date || '').slice(0, 10);
  if (!dateStr) return null;
  const dayOfWeek = DAY_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
  const time = start.dateTime ? start.dateTime.slice(11, 16) : null;
  return { nextCallDate: dateStr, dayOfWeek, time };
}

/**
 * @param {Array<{id, name}>} companies - the portfolio to match against (HubSpot company id + name)
 * @param {Array<{calendar_link}>} existingCalls - recurring_calls already on file, so an already-tracked series isn't proposed again
 * @param {object} opts
 * @param {number} opts.daysAhead - how far out to look for recurring instances (needs at least 2 occurrences of a cadence to guess it — 45 days covers weekly/bi-weekly/monthly, not quarterly)
 */
async function discoverRecurringCalls(companies, existingCalls, { daysAhead = 45 } = {}) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const events = await listEvents({ timeMin, timeMax, maxResults: 250 });

  const existingSeriesKeys = new Set(
    existingCalls.map((c) => resolveSeriesKey(c.calendar_link)).filter(Boolean)
  );

  // Group singleEvents-expanded instances back into their recurring series —
  // an instance only carries recurringEventId when it's actually part of a
  // series; a one-off meeting has none and is excluded entirely (this
  // feature is about cadence, not every calendar entry).
  const seriesMap = new Map();
  for (const ev of events) {
    if (!ev.recurringEventId || ev.status === 'cancelled') continue;
    if (!seriesMap.has(ev.recurringEventId)) seriesMap.set(ev.recurringEventId, []);
    seriesMap.get(ev.recurringEventId).push(ev);
  }

  const indexed = companies.map((c) => ({ company: c, normalized: normalizeName(c.name) }));
  const genericWords = buildGenericWordSet(companies);

  const autoMatched = [];
  const ambiguous = [];
  const noCandidate = [];
  const alreadyTracked = [];

  for (const [, instances] of seriesMap) {
    instances.sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));
    const next = instances[0];

    // Real bug, confirmed live (Sep 2026): this used to compare against a
    // hardcoded `primary::${recurringEventId}` key, but resolveSeriesKey
    // (used to build existingSeriesKeys below) extracts the calendar's REAL
    // id (e.g. an actual email address) from the link's own eid, not the
    // literal string "primary" — the two never matched, so this dedup was
    // a complete no-op and every re-run of Discover proposed every series
    // again, creating exact duplicates on import. Deriving both sides'
    // keys through the identical resolveSeriesKey() call is what actually
    // guarantees they line up.
    const key = resolveSeriesKey(next.htmlLink);
    if (key && existingSeriesKeys.has(key)) {
      alreadyTracked.push({ title: next.summary || '(untitled)' });
      continue;
    }

    const occurrence = occurrenceFromEvent(next);
    if (!occurrence) continue; // no resolvable start time — skip rather than propose a call with no date

    let cadence = null;
    if (instances.length >= 2) {
      const d1 = new Date(instances[0].start?.dateTime || instances[0].start?.date);
      const d2 = new Date(instances[1].start?.dateTime || instances[1].start?.date);
      cadence = guessCadence(Math.round((d2 - d1) / 86400000));
    }

    const title = next.summary || '';
    const calendarLink = next.htmlLink || null;
    const row = {
      title, calendarLink, cadence,
      nextCallDate: occurrence.nextCallDate, dayOfWeek: occurrence.dayOfWeek, time: occurrence.time,
      instanceCount: instances.length,
    };

    const scored = indexed
      .map(({ company, normalized }) => ({ company, score: Math.max(titleMatchScore(title, normalized, genericWords), similarity(normalizeName(title), normalized)) }))
      .filter((m) => m.score >= CANDIDATE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      noCandidate.push(row);
    } else if (scored[0].score >= AUTO_MATCH_THRESHOLD && (scored.length === 1 || scored[0].score - scored[1].score > 0.05)) {
      autoMatched.push({ ...row, hubspotCompanyId: scored[0].company.id, companyName: scored[0].company.name, score: Math.round(scored[0].score * 100) / 100 });
    } else {
      ambiguous.push({ ...row, candidates: scored.slice(0, MAX_CANDIDATES).map((m) => ({ hubspotCompanyId: m.company.id, companyName: m.company.name, score: Math.round(m.score * 100) / 100 })) });
    }
  }

  return {
    seriesFoundCount: seriesMap.size,
    autoMatched, ambiguous, noCandidate, alreadyTracked,
    daysAhead,
  };
}

module.exports = { discoverRecurringCalls, guessCadence };
