require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { newPage, ensureLoggedIn, closeBrowser } = require('./automation/playwright/browser');
const { captureResidentSettings } = require('./automation/playwright/residentSettingsPage');

// Reconnaissance only: capture the real field/label structure of company-level
// "enabled state" pages for Imagine Senior Living (company 353) so the usage-audit
// tool's admin-settings scraper and module-name mapping can be designed against
// real DOM output instead of guesses.
const TARGETS = [
  {
    name: 'entitlements',
    url: 'https://admin.alisonline.com/Customers/EntitlementSets/EditCompany/353',
  },
  {
    name: 'company-settings',
    url: 'https://imagineseniorliving.alisonline.com/Settings/Company',
  },
];

const OUT_DIR = path.join(__dirname, '..', '..', 'scratchpad-audit-recon');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const target of TARGETS) {
    console.log(`\n=== ${target.name}: ${target.url} ===`);
    const page = await newPage();
    try {
      await ensureLoggedIn(page, target.url);
      const snapshot = await captureResidentSettings(page, target.url);

      const outFile = path.join(OUT_DIR, `${target.name}.json`);
      fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));

      console.log(`checkboxes: ${snapshot.fields.checkboxes.length}, selects: ${snapshot.fields.selects.length}, textInputs: ${snapshot.fields.textInputs.length}`);
      console.log(`written to: ${outFile}`);

      // Quick human-readable preview in the console too
      for (const cb of snapshot.fields.checkboxes.slice(0, 60)) {
        console.log(`  [${cb.checked ? 'x' : ' '}] ${cb.section ? cb.section + ' > ' : ''}${cb.label || cb.name || cb.id}`);
      }
    } catch (err) {
      console.log(`ERROR capturing ${target.name}: ${err.message}`);
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  await closeBrowser();
})();
