/**
 * job-executor.js
 * Generic job executor for any template script
 * Spawns subprocess, parses SSE events, manages streaming
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class JobExecutor extends EventEmitter {
  constructor(template, payload, jobId) {
    super();
    this.template = template;
    this.payload = payload;
    this.jobId = jobId;
    this.process = null;
    this.status = 'pending';
  }

  async execute() {
    return new Promise((resolve, reject) => {
      const scriptPath = path.resolve(
        __dirname,
        this.template.scriptPath
      );

      // Prepare environment
      const env = {
        ...process.env,
        JOB_ID: this.jobId,
        JOB_PAYLOAD: JSON.stringify(this.payload),
        JOB_TEMPLATE: this.template.id,
      };

      // Spawn subprocess
      this.process = spawn('node', [scriptPath], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.template.timeout || 3600000,
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let processedEvents = 0;
      let lastEventTime = Date.now();

      // Parse stdout for SSE events
      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutBuffer += text;

        // Check if text contains SSE event markers
        const lines = stdoutBuffer.split('\n');

        // Keep last incomplete line in buffer
        stdoutBuffer = lines[lines.length - 1];

        // Process complete lines as potential events
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();

          // Skip empty lines
          if (!line) continue;

          // Parse SSE event format: event: name\ndata: {...}\n
          // For simplicity, we'll also accept JSON lines with event type
          try {
            // Try parsing as JSON with embedded event type
            if (line.startsWith('{') && line.endsWith('}')) {
              const obj = JSON.parse(line);
              if (obj.event) {
                this.handleEvent(obj.event, obj.data);
                processedEvents++;
                lastEventTime = Date.now();
              }
            }
          } catch (e) {
            // Not an event line, ignore
          }
        }
      });

      // Capture stderr
      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuffer += text;
        // Also emit to console for debugging
        console.error(`[Job ${this.jobId}] ${text}`);
      });

      // Handle process completion
      this.process.on('close', (code) => {
        this.status = code === 0 ? 'done' : 'failed';

        // Emit final job status
        this.emit('job_complete', {
          jobId: this.jobId,
          status: this.status,
          exitCode: code,
          eventsProcessed: processedEvents,
        });

        if (code === 0) {
          resolve({ status: 'success', code, eventsProcessed: processedEvents });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      // Handle process errors
      this.process.on('error', (err) => {
        this.status = 'failed';
        this.emit('job_error', { jobId: this.jobId, error: err.message });
        reject(err);
      });
    });
  }

  handleEvent(eventType, data) {
    // Emit event to listeners (will be streamed to client via SSE)
    this.emit('event', { event: eventType, data });
  }

  kill() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.status = 'cancelled';
    }
  }
}

module.exports = JobExecutor;
