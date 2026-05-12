const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Configure multer for this router
const upload = multer({
  dest: path.join(__dirname, '../../tmp'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

/**
 * Analyze a PDF for form fields
 * POST /api/form-analysis/analyze
 * Accepts: multipart/form-data with 'file', 'template', 'radius'
 */
router.post('/analyze', upload.single('file'), async (req, res) => {
  let uploadedFilePath = null;
  let outputFile = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    uploadedFilePath = req.file.path;
    const { template, radius = 100 } = req.body;

    // Verify file exists (multer should have created it)
    if (!fs.existsSync(uploadedFilePath)) {
      return res.status(500).json({ error: 'Failed to save uploaded file' });
    }

    const pocDir = path.join(__dirname, '../../form-markup-poc');
    outputFile = path.join(__dirname, '../../tmp', `analysis-${Date.now()}.json`);

    // Ensure tmp directory exists
    const tmpDir = path.dirname(outputFile);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Build command
    let cmd = `cd "${pocDir}" && node pdf-upload-analyzer.js "${uploadedFilePath}"`;
    if (template) {
      cmd += ` --template ${template}`;
    }
    cmd += ` --radius ${radius}`;
    cmd += ` --output ${outputFile}`;

    console.log(`[Form Analysis] Running: ${cmd}`);

    // Run analyzer
    let stdout = '', stderr = '';
    try {
      const result = await execAsync(cmd, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      stdout = result.stdout;
      stderr = result.stderr;
      if (stdout) console.log('[Form Analysis] stdout:', stdout);
      if (stderr) console.log('[Form Analysis] stderr:', stderr);
    } catch (execErr) {
      console.error('[Form Analysis] Analyzer error:', execErr.message);
      stdout = execErr.stdout || '';
      stderr = execErr.stderr || '';
      console.error('[Form Analysis] stderr captured:', stderr);
      // Continue — we might still have the output JSON
    }

    // Read results
    if (!fs.existsSync(outputFile)) {
      return res.status(500).json({
        error: 'Analysis failed - no output generated',
        details: 'The form-markup-poc may not have found any form fields or an error occurred during analysis',
        debug: {
          stdout: stdout.substring(0, 500),
          stderr: stderr.substring(0, 500),
        },
      });
    }

    const results = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

    // Clean up temp files
    try {
      fs.unlinkSync(uploadedFilePath);
      fs.unlinkSync(outputFile);
    } catch (cleanupErr) {
      console.warn('[Form Analysis] Cleanup warning:', cleanupErr.message);
    }

    res.json(results);

  } catch (err) {
    console.error('[Form Analysis] Error:', err);

    // Attempt cleanup on error
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (e) {
        console.warn('Failed to clean up uploaded file:', e.message);
      }
    }
    if (outputFile && fs.existsSync(outputFile)) {
      try {
        fs.unlinkSync(outputFile);
      } catch (e) {
        console.warn('Failed to clean up output file:', e.message);
      }
    }

    res.status(500).json({
      error: 'Analysis failed',
      details: err.message,
    });
  }
});

/**
 * List available form templates
 * GET /api/form-analysis/templates
 */
router.get('/templates', (req, res) => {
  const templates = [
    {
      id: 'move-in-assessment-v1',
      name: 'Move-in Assessment',
      description: 'Standard move-in assessment form with resident info, medical history, preferences',
    },
    {
      id: 'intake-form-v1',
      name: 'Intake Form',
      description: 'Initial intake form for new residents',
    },
    {
      id: 'discharge-form-v1',
      name: 'Discharge Form',
      description: 'Discharge paperwork and summary',
    },
    {
      id: null,
      name: 'Auto-detect',
      description: 'Let the analyzer detect the form type automatically',
    },
  ];

  res.json(templates);
});

module.exports = router;
