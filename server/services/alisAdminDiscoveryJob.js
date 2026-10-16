/**
 * Background job wrapper for discoverAlisAdminIds (Sep 2026, Aaron: hit a
 * 502 running "Discover & Align" as a plain synchronous POST — the dev
 * proxy's own connection timeout killed the request before a slow run
 * (CRM ID rescue lookups against a handful of unmapped companies, each a
 * live ALIS admin page load) finished, even though the backend was still
 * working fine. Same fire-and-forget + in-memory state + SSE broadcast
 * pattern as portfolioEntitlementsJob.js — the request that kicks this off
 * returns immediately (202), progress streams over SSE, and the final
 * result sits in job state for a client that reloads mid-run or prefers to
 * poll instead.
 */
const { discoverAlisAdminIds } = require('./alisCompanyDiscovery');
const { broadcast } = require('../api/broadcaster');

const STREAM_CHANNEL = 'alis-admin-discovery';

let state = { status: 'idle', message: null, startedAt: null, finishedAt: null, result: null, error: null };
let cancelRequested = false;

function getStatus() {
  return state;
}

/** No-op if nothing is running. */
function cancelDiscovery() {
  if (state.status !== 'running') return false;
  cancelRequested = true;
  broadcast(STREAM_CHANNEL, 'log', { message: 'Cancelling — finishing the current company, then stopping…' });
  return true;
}

/** Starts the job if one isn't already running. Returns false (no-op) if one is. */
function startDiscovery(companies) {
  if (state.status === 'running') return false;
  cancelRequested = false;
  state = { status: 'running', message: 'Starting…', startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null };
  broadcast(STREAM_CHANNEL, 'log', { message: state.message });

  discoverAlisAdminIds(companies, {
    isCancelled: () => cancelRequested,
    onProgress: ({ message }) => {
      state.message = message;
      broadcast(STREAM_CHANNEL, 'log', { message });
    },
  })
    .then((result) => {
      state.status = cancelRequested ? 'cancelled' : 'done';
      state.result = result;
      state.finishedAt = new Date().toISOString();
      cancelRequested = false;
      broadcast(STREAM_CHANNEL, 'complete', getStatus());
    })
    .catch((err) => {
      state.status = 'error';
      state.error = err.message;
      state.finishedAt = new Date().toISOString();
      cancelRequested = false;
      broadcast(STREAM_CHANNEL, 'log', { message: `FATAL ERROR: ${err.message}`, level: 'error' });
      broadcast(STREAM_CHANNEL, 'complete', getStatus());
    });

  return true;
}

module.exports = { startDiscovery, cancelDiscovery, getStatus, STREAM_CHANNEL };
