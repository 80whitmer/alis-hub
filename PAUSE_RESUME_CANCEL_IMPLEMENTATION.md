# Pause, Resume, and Cancel Job Control - Implementation Guide

## Overview

Your ALIS Hub now supports pausing, resuming, and cancelling jobs. These features allow you to:
- **Pause** a running job to freeze progress
- **Resume** a paused job to continue processing
- **Cancel** a job to stop it entirely and mark it as failed

## Backend Integration

### Database Updates

**File:** `server/db/database.js`

Two new functions have been added:

```javascript
function pauseJob(id) {
  // Mark job as paused
  run(`UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?`, [id]);
}

function resumeJob(id) {
  // Mark job as running (resume from pause)
  run(`UPDATE jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`, [id]);
}
```

### API Endpoints

**File:** `server/api/jobs.js`

Three new endpoints have been added:

#### POST /api/jobs/:id/pause
Pauses a running job
- **Status Required:** `running`
- **Response:** `{ success: true, message: 'Job paused' }`

#### POST /api/jobs/:id/resume
Resumes a paused job
- **Status Required:** `paused`
- **Response:** `{ success: true, message: 'Job resumed' }`

#### POST /api/jobs/:id/cancel
Cancels a running, queued, or paused job
- **Status Required:** `running`, `queued`, or `paused`
- **Response:** `{ success: true, message: 'Job cancelled' }`

### Updated Cancel Logic

The existing cancel endpoint has been updated to also support cancelling paused jobs:

```javascript
if (job.status !== 'running' && job.status !== 'queued' && job.status !== 'paused') {
  return res.status(400).json({ error: 'Can only cancel running, queued, or paused jobs' });
}
```

## Frontend Updates

### JobDetail Component

**File:** `client/src/pages/JobDetail.jsx`

#### New State Variables
```javascript
const [isCancelling, setIsCancelling] = useState(false);
const [isPausing, setIsPausing] = useState(false);
```

#### New Handler Functions
- `handlePause()` - Sends pause request to API
- `handleResume()` - Sends resume request to API
- `handleCancel()` - Sends cancel request to API with confirmation

#### Updated Status Configuration
```javascript
const JOB_STATUS_CONFIG = {
  queued:  { badge: 'badge-neutral', text: 'Queued' },
  running: { badge: 'badge-warning', text: 'Running' },
  paused:  { badge: 'badge-info', text: 'Paused' },      // NEW
  done:    { badge: 'badge-success', text: 'Completed' },
  failed:  { badge: 'badge-error', text: 'Failed' },
};
```

#### UI Buttons
Added three control buttons that appear conditionally:

1. **Pause/Resume Button** - Shows when job is `running` or `paused`
   - Shows "⏸ Pause" when running
   - Shows "▶ Resume" when paused
   - Yellow background when pausing/resuming

2. **Cancel Button** - Shows when job is `running`, `queued`, or `paused`
   - Shows confirmation dialog before cancelling
   - Red background with "✕ Cancel" text
   - Shows "⏳" while cancelling

## How It Works

### Pausing a Job

1. User clicks "⏸ Pause" button on a running job
2. Frontend sends `POST /api/jobs/:id/pause`
3. Backend updates job status to `paused` in database
4. Frontend updates UI to show "Paused" badge and changes button to "▶ Resume"
5. Job processor continues running but doesn't process new items (requires implementation)

**Note:** The backend database update happens immediately. Job processors need to check for pause status between items. See the "Job Processor Integration" section below.

### Resuming a Job

1. User clicks "▶ Resume" button on a paused job
2. Frontend sends `POST /api/jobs/:id/resume`
3. Backend updates job status back to `running` in database
4. Frontend updates UI to show "Running" badge and changes button back to "⏸ Pause"
5. Job processor resumes processing items

### Cancelling a Job

1. User clicks "✕ Cancel" button (shows confirmation dialog first)
2. Frontend sends `POST /api/jobs/:id/cancel`
3. Backend:
   - Updates job status to `failed`
   - Marks any running items as failed with "Cancelled by user" error
   - Cleans up any job state
4. Frontend updates UI to show "Failed" badge and hides action buttons
5. No further items are processed

## Job Processor Integration

To make pause/resume truly functional, your job processors (in `server/automation/jobs.js`) need to check the job status between items.

### Example Integration

```javascript
async function processGLSyncJob(job, io) {
  const { getJob } = require('../db/database');
  
  const items = JSON.parse(job.payload);
  
  for (const item of items) {
    // Check pause status before processing
    const currentJob = getJob(job.id);
    
    if (currentJob.status === 'paused') {
      // Wait while paused (you might use a longer timeout for production)
      while (currentJob.status === 'paused') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        currentJob = getJob(job.id); // Refresh status
      }
    }
    
    if (currentJob.status === 'failed') {
      // Job was cancelled, stop processing
      return;
    }

    // Process item normally
    await syncGLRecords(item);
  }
}
```

## Database Schema

No schema changes were required. The existing `status` field supports the new values:
- `queued` - Job waiting to start
- `running` - Job actively processing
- `paused` - Job paused by user (NEW)
- `done` - Job completed successfully
- `failed` - Job failed or was cancelled

## Duplicate Log Fix

When implementing pause/resume support, be aware of the duplicate "Starting:" logs issue documented in `DUPLICATE-LOG-FIX.md`. Ensure you're only emitting the progress event once per item, not in both the main loop AND inside the processor function.

## Testing Checklist

- [ ] Pause a running job
- [ ] Verify job status changes to "Paused"
- [ ] Verify pause button changes to "Resume"
- [ ] Resume a paused job
- [ ] Verify job status changes back to "Running"
- [ ] Cancel a running job (with confirmation)
- [ ] Verify job status changes to "Failed"
- [ ] Verify cancel button disappears after cancellation
- [ ] Cancel a paused job
- [ ] Cancel a queued job
- [ ] Verify error on pause when job is not running
- [ ] Verify error on resume when job is not paused

## Troubleshooting

### Pause Button Doesn't Appear
- Job must be in `running` status
- Check browser console for API errors
- Verify `/api/jobs/:id/pause` endpoint exists

### Resume Button Doesn't Work
- Job must be in `paused` status (not "Paused" text, actual `paused` status)
- Check browser console for API errors
- Verify job status in database: `SELECT status FROM jobs WHERE id = 'xxx'`

### Job Continues Processing While Paused
- Job processor function needs to check pause status (see "Job Processor Integration" above)
- Current implementation only updates database status; processors must respect it

### Cancel Doesn't Stop Job Immediately
- Current implementation marks status as failed but doesn't forcefully stop processing
- Job processor will continue current item; see "Job Processor Integration" for how to add force-stop

## Future Enhancements

1. **Force Kill** - Immediately terminate running processes
2. **Persistent Pause State** - Add pause state tracking across server restarts
3. **Auto-Resume** - Resume paused jobs after a timeout
4. **Pause History** - Track when jobs were paused and for how long
5. **Selective Resume** - Resume specific items instead of entire job

## API Reference

### Pause Endpoint
```bash
POST /api/jobs/:id/pause
```
**Success Response (200):**
```json
{ "success": true, "message": "Job paused" }
```
**Error Response (400):**
```json
{ "error": "Can only pause running jobs" }
```

### Resume Endpoint
```bash
POST /api/jobs/:id/resume
```
**Success Response (200):**
```json
{ "success": true, "message": "Job resumed" }
```
**Error Response (400):**
```json
{ "error": "Can only resume paused jobs" }
```

### Cancel Endpoint (Updated)
```bash
POST /api/jobs/:id/cancel
```
**Success Response (200):**
```json
{ "success": true, "message": "Job cancelled" }
```
**Error Response (400):**
```json
{ "error": "Can only cancel running, queued, or paused jobs" }
```

## Files Modified

- ✅ `server/db/database.js` - Added pauseJob() and resumeJob() functions
- ✅ `server/api/jobs.js` - Added /pause, /resume endpoints; updated /cancel endpoint
- ✅ `client/src/pages/JobDetail.jsx` - Added pause/resume/cancel UI and handlers

## Notes

- Pause/Resume is UI + Database only; job processors need manual integration for true pause support
- Cancel immediately marks job as failed in database; processors should check status and exit cleanly
- All operations require valid job ID and appropriate job status
- No authentication/authorization checks (add as needed for production)

