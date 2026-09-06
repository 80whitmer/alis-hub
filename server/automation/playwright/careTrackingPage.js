/**
 * careTrackingPage.js
 * Read-only Playwright capture of a community's Care Tracking page
 * (`https://{host}.alisonline.com/Care/Tracking/{communityId}`), used as
 * corroboration alongside Care Tracking's existing export-based `used`
 * signal (getRecordedCare, see usageAuditCatalog.js) — recordedCare already
 * gives a real activity count, so this page-scrape's job is confirming the
 * module is genuinely reachable/active from the UI a reviewer would
 * actually look at, not replacing that count. See dailyStandUpPage.js for
 * the same login-model notes (community subdomain needs its own login,
 * separate from admin.alisonline.com).
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
