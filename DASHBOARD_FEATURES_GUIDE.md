# Dashboard Features Guide

## New Buttons & Controls

### 1. Delete Button 🗑
**Location:** Top-right corner of each job card, next to Cancel button

**When it appears:** Always (all job statuses)

**What it does:**
- Permanently removes the job from the dashboard
- Deletes all job records and items from the database
- Cannot be undone

**How to use:**
```
1. Find the job you want to delete
2. Click the 🗑 Delete button
3. Read the confirmation message
4. Click "Delete" to confirm (or "Cancel" to keep the job)
5. Job disappears from the dashboard
```

**Visual:** `🗑 Delete`

---

### 2. Cancel Button ⏸
**Location:** Top-right corner of each job card, left of Delete button

**When it appears:** Only when job status is "Running" or "Queued"

**What it does:**
- Stops the currently running job
- Marks all running items as failed
- Sets job status to "Failed"
- Frees up system resources

**How to use:**
```
1. Find the job you want to stop (must be Running/Queued)
2. Click the ⏸ Cancel button
3. Button shows "⏸ Cancelling..." while processing
4. Job status changes to "Failed"
5. Click the job to view details and see what failed
```

**Visual:** `⏸ Cancel` (or `⏸ Cancelling...` while processing)

---

## Understanding Job Statuses

### Queued
**Meaning:** Job is waiting to start

**Available actions:**
- ⏸ Cancel — Stop before it runs
- 🗑 Delete — Remove from queue

**What it shows:**
- Badge: "Queued" (neutral gray)
- Progress: Not started yet
- Items: All pending

---

### Running
**Meaning:** Job is actively processing items

**Available actions:**
- ⏸ Cancel — Stop immediately
- 🗑 Delete — Remove (will delete partial results)

**What it shows:**
- Badge: "Running" (yellow/amber)
- Progress: Updates as items complete
- Items: Mix of pending, running, and completed

---

### Completed
**Meaning:** Job finished successfully

**Available actions:**
- 🗑 Delete — Remove completed job

**What it shows:**
- Badge: "Completed" (green)
- Progress: 100%
- Items: All marked as success or failed

---

### Failed
**Meaning:** Job encountered errors or was cancelled

**Available actions:**
- 🗑 Delete — Remove failed job

**What it shows:**
- Badge: "Failed" (red)
- Progress: Shows where it stopped
- Items: Mix of success, failed, and incomplete

---

## Confirmation Modal

### Delete Confirmation
Appears when you click the 🗑 Delete button:

```
┌──────────────────────────────────┐
│ Delete Job?                      │
│                                  │
│ Are you sure you want to delete  │
│ "Sync GL Accounts 5/9"? This    │
│ action cannot be undone.         │
│                                  │
│ [Cancel]        [Delete]         │
└──────────────────────────────────┘
```

**Options:**
- **Cancel** — Close the modal, keep the job
- **Delete** — Confirm deletion, remove job permanently

---

## Job Card Layout

### Before (with phantom shapes)
```
┌──────────────────────────────────────────────────────────────────┐
│ ● Sync GL Accounts                            [Completed]        │
│   5/9/2026, 6:33:21 PM                                           │
│                                                                  │
│ ████████████████████████████████ 100%                           │
│ 17 completed                                    100%             │
└──────────────────────────────────────────────────────────────────┘
```
*Note: The "●" status dot was an orphaned UI element*

### After (clean, with controls)
```
┌──────────────────────────────────────────────────────────────────┐
│ Sync GL Accounts                 [Completed] 🗑 Delete           │
│ 5/9/2026, 6:33:21 PM                                             │
│                                                                  │
│ ████████████████████████████████ 100%                           │
│ 17 completed                                    100%             │
└──────────────────────────────────────────────────────────────────┘
```
*Clean design, status shown only in badge, action buttons visible*

---

## Running Job Example

```
┌──────────────────────────────────────────────────────────────────┐
│ Sync GL Accounts                 [Running] ⏸ Cancel 🗑 Delete   │
│ 5/9/2026, 6:45:30 PM                                             │
│                                                                  │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░ 45%                           │
│ 9/20 completed                                  45%              │
│                                      1 failed                    │
└──────────────────────────────────────────────────────────────────┘
```

**Key elements:**
- Job title is clickable → opens detailed view
- Status badge (yellow "Running")
- Cancel button available
- Delete button available
- Progress bar showing actual progress
- Item counts and failure count

---

## Workflow Examples

### Example 1: Delete an Old Job
```
Goal: Clean up completed jobs

1. Find "Sync GL Accounts" from 5/8/2026
2. Click the 🗑 Delete button
3. Modal appears: "Are you sure you want to delete..."
4. Click the "Delete" button in the modal
5. Job disappears from the dashboard
6. Database is cleaned up
```

### Example 2: Stop a Long-Running Job
```
Goal: Cancel a job that's taking too long

1. Find the running "Create Communities" job
2. Notice the "Running" status badge (yellow)
3. Notice the ⏸ Cancel button is visible
4. Click ⏸ Cancel
5. Button shows "⏸ Cancelling..." for a moment
6. Job status changes to "Failed"
7. It stops processing further items
```

### Example 3: Review and Manage Jobs
```
Workflow:

1. Dashboard shows all jobs (newest first)
2. Running jobs have ⏸ Cancel button available
3. All jobs have 🗑 Delete button
4. Click job title to see detailed logs
5. Delete old completed jobs to keep dashboard clean
6. Cancel stuck jobs that are taking too long
```

---

## API Integration

### Behind the Scenes

When you click Delete:
```
1. Frontend: Click 🗑 Delete button
2. Frontend: Show delete confirmation modal
3. User: Click "Delete" to confirm
4. Frontend: Send DELETE /api/jobs/:id
5. Backend: Delete job and all job_items from database
6. Backend: Return { success: true }
7. Frontend: Remove job from dashboard
8. User: Job is gone
```

When you click Cancel:
```
1. Frontend: Click ⏸ Cancel button
2. Frontend: Send POST /api/jobs/:id/cancel
3. Backend: Mark job as failed
4. Backend: Mark running items as failed
5. Backend: Return { success: true }
6. Frontend: Update job status to "Failed"
7. Frontend: Hide ⏸ Cancel button
8. User: Job stops processing
```

---

## Tips & Best Practices

### ✅ Do's
- Delete old jobs regularly to keep the dashboard clean
- Cancel jobs that are taking longer than expected
- Click job titles to see detailed logs and error messages
- Use the delete button to clean up test runs
- View the live log while jobs are running to monitor progress

### ❌ Don'ts
- Don't delete jobs you might need later (deletion is permanent)
- Don't cancel jobs right after starting (give them a moment)
- Don't rely on the dashboard alone for job records (use logs)
- Don't delete while reviewing a job's details

### 🔍 Troubleshooting
- **Delete button not working?** Check your internet connection
- **Cancel button not appearing?** Job is already finished
- **Job still showing after delete?** Refresh the page
- **Confirmation modal won't close?** Click "Cancel" button

---

## Keyboard Shortcuts
Currently not implemented, but could be added:
- `Ctrl+D` — Delete selected job
- `Ctrl+C` — Cancel selected job
- `Enter` — Confirm action

---

## Mobile Considerations
- Buttons stack on small screens
- Status badge wraps to next line if needed
- Delete confirmation modal is full-width on mobile
- Touch-friendly button sizes (44px minimum)
