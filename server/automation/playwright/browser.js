const { chromium } = require('playwright');

let _browser = null;

/**
 * Returns a shared browser instance (lazy-launched).
 * Call closeBrowser() when the server shuts down.
 */
async function getBrowser() {
  if (!_browser) {
    const headed = process.env.PLAYWRIGHT_HEADED === 'true';
    _browser = await chromium.launch({
      headless: !headed,
      slowMo:   headed ? 80 : 50,
    });
    console.log(`🎭  Playwright browser launched (headless: ${!headed})`);
  }
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/**
 * Creates a fresh page in a new context.
 * Viewport matches what v10 used.
 */
async function newPage() {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return context.newPage();
}

/**
 * Ensure the page is logged in to ALIS admin.
 * Idempotent — safe to call before every job.
 * @param {Page} page - Playwright page object
 * @param {string} targetUrl - Optional target URL to navigate to (skips admin.alisonline.com redirect)
 */
async function ensureLoggedIn(page, targetUrl = null) {
  const username = process.env.ALIS_USERNAME;
  const password = process.env.ALIS_PASSWORD;

  if (!username || !password) {
    throw new Error('ALIS_USERNAME / ALIS_PASSWORD not set in .env');
  }

  // If target URL provided, navigate directly there (it will redirect to login if needed)
  const navUrl = targetUrl || 'https://admin.alisonline.com/';
  await page.goto(navUrl, { waitUntil: 'networkidle' });

  const url = page.url();
  // Check for login pages (ALIS uses /Login, not /Account/Login)
  if (!url.includes('/Login') && !url.includes('/Account/Login') && !url.includes('/Account/SignIn')) {
    return; // already logged in
  }

  // We're on login page, fill in credentials
  console.log('[Login] Filling username and password...');

  const usernameField = page.locator(
    'input[name="Username"], input[name="UserName"], #Username, #UserName, input[name="Email"], #Email, input[type="text"]'
  ).first();

  const passwordField = page.locator(
    'input[name="Password"], input[type="password"], #Password'
  ).first();

  const usernameVisible = await usernameField.isVisible().catch(() => false);
  const passwordVisible = await passwordField.isVisible().catch(() => false);

  console.log(`[Login] Username field visible: ${usernameVisible}, Password field visible: ${passwordVisible}`);

  if (!usernameVisible || !passwordVisible) {
    // Take screenshot to see what's on the page
    await page.screenshot({ path: 'login_page_error.png', fullPage: true }).catch(() => {});
    throw new Error('Could not find login fields on page');
  }

  await usernameField.fill(username);
  await page.waitForTimeout(200);

  await passwordField.fill(password);
  await page.waitForTimeout(200);

  console.log('[Login] Clicking login button...');

  const loginButton = page.locator(
    'button:has-text("Login"), input[type="submit"], button[type="submit"]'
  ).first();

  await loginButton.click();

  console.log('[Login] Waiting for login to complete...');

  await page.waitForFunction(
    () => !window.location.href.includes('/Login') &&
          !window.location.href.includes('/Account/Login') &&
          !window.location.href.includes('/Account/SignIn'),
    { timeout: 15_000 }
  );

  console.log('[Login] Login successful!');
}

module.exports = { getBrowser, closeBrowser, newPage, ensureLoggedIn };
