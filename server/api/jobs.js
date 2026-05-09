const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { createJob, getJob, listJobs, deleteJob, cancelJob, pauseJob, resumeJob, getGLSyncDetails } = require('../db/database');
const { loadTemplates, getTemplate } = require('../automation/templates-loader');
const { runTemplateJob } = require('../automation/jobs');

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract company/community name from a URL
 * Example: "https://surpass.alisonline.com/Settings/..." → "Surpass"
 */
function extractCompanyNameFromUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    // Extract subdomain (first part before the dot)
    const parts = hostname.split('.');
    if (parts.length > 0) {
      const subdomain = parts[0];
      // Capitalize first letter
      return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
    }
  } catch (err) {
    // Invalid URL, return null
  }
  return null;
}

/**
 * Enhance job label with company and community name if available
 * Example: "Sync GL Accounts" + "Surpass" + "Aaron's Assisted Living" → "Sync GL Accounts - Surpass - Aaron's Assisted Living"
 */
function enhanceLabelWithCompanyName(label, payload) {
  let companyName = null;

  // Try to extract from billingSettingsUrl (for sync-gl-accounts)
  if (payload.billingSettingsUrl) {
    companyName = extractCompanyNameFromUrl(payload.billingSettingsUrl);
  }

  // Try to extract from companyUrl (for create-communities)
  if (!companyName && payload.companyUrl) {
    companyName = extractCompanyNameFromUrl(payload.companyUrl);
  }

  // Build enhanced label
  let enhancedLabel = label;

  // Append company name if found and not already in label
  if (companyName && !enhancedLabel.includes(companyName)) {
    enhancedLabel = `${enhancedLabel} - ${companyName}`;
  }

  // Append community name if available (for sync-gl-accounts)
  if (payload.communityName && !enhancedLabel.includes(payload.communityName)) {
    enhancedLabel = `${enhancedLabel} - ${payload.communityName}`;
  }

  return enhancedLabel;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTES — More specific routes BEFORE generic :id routes
// ═══════════════════════════════════════════════════════════════════

// GET /api/jobs/templates — list all available job templates
router.get('/templates', (req, res) => {
  try {
    const templates = loadTemplates();
    // Return just metadata, not full schema
    const metadata = templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
    }));
    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/templates/:id — get specific template with schema
router.get('/templates/:id', (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: `Template '${req.params.id}' not found` });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/create — create job from any template
// Body: { templateId: string, label?: string, payload: {...} }
router.post('/create', (req, res) => {
  try {
    const { templateId, label, payload } = req.body;

    if (!templateId || !payload) {
      return res.status(400).json({ error: 'templateId and payload are required' });
    }

    let template;
    try {
      template = getTemplate(templateId);
    } catch (err) {
      return res.status(404).json({ error: `Template '${templateId}' not found` });
    }

    const id = uuidv4();

    // Determine item count and extract items array (varies by template)
    let itemCount = 1;
    let itemsToTrack = [];
    if (payload.communities) {
      itemCount = payload.communities.length;
      itemsToTrack = payload.communities;
    } else if (payload.items) {
      itemCount = payload.items.length;
      itemsToTrack = payload.items;
    }

    // Enhance label with company name from URL if available
    let finalLabel = label || template.name;
    finalLabel = enhanceLabelWithCompanyName(finalLabel, payload);

    createJob({
      id,
      type: templateId,
      label: finalLabel,
      payload,
      total: itemCount,
      items: itemsToTrack,
    });

    // Kick off async — don't await
    runTemplateJob(id, template, payload).catch(err => {
      console.error(`[job:${id}] Unhandled error:`, err.message);
    });

    res.status(202).json({ id });
  } catch (err) {
    console.error('[jobs POST /create] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/create-communities — Legacy support
router.post('/create-communities', (req, res) => {
  const { label, companyUrl, communities } = req.body;

  if (!companyUrl || !Array.isArray(communities) || communities.length === 0) {
    return res.status(400).json({ error: 'companyUrl and communities[] are required' });
  }

  const id = uuidv4();
  const payload = { companyUrl, communities };

  // Enhance label with company name from URL if available
  let finalLabel = label || `Create ${communities.length} communities`;
  finalLabel = enhanceLabelWithCompanyName(finalLabel, payload);

  createJob({
    id,
    type: 'create-communities',
    label: finalLabel,
    payload,
    total: communities.length,
    items: communities,
  });

  // Kick off async
  const template = getTemplate('create-communities');
  runTemplateJob(id, template, { companyUrl, communities }).catch(err => {
    console.error(`[job:${id}] Unhandled error:`, err.message);
  });

  res.status(202).json({ id });
});

// ═══════════════════════════════════════════════════════════════════
// GENERIC ROUTES — Less specific routes AFTER specific ones
// ═══════════════════════════════════════════════════════════════════

// GET /api/jobs — list all jobs
router.get('/', (req, res) => {
  res.json(listJobs());
});

// GET /api/jobs/:id — get job detail + items
router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

// GET /api/jobs/:id/gl-details — get GL sync details for a job
router.get('/:id/gl-details', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.type !== 'sync-gl-accounts') {
      return res.status(400).json({ error: 'GL sync details only available for sync-gl-accounts jobs' });
    }

    const details = getGLSyncDetails(req.params.id);
    res.json({ jobId: req.params.id, details });
  } catch (err) {
    console.error('[jobs GET /:id/gl-details] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/:id — delete a job and its items
router.delete('/:id', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    deleteJob(req.params.id);
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    console.error('[jobs DELETE /:id] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/cancel — cancel a running job
router.post('/:id/cancel', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'running' && job.status !== 'queued' && job.status !== 'paused') {
      return res.status(400).json({ error: 'Can only cancel running, queued, or paused jobs' });
    }

    cancelJob(req.params.id);
    res.json({ success: true, message: 'Job cancelled' });
  } catch (err) {
    console.error('[jobs POST /:id/cancel] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/pause — pause a running job
router.post('/:id/pause', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Can only pause running jobs' });
    }

    pauseJob(req.params.id);
    res.json({ success: true, message: 'Job paused' });
  } catch (err) {
    console.error('[jobs POST /:id/pause] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/:id/resume — resume a paused job
router.post('/:id/resume', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status !== 'paused') {
      return res.status(400).json({ error: 'Can only resume paused jobs' });
    }

    resumeJob(req.params.id);
    res.json({ success: true, message: 'Job resumed' });
  } catch (err) {
    console.error('[jobs POST /:id/resume] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
