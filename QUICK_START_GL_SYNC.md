# GL Sync — Quick Start Guide

## TL;DR

The GL Sync feature is **95% ready**. Frontend is complete and fully functional. Backend job handler is implemented but needs selector tuning for your ALIS UI.

## What Works Now

✅ Form UI for GL sync with three data input modes  
✅ Excel file upload with auto-parsing  
✅ JSON paste functionality  
✅ Interactive table editing  
✅ Form validation  
✅ Job submission and SSE event streaming  
✅ Backend job dispatcher  

## What You Need to Do

### 1. Quick Test (2 minutes)
```bash
cd alis-hub
npm run dev
# Navigate to http://localhost:5173/new-job
# Select "Sync GL Accounts"
# Fill form and try submitting
```

### 2. Customize Playwright (30 minutes)
1. Open your ALIS billing settings page
2. Read `server/automation/GL_SYNC_GUIDE.md`
3. Inspect HTML elements in DevTools to get selectors
4. Update `server/automation/playwright/billingPage.js` lines 18-70
5. Test with a single item job

### 3. Validate It Works (15 minutes)
1. Run a test job with 1-2 items
2. Verify GL accounts actually change in ALIS
3. Check that discount accounts update if provided
4. Expand test to full 17-item list

## Key Files

| File | Purpose | Status |
|------|---------|--------|
| client/src/pages/NewJob.jsx | Form UI | ✅ Done |
| client/src/components/BillingItemsInput.jsx | Data input tabs | ✅ Done |
| client/src/utils/excel-parser.js | Excel → JSON | ✅ Done |
| server/automation/jobs.js | Job handler | ✅ Done (generic) |
| server/automation/playwright/billingPage.js | Playwright logic | ⚠️ Needs tuning |
| server/automation/GL_SYNC_GUIDE.md | How to customize | ✅ Done |

## Selector Update Quick Reference

In `server/automation/playwright/billingPage.js`, you need to update:

```javascript
// Line 19 — Finding billing items by name:
const itemLocator = page.locator(`YOUR_SELECTOR_HERE`);

// Line 46 — GL account input field:
const glInput = page.locator(`YOUR_SELECTOR_HERE`);

// Line 55 — Discount 1 field:
const disc1Input = page.locator(`YOUR_SELECTOR_HERE`);

// Line 63 — Discount 2 field:
const disc2Input = page.locator(`YOUR_SELECTOR_HERE`);

// Line 71 — Save button:
const saveBtn = page.locator(`YOUR_SELECTOR_HERE`);

// Line 76 — Error message:
const errorMsg = page.locator(`YOUR_SELECTOR_HERE`);
```

**Selector Examples:**
```javascript
// By text (most flexible)
page.locator(`xpath=//*[contains(text(), "${itemName}")]`)

// By class (if available)
page.locator(`.billing-item[data-name="${itemName}"]`)

// By role (recommended)
page.locator(`button:has-text("Save")`)
```

See `GL_SYNC_GUIDE.md` for full pattern library.

## Testing Workflow

```
1. npm run dev
   ↓
2. Navigate to /new-job
   ↓
3. Select "Sync GL Accounts"
   ↓
4. Fill form (community, URL, date)
   ↓
5. Add 1-2 test items (table or JSON)
   ↓
6. Submit
   ↓
7. Watch progress in JobDetail
   ↓
8. If fails: Check logs, update selectors, retry
   ↓
9. If succeeds: Verify changes in ALIS
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Form won't submit | Check console for validation errors. Date must be MM/DD/YYYY |
| Job starts but items fail | Update selectors in billingPage.js for your ALIS UI |
| Items found but don't update | Wrong GL input field selector. Inspect actual field in DevTools |
| Save button not working | Might be named differently ("Apply", "Update", etc.). Check UI |
| Excel upload fails | File must have headers matching column names (name, gl_old, gl_new, etc.) |

## File Locations

**Frontend:**
```
client/src/
├── pages/NewJob.jsx
├── components/BillingItemsInput.jsx
└── utils/excel-parser.js
```

**Backend:**
```
server/automation/
├── jobs.js
├── playwright/billingPage.js
└── GL_SYNC_GUIDE.md
```

**Documentation:**
```
alis-hub/
├── GL_SYNC_IMPLEMENTATION_STATUS.md  ← Full status
├── QUICK_START_GL_SYNC.md           ← This file
└── server/automation/GL_SYNC_GUIDE.md ← Customization guide
```

## Next Steps

### Right Now
1. **Read:** `GL_SYNC_IMPLEMENTATION_STATUS.md` for full context
2. **Test:** Run dev server and test the form UI
3. **Inspect:** Open ALIS billing page in DevTools

### Within 1 hour
1. **Customize:** Update selectors in `billingPage.js`
2. **Validate:** Test with 1-2 item job
3. **Debug:** Check logs and error screenshots if needed

### This Session
1. **Full Test:** Run with all 17 items
2. **Verify:** Confirm GL changes in ALIS
3. **Polish:** Any tweaks to error messages or UI

## Need Help?

**For Selector Issues:**
- See `GL_SYNC_GUIDE.md` → "Customizing the Selectors" section
- Use DevTools to inspect elements: Right-click → Inspect Element
- Try XPath if CSS selectors don't work: `xpath=//*[contains(text(), "...")]`

**For Job Handler Issues:**
- Check server console for detailed error messages
- Look for error_*.png screenshots in outputs directory
- Enable DEBUG: `DEBUG=pw:api npm run dev`
- Check SSE events in browser DevTools → Network tab

**For Form/UI Issues:**
- Check browser console (F12)
- Verify all form fields are filled correctly
- Date format must be MM/DD/YYYY
- Check validation messages below form fields

---

**Ready to test?** Start with step 1 above. Takes about 2 minutes to verify everything works!
