# Timezone & GL Account Sync Logs Implementation

## Overview

Three major enhancements have been implemented:

1. **Timezone Conversion** - All timestamps display in Central Time (user's local timezone)
2. **GL Sync Detail Logs** - Track detailed account-level changes during GL account syncs
3. **Accordion UI + CSV Export** - Expandable details section with export functionality

---

## 1. Timezone Implementation

### What Changed

All timestamps throughout the application now display in **Central Standard Time (CST) / Central Daylight Time (CDT)** based on the user's system timezone.

**Before:**
```
2026-05-09T18:54:53.000Z  (UTC, hard to read)
```

**After:**
```
05/09/2026 01:54:53 PM CDT  (Local time, clear timezone indicator)
```

### Utility Functions

**File:** `client/src/utils/timezone.js`

```javascript
// Full datetime with timezone
formatLocalTime("2026-05-09T18:54:53Z")
// Returns: "05/09/2026 01:54:53 PM CDT"

// Date only
formatLocalDate("2026-05-09T18:54:53Z")
// Returns: "05/09/2026"

// Time only
formatLocalTimeOnly("2026-05-09T18:54:53Z")
// Returns: "01:54:53 PM CDT"

// Get user's timezone
getUserTimezone()     // Returns: "CDT" or "CST"
getUserTimezoneFull() // Returns: "Central Daylight Time"

// Calculate duration
formatDuration(startTime, endTime)
// Returns: "2d 3h 15m"
```

### Usage in Components

```javascript
import { formatLocalTime, formatLocalDate } from '../utils/timezone';

// In JSX:
<p>{formatLocalTime(job.created_at)}</p>
<p>Created: {formatLocalDate(job.created_at)}</p>
```

### Affected Areas

- Job creation time
- Job timestamps in lists
- GL sync timestamps in detail tables
- All live event timestamps

---

## 2. GL Sync Detail Logs

### Database Schema

**New Table:** `gl_sync_details`

```sql
CREATE TABLE gl_sync_details (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         TEXT NOT NULL,
  account_number TEXT,
  account_name   TEXT,
  old_value      TEXT,
  new_value      TEXT,
  field_changed  TEXT,
  status         TEXT DEFAULT 'success',
  error          TEXT,
  synced_at      TEXT DEFAULT (datetime('now'))
);
```

### Database Functions

**File:** `server/db/database.js`

```javascript
// Add a GL sync detail record
addGLSyncDetail(jobId, {
  accountNumber: '1000',
  accountName: 'Checking',
  oldValue: '1001',
  newValue: '1002',
  fieldChanged: 'GL Account Number',
  status: 'success',
  error: null
});

// Retrieve all GL sync details for a job
getGLSyncDetails(jobId);
// Returns: Array of detail objects
```

### API Endpoint

**Endpoint:** `GET /api/jobs/:id/gl-details`

**Request:**
```bash
GET /api/jobs/abc123xyz/gl-details
```

**Response:**
```json
{
  "jobId": "abc123xyz",
  "details": [
    {
      "id": 1,
      "job_id": "abc123xyz",
      "account_number": "1000",
      "account_name": "Checking",
      "old_value": "1001",
      "new_value": "1002",
      "field_changed": "GL Account Number",
      "status": "success",
      "error": null,
      "synced_at": "2026-05-09T18:54:53.000Z"
    }
  ]
}
```

### Job Processor Integration

To record GL sync details, update your `billingPage.js` or GL sync processor:

```javascript
const { addGLSyncDetail } = require('../db/database');

// After successfully syncing an account:
addGLSyncDetail(jobId, {
  accountNumber: account.number,
  accountName: account.name,
  oldValue: oldGLCode,
  newValue: newGLCode,
  fieldChanged: 'GL Account Code',
  status: 'success',
  error: null
});

// If there's an error:
addGLSyncDetail(jobId, {
  accountNumber: account.number,
  accountName: account.name,
  oldValue: null,
  newValue: null,
  fieldChanged: 'GL Account Code',
  status: 'failed',
  error: 'Failed to update account: ' + errorMessage
});
```

### What Gets Recorded

For each GL account sync, the system can log:
- **Account Number** - The account ID being synced (e.g., "1000")
- **Account Name** - Human-readable name (e.g., "Checking")
- **Field Changed** - What field was modified (e.g., "GL Account Code")
- **Old Value** - Previous value (e.g., "1001")
- **New Value** - Updated value (e.g., "1002")
- **Status** - "success" or "failed"
- **Error** - Error message if status is "failed"
- **Synced At** - Timestamp when the sync occurred (in UTC, displayed in local time)

---

## 3. Accordion UI & CSV Export

### Frontend Components

**File:** `client/src/pages/JobDetail.jsx`

#### New State Variables
```javascript
const [glDetails, setGlDetails] = useState([]);      // Array of GL sync details
const [showGlDetails, setShowGlDetails] = useState(false); // Accordion open/closed
const [isExporting, setIsExporting] = useState(false);     // Export button loading state
```

#### New Handler Function
```javascript
async function handleExportGLDetails() {
  // Generates CSV, triggers download
}
```

#### UI Layout

The GL Sync Details section appears as:

1. **Collapsed State:**
   ```
   ▶ GL Account Sync Details
     └─ 42 account updates recorded      [📥 Export CSV]
   ```

2. **Expanded State:**
   ```
   ▼ GL Account Sync Details
     └─ 42 account updates recorded      [📥 Export CSV]
     
     ┌─ Account # │ Account Name │ Field Changed │ Old Value │ New Value │ Status │ Synced At ─┐
     ├─ 1000      │ Checking     │ GL Code       │ 2100      │ 2200      │ ✓      │ 01:54 CDT ─┤
     ├─ 1001      │ Savings      │ GL Code       │ 2100      │ 2200      │ ✓      │ 01:55 CDT ─┤
     ├─ 1002      │ Money Mkt    │ GL Code       │ Failed to update        │ ✕      │ 01:56 CDT ─┤
     └────────────────────────────────────────────────────────────────────────────────────────┘
   ```

### CSV Export

**File:** `client/src/utils/csvExport.js`

#### Export Features

- **Filename:** `gl-sync-[label]-YYYY-MM-DD-HH-MM-SS.csv`
- **Header Row:** Column names
- **Data Rows:** One row per account sync detail
- **Special Characters:** Properly escaped (commas, quotes, newlines)
- **Timestamps:** Converted to local timezone

#### Export Function
```javascript
import { generateGLSyncCSV, downloadCSV, generateFilename } from '../utils/csvExport';

// Generate CSV content
const csvContent = generateGLSyncCSV(jobId, jobLabel, glDetails);

// Generate filename with timestamp
const filename = generateFilename('gl-sync-Surpass');

// Trigger browser download
downloadCSV(csvContent, filename);
```

#### CSV Output Example

```
GL Sync Details - Sync GL Accounts - Surpass (Job: abc123xyz)
Exported: 05/09/2026 02:15:30 PM CDT

Account Number,Account Name,Field Changed,Old Value,New Value,Status,Error,Synced At
1000,Checking,GL Account Code,2100,2200,success,,05/09/2026 01:54:53 PM CDT
1001,Savings,GL Account Code,2100,2200,success,,05/09/2026 01:55:14 PM CDT
1002,Money Market,GL Account Code,2100,2200,failed,"Connection timeout",05/09/2026 01:56:02 PM CDT
```

### How It Works

1. **Load:** When JobDetail loads a GL sync job, it fetches `/api/jobs/:id/gl-details`
2. **Display:** If details exist, an accordion section appears below the job log
3. **Interact:** Click the accordion header to expand/collapse the table
4. **Export:** Click "📥 Export CSV" to download a CSV file with all account updates

---

## Files Modified/Created

### Backend

- ✅ **server/db/database.js**
  - Added `gl_sync_details` table
  - Added `addGLSyncDetail()` function
  - Added `getGLSyncDetails()` function

- ✅ **server/api/jobs.js**
  - Added `GET /api/jobs/:id/gl-details` endpoint

### Frontend

- ✅ **client/src/utils/timezone.js** (NEW)
  - Timezone conversion utilities
  - Functions for formatting dates/times

- ✅ **client/src/utils/csvExport.js** (NEW)
  - CSV generation and export utilities

- ✅ **client/src/pages/JobDetail.jsx**
  - Imported timezone utilities
  - Imported CSV export utilities
  - Added GL details state and accordion UI
  - Updated all timestamps to use local timezone
  - Added export button and handler

---

## Testing Checklist

### Timezone

- [ ] Open JobDetail for any job
- [ ] Verify timestamps show local timezone (CDT or CST)
- [ ] Verify timezone indicator appears (CDT, CST, etc.)
- [ ] Verify date format is MM/DD/YYYY
- [ ] Verify time format is HH:MM:SS AM/PM

### GL Sync Details

- [ ] Create or view a GL sync job
- [ ] Verify GL Sync Details section appears (if details recorded)
- [ ] Verify accordion header shows count of updates
- [ ] Click accordion to expand/collapse
- [ ] Verify all columns display correctly
- [ ] Verify status badges show green (success) or red (failed)
- [ ] Verify timestamps show in local timezone

### CSV Export

- [ ] Click "📥 Export CSV" button
- [ ] Verify file downloads
- [ ] Verify filename format: `gl-sync-[label]-YYYY-MM-DD-HH-MM-SS.csv`
- [ ] Open CSV in Excel or text editor
- [ ] Verify all account records present
- [ ] Verify old/new values preserved correctly
- [ ] Verify errors displayed for failed syncs
- [ ] Verify timestamps converted to local time

---

## Deployment Steps

1. **Backup database**
   ```bash
   cp server/db/alis-hub.sqlite server/db/alis-hub.sqlite.backup
   ```

2. **Update backend files**
   - Copy modified `server/db/database.js`
   - Copy modified `server/api/jobs.js`

3. **Create new utility files**
   - Create `client/src/utils/timezone.js`
   - Create `client/src/utils/csvExport.js`

4. **Update frontend component**
   - Copy modified `client/src/pages/JobDetail.jsx`

5. **Restart services**
   - Restart backend server (auto-creates table)
   - Rebuild frontend
   - Clear browser cache

6. **Test features** (see checklist above)

---

## Integration with GL Sync Processor

### Update Your GL Sync Job Processor

In `server/automation/playwright/billingPage.js` or wherever you process GL syncs:

```javascript
const { addGLSyncDetail } = require('../db/database');

// After processing each account:
try {
  const oldValue = getCurrentGLCode(account);
  await updateGLCode(account, newValue);
  
  addGLSyncDetail(jobId, {
    accountNumber: account.id,
    accountName: account.name,
    oldValue: oldValue,
    newValue: newValue,
    fieldChanged: 'GL Account Code',
    status: 'success',
    error: null
  });
} catch (error) {
  addGLSyncDetail(jobId, {
    accountNumber: account.id,
    accountName: account.name,
    oldValue: null,
    newValue: null,
    fieldChanged: 'GL Account Code',
    status: 'failed',
    error: error.message
  });
}
```

---

## Timezone Behavior

### Automatic Detection

- Uses browser's system timezone
- No manual configuration needed
- Automatically adjusts for DST (CDT in summer, CST in winter)

### Supported Timezones

While built for Central Time, the utilities work with any timezone:
- **CST** (Central Standard Time) - Winter, UTC-6
- **CDT** (Central Daylight Time) - Summer, UTC-5
- Other timezones display correctly based on system settings

### Backend Storage

- All times stored as UTC in database
- No timezone info stored with timestamps
- Frontend handles all timezone conversion

---

## CSV Format Details

### Special Character Handling

Commas, quotes, and newlines in values are properly escaped:

```csv
"Account Name with, Comma",
"Error message: ""Connection failed""",
"Multi-line error
goes here",
```

### Column Order (in CSV)

1. Account Number
2. Account Name
3. Field Changed
4. Old Value
5. New Value
6. Status
7. Error
8. Synced At

### Header Rows

- Job info: `GL Sync Details - [Job Label] (Job: [ID])`
- Export timestamp: `Exported: [Local DateTime]`
- Blank row before column headers
- Column headers with descriptive names

---

## Future Enhancements

1. **Filtering** - Filter details by status (success/failed)
2. **Sorting** - Click column headers to sort
3. **Search** - Search within GL details
4. **Additional Formats** - Support JSON export, PDF report
5. **Automatic Archival** - Auto-delete old detail records
6. **Bulk Actions** - Re-sync failed accounts
7. **Comparison** - Compare GL codes between runs

---

## Troubleshooting

### GL Details Section Not Showing

**Symptom:** No "GL Account Sync Details" section on job detail page

**Causes:**
1. Job type is not `sync-gl-accounts`
2. No details recorded (processor didn't log them)
3. API endpoint not responding

**Solution:**
- Verify job type in database: `SELECT type FROM jobs WHERE id = 'xxx'`
- Check API: `curl http://localhost:3000/api/jobs/xxx/gl-details`
- Verify processor calls `addGLSyncDetail()`

### Wrong Timezone Displayed

**Symptom:** Times show UTC or wrong timezone

**Causes:**
1. Browser timezone settings wrong
2. System clock not set correctly
3. JavaScript timezone detection issue

**Solution:**
- Check Windows timezone: `Settings > Time & Language > Date & time`
- Verify system time is correct
- Clear browser cache and refresh

### CSV Download Fails

**Symptom:** Export button doesn't download file

**Causes:**
1. Pop-up blocker preventing download
2. Browser restriction on programmatic downloads
3. JavaScript error in export handler

**Solution:**
- Check browser pop-up blocker settings
- Try different browser
- Open browser console (F12) and check for errors
- Try manually copying table to Excel

### Timestamps Not Updating

**Symptom:** New jobs show old times or no time

**Causes:**
1. Database timezone field missing
2. Processor not setting timestamp
3. Display code not loading

**Solution:**
- Clear browser cache
- Restart backend server
- Verify `synced_at` field populated in database

---

## Notes

- All user-facing timestamps are in local timezone (CDT/CST)
- All database timestamps remain in UTC (no change to storage)
- Timezone conversion happens on frontend (no server calls needed)
- CSV export converts times to local timezone for readability
- Old jobs will show times in UTC from before implementation (this is normal)

