/**
 * Auto-discovers ALIS Admin Company ID -> HubSpot company mappings by
 * scraping ALIS admin's own company directory (companiesPage.js) and
 * name-matching against the portfolio, instead of the fully manual
 * one-at-a-time / Excel-template entry (Aaron, Sep 2026: "how can we get
 * the company IDs embedded here and easily updated in bulk... these are
 * stored on the company urls in ALIS admin"). A proposal only — nothing is
 * written to alis_admin_ids until the reviewed result is POSTed to the
 * existing bulk-import route, same as the Excel template flow.
 */
const { newPage, ensureLoggedIn } = require('../automation/playwright/browser');
const { captureCompanyDirectory } = require('../automation/playwright/companiesPage');

const LEGAL_SUFFIXES = /\b(llc|l\.l\.c\.?|inc|inc\.|incorporated|corp|corp\.|corporation|co|co\.|ltd|ltd\.|lp|l\.p\.)\b\.?/g;
// "Home Office" is this portfolio's own parent-record naming convention
// (hubspotAccounts.js's getAllHomeOfficeCompanies), not a distinguishing
// part of the company's real name — stripped the same as a legal suffix so
// e.g. "Prime Nursing Services, LLC Home Office" matches ALIS admin's
// "Prime Nursing Services, LLC" at 1.0 instead of a borderline 0.6-0.7.
const HOME_OFFICE_SUFFIX = /\bhome office\b/g;

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(HOME_OFFICE_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein edit distance — small/self-contained rather than a new dependency for one function. */
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** 1.0 = identical normalized names, 0 = nothing in common. */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - editDistance(a, b) / maxLen;
}

const AUTO_MATCH_THRESHOLD = 0.92;
const CANDIDATE_THRESHOLD = 0.6;
const MAX_CANDIDATES = 3;

/**
 * Scrapes the ALIS admin directory and proposes matches against `companies`
 * (this app's HubSpot company list). Rows already mapped (a company that
 * already has an alisAdminCompanyId) are skipped entirely — this only ever
 * proposes NEW mappings, never overwrites an existing one.
 */
async function discoverAlisAdminIds(companies) {
  const page = await newPage();
  let directory;
  try {
    await ensureLoggedIn(page);
    directory = await captureCompanyDirectory(page);
  } finally {
    await page.context().close();
  }

  const unmapped = companies.filter((c) => !c.alisAdminCompanyId);
  const indexed = unmapped.map((c) => ({ company: c, normalized: normalizeName(c.name) }));

  const autoMatched = [];
  const ambiguous = [];
  const noAlisId = [];
  const noCandidate = [];

  for (const row of directory) {
    if (!row.alisAdminCompanyId) {
      noAlisId.push(row);
      continue;
    }
    const normalizedRow = normalizeName(row.companyName);
    const scored = indexed
      .map(({ company, normalized }) => ({ company, score: similarity(normalizedRow, normalized) }))
      .filter((m) => m.score >= CANDIDATE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      noCandidate.push(row);
    } else if (scored[0].score >= AUTO_MATCH_THRESHOLD && (scored.length === 1 || scored[0].score - scored[1].score > 0.05)) {
      autoMatched.push({
        hubspotCompanyId: scored[0].company.id,
        companyName: scored[0].company.name,
        alisAdminCompanyId: row.alisAdminCompanyId,
        alisCompanyName: row.companyName,
        score: Math.round(scored[0].score * 100) / 100,
      });
    } else {
      ambiguous.push({
        alisCompanyName: row.companyName,
        alisAdminCompanyId: row.alisAdminCompanyId,
        candidates: scored.slice(0, MAX_CANDIDATES).map((m) => ({
          hubspotCompanyId: m.company.id,
          companyName: m.company.name,
          score: Math.round(m.score * 100) / 100,
        })),
      });
    }
  }

  return {
    scrapedAt: new Date().toISOString(),
    directoryCount: directory.length,
    autoMatched,
    ambiguous,
    // ALIS admin companies with no id parsed from their row (link markup
    // didn't match what this scraper expects — see companiesPage.js's
    // "not yet confirmed live" caveat) and companies with no name match
    // close enough to propose — both need a human, not silently dropped.
    noAlisId,
    noCandidate,
  };
}

module.exports = { discoverAlisAdminIds, normalizeName, similarity };
