/**
 * alertPrefsPage.js
 * Playwright automation for a staff member's Alerts preferences
 * (`https://{host}.alisonline.com/Staff/Profiles/{staffId}?tab=Alerts`).
 *
 * Confirmed live (Nov 2026, medtelligent.alisonline.com sandbox):
 *  - Staff list `/Staff`: native filters `#AssociationType` (Main/Associated/Both),
 *    `#SearchTerm` (needs input + keyup to fire), rows in `table tbody tr`
 *    ("Last, First" first cell, link `/Staff/Profiles/{id}`). Status defaults to Hired.
 *  - Profile `?tab=Alerts`: the "Settings" section holds an "Alert & Notification
 *    Preferences" accordion. Inside: community picker `#facilityId` (bootstrap-
 *    multiselect — a real click on the option label is required; setting the
 *    <select> value from script does NOT reload the panel), then a
 *    "Manage Alerts Preferences" link whose href ends `/Manage/{facilityId}` —
 *    that suffix is the proof the panel really switched communities.
 *  - Manage dialog: one `tr` per category, 4 checkboxes in column order
 *    Daily Digest | Real-time Email | Real-time Text | ALIS Alert Center
 *    (Alert Center auto-ticks and disables itself). The Email / Cell Phone inputs
 *    (`input.mt-input`, unnamed) only appear once a delivery box is ticked, and
 *    arrive pre-filled from the profile. Submit `button.mt-btn_action`,
 *    Cancel `button[data-dismiss=modal]`.
 *  - After a save, the summary list under the picker shows one row per active
 *    category with chips ("Real-Time Email", "Real-Time Text", "Daily Digest").
 *
 * Alert saves are add-only here: we only ever tick Real-time Email / Text on the
 * target row. Nothing is ever unticked on a row we did not intend to change.
 */

const COL = { digest: 0, email: 1, text: 2, center: 3 };

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Tokens of a person name, order-insensitive ("Mo, Vidar" and "Vidar Mo" match). */
function nameTokens(s) {
  return normName(s).split(/[\s,]+/).filter(Boolean);
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Find a hired staff member by name. Returns { id, listedName }.
 * Throws on not found or ambiguous so the caller can report it and move on.
 * Lists staff in the user's current community with "All connected" so company
 * admins (associated everywhere) show up regardless of main community.
 */
async function resolveStaff(page, host, name, { fallbackFacilityId } = {}) {
  const want = nameTokens(name);
  if (want.length < 2) throw new Error(`Staff name "${name}" needs a first and last name.`);
  const searchWord = want[want.length - 1];

  const attempt = async (facilityId) => {
    await page.goto(`https://${host}.alisonline.com/Staff`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await settle(page);
    if (facilityId) {
      await page.evaluate((fid) => {
        const s = document.querySelector('#Facility_ID');
        s.value = String(fid);
        s.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(s).trigger('change');
      }, facilityId);
      await settle(page, 2000);
    }
    await page.evaluate(() => {
      const s = document.querySelector('#AssociationType');
      s.value = 'Both';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(s).trigger('change');
    });
    await page.waitForTimeout(2500);
    await page.evaluate((term) => {
      const t = document.querySelector('#SearchTerm');
      t.value = term;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: term.slice(-1) }));
    }, searchWord);
    await page.waitForTimeout(3000);
    const rows = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((r) => ({
      text: (r.querySelector('td:nth-child(2)') || r).innerText.replace(/\s+/g, ' ').trim(),
      href: (r.querySelector('a[href*="/Staff/Profiles/"]') || {}).getAttribute?.('href') || null,
    })).filter((r) => r.href));
    return rows
      .map((r) => ({ ...r, listedName: r.text.split(/\s{1,}(?=[A-Z][^,]*$)/)[0], id: (r.href.match(/\/Staff\/Profiles\/(\d+)/) || [])[1] }))
      .filter((r) => {
        const have = nameTokens(r.text);
        return want.every((w) => have.some((h) => h === w || h.startsWith(w)));
      });
  };

  let hits = await attempt(null);
  if (!hits.length && fallbackFacilityId) hits = await attempt(fallbackFacilityId);
  const uniq = [...new Map(hits.map((h) => [h.id, h])).values()];
  if (!uniq.length) throw new Error(`No hired staff named "${name}" found (searched "${searchWord}" in All connected).`);
  if (uniq.length > 1) throw new Error(`"${name}" is ambiguous — ${uniq.length} staff match (${uniq.map((u) => `${u.text} #${u.id}`).join('; ')}).`);
  return { id: uniq[0].id, listedName: uniq[0].text };
}

/** Open the profile's Alerts tab and make sure the alerts accordion is expanded. */
async function openAlertsTab(page, host, staffId) {
  await page.goto(`https://${host}.alisonline.com/Staff/Profiles/${staffId}?tab=Alerts`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await settle(page);
  const manageLink = page.locator('a:has-text("Manage Alerts Preferences")').filter({ visible: true });
  if (!(await manageLink.count())) {
    // Section may be collapsed: open Settings, then the accordion.
    const accordion = page.locator('a:has-text("Alert & Notification Preferences")');
    if (!(await accordion.filter({ visible: true }).count())) {
      await page.locator('h2:has-text("Settings"), h3:has-text("Settings")').first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    if (!(await manageLink.count())) {
      await accordion.first().click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  try {
    await manageLink.first().waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`The Alerts tab did not load for staff #${staffId} (no "Manage Alerts Preferences" link) — preferences may not be set up, or the person is not hired. Page says: ${body}`);
  }
}

/** Switch the picker to a community (real click) and prove it took. Throws if it can't. */
async function selectCommunity(page, facilityId) {
  const fid = String(facilityId);
  const manage = page.locator('a:has-text("Manage Alerts Preferences")').filter({ visible: true }).first();
  const already = ((await manage.getAttribute('href')) || '').endsWith(`/Manage/${fid}`);
  if (!already) {
    const optionText = await page.evaluate((id) => {
      const o = document.querySelector(`#facilityId option[value="${id}"]`);
      return o ? o.text.trim() : null;
    }, fid);
    if (!optionText) throw new Error(`Community ${fid} is not in this person's community picker (not associated?).`);
    await page.locator('#facilityId').locator('xpath=..').locator('button.multiselect').first().click();
    await page.locator('.multiselect-container label').filter({ hasText: optionText }).filter({ visible: true }).first().click();
    try {
      await page.waitForFunction(
        (id) => [...document.querySelectorAll('a')].some((a) => /Manage Alerts Preferences/.test(a.innerText) && (a.getAttribute('href') || '').endsWith(`/Manage/${id}`)),
        fid,
        { timeout: 25000 },
      );
    } catch {
      throw new Error(`Picker did not switch to community ${fid} (Manage link never pointed at /Manage/${fid}).`);
    }
    await page.waitForTimeout(1500);
  }
}

/** Banner text under the picker: where email / SMS alerts currently go (global per person). */
async function readContactBanners(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const email = (t.match(/Email alerts enabled and are sent to:\s*([^\s\n]+)/) || [])[1] || null;
    const sms = (t.match(/SMS alerts enabled and are sent to:\s*([^\s\n]+)/) || [])[1] || null;
    return { email, sms };
  });
}

/** Chips on the summary row for the target category, or null if the category row isn't listed. */
async function readSummaryRow(page, labelRegexSource) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const holders = [...document.querySelectorAll('div,li,tr')].filter((e) => {
      const first = (e.innerText || '').trim().split('\n')[0].trim();
      return re.test(first) && e.innerText.length < 200;
    });
    if (!holders.length) return null;
    const txt = holders[holders.length - 1].innerText;
    return { email: /Real-Time Email/i.test(txt), text: /Real-Time Text/i.test(txt), digest: /Daily Digest/i.test(txt), raw: txt.replace(/\s+/g, ' ').trim() };
  }, labelRegexSource);
}

async function openManageDialog(page) {
  await page.locator('a:has-text("Manage Alerts Preferences")').filter({ visible: true }).first().click();
  await page.locator('tr').filter({ hasText: 'Default' }).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
}

async function closeDialog(page) {
  await page.locator('button[data-dismiss="modal"]:has-text("Cancel")').filter({ visible: true }).first().click().catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Find the target category row in the open dialog.
 * `label` is the expected exact label ("Sentinel Event"); the row is matched on
 * /^sentinel events?$/-style tolerance so the sandbox's plural still works —
 * the label actually found is returned so the caller can flag a mismatch.
 */
async function findCategoryRow(page, label) {
  const info = await page.evaluate((lbl) => {
    const base = lbl.toLowerCase().replace(/s$/, '');
    const rows = [...document.querySelectorAll('tr')].filter((r) => r.offsetParent);
    const hits = rows
      .map((r) => ({ r, cells: [...r.querySelectorAll('td')].map((c) => c.innerText.trim()).filter(Boolean) }))
      .filter((x) => x.cells.some((c) => c.toLowerCase().replace(/s$/, '') === base));
    if (!hits.length) return { count: 0 };
    const idx = rows.indexOf(hits[0].r);
    const found = hits[0].cells.find((c) => c.toLowerCase().replace(/s$/, '') === base);
    return { count: hits.length, idx, found };
  }, label);
  if (!info.count) return null;
  if (info.count > 1) throw new Error(`"${label}" matches ${info.count} rows in this community — duplicated category names; refusing to guess.`);
  return info;
}

async function readRowBoxes(page, label) {
  return page.evaluate((lbl) => {
    const base = lbl.toLowerCase().replace(/s$/, '');
    const row = [...document.querySelectorAll('tr')].find((r) => r.offsetParent && [...r.querySelectorAll('td')].some((c) => c.innerText.trim().toLowerCase().replace(/s$/, '') === base));
    const cb = [...row.querySelectorAll('input[type=checkbox]')];
    return cb.map((c) => ({ checked: c.checked, disabled: c.disabled }));
  }, label);
}

async function tickBox(page, label, colIndex, want) {
  return page.evaluate(({ lbl, col, want }) => {
    const base = lbl.toLowerCase().replace(/s$/, '');
    const row = [...document.querySelectorAll('tr')].find((r) => r.offsetParent && [...r.querySelectorAll('td')].some((c) => c.innerText.trim().toLowerCase().replace(/s$/, '') === base));
    const cb = row.querySelectorAll('input[type=checkbox]')[col];
    if (cb.checked !== want) cb.click();
    return cb.checked;
  }, { lbl: label, col: colIndex, want });
}

async function readContactFields(page) {
  return page.evaluate(() => {
    const ins = [...document.querySelectorAll('input.mt-input')].filter((i) => i.offsetParent);
    return { email: (ins[0] && ins[0].value.trim()) || '', phone: (ins[1] && ins[1].value.trim()) || '', shown: ins.length };
  });
}

/**
 * Subscribe one person to one category in one community. Add-only.
 *
 * wants: { email: bool, text: bool } — routes we'd like.
 * Returns { status, detail, flags[], routes{email,text}, labelFound }
 *   status: 'set' | 'already-set' | 'partial' | 'dry-run' | 'skipped-no-route'
 * Throws for hard failures (category missing, picker/community mismatch, save didn't stick).
 */
async function subscribeInCommunity(page, { facilityId, label, wants, dryRun, screenshotPath, strictLabel }) {
  await selectCommunity(page, facilityId);
  const summaryRe = `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s?$/, 's?')}$`;
  const flags = [];

  await openManageDialog(page);
  try {
    const found = await findCategoryRow(page, label);
    if (!found) throw new Error(`Category "${label}" is not offered in this community (likely disabled there).`);
    if (found.found !== label) {
      if (strictLabel) throw new Error(`Category is labeled "${found.found}" here, expected "${label}" (strict label mode).`);
      flags.push(`label is "${found.found}" (expected "${label}")`);
    }

    const before = await readRowBoxes(page, label);
    const hasEmail = before[COL.email].checked;
    const hasText = before[COL.text].checked;
    const needEmail = wants.email && !hasEmail;
    const needText = wants.text && !hasText;
    if (!needEmail && !needText) {
      await closeDialog(page);
      return { status: 'already-set', detail: `${found.found} already has the wanted routes`, flags, labelFound: found.found, routes: { email: hasEmail, text: hasText } };
    }

    if (needEmail) await tickBox(page, label, COL.email, true);
    if (needText) await tickBox(page, label, COL.text, true);
    await page.waitForTimeout(800);

    // Contact fields appear once a box is ticked and arrive pre-filled from the profile.
    const contact = await readContactFields(page);
    let finalEmail = wants.email, finalText = wants.text;
    if (needEmail && !contact.email) {
      await tickBox(page, label, COL.email, false);
      finalEmail = false;
      flags.push('MISSING EMAIL on profile — email route not set');
    }
    if (needText && !contact.phone) {
      await tickBox(page, label, COL.text, false);
      finalText = false;
      flags.push('MISSING CELL PHONE on profile — text route not set');
    }
    const afterBoxes = await readRowBoxes(page, label);
    const nowEmail = afterBoxes[COL.email].checked, nowText = afterBoxes[COL.text].checked;
    const changed = (nowEmail && !hasEmail) || (nowText && !hasText);

    if (!changed) {
      await closeDialog(page);
      return { status: 'skipped-no-route', detail: flags.join('; ') || 'nothing to change', flags, labelFound: found.found, routes: { email: hasEmail, text: hasText } };
    }

    if (dryRun) {
      if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      await closeDialog(page);
      return {
        status: 'dry-run',
        detail: `would set ${[nowEmail && !hasEmail && 'Email', nowText && !hasText && 'Text'].filter(Boolean).join(' + ')} (email ${contact.email || '—'}, cell ${contact.phone || '—'})`,
        flags, labelFound: found.found, routes: { email: nowEmail, text: nowText },
      };
    }

    // Contact values are left exactly as autofilled; we never type into them.
    await page.locator('button.mt-btn_action').filter({ hasText: 'Submit' }).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    const blocked = await page.locator('text=/Required|is required/i').filter({ visible: true }).count().catch(() => 0);
    await page.waitForTimeout(4500);
    const stillOpen = await page.locator('button.mt-btn_action').filter({ hasText: 'Submit' }).filter({ visible: true }).count();
    if (stillOpen) {
      await closeDialog(page);
      throw new Error(`ALIS did not accept the save (dialog stayed open${blocked ? ', a field is flagged Required' : ''}).`);
    }

    // Verify by reopening the dialog and reading the real checkboxes (the summary
    // list's chips proved unreliable to scrape — the saves were fine, the check wasn't).
    await page.waitForTimeout(2000);
    await openManageDialog(page);
    const saved = await readRowBoxes(page, label);
    await closeDialog(page);
    if ((nowEmail && !saved[COL.email].checked) || (nowText && !saved[COL.text].checked)) {
      throw new Error(`Submitted, but reopening shows Email=${saved[COL.email].checked}, Text=${saved[COL.text].checked} — expected ${[nowEmail && 'Email', nowText && 'Text'].filter(Boolean).join(' + ')}.`);
    }
    const partial = flags.some((f) => f.startsWith('MISSING'));
    return {
      status: partial ? 'partial' : 'set',
      detail: `${[nowEmail && 'Email', nowText && 'Text'].filter(Boolean).join(' + ')} saved and verified${flags.length ? ` — ${flags.join('; ')}` : ''}`,
      flags, labelFound: found.found, routes: { email: saved[COL.email].checked, text: saved[COL.text].checked },
    };
  } catch (err) {
    await closeDialog(page);
    throw err;
  }
}

module.exports = { resolveStaff, openAlertsTab, selectCommunity, subscribeInCommunity, readContactBanners, nameTokens };
