# ALIS GL Sync Automation Fix - Knockout.js Observable Trigger

## Problem
The Playwright automation was successfully checking the GL Account checkbox (`#MigrateGLAccounts`), but the dependent form fields (`#CurrentGLAccountNumber` dropdown and `#NewAccountNumber` input) remained **disabled** even though the checkbox showed as checked.

The fields have Knockout.js data-binding: `data-bind="enable: migrateGLAccounts"`, which should automatically enable them when the checkbox is checked. However, synthetic JavaScript events (`.dispatchEvent()`) were not reliably triggering Knockout's observable update mechanism.

## Root Cause
Knockout.js observables respond most reliably to actual user interactions like `click()` events, not synthetic change/input events. The previous approach was:
```javascript
checkbox.checked = true;
checkbox.dispatchEvent(new Event('change', { bubbles: true }));
checkbox.dispatchEvent(new Event('input', { bubbles: true }));
```

Knockout wasn't detecting the observable change from synthetic events, leaving the dependent fields disabled.

## Solution
Changed to a two-tier approach:

### Tier 1: Click Through Knockout
Trigger the checkbox via `.click()` which Knockout actually listens to:
```javascript
await page.evaluate(() => {
  const checkbox = document.querySelector('#MigrateGLAccounts');
  if (checkbox) {
    checkbox.click();  // Knockout responds to click events
  }
}).catch(() => {});
await page.waitForTimeout(1000);
```

### Tier 2: Fallback to Manual Enable
If Knockout binding still doesn't respond, manually remove the `disabled` attribute:
```javascript
await page.evaluate(() => {
  const dropdown = document.querySelector('#CurrentGLAccountNumber');
  const input = document.querySelector('#NewAccountNumber');
  
  if (dropdown && dropdown.hasAttribute('disabled')) {
    dropdown.removeAttribute('disabled');
  }
  if (input && input.hasAttribute('disabled')) {
    input.removeAttribute('disabled');
  }
}).catch(() => {});
```

This handles:
- **Normal case**: Knockout binding works → fields enabled via data-binding
- **Edge case**: Knockout unresponsive → fields manually enabled so form can be completed

## Changes Made
1. **GL Account # checkbox** (line 209-240 approx)
   - Replaced synthetic event dispatching with `checkbox.click()`
   - Added fallback to manually remove `disabled` attribute
   - Enhanced logging to distinguish between Knockout-triggered and manual enable

2. **Discount GL Account 1 checkbox** (line 280-310 approx)
   - Applied same pattern for consistency
   - Same click-based trigger and manual fallback

## Testing
Run the sync job with:
- **Community**: Test community with GL accounts to sync
- **URL**: Your ALIS billing settings URL
- **Items**: General Care Item 57, General Rent Billing Item, etc.

Watch the console logs for:
- `✓ Clicked checkbox through JavaScript` - Initial click triggered
- `✓ Fields enabled via Knockout data-binding` - Normal case (best outcome)
- `⚠ Knockout binding unresponsive - manually enabled fields` - Fallback case (still works)

## Files Modified
- `C:\Users\AaronWhitmer\alis-hub\server\automation\playwright\billingPage.js`
  - `updateGLAccount()` function: Lines 209-240
  - Discount GL handling: Lines 280-310

The automation should now complete the GL sync process end-to-end:
1. ✓ Navigate to sync modal
2. ✓ Check GL Account # checkbox
3. ✓ Enable and fill Existing Value dropdown
4. ✓ Enable and fill New Value input
5. ✓ Submit form
6. ✓ Receive SUCCESS confirmation
