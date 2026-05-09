/**
 * Test script to validate GL account sync workflow
 * Tests: login -> navigate to billing -> find item -> open dropdown -> click "Sync Historical GL Records"
 */

const { chromium } = require('playwright');
require('dotenv').config();

const TARGET_URL = 'https://surpass.alisonline.com/Settings/Billing/1069?tab=private';
const USERNAME = process.env.ALIS_USERNAME;
const PASSWORD = process.env.ALIS_PASSWORD;

async function testGLSync() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🔄 GL ACCOUNT SYNC TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  let browser, page;

  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Step 1: Login
    console.log('\n📍 Step 1: Logging in...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    const isOnLogin = page.url().includes('/Login');
    if (isOnLogin) {
      console.log('   On login page, filling credentials...');

      const usernameField = page.locator('input[type="text"]').first();
      const passwordField = page.locator('input[type="password"]').first();

      await usernameField.fill(USERNAME);
      await passwordField.fill(PASSWORD);

      const loginButton = page.locator('button:has-text("Login")').first();
      await loginButton.click();

      await page.waitForFunction(
        () => !window.location.href.includes('/Login'),
        { timeout: 10_000 }
      );

      console.log('   ✓ Login successful');
    } else {
      console.log('   ✓ Already logged in');
    }

    await page.waitForTimeout(1500);

    // Take screenshot of billing page
    await page.screenshot({ path: 'test-gl-billing-page.png', fullPage: true });
    console.log('   📸 Screenshot: test-gl-billing-page.png\n');

    // Step 2: Find first billing item
    console.log('📍 Step 2: Finding first billing item...');

    const itemNameElement = page.locator('table p').first();
    const itemName = await itemNameElement.textContent();
    console.log(`   Found item: "${itemName}"`);

    const itemRow = page.locator(
      `xpath=//p[contains(text(), '${itemName}')]/ancestor::tr`
    ).first();

    const itemVisible = await itemRow.isVisible().catch(() => false);
    if (!itemVisible) {
      throw new Error('Could not find item row');
    }

    console.log('   ✓ Item row found\n');

    // Step 3: Click Options dropdown
    console.log('📍 Step 3: Clicking Options dropdown...');

    const dropdownTrigger = itemRow.locator('.mt-dropdown-btn, .js-dropdown-trigger').first();
    const triggerVisible = await dropdownTrigger.isVisible().catch(() => false);

    if (!triggerVisible) {
      throw new Error('Dropdown trigger button not found');
    }

    console.log('   Clicking dropdown trigger...');
    await dropdownTrigger.click();
    await page.waitForTimeout(600);

    console.log('   📸 Taking screenshot of dropdown menu...');
    await page.screenshot({ path: 'test-gl-dropdown-open.png' });
    console.log('   Screenshot: test-gl-dropdown-open.png\n');

    // Step 4: Click "Sync Historical GL Records" link
    console.log('📍 Step 4: Clicking "Sync Historical GL Records"...');

    const syncLink = page.locator('a.mt-dropdown-list-item-link:has-text("Sync Historical GL Records")').first();
    const syncVisible = await syncLink.isVisible().catch(() => false);

    if (!syncVisible) {
      console.error('   ❌ "Sync Historical GL Records" link not found in dropdown menu');
      console.log('   Available dropdown links:');
      const allLinks = await page.locator('a.mt-dropdown-list-item-link').all();
      for (let i = 0; i < allLinks.length; i++) {
        const text = await allLinks[i].textContent();
        console.log(`     - ${text.trim()}`);
      }
      throw new Error('"Sync Historical GL Records" link not found');
    }

    console.log('   Clicking "Sync Historical GL Records" link...');
    await syncLink.click();
    await page.waitForTimeout(1500);

    console.log('   ✓ Sync action triggered\n');

    // Step 5: Check for success or error message
    console.log('📍 Step 5: Checking for sync result...');

    const errorMsg = page.locator('.alert-error, .error, .alert-danger').first();
    const errorVisible = await errorMsg.isVisible().catch(() => false);

    const successMsg = page.locator('.alert-success, .alert-info').first();
    const successVisible = await successMsg.isVisible().catch(() => false);

    if (errorVisible) {
      const errorText = await errorMsg.textContent().catch(() => 'Unknown error');
      console.log(`   ⚠️  Error message: ${errorText.trim()}`);
    }

    if (successVisible) {
      const successText = await successMsg.textContent().catch(() => 'Success');
      console.log(`   ✓ Success message: ${successText.trim()}`);
    }

    // Take screenshot of result
    await page.screenshot({ path: 'test-gl-sync-result.png', fullPage: true });
    console.log('   📸 Result screenshot: test-gl-sync-result.png');

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ GL SYNC TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('📋 Summary:');
    console.log(`   Item synced: "${itemName}"`);
    console.log('   ✓ Login successful');
    console.log('   ✓ Found billing item');
    console.log('   ✓ Opened dropdown menu');
    console.log('   ✓ Clicked "Sync Historical GL Records"');
    console.log('   ✓ Sync action completed');
    console.log('\n💡 Check the screenshot files to verify the result\n');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);

    try {
      await page.screenshot({ path: 'test-gl-error.png', fullPage: true });
      console.log('\n📸 Error screenshot: test-gl-error.png');
    } catch (e) {}

    process.exit(1);

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testGLSync();
