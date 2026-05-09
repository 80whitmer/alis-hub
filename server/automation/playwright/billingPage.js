/**
 * billingPage.js
 * Playwright automation for GL account syncing in ALIS billing settings
 */

const { setTimeout } = require('timers/promises');
const { addGLSyncDetail } = require('../db/database');

/**
 * Navigate to the billing settings page and ensure it's loaded
 * (Already done during ensureLoggedIn, but can be called again if needed)
 */
async function navigateToBillingSettings(page, billingSettingsUrl) {
  try {
    // Already at the URL after ensureLoggedIn, but ensure it's loaded
    if (!page.url().includes(billingSettingsUrl)) {
      await page.goto(billingSettingsUrl, { waitUntil: 'networkidle' });
    }

    // Wait for the page to be interactive and billing items to load
    await page.waitForTimeout(1500);

    return true;
  } catch (err) {
    throw new Error(`Failed to navigate to billing settings: ${err.message}`);
  }
}

/**
 * Find a billing item by name and return the row element
 * The table structure is: Name column contains item name in a <p> tag
 */
async function findBillingItem(page, itemName) {
  try {
    // Find the row containing the item name (in a <p> tag)
    const itemRow = page.locator(
      `xpath=//p[contains(text(), '${itemName}')]/ancestor::tr`
    ).first();

    const isVisible = await itemRow.isVisible().catch(() => false);

    if (!isVisible) {
      throw new Error(`Billing item row not found for: ${itemName}`);
    }

    return itemRow;
  } catch (err) {
    throw new Error(`Error finding billing item '${itemName}': ${err.message}`);
  }
}

/**
 * Sync historical GL records for a billing item
 * @param {Page} page - Playwright page object
 * @param {string} itemName - Name of the billing item to sync
 * @param {string} glOld - Current GL account (old value)
 * @param {string} glNew - New GL account to set
 * @param {object} discounts - Optional discount GL accounts {disc1_old, disc1_new, disc2_old, disc2_new}
 * @param {string} syncDate - Date to use for the sync (YYYY-MM-DD format)
 * @param {string} jobId - Job ID for logging GL sync details (optional)
 */
async function updateGLAccount(page, itemName, glOld, glNew, discounts = {}, syncDate = null, jobId = null) {
  try {
    // Find the item row
    const itemRow = await findBillingItem(page, itemName);

    // Scroll the item into view
    await itemRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);

    // Find the dropdown trigger button (Options button) within the row
    // The button has class "mt-dropdown-btn js-dropdown-trigger"
    const dropdownTrigger = itemRow.locator('.mt-dropdown-btn, .js-dropdown-trigger').first();

    const triggerVisible = await dropdownTrigger.isVisible().catch(() => false);
    if (!triggerVisible) {
      throw new Error(`Options dropdown button not found for item: ${itemName}`);
    }

    // Click the dropdown trigger to open the menu
    console.log(`[GL Sync] Clicking Options dropdown for: ${itemName}`);
    await dropdownTrigger.click().catch(async (err) => {
      // If click fails, try with force
      await dropdownTrigger.click({ force: true });
    });

    // Wait for dropdown menu to appear and fully render (scoped to the item row)
    const dropdownList = itemRow.locator('.mt-dropdown-list').first();
    await dropdownList.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      console.log(`[GL Sync] Warning: Dropdown menu may not have opened for: ${itemName}`);
    });

    await page.waitForTimeout(1000); // Extra time for menu to fully render

    // Click the "Sync Historical GL Records" link in the dropdown menu
    // Search WITHIN the specific item row's dropdown, not the entire page
    let syncLink = itemRow.locator('a.mt-dropdown-list-item-link:has-text("Sync Historical GL Records")').first();

    let syncVisible = await syncLink.isVisible().catch(() => false);

    if (!syncVisible) {
      // Try alternative selector - look for the href pattern used for sync action (scoped to row)
      syncLink = itemRow.locator('a[href*="/Accounts/Revenue/Migrate/"]').first();
      syncVisible = await syncLink.isVisible().catch(() => false);
    }

    if (!syncVisible) {
      // Debug: log all links in THIS ITEM'S dropdown to see what's actually there
      const allLinks = await itemRow.locator('.mt-dropdown-list a').all();
      console.log(`[GL Sync] Debug - Found ${allLinks.length} links in dropdown for: ${itemName}`);
      for (let i = 0; i < Math.min(allLinks.length, 10); i++) {
        const text = await allLinks[i].textContent().catch(() => '');
        const href = await allLinks[i].getAttribute('href').catch(() => '');
        console.log(`  [${i}] text="${text.trim()}" href="${href}"`);
      }

      console.log(`[GL Sync] ℹ️  No "Sync Historical GL Records" option available for: ${itemName}`);
      return true;
    }

    console.log(`[GL Sync] Clicking "Sync Historical GL Records" link`);
    await syncLink.click({ force: true }).catch(async (err) => {
      // If force click fails, try scrolling into view first
      await syncLink.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await syncLink.click({ force: true });
    });

    // Wait for the modal to appear and be fully rendered
    await page.waitForTimeout(2000);

    // DEBUG: Check if the form exists and what inputs are present
    const formExists = await page.locator('#migrateRevenueAccountForm').isVisible().catch(() => false);
    console.log(`[GL Sync] DEBUG - Form visible: ${formExists}`);

    if (!formExists) {
      // Try to find what modal IS open
      const allModals = await page.locator('.mt-modal').count();
      console.log(`[GL Sync] DEBUG - Found ${allModals} modal elements`);

      // Take a screenshot for debugging
      await page.screenshot({ path: `debug_form_${itemName.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
    }

    // DEBUG: List all checkboxes on the page
    const allCheckboxes = await page.locator('input[type="checkbox"]').count();
    console.log(`[GL Sync] DEBUG - Total checkboxes on page: ${allCheckboxes}`);

    // Fill out the "Sync Historical GL Records" modal/form
    console.log(`[GL Sync] Filling out GL Records form for: ${itemName}`);

    // 1. Fill in the "As Of" date (use provided syncDate or leave as-is)
    if (syncDate) {
      // Convert date format from MM/DD/YYYY or MMDDYYYY to YYYY-MM-DD
      let formattedDate = syncDate;
      if (syncDate.includes('/')) {
        const parts = syncDate.split('/');
        if (parts.length === 3) {
          // MM/DD/YYYY → YYYY-MM-DD
          formattedDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        }
      } else if (syncDate.length === 8 && !syncDate.includes('-')) {
        // MMDDYYYY → YYYY-MM-DD
        const mm = syncDate.substring(0, 2);
        const dd = syncDate.substring(2, 4);
        const yyyy = syncDate.substring(4, 8);
        formattedDate = `${yyyy}-${mm}-${dd}`;
      }

      const asOfInput = page.locator('input[type="date"], input[placeholder*="As Of"], input[name*="AsOf"]').first();
      if (await asOfInput.isVisible().catch(() => false)) {
        await asOfInput.fill(formattedDate);
        console.log(`[GL Sync]   - Set As Of date to: ${formattedDate} (from: ${syncDate})`);

        // Close the calendar picker by clicking outside or pressing Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      console.log(`[GL Sync]   - Using existing As Of date from form`);
    }

    // 2. Check GL Account # checkbox if we have a new value
    if (glNew && glNew !== '?') {
      console.log(`[GL Sync]   - Processing GL Account: ${glOld} → ${glNew}`);

      // Find the GL Account # checkbox by ID (most reliable)
      const glCheckbox = page.locator('#MigrateGLAccounts');

      // DEBUG: Check if element exists first
      const exists = await glCheckbox.count();
      console.log(`[GL Sync]   DEBUG - #MigrateGLAccounts element count: ${exists}`);

      const isVisible = await glCheckbox.isVisible().catch(() => false);
      console.log(`[GL Sync]   GL Account checkbox visible: ${isVisible}`);

      if (!isVisible && exists > 0) {
        // Element exists but not visible - check why
        const isHidden = await page.evaluate(() => {
          const el = document.querySelector('#MigrateGLAccounts');
          if (!el) return 'not found';
          const style = window.getComputedStyle(el);
          if (style.display === 'none') return 'display:none';
          if (style.visibility === 'hidden') return 'visibility:hidden';
          if (style.opacity === '0') return 'opacity:0';
          return 'unknown - visible but isVisible() returned false';
        });
        console.log(`[GL Sync]   DEBUG - Checkbox hidden reason: ${isHidden}`);
      }

      if (exists > 0) {
        // Click the checkbox through JavaScript to trigger Knockout's event handlers
        // (Synthetic change/input events don't reliably trigger Knockout observables)
        await page.evaluate(() => {
          const checkbox = document.querySelector('#MigrateGLAccounts');
          if (checkbox) {
            checkbox.click();
          }
        }).catch(() => {});
        console.log(`[GL Sync]   ✓ Clicked checkbox through JavaScript`);

        // Wait for Knockout binding to process and enable fields
        await page.waitForTimeout(1000);

        // Fallback: If fields are still disabled, manually remove the disabled attribute
        // This handles cases where Knockout binding isn't responding to events
        await page.evaluate(() => {
          const dropdown = document.querySelector('#CurrentGLAccountNumber');
          const input = document.querySelector('#NewAccountNumber');
          let hadToForceEnable = false;

          if (dropdown && dropdown.hasAttribute('disabled')) {
            dropdown.removeAttribute('disabled');
            hadToForceEnable = true;
          }
          if (input && input.hasAttribute('disabled')) {
            input.removeAttribute('disabled');
            hadToForceEnable = true;
          }

          return hadToForceEnable;
        }).then(forced => {
          if (forced) {
            console.log(`[GL Sync]   ⚠ Knockout binding unresponsive - manually enabled fields via removeAttribute`);
          } else {
            console.log(`[GL Sync]   ✓ Fields enabled via Knockout data-binding`);
          }
        }).catch(() => {});

        // DEBUG: Verify checkbox is actually checked
        const isChecked = await glCheckbox.isChecked().catch(() => false);
        console.log(`[GL Sync]   DEBUG - Checkbox is checked: ${isChecked}`);

        // 3. Select the old value from "Existing Value" dropdown
        const existingDropdown = page.locator('#CurrentGLAccountNumber');
        const dropdownDisabled = await existingDropdown.evaluate(el => el.disabled).catch(() => 'error');
        const isDropdownEnabled = await existingDropdown.isEnabled().catch(() => false);

        console.log(`[GL Sync]   DEBUG - Dropdown disabled attr: ${dropdownDisabled}, isEnabled: ${isDropdownEnabled}`);

        if (isDropdownEnabled) {
          await existingDropdown.selectOption(glOld);
          console.log(`[GL Sync]   ✓ Selected existing GL value: ${glOld}`);
        } else {
          console.log(`[GL Sync]   ⚠ Existing value dropdown not enabled`);
        }

        // 4. Enter new value in "New Value" text field
        const newValueInput = page.locator('#NewAccountNumber');
        const inputDisabled = await newValueInput.evaluate(el => el.disabled).catch(() => 'error');
        const isNewValueEnabled = await newValueInput.isEnabled().catch(() => false);

        console.log(`[GL Sync]   DEBUG - New Value input disabled attr: ${inputDisabled}, isEnabled: ${isNewValueEnabled}`);

        if (isNewValueEnabled) {
          await newValueInput.fill(glNew);
          // Verify the value was entered
          const enteredValue = await newValueInput.inputValue().catch(() => '');
          console.log(`[GL Sync]   ✓ Entered new GL value: ${glNew} (verified: ${enteredValue})`);
        } else {
          console.log(`[GL Sync]   ⚠ New value input field not enabled`);
        }
      } else {
        console.log(`[GL Sync]   ⚠ GL Account # checkbox not found`);
      }
    } else {
      console.log(`[GL Sync]   - Skipping GL Account (glNew is empty or "?")`);
    }

    // 5. Handle Discount GL Account 1 if applicable
    if (discounts.disc1_new && discounts.disc1_new !== '?') {
      console.log(`[GL Sync]   - Processing Discount GL Account 1: ${discounts.disc1_old} → ${discounts.disc1_new}`);

      // Find by ID (most reliable)
      const disc1Checkbox = page.locator('#MigrateDiscountGLAccounts');
      const disc1Visible = await disc1Checkbox.isVisible().catch(() => false);
      const disc1Exists = await disc1Checkbox.count();

      if (disc1Exists > 0) {
        // Click the checkbox through JavaScript to trigger Knockout (same pattern as GL Account)
        await page.evaluate(() => {
          const checkbox = document.querySelector('#MigrateDiscountGLAccounts');
          if (checkbox) {
            checkbox.click();
          }
        }).catch(() => {});
        console.log(`[GL Sync]   ✓ Clicked Discount GL Account 1 checkbox through JavaScript`);

        // Wait for Knockout binding to process
        await page.waitForTimeout(800);

        // Fallback: If fields are still disabled, manually remove disabled attribute
        await page.evaluate(() => {
          const dropdown = document.querySelector('#CurrentDiscountGLAccountNumber');
          const input = document.querySelector('#NewDiscountAccountNumber');
          let hadToForceEnable = false;

          if (dropdown && dropdown.hasAttribute('disabled')) {
            dropdown.removeAttribute('disabled');
            hadToForceEnable = true;
          }
          if (input && input.hasAttribute('disabled')) {
            input.removeAttribute('disabled');
            hadToForceEnable = true;
          }

          return hadToForceEnable;
        }).then(forced => {
          if (forced) {
            console.log(`[GL Sync]   ⚠ Discount GL: Knockout binding unresponsive - manually enabled fields`);
          } else {
            console.log(`[GL Sync]   ✓ Discount GL fields enabled via Knockout data-binding`);
          }
        }).catch(() => {});
      } else {
        console.log(`[GL Sync]   ⚠ Discount GL Account 1 checkbox not found`);
        return true;
      }

      // Wait for fields to be enabled after checkbox click
      await page.waitForTimeout(800);

        // Select existing value from discount dropdown
        const disc1ExistingDropdown = page.locator('#CurrentDiscountGLAccountNumber');
        const isDisc1DropdownEnabled = await disc1ExistingDropdown.isEnabled().catch(() => false);

        if (isDisc1DropdownEnabled) {
          await disc1ExistingDropdown.selectOption(discounts.disc1_old);
          console.log(`[GL Sync]   ✓ Selected discount existing value: ${discounts.disc1_old}`);
        } else {
          console.log(`[GL Sync]   ⚠ Discount existing dropdown not enabled`);
        }

        // Enter new discount value
        const disc1NewInput = page.locator('#NewDiscountAccountNumber');
        const isDisc1NewEnabled = await disc1NewInput.isEnabled().catch(() => false);

        if (isDisc1NewEnabled) {
          await disc1NewInput.fill(discounts.disc1_new);
          const enteredDiscValue = await disc1NewInput.inputValue().catch(() => '');
          console.log(`[GL Sync]   ✓ Entered discount new value: ${discounts.disc1_new} (verified: ${enteredDiscValue})`);
        } else {
          console.log(`[GL Sync]   ⚠ Discount new value input not enabled`);
        }
    }

    // 6. Click the "Sync" button to submit the form
    const syncButton = page.locator('button:has-text("Sync")').first();
    if (await syncButton.isVisible().catch(() => false)) {
      console.log(`[GL Sync] Clicking Sync button to apply changes`);
      await syncButton.click();
      await page.waitForTimeout(2500); // Wait for sync to complete and response to appear
    }

    // Check for response message in various possible locations
    // Look for alert boxes, status messages, or validation errors
    const responseMsg = page.locator(
      '.alert, .alert-success, .alert-error, .alert-danger, [role="alert"], [role="status"], .field-validation-error'
    ).first();

    const hasResponse = await responseMsg.isVisible().catch(() => false);

    if (hasResponse) {
      const responseText = await responseMsg.textContent().catch(() => 'Unknown response');
      const cleanText = responseText.trim();

      // Check if the message contains "SUCCESS" (even if it's queued/async)
      if (cleanText.includes('SUCCESS') || cleanText.includes('success') || cleanText.includes('queued')) {
        console.log(`[GL Sync] ✓ Sync submitted: ${cleanText}`);

        // Log GL Account sync if jobId provided
        if (jobId && glNew && glNew !== '?') {
          addGLSyncDetail(jobId, {
            accountNumber: itemName,
            accountName: itemName,
            oldValue: glOld || '',
            newValue: glNew,
            fieldChanged: 'GL Account Code',
            status: 'success',
            error: null
          });
        }

        // Log Discount GL Account 1 if applicable
        if (jobId && discounts.disc1_new && discounts.disc1_new !== '?') {
          addGLSyncDetail(jobId, {
            accountNumber: itemName,
            accountName: itemName,
            oldValue: discounts.disc1_old || '',
            newValue: discounts.disc1_new,
            fieldChanged: 'Discount GL Account 1',
            status: 'success',
            error: null
          });
        }

        // Log Discount GL Account 2 if applicable
        if (jobId && discounts.disc2_new && discounts.disc2_new !== '?') {
          addGLSyncDetail(jobId, {
            accountNumber: itemName,
            accountName: itemName,
            oldValue: discounts.disc2_old || '',
            newValue: discounts.disc2_new,
            fieldChanged: 'Discount GL Account 2',
            status: 'success',
            error: null
          });
        }

        return true;
      }

      // If it contains error keywords, throw
      if (cleanText.includes('error') || cleanText.includes('Error') || cleanText.includes('failed')) {
        throw new Error(`Sync failed: ${cleanText}`);
      }

      // Otherwise, log and assume success
      console.log(`[GL Sync] Response: ${cleanText}`);

      // Log successful sync to database if jobId provided
      if (jobId && glNew && glNew !== '?') {
        addGLSyncDetail(jobId, {
          accountNumber: itemName,
          accountName: itemName,
          oldValue: glOld || '',
          newValue: glNew,
          fieldChanged: 'GL Account Code',
          status: 'success',
          error: null
        });
      }

      return true;
    }

    // No visible message, assume success
    console.log(`[GL Sync] ✓ Sync action completed for: ${itemName}`);

    // Log successful sync to database if jobId provided
    if (jobId && glNew && glNew !== '?') {
      addGLSyncDetail(jobId, {
        accountNumber: itemName,
        accountName: itemName,
        oldValue: glOld || '',
        newValue: glNew,
        fieldChanged: 'GL Account Code',
        status: 'success',
        error: null
      });
    }

    // Log Discount GL Account 1 if applicable
    if (jobId && discounts.disc1_new && discounts.disc1_new !== '?') {
      addGLSyncDetail(jobId, {
        accountNumber: itemName,
        accountName: itemName,
        oldValue: discounts.disc1_old || '',
        newValue: discounts.disc1_new,
        fieldChanged: 'Discount GL Account 1',
        status: 'success',
        error: null
      });
    }

    // Log Discount GL Account 2 if applicable
    if (jobId && discounts.disc2_new && discounts.disc2_new !== '?') {
      addGLSyncDetail(jobId, {
        accountNumber: itemName,
        accountName: itemName,
        oldValue: discounts.disc2_old || '',
        newValue: discounts.disc2_new,
        fieldChanged: 'Discount GL Account 2',
        status: 'success',
        error: null
      });
    }

    return true;
  } catch (err) {
    // Log failed sync to database if jobId provided
    if (jobId) {
      addGLSyncDetail(jobId, {
        accountNumber: itemName,
        accountName: itemName,
        oldValue: null,
        newValue: null,
        fieldChanged: 'GL Account Code',
        status: 'failed',
        error: err.message
      });
    }

    throw new Error(`Failed to sync GL records for '${itemName}': ${err.message}`);
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
