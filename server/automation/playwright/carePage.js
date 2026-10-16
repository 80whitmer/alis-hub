/**
 * carePage.js
 * Playwright automation for bulk-editing Care Items on ALIS's Care Settings
 * page (`https://{host}.alisonline.com/Settings/Care/{communityId}?tab=Care`).
 *
 * Confirmed live (Sep 2026, sandbox community 847 "Aaron's Assisted Living",
 * medtelligent.alisonline.com):
 *  - Care Items live in `<tr data-bindrow="true">` rows, each with a
 *    `<input data-binding-name="careItems" value="{itemId}">` checkbox — NOT
 *    the `data-sort-item-identifier` pattern Resident Settings' compliance
 *    items use (an earlier version of this file wrongly assumed they were
 *    the same underlying component; they are not).
 *  - Categories (Activities, ADLs, Diet, ...) load COLLAPSED
 *    (`<tbody id="care_category_{name}_{id}" style="display:none">`) —
 *    a category's rows aren't even visible/clickable until its header's
 *    `span.js-bocatoggle[data-toggle-selector="#{tbodyId}"]` is clicked.
 *  - Edit is a plain AJAX link (`data-ajax-update="#paneWrap"`) — no
 *    dropdown-trigger step needed first (unlike compliance items' Edit,
 *    which is hidden inside an Options dropdown).
 *  - The edit pane loads into `#paneWrap`, same as compliance items, but
 *    #paneWrap itself can already exist (empty) before Edit is clicked, so
 *    waiting for its mere presence is not enough — wait for a real field
 *    inside it instead.
 *  - Assistance Level is `<select id="AssistanceLevelId">` inside the pane,
 *    confirmed options: Choose One / Cues/Reminders / Independent /
 *    Standby/Physical Assist / Third Party / Total 1x Staff / Total 2x Staff.
 *  - Submit is `<button type="submit">Update Item</button>` inside the pane;
 *    confirmed the change actually persists (set → reload → re-open pane →
 *    same value).
 *  - Reporting Label is `<select id="ReportingLabelId">` in the same pane
 *    (confirmed live Oct 2026, same sandbox community). Option labels include
 *    Choose One / ABST / Activities / ADL / Behaviors / Escort / ... / Shower /
 *    Spot Checks / Toileting / Transfer / Two Person Assist. Same Update Item
 *    submit as Assistance Level.
 *  - Close affordance is `a.mt-pane-close` (same class compliance items use).
 */

async function navigateToCareSettings(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
}

/**
 * Finds a Care Item's numeric id by its exact display name (the Name
 * column's own text, with its category-badge <span> — e.g. "ADL", "ABST" —
 * stripped out, since that badge is appended inside the same cell).
 */
async function findCareItemId(page, itemName) {
  return page.evaluate((itemName) => {
    const rows = Array.from(document.querySelectorAll('tr[data-bindrow="true"]'));
    for (const row of rows) {
      const checkbox = row.querySelector('input[data-binding-name="careItems"]');
      if (!checkbox) continue;
      const nameCell = row.querySelectorAll(':scope > td')[1];
      if (!nameCell) continue;
      const clone = nameCell.cloneNode(true);
      clone.querySelectorAll('span').forEach((s) => s.remove());
      if (clone.textContent.trim() === itemName) return checkbox.value;
    }
    return null;
  }, itemName);
}

/** Expands the item's category section if it's currently collapsed — a no-op if already open. */
async function ensureCategoryExpanded(page, itemId) {
  const tbodyId = await page.evaluate((itemId) => {
    const cb = document.querySelector(`input[data-binding-name="careItems"][value="${itemId}"]`);
    return cb?.closest('tbody')?.id || null;
  }, itemId);
  if (!tbodyId) return;

  const isHidden = await page.evaluate(
    (id) => getComputedStyle(document.getElementById(id)).display === 'none',
    tbodyId
  );
  if (isHidden) {
    await page.locator(`span.js-bocatoggle[data-toggle-selector="#${tbodyId}"]`).click();
    await page.waitForTimeout(300);
  }
}

/** Opens a Care Item's edit pane. Assumes its category is already expanded (see ensureCategoryExpanded). */
async function openCareItemPane(page, itemId, readySelector = 'select#AssistanceLevelId') {
  const editLink = page
    .locator(`input[data-binding-name="careItems"][value="${itemId}"]`)
    .locator('xpath=ancestor::tr[1]')
    .locator('a', { hasText: 'Edit' })
    .first();
  await editLink.click();
  // #paneWrap can exist empty before this — wait for a real field, not just the container.
  await page.waitForFunction(
    (sel) => document.querySelector(`#paneWrap ${sel}`),
    readySelector,
    { timeout: 10000 }
  );
  await page.waitForTimeout(300);
}

async function closeCareItemPane(page) {
  const closeLink = page.locator('#paneWrap a.mt-pane-close, a.mt-pane-close').first();
  if ((await closeLink.count()) > 0) {
    await closeLink.click().catch(() => {});
  }
  await page.waitForTimeout(200);
}

/**
 * `onlyIfCurrent` may be one value or several separated by "|" (e.g.
 * "ABST|(blank)"). The token "(blank)" matches an unset select — ALIS shows
 * that as "Choose One" (empty value), confirmed live Oct 2026.
 */
function currentMatchesGuard(previousValue, guard) {
  const cur = previousValue.trim().toLowerCase();
  return String(guard)
    .split('|')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean)
    .some((g) => (g === '(blank)' ? cur === '' || cur === 'choose one' : g === cur));
}

/**
 * Finds a Care Item by name, opens its edit pane, and sets one of its <select>
 * fields to targetLabel if it isn't already set to that value.
 *
 * `onlyIfCurrent` (optional) makes the change conditional: when set and the
 * field's current value is something else, nothing is submitted and the
 * result is 'skipped-different-value' — used to scope a bulk edit to e.g.
 * "only items currently labelled ABST" without touching the rest.
 *
 * @returns {{ status: 'updated'|'already-set'|'skipped-different-value'|'not-found'|'no-field', previousValue?: string }}
 */
async function setCareItemSelectField(page, itemName, { selector, targetLabel, fieldName, onlyIfCurrent }) {
  const itemId = await findCareItemId(page, itemName);
  if (!itemId) return { status: 'not-found' };

  await ensureCategoryExpanded(page, itemId);
  await openCareItemPane(page, itemId, selector);

  try {
    const select = page.locator(`#paneWrap ${selector}`);
    if ((await select.count()) === 0) {
      return { status: 'no-field' };
    }

    const previousValue = await select.evaluate((el) => el.selectedOptions[0]?.textContent.trim() || '');
    if (previousValue.toLowerCase() === targetLabel.trim().toLowerCase()) {
      return { status: 'already-set', previousValue };
    }
    if (onlyIfCurrent && !currentMatchesGuard(previousValue, onlyIfCurrent)) {
      return { status: 'skipped-different-value', previousValue };
    }

    try {
      await select.selectOption({ label: targetLabel.trim() });
    } catch {
      const available = await select.evaluate((el) => Array.from(el.options).map((o) => o.textContent.trim()));
      throw new Error(
        `Target ${fieldName} "${targetLabel}" is not one of this item's options: ${available.join(', ')}`
      );
    }

    const submit = page.locator('#paneWrap button[type="submit"]', { hasText: 'Update Item' });
    await submit.click();
    await page.waitForTimeout(1200);

    return { status: 'updated', previousValue };
  } finally {
    await closeCareItemPane(page).catch(() => {});
  }
}

/** Sets a Care Item's Assistance Level. Returns 'no-assistance-level-field' (not 'no-field') for back-compat. */
async function setCareItemAssistanceLevel(page, itemName, targetLabel) {
  const result = await setCareItemSelectField(page, itemName, {
    selector: 'select#AssistanceLevelId',
    targetLabel,
    fieldName: 'Assistance Level',
  });
  return result.status === 'no-field' ? { status: 'no-assistance-level-field' } : result;
}

/** Sets a Care Item's Reporting Label, optionally only when it currently equals `onlyIfCurrent`. */
async function setCareItemReportingLabel(page, itemName, targetLabel, onlyIfCurrent) {
  return setCareItemSelectField(page, itemName, {
    selector: 'select#ReportingLabelId',
    targetLabel,
    fieldName: 'Reporting Label',
    onlyIfCurrent,
  });
}

module.exports = {
  navigateToCareSettings,
  findCareItemId,
  setCareItemAssistanceLevel,
  setCareItemReportingLabel,
};
