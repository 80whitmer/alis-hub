/**
 * entitlementsPage.js
 * Read-only Playwright capture of a company's ALIS Entitlements page
 * (admin.alisonline.com/Customers/EntitlementSets/EditCompany/{id}).
 *
 * Confirmed live (2026-09-03, company 353): every entitlement toggle is a
 * checkbox whose id/name is `<feature_slug>_entitlement_<numericId>` — no
 * useful <label> text is attached (getLabel-style DOM walking, as used in
 * residentSettingsPage.js, returned '' for all 131), so this reads the id
 * directly rather than trying to resolve a display label. The numeric
 * suffix is assumed to be a global entitlement-type ID (stable across
 * companies), not something to attach to the enabled/disabled state itself.
 */

async function captureEntitlements(page, companyId) {
  const url = `https://admin.alisonline.com/Customers/EntitlementSets/EditCompany/${companyId}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const flags = {};
    document.querySelectorAll('input[type="checkbox"][id*="_entitlement_"]').forEach((cb) => {
      flags[cb.id] = cb.checked;
    });
    const entitlementSetSelect = document.querySelector('#EntitlementSetId');
    return {
      flags,
      entitlementSetId: entitlementSetSelect ? entitlementSetSelect.value : null,
    };
  });

  const flagCount = Object.keys(result.flags).length;
  if (flagCount === 0) {
    throw new Error(`No entitlement checkboxes found on ${url} — page structure may have changed, or company ${companyId} doesn't exist`);
  }

  return {
    capturedAt: new Date().toISOString(),
    sourceUrl: url,
    companyId: String(companyId),
    entitlementSetId: result.entitlementSetId,
    flags: result.flags, // { [entitlementFlagId]: boolean }
  };
}

module.exports = { captureEntitlements };
