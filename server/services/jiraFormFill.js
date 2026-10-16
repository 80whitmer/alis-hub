const path = require('path');
const { chromium } = require('playwright');

/**
 * Fills the ODM "Organic Add Onboarding" Jira form (form 432) in a visible
 * browser window from a reviewed payload, then STOPS. It never clicks
 * Submit — the person looks the form over and submits it themselves.
 *
 * Uses its own persistent browser profile (server/.jira-session/, gitignored)
 * so the Atlassian sign-in is done once by hand in that window and
 * remembered. Credentials are never read or stored by the hub.
 *
 * Quirks learned from the live form:
 *  - Rich text editors (Organic Add Details, Description) only convert
 *    markdown on PASTE (headings/bullets/bold) — typed markdown stays
 *    literal — so the value is delivered as a synthetic paste event.
 *  - Dates are typed as M/D/YYYY.
 *  - What is Needed? and Settings Configuration Needed are multi-selects
 *    (menu stays open between picks); Project Request and Assessment Info
 *    are single-select.
 *  - Fields below Project Request only render after it is chosen.
 */
const FORM_URL = require('../config/organicAddOptions.json').formUrl;
const PROFILE_DIR = path.join(__dirname, '..', '.jira-session');
const LOGIN_WAIT_MS = 5 * 60 * 1000;

let state = { status: 'idle', results: [], error: null, startedAt: null };
let context = null;

function getFillStatus() {
  return state;
}

async function getContext() {
  if (context) {
    // The user may have closed the window since last time.
    try { await context.pages(); return context; } catch { context = null; }
  }
  const opts = { headless: false, viewport: { width: 1280, height: 900 }, slowMo: 60, ignoreDefaultArgs: ['--enable-automation'] };
  try {
    // Real Chrome is less likely than bundled Chromium to be refused by SSO providers.
    context = await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' });
  } catch {
    context = await chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
  context.on('close', () => { context = null; });
  return context;
}

function isoToUs(iso) {
  const [y, m, d] = iso.split('-');
  return { typed: `${m}/${d}/${y}`, shown: `${Number(m)}/${Number(d)}/${y}` };
}

function fieldValues(review) {
  const byLabel = Object.fromEntries(review.formFields.map((f) => [f.label, f]));
  const dd = (key) => review.dropdowns[key].value;
  return {
    text: [
      ['Summary', byLabel['Summary'].value],
      ['ALIS Company URL', byLabel['ALIS Company URL'].value],
      ['Acquisition or new building?', byLabel['Acquisition or new building?'].value],
      ['Current eHR', byLabel['Current eHR'].value],
      ['Pharmacy Contact Info', byLabel['Pharmacy Contact Info'].value],
      ['Client/Community Contact', byLabel['Client/Community Contact'].value],
      ['Which community should we copy settings FROM?', byLabel['Which community should we copy settings FROM?'].value],
    ],
    whatIsNeeded: dd('what_is_needed'),
    assessment: dd('assessment_info'),
    settings: dd('settings_configuration_needed'),
    goLive: byLabel['Desired Go-Live Date'].value,
    completion: byLabel['Requested Completion Date'].value,
    details: byLabel['Organic Add Details'].value,
    description: byLabel['Description'].value,
  };
}

const comboAfterLabel = (page, label) =>
  page.locator(`label:has-text("${label}")`).first().locator('xpath=following::input[@role="combobox"][1]');

async function pickOptions(page, label, values) {
  const combo = comboAfterLabel(page, label);
  await combo.click();
  for (const v of values) {
    await page.getByRole('option', { name: v, exact: true }).click();
  }
  await page.keyboard.press('Escape');
}

async function typeDate(page, ariaLabel, iso) {
  const box = page.getByRole('combobox', { name: ariaLabel, exact: true });
  await box.click();
  await page.keyboard.type(isoToUs(iso).typed);
  await page.keyboard.press('Enter');
}

async function pasteMarkdown(page, areaLabel, text) {
  const editor = page.locator(`[aria-label="${areaLabel} area, start typing to enter text."]`);
  await editor.click();
  await editor.evaluate((node, md) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', md);
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

async function runFill(review) {
  const ctx = await getContext();
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });

  // Not signed in -> Atlassian login page. Wait for the person to sign in by
  // hand in this window; the form's Summary box appearing means they're in.
  const summary = page.getByRole('textbox', { name: 'Summary', exact: true });
  if (!(await summary.isVisible({ timeout: 15000 }).catch(() => false))) {
    state.status = 'waiting_for_login';
    await summary.waitFor({ state: 'visible', timeout: LOGIN_WAIT_MS });
    if (!page.url().startsWith(FORM_URL)) await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' });
    await summary.waitFor({ state: 'visible', timeout: 30000 });
  }

  state.status = 'filling';
  const v = fieldValues(review);
  const results = [];
  const step = async (label, fn) => {
    try { await fn(); results.push({ label, filled: true }); }
    catch (err) { results.push({ label, filled: false, detail: err.message.split('\n')[0] }); }
    state.results = [...results]; // visible while the fill is still running
  };

  const text = Object.fromEntries(v.text);
  await step('Summary', () => page.getByRole('textbox', { name: 'Summary', exact: true }).fill(text['Summary']));
  await step('ALIS Company URL', () => page.getByRole('textbox', { name: 'ALIS Company URL', exact: true }).fill(text['ALIS Company URL']));
  await step('Project Request', async () => {
    await pickOptions(page, 'Project Request', ['Organic Add Onboarding']);
    await page.locator('label:has-text("What is Needed?")').first().waitFor({ state: 'visible', timeout: 15000 });
  });
  await step('What is Needed?', () => pickOptions(page, 'What is Needed?', v.whatIsNeeded));
  for (const label of ['Acquisition or new building?', 'Current eHR', 'Pharmacy Contact Info', 'Client/Community Contact', 'Which community should we copy settings FROM?']) {
    if (!text[label]) { results.push({ label, filled: false, detail: 'empty in payload — left blank' }); continue; }
    await step(label, () => page.getByRole('textbox', { name: label, exact: true }).fill(text[label]));
  }
  await step('Desired Go-Live Date', () => typeDate(page, 'Desired Go-Live Date', v.goLive));
  await step('Assessment Info', () => pickOptions(page, 'Assessment Info', v.assessment));
  await step('Organic Add Details', () => pasteMarkdown(page, 'Organic Add Details', v.details));
  await step('Settings Configuration Needed', () => pickOptions(page, 'Settings Configuration Needed', v.settings));
  await step('Requested Completion Date', () => typeDate(page, 'Requested Completion Date', v.completion));
  await step('Description', () => pasteMarkdown(page, 'Description', v.description));

  // Read back from the page rather than trusting that each step "worked".
  const formText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  const expectShown = {
    'What is Needed?': v.whatIsNeeded, 'Assessment Info': v.assessment, 'Settings Configuration Needed': v.settings,
    'Desired Go-Live Date': [isoToUs(v.goLive).shown], 'Requested Completion Date': [isoToUs(v.completion).shown],
  };
  for (const r of results) {
    if (!r.filled) continue;
    const want = expectShown[r.label];
    if (want && formText && !want.every((w) => formText.includes(w))) { r.filled = false; r.detail = 'value not visible on the form after filling'; }
    const t = text[r.label];
    if (t) {
      const got = await page.getByRole('textbox', { name: r.label, exact: true }).inputValue().catch(() => null);
      if (got !== t) { r.filled = false; r.detail = 'field value does not match after filling'; }
    }
  }
  return results;
}

/**
 * Kicks off a fill in the background; poll getFillStatus(). `review` is the
 * validated review object from organicAdd.validateOrganicAddPayload.
 */
function startFill(review) {
  if (state.status === 'waiting_for_login' || state.status === 'filling' || state.status === 'starting') {
    return { started: false, reason: 'A fill is already in progress' };
  }
  state = { status: 'starting', results: [], error: null, startedAt: new Date().toISOString() };
  runFill(review)
    .then((results) => { state = { ...state, status: 'done', results }; })
    .catch((err) => { state = { ...state, status: 'error', error: err.message.split('\n')[0] }; });
  return { started: true };
}

module.exports = { startFill, getFillStatus };
