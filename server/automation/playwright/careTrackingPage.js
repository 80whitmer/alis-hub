/**
 * careTrackingPage.js
 * Read-only Playwright capture of a community's Care Tracking page
 * (`https://{host}.alisonline.com/Care/Tracking/{communityId}`), used as
 * corroboration alongside Care Tracking's existing export-based `used`
 * signal (getRecordedCare, see usageAuditCatalog.js). See dailyStandUpPage.js
 * for the same login-model notes (community subdomain needs its own login,
 * separate from admin.alisonline.com).
 *
 * FIXED (Sep 2026) — this page has no `<table>` at all (an earlier version
 * of this module assumed one, always returning 0). Confirmed live via
 * screenshot: it's a per-shift/program summary list (one row per active
 * shift, e.g. "AM · Care · 150 Tasks Remaining"), each row a
 * `.mt-box` inside `.js-bocaInfiniteScroll .jscroll-inner` — a resident-
 * level list only appears after clicking into "Record Care", one extra
 * navigation this capture doesn't take. `rowCount` here is therefore a
 * SUM OF TASK COUNTS across visible shift rows, not a resident or DOM-row
 * count — a community with Care Tracking genuinely unused/unconfigured has
 * no programs and no tasks, so `> 0` is still a real "is this active"
 * signal, just measured differently than dailyStandUpPage.js's.
 */

async function captureCareTracking(page, host, communityId) {
  const url = `https://${host}.alisonline.com/Care/Tracking/${communityId}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('.js-bocaInfiniteScroll .mt-box, .jscroll-inner .mt-box', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.js-bocaInfiniteScroll .mt-box, .jscroll-inner .mt-box'));
    let totalTasks = 0;
    let recordedTasks = 0;
    for (const row of rows) {
      const text = row.textContent.replace(/\s+/g, ' ');
      // "0 of 150 Tasks Recorded" (visible on hover/expand) or "Tasks Remaining 150" (collapsed) — try both.
      const recordedMatch = text.match(/(\d+)\s+of\s+(\d+)\s+Tasks Recorded/i);
      const remainingMatch = text.match(/Tasks Remaining\s+(\d+)/i);
      if (recordedMatch) {
        recordedTasks += Number(recordedMatch[1]);
        totalTasks += Number(recordedMatch[2]);
      } else if (remainingMatch) {
        totalTasks += Number(remainingMatch[1]);
      }
    }
    return { title: document.title, programCount: rows.length, totalTasks, recordedTasks };
  });

  return {
    capturedAt: new Date().toISOString(),
    sourceUrl: url,
    host,
    communityId: String(communityId),
    rowCount: result.totalTasks,
    programCount: result.programCount,
    recordedTasks: result.recordedTasks,
    title: result.title,
  };
}

module.exports = { captureCareTracking };
