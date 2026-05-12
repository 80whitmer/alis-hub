const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const PORT = 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  if (req.url === '/api/form-analysis/analyze' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        
        let fileData = null;
        let radius = '100';
        let template = '';

        const parts = body.toString('binary').split('--' + boundary);
        for (const part of parts) {
          if (part.includes('name="file"')) {
            const start = part.indexOf('\r\n\r\n') + 4;
            const end = part.lastIndexOf('\r\n');
            if (start > 3 && end > start) {
              fileData = Buffer.from(part.substring(start, end), 'binary');
            }
          }
          if (part.includes('name="radius"')) {
            const match = part.match(/\r\n\r\n(.+?)\r\n/);
            if (match) radius = match[1];
          }
          if (part.includes('name="template"')) {
            const match = part.match(/\r\n\r\n(.+?)\r\n/);
            if (match) template = match[1];
          }
        }

        if (!fileData) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No PDF file uploaded' }));
          return;
        }

        const tmpFile = `/tmp/form-upload-${Date.now()}.pdf`;
        fs.writeFileSync(tmpFile, fileData);

        const pocDir = path.join(__dirname, 'form-markup-poc');
        const outputFile = `/tmp/analysis-${Date.now()}.json`;

        let cmd = `cd "${pocDir}" && node pdf-upload-analyzer.js "${tmpFile}"`;
        if (template) cmd += ` --template ${template}`;
        cmd += ` --radius ${radius} --output ${outputFile}`;

        console.log('[Form Analysis] Running analyzer...');
        try {
          await execAsync(cmd, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
          console.log('[Form Analysis] Done');
        } catch (e) {
          console.error('[Form Analysis] Error:', e.message);
        }

        if (fs.existsSync(outputFile)) {
          const results = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(results));
          try {
            fs.unlinkSync(tmpFile);
            fs.unlinkSync(outputFile);
          } catch (e) {}
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Analysis failed' }));
        }
      } catch (err) {
        console.error('[Error]', err);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.url === '/api/form-analysis/templates' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify([
      { id: 'move-in-assessment-v1', name: 'Move-in Assessment' },
      { id: 'intake-form-v1', name: 'Intake Form' },
      { id: 'discharge-form-v1', name: 'Discharge Form' },
      { id: null, name: 'Auto-detect' }
    ]));
    return;
  }

  let filePath = path.join(__dirname, 'server', 'public', req.url === '/' ? 'form-analyzer.html' : req.url);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mimes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
      res.setHeader('Content-Type', mimes[ext] || 'text/plain');
      res.writeHead(200);
      res.end(content);
      return;
    }
  } catch (e) {}

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('\nalisHub Server: http://localhost:' + PORT);
  console.log('Form Analyzer: http://localhost:' + PORT + '/form-analyzer.html\n');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err);
});
