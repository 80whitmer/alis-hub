/**
 * residentMoveOutPage.js
 * Playwright automation for the per-resident "Move Out" flow in ALIS
 * (`https://{host}.alisonline.com/Residents/{communityId}?tab=Current` → resident
 * profile → Move Out pane). Built for the Oct 2026 Gardens at Springfield
 * mass internal transfer, where the importer can't action move-outs.
 *
 * Confirmed live (Oct 2026, bslc / community 214):
 *  - The Current Residents list is a Syncfusion grid: one `tr.e-row` per
 *    resident, with `.resident-peek-name` ("Last, First") and an
 *    `a[href^="/Residents/Profiles/{id}"]` — all 88 rows render on one page.
 *  - Profile's Move Out button is `a[href^="/Residents/Profiles/InitiateMoveOut/{id}"]`
 *    (AJAX-loads the form into `#paneWrap`, form id `#MoveOutResidentPane`).
 *  - Fields: #MoveOutDate, #MoveOutTime (flatpickr text inputs, "MM/DD/YYYY" and
 *    "hh:mm AM"), #ReasonId, #DestinationId (selects), #financialMoveOutDate_moveOutPane.
 *  - CHANGING #ReasonId FIRES AN AJAX RE-RENDER of the whole pane (it POSTs back to
 *    InitiateMoveOut to refresh destination rules), so the reason is set first and
 *    the pane is re-awaited before anything else is filled.
 *  - Moving the physical date also rewrites the financial date when the two were equal
 *    (knockout subscription), so the financial date is set AFTER the physical one.
 *  - Three "Confirm Impact" checkboxes (#ConfirmMedicationsImpact, #ConfirmCareImpact,
 *    #ConfirmRoomAssignmentImpact) all start unchecked and all must be ticked.
 *  - Submit is `#MoveOutResidentPane button[type="submit"]` ("Confirm Resident Move Out").
 */

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** "Last, First" / "First Last" -> normalized "last, first" key. Middle names/nicknames are ignored. */
function nameKey(name) {
  const n = String(name || '').replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
  if (n.includes(',')) {
    const [last, rest] = n.split(',');
    return norm(`${last}, ${(rest || '').trim().split(' ')[0]}`);
  }
  const parts = n.split(' ');
  return norm(`${parts[parts.length - 1]}, ${parts[0]}`);
}

/** Scrapes the Current Residents tab: [{ name, key, profileId, room }]. */
async function listCurrentResidents(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForSelector('tr.e-row', { timeout: 20000 });
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tr.e-row')).map((tr) => {
      const link = tr.querySelector('a[href^="/Residents/Profiles/"]');
      return {
        name: tr.querySelector('.resident-peek-name')?.textContent.trim() || '',
        room: tr.querySelector('.resident-peek-room')?.textContent.trim() || '',
        profileId: link ? link.getAttribute('href').split('/').pop().split('?')[0] : null,
      };
    })
  );
  return rows.filter((r) => r.name && r.profileId).map((r) => ({ ...r, key: nameKey(r.name) }));
}

async function setField(page, selector, value) {
  const el = page.locator(selector);
  await el.fill(String(value));
  // flatpickr/knockout bind on change/blur, not on input.
  await el.dispatchEvent('change');
  await el.press('Tab').catch(() => {});
}

/** "4:54 PM" / "04:54 pm" / "16:54" -> "04:54 PM" (the format the pane's own default uses). */
function formatTime(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!m) throw new Error(`Unrecognized time "${t}" — use e.g. "4:54 PM"`);
  let h = Number(m[1]);
  const mins = m[2];
  let ap = m[3]?.toUpperCase();
  if (!ap) { ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; }
  return `${String(h).padStart(2, '0')}:${mins} ${ap}`;
}

/**
 * Opens a resident's profile, fills and (unless dryRun) submits the Move Out pane.
 *
 * @param details { physicalDate, physicalTime, reason, destination, financialDate } — MM/DD/YYYY dates
 * @returns {{ status: 'moved-out'|'dry-run'|'no-move-out-button', summary: string }}
 */
async function moveOutResident(page, host, resident, details, { dryRun = false } = {}) {
  await page.goto(`https://${host}.alisonline.com/Residents/Profiles/${resident.profileId}`, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });

  const trigger = page.locator(`a[href^="/Residents/Profiles/InitiateMoveOut/${resident.profileId}"]`).first();
  if ((await trigger.count()) === 0) return { status: 'no-move-out-button', summary: 'No Move Out button on profile (already moved out?)' };
  await trigger.click();
  await page.waitForSelector('#MoveOutResidentPane #ReasonId', { timeout: 15000 });

  // Guard against clicking into the wrong person.
  const paneName = await page.locator('#MoveOutResidentPane strong').first().textContent();
  if (nameKey(paneName) !== resident.key) {
    throw new Error(`Move Out pane is for "${paneName.trim()}", expected "${resident.name}" — aborted`);
  }

  // Reason first — it re-renders the pane via AJAX.
  const reasonValue = await page.locator('#ReasonId option', { hasText: details.reason }).first().getAttribute('value').catch(() => null);
  if (!reasonValue) throw new Error(`Move Out Reason "${details.reason}" is not one of the options`);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/InitiateMoveOut/') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null),
    page.selectOption('#ReasonId', reasonValue),
  ]);
  await page.waitForSelector('#MoveOutResidentPane #DestinationId', { timeout: 15000 });
  await page.waitForTimeout(500);

  const destValue = await page.locator('#DestinationId option', { hasText: details.destination }).first().getAttribute('value').catch(() => null);
  if (!destValue) throw new Error(`Move Out Destination "${details.destination}" is not one of the options`);
  await page.selectOption('#DestinationId', destValue);

  await setField(page, '#MoveOutDate', details.physicalDate);
  await setField(page, '#MoveOutTime', formatTime(details.physicalTime));
  await setField(page, '#financialMoveOutDate_moveOutPane', details.financialDate);

  for (const id of ['ConfirmMedicationsImpact', 'ConfirmCareImpact', 'ConfirmRoomAssignmentImpact']) {
    const box = page.locator(`#${id}`);
    // The real <input> is visually hidden by the theme — click its wrapping label.
    if (!(await box.isChecked())) await box.locator('xpath=ancestor::label[1]').click();
  }

  // Read back what the form actually holds before committing.
  const filled = await page.evaluate(() => ({
    date: document.querySelector('#MoveOutDate').value,
    time: document.querySelector('#MoveOutTime').value,
    reason: document.querySelector('#ReasonId').selectedOptions[0]?.textContent.trim(),
    destination: document.querySelector('#DestinationId').selectedOptions[0]?.textContent.trim(),
    financial: document.querySelector('#financialMoveOutDate_moveOutPane').value,
    checks: ['ConfirmMedicationsImpact', 'ConfirmCareImpact', 'ConfirmRoomAssignmentImpact'].every((i) => document.getElementById(i).checked),
  }));
  const wantTime = formatTime(details.physicalTime);
  const mismatches = [];
  if (filled.date !== details.physicalDate) mismatches.push(`date ${filled.date}`);
  // ALIS normalizes the box to e.g. "4:54 PM" after blur, so ignore zero-padding.
  if (filled.time.replace(/^0/, '').toLowerCase() !== wantTime.replace(/^0/, '').toLowerCase()) mismatches.push(`time ${filled.time}`);
  if (filled.financial !== details.financialDate) mismatches.push(`financial ${filled.financial}`);
  if (!filled.checks) mismatches.push('impact boxes unchecked');
  if (mismatches.length) throw new Error(`Form did not take the values (${mismatches.join('; ')}) — nothing submitted`);

  const summary = `${filled.date} ${filled.time} · ${filled.reason} · ${filled.destination} · fin ${filled.financial}`;
  if (dryRun) return { status: 'dry-run', summary };

  await page.locator('#MoveOutResidentPane button[type="submit"]').click();
  // Success replaces the pane / reloads the profile as "Moved Out"; failure leaves validation messages in the pane.
  await page.waitForTimeout(2500);
  const stillOpen = await page.locator('#MoveOutResidentPane button[type="submit"]').count();
  if (stillOpen > 0) {
    const errs = await page.locator('#MoveOutResidentPane .field-validation-error, #MoveOutResidentPane .validation-summary-errors, #MoveOutResidentPane .mt-alert_error')
      .allTextContents();
    throw new Error(`Move Out pane stayed open after submit${errs.length ? `: ${errs.map((e) => e.trim()).filter(Boolean).join('; ')}` : ''}`);
  }
  return { status: 'moved-out', summary };
}

module.exports = { listCurrentResidents, moveOutResident, nameKey };
