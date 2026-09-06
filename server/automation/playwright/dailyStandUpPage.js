/**
 * dailyStandUpPage.js
 * Read-only Playwright capture of a community's Daily Stand-Up report
 * (`https://{host}.alisonline.com/Reports/ResidentDailyStandUp/{communityId}`).
 *
 * Confirmed live (Sep 2026): this community subdomain does NOT share
 * admin.alisonline.com's login session (entitlementsPage.js's login) —
 * every community-subdomain page redirects to that subdomain's own
 * /Login until ensureLoggedIn(page, targetUrl) is called with a URL on
 * that host directly. Once logged in on a host, the session covers every
 * community under it — no per-community re-login needed.
 *
 * "Daily Stand-Up" has no ALIS entitlement flag anywhere in the 131
 * captured for company 353 (see usageAuditCatalog.js) — this page-scrape is
 * currently the only usage signal available for it at all, not a
 * corroborating second source like careTrackingPage.js is for Care
 * Tracking's existing `recordedCare` export signal. Reports `rowCount`
 * (resident rows actually listed) as the usage number rather than a bare
 * boolean, since an empty stand-up ("0 residents") vs. a genuinely
 * unlicensed/broken page are different findings a reviewer would want to
 * tell apart — see the null-vs-0 distinction on `error`.
 */

async function captureDailyStandUp(page, host, communityId) {
  const url = `https://${host}.alisonline.com/Reports/ResidentDailyStandUp/${communityId}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    title: document.title,
    rowCount: document.querySelectorAll('table tbody tr').length,
    bodyTextSample: document.body.innerText.slice(0, 300),
  }));

  return {
    capturedAt: new Date().toISOString(),
    sourceUrl: url,
    host,
    communityId: String(communityId),
    rowCount: result.rowCount,
    title: result.title,
    // Not yet confirmed against a community where this module is genuinely
    // disabled (no negative example available when this was built) — a
    // `rowCount` of 0 could mean "no residents on today's stand-up" or
    // "module not licensed for this community." Treat as directional
    // corroboration, not an authoritative Enabled/Disabled flag, until
    // that's been checked against a known-disabled community.
    error: null,
  };
}

module.exports = { captureDailyStandUp };
