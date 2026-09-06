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
    // A cell/column's real static label text, ignoring any form controls
    // nested inside it — confirmed live as a necessary distinction, not a
    // hypothetical: Medication Settings' "Med Pass Time Shifts" row has a
    // <td> containing only a <select> of times, and a bare `.textContent`
    // read on it returns every <option>'s text concatenated ("12:00
    // AM12:30 AM...") since a select's rendered/selected text isn't what
    // textContent reflects — that garbage was then mistaken for a real
    // label on the row's other fields.
    function staticText(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button, option').forEach((n) => n.remove());
      return clone.textContent.trim();
    }

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
      // A field named "...[N].Name" is, by construction, itself the row's
      // display name — its own current value IS the label, full stop.
      // Must be checked before the table-row scan below: that scan looks
      // at LATER sibling cells for visible text, but on rows like
      // Medication Settings' "Med Pass Time Shifts" every cell is itself
      // a form control (a text input here, selects elsewhere) — a select
      // widget (e.g. select2) can leave its own rendered current-value
      // span as real static text in a later cell, which the scan would
      // otherwise mistake for this field's label (confirmed live: without
      // this early check, TimeFrames[0].Name's "label" came back as
      // TimeFrames[0].StartTime's rendered time instead of "Morning").
      if (/\[\d+\]\.Name$/.test(el.name || '') && el.value) return el.value;
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
          const text = staticText(cells[i]);
          if (text) return text;
        }
      }
      const container = el.closest('.form-group, .field-row, .setting-row, li');
      if (container) {
        const lbl = container.querySelector('label, .label, .field-label');
        if (lbl && !lbl.contains(el)) return lbl.textContent.trim();
      }
      // Grid-row pattern (confirmed live, Settings/Medication/{id}'s
      // "Variance Threshold" section — 48 of the 52 blank fields there
      // turned out to be this, not the <app> embed as first assumed): a
      // plain-text <label> describing the row ("1 x a day") lives in a
      // sibling .mt-grid-col div at the same .mt-grid level, with no
      // `for` attribute tying it to the field at all — a table-row-style
      // layout built with div grids instead of <tr>/<td>.
      const gridRow = el.closest('.mt-grid');
      if (gridRow) {
        const cols = Array.from(gridRow.querySelectorAll(':scope > .mt-grid-col'));
        for (const col of cols) {
          if (col.contains(el)) continue;
          const text = staticText(col);
          if (text) return text;
        }
      }
      // Editable-name-per-row pattern (confirmed live — Medication
      // Settings' "Med Pass Time Shifts", a Vue-rendered <tr> with no
      // static label cell at all): a sibling field (e.g.
      // TimeFrames[0].MealTime) takes its label from the SAME row's own
      // `Prefix[N].Name` input value ("Morning") by matching array index,
      // since that's the row's real display name and nothing static
      // names it anywhere else in the row.
      const indexMatch = (el.name || '').match(/^(.+)\[(\d+)\]\.\w+$/);
      if (indexMatch) {
        const [, prefix, idx] = indexMatch;
        const nameInput = document.querySelector(`[name="${prefix}[${idx}].Name"]`);
        if (nameInput && nameInput.value) return nameInput.value;
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
    // CRM/Prospect) — classes of control that LOOK like settings but
    // aren't, worth excluding everywhere, not just Resident Settings:
    //   1. "Select/check all" utility toggles — id/name varies per section
    //      ("CheckAll", "checkAllProspectSources", "checkAllTaskOutcomeTypes",
    //      ...), always a page convenience, never a real setting.
    //   2. Auto-postback pickers (data-autopostback="true", e.g. Medication
    //      Settings' community switcher, name="Facility.ID") — these RELOAD
    //      the page to a different context on change; they're navigation,
    //      not a value this page is configuring.
    //   3. Anything inside an <app> element. NOTE: an earlier version of
    //      this comment guessed this would catch Medication Settings'
    //      "Med Pass Time Shifts" section as a separate embedded
    //      micro-frontend — confirmed WRONG on closer live inspection:
    //      that section is Vue-rendered <tr>s in the ordinary page DOM
    //      (see the "editable-name-per-row" label fallback in getLabel
    //      for how its labels are actually extracted), and the one real
    //      <app> element found on Settings/Resident/{id} is just the
    //      shared page-header notifications widget
    //      (#headerNotificationsViewerContainer) — unrelated to any
    //      settings section. Kept as a defensive exclusion (a genuine
    //      embedded micro-frontend settings section may exist on some
    //      other page not yet surveyed) but the specific example is
    //      retired; don't rely on this line to explain any particular
    //      page's blank labels without re-confirming live first.
    //   4. Fields inside an "Add new ___" or "Edit ___" modal (id starting
    //      with "add" or "edit", e.g. #addAttendanceStatusModal /
    //      #editAttendanceStatusModal on Settings/Resident/{id}'s
    //      "Mealtime Attendance" section) — confirmed live, both are
    //      blank templates at page-load time regardless of whether real
    //      rows already exist (the edit modal only gets populated
    //      dynamically once a user clicks Edit on a specific row), not a
    //      setting with a captured value to sync.
    function isExcludedControl(el) {
      const key = `${el.id || ''} ${el.name || ''}`;
      if (/checkall/i.test(key)) return true;
      if (el.getAttribute('data-autopostback') === 'true') return true;
      if (el.closest('app')) return true;
      const modal = el.closest('.mt-modal');
      if (modal && /^(add|edit)/i.test(modal.id)) return true;
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
      // Surfaced so a caller can warn that this page has a section outside
      // this capture's reach (see isExcludedControl's <app> exclusion
      // above) — a nonzero count means real settings may exist here that
      // this snapshot simply cannot see, not that the page has none.
      // The shared page-header notifications widget
      // (#headerNotificationsViewerContainer) is itself an <app> element
      // present on every Settings page — confirmed live, unrelated to
      // any settings content — so it's excluded from this count to keep
      // the count meaningful for whatever else might turn up.
      embeddedAppSectionCount: Array.from(document.querySelectorAll('app'))
        .filter((el) => el.parentElement?.id !== 'headerNotificationsViewerContainer').length,
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

// ─── Compliance Item Deep-Edit Helpers ────────────────────────────────────────

/**
 * Deep per-item config for a ComplianceItemIds[N] checkbox, reachable only
 * via that row's "Edit" link (an AJAX side-pane load, not a full
 * navigation) — confirmed live (Sep 2026, imagineseniorliving community
 * 952) at `/Settings/Compliance/{communityId}/{entityType}/Edit/{itemId}`.
 * The main checkbox capture above only sees the flat enable/disable state;
 * this is the item's actual policy: Description, Compliance Stages,
 * Product Types, Classification, Tags, Expires (+ custom day count when
 * "Custom Date" is chosen), and whether it's optional.
 *
 * Deliberately excludes two fields the pane also has — Document Name and
 * the Template PDF upload — per an explicit design call: those are
 * genuinely per-community content (the same logical item can be worded
 * differently, or use a different uploaded form, per community) and
 * should never be blindly overwritten by a sync; Document Name is instead
 * used read-only, as the stable identity that matches an item across
 * communities in the first place (same role it already plays for the
 * flat checkbox, via locateComplianceCheckboxByLabel above).
 *
 * The row is found directly by `tr[data-sort-item-identifier="{itemId}"]`
 * — the SAME id as the checkbox's `ComplianceItemIds[itemId]` name — so
 * none of this needs to parse the Edit link's URL at all.
 */
function complianceItemRow(page, itemId) {
  return page.locator(`tr[data-sort-item-identifier="${itemId}"]`);
}

/** Finds a compliance item's row on whatever page is currently loaded by its Document Name (its stable cross-community identity) rather than by item id. */
function complianceItemRowByName(page, name) {
  return page.locator('tr[data-sort-item-identifier]').filter({ hasText: name }).first();
}

/**
 * Opens a compliance item's Edit pane: its row's "Options" dropdown must
 * be opened first (the Edit link exists in the DOM but is CSS-hidden
 * until then — confirmed live, a direct click without this step times
 * out waiting for visibility), then the pane loads into #paneWrap
 * (visibility toggled via `.mt-isActive` on an ancestor `.mt-pane`, not a
 * fresh element each time — #paneWrap's PREVIOUS item's markup lingers
 * until the AJAX response replaces it, so this waits for #Name to exist
 * rather than assuming the wait alone is enough).
 */
async function openComplianceItemPane(page, itemId) {
  const row = complianceItemRow(page, itemId);
  await row.locator('.js-dropdown-trigger').click();
  await page.waitForTimeout(200);
  await row.locator('a').filter({ hasText: 'Edit' }).first().click();
  await page.waitForSelector('#paneWrap #Name', { timeout: 8000 });
  await page.waitForTimeout(300);
}

/** Closes the currently-open compliance item Edit pane via its confirmed close affordance (`.mt-pane-close`, present in the DOM at all times, not just while open). */
async function closeComplianceItemPane(page) {
  const closeLink = page.locator('.mt-pane-close').first();
  if (await closeLink.count() > 0) {
    await closeLink.click();
  }
  await page.waitForTimeout(200);
}

/** Reads the currently-open compliance item Edit pane's deep-config fields. */
async function readComplianceItemPaneFields(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('#paneWrap');
    if (!pane) return null;
    const val = (id) => pane.querySelector('#' + id)?.value ?? '';
    const selected = (id) =>
      Array.from(pane.querySelectorAll(`#${id} option`))
        .filter((o) => o.selected)
        .map((o) => o.value);
    return {
      description: val('Description'),
      complianceStageIds: selected('ComplianceStageIDs'),
      productTypeKeys: selected('ProductTypeTextKeys'),
      classification: val('ResidentTag'),
      tagIds: selected('TagIDs'),
      duration: val('Duration'),
      customDuration: val('CustomDuration'),
      optional: pane.querySelector('input[name="Optional"]:checked')?.value ?? 'False',
    };
  });
}

/**
 * Writes deep-config field values into the currently-open compliance item
 * Edit pane, WITHOUT submitting — the multi-selects (Compliance Stages,
 * Product Types, Tags) are bootstrap-multiselect-wrapped native
 * `<select multiple>` elements; that plugin keeps the native select as
 * its real source of truth and listens for its native `change` event, so
 * setting `option.selected` directly + dispatching `change` is sufficient
 * (the visual dropdown widget staying stale until then is cosmetic —
 * what the form actually submits is the native select's state, read the
 * same way in readComplianceItemPaneFields above). Returns whether
 * anything actually differed from the pane's current state, so a caller
 * can skip submitting when nothing changed.
 */
async function writeComplianceItemPaneFields(page, item) {
  return page.evaluate((item) => {
    const pane = document.querySelector('#paneWrap');
    if (!pane) return false;
    let changed = false;

    const setSelected = (id, values) => {
      const select = pane.querySelector('#' + id);
      if (!select) return;
      const wanted = new Set(values || []);
      let localChanged = false;
      Array.from(select.options).forEach((opt) => {
        const shouldBeSelected = wanted.has(opt.value);
        if (opt.selected !== shouldBeSelected) {
          opt.selected = shouldBeSelected;
          localChanged = true;
        }
      });
      if (localChanged) {
        select.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
    };

    const setValue = (id, value) => {
      const el = pane.querySelector('#' + id);
      if (!el || el.value === (value || '')) return;
      el.value = value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    };

    setValue('Description', item.description);
    setSelected('ComplianceStageIDs', item.complianceStageIds);
    setSelected('ProductTypeTextKeys', item.productTypeKeys);
    setValue('ResidentTag', item.classification);
    setSelected('TagIDs', item.tagIds);
    setValue('Duration', item.duration || '0');
    if ((item.duration || '0') === '-1') {
      setValue('CustomDuration', item.customDuration);
    }

    const wantOptional = item.optional === 'True';
    const radio = pane.querySelector(
      `input[name="Optional"][value="${wantOptional ? 'True' : 'False'}"]`
    );
    if (radio && !radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }

    return changed;
  }, item);
}

// ─── Capture ──────────────────────────────────────────────────────────────────

/**
 * Deep-edit details for every ComplianceItemIds[N] checkbox already found
 * by the main field capture — captures ALL of them regardless of current
 * checked state (a community may want an item's policy correctly
 * configured even while it's currently disabled, ready for whenever it's
 * turned on), skipped entirely on pages with no compliance items at all
 * (Care Settings, Billing Settings, etc. — no wasted pane round-trips).
 */
async function captureComplianceItemsDeep(page, checkboxes) {
  const items = (checkboxes || [])
    .map((cb) => ({ cb, match: /^ComplianceItemIds\[(\d+)\]$/.exec(cb.name || '') }))
    .filter((x) => x.match);
  if (items.length === 0) return [];

  console.log(`[Settings] Capturing deep-edit details for ${items.length} compliance item(s)...`);
  const results = [];
  for (const { cb, match } of items) {
    const itemId = match[1];
    try {
      await openComplianceItemPane(page, itemId);
      const fields = await readComplianceItemPaneFields(page);
      await closeComplianceItemPane(page);
      if (fields) {
        results.push({ itemId, name: cb.label, ...fields });
      }
    } catch (err) {
      console.log(
        `[Settings] Warning — could not capture compliance item deep details for ` +
        `"${cb.label || itemId}": ${err.message}`
      );
      await closeComplianceItemPane(page).catch(() => {});
    }
  }
  return results;
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
  if (fields.embeddedAppSectionCount > 0) {
    console.log(
      `[Settings] WARNING — this page has ${fields.embeddedAppSectionCount} embedded <app> section(s) ` +
      '(beyond the shared header notifications widget, already excluded from this count) that this ' +
      'capture cannot see — real settings may exist there that this snapshot does not cover.'
    );
  }

  const complianceItemsDeep = await captureComplianceItemsDeep(page, fields.checkboxes);

  return {
    capturedAt: new Date().toISOString(),
    sourceUrl: url,
    fields,
    complianceItemsDeep,
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

/**
 * Confirmed live (Sep 2026): a compliance item's own checkbox name embeds a
 * numeric id that's unique PER COMMUNITY, not shared across an account —
 * "Move in Checklist" is `ComplianceItemIds[106046]` on one community,
 * `ComplianceItemIds[106043]` on another. Matching a checkbox by its
 * literal captured name across two different communities' pages therefore
 * finds nothing (a silent no-op skip, not an error) — every compliance-item
 * checkbox sync target has been missing this way since before this fix.
 * The name/section pattern (`collections_NN_item_id`, seen on Evacuation
 * Statuses/Move Out Reasons/etc.) is different — the SAME literal name is
 * reused across every item in one of those lists, distinguished only by
 * DOM position, which nameOccurrenceIndex above already handles correctly.
 * This is specific to ComplianceItemIds because each item there is a
 * genuine per-community record (a real compliance document), not a shared
 * global enum value.
 */
function isComplianceItemField(name) {
  return /^ComplianceItemIds\[\d+\]$/.test(name || '');
}

/** Locates a checkbox by its containing table row's visible text (a compliance item's real, stable identity — its Document Name) rather than by field name. */
function locateComplianceCheckboxByLabel(page, label) {
  return page.locator('tr').filter({ hasText: label }).first().locator('input[type="checkbox"]').first();
}

async function applyFormFields(page, snapshot, results) {
  // Checkboxes
  for (const field of snapshot.checkboxes) {
    const key = field.id || field.name;
    let locator;
    if (field.id) {
      locator = page.locator(`#${field.id}`);
    } else if (isComplianceItemField(field.name) && field.label) {
      locator = locateComplianceCheckboxByLabel(page, field.label);
    } else {
      locator = page.locator(`input[type="checkbox"][name="${field.name}"]`).nth(nameOccurrenceIndex(snapshot.checkboxes, field));
    }

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
 * Apply deep-edit compliance item details to the matching item on the
 * target page — matched by Document Name (complianceItemRowByName), the
 * same stable cross-community identity the flat checkbox sync already
 * relies on, since item ids are per-community and never line up across
 * communities (see isComplianceItemField's doc comment above).
 */
async function applyComplianceItemsDeep(page, sourceItems, results) {
  for (const item of sourceItems) {
    try {
      const row = complianceItemRowByName(page, item.name);
      const targetItemId = await row.getAttribute('data-sort-item-identifier').catch(() => null);
      if (!targetItemId) {
        console.log(`[Settings]   ⚠ Compliance item not found on target: "${item.name}"`);
        results.skipped++;
        continue;
      }

      await openComplianceItemPane(page, targetItemId);
      const changed = await writeComplianceItemPaneFields(page, item);

      if (changed) {
        await page.locator('#paneWrap .mt-pane-wrap-content-action button[type="submit"]').click();
        await page.waitForTimeout(1000);
      }
      await closeComplianceItemPane(page);

      if (changed) {
        results.applied++;
        console.log(`[Settings]   ✓ Compliance item deep details "${item.name}"`);
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.failed++;
      console.log(`[Settings]   ✗ Compliance item deep details "${item.name}": ${err.message}`);
      await closeComplianceItemPane(page).catch(() => {});
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

  if (snapshot.complianceItemsDeep && snapshot.complianceItemsDeep.length > 0) {
    emit('progress', {
      message: `Applying deep-edit details for ${snapshot.complianceItemsDeep.length} compliance item(s)...`,
    });
    await applyComplianceItemsDeep(page, snapshot.complianceItemsDeep, results);
  }

  await page.screenshot({ path: `debug_apply_after_${Date.now()}.png`, fullPage: true }).catch(() => {});

  return results;
}

module.exports = {
  captureResidentSettings,
  applyResidentSettings,
};
