require('dotenv').config();
const { newPage, ensureLoggedIn } = require('./automation/playwright/browser');

// Probes whether our existing admin.alisonline.com login session (via
// ensureLoggedIn) can also reach community-subdomain report/settings pages
// (imagineseniorliving.alisonline.com/...) and the various "Audit History"
// tables Aaron flagged, or whether those need a separate login/session.
const URLS = [
  'https://imagineseniorliving.alisonline.com/Care/Tracking/952',
  'https://imagineseniorliving.alisonline.com/Reports/ResidentDailyStandUp/952',
  'https://imagineseniorliving.alisonline.com/Communities/Profiles/1188',
  'https://imagineseniorliving.alisonline.com/Residents/Profiles/394656',
  'https://imagineseniorliving.alisonline.com/Communities?tab=Company',
];

(async () => {
  const page = await newPage();
  try {
    for (const url of URLS) {
      console.log(`--- ${url} ---`);
      try {
        console.log('Logging in directly at target URL (community subdomain)...');
        await ensureLoggedIn(page, url);
        const finalUrl = page.url();
        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
        const loggedOut = /\/Login|\/Account\/Login|\/Account\/SignIn/.test(finalUrl);
        console.log(`Final URL: ${finalUrl}`);
        console.log(`Redirected to login? ${loggedOut}`);
        console.log(`Title: ${title}`);
        console.log(`Body preview: ${bodyText.replace(/\n+/g, ' | ')}`);
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
      console.log('');
    }
  } finally {
    await page.context().close().catch(() => {});
    process.exit(0);
  }
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
