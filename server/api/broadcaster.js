// Simple in-process SSE broadcaster.
// Each job gets its own set of connected clients.
// When the automation layer emits progress, it calls broadcast(jobId, event).

const clients = new Map(); // jobId -> Set<res>

function subscribe(jobId, res) {
  if (!clients.has(jobId)) clients.set(jobId, new Set());
  clients.get(jobId).add(res);
}

function unsubscribe(jobId, res) {
  clients.get(jobId)?.delete(res);
}

function broadcast(jobId, eventName, data) {
  const subs = clients.get(jobId);
  if (!subs || subs.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try { res.write(payload); } catch { /* client disconnected */ }
  }
}

module.exports = { subscribe, unsubscribe, broadcast };
