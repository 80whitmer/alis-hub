# GL Sync Logging Integration Guide

## Quick Start

To enable GL sync detail logging in your GL account sync job processor:

### 1. Import the Function

In your GL sync processor file (e.g., `server/automation/playwright/billingPage.js` or wherever you handle GL syncs):

```javascript
const { addGLSyncDetail } = require('../../db/database');
```

### 2. Log Each Account Sync

After processing each GL account, add a log entry:

```javascript
// Successful sync
addGLSyncDetail(jobId, {
  accountNumber: '1000',
  accountName: 'Checking Account',
  oldValue: '2100',
  newValue: '2200',
  fieldChanged: 'GL Account Code',
  status: 'success',
  error: null
});

// Failed sync
addGLSyncDetail(jobId, {
  accountNumber: '1001',
  accountName: 'Savings Account',
  oldValue: null,
  newValue: null,
  fieldChanged: 'GL Account Code',
  status: 'failed',
  error: 'Timeout connecting to GL system'
});
```

### 3. What to Log

Log these fields for each account:

| Field | Type | Example | Required |
|-------|------|---------|----------|
| `accountNumber` | string | "1000" | Yes |
| `accountName` | string | "Checking" | Yes |
| `oldValue` | string | "2100" | For success only |
| `newValue` | string | "2200" | For success only |
| `fieldChanged` | string | "GL Account Code" | Yes |
| `status` | "success" or "failed" | "success" | Yes |
| `error` | string | "Connection timeout" | If status is "failed" |

## Example Integration

### Before (No Logging)

```javascript
async function syncGLAccounts(items, jobId) {
  for (const account of items) {
    try {
      const newCode = generateNewGLCode(account);
      await updateAccountGLCode(account, newCode);
      console.log(`✓ Updated ${account.name} to ${newCode}`);
    } catch (err) {
      console.error(`✗ Failed to update ${account.name}: ${err.message}`);
    }
  }
}
```

### After (With Logging)

```javascript
const { addGLSyncDetail } = require('../../db/database');

async function syncGLAccounts(items, jobId) {
  for (const account of items) {
    try {
      const oldCode = account.currentGLCode; // Capture before
      const newCode = generateNewGLCode(account);
      await updateAccountGLCode(account, newCode);
      
      // Log the successful sync
      addGLSyncDetail(jobId, {
        accountNumber: account.id,
        accountName: account.name,
        oldValue: oldCode,
        newValue: newCode,
        fieldChanged: 'GL Account Code',
        status: 'success',
        error: null
      });
      
      console.log(`✓ Updated ${account.name} from ${oldCode} to ${newCode}`);
    } catch (err) {
      // Log the failed sync
      addGLSyncDetail(jobId, {
        accountNumber: account.id,
        accountName: account.name,
        oldValue: null,
        newValue: null,
        fieldChanged: 'GL Account Code',
        status: 'failed',
        error: err.message
      });
      
      console.error(`✗ Failed to update ${account.name}: ${err.message}`);
    }
  }
}
```

## Real-World Example

Here's how it might look in `billingPage.js`:

```javascript
async function processGLSync(page, items, jobId) {
  const { addGLSyncDetail } = require('../../db/database');
  
  for (const item of items) {
    try {
      // Navigate to account
      await page.goto(`${item.url}`);
      
      // Get current GL code
      const oldGLCode = await page.evaluate(() => {
        return document.querySelector('#CurrentGLCode')?.value;
      });
      
      // Update GL code
      const newGLCode = item.newGLCode;
      await page.fill('#CurrentGLCode', newGLCode);
      await page.click('button[type="submit"]');
      
      // Wait for save to complete
      await page.waitForNavigation();
      
      // Log success
      addGLSyncDetail(jobId, {
        accountNumber: item.accountId,
        accountName: item.accountName,
        oldValue: oldGLCode,
        newValue: newGLCode,
        fieldChanged: 'GL Account Code',
        status: 'success',
        error: null
      });
      
      console.log(`✓ GL Sync: ${item.accountName} updated to ${newGLCode}`);
      
    } catch (error) {
      // Log failure
      addGLSyncDetail(jobId, {
        accountNumber: item.accountId,
        accountName: item.accountName,
        oldValue: null,
        newValue: null,
        fieldChanged: 'GL Account Code',
        status: 'failed',
        error: error.message
      });
      
      console.error(`✗ GL Sync failed for ${item.accountName}: ${error.message}`);
    }
  }
}
```

## Testing the Integration

### Manual Test

1. Create a test GL sync job
2. Run the job
3. Navigate to the job detail page
4. Scroll down to find "GL Account Sync Details" section
5. Click to expand and verify entries are showing
6. Click "📥 Export CSV" to download

### Database Verification

Check if logs were recorded:

```sql
SELECT * FROM gl_sync_details WHERE job_id = 'your-job-id' ORDER BY synced_at DESC;
```

Expected output:
```
id | job_id | account_number | account_name | old_value | new_value | field_changed | status  | error | synced_at
1  | xyz123 | 1000           | Checking     | 2100      | 2200      | GL Account... | success |       | 2026-05-09...
2  | xyz123 | 1001           | Savings      | 2100      | 2200      | GL Account... | success |       | 2026-05-09...
```

### API Verification

Test the endpoint:

```bash
curl http://localhost:3000/api/jobs/your-job-id/gl-details | json_pp
```

Should return:
```json
{
  "jobId": "your-job-id",
  "details": [
    {
      "id": 1,
      "job_id": "your-job-id",
      "account_number": "1000",
      "account_name": "Checking",
      "old_value": "2100",
      "new_value": "2200",
      "field_changed": "GL Account Code",
      "status": "success",
      "error": null,
      "synced_at": "2026-05-09T18:54:53.000Z"
    }
  ]
}
```

## Logging Strategy

### What to Log for Each Account Sync

**Required Information:**
- Account ID/Number - Identifies which account was synced
- Account Name - Human-readable account name
- Field Changed - What was modified (e.g., "GL Account Code", "Account Status")
- Status - "success" or "failed"

**For Success:**
- Old Value - What it was before
- New Value - What it is now

**For Failure:**
- Error Message - Why it failed

### Multiple Field Changes

If you're updating multiple fields on the same account, log each separately:

```javascript
// Updating GL code AND account status
addGLSyncDetail(jobId, {
  accountNumber: '1000',
  accountName: 'Checking',
  oldValue: '2100',
  newValue: '2200',
  fieldChanged: 'GL Account Code',
  status: 'success',
  error: null
});

addGLSyncDetail(jobId, {
  accountNumber: '1000',
  accountName: 'Checking',
  oldValue: 'Active',
  newValue: 'Inactive',
  fieldChanged: 'Account Status',
  status: 'success',
  error: null
});
```

## Frontend Display

Once logging is integrated and working, the JobDetail page will show:

```
▼ GL Account Sync Details
  └─ 5 account updates recorded    [📥 Export CSV]
  
  ┌────────────────────────────────────────────────────────┐
  │ Account # │ Account Name │ GL Code │ Status │ Time     │
  ├────────────────────────────────────────────────────────┤
  │ 1000       │ Checking     │ 2100→   │ ✓      │ 01:54 CDT│
  │            │              │ 2200    │        │          │
  │ 1001       │ Savings      │ 2100→   │ ✓      │ 01:55 CDT│
  │            │              │ 2200    │        │          │
  │ 1002       │ Money Market │ -       │ ✗      │ 01:56 CDT│
  │            │              │ -       │        │          │
  └────────────────────────────────────────────────────────┘
```

Click "📥 Export CSV" to download a spreadsheet with all account updates.

## Common Mistakes to Avoid

### ❌ DON'T: Forget to import
```javascript
// Wrong - function not available
addGLSyncDetail(jobId, {...});
```

### ✅ DO: Import first
```javascript
const { addGLSyncDetail } = require('../../db/database');
addGLSyncDetail(jobId, {...});
```

### ❌ DON'T: Log outside the loop
```javascript
for (const account of accounts) {
  // Process account
}
// Only logs last account!
addGLSyncDetail(jobId, {...});
```

### ✅ DO: Log inside the loop
```javascript
for (const account of accounts) {
  // Process account
  addGLSyncDetail(jobId, {...}); // Logs every account
}
```

### ❌ DON'T: Include null values for success
```javascript
// Wrong
addGLSyncDetail(jobId, {
  ...,
  oldValue: null,    // Should have value for success
  newValue: '2200',
  status: 'success'
});
```

### ✅ DO: Include old/new values for success
```javascript
// Correct
addGLSyncDetail(jobId, {
  ...,
  oldValue: '2100',  // Has value
  newValue: '2200',
  status: 'success'
});
```

## Support

For issues or questions:

1. Check `TIMEZONE_AND_GL_LOGS_IMPLEMENTATION.md` for detailed docs
2. Verify the import statement is correct
3. Check browser console (F12) for errors
4. Check server logs for database errors
5. Verify database table exists: `SELECT * FROM gl_sync_details LIMIT 1;`

