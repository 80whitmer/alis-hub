/**
 * companiesPage.js
 * Read-only Playwright capture of ALIS Admin's company directory
 * (admin.alisonline.com/Customers/Companies) — the source of truth for
 * each company's ALIS subdomain. "Text Key" is the subdomain (e.g.
 * "12oaksssl" -> 12oaksssl.alisonline.com); "Site" is the server cluster
 * hosting it (BentonHouse/Prod/Prod2/AHT/Hearth/Ent1/...), not a subdomain
 * — confirmed by Aaron, Sep 2026.
 *
 * Column matching is done by header TEXT rather than a fixed selector so
 * it survives most markup differences; pagination handling below is a
 * best-effort guess at common grid patterns — see goToNextPageIfAny.
 *
 * CONFIRMED LIVE (Sep 2026, via alis-product-ops's identical port of this
 * file): 553 real companies read back correctly, including the numeric
 * ALIS Admin Company ID extracted from each row's Company Name link
 * (Aaron: "these are stored on the company urls in ALIS admin... where
 * else" — the id is the trailing digits of that link's href, e.g.
 * /Customers/EntitlementSets/EditCompany/288).
 */

const COMPANIES_URL = 'https://admin.alisonline.com/Customers/Companies';

/**
 * Finds the first table whose header row has both a "Company Name" and a
 * "Text Key" column, and reads every data row currently rendered. Returns
 * null if no such table is present (e.g. still loading, or markup changed).
 */
async function readCompanyRows(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const headerRow = t.querySelector('thead tr') || t.querySelector('tr');
      if (!headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll('th,td')).map((c) => c.textContent.trim());
      const nameIdx = headers.indexOf('Company Name');
      const hostIdx = headers.indexOf('Text Key');
      if (nameIdx === -1 || hostIdx === -1) continue;

      const bodyRows = (t.querySelectorAll('tbody tr').length ? Array.from(t.querySelectorAll('tbody tr')) : Array.from(t.querySelectorAll('tr')).filter((r) => r !== headerRow));

      return bodyRows
        .map((r) => {
          const cells = Array.from(r.querySelectorAll('td'));
          const nameCell = cells[nameIdx];
          // Confirmed live (Sep 2026): the Company Name cell also holds a
          // status badge ("Onboarding"/"Training") as a sibling of the
          // name link — reading the cell's raw textContent glued the badge
          // text onto the name ("1217 Kenwood LLC\n   Onboarding"), which
          // then failed to match this same company's clean HubSpot name
          // everywhere else in the app. The name is a link, so read just
          // the anchor's text; fall back to the whole cell for any row
          // that isn't linked.
          const nameLink = nameCell?.querySelector('a');
          const nameText = nameLink?.textContent ?? nameCell?.textContent ?? '';
          const href = nameLink?.getAttribute('href') || '';
          const idMatch = href.match(/(\d+)\D*$/);
          return {
            companyName: nameText.replace(/\s+/g, ' ').trim(),
            companyHost: (cells[hostIdx]?.textContent || '').trim(),
            alisAdminCompanyId: idMatch ? idMatch[1] : null,
            sourceHref: href || null,
          };
        })
        .filter((r) => r.companyName);
    }
    return null;
  });
}

/**
 * Best-effort click on whatever "next page" control this grid uses. Tries
 * a handful of common pagination markup patterns, then falls back to any
 * clickable element whose visible text is exactly "Next". Returns false
 * (no-op) once nothing matches, which callers treat as "last page reached"
 * — so a grid that turns out to have NO pagination (everything on one page)
 * works fine too, it just never advances past page 1.
 */
async function goToNextPageIfAny(page) {
  const clicked = await page.evaluate(() => {
    const selectors = [
      '.pagination .next:not(.disabled) a',
      'a.paginate_button.next:not(.disabled)',
      'li.next:not(.disabled) a',
      'a[aria-label="Next"]',
      'a[rel="next"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    }
    const candidates = Array.from(document.querySelectorAll('a,button'));
    const next = candidates.find((el) => {
      const text = el.textContent.trim().toLowerCase();
      if (text !== 'next' && text !== '»' && text !== '>') return false;
      const container = el.closest('li') || el;
      return !container.classList.contains('disabled') && !el.disabled;
    });
    if (next) { next.click(); return true; }
    return false;
  });
  if (clicked) await page.waitForTimeout(900);
  return clicked;
}

/**
 * Captures { companyName, companyHost, alisAdminCompanyId, sourceHref }[]
 * for every company row in the admin directory, paging through until no
 * further page is found or `maxPages` is hit (safety cap — mirrors
 * auditHistoryPage.js's convention). Stops early if a page produces no
 * rows whose (name, host) pair wasn't already seen, since some grids
 * report a "next" control even on their last page.
 */
async function captureCompanyDirectory(page, { maxPages = 50 } = {}) {
  await page.goto(COMPANIES_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(800);

  const seen = new Map(); // `${companyName}::${companyHost}` -> row, dedupes across pages
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const rows = await readCompanyRows(page);
    if (rows === null) {
      if (pageNum === 1) throw new Error(`No company directory table found on ${COMPANIES_URL} — page structure may have changed.`);
      break;
    }
    const before = seen.size;
    for (const row of rows) seen.set(`${row.companyName}::${row.companyHost}`, row);
    const advanced = await goToNextPageIfAny(page);
    if (!advanced) break;
    if (seen.size === before && pageNum > 1) break; // next click didn't change anything — treat as last page
  }

  return Array.from(seen.values());
}

module.exports = { captureCompanyDirectory };
