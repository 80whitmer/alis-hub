/**
 * careTrackingPage.js
 * Read-only Playwright capture of a community's Care Tracking page
 * (`https://{host}.alisonline.com/Care/Tracking/{communityId}`), used as
 * corroboration alongside Care Tracking's existing export-based `used`
 * signal (getRecordedCare, see usageAuditCatalog.js). See dailyStandUpPage.js
 * for the same login-model notes (community subdomain needs its own login,
 * separate from admin.alisonline.com).
 *
 * KNOWN BROKEN (Sep 2026): unlike Daily Stand-Up's page (a genuine
 * `<table>`), Care Tracking has ZERO `<table>` elements in its DOM at all —
 * confirmed live against communities with real, heavy recordedCare export
 * activity (24k-163k records) that this still returns `rowCount: 0` every
 * time. The page instead shows a "Time Remaining / Tasks Remaining" shift
 * summary (e.g. "Tasks Remaining: 28") — the actual resident/task list
 * likely needs a click to expand a shift, or renders via a component this
 * hasn't been reverse-engineered yet. Left wired into usageAudit.js
 * (harmless: usageAuditNormalizer.js's `pageConfirmedActive` only ever
 * flips Enabled from false/unscraped to true, never true to false, so an
 * always-0 result here can't produce an incorrect answer — it just doesn't
 * yet deliver the intended corroboration). Needs real DOM investigation
 * (what does clicking a shift/task open, and does a resident-level row
 * count exist anywhere accessible without it) before this number should be
 * trusted or surfaced more prominently than a tooltip.
 */

async function captureCareTracking(page, host, communityId) {
  const url = `https://${host}.alisonline.com/Care/Tracking/${communityId}`;
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
  };
}

module.exports = { captureCareTracking };
