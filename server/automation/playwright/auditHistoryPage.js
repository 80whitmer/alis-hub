/**
 * auditHistoryPage.js
 * Generic, reusable capture of ALIS's "Audit History" widget.
 *
 * Confirmed live (Sep 2026): the exact same widget — a `table.mt-table`
 * whose first row reads Note / Updated At / Updated By, filter inputs
 * `#Filters_StartDate` / `#Filters_EndDate` / `#Filters_StaffId` (select) /
 * `#Filters_Category` (select) / `#Filters_Notes`, applied via a
 * `.mt-icon_search` click, and a single `.grid-pager`/`.grid-next-page` AJAX
 * pager (no full page navigation on Next) — appears at the bottom of
 * Community Profile, Resident Profile, and the Company page. One generic
 * module, not three per-page scrapers, is exactly why this is worth
 * building once: any future destination with the same widget (per Aaron,
 * "may need to add additional audit destinations in the future") is a new
 * URL to pass in, not new scraping logic.
 *
 * Confirmed live that filters genuinely change the result set (not a
 * cached no-op — a narrow date range + category combination correctly
 * produced "There are no items to display").
 */

/** Reads every row currently rendered in the Audit History table, or null if no such table exists on this page at all. */
async function readAuditRows(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table.mt-table'));
    for (const t of tables) {
      const rows = Array.from(t.querySelectorAll('tr'));
      const headTexts = rows[0] ? Array.from(rows[0].querySelectorAll('th,td')).map((c) => c.textContent.trim()) : [];
      if (headTexts[0] !== 'Note' || headTexts[1] !== 'Updated At' || headTexts[2] !== 'Updated By') continue;

      return rows.slice(1)
        .map((r) => {
          const cells = Array.from(r.querySelectorAll('td'));
          const note = (cells[0]?.textContent || '').trim();
          const updatedAt = (cells[1]?.textContent || '').trim();
          const updatedByRaw = (cells[2]?.textContent || '').trim();
          // "Heather Santizo\n        \n            (heather.santizo)" -> name + username
          const match = updatedByRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/s);
          return {
            note,
            updatedAt,
            updatedByName: (match ? match[1] : updatedByRaw).replace(/\s+/g, ' ').trim(),
            updatedByUsername: match ? match[2].trim() : null,
          };
        })
        .filter((r) => r.note && r.note !== 'There are no items to display');
    }
    return null;
  });
}

/**
 * Fills and submits the Start/End Date, Updated By (staffId), Type
 * (category), and Notes-search filters — a no-op (returns false) if the
 * page has none of these fields, so callers can call this unconditionally
 * without checking destination type first.
 */
async function applyFilters(page, { startDate, endDate, staffId, category, notes } = {}) {
  const hasFilterUI = (await page.locator('#Filters_StartDate').count()) > 0;
  if (!hasFilterUI) return false;

  if (startDate) await page.fill('#Filters_StartDate', startDate);
  if (endDate) await page.fill('#Filters_EndDate', endDate);
  if (staffId) await page.selectOption('#Filters_StaffId', String(staffId)).catch(() => {});
  if (category) await page.selectOption('#Filters_Category', category).catch(() => {});
  if (notes) await page.fill('#Filters_Notes', notes);

  await page.evaluate(() => document.querySelector('.mt-icon_search')?.click());
  await page.waitForTimeout(1200);
  return true;
}

/** The Next link is present but visually hidden (its <li> gets `style="display:none"`) once there's no next page — same convention ALIS uses for "Prev" on page 1. */
async function hasNextPage(page) {
  return page.evaluate(() => {
    const next = document.querySelector('.grid-next-page');
    if (!next) return false;
    const li = next.closest('li') || next;
    return getComputedStyle(li).display !== 'none';
  });
}

async function goToNextPage(page) {
  await page.evaluate(() => document.querySelector('.grid-next-page')?.click());
  await page.waitForTimeout(1200);
}

/**
 * Captures every Audit History row for one destination URL, optionally
 * filtered first. `maxPages` is a safety cap (10 rows/page confirmed live,
 * so 50 pages = 500 rows) — a filtered pull should rarely need anywhere
 * near that many; an unfiltered pull against a 100+-page history hitting
 * this cap is a real signal to narrow the date range, not a bug.
 */
async function captureAuditHistory(page, url, { filters, maxPages = 50 } = {}) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  // networkidle fires once the network is quiet, not once Knockout has
  // finished data-binding the Audit History table into the DOM — waiting
  // for the table itself (rather than a fixed timeout) avoids a flaky
  // "No Audit History table found" on a slightly slower render.
  await page.waitForSelector('table.mt-table', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);

  const filtersApplied = filters ? await applyFilters(page, filters) : false;

  const allRows = [];
  let truncated = false;
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const rows = await readAuditRows(page);
    if (rows === null) {
      if (pageNum === 1) throw new Error(`No Audit History table found on ${url}`);
      break;
    }
    // Confirmed live: after a filter narrows the result set, ALIS's own
    // pager widget doesn't always recompute totalPages — hasNextPage() can
    // keep reporting true well past the real last page (observed: 26 real
    // filtered rows, but the pager still claimed more existed all the way
    // to the safety cap). An empty page (not null — the table still
    // exists, it's just "no items to display") is the reliable signal that
    // there's nothing further, regardless of what the pager claims.
    if (rows.length === 0 && pageNum > 1) break;
    allRows.push(...rows);
    if (!(await hasNextPage(page))) break;
    if (pageNum === maxPages) { truncated = true; break; }
    await goToNextPage(page);
  }

  return {
    sourceUrl: url,
    capturedAt: new Date().toISOString(),
    filtersApplied,
    rowCount: allRows.length,
    truncated,
    rows: allRows,
  };
}

module.exports = { captureAuditHistory, readAuditRows, applyFilters };
