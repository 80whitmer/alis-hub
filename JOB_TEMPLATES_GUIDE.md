# Job Templates System — Complete Guide

## Overview

The alis-hub job system now supports **extensible job templates**. This allows you to:
- Define new job types declaratively via JSON schema
- Generate forms dynamically from schemas
- Support 20+ job types with consistent UI/UX
- Add new tools in minutes, not hours

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────┐
│  Frontend: Dynamic Form Generator               │
│  ├─ Fetches template metadata                   │
│  ├─ Loads schema for selected template          │
│  ├─ Generates form fields from schema           │
│  └─ Submits payload to backend                  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  Backend: Generic Job Router                    │
│  ├─ POST /api/jobs/create (accepts any template)│
│  ├─ Validates payload against schema            │
│  ├─ Creates job in database                     │
│  └─ Dispatches to template-specific handler     │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  Executor: Template-Specific Job Handler        │
│  ├─ runCreateCommunitiesJob()                   │
│  ├─ runSyncGLAccountsJob()                      │
│  ├─ runYourNewToolJob()                         │
│  └─ Emits SSE events (item_start, item_done...) │
└─────────────────────────────────────────────────┘
```

### File Structure

```
server/
  automation/
    templates.json                  ← Registry of all templates
    templates-loader.js             ← Load & manage templates
    job-executor.js                 ← Generic subprocess executor (optional)
    jobs.js                         ← Template-specific job handlers
    create-communities.js           ← Existing Playwright script (unchanged)
    sync_alis_gl_accounts.js        ← Your GL sync script (unchanged)
  api/
    jobs.js                         ← Updated routes (generic + legacy)

client/
  src/
    pages/
      NewJob.jsx                    ← Dynamic form generator
    utils/
      schema-form-generator.js      ← Form field rendering
```

---

## Adding a New Job Type

### Step 1: Define the Template

Edit `server/automation/templates.json`:

```json
{
  "id": "your-tool-id",
  "name": "Your Tool Name",
  "description": "What this tool does",
  "category": "category-name",
  "icon": "🎯",
  "timeout": 1800000,
  "scriptPath": "./your-tool.js",
  "inputSchema": {
    "type": "object",
    "title": "Your Tool Config",
    "properties": {
      "requiredField": {
        "type": "string",
        "title": "Required Field",
        "description": "Help text",
        "examples": ["example value"]
      },
      "itemsArray": {
        "type": "array",
        "title": "Items",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "title": "Name" },
            "value": { "type": "string", "title": "Value" }
          },
          "required": ["name", "value"]
        }
      }
    },
    "required": ["requiredField", "itemsArray"]
  }
}
```

### Step 2: Implement Job Handler

In `server/automation/jobs.js`, add a handler:

```javascript
/**
 * Run your custom job
 * Emits SSE events: item_start | item_done | item_fail | job_done
 */
async function runYourToolJob(jobId, { requiredField, itemsArray }) {
  const emit = (event, data) => broadcast(jobId, event, data);

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: itemsArray.length });

  // Your implementation here
  for (const item of itemsArray) {
    setItemStatus(jobId, item.name, 'running');
    emit('item_start', { name: item.name });

    try {
      // Do work...
      await doSomething(item);

      setItemStatus(jobId, item.name, 'success');
      emit('item_done', { name: item.name });
    } catch (err) {
      setItemStatus(jobId, item.name, 'failed', err.message);
      emit('item_fail', { name: item.name, error: err.message });
    }
  }

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}
```

### Step 3: Add Dispatcher

In the same `runTemplateJob()` function, add a case:

```javascript
async function runTemplateJob(jobId, template, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);

  try {
    setJobStatus(jobId, 'running');

    switch (template.id) {
      case 'create-communities':
        return await runCreateCommunitiesJob(jobId, payload);
      
      case 'sync-gl-accounts':
        return await runSyncGLAccountsJob(jobId, payload);
      
      case 'your-tool-id':        // ← ADD THIS
        return await runYourToolJob(jobId, payload);
      
      default:
        setJobStatus(jobId, 'failed');
        emit('job_error', { error: `No handler for template: ${template.id}` });
    }
  } catch (err) {
    setJobStatus(jobId, 'failed');
    emit('job_error', { error: err.message });
  }
}
```

### Step 4: Done!

That's it. The frontend will automatically:
- Show your tool in the job type selector
- Generate a form from your JSON schema
- Submit the payload to your handler
- Display progress in the standard JobDetail view

---

## SSE Event Format

All job handlers should emit these events:

### On Startup
```javascript
emit('job_start', { jobId: '...', total: 5 })
```

### For Each Item
```javascript
emit('item_start', { name: 'Item Name' })
emit('item_done', { name: 'Item Name' })
// or
emit('item_fail', { name: 'Item Name', error: 'Error message' })
```

### On Completion
```javascript
emit('job_done', { jobId: '...' })
// or on error
emit('job_error', { error: 'Critical error message' })
```

---

## JSON Schema Features

The schema-form generator supports:

### String Fields
```json
{
  "type": "string",
  "title": "Field Label",
  "description": "Help text",
  "placeholder": "hint text",
  "examples": ["example value"]
}
```

### Date Fields (MM/DD/YYYY)
```json
{
  "type": "string",
  "title": "Sync Date",
  "pattern": "^\\d{2}/\\d{2}/\\d{4}$",
  "examples": ["05/01/2026"]
}
```

### Array of Objects
```json
{
  "type": "array",
  "title": "Items",
  "minItems": 1,
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "value": { "type": "string" }
    },
    "required": ["name", "value"]
  }
}
```

---

## Current Templates

### 1. Create Communities
**ID:** `create-communities`  
**Purpose:** Provision communities in ALIS  
**Handler:** `runCreateCommunitiesJob()`  
**Inputs:** companyUrl, communities (array with name, CRM ID, capacity, address)

### 2. Sync GL Accounts
**ID:** `sync-gl-accounts`  
**Purpose:** Synchronize GL accounts for ownership transitions  
**Handler:** `runSyncGLAccountsJob()`  
**Inputs:** communityName, billingSettingsUrl, syncDate, items (array with GL mappings)

---

## Testing a New Template

1. Add template to `templates.json`
2. Implement handler in `jobs.js`
3. Add case to `runTemplateJob()`
4. Start dev server: `npm run dev`
5. Go to http://localhost:5173/new-job
6. Select your template from dropdown
7. Form fields auto-generate
8. Fill and submit
9. Watch progress in JobDetail view

---

## Best Practices

✅ **Do:**
- Keep handlers focused and single-responsibility
- Emit events frequently (every item, not just at end)
- Use descriptive template IDs (kebab-case)
- Add error messages for debugging
- Test with small item counts first

❌ **Don't:**
- Handle multiple job types in one handler
- Emit generic events (use item-specific names)
- Skip the `template.id` case in dispatcher
- Assume payload structure (validate first)
- Forget to call `setJobStatus()` and `broadcast()`

---

## Extending Further

### Conditional Fields (Future)
Schema could support dependencies:
```json
{
  "if": { "properties": { "useCompanyUrl": true } },
  "then": { "required": ["companyUrl"] }
}
```

### File Uploads (Future)
Template could accept file inputs:
```json
{
  "type": "file",
  "title": "Upload CSV",
  "accept": ".csv"
}
```

### Custom Validators (Future)
Schema could include async validation:
```json
{
  "validator": "validateEmailDomain"
}
```

---

## Example: Complete New Tool

**Goal:** Create a "Send Notifications" job template

**1. Add to templates.json:**
```json
{
  "id": "send-notifications",
  "name": "Send Notifications",
  "description": "Send emails or SMS to customers",
  "category": "communication",
  "icon": "💬",
  "timeout": 600000,
  "scriptPath": "./send-notifications.js",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": {
        "type": "string",
        "title": "Channel",
        "enum": ["email", "sms"]
      },
      "template": {
        "type": "string",
        "title": "Message Template"
      },
      "recipients": {
        "type": "array",
        "title": "Recipients",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "address": { "type": "string" }
          },
          "required": ["name", "address"]
        }
      }
    },
    "required": ["channel", "template", "recipients"]
  }
}
```

**2. Add handler in jobs.js:**
```javascript
async function runSendNotificationsJob(jobId, { channel, template, recipients }) {
  const emit = (event, data) => broadcast(jobId, event, data);
  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: recipients.length });

  for (const recipient of recipients) {
    emit('item_start', { name: recipient.name });
    try {
      await sendNotification(channel, template, recipient);
      emit('item_done', { name: recipient.name });
    } catch (err) {
      emit('item_fail', { name: recipient.name, error: err.message });
    }
  }

  setJobStatus(jobId, 'done');
  emit('job_done', { jobId });
}
```

**3. Add case to runTemplateJob():**
```javascript
case 'send-notifications':
  return await runSendNotificationsJob(jobId, payload);
```

**Done!** The form is auto-generated and the notification job works.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        Dashboard                              │
│                    (shows all jobs)                           │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ↓
┌──────────────────────────────────────────────────────────────┐
│                      NewJob (Dynamic)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Fetch /api/jobs/templates                           │  │
│  │ 2. User selects template                               │  │
│  │ 3. Fetch /api/jobs/templates/{id}                      │  │
│  │ 4. Render form from schema                             │  │
│  │ 5. Submit to POST /api/jobs/create                     │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬────────────────────────────────┘
                              │ { templateId, payload }
                              ↓
┌──────────────────────────────────────────────────────────────┐
│                    Backend API Router                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Validate templateId exists                          │  │
│  │ 2. Create job in database                              │  │
│  │ 3. Get template config                                 │  │
│  │ 4. Call runTemplateJob(jobId, template, payload)       │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬────────────────────────────────┘
                              │
                  ┌───────────┼───────────┐
                  ↓           ↓           ↓
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │  Create      │  │  Sync GL     │  │  [New Tool]  │
        │  Communities │  │  Accounts    │  │              │
        └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
               │                 │                  │
               └─────────────────┼──────────────────┘
                                 │
                                 ↓
                  ┌──────────────────────────┐
                  │  EventSource (SSE)       │
                  │  Broadcast events to     │
                  │  JobDetail component     │
                  └──────────────────────────┘
```

---

**That's it!** You now have a scalable job system that grows with your automation needs. 🚀
