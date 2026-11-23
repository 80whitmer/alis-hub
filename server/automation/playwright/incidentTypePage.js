/**
 * incidentTypePage.js
 * Playwright automation for creating Incident Types on ALIS's Incident Settings
 * page (`https://{host}.alisonline.com/Settings/Incidents`) via the
 * "Create Incident Type" slide-out panel.
 *
 * Confirmed live (Nov 2026, leisurecare.alisonline.com):
 *  - Panel content lives in `#manageIncidentTypePaneContent`; close affordance
 *    is `a.mt-pane-close`; submit is `button[type=submit]` "Create Incident Type".
 *  - Name `#Name`, Internal Name `#InternalName`.
 *  - Reporting Label is a Syncfusion dropdown: click `span.e-ddl` wrapping
 *    `#ReportingLabelId`, options are `li.e-list-item` (Falls, Behavioral,
 *    Medical, Elopement, Error, Skin, Injury, Other). The `<select>` inside is
 *    hidden — don't selectOption on it.
 *  - Communities Using Type is a bootstrap-multiselect over `<select
 *    id="FacilityIds" multiple>` with state `<optgroup>`s; set through the
 *    plugin API so state headers (which select a whole state) are never hit.
 *  - Associated Forms is a bootstrap-multiselect over `#SelectedForms`. The
 *    panel RE-RENDERS from the server (POST /Settings/Incidents/Create/Pane)
 *    when that dropdown closes, and only then does the per-form
 *    Required/Optional toggle appear (`#{formId}-required` radio, Optional is
 *    the default). So the form is attached FIRST and every other field is
 *    filled after the re-render.
 */

const PANE = '#manageIncidentTypePaneContent';
const CREATE_LABEL = 'Create Incident Type';

async function navigateToIncidentSettings(page, host) {
  await page.goto(`https://${host}.alisonline.com/Settings/Incidents`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

/** True if an incident type with this exact name already shows on the settings page. */
async function incidentTypeExists(page, name) {
  return (await page.getByText(name, { exact: true }).filter({ visible: true }).count()) > 0;
}

async function openCreatePanel(page) {
  await page.getByRole('button', { name: CREATE_LABEL }).or(page.getByRole('link', { name: CREATE_LABEL })).first().click();
  await page.locator('#Name').waitFor({ state: 'visible', timeout: 10000 });
}

async function attachForm(page, formName, required) {
  const control = page.locator('#SelectedForms').locator('xpath=ancestor::div[contains(@class,"mt-multichecks")][1]').locator('button.multiselect');
  await control.click();
  const item = page.locator('.multiselect-container li').filter({ hasText: formName }).filter({ visible: true });
  if (!(await item.count())) throw new Error(`Form "${formName}" not found in Associated Forms`);
  const formId = await item.first().locator('input[type=checkbox]').getAttribute('value');
  await item.first().click();
  // Close the dropdown — this is what triggers the server re-render that adds the Required toggle.
  const reRender = page.waitForResponse((r) => r.url().includes('/Settings/Incidents/Create/Pane'), { timeout: 15000 });
  await page.locator('#Name').click();
  await reRender;
  await page.locator(`label[for="${formId}-required"]`).waitFor({ state: 'visible', timeout: 10000 });
  if (required) await page.locator(`label[for="${formId}-required"]`).click();
  else await page.locator(`label[for="${formId}-optional"]`).click();
  const ok = await page.locator(`[id="${formId}-${required ? 'required' : 'optional'}"]`).isChecked();
  if (!ok) throw new Error(`Form "${formName}" did not toggle to ${required ? 'Required' : 'Optional'}`);
}

async function fillName(page, name) {
  await page.fill('#Name', name);
  if ((await page.inputValue('#Name')) !== name) throw new Error('Name field did not take the value');
}

async function selectReportingLabel(page, label) {
  await page.locator('span.e-ddl:has(#ReportingLabelId)').click();
  const opt = page.locator('li.e-list-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).filter({ visible: true });
  if (!(await opt.count())) throw new Error(`Reporting Label option "${label}" not found`);
  await opt.first().click();
  const shown = await page.inputValue('#ReportingLabelId');
  if (shown.trim() !== label) throw new Error(`Reporting Label shows "${shown}", expected "${label}"`);
}

/** Selects communities by exact option text via the multiselect plugin; verifies the count. */
async function selectCommunities(page, communities) {
  const res = await page.evaluate((names) => {
    const opts = Array.from(document.querySelectorAll('#FacilityIds option'));
    const ids = [], missing = [], ambiguous = [];
    for (const n of names) {
      const m = opts.filter((o) => o.textContent.trim() === n);
      if (m.length === 0) missing.push(n);
      else if (m.length > 1) ambiguous.push(n);
      else ids.push(m[0].value);
    }
    if (!missing.length && !ambiguous.length) {
      $('#FacilityIds').multiselect('deselectAll', false);
      $('#FacilityIds').multiselect('select', ids, true);
    }
    return { missing, ambiguous, selected: ($('#FacilityIds').val() || []).length };
  }, communities);
  if (res.missing.length) throw new Error(`Communities not found in ALIS dropdown: ${res.missing.join(', ')}`);
  if (res.ambiguous.length) throw new Error(`Community names matching more than one option: ${res.ambiguous.join(', ')}`);
  if (res.selected !== communities.length) throw new Error(`Selected ${res.selected} communities, expected ${communities.length}`);
  return res.selected;
}

/** Re-checks every field right before submit/screenshot (the panel re-renders, so don't trust earlier state). */
async function verifyPanel(page, type, communities, formName) {
  const v = await page.evaluate(() => ({
    name: document.querySelector('#Name').value,
    label: document.querySelector('#ReportingLabelId').value,
    communities: ($('#FacilityIds').val() || []).length,
    forms: Array.from(document.querySelectorAll(`${'#manageIncidentTypePaneContent'} input[id$="-required"]`)).map((i) => ({ id: i.id, required: i.checked })),
  }));
  if (v.name !== type.name) throw new Error(`Name changed to "${v.name}"`);
  if (v.label.trim() !== type.reportingLabel) throw new Error(`Reporting Label is "${v.label}"`);
  if (v.communities !== communities.length) throw new Error(`${v.communities} communities selected, expected ${communities.length}`);
  return v;
}

async function closePanel(page) {
  await page.locator('a.mt-pane-close').first().click().catch(() => {});
  await page.locator('#Name').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

/**
 * Creates one incident type. With dryRun the panel is filled and screenshotted
 * but closed without submitting.
 * Returns { status: 'created' | 'dry-run' | 'exists', summary }.
 */
async function createIncidentType(page, host, type, opts) {
  const { communities, formName, formRequired = true, dryRun = false, screenshotPath } = opts;
  await navigateToIncidentSettings(page, host);
  if (await incidentTypeExists(page, type.name)) return { status: 'exists', summary: 'Already exists — skipped' };

  await openCreatePanel(page);
  if (formName) await attachForm(page, formName, formRequired);
  await fillName(page, type.name);
  await selectReportingLabel(page, type.reportingLabel);
  const count = await selectCommunities(page, communities);
  const v = await verifyPanel(page, type, communities, formName);
  if (formName && !v.forms.some((f) => f.required === !!formRequired)) throw new Error('Form Required/Optional state not as expected');

  const summary = `${type.reportingLabel} · ${count} communities · form: ${formName || 'none'} (${formRequired ? 'Required' : 'Optional'})`;
  if (screenshotPath) await page.screenshot({ path: screenshotPath }).catch(() => {});

  if (dryRun) {
    await closePanel(page);
    return { status: 'dry-run', summary };
  }

  await page.locator('button[type=submit]').filter({ hasText: CREATE_LABEL }).filter({ visible: true }).last().click();
  await page.locator('#Name').waitFor({ state: 'hidden', timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  if (!(await incidentTypeExists(page, type.name))) {
    throw new Error('Panel closed but the new type is not visible on the list — verify manually');
  }
  return { status: 'created', summary };
}

module.exports = { navigateToIncidentSettings, incidentTypeExists, createIncidentType };
