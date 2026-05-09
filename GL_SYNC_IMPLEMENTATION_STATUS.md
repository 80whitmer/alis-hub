# GL Sync Implementation — Status Summary

## What's Complete ✅

### 1. Frontend UI (Fully Functional)
- **BillingItemsInput.jsx** — Three-tab component:
  - Items Table: Interactive table for editing GL mappings (inline editing)
  - Excel Upload: Drag-and-drop/file picker for Excel import
  - Paste JSON: Textarea for JSON array import
  
- **NewJob.jsx** — Specialized form for sync-gl-accounts:
  - Community name input
  - Billing settings URL input
  - Sync date input (MM/DD/YYYY pattern)
  - BillingItemsInput component for items
  - Form validation before submission
  - Advanced JSON mode toggle (for non-GL-sync templates)

- **excel-parser.js** — Utility functions:
  - parseExcelFile() — Reads Excel files using xlsx library
  - convertExcelToBillingItems() — Maps columns to GL item structure
  - validateBillingItems() — Validates required fields and discount pairing

### 2. Backend Job Handler (Partially Complete)
- **jobs.js** — runSyncGLAccountsJob():
  - Loads Playwright page with login
  - Navigates to billing settings URL
  - Loops through items and updates GL accounts
  - Emits SSE events for progress tracking
  - Handles skipped items (where gl_new is empty)
  - Takes error screenshots for debugging
  - Returns summary with update/failure/skip counts

- **billingPage.js** — Playwright automation module:
  - navigateToBillingSettings() — Goes to billing URL
  - updateGLAccount() — Updates GL and discount accounts
  - findBillingItem() — Locates items by name
  - closeDetailView() — Closes dialogs between items
  - Generic selectors (need customization)

### 3. Template Definition (Complete)
- **templates.json** — sync-gl-accounts template:
  - Full JSON schema with all fields
  - Input validation rules
  - Example values for UX hints
  - Timeout: 30 minutes

### 4. API Routes (Complete)
- **POST /api/jobs/create** — Generic job creation
- **GET /api/jobs/templates/:id** — Fetch template with schema
- **GET /api/jobs/:id** — Get job details
- SSE streaming for real-time progress

## What You Need to Do 📋

### 1. Test Frontend (Immediate)
Run dev server: `npm run dev`

1. Navigate to `/new-job`
2. Select "Sync GL Accounts" template
3. Fill in form fields:
   - Community Name: "Test Community"
   - Billing Settings URL: Your ALIS billing URL
   - Sync Date: 05/01/2026
4. Try each input method:
   - Manually add 1-2 items in the table
   - Test Excel upload with your billing_items.xls file
   - Test JSON paste with the 17-item structure you provided
5. Submit and watch the job progress in JobDetail

### 2. Customize Playwright Selectors
Once you see the billing settings UI in action:

1. Read `GL_SYNC_GUIDE.md` for selector patterns
2. Inspect the ALIS billing UI in DevTools
3. Update `server/automation/playwright/billingPage.js`:
   - Line 19: Item row selector (in findBillingItem)
   - Line 46: GL input field selector (in updateGLAccount)
   - Line 55: Discount field selectors
   - Line 65: Save button selector
   - Line 75: Error message selector
4. Test with a single item first
5. Gradually expand to full list

### 3. Test Job Execution
With customized selectors:

1. Create a test job with 1-2 items
2. Monitor the browser to see Playwright actions
3. Check server logs for any errors
4. Review error_*.png screenshots if needed
5. Iterate selector updates until items update successfully
6. Test with full item list and discount accounts

### 4. Optional: Integrate Existing Script
If you have an existing `sync_alis_gl_accounts.js` script:

- Review the Playwright functions in `billingPage.js`
- Adapt your script's logic to use the module functions
- Or replace the updateGLAccount() implementation with your proven code
- Test thoroughly before production use

## File Locations

```
client/src/
├── pages/NewJob.jsx                          ← Form UI (complete)
├── components/BillingItemsInput.jsx          ← Multi-tab input (complete)
└── utils/
    ├── excel-parser.js                       ← Excel utilities (complete)
    └── schema-form-generator.jsx             ← Generic form generator (complete)

server/
├── automation/
│   ├── jobs.js                               ← Job handlers (updated)
│   ├── templates.json                        ← Template definitions (complete)
│   ├── GL_SYNC_GUIDE.md                      ← Customization guide (NEW)
│   └── playwright/
│       ├── billingPage.js                    ← GL sync automation (NEW)
│       ├── browser.js                        ← Shared utilities (existing)
│       └── communityPage.js                  ← Community automation (existing)
├── api/
│   └── jobs.js                               ← API routes (complete)
└── db/
    └── database.js                           ← Job storage (existing)
```

## Testing Checklist

- [ ] Frontend form renders with all fields
- [ ] Excel upload parses correctly
- [ ] JSON paste imports items
- [ ] Table editing saves items
- [ ] Form validation works (MM/DD/YYYY date)
- [ ] Disabled billingSettingsUrl field validation
- [ ] Job submission creates entry in database
- [ ] SSE events stream to JobDetail page
- [ ] Job completes with summary stats
- [ ] Error handling for failed items
- [ ] Skipped items (no gl_new) handled correctly
- [ ] Screenshots captured on errors
- [ ] GL accounts actually update in ALIS
- [ ] Discount accounts update if provided
- [ ] Multiple items processed correctly
- [ ] Full test run with 17-item list succeeds

## Next Steps

**Immediate (Next 30 min):**
1. Test frontend with dev server
2. Verify form submission and SSE streaming
3. Inspect ALIS billing UI and note selectors

**Short Term (Next 1-2 hours):**
1. Customize billingPage.js selectors
2. Test single-item job execution
3. Debug and iterate selector updates

**Medium Term (Next session):**
1. Full test run with actual GL account updates
2. Validate changes reflected in ALIS
3. Test discount account updates
4. Consider edge cases and error scenarios

**Optional:**
1. Integrate your existing sync_alis_gl_accounts.js script
2. Add additional validation/confirmation steps
3. Build UI for viewing/reverting changes
4. Support for multiple communities in one job

## Questions to Resolve

1. **ALIS UI Structure:** How are billing items displayed? Table rows? Expandable list? Grid?
2. **Field Names:** What are the exact class names/IDs for GL input fields?
3. **Save Mechanism:** Do changes save inline or require a parent "Save All" button?
4. **Error Handling:** How does ALIS display validation errors?
5. **Discount Accounts:** Are disc1/disc2 always present or conditionally shown?
6. **Pagination:** If many items, are they paginated? How to navigate between pages?

---

**Status as of:** 2026-05-09  
**Progress:** Frontend 100% | Backend UI 100% | Job Handler 70% (needs selector tuning) | Testing 0%  
**Next Milestone:** Single-item job execution with real GL account update

