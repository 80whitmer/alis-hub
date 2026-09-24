/**
 * companyDetailPage.js
 * Read-only Playwright capture of a single ALIS Admin company's detail page
 * (admin.alisonline.com/Customers/Companies/{id}) — the page that shows the
 * "Company Information" panel (Name, Host, Status, CRM ID, ...) plus the
 * "Communities" table listing every community under that company with its
 * own CRM ID and status badge (Onboarding/Training/blank = Live).
 *
 * This is a different page from EntitlementSets/EditCompany/{id}
 * (entitlementsPage.js) — same numeric admin company ID, different route,
 * different content. CRM ID isn't known to exist on the ALIS export API
 * (per Aaron, Sep 2026), so this is scraped directly like Entitlements.
 */

const COMPANY_DETAIL_URL = (companyId) => `https://admin.alisonline.com/Customers/Companies/${companyId}`;

/**
 * Reads the "Company Information" panel's CRM ID field. The panel is a
 * label/value layout (not a table) — finds the element whose text is
 * exactly "CRM ID" and reads the nearest input's value, falling back to the
 * next sibling's text for a read-only render of the same field.
 */
async function readCompanyCrmId(page) {
  return page.evaluate(() => {
    const labelEls = Array.from(document.querySelectorAll('label, dt, th, span, div, td'))
      .filter((el) => el.children.length === 0 && el.textContent.trim() === 'CRM ID');
    for (const label of labelEls) {
      const row = label.closest('tr, .form-group, .row, dt') || label.parentElement;
      const input = row?.querySelector('input, textarea');
      if (input) return (input.value || '').trim();
      const sibling = label.nextElementSibling;
      if (sibling) return sibling.textContent.trim();
    }
    return null;
  });
}

/**
 * Reads the Communities table: Community Name (with any status badge text
 * captured separately, same anchor-vs-cell distinction as
 * companiesPage.js's readCompanyRows — a badge glued onto the name breaks
 * name matching against HubSpot elsewhere), CRM ID, and the ALIS numeric
 * community ID parsed from the name link's href.
 */
async function readCommunitiesTable(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const headerRow = t.querySelector('thead tr') || t.querySelector('tr');
      if (!headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll('th,td')).map((c) => c.textContent.trim());
      const nameIdx = headers.indexOf('Community Name');
      const crmIdx = headers.indexOf('CRM ID');
      if (nameIdx === -1 || crmIdx === -1) continue;

      const bodyRows = t.querySelectorAll('tbody tr').length
        ? Array.from(t.querySelectorAll('tbody tr'))
        : Array.from(t.querySelectorAll('tr')).filter((r) => r !== headerRow);

      return bodyRows
        .map((r) => {
          const cells = Array.from(r.querySelectorAll('td'));
          const nameCell = cells[nameIdx];
          const nameLink = nameCell?.querySelector('a');
          const nameText = (nameLink?.textContent ?? nameCell?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const href = nameLink?.getAttribute('href') || '';
          const idMatch = href.match(/(\d+)\D*$/);
          // Status badges render as small pill/label elements alongside the
          // name link (e.g. "Onboarding", "Training") — collect any such
          // sibling's text rather than assuming a fixed class name, since
          // exact badge markup wasn't confirmed against live DOM.
          const badgeEls = Array.from(nameCell?.querySelectorAll('span, .badge, .label') || [])
            .filter((el) => el !== nameLink);
          const statusBadges = badgeEls.map((el) => el.textContent.trim()).filter(Boolean);
          return {
            communityName: nameText,
            alisCommunityId: idMatch ? idMatch[1] : null,
            crmId: (cells[crmIdx]?.textContent || '').trim(),
            statusBadges,
            sourceHref: href || null,
          };
        })
        .filter((r) => r.communityName);
    }
    return null;
  });
}

/**
 * Captures { alisAdminCompanyId, companyName, crmId, communities[] } for one
 * company's detail page. `communities` is [] (not null) when the page loads
 * but has no Communities table/rows — callers should treat null fields
 * (crmId) as "field not found on page", not "confirmed blank".
 */
async function captureCompanyDetail(page, companyId) {
  const url = COMPANY_DETAIL_URL(companyId);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(800);

  const crmId = await readCompanyCrmId(page);
  const communities = (await readCommunitiesTable(page)) || [];

  return {
    alisAdminCompanyId: String(companyId),
    sourceUrl: url,
    crmId,
    communities,
    capturedAt: new Date().toISOString(),
  };
}

module.exports = { captureCompanyDetail, COMPANY_DETAIL_URL };
