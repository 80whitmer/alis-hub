require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { initDb }    = require('./db/database');
const jobsRouter    = require('./api/jobs');
const streamRouter  = require('./api/stream');
const hubspotRouter = require('./api/hubspot');
const qbrRouter     = require('./api/qbr');
const wellnessRouter = require('./api/wellness');
const companyHostsRouter = require('./api/companyHosts');
const usageAuditRouter = require('./api/usageAudit');
const auditHistoryRouter = require('./api/auditHistory');
const evaluationsRouter = require('./api/evaluations');
const accountHealthRouter = require('./api/accountHealth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/jobs',    jobsRouter);
app.use('/api/stream',  streamRouter);
app.use('/api/hubspot', hubspotRouter);
app.use('/api/qbr',     qbrRouter);
app.use('/api/wellness', wellnessRouter);
app.use('/api/company-hosts', companyHostsRouter);
app.use('/api/usage-audit', usageAuditRouter);
app.use('/api/audit-history', auditHistoryRouter);
app.use('/api/evaluations', evaluationsRouter);
app.use('/api/account-health', accountHealthRouter);
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Error handler middleware — must be last
app.use((err, req, res, next) => {
  console.error('[Express Error Handler]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀  alis-hub server running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
