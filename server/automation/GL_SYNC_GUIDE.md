# GL Sync Automation — Implementation Guide

## Overview

The GL sync automation has been implemented with Playwright to automate the GL account updates in ALIS billing settings. The current implementation uses generic selectors that may need customization based on the exact UI structure of your ALIS instance.

## File Structure

```
server/automation/
├── playwright/
│   ├── billingPage.js          ← GL sync Playwright functions
│   ├── browser.js              ← Shared browser/login utilities
│   └── communityPage.js        ← Community creation utilities
├── jobs.js                     ← Job handlers (uses billingPage.js)
├── templates.json              ← Template definitions
└── GL_SYNC_GUIDE.md           ← This file
```

## Current Implementation

### billingPage.js Functions

**1. `navigateToBillingSettings(page, billingSettingsUrl)`**
- Navigates to the billing settings URL
- Waits for network idle
- Adds 1000ms delay for page to fully render

**2. `updateGLAccount(page, itemName, glOld, glNew, discounts)`**
- Finds the billing item by name
- Opens the item's detail view (if needed)
- Updates the GL account field with glNew value
- Optionally updates discount GL accounts (disc1, disc2)
- Saves the changes
- Detects errors and throws if save fails

**3. `findBillingItem(page, itemName)`**
- Locates a billing item by name in the page
- Uses xpath selector to find by text content
- Returns the located element

**4. `closeDetailView(page)`**
- Closes any open detail/dialog windows
- Prepares page for next item processing

## Customizing the Selectors

The current implementation uses generic selectors that may not match your ALIS UI exactly. You'll need to customize `billingPage.js` based on your UI structure.

### Step 1: Inspect the ALIS Billing Settings UI

1. Open your ALIS billing settings page
2. Open browser DevTools (F12)
3. Inspect the following elements and note their selectors:

   - **Billing items table/list container**
     - Is it a `<table>`? A list of `<div>`s? A grid?
     - What class names are used?
   
   - **Item name cell**
     - Text content example: "Assisted Living Apartment Rent"
     - Can you target by text with `contains(text(), '...')`?
     - Does each item have a unique ID or data-attribute?
   
   - **GL Account input field**
     - Current value displayed somewhere?
     - Is it an `<input>` or `<select>`?
     - What classes/IDs identify it?
     - Placeholder text or label?
   
   - **Discount GL fields (if applicable)**
     - Similar inspection for discount 1 and discount 2 fields
   
   - **Save/Update button**
     - Text label: "Save"? "Update"? "Apply"?
     - Inside the item row or detail view?
     - Button classes or data-attributes?
   
   - **Error messages**
     - What class indicates an error? `.error`, `.alert-error`, `.validation-error`?
     - Is it shown inline or in a modal?
   
   - **Close/Cancel button**
     - For closing detail views
     - May be a small X icon or "Close" button

### Step 2: Update billingPage.js

Replace the generic selectors with your actual selectors. Examples:

```javascript
// BEFORE (generic):
const itemLocator = page.locator(
  `xpath=//tr[contains(., '${itemName}')] | //div[contains(text(), '${itemName}')]`
).first();

// AFTER (specific to your UI):
const itemLocator = page.locator(
  `tr[data-item-id]:has-text("${itemName}")`
);
```

### Step 3: Common Selector Patterns

**XPath patterns (useful for text matching):**
```javascript
// Find by exact text
page.locator(`xpath=//*[text()="${itemName}"]`)

// Find by partial text match
page.locator(`xpath=//*[contains(text(), "${itemName}")]`)

// Find by text in child element
page.locator(`xpath=//tr[.//td[contains(text(), "${itemName}")]]`)

// Find by multiple conditions
page.locator(`xpath=//tr[@data-status="active"][.//td[contains(text(), "${itemName}")]]`)
```

**CSS patterns:**
```javascript
// By class
page.locator(`.billing-item[data-name="${itemName}"]`)

// By attribute
page.locator(`input[data-field="gl_account"]`)

// By role (recommended for accessibility)
page.locator(`role=row:has-text("${itemName}")`)
page.locator(`button:has-text("Save")`)
```

### Step 4: Testing Your Updates

1. Test with a single item first
2. Add console logging to see what's being found:

```javascript
// Add temporary debug logging in updateGLAccount
const itemRow = await findBillingItem(page, itemName);
console.log(`[GL Sync] Found item: ${itemName}`);
console.log(`[GL Sync] Item element: ${await itemRow.getAttribute('class')}`);
```

3. Run a test job and check the logs
4. Adjust selectors as needed
5. Test with multiple items and discount accounts
6. Remove debug logging when satisfied

## Event Flow

The job handler emits these events:

**On Start:**
```javascript
emit('job_start', { 
  jobId: '...', 
  total: 17,  // Number of items
  community: 'Steadman Hill'
})
```

**For Each Item:**
```javascript
emit('item_start', { name: 'Assisted Living Apartment Rent' })

// Success:
emit('item_done', { 
  name: 'Assisted Living Apartment Rent',
  glOld: '40031',
  glNew: '400-10'
})

// Failure:
emit('item_fail', { 
  name: 'Assisted Living Apartment Rent',
  error: 'Element not found: ...'
})

// Skipped (no glNew value):
emit('item_done', { 
  name: 'Item Name',
  status: 'skipped'
})
```

**On Completion:**
```javascript
emit('job_done', {
  jobId: '...',
  community: 'Steadman Hill',
  syncDate: '05/01/2026',
  total: 17,        // Total items
  updated: 15,      // Successfully updated
  failed: 2,        // Update failures
  skipped: 0        // Items with no glNew value
})
```

## Handling Error Cases

### Item Not Found
If Playwright can't find an item by name:
- Check if the name matches exactly (case-sensitive)
- Try using a partial text match
- Consider using a unique ID if available
- Check if the item is in a paginated view (may need to scroll)

### Field Not Found
If GL account input field not found:
- Verify the selector is correct
- Check if field is hidden/collapsed
- Look for a "Configure" or "Edit" button that opens fields
- Try inspecting the actual field classes/IDs in DevTools

### Save Failed
If the update isn't being saved:
- Verify you're clicking the correct save button
- Check for validation errors displayed
- Look for a separate "Apply to all items" button
- Check if changes require a workflow approval

## Advanced Customizations

### Handling Pagination
If billing items are paginated:

```javascript
async function updateGLAccount(page, itemName, glOld, glNew, discounts) {
  let currentPage = 1;
  const maxPages = 10;
  
  while (currentPage <= maxPages) {
    const itemLocator = page.locator(`...selector...`);
    const exists = await itemLocator.count() > 0;
    
    if (exists) {
      // Found the item, proceed with update
      break;
    }
    
    // Go to next page
    const nextBtn = page.locator('button:has-text("Next")');
    const canNavigate = await nextBtn.isEnabled();
    if (!canNavigate) throw new Error(`Item not found: ${itemName}`);
    
    await nextBtn.click();
    await page.waitForTimeout(500);
    currentPage++;
  }
}
```

### Handling Modal Dialogs
If updates open in a modal:

```javascript
// Add this to updateGLAccount
const modal = page.locator('.modal, [role="dialog"]').first();
await modal.waitFor({ state: 'visible' });

// Do updates in modal...

// Close modal
const closeBtn = modal.locator('button:has-text("Close"), button.close, [aria-label="Close"]');
await closeBtn.click();
await modal.waitFor({ state: 'hidden' });
```

### Handling Async Saves
If save is asynchronous:

```javascript
// Save and wait for completion
await saveBtn.click();

// Wait for loading spinner to disappear
await page.locator('.spinner, .loading').waitFor({ state: 'hidden', timeout: 5000 });

// Or wait for success message
await page.locator(':has-text("Saved successfully")').waitFor({ timeout: 5000 });
```

## Troubleshooting

**Problem:** Job fails immediately on all items  
**Solution:** Check browser login/auth with `ensureLoggedIn(page)`. Take a screenshot to see where the page actually is.

**Problem:** Items skipped as not found  
**Solution:** Update the `findBillingItem` selector. Run with debug logging enabled.

**Problem:** Updates fail silently without error  
**Solution:** Check for validation errors on the page. Look for alert/error messages in DevTools.

**Problem:** Only first item updates, then stops  
**Solution:** Verify `closeDetailView()` is working. May need to wait for page to settle between items.

## Future Enhancements

- [ ] Support for bulk updates via "Update All" button
- [ ] Validate GL account format before submission
- [ ] Handle warnings/confirmations (e.g., "This affects X units")
- [ ] Support for staged rollout (sync on multiple dates)
- [ ] Dry-run mode to verify selections without saving
- [ ] Rollback capability if errors occur

## Support

For issues with the Playwright automation:

1. Enable debug mode: Add `DEBUG=pw:api` to environment variables
2. Check screenshots in the outputs directory (error_*.png files)
3. Review console logs in your server terminal
4. Run with a single test item first
5. Inspect the actual HTML structure in your ALIS instance

---

**Last Updated:** 2026-05-09
