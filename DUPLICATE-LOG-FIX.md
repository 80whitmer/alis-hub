# Fixing Duplicate "Starting:" Logs

## The Problem
Your logs show duplicate entries:
```
18:54:53→ Starting: General Care Item 57
18:54:53→ Starting: General Care Item 57  <-- DUPLICATE
```

## Root Cause
You're emitting the progress event in TWO places:

### Location 1: In your main loop
```javascript
for (const item of items) {
  io.emit('job:progress', { jobId, message: `→ Starting: ${item.name}` });
  // ... rest of code
}
```

### Location 2: Inside your syncGLRecords or Playwright function
```javascript
async function syncGLRecords(item) {
  console.log(`[GL Sync] Clicking Options dropdown for: ${item.name}`);
  io.emit('job:progress', { jobId, message: `→ Starting: ${item.name}` }); // DUPLICATE!
  // ... rest of sync logic
}
```

## The Fix

### Option A: Emit only in main loop (RECOMMENDED)
```javascript
// In your job processor
for (const item of items) {
  // Emit once at the start
  io.emit('job:progress', { 
    jobId, 
    message: `→ Starting: ${item.name}` 
  });

  try {
    // Don't emit "Starting" inside this function
    await syncGLRecords(item, jobId, io);
    
    io.emit('job:progress', { 
      jobId, 
      message: `✓ Done: ${item.name}` 
    });
  } catch (error) {
    io.emit('job:progress', { 
      jobId, 
      message: `✗ Failed: ${item.name} — ${error.message}` 
    });
  }
}
```

### Option B: Emit only inside the function
```javascript
// In your job processor
for (const item of items) {
  // DON'T emit here
  
  try {
    await syncGLRecords(item, jobId, io); // Will emit internally
  } catch (error) {
    io.emit('job:progress', { 
      jobId, 
      message: `✗ Failed: ${item.name} — ${error.message}` 
    });
  }
}

// In syncGLRecords function
async function syncGLRecords(item, jobId, io) {
  io.emit('job:progress', { jobId, message: `→ Starting: ${item.name}` });
  
  // ... sync logic
  
  io.emit('job:progress', { jobId, message: `✓ Done: ${item.name}` });
}
```

## Quick Fix Process

1. Search your codebase for ALL instances of:
```javascript
io.emit('job:progress', { jobId, message: `→ Starting: ${item.name}`
```

2. You should find EXACTLY TWO places:
   - One in the main job processor loop
   - One inside your sync/processing function

3. Comment out or delete ONE of them

4. Choose either Option A or Option B above and ensure only ONE place emits this message

## Verification

After fixing, your logs should look like:
```
18:54:53→ Starting: General Care Item 57
18:55:01✓ Done: General Care Item 57
18:55:01→ Starting: General Rent Billing Item
18:55:08✓ Done: General Rent Billing Item
```

Each item should have EXACTLY ONE "Starting" message.

## For ALIS Hub Specifically

In your setup, check:
1. `server/automation/jobs.js` - Main job processor loop
2. `server/automation/playwright/billingPage.js` - GL Sync function
3. Any other processor files in `server/automation/`

Look for duplicate `io.emit` or `setLog` calls for the same "Starting" message.

## Prevention

When adding new job types or processors:
1. Emit "Starting" message ONCE (either in main loop OR in processor function, not both)
2. Emit "Done" or "Failed" message AFTER the item is processed
3. Follow a consistent pattern across all processors

