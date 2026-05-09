require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const { initDb }   = require('./db/database');
const jobsRouter   = require('./api/jobs');
const streamRouter = require('./api/stream');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/jobs',   jobsRouter);
app.use('/api/stream', streamRouter);
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀  alis-hub server running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});
