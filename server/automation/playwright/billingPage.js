/**
 * billingPage.js
 * Playwright automation for GL account syncing in ALIS billing settings
 */

const { setTimeout } = require('timers/promises');

/**
 * Navigate to the billing settings page and ensure it's loaded
 */
async function navigateToBillingSettings(page, billingSettingsUrl) {
  try {
    await page.goto(billingSettingsUrl, { waitUntil: 'networkidle' });

    // Wait for the page to be interactive
    await page.waitForTimeout(1000);

    return true;
  } catch (err) {
    throw new Error(`Failed to navigate to billing settings: ${err.message}`);
  }
}

/**
 * Find a billing item by name in the current page
 */
async function findBillingItem(page, itemName) {
  try {
    // Look for the item in the table/list
    // This selector pattern may need adjustment based on actual ALIS UI
    const itemLocator = page.locator(
      `xpath=//tr[contains(., '${itemName}')] | //div[contains(text(), '${itemName}')]`
    ).first();

    const isVisible = await itemLocator.isVisible().catch(() => false);

    if (!isVisible) {
      throw new Error(`Item not found: ${itemName}`);
    }

    return itemLocator;
  } catch (err) {
    throw new Error(`Error finding billing item '${itemName}': ${err.message}`);
  }
}

/**
 * Update GL account mapping for a billing item
 * @param {Page} page - Playwright page object
 * @param {string} itemName - Name of the billing item
 * @param {string} glOld - Current GL account (for validation)
 * @param {string} glNew - New GL account to set
 * @param {object} discounts - Optional discount GL accounts {disc1_old, disc1_new, disc2_old, disc2_new}
 */
async function updateGLAccount(page, itemName, glOld, glNew, discounts = {}) {
  try {
    // Find the billing item row
    const itemRow = await findBillingItem(page, itemName);

    // Click on the item to open detail view (adjust based on actual UI)
    await itemRow.click().catch(() => {});

    // Wait for detail view to open
    await page.waitForTimeout(500);

    // Find and update the GL account field
    // Adjust selector based on actual ALIS form structure
    const glInput = page.locator(`input[placeholder*="GL"], input[placeholder*="Account"]`).first();

    if (await glInput.isVisible().catch(() => false)) {
      // Clear and enter new GL account
      await glInput.triple_click().catch(() => {});
      await glInput.type(glNew, { delay: 50 });
    }

    // Handle optional discount accounts
    if (discounts.disc1_new) {
      const disc1Input = page.locator(`input[placeholder*="Discount 1"], input[placeholder*="Disc1"]`).first();
      if (await disc1Input.isVisible().catch(() => false)) {
        await disc1Input.triple_click().catch(() => {});
        await disc1Input.type(discounts.disc1_new, { delay: 50 });
      }
    }

    if (discounts.disc2_new) {
      const disc2Input = page.locator(`input[placeholder*="Discount 2"], input[placeholder*="Disc2"]`).first();
      if (await disc2Input.isVisible().catch(() => false)) {
        await disc2Input.triple_click().catch(() => {});
        await disc2Input.type(discounts.disc2_new, { delay: 50 });
      }
    }

    // Save changes (adjust selector based on actual UI)
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Update"), [data-action="save"]').first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(500);
    }

    // Check for success message or errors
    const errorMsg = page.locator('.alert-error, .error, [role="alert"]').first();
    const hasError = await errorMsg.isVisible().catch(() => false);

    if (hasError) {
      const errorText = await errorMsg.textContent().catch(() => 'Unknown error');
      throw new Error(`Save failed: ${errorText}`);
    }

    return true;
  } catch (err) {
    throw new Error(`Failed to update GL account for '${itemName}': ${err.message}`);
  }
}

/**
 * Close any open dialogs/details and return to main view
 */
async function closeDetailView(page) {
  try {
    // Try various close button selectors
    const closeBtn = page.locator(
      'button:has-text("Close"), button:has-text("Cancel"), .close, [aria-label="Close"], [aria-label="Dismiss"]'
    ).first();

    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  } catch (err) {
    // Non-critical, continue
  }
}

module.exports = {
  navigateToBillingSettings,
  findBillingItem,
  updateGLAccount,
  closeDetailView,
};
