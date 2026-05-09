/**
 * Standalone login test script
 * Tests only the login flow to https://surpass.alisonline.com/Settings/Billing/1069?tab=General
 */

const { chromium } = require('playwright');
require('dotenv').config();

const TARGET_URL = 'https://surpass.alisonline.com/Settings/Billing/1069?tab=private';
const USERNAME = process.env.ALIS_USERNAME;
const PASSWORD = process.env.ALIS_PASSWORD;

async function testLogin() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🧪 ALIS LOGIN TEST');
  console.log('═══════════════════════════════════════════════════════\n');

  if (!USERNAME || !PASSWORD) {
    console.error('❌ ERROR: ALIS_USERNAME or ALIS_PASSWORD not set in .env');
    process.exit(1);
  }

  console.log(`📝 Credentials configured: ${USERNAME}`);
  console.log(`🎯 Target URL: ${TARGET_URL}\n`);

  let browser, page;

  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Step 1: Navigate to target URL
    console.log(`\n📍 Step 1: Navigating to target URL...`);
    console.log(`   URL: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    console.log(`   ✓ Navigation complete`);
    console.log(`   Current URL: ${page.url()}\n`);

    // Take screenshot of initial page
    await page.screenshot({ path: 'test-login-1-initial.png' });
    console.log(`   📸 Screenshot saved: test-login-1-initial.png`);

    // Check if we're on login page (ALIS uses /Login, not /Account/Login)
    const currentUrl = page.url();
    const isOnLogin = currentUrl.includes('/Login') || currentUrl.includes('/Account/Login') || currentUrl.includes('/Account/SignIn');

    if (!isOnLogin) {
      console.log('   ⚠️  Not on login page (already logged in?)');
      console.log('   Current page:', currentUrl);
      await page.screenshot({ path: 'test-login-already-logged-in.png' });
      console.log('   📸 Screenshot saved: test-login-already-logged-in.png');
      console.log('\n✅ Already authenticated!\n');
      await browser.close();
      return;
    }

    console.log('   ✓ On login page');

    // Step 2: Find and inspect login fields
    console.log(`\n📍 Step 2: Locating login fields...`);

    const usernameField = page.locator(
      'input[name="Username"], input[name="UserName"], #Username, #UserName, input[name="Email"], #Email, input[type="text"]'
    ).first();

    const passwordField = page.locator(
      'input[name="Password"], input[type="password"], #Password'
    ).first();

    const usernameVisible = await usernameField.isVisible().catch(() => false);
    const passwordVisible = await passwordField.isVisible().catch(() => false);

    console.log(`   Username field found: ${usernameVisible}`);
    console.log(`   Password field found: ${passwordVisible}`);

    if (!usernameVisible || !passwordVisible) {
      console.error('\n❌ ERROR: Could not find login fields');

      // Get page content for debugging
      const content = await page.content();
      const bodyText = await page.evaluate(() => document.body.innerText);

      console.log('\n📄 Page body text (first 500 chars):');
      console.log(bodyText.substring(0, 500));

      await page.screenshot({ path: 'test-login-2-fields-not-found.png' });
      console.log('\n📸 Screenshot saved: test-login-2-fields-not-found.png');

      await browser.close();
      process.exit(1);
    }

    // Step 3: Fill in credentials
    console.log(`\n📍 Step 3: Filling in credentials...`);

    console.log(`   Entering username: ${USERNAME}`);
    await usernameField.fill(USERNAME);
    await page.waitForTimeout(300);

    console.log(`   Entering password: [hidden]`);
    await passwordField.fill(PASSWORD);
    await page.waitForTimeout(300);

    console.log('   ✓ Credentials entered');

    // Take screenshot of filled form
    await page.screenshot({ path: 'test-login-3-form-filled.png' });
    console.log('   📸 Screenshot saved: test-login-3-form-filled.png');

    // Step 4: Click login button
    console.log(`\n📍 Step 4: Clicking login button...`);

    const loginButton = page.locator(
      'button:has-text("Login"), input[type="submit"], button[type="submit"]'
    ).first();

    const buttonVisible = await loginButton.isVisible().catch(() => false);
    if (!buttonVisible) {
      console.error('❌ ERROR: Could not find login button');
      await page.screenshot({ path: 'test-login-4-button-not-found.png' });
      await browser.close();
      process.exit(1);
    }

    console.log('   Login button found, clicking...');
    await loginButton.click();
    await page.waitForTimeout(1000);

    console.log('   ✓ Login button clicked');

    // Step 5: Wait for login to complete
    console.log(`\n📍 Step 5: Waiting for login to complete...`);

    try {
      await page.waitForFunction(
        () => !window.location.href.includes('/Account/Login') &&
              !window.location.href.includes('/Account/SignIn'),
        { timeout: 10_000 }
      );
      console.log('   ✓ Login succeeded!');
    } catch (err) {
      console.error('   ❌ Login timeout or failed');
      console.log(`   Current URL: ${page.url()}`);

      // Check for error messages on page
      const errorElements = await page.locator('.alert-danger, .error, [role="alert"]').all();
      if (errorElements.length > 0) {
        console.log('\n   Error message(s) on page:');
        for (const elem of errorElements) {
          const text = await elem.textContent();
          console.log(`   - ${text.trim()}`);
        }
      }

      await page.screenshot({ path: 'test-login-5-timeout.png' });
      console.log('   📸 Screenshot saved: test-login-5-timeout.png');
      await browser.close();
      process.exit(1);
    }

    // Step 6: Verify we're on the target page
    console.log(`\n📍 Step 6: Verifying target page...`);

    const finalUrl = page.url();
    console.log(`   Final URL: ${finalUrl}`);

    await page.screenshot({ path: 'test-login-6-final.png' });
    console.log('   📸 Screenshot saved: test-login-6-final.png');

    // Check if we're on the billing settings page
    if (finalUrl.includes('/Settings/Billing')) {
      console.log('   ✓ Successfully on billing settings page!\n');
    } else {
      console.log('   ⚠️  Not on expected page');
      console.log(`   Expected: Contains /Settings/Billing`);
      console.log(`   Got: ${finalUrl}\n`);
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ LOGIN TEST PASSED');
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);

    try {
      await page.screenshot({ path: 'test-login-error.png' });
      console.log('\n📸 Error screenshot saved: test-login-error.png');
    } catch (e) {}

    process.exit(1);

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testLogin();
