import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';

const ICONS = {
  pending: '○',
  running: '◉',
  success: '✓',
  failed:  '✗',
};

const ITEM_COLORS = {
  pending: 'text-muted',
  running: 'text-warn',
  success: 'text-accent',
  failed:  'text-danger',
};

export default function JobDetail() {
  const { id }           = useParams();
  const [job, setJob]    = useState(null);
  const [log, setLog]    = useState([]);
  const logRef           = useRef(null);
  const esRef            = useRef(null);

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
        if (data.status === 'done' || data.status === 'failed') return; // no SSE needed
        openStream();
      });

    return () => esRef.current?.close();
  }, [id]);

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
    return <div className="text-muted font-display text-sm mt-12 text-center">Loading...</div>;
  }

  const pct = job.total > 0 ? Math.round(((job.completed || 0) / job.total) * 100) : 0;
  const isRunning = job.status === 'running' || job.status === 'queued';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back */}
      <Link to="/" className="font-display text-xs text-muted hover:text-white transition-colors mb-6 inline-block">
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="bg-panel border border-border rounded-lg p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-body text-white text-base font-medium">{job.label}</h1>
            <div className="font-display text-xs text-muted mt-1">
              {job.type} · {new Date(job.created_at).toLocaleString()}
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-border rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between font-display text-xs text-muted">
          <span>
            {job.completed || 0} done
            {(job.failed || 0) > 0 && (
              <span className="text-danger ml-3">{job.failed} failed</span>
            )}
          </span>
          <span>{pct}% · {job.total} total</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Community list */}
        <div className="bg-panel border border-border rounded-lg p-4">
          <div className="font-display text-xs text-muted uppercase tracking-wider mb-3">
            Communities
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {(job.items || []).map(item => (
              <div key={item.id} className="flex items-start gap-2.5">
                <span className={`font-display text-xs mt-0.5 flex-shrink-0 ${ITEM_COLORS[item.status]}`}>
                  {ICONS[item.status] || '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`font-body text-xs block truncate ${
                    item.status === 'pending' ? 'text-muted' : 'text-white'
                  }`}>
                    {item.name}
                  </span>
                  {item.error && (
                    <span className="font-display text-xs text-danger block truncate" title={item.error}>
                      {item.error}
                    </span>
                  )}
                </div>
                {item.status === 'running' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-warn pulse flex-shrink-0 mt-1.5" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live log */}
        <div className="bg-panel border border-border rounded-lg p-4 flex flex-col">
          <div className="font-display text-xs text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            Live Log
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-warn pulse" />}
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto space-y-1 max-h-96 font-display text-xs"
          >
            {log.length === 0 && (
              <div className="text-muted">
                {isRunning ? 'Waiting for events...' : 'No log for this job.'}
              </div>
            )}
            {log.map((entry, i) => (
              <div key={i} className={
                entry.text.startsWith('✓') ? 'text-accent' :
                entry.text.startsWith('✗') ? 'text-danger' :
                entry.text.startsWith('→') ? 'text-warn'   :
                'text-muted'
              }>
                <span className="text-muted mr-2">{entry.ts}</span>
                {entry.text}
              </div>
            ))}
          </div>
        </div>
      </div>
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

function StatusBadge({ status }) {
  const styles = {
    queued:  'text-muted  border-muted/30  bg-muted/10',
    running: 'text-warn   border-warn/30   bg-warn/10',
    done:    'text-accent border-accent/30 bg-accent/10',
    failed:  'text-danger border-danger/30 bg-danger/10',
  };
  return (
    <span className={`font-display text-xs border rounded px-2.5 py-1 flex-shrink-0 ${styles[status] || styles.queued}`}>
      {status}
    </span>
  );
}
