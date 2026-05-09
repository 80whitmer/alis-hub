# Job Naming Enhancement - Company Name Integration

## Overview
Jobs are now automatically labeled with the company/community name extracted from the target URL, making it easier to identify which company each job is for at a glance.

## How It Works

### URL Parsing
The system extracts the company name from the subdomain of the target URL:

**Example:**
```
URL: https://surpass.alisonline.com/Settings/Billing/1069?tab=private
Extracted: "Surpass"
Result: "Sync GL Accounts - Surpass"
```

**Another Example:**
```
URL: https://mycompany.alisonline.com/...
Extracted: "MyCompany" → "Mycompany" (lowercase rest)
Result: "Create Communities - Mycompany"
```

### Extraction Logic
1. Parse the URL to get the hostname
2. Extract the subdomain (first part before the first dot)
3. Capitalize the first letter
4. Append to the job label with " - " separator

### Supported URLs
- ✅ `https://company.alisonline.com/Settings/Billing/ID?tab=private`
- ✅ `https://company.alisonline.com/...`
- ✅ Any URL where the company name is the first part of the hostname

## Job Types Affected

### Sync GL Accounts
**Uses:** `billingSettingsUrl` from payload

**Before:**
```
Sync GL Accounts
```

**After:**
```
Sync GL Accounts - Surpass
```

### Create Communities
**Uses:** `companyUrl` from payload

**Before:**
```
Create 5 communities
```

**After:**
```
Create 5 communities - Mycompany
```

## Implementation Details

### New Helper Functions

#### `extractCompanyNameFromUrl(url)`
Extracts company name from a URL

**Input:** `"https://surpass.alisonline.com/Settings/Billing/1069?tab=private"`
**Output:** `"Surpass"`

**Behavior:**
- Returns `null` if URL is invalid
- Returns `null` if URL format is unexpected
- Capitalizes first letter of subdomain
- Handles malformed URLs gracefully

#### `enhanceLabelWithCompanyName(label, payload)`
Adds company name to job label if available

**Input:** 
```javascript
label: "Sync GL Accounts"
payload: { billingSettingsUrl: "https://surpass.alisonline.com/..." }
```

**Output:** `"Sync GL Accounts - Surpass"`

**Behavior:**
- Checks `billingSettingsUrl` first (sync jobs)
- Falls back to `companyUrl` (create communities)
- Returns original label if no URL found
- Doesn't duplicate if company name already in label

## API Endpoints Updated

### POST /api/jobs/create
- Now automatically appends company name
- Works for any template type
- Checks both `billingSettingsUrl` and `companyUrl` in payload

### POST /api/jobs/create-communities (Legacy)
- Now automatically appends company name
- Extracts from `companyUrl` parameter

## Dashboard Display

### Job Card Example

**Completed Job (Surpass):**
```
┌──────────────────────────────────────────────────┐
│ Sync GL Accounts - Surpass   [Completed] Delete  │
│ 5/9/2026, 6:33:21 PM                            │
│ ████████████████████████ 100%                   │
│ 17 completed                                100% │
└──────────────────────────────────────────────────┘
```

**Running Job (MyCompany):**
```
┌──────────────────────────────────────────────────┐
│ Create Communities - Mycompany [Running]  Cancel │
│ 5/9/2026, 6:45:30 PM                            │
│ ████████░░░░░░░░░░░░░░░░░░░░ 45%               │
│ 9/20 completed                              45% │
└──────────────────────────────────────────────────┘
```

## Example Scenarios

### Scenario 1: GL Account Sync
```
Input to API:
{
  templateId: "sync-gl-accounts",
  label: "Sync GL Accounts",
  payload: {
    communityName: "Tarina of Stockton",
    billingSettingsUrl: "https://tarina.alisonline.com/Settings/Billing/1069",
    syncDate: "2026-05-09",
    items: [...]
  }
}

Result in Dashboard:
"Sync GL Accounts - Tarina"
```

### Scenario 2: Community Creation
```
Input to API:
{
  templateId: "create-communities",
  label: "New Community Setup",
  payload: {
    companyUrl: "https://acme.alisonline.com/",
    communities: [...]
  }
}

Result in Dashboard:
"New Community Setup - Acme"
```

### Scenario 3: Custom Label
```
Input to API:
{
  templateId: "sync-gl-accounts",
  label: "Q2 GL Migration - Surpass",
  payload: {
    billingSettingsUrl: "https://surpass.alisonline.com/...",
    ...
  }
}

Result in Dashboard:
"Q2 GL Migration - Surpass"
(No duplicate appending - company name already present)
```

## Error Handling

### Invalid URLs
If the URL cannot be parsed, the original label is returned:

```javascript
// Invalid URL
payload: { billingSettingsUrl: "not-a-valid-url" }
Result: "Sync GL Accounts" (no change)
```

### Missing URLs
If no URL is found in the payload, the original label is returned:

```javascript
payload: { /* no URL field */ }
Result: "Sync GL Accounts" (no change)
```

### Duplicate Prevention
If the company name is already in the label, it's not appended again:

```javascript
label: "Sync GL Accounts - Surpass"
payload: { billingSettingsUrl: "https://surpass.alisonline.com/..." }
Result: "Sync GL Accounts - Surpass" (no duplicate)
```

## Files Modified

### server/api/jobs.js
- Added `extractCompanyNameFromUrl(url)` helper function
- Added `enhanceLabelWithCompanyName(label, payload)` helper function
- Updated `POST /api/jobs/create` endpoint to use enhanced labels
- Updated `POST /api/jobs/create-communities` endpoint to use enhanced labels

## Benefits

✅ **Better Organization**
- Jobs are grouped by company visually in the dashboard
- Easier to identify which company each job is for

✅ **Reduced Confusion**
- No more guessing which community/company a job is syncing
- Company name is visible without clicking the job

✅ **Improved Accountability**
- Clear which company owns each job
- Easier to track jobs per company

✅ **Backward Compatible**
- Existing jobs still work
- New jobs automatically get company names
- Manual labels are respected (no duplication)

## Testing

### Test Cases

**Test 1: GL Sync Job**
```
URL: https://surpass.alisonline.com/Settings/Billing/1069?tab=private
Expected: "Sync GL Accounts - Surpass"
```

**Test 2: Community Creation**
```
URL: https://mycompany.alisonline.com/
Expected: "Create Communities - Mycompany"
```

**Test 3: Already Has Company Name**
```
Label: "Q2 Migration - Surpass"
URL: https://surpass.alisonline.com/...
Expected: "Q2 Migration - Surpass" (no duplicate)
```

**Test 4: Invalid URL**
```
URL: "invalid-url-format"
Expected: "Sync GL Accounts" (original label)
```

**Test 5: Missing URL**
```
Payload: { items: [...] }
Expected: "Sync GL Accounts" (original label)
```

## Future Enhancements

- [ ] Store company name separately for easier filtering
- [ ] Add company name as a searchable field
- [ ] Group jobs by company on the dashboard
- [ ] Add company name as a badge next to status
- [ ] Allow custom company display names
- [ ] Show company logo/icon if available

## Troubleshooting

### Job label doesn't show company name
1. Check that the URL is valid and matches the pattern
2. Verify the URL starts with the company subdomain
3. Check browser console for any errors
4. Refresh the page to see the updated label

### Company name is incorrect
1. Verify the URL being used
2. Check that subdomain is correct
3. Review the extraction logic (first part before first dot)
4. Check if there's a typo in the URL

### Duplicate company names
This shouldn't happen due to duplicate prevention, but if it does:
1. Check that the label doesn't already contain the company name
2. Verify the extraction logic is working correctly
3. Clear cache and refresh the page
