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

    es.addEventListener('item_start', e => {
      const { name } = JSON.parse(e.data);
      setLog(l => [...l, { ts: timestamp(), text: `→ Starting: ${name}` }]);
      setJob(j => updateItem(j, name, 'running'));
    });

    es.addEventListener('item_done', e => {
      const { name } = JSON.parse(e.data);
      setLog(l => [...l, { ts: timestamp(), text: `✓ Done: ${name}` }]);
      setJob(j => {
        const updated = updateItem(j, name, 'success');
        return { ...updated, completed: (updated.completed || 0) + 1 };
      });
    });

    es.addEventListener('item_fail', e => {
      const { name, error } = JSON.parse(e.data);
      setLog(l => [...l, { ts: timestamp(), text: `✗ Failed: ${name} — ${error}` }]);
      setJob(j => {
        const updated = updateItem(j, name, 'failed');
        return { ...updated, failed: (updated.failed || 0) + 1 };
      });
    });

    es.addEventListener('job_done', () => {
      setLog(l => [...l, { ts: timestamp(), text: '══ Job complete ══' }]);
      setJob(j => ({ ...j, status: 'done' }));
      es.close();
    });

    es.addEventListener('job_error', e => {
      const { error } = JSON.parse(e.data);
      setLog(l => [...l, { ts: timestamp(), text: `✗ Job error: ${error}` }]);
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

      {/* Communities and Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Communities list */}
        <div className="lg:col-span-1">
          <div className="card h-full flex flex-col">
            <h2 className="font-semibold text-primary-900 mb-4">Communities</h2>
            <div className="space-y-2 overflow-y-auto flex-1">
              {(job.items || []).length === 0 ? (
                <p className="text-neutral-500 text-sm">No items yet</p>
              ) : (
                (job.items || []).map(item => {
                  const config = ITEM_CONFIG[item.status] || ITEM_CONFIG.pending;
                  return (
                    <div key={item.id} className="flex items-start gap-2.5 text-sm pb-2 border-b border-neutral-200 last:border-0">
                      <span className={`flex-shrink-0 font-mono ${
                        item.status === 'pending' ? 'text-neutral-400' :
                        item.status === 'running' ? 'text-warning animate-pulse' :
                        item.status === 'success' ? 'text-success font-bold' :
                        'text-error font-bold'
                      }`}>
                        {config.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${
                          item.status === 'pending' ? 'text-neutral-600' : 'text-primary-900'
                        }`}>
                          {item.name}
                        </p>
                        {item.error && (
                          <p className="text-xs text-error mt-0.5 truncate" title={item.error}>
                            {item.error}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Live log */}
        <div className="lg:col-span-2">
          <div className="card h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-primary-900">Live Log</h2>
              {isRunning && (
                <span className="flex items-center gap-2 text-xs">
                  <span className="status-dot status-dot-running"></span>
                  <span className="text-warning">Live</span>
                </span>
              )}
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs text-neutral-600 bg-neutral-50 p-4 rounded border border-neutral-200"
            >
              {log.length === 0 && (
                <div className="text-neutral-400">
                  {isRunning ? 'Waiting for events...' : 'No events logged'}
                </div>
              )}
              {log.map((entry, i) => {
                const isSuccess = entry.text.startsWith('✓');
                const isError = entry.text.startsWith('✗');
                const isStart = entry.text.startsWith('→');

                return (
                  <div
                    key={i}
                    className={`${
                      isSuccess ? 'text-success' :
                      isError ? 'text-error' :
                      isStart ? 'text-warning' :
                      'text-neutral-600'
                    }`}
                  >
                    <span className="text-neutral-400 mr-3">{entry.ts}</span>
                    {entry.text}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* GL Sync Details (for sync-gl-accounts jobs only) */}
      {job.type === 'sync-gl-accounts' && glDetails.length > 0 && (
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
              className="px-3 py-1 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? '⏳ Exporting...' : '📥 Export CSV'}
            </button>
          </button>

          {showGlDetails && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-100 border-t border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Account #</th>
                    <th className="px-4 py-3 text-left font-semibold text-primary-900">Account Name</th>
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
                      <td className="px-4 py-3 text-neutral-900 font-mono text-xs">{detail.account_number || '—'}</td>
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
