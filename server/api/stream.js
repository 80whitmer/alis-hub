const express              = require('express');
const router               = express.Router();
const { subscribe, unsubscribe } = require('./broadcaster');
const { getJob }           = require('../db/database');

// GET /api/stream/:jobId
// Client opens this as an EventSource to receive live job updates.
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;

  // Validate job exists
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send current snapshot immediately so UI can hydrate
  res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

  // If job already finished, close immediately
  if (job.status === 'done' || job.status === 'failed') {
    res.end();
    return;
  }

  subscribe(jobId, res);

  req.on('close', () => {
    unsubscribe(jobId, res);
  });
});

module.exports = router;
