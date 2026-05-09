const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { createJob, getJob, listJobs } = require('../db/database');
const { runCreateCommunitiesJob }     = require('../automation/jobs');

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

// POST /api/jobs/create-communities
// Body: { label: string, companyUrl: string, communities: [...] }
router.post('/create-communities', (req, res) => {
  const { label, companyUrl, communities } = req.body;

  if (!companyUrl || !Array.isArray(communities) || communities.length === 0) {
    return res.status(400).json({ error: 'companyUrl and communities[] are required' });
  }

  const id = uuidv4();
  createJob({
    id,
    type:        'create-communities',
    label:       label || `Create ${communities.length} communities`,
    payload:     { companyUrl, communities },
    communities,
  });

  // Kick off async — don't await
  runCreateCommunitiesJob(id, { companyUrl, communities }).catch(err => {
    console.error(`[job:${id}] Unhandled error:`, err.message);
  });

  res.status(202).json({ id });
});

module.exports = router;
