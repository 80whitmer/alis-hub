/**
 * residentSettingsPage.js
 * Playwright automation for syncing ALIS Resident Settings between communities.
 *
 * Two public functions:
 *   captureResidentSettings(page, url)  → snapshot object
 *   applyResidentSettings(page, url, snapshot, emit)  → { applied, skipped, failed }
 */

// ─── Navigation ──────────────────────────────────────────────────────────────

async function navigateToSettings(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

// ─── Field Capture (runs inside the browser via page.evaluate) ───────────────

async function captureFormFields(page) {
  return page.evaluate(() => {
    function getLabel(el) {
      if (el.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (forLabel) return forLabel.textContent.trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel) {
        const ownText = Array.from(parentLabel.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .filter(Boolean)
          .join(' ') || parentLabel.textContent.trim();
        if (ownText) return ownText;
        // Fall through — confirmed live (Sep 2026, Settings/Resident/{id}):
        // the compliance-item checkboxes ARE wrapped in a <label> (so this
        // branch matches), but that label only contains the checkbox +
        // icon, no text at all — the item's real name is a sibling <td>'s.
      }
      // Table-row pattern (confirmed live on the same page): checkbox's own
      // <td> has no text — the row's name lives in the first LATER <td>
      // that actually has text (there's usually a drag-handle <td> with an
      // icon-only cell in between).
      const row = el.closest('tr');
      if (row) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        const ownCell = el.closest('td');
        const ownIndex = cells.indexOf(ownCell);
        for (let i = ownIndex + 1; i < cells.length; i++) {
          const text = cells[i].textContent.trim();
          if (text) return text;
        }
      }
      const container = el.closest('.form-group, .field-row, .setting-row, li');
      if (container) {
        const lbl = container.querySelector('label, .label, .field-label');
        if (lbl && !lbl.contains(el)) return lbl.textContent.trim();
      }
      return el.getAttribute('placeholder') || '';
    }

    function getSectionLabel(el) {
      // Confirmed live: section headings (e.g. "Compliance Configuration")
      // are NOT ancestor-and-direct-child of the field's container — this
      // whole settings page is one long form where a heading is a
      // PRECEDING SIBLING of whatever wraps the fields under it (often
      // several ancestor levels up from any individual field). Walking up
      // and checking preceding siblings at every level finds it either way.
      let node = el;
      while (node && node !== document.body) {
        let sib = node.previousElementSibling;
        while (sib) {
          // Confirmed live: the heading itself is an <h2> wrapped one level
          // down in a <div class="mt-section-hdg-title"> — check both "sib
          // IS a heading" and "sib CONTAINS one" so it matches whichever
          // level the wrapping div sits at.
          if (/^H[1-4]$/.test(sib.tagName) || (sib.matches && sib.matches('.panel-heading, .section-title, legend'))) {
            return sib.textContent.trim();
          }
          const nested = sib.querySelector && sib.querySelector('h1, h2, h3, h4, .panel-heading, .section-title, legend');
          if (nested) return nested.textContent.trim();
          sib = sib.previousElementSibling;
        }
        if (node.tagName === 'FIELDSET') {
          const legend = node.querySelector(':scope > legend');
          if (legend) return legend.textContent.trim();
        }
        node = node.parentElement;
      }
      return '';
    }

    // Confirmed live across multiple settings pages (Resident, Medication,
    // CRM/Prospect) — two classes of control that LOOK like settings but
    // aren't, worth excluding everywhere, not just Resident Settings:
    //   1. "Select/check all" utility toggles — id/name varies per section
    //      ("CheckAll", "checkAllProspectSources", "checkAllTaskOutcomeTypes",
    //      ...), always a page convenience, never a real setting.
    //   2. Auto-postback pickers (data-autopostback="true", e.g. Medication
    //      Settings' community switcher, name="Facility.ID") — these RELOAD
    //      the page to a different context on change; they're navigation,
    //      not a value this page is configuring.
    function isExcludedControl(el) {
      const key = `${el.id || ''} ${el.name || ''}`;
      if (/checkall/i.test(key)) return true;
      if (el.getAttribute('data-autopostback') === 'true') return true;
      return false;
    }

    const checkboxes = [];
    const selects    = [];
    const textInputs = [];
    const radios     = {};

    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!cb.id && !cb.name) return;
      if (isExcludedControl(cb)) return;
      checkboxes.push({
        id:      cb.id   || '',
        name:    cb.name || '',
        checked: cb.checked,
        label:   getLabel(cb),
        section: getSectionLabel(cb),
      });
    });

    document.querySelectorAll('select').forEach(sel => {
      if (!sel.id && !sel.name) return;
      if (isExcludedControl(sel)) return;
      selects.push({
        id:      sel.id   || '',
        name:    sel.name || '',
        value:   sel.value,
        label:   getLabel(sel),
        section: getSectionLabel(sel),
      });
    });

    document.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="email"], input:not([type])'
    ).forEach(inp => {
      if (!inp.id && !inp.name) return;
      if (isExcludedControl(inp)) return;
      if (inp.type === 'hidden') return;
      textInputs.push({
        id:    inp.id   || '',
        name:  inp.name || '',
        value: inp.value,
        label: getLabel(inp),
        section: getSectionLabel(inp),
      });
    });

    document.querySelectorAll('input[type="radio"]:checked').forEach(r => {
      if (r.name) radios[r.name] = r.value;
    });

    return {
      checkboxes,
      selects,
      textInputs,
      radios: Object.entries(radios).map(([name, value]) => ({ name, value })),
    };
  });
}

// ─── Save Page ────────────────────────────────────────────────────────────────

async function saveSettings(page) {
  const candidates = [
    'button:has-text("Save Settings")',
    'button:has-text("Save Changes")',
    'button:has-text("Save")',
    'input[type="submit"][value*="Save" i]',
    'input[type="submit"]',
  ];

  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(1500);
      console.log(`[Settings] Saved via: ${sel}`);
      return true;
    }
  }
  console.log('[Settings] No Save button found');
  return false;
}

// ─── Compliance Template Helpers ──────────────────────────────────────────────

/**
 * KNOWN DEAD CODE (confirmed live, Sep 2026, against Settings/Resident/{id}):
 * none of the guessed selectors below match anything on the real page — this
 * has always returned 0 templates, silently. The real compliance-item rows
 * (`<tr data-sort-item-identifier="106046">`, one per item, with an
 * Edit/Retire/Delete/Markup Form dropdown) ARE already captured by the main
 * checkbox capture above (name="ComplianceItemIds[106046]") — this
 * function was reaching for something MORE than that flat enable/disable
 * checkbox: each item's own deeper config (required/optional, expiration
 * rules, etc.), reachable only via that row's "Edit" link
 * (`/Settings/Compliance/{communityId}/resident/Edit/{itemId}`, an AJAX
 * pane load). Left disabled/inert rather than guessed at further — opening
 * and capturing 100+ items' Edit panes one at a time is a real, slower
 * feature that needs its own scoped pass (confirm the Edit pane's field
 * shape first), not something to bolt on blind.
 */
async function findComplianceTemplateRows(page) {
  const selectors = [
    // Specific ALIS compliance table patterns (tune once we see the real DOM)
    'table.compliance-templates tbody tr',
    '#complianceTemplates tbody tr',
    '.compliance-list .compliance-item',
    '[data-compliance-template]',
    // Generic: rows inside a section whose nearest header mentions "Compliance" or "Template"
    '.panel:has(.panel-heading:has-text("Compliance")) tbody tr',
    '.section:has(h3:has-text("Compliance")) .list-item',
    '.setting-section:has(h3:has-text("Template")) tr',
  ];

  for (const sel of selectors) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) {
      console.log(`[Settings] Compliance rows found (${count}) via: ${sel}`);
      return { locator: page.locator(sel), count };
    }
  }
  return null;
}

/**
 * Open a compliance template row for editing.
 * Tries an edit button first, then falls back to clicking the row itself.
 */
async function openTemplateEdit(page, row) {
  const editBtn = row.locator(
    'button:has-text("Edit"), a:has-text("Edit"), button.edit, a.edit, [data-action="edit"]'
  ).first();

  if (await editBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editBtn.click();
  } else {
    await row.click();
  }
  await page.waitForTimeout(800);
}

/**
 * Close an open modal or expanded inline panel.
 */
async function closeTemplateEdit(page) {
  const closeBtn = page.locator(
    '.modal .close, .modal button:has-text("Close"), .modal button:has-text("Cancel"), [aria-label="Close"]'
  ).first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(400);
}

// ─── Capture ──────────────────────────────────────────────────────────────────

/**
 * Capture compliance template names and their form-field states.
 */
async function captureComplianceTemplates(page) {
  const result = await findComplianceTemplateRows(page);
  if (!result) return [];

  const { locator, count } = result;
  const templates = [];

  for (let i = 0; i < count; i++) {
    const row = locator.nth(i);
    let name = '';
    try {
      // Name is usually in the first column
      name = (
        await row.locator('td:first-child, .name, .template-name, strong').first().textContent()
      ).trim();
      if (!name) continue;

      console.log(`[Settings] Capturing compliance template: "${name}"`);

      await openTemplateEdit(page, row);

      const fields = await captureFormFields(page);
      templates.push({ name, fields });

      await closeTemplateEdit(page);
    } catch (err) {
      console.log(`[Settings] Warning — could not capture template "${name}": ${err.message}`);
      await closeTemplateEdit(page).catch(() => {});
    }
  }

  return templates;
}

/**
 * Full capture of the source Resident Settings page.
 */
async function captureResidentSettings(page, url) {
  console.log(`[Settings] Capturing source: ${url}`);
  await navigateToSettings(page, url);

  await page.screenshot({ path: `debug_capture_${Date.now()}.png`, fullPage: true }).catch(() => {});

  const fields = await captureFormFields(page);
  console.log(
    `[Settings] Fields captured — checkboxes: ${fields.checkboxes.length}, ` +
    `selects: ${fields.selects.length}, textInputs: ${fields.textInputs.length}`
  );

  const complianceTemplates = await captureComplianceTemplates(page);
  console.log(`[Settings] Compliance templates captured: ${complianceTemplates.length}`);

  return {
    capturedAt: new Date().toISOString(),
    sourceUrl: url,
    fields,
    complianceTemplates,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Apply a snapshot's checkbox + select states to the current page.
 * Text inputs are intentionally skipped (too risky without knowing which are safe).
 */
/**
 * Confirmed live (Sep 2026, Medication/Billing Settings): the same `name`
 * (no `id` at all) can legitimately appear more than once on one page —
 * e.g. `name="IncludeDisabled"` used independently under both "Payer
 * Types" and "Payment Methods". `.first()` would apply every such field to
 * the SAME (first) element, silently never touching the later ones.
 * Returns each field's 0-based position among entries sharing its name,
 * in capture order — `querySelectorAll` and Playwright's `.nth()` both
 * return elements in DOM document order, so as long as the page's DOM
 * hasn't changed shape between capture and apply, the Nth same-named entry
 * captured is the Nth same-named element on the page.
 */
function nameOccurrenceIndex(fields, field) {
  let index = 0;
  for (const f of fields) {
    if (f === field) break;
    if (!f.id && f.name === field.name) index++;
  }
  return index;
}

async function applyFormFields(page, snapshot, results) {
  // Checkboxes
  for (const field of snapshot.checkboxes) {
    const key = field.id || field.name;
    const locator = field.id
      ? page.locator(`#${field.id}`)
      : page.locator(`input[type="checkbox"][name="${field.name}"]`).nth(nameOccurrenceIndex(snapshot.checkboxes, field));

    try {
      const exists = await locator.count() > 0;
      if (!exists) {
        results.skipped++;
        continue;
      }

      const current = await locator.isChecked().catch(() => null);
      if (current === null || current === field.checked) {
        results.skipped++;
        continue;
      }

      // Use JS click to respect Knockout bindings
      if (field.id) {
        await page.evaluate(id => {
          const el = document.querySelector('#' + id);
          if (el) el.click();
        }, field.id);
      } else {
        await locator.click({ force: true });
      }
      await page.waitForTimeout(80);

      results.applied++;
      console.log(`[Settings]   ✓ Checkbox "${field.label || key}": ${current} → ${field.checked}`);
    } catch (err) {
      results.failed++;
      console.log(`[Settings]   ✗ Checkbox "${field.label || key}": ${err.message}`);
    }
  }

  // Selects
  for (const field of snapshot.selects) {
    const key = field.id || field.name;
    const locator = field.id
      ? page.locator(`#${field.id}`)
      : page.locator(`select[name="${field.name}"]`).nth(nameOccurrenceIndex(snapshot.selects, field));

    try {
      const exists = await locator.count() > 0;
      if (!exists) { results.skipped++; continue; }

      const current = await locator.inputValue().catch(() => null);
      if (current === field.value) { results.skipped++; continue; }

      await locator.selectOption(field.value);
      await page.waitForTimeout(80);

      results.applied++;
      console.log(`[Settings]   ✓ Select "${field.label || key}": ${current} → ${field.value}`);
    } catch (err) {
      results.failed++;
      console.log(`[Settings]   ✗ Select "${field.label || key}": ${err.message}`);
    }
  }
}

/**
 * Apply compliance template settings to matching templates on the target page.
 */
async function applyComplianceTemplates(page, sourceTemplates, results) {
  for (const srcTemplate of sourceTemplates) {
    try {
      console.log(`[Settings] Applying compliance template: "${srcTemplate.name}"`);

      // Find the matching row on target by visible text
      const row = page
        .locator('tr, .compliance-item, .template-item, .list-item')
        .filter({ hasText: srcTemplate.name })
        .first();

      if (!await row.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log(`[Settings]   ⚠ Template not found on target: "${srcTemplate.name}"`);
        results.skipped++;
        continue;
      }

      await openTemplateEdit(page, row);

      const templateResults = { applied: 0, skipped: 0, failed: 0 };
      await applyFormFields(page, srcTemplate.fields, templateResults);

      if (templateResults.applied > 0) {
        await saveSettings(page);
      }

      await closeTemplateEdit(page);

      results.applied += templateResults.applied;
      results.skipped += templateResults.skipped;
      results.failed  += templateResults.failed;
      console.log(
        `[Settings]   ✓ Template "${srcTemplate.name}" — ` +
        `applied: ${templateResults.applied}, skipped: ${templateResults.skipped}`
      );
    } catch (err) {
      results.failed++;
      console.log(`[Settings]   ✗ Template "${srcTemplate.name}": ${err.message}`);
      await closeTemplateEdit(page).catch(() => {});
    }
  }
}

/**
 * Apply a settings snapshot to the target Resident Settings page.
 * @param {Page}     page     - Playwright page (already logged in)
 * @param {string}   url      - Target settings URL
 * @param {object}   snapshot - Result of captureResidentSettings()
 * @param {function} emit     - SSE emitter (optional)
 * @returns {{ applied: number, skipped: number, failed: number }}
 */
async function applyResidentSettings(page, url, snapshot, emit = () => {}) {
  console.log(`[Settings] Applying to target: ${url}`);
  await navigateToSettings(page, url);

  await page.screenshot({ path: `debug_apply_before_${Date.now()}.png`, fullPage: true }).catch(() => {});

  const results = { applied: 0, skipped: 0, failed: 0 };

  emit('progress', { message: 'Applying main settings fields...' });
  await applyFormFields(page, snapshot.fields, results);

  if (results.applied > 0) {
    await saveSettings(page);
  }

  if (snapshot.complianceTemplates && snapshot.complianceTemplates.length > 0) {
    emit('progress', {
      message: `Applying ${snapshot.complianceTemplates.length} compliance template settings...`,
    });
    await applyComplianceTemplates(page, snapshot.complianceTemplates, results);
  }

  await page.screenshot({ path: `debug_apply_after_${Date.now()}.png`, fullPage: true }).catch(() => {});

  return results;
}

module.exports = {
  captureResidentSettings,
  applyResidentSettings,
};
