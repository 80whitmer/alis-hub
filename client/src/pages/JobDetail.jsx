import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatLocalTime, formatLocalDate, formatLocalTimeOnly, getUserTimezone } from '../utils/timezone';
import { generateGLSyncCSV, downloadCSV, generateFilename } from '../utils/csvExport';

const ITEM_CONFIG = {
  pending: { icon: '○', badge: 'badge-neutral', dot: 'status-dot-pending' },
  running: { icon: '◉', badge: 'badge-warning', dot: 'status-dot-running' },
  success: { icon: '✓', badge: 'badge-success', dot: 'status-dot-active' },
  failed:  { icon: '✗', badge: 'badge-error', dot: 'status-dot-error' },
};

const JOB_STATUS_CONFIG = {
  queued:  { badge: 'badge-neutral', text: 'Queued' },
  running: { badge: 'badge-warning', text: 'Running' },
  paused:  { badge: 'badge-info', text: 'Paused' },
  done:    { badge: 'badge-success', text: 'Completed' },
  failed:  { badge: 'badge-error', text: 'Failed' },
};

export default function JobDetail() {
  const { id }                    = useParams();
  const [job, setJob]             = useState(null);
  const [log, setLog]             = useState([]);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [glDetails, setGlDetails] = useState([]);
  const [showGlDetails, setShowGlDetails] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const logRef                    = useRef(null);
  const esRef                     = useRef(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    // Initial load
    fetch(`/api/jobs/${id}`)
      .then(r => r.json())
      .then(data => {
        setJob(data);

        // Load GL sync details if this is a GL sync job
        if (data.type === 'sync-gl-accounts') {
          fetch(`/api/jobs/${id}/gl-details`)
            .then(r => r.json())
            .then(detailsData => {
              setGlDetails(detailsData.details || []);
            })
            .catch(err => console.error('Failed to load GL details:', err));
        }

        if (data.status === 'done' || data.status === 'failed') return; // no SSE needed
        openStream();
      });

    return () => esRef.current?.close();
  }, [id]);

  async function handlePause() {
    try {
      setIsPausing(true);
      const res = await fetch(`/api/jobs/${id}/pause`, { method: 'POST' });
      if (res.ok) {
        setJob(j => ({ ...j, status: 'paused' }));
      } else {
        alert('Failed to pause job');
      }
    } catch (err) {
      console.error('Error pausing job:', err);
      alert('Error pausing job');
    } finally {
      setIsPausing(false);
    }
  }

  async function handleResume() {
    try {
      setIsPausing(true);
      const res = await fetch(`/api/jobs/${id}/resume`, { method: 'POST' });
      if (res.ok) {
        setJob(j => ({ ...j, status: 'running' }));
      } else {
        alert('Failed to resume job');
      }
    } catch (err) {
      console.error('Error resuming job:', err);
      alert('Error resuming job');
    } finally {
      setIsPausing(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel this job? This action cannot be undone.')) {
      return;
    }
    try {
      setIsCancelling(true);
      const res = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
      if (res.ok) {
        setJob(j => ({ ...j, status: 'failed' }));
      } else {
        alert('Failed to cancel job');
      }
    } catch (err) {
      console.error('Error cancelling job:', err);
      alert('Error cancelling job');
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleExportGLDetails() {
    try {
      setIsExporting(true);
      const csvContent = generateGLSyncCSV(job.id, job.label, glDetails);
      const filename = generateFilename(`gl-sync-${job.label?.replace(/\s+/g, '-')}`);
      downloadCSV(csvContent, filename);
    } catch (err) {
      console.error('Error exporting GL details:', err);
      alert('Failed to export GL details');
    } finally {
      setIsExporting(false);
    }
  }

  function openStream() {
    const es = new EventSource(`/api/stream/${id}`);
    esRef.current = es;

    es.addEventListener('snapshot', e => {
      setJob(JSON.parse(e.data));
    });

    // Helper to prevent duplicate log entries (check last 5 entries for same text within ~2 seconds)
    const addUniqueLogEntry = (entry) => {
      setLog(l => {
        const now = new Date(entry.ts).getTime();
        const recentDuplicate = l.slice(-5).some(e => e.text === entry.text && Math.abs(new Date(e.ts).getTime() - now) < 2000);
        return recentDuplicate ? l : [...l, entry];
      });
    };

    es.addEventListener('item_start', e => {
      const { name } = JSON.parse(e.data);
      const newEntry = { ts: new Date().toISOString(), text: `→ Starting: ${name}` };
      addUniqueLogEntry(newEntry);
      setJob(j => updateItem(j, name, 'running'));
    });

    es.addEventListener('item_done', e => {
      const { name } = JSON.parse(e.data);
      const newEntry = { ts: new Date().toISOString(), text: `✓ Done: ${name}` };
      addUniqueLogEntry(newEntry);
      setJob(j => {
        const updated = updateItem(j, name, 'success');
        // Calculate completed and failed from actual item statuses
        const completed = (updated.items || []).filter(i => i.status === 'success').length;
        const failed = (updated.items || []).filter(i => i.status === 'failed').length;
        return { ...updated, completed, failed };
      });
    });

    es.addEventListener('item_fail', e => {
      const { name, error } = JSON.parse(e.data);
      const newEntry = { ts: new Date().toISOString(), text: `✗ Failed: ${name} — ${error}` };
      addUniqueLogEntry(newEntry);
      setJob(j => {
        const updated = updateItem(j, name, 'failed');
        // Calculate completed and failed from actual item statuses
        const completed = (updated.items || []).filter(i => i.status === 'success').length;
        const failed = (updated.items || []).filter(i => i.status === 'failed').length;
        return { ...updated, completed, failed };
      });
    });

    es.addEventListener('job_done', () => {
      const newEntry = { ts: new Date().toISOString(), text: '══ Job complete ══' };
      addUniqueLogEntry(newEntry);
      setJob(j => ({ ...j, status: 'done' }));

      // Refetch GL sync details when job completes
      if (id) {
        fetch(`/api/jobs/${id}/gl-details`)
          .then(r => r.json())
          .then(detailsData => {
            setGlDetails(detailsData.details || []);
          })
          .catch(err => console.error('Failed to load GL details:', err));
      }

      es.close();
    });

    es.addEventListener('job_error', e => {
      const { error } = JSON.parse(e.data);
      const newEntry = { ts: new Date().toISOString(), text: `✗ Job error: ${error}` };
      addUniqueLogEntry(newEntry);
      setJob(j => ({ ...j, status: 'failed' }));
      es.close();
    });

    es.onerror = () => {
      // SSE closed by server after job_done — ignore
    };
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading job details...</p>
      </div>
    );
  }

  const pct = job.total > 0 ? Math.round(((job.completed || 0) / job.total) * 100) : 0;
  const isRunning = job.status === 'running' || job.status === 'queued' || job.status === 'paused';
  const statusConfig = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.queued;

  return (
    <div>
      {/* Back link */}
      <Link to="/" className="text-accent-500 hover:text-accent-600 text-sm font-medium mb-6 inline-flex items-center gap-2">
        ← Back to Dashboard
      </Link>

      {/* Job header card */}
      <div className="card mb-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-primary-900">{job.label}</h1>
            <p className="text-neutral-600 text-sm mt-2">
              {job.type} • {formatLocalTime(job.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`badge ${statusConfig.badge}`}>
              {statusConfig.text}
            </span>

            {/* Pause/Resume Button */}
            {(job.status === 'running' || job.status === 'paused') && (
              <button
                onClick={job.status === 'paused' ? handleResume : handlePause}
                disabled={isPausing || isCancelling}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  job.status === 'paused'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isPausing ? '⏳' : (job.status === 'paused' ? '▶ Resume' : '⏸ Pause')}
              </button>
            )}

            {/* Cancel Button */}
            {(job.status === 'running' || job.status === 'paused' || job.status === 'queued') && (
              <button
                onClick={handleCancel}
                disabled={isCancelling || isPausing}
                className="px-3 py-1 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? '⏳' : '✕ Cancel'}
              </button>
            )}
          </div>
        </div>

        {/* Progress section */}
        <div>
          <div className="progress-bar mb-3">
            <div
              className="progress-bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm text-neutral-600">
            <span>
              <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
              <strong className="text-primary-900">{job.total}</strong> completed
              {(job.failed || 0) > 0 && (
                <strong className="text-error ml-3">
                  {job.failed} failed
                </strong>
              )}
            </span>
            <span className="font-semibold text-primary-900">{pct}%</span>
          </div>
        </div>
      </div>


      {/* Live Log (for in-progress sync-gl-accounts jobs) */}
      {job.type === 'sync-gl-accounts' && isRunning && (
        <div className="card mt-6">
          <h3 className="font-semibold text-primary-900 mb-4">Live Log</h3>
          <div
            ref={logRef}
            className="bg-neutral-900 text-neutral-100 rounded p-4 font-mono text-sm h-64 overflow-y-auto"
          >
            {log.length === 0 ? (
              <p className="text-neutral-500">Waiting for job to start...</p>
            ) : (
              log.map((entry, idx) => (
                <div key={idx} className="mb-1">
                  <span className="text-neutral-400">{formatLocalTimeOnly(entry.ts)}</span>{' '}
                  <span className="text-neutral-100">{entry.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* GL Sync Details (for completed sync-gl-accounts jobs) */}
      {job.type === 'sync-gl-accounts' && !isRunning && glDetails.length > 0 && (
        <div className="card mt-6">
          <button
            onClick={() => setShowGlDetails(!showGlDetails)}
            className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100 rounded border border-neutral-200 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{showGlDetails ? '▼' : '▶'}</span>
              <div className="text-left">
                <h3 className="font-semibold text-primary-900">GL Account Sync Details</h3>
                <p className="text-xs text-neutral-600">{glDetails.length} account updates recorded</p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleExportGLDetails();
              }}
              disabled={isExporting}
              className="px-4 py-2 rounded font-semibold bg-success hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? '⏳ Exporting...' : '📥 Export CSV'}
            </button>
          </button>

          {showGlDetails && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-100 border-t border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Item Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Field Changed</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Old Value</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">New Value</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Synced At</th>
                  </tr>
                </thead>
                <tbody>
                  {glDetails.map((detail, idx) => (
                    <tr key={idx} className={`border-t border-neutral-200 ${detail.status === 'failed' ? 'bg-red-50' : 'hover:bg-neutral-50'}`}>
                      <td className="px-4 py-3 text-neutral-700">{detail.account_name || '—'}</td>
                      <td className="px-4 py-3 text-neutral-700">{detail.field_changed || '—'}</td>
                      <td className="px-4 py-3 text-neutral-600 font-mono text-xs">{detail.old_value || '—'}</td>
                      <td className="px-4 py-3 text-neutral-600 font-mono text-xs">{detail.new_value || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          detail.status === 'success' ? 'bg-green-100 text-green-800' :
                          detail.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {detail.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 text-xs">{formatLocalTimeOnly(detail.synced_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

function updateItem(job, name, status) {
  if (!job) return job;
  return {
    ...job,
    items: (job.items || []).map(item =>
      item.name === name ? { ...item, status } : item
    ),
  };
}
