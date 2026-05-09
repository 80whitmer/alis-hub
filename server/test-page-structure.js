/**
 * Test to inspect the actual HTML structure of the billing page
 */

const { chromium } = require('playwright');
require('dotenv').config();

const TARGET_URL = 'https://surpass.alisonline.com/Settings/Billing/1069?tab=private';
const USERNAME = process.env.ALIS_USERNAME;
const PASSWORD = process.env.ALIS_PASSWORD;

async function testPageStructure() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🔍 BILLING PAGE STRUCTURE INSPECTION');
  console.log('═══════════════════════════════════════════════════════\n');

  let browser, page;

  try {
    // Launch browser
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Login
    console.log('🔐 Logging in...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    const isOnLogin = page.url().includes('/Login');
    if (isOnLogin) {
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
    }

    await page.waitForTimeout(2000);

    console.log('✓ Logged in successfully\n');

    // Take full page screenshot
    await page.screenshot({ path: 'billing-page-full.png', fullPage: true });
    console.log('📸 Full page screenshot: billing-page-full.png\n');

    // Get the HTML of the first few table rows
    console.log('📄 Inspecting table structure:\n');

    // Find the table that contains actual billing items (look for GL Account # column)
    const tables = await page.locator('table').all();
    console.log(`Total tables found: ${tables.length}\n`);

    let billingItemsTable = null;
    for (let i = 0; i < tables.length; i++) {
      const headerText = await tables[i].evaluate(el => el.innerText);
      if (headerText.includes('GL Account') || headerText.includes('Assisted Living')) {
        billingItemsTable = tables[i];
        console.log(`✓ Found billing items table at index ${i}\n`);
        break;
      }
    }

    if (!billingItemsTable) {
      console.log('⚠️  Could not find billing items table. Showing all tables:\n');
      for (let i = 0; i < tables.length; i++) {
        const headerText = await tables[i].evaluate(el => el.innerText.substring(0, 100));
        console.log(`Table ${i}: ${headerText}...\n`);
      }
    } else {
      const rows = await billingItemsTable.locator('tbody tr').all();
      console.log(`Billing items rows found: ${rows.length}\n`);

      if (rows.length > 0) {
        console.log('First billing item row HTML:');
        const firstRowHtml = await rows[0].evaluate(el => el.outerHTML);
        console.log(firstRowHtml);
        console.log('\n');
      }
    }

    if (billingItemsTable) {
      // Look for "Options" buttons/links in the billing items table
      console.log('🔎 Searching for Options/Edit buttons in billing items table...\n');

      const optionsLinks = await billingItemsTable.locator('a:has-text("Options")').all();
      console.log(`Options links found: ${optionsLinks.length}`);

      if (optionsLinks.length === 0) {
        // Look for Edit links instead
        const editLinks = await billingItemsTable.locator('a:has-text("Edit")').all();
        console.log(`Edit links found: ${editLinks.length}`);

        if (editLinks.length > 0) {
          console.log('\nFirst Edit link HTML:');
          const firstEditHtml = await editLinks[0].evaluate(el => el.outerHTML);
          console.log(firstEditHtml);
        }
      } else {
        console.log('\nFirst Options link HTML:');
        const firstOptHtml = await optionsLinks[0].evaluate(el => el.outerHTML);
        console.log(firstOptHtml);
      }

      // Get the first item name
      console.log('\n🔎 Looking for first item name...\n');

      const firstItemCell = await billingItemsTable.locator('tbody tr:first-child td:first-child');
      const firstItemName = await firstItemCell.evaluate(el => el.innerText);
      console.log(`First item name: "${firstItemName}"\n`);

      // Get the full HTML of the first row for analysis
      console.log('Full first billing item row:');
      const fullRowHtml = await billingItemsTable.locator('tbody tr:first-child').evaluate(el => el.outerHTML);
      console.log(fullRowHtml);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✅ INSPECTION COMPLETE');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('💡 Tip: Check billing-page-full.png for the visual structure');
    console.log('    and the HTML output above for the actual element names.\n');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testPageStructure();
