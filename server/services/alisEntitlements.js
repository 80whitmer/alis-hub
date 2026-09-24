/**
 * Live ALIS admin entitlements — the "Used"/"Enabled" side of the Account
 * Truth model ported from alis-product-ops (Aaron, Sep 2026: "digging the
 * account truth model -- could we bring it over and integrate it with the
 * team am / account health dashboards"). Requires the ALIS Admin Company
 * ID for this account (server/db/database.js's alis_admin_ids table),
 * entered once per account, same as this repo's existing manual "ALIS
 * Admin Company ID(s)" usage-audit job field, or auto-populated via
 * alisCompanyDiscovery.js.
 *
 * Deliberately simpler than usageAuditCatalog.js: that catalog maps ~36
 * features with per-mapping confidence levels, built for one specific
 * company's (Imagine Senior Living's) roadmap review — porting it
 * wholesale would carry assumptions ("ambiguous"/"ungated" confidence
 * levels) that don't generalize portfolio-wide. This instead surfaces
 * every flag (on and off) grouped by ALIS product category
 * (entitlementCategories.js) and cross-checked against HubSpot's
 * `alis_products` field for mismatches — ported verbatim from
 * alis-product-ops, already confirmed live there against real ALIS admin
 * data (Bethesda Senior Living, Viva Senior Living).
 */
const { newPage, ensureLoggedIn } = require('../automation/playwright/browser');
const { captureEntitlements } = require('../automation/playwright/entitlementsPage');
const { groupEntitlements, categorize } = require('./entitlementCategories');

/** "resident_compliance_entitlement_8" -> "Resident Compliance" — strips the "_entitlement_<id>" suffix and title-cases the rest. */
function humanizeFlagId(flagId) {
  const withoutSuffix = flagId.replace(/_entitlement_\d+$/i, '');
  return withoutSuffix
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Logs into ALIS admin, scrapes the Entitlements page for `alisAdminCompanyId`,
 * and returns every flag (on AND off — the "recommend enabling" analysis
 * needs the names of what's currently off, not just what's on) grouped into
 * ALIS product categories and cross-checked against `hubspotProducts`
 * (the company's `alis_products` field) for mismatches. Opens and closes
 * its own browser context per call — see browser.js's doc comment on why
 * there's no cross-call session reuse.
 */
async function getLiveEntitlements(alisAdminCompanyId, hubspotProducts) {
  const page = await newPage();
  try {
    await ensureLoggedIn(page);
    const capture = await captureEntitlements(page, alisAdminCompanyId);
    const flags = Object.entries(capture.flags)
      .map(([id, enabled]) => ({ id, label: humanizeFlagId(id), enabled }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const enabledCount = flags.filter((f) => f.enabled).length;
    const { categories, soldWithNoFlags } = groupEntitlements(flags, hubspotProducts);
    return {
      capturedAt: capture.capturedAt,
      sourceUrl: capture.sourceUrl,
      totalFlagCount: flags.length,
      enabledCount,
      categories,
      soldWithNoFlags,
    };
  } finally {
    await page.context().close();
  }
}

/**
 * Portfolio-wide version for the "Run portfolio entitlement check" job
 * (server/services/portfolioEntitlementsJob.js) — every account with an
 * ALIS Admin Company ID on file, ONE browser context/login reused across
 * all of them (unlike getLiveEntitlements' per-call context) since logging
 * in fresh per account would dominate the run time at portfolio scale.
 * `accounts` is [{ hubspotCompanyId, companyName, alisAdminCompanyId }];
 * a bad/stale id fails that one account (reported via `onProgress`'s
 * `error`) without aborting the run. `onSnapshot(hubspotCompanyId,
 * companyName, flags)` is called after each successful scrape so the
 * caller can persist incrementally rather than holding everything in
 * memory until the whole run finishes.
 */
async function getLiveEntitlementsBulk(accounts, { onProgress, onSnapshot } = {}) {
  const page = await newPage();
  try {
    await ensureLoggedIn(page);
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      onProgress?.({ index: i, total: accounts.length, companyName: a.companyName, status: 'running' });
      try {
        const capture = await captureEntitlements(page, a.alisAdminCompanyId);
        const flags = Object.entries(capture.flags).map(([id, enabled]) => ({
          id, label: humanizeFlagId(id), category: categorize(id), enabled,
        }));
        await onSnapshot?.(a.hubspotCompanyId, a.companyName, flags);
        onProgress?.({ index: i, total: accounts.length, companyName: a.companyName, status: 'done' });
      } catch (err) {
        onProgress?.({ index: i, total: accounts.length, companyName: a.companyName, status: 'error', error: err.message });
      }
    }
  } finally {
    await page.context().close();
  }
}

module.exports = { getLiveEntitlements, getLiveEntitlementsBulk, humanizeFlagId };
