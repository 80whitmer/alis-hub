const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { createJob, getJob, listJobs } = require('../db/database');
const { loadTemplates, getTemplate } = require('../automation/templates-loader');
const { runTemplateJob } = require('../automation/jobs');

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

  // Determine item count (varies by template)
  let itemCount = 1;
  if (payload.communities) itemCount = payload.communities.length;
  if (payload.items) itemCount = payload.items.length;

  createJob({
    id,
    type: templateId,
    label: label || template.name,
    payload,
    total: itemCount,
  });

  // Kick off async — don't await
  runTemplateJob(id, template, payload).catch(err => {
    console.error(`[job:${id}] Unhandled error:`, err.message);
  });

  res.status(202).json({ id });
});

// POST /api/jobs/create-communities — Legacy support
router.post('/create-communities', (req, res) => {
  const { label, companyUrl, communities } = req.body;

  if (!companyUrl || !Array.isArray(communities) || communities.length === 0) {
    return res.status(400).json({ error: 'companyUrl and communities[] are required' });
  }

  const id = uuidv4();
  createJob({
    id,
    type: 'create-communities',
    label: label || `Create ${communities.length} communities`,
    payload: { companyUrl, communities },
    total: communities.length,
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

module.exports = router;
