/**
 * communityPage.js
 * Page-object layer for ALIS community creation + CRM ID population.
 * Logic ported directly from create_alis_communities_10.js.
 */

// Field name → 0-based index inside the New Community modal
const FIELD_INDEX = {
  'Name':               0,
  'Licensed Capacity':  1,
  'Physical Capacity':  2,
  'Street':             3,
  'City':               4,
  'Zip':                5,
};

function getModal(page) {
  return page.locator('#modalContainer').first();
}

async function fillField(modal, labelText, value) {
  const idx = FIELD_INDEX[labelText];
  if (idx === undefined) throw new Error(`Unknown field: "${labelText}"`);

  const input = modal.locator('input[type="text"], input:not([type])').nth(idx);
  await input.waitFor({ state: 'visible', timeout: 8_000 });
  await input.click({ clickCount: 3 });
  await input.press('Control+a');
  await input.fill('');
  await input.fill(value);

  const actual = await input.inputValue();
  if (actual !== value) {
    throw new Error(`"${labelText}" filled with "${actual}" instead of "${value}"`);
  }
}

async function selectState(modal, stateValue) {
  const target = modal.locator('select').first();
  await target.waitFor({ state: 'visible', timeout: 5_000 });
  try {
    await target.selectOption({ value: stateValue });
  } catch {
    await target.selectOption({ label: stateValue });
  }
}

async function selectFlags(modal, page, flags) {
  if (!flags || flags.length === 0) return;

  const allSelects = modal.locator('select');
  const flagSelect = allSelects.nth(1);
  const isNative   = await flagSelect.isVisible().catch(() => false);

  if (isNative) {
    for (const flag of flags) {
      await flagSelect.selectOption({ label: flag }).catch(async () => {
        await flagSelect.selectOption({ value: flag }).catch(() => {});
      });
    }
    return;
  }

  // Select2 fallback
  const select2Container = modal
    .locator('.select2-container, .select2-choice, .select2-choices').last();

  for (const flag of flags) {
    try {
      await select2Container.click();
      const searchInput = page
        .locator('.select2-search input, .select2-drop input, .select2-input').first();
      await searchInput.waitFor({ state: 'visible', timeout: 3_000 });
      await searchInput.fill(flag);
      const option = page
        .locator(`.select2-results li:has-text("${flag}"), .select2-result:has-text("${flag}")`).first();
      if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await option.click();
      } else {
        await searchInput.press('Enter');
      }
    } catch { /* non-fatal */ }
  }
}

async function clickSave(modal, page) {
  const candidates = [
    modal.locator('.modal-footer button:has-text("Save")').first(),
    modal.locator('button:has-text("Save")').last(),
    modal.locator('button[type="button"]:has-text("Save")').first(),
    modal.locator('input[value="Save"]').first(),
    page.locator('.modal:visible button:has-text("Save")').last(),
    page.locator('[role="dialog"]:visible button:has-text("Save")').last(),
  ];

  for (const btn of candidates) {
    if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      return;
    }
  }
  throw new Error('Could not locate Save button in modal');
}

/**
 * Create a single community via the modal.
 * Assumes the page is already on the company URL and logged in.
 */
async function createCommunity(page, companyUrl, community) {
  await page.goto(companyUrl, { waitUntil: 'networkidle' });

  const addNewBtn = page.locator('a:has-text("Add New"), button:has-text("Add New")').last();
  await addNewBtn.scrollIntoViewIfNeeded();
  await addNewBtn.click();

  await page.waitForSelector('#modalContainer input[type="text"]:visible', {
    state: 'visible', timeout: 10_000,
  });
  await page.waitForTimeout(300);

  const modal = getModal(page);

  await fillField(modal, 'Name',               community.name);
  await fillField(modal, 'Licensed Capacity',  community.licensed_capacity);
  await fillField(modal, 'Physical Capacity',  community.physical_capacity);
  await fillField(modal, 'Street',             community.street);
  await fillField(modal, 'City',               community.city);
  await selectState(modal, community.state);
  await fillField(modal, 'Zip',                community.zip);
  await selectFlags(modal, page, community.flags || []);

  await clickSave(modal, page);

  await page.waitForSelector('#modalContainer input[type="text"]', {
    state: 'hidden', timeout: 15_000,
  });
  await page.waitForTimeout(600);
}

/**
 * Set the CRM ID on a community's detail page.
 */
async function setCrmId(page, companyUrl, communityName, crmId) {
  if (!crmId) return;

  await page.goto(companyUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const link = page.locator(`a:has-text("${communityName}")`).first();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  await link.scrollIntoViewIfNeeded();
  await link.click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  const input = page.locator('input#CrmId, input[name="CrmId"], input[placeholder*="CRM" i]').first();
  await input.waitFor({ state: 'visible', timeout: 8_000 });
  await input.scrollIntoViewIfNeeded();
  await input.click({ clickCount: 3 });
  await input.press('Control+a');
  await input.fill('');
  await input.fill(crmId);

  const actual = await input.inputValue();
  if (actual !== crmId) throw new Error(`CRM ID mismatch: got "${actual}"`);

  const submit = page
    .locator('button:has-text("Submit"), input[type="submit"], button[type="submit"]').first();
  await submit.scrollIntoViewIfNeeded();
  await submit.click();

  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  await page.waitForTimeout(600);
}

module.exports = { createCommunity, setCrmId };
