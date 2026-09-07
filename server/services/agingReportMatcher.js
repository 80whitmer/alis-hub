/**
 * Matches parsed aging-report rows (server/services/agingReportParser.js)
 * to cached Account Health accounts. Two paths, tried in order:
 *
 * 1. ID match — a purely-numeric customerId checked directly against
 *    hubspot_company_id. Confirmed live: Intacct's numeric customer IDs
 *    ARE real HubSpot company IDs for at least some customers (e.g.
 *    "18621787575" is the real HubSpot id for "Leisure Care LLC") — this
 *    is the reliable, high-confidence path whenever it's available.
 * 2. Name match — for customerIds that aren't purely numeric (this
 *    report's slug-style legacy IDs like "addie", "viva-greenpoint") or
 *    that don't hit an ID match, falls back to fuzzy name comparison.
 *    Display names commonly drift between systems (confirmed live: this
 *    same report has "Leisure Care" vs. HubSpot's "Leisure Care LLC" for
 *    the SAME account) — exact-after-normalizing catches the easy cases,
 *    a token-subset check catches the rest, matching the "soft check,
 *    not a hard block" philosophy server/api/qbr.js's health-import
 *    route already uses for the same underlying problem.
 *
 * Rows that don't confidently match either way are returned as
 * `unmatched`, not guessed — Aaron reviews these rather than risking a
 * wrong account getting someone else's balance.
 */

const NOISE_WORDS = new Set([
  'llc', 'inc', 'the', 'of', 'at', 'and', 'home', 'office', 'senior', 'living',
  'assisted', 'memory', 'care', 'management', 'group', 'communities', 'community',
]);

function normalize(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function significantTokens(name) {
  const tokens = normalize(name).filter((t) => !NOISE_WORDS.has(t));
  return tokens.length > 0 ? tokens : normalize(name); // fall back to unfiltered if everything was noise
}

/** True if every significant token of the shorter name appears somewhere in the longer name's tokens. */
function tokensSubsetMatch(nameA, nameB) {
  const a = significantTokens(nameA);
  const b = significantTokens(nameB);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerSet = new Set(longer);
  return shorter.every((t) => longerSet.has(t));
}

/**
 * @param {Array} rows - parsed aging-report rows
 * @param {Array} accounts - cached account_health_snapshots rows (need hubspot_company_id, company_name)
 * @returns {{ matched: Array<{row, account, confidence}>, unmatched: Array }}
 */
function matchAgingRows(rows, accounts) {
  const matched = [];
  const unmatched = [];

  for (const row of rows) {
    let account = null;
    let confidence = null;

    if (/^\d+$/.test(row.customerId)) {
      account = accounts.find((a) => a.hubspot_company_id === row.customerId);
      if (account) confidence = 'id';
    }

    if (!account) {
      const normalizedRowName = normalize(row.customerName).join(' ');
      account = accounts.find((a) => normalize(a.company_name).join(' ') === normalizedRowName);
      if (account) confidence = 'exact-name';
    }

    if (!account) {
      account = accounts.find((a) => tokensSubsetMatch(row.customerName, a.company_name));
      if (account) confidence = 'fuzzy-name';
    }

    if (account) {
      matched.push({ row, account, confidence });
    } else {
      unmatched.push(row);
    }
  }

  return { matched, unmatched };
}

module.exports = { matchAgingRows };
