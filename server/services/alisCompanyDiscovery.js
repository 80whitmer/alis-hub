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
const { captureCompanyDetail } = require('../automation/playwright/companyDetailPage');

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
 *
 * Matches by CRM ID first (Aaron, Sep 2026: "the alis admin 'CRM ID' needs
 * to match the Hubspot 'Record id'... it is just called something else in
 * ALIS admin") — ALIS admin's own per-company detail page carries a "CRM
 * ID" field that's meant to hold exactly the HubSpot company's Record ID,
 * same field crmIdAuditBulk.js's findAlisMatch already trusts as the most
 * fundamental link (confirmed live there: name-only matching failed on
 * ~half the portfolio). An exact CRM ID match is authoritative regardless
 * of how different the two systems' names are (e.g. "Constant Care" in
 * HubSpot vs. "Grand Brook Memory Care" in ALIS admin) — name similarity
 * only runs as a fallback for a row whose CRM ID is blank, unreadable, or
 * doesn't match any still-unmapped company.
 */
async function discoverAlisAdminIds(companies, { onProgress, isCancelled } = {}) {
  const progress = onProgress || (() => {});
  const cancelled = isCancelled || (() => false);

  progress({ message: 'Logging in to admin.alisonline.com…' });
  const page = await newPage();
  await ensureLoggedIn(page);
  progress({ message: 'Reading ALIS admin\'s company directory…' });
  const directory = await captureCompanyDirectory(page);
  progress({ message: `Read ${directory.length} companies from the directory. Name-matching against your portfolio…` });

  const unmapped = companies.filter((c) => !c.alisAdminCompanyId);
  const indexed = unmapped.map((c) => ({ company: c, normalized: normalizeName(c.name) }));
  const byHubspotId = new Map(unmapped.map((c) => [String(c.id).trim(), c]));
  // Every ALIS admin company id that's ALREADY correctly on file somewhere
  // (Sep 2026, Aaron: "what are we matching here???" — a directory row for
  // a company that's already mapped was landing in "needs review" with only
  // WRONG candidates to pick from, because `unmapped` above had already
  // removed the one correct match from the candidate pool entirely, for
  // every row, not just this company's own row. Skipping the row itself
  // up front instead — once its own id is already assigned to anyone — means
  // it never gets a chance to be scored against the wrong leftover pool.
  const alreadyAssignedIds = new Set(
    companies.filter((c) => c.alisAdminCompanyId).map((c) => String(c.alisAdminCompanyId))
  );

  const autoMatched = [];
  const ambiguous = [];
  const noAlisId = [];
  const noCandidate = [];
  const alreadyMapped = [];
  // Rows that need the CRM ID rescue pass below — ONLY "ambiguous" (a real
  // name candidate existed, just not confidently), never "no candidate"
  // (Sep 2026: confirmed live this portal's ALIS admin directory has ~550
  // companies, ~5x the size of this HubSpot portfolio — the "no candidate"
  // bucket is dominated by companies that simply aren't Aaron's at all, not
  // residual accounts to rescue, so a live detail-page visit for every one
  // of them scales with the WHOLE PORTAL, not with the handful of accounts
  // actually left to map — an earlier version tried exactly that and took
  // 6+ minutes before the dev proxy killed the connection). "Ambiguous"
  // rows at least have a real candidate already, so CRM ID here is a
  // bounded tie-breaker, not an unbounded rescue. A true zero-name-overlap
  // case (Aaron's own example: "Constant Care" in HubSpot vs. ALIS admin's
  // "Grand Brook Memory Care") still needs the manual company-search picker
  // in the review UI — same as before this change.
  const needsCrmIdCheck = [];

  for (const row of directory) {
    if (!row.alisAdminCompanyId) {
      noAlisId.push(row);
      continue;
    }
    if (alreadyAssignedIds.has(String(row.alisAdminCompanyId))) {
      alreadyMapped.push(row);
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
        // The same directory row already carries the subdomain ("Text
        // Key") right next to the admin ID — combining the two write paths
        // (Aaron, Sep 2026: "combine these templates and update/discovery
        // patterns") means a confirmed match here writes both, not just
        // the admin ID.
        companyHost: row.companyHost || null,
        score: Math.round(scored[0].score * 100) / 100,
        matchMethod: 'name',
      });
    } else {
      needsCrmIdCheck.push({ row, scored, bucket: 'ambiguous' });
    }
  }

  progress({
    message: needsCrmIdCheck.length > 0
      ? `Name-matched ${autoMatched.length}. Breaking ties with CRM ID for ${needsCrmIdCheck.length} ambiguous compan${needsCrmIdCheck.length === 1 ? 'y' : 'ies'}…`
      : `Name-matched ${autoMatched.length}. Nothing ambiguous left to check.`,
  });

  let crmIdMatchCount = 0;
  let crmIdReadFailures = 0;
  try {
    for (let i = 0; i < needsCrmIdCheck.length; i++) {
      if (cancelled()) {
        progress({ message: `Cancelled after checking ${i} of ${needsCrmIdCheck.length} — keeping what was found before stopping.` });
        // Whatever didn't get a CRM ID check yet falls back into ambiguous as-is.
        for (let j = i; j < needsCrmIdCheck.length; j++) {
          const { row: skippedRow, scored: skippedScored } = needsCrmIdCheck[j];
          ambiguous.push({
            alisCompanyName: skippedRow.companyName,
            alisAdminCompanyId: skippedRow.alisAdminCompanyId,
            companyHost: skippedRow.companyHost || null,
            candidates: skippedScored.slice(0, MAX_CANDIDATES).map((m) => ({
              hubspotCompanyId: m.company.id,
              companyName: m.company.name,
              score: Math.round(m.score * 100) / 100,
            })),
          });
        }
        break;
      }
      const { row, scored } = needsCrmIdCheck[i];
      progress({ message: `Checking CRM ID for "${row.companyName}" (${i + 1} of ${needsCrmIdCheck.length})…` });
      let crmMatch = null;
      try {
        const detail = await captureCompanyDetail(page, row.alisAdminCompanyId);
        if (detail.crmId) {
          const hubspotMatch = byHubspotId.get(String(detail.crmId).trim());
          if (hubspotMatch) crmMatch = hubspotMatch;
        }
      } catch (err) {
        crmIdReadFailures++;
        console.error(`[alisCompanyDiscovery] Failed to read CRM ID for ALIS admin company ${row.alisAdminCompanyId} ("${row.companyName}") — falling back to name matching:`, err.message);
      }

      if (crmMatch) {
        crmIdMatchCount++;
        progress({ message: `  → matched by CRM ID to "${crmMatch.name}".` });
        autoMatched.push({
          hubspotCompanyId: crmMatch.id,
          companyName: crmMatch.name,
          alisAdminCompanyId: row.alisAdminCompanyId,
          alisCompanyName: row.companyName,
          companyHost: row.companyHost || null,
          score: 1,
          matchMethod: 'crmId',
        });
      } else {
        ambiguous.push({
          alisCompanyName: row.companyName,
          alisAdminCompanyId: row.alisAdminCompanyId,
          companyHost: row.companyHost || null,
          candidates: scored.slice(0, MAX_CANDIDATES).map((m) => ({
            hubspotCompanyId: m.company.id,
            companyName: m.company.name,
            score: Math.round(m.score * 100) / 100,
          })),
        });
      }
    }
  } finally {
    await page.context().close();
  }

  progress({ message: `Done. ${autoMatched.length} confident match(es) (${crmIdMatchCount} by CRM ID), ${ambiguous.length} need review, ${noCandidate.length} no match found.` });

  return {
    scrapedAt: new Date().toISOString(),
    directoryCount: directory.length,
    crmIdMatchCount,
    crmIdReadFailures,
    autoMatched,
    ambiguous,
    // ALIS admin companies with no id parsed from their row (link markup
    // didn't match what this scraper expects — see companiesPage.js's
    // "not yet confirmed live" caveat) and companies with no name match
    // close enough to propose — both need a human, not silently dropped.
    noAlisId,
    noCandidate,
    // Already correctly mapped elsewhere — nothing to review, just a count
    // so the summary line still accounts for every directory row.
    alreadyMapped,
  };
}

/**
 * Cross-checks every account with a known ALIS Admin Company ID against a
 * fresh scrape of ALIS admin's own company directory — the same single
 * page discoverAlisAdminIds already scrapes, which happens to carry the
 * admin ID and its subdomain ("Text Key") in the same row, so this needs
 * no new scraping capability, just a comparison (Aaron, Sep 2026: "does the
 * subdomain's own ALIS company record report the same admin ID... flag
 * drift automatically"). Read-only — writes each account's result to
 * company_alignment (setCompanyAlignmentDrift) for the UI to display, never
 * touches company_hosts/alis_admin_ids themselves; a human still decides
 * whether to accept the drift by re-running Discover or editing the
 * template.
 */
async function checkCompanyAlignmentDrift() {
  const { listAlisAdminIds, getCompanyHost, listCompanyAlignment, setCompanyAlignmentDrift } = require('../db/database');

  const adminIds = listAlisAdminIds(); // [{ hubspot_company_id, alis_admin_company_id }]
  if (adminIds.length === 0) {
    return { checkedCount: 0, driftCount: 0, results: [] };
  }

  const page = await newPage();
  let directory;
  try {
    await ensureLoggedIn(page);
    directory = await captureCompanyDirectory(page);
  } finally {
    await page.context().close();
  }
  const byAdminId = new Map(directory.map((row) => [String(row.alisAdminCompanyId), row]));
  const alignmentByCompany = new Map(listCompanyAlignment().map((r) => [r.hubspot_company_id, r]));

  const results = [];
  for (const { hubspot_company_id: hubspotCompanyId, alis_admin_company_id: alisAdminCompanyId } of adminIds) {
    const hostRow = getCompanyHost({ hubspotCompanyId });
    const storedHosts = (hostRow?.company_host || '').split(',').map((h) => h.trim()).filter(Boolean);
    // Subdomains are case-insensitive in practice (they're used lowercase in
    // the actual URL, e.g. serenesuites.alisonline.com) but ALIS admin's own
    // "Text Key" column doesn't consistently match the case we stored —
    // confirmed live (Sep 2026): "Serenesuites" vs. "serenesuites" flagged as
    // drift that wasn't real. Compare case-insensitively; only the message
    // (if some OTHER field also drifted) shows the directory's original casing.
    const storedHostsLower = storedHosts.map((h) => h.toLowerCase());
    const alignment = alignmentByCompany.get(hubspotCompanyId);
    const directoryRow = byAdminId.get(String(alisAdminCompanyId));

    const issues = [];
    if (!directoryRow) {
      issues.push({ type: 'idNotFound', detail: `Admin Company ID ${alisAdminCompanyId} was not found in ALIS admin's own directory — it may be stale.` });
    } else {
      if (storedHosts.length > 0 && !storedHostsLower.includes((directoryRow.companyHost || '').toLowerCase())) {
        issues.push({ type: 'subdomainMismatch', detail: `ALIS admin reports subdomain "${directoryRow.companyHost}" for this admin ID, but ${storedHosts.join(', ')} is on file.` });
      }
      if (alignment?.alis_company_name && alignment.alis_company_name !== directoryRow.companyName) {
        issues.push({ type: 'nameDrift', detail: `ALIS admin now lists this company as "${directoryRow.companyName}", was "${alignment.alis_company_name}".` });
      }
    }

    const companyName = hostRow?.company_name || alignment?.alis_company_name || hubspotCompanyId;
    setCompanyAlignmentDrift(hubspotCompanyId, { driftDetected: issues.length > 0, driftDetails: issues });
    results.push({ hubspotCompanyId, companyName, alisAdminCompanyId, issues });
  }

  return {
    checkedCount: results.length,
    driftCount: results.filter((r) => r.issues.length > 0).length,
    results: results.filter((r) => r.issues.length > 0),
  };
}

module.exports = { discoverAlisAdminIds, checkCompanyAlignmentDrift, normalizeName, similarity };
