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
 */
async function ensureLoggedIn(page) {
  const username = process.env.ALIS_USERNAME;
  const password = process.env.ALIS_PASSWORD;

  if (!username || !password) {
    throw new Error('ALIS_USERNAME / ALIS_PASSWORD not set in .env');
  }

  await page.goto('https://admin.alisonline.com/', { waitUntil: 'networkidle' });

  const url = page.url();
  if (!url.includes('/Account/Login') && !url.includes('/Account/SignIn')) {
    return; // already logged in
  }

  await page.locator(
    'input[name="Username"], input[name="UserName"], #Username, #UserName, input[name="Email"], #Email'
  ).first().fill(username);

  await page.locator(
    'input[name="Password"], input[type="password"], #Password'
  ).first().fill(password);

  await page.locator(
    'button:has-text("Login"), input[type="submit"], button[type="submit"]'
  ).first().click();

  await page.waitForFunction(
    () => !window.location.href.includes('/Account/Login') &&
          !window.location.href.includes('/Account/SignIn'),
    { timeout: 15_000 }
  );
}

module.exports = { getBrowser, closeBrowser, newPage, ensureLoggedIn };
