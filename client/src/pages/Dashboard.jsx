import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatLocalTime } from '../utils/timezone';
import BackToTopButton from '../components/BackToTopButton';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  queued:  { badge: 'badge-neutral',  text: 'Queued'    },
  running: { badge: 'badge-warning',  text: 'Running'   },
  paused:  { badge: 'badge-info',     text: 'Paused'    },
  done:    { badge: 'badge-success',  text: 'Completed' },
  failed:  { badge: 'badge-error',    text: 'Failed'    },
};

const ITEM_STATUS = {
  pending: { icon: '○', color: 'text-neutral-400' },
  running: { icon: '◉', color: 'text-yellow-500'  },
  success: { icon: '✓', color: 'text-green-600'   },
  failed:  { icon: '✗', color: 'text-red-500'     },
};

// ─── Job Detail Drawer ────────────────────────────────────────────────────────
function JobDrawer({ jobId, onClose }) {
  const [job,       setJob]       = useState(null);
  const [glDetails, setGlDetails] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    setJob(null);
    setGlDetails([]);

    fetch(`/api/jobs/${jobId}`)
      .then(r => r.json())
      .then(async data => {
        setJob(data);
        if (data.type === 'sync-gl-accounts') {
          const gld = await fetch(`/api/jobs/${jobId}/gl-details`).then(r => r.json());
          setGlDetails(gld.details || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [jobId]);

  // Refresh while job is running
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const t = setInterval(() => {
      fetch(`/api/jobs/${jobId}`)
        .then(r => r.json())
        .then(data => setJob(data));
    }, 2000);
    return () => clearInterval(t);
  }, [job?.status, jobId]);

  const statusCfg = STATUS_CONFIG[job?.status] || STATUS_CONFIG.queued;
  const pct = job?.total > 0 ? Math.round(((job.completed || 0) / job.total) * 100) : 0;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col">

        {/* Drawer header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-neutral-200 shrink-0">
          <div className="min-w-0">
            {loading ? (
              <div className="h-5 w-48 bg-neutral-200 rounded animate-pulse mb-2" />
            ) : (
              <>
                <h2 className="text-lg font-bold text-primary-900 leading-tight">{job?.label}</h2>
                <p className="text-xs text-neutral-500 mt-1">
                  {job?.type} · {job && formatLocalTime(job.created_at)}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {job && <span className={`badge ${statusCfg.badge}`}>{statusCfg.text}</span>}
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-700 transition-colors p-1 rounded"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Drawer body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-12 bg-neutral-100 rounded animate-pulse" />
              ))}
            </div>
          ) : job?.type === 'create-communities' ? (
            <CommunitiesDetail job={job} pct={pct} />
          ) : job?.type === 'sync-gl-accounts' ? (
            <GLSyncDetail job={job} pct={pct} glDetails={glDetails} />
          ) : job?.type === 'kpi-export' ? (
            <KpiExportDetail job={job} pct={pct} />
          ) : job?.type === 'wellness-scorecard' ? (
            <WellnessScorecardDetail job={job} pct={pct} />
          ) : job?.type === 'community-revenue-snapshot' ? (
            <CommunityRevenueSnapshotDetail job={job} pct={pct} />
          ) : job?.type === 'company-usage-audit' ? (
            <UsageAuditDetail job={job} pct={pct} />
          ) : job?.type === 'audit-history' ? (
            <AuditHistoryDetail job={job} pct={pct} />
          ) : (
            <p className="text-neutral-500 text-sm">No detail view for this job type.</p>
          )}
        </div>

        {/* Footer link */}
        {job && (
          <div className="px-6 py-4 border-t border-neutral-200 shrink-0">
            <Link
              to={`/jobs/${job.id}`}
              onClick={onClose}
              className="text-sm text-accent-600 hover:text-accent-700 font-medium"
            >
              Open full job page →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Create Communities detail view ─────────────────────────────────────────
function CommunitiesDetail({ job, pct }) {
  const communities = job.payload?.communities || [];
  const items       = job.items || [];

  // Merge payload data with execution status
  const rows = communities.map(comm => {
    const item = items.find(i => i.name === comm.name) || {};
    return { ...comm, status: item.status || 'pending', error: item.error || null };
  });

  return (
    <div>
      {/* Progress summary */}
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> communities created
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {/* Company URL */}
      {job.payload?.companyUrl && (
        <div className="mb-4 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">Company URL: </span>
          <span className="font-mono break-all">{job.payload.companyUrl}</span>
        </div>
      )}

      {/* Communities table */}
      <h3 className="text-sm font-semibold text-primary-900 mb-3">
        Communities ({rows.length})
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No communities in payload.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((comm, i) => {
            const st = ITEM_STATUS[comm.status] || ITEM_STATUS.pending;
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 ${
                  comm.status === 'failed'  ? 'border-red-200 bg-red-50' :
                  comm.status === 'success' ? 'border-green-200 bg-green-50' :
                  'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary-900 truncate">{comm.name}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {[comm.street, comm.city, comm.state, comm.zip].filter(Boolean).join(', ')}
                    </p>
                    {comm.licensed_capacity && (
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Capacity: {comm.licensed_capacity}
                        {comm.crm_id && <span className="ml-2">CRM: {comm.crm_id}</span>}
                      </p>
                    )}
                    {comm.error && (
                      <p className="text-xs text-red-600 mt-1">⚠ {comm.error}</p>
                    )}
                  </div>
                  <span className={`text-sm font-bold shrink-0 ${st.color}`}>{st.icon}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── GL Sync detail view ─────────────────────────────────────────────────────
function GLSyncDetail({ job, pct, glDetails }) {
  return (
    <div>
      {/* Progress summary */}
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> items synced
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {/* GL details table */}
      {glDetails.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {job.status === 'done' ? 'No GL sync records found.' : 'GL sync records will appear when the job completes.'}
        </p>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-primary-900 mb-3">
            GL Account Changes ({glDetails.length})
          </h3>
          <div className="space-y-2">
            {glDetails.map((d, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 text-xs ${
                  d.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-neutral-200 bg-white'
                }`}
              >
                <p className="font-semibold text-primary-900 text-sm mb-1">{d.account_name || '—'}</p>
                <div className="grid grid-cols-3 gap-2 text-neutral-600">
                  <div>
                    <p className="text-neutral-400 uppercase tracking-wide text-[10px]">Field</p>
                    <p className="font-mono">{d.field_changed || '—'}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400 uppercase tracking-wide text-[10px]">Old</p>
                    <p className="font-mono text-red-600">{d.old_value || '—'}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400 uppercase tracking-wide text-[10px]">New</p>
                    <p className="font-mono text-green-700">{d.new_value || '—'}</p>
                  </div>
                </div>
                {d.error && <p className="text-red-600 mt-1">⚠ {d.error}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── KPI export detail view ──────────────────────────────────────────────────
function KpiExportDetail({ job, pct }) {
  return (
    <div>
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> communities pulled
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {job.status === 'done' ? (
        <Link to={`/qbr/${job.id}`} className="btn btn-accent">📊 Open QBR Dashboard →</Link>
      ) : (
        <p className="text-sm text-neutral-400">KPI dashboard will be available once the job completes.</p>
      )}
    </div>
  );
}

// ─── Wellness scorecard detail view ──────────────────────────────────────────
function WellnessScorecardDetail({ job, pct }) {
  return (
    <div>
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> communities pulled
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {job.status === 'done' ? (
        <Link to={`/wellness/${job.id}`} className="btn btn-accent">🩺 Open Wellness Scorecard →</Link>
      ) : (
        <p className="text-sm text-neutral-400">Wellness scorecard will be available once the job completes.</p>
      )}
    </div>
  );
}

// ─── Community Revenue & Occupancy Snapshot detail view ──────────────────────
// Unlike kpi-export/wellness-scorecard, this job has no job-id-scoped page of
// its own — the Account Health Dashboard's "Community Revenue & Occupancy"
// section (client/src/components/CommunityRevenueSection.jsx) reads the
// latest stored month straight from community_revenue_snapshots rather than
// one job's results, so the link here goes to that section rather than a
// per-job route. (It also surfaces on the KPI/QBR Dashboard for whichever
// single account it was run for, once cached.)
function CommunityRevenueSnapshotDetail({ job, pct }) {
  return (
    <div>
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> communities pulled
            {job.payload?.month && <> for <strong className="text-primary-900">{job.payload.month}</strong></>}
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {job.status === 'done' ? (
        <>
          <Link to="/" className="btn btn-accent">📈 Open Account Health Dashboard →</Link>
          <p className="text-xs text-neutral-400 mt-2">Look for the "Community Revenue &amp; Occupancy" section (collapsed by default) — it always shows the latest month with a snapshot, month-over-month vs. the prior month's run. It also appears on this account's KPI/QBR Dashboard, once one exists.</p>
        </>
      ) : (
        <p className="text-sm text-neutral-400">Results will be available on the Account Health Dashboard once the job completes.</p>
      )}
    </div>
  );
}

// ─── Company/Community ALIS usage audit detail view ──────────────────────────
function UsageAuditDetail({ job, pct }) {
  return (
    <div>
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> communities pulled
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {job.status === 'done' ? (
        <Link to={`/usage-audit/${job.id}`} className="btn btn-accent">🔍 Open Usage Audit →</Link>
      ) : (
        <p className="text-sm text-neutral-400">Usage audit will be available once the job completes.</p>
      )}
    </div>
  );
}

// ─── ALIS Audit History detail view ──────────────────────────────────────────
function AuditHistoryDetail({ job, pct }) {
  return (
    <div>
      <div className="mb-5 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{job.completed || 0}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> target(s) pulled
          </span>
          <span className="font-semibold text-primary-900">{pct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.failed || 0) > 0 && (
          <p className="text-xs text-red-600 mt-2">{job.failed} failed</p>
        )}
      </div>

      {job.status === 'done' ? (
        <Link to={`/audit-history/${job.id}`} className="btn btn-accent">🕵 Open Audit History →</Link>
      ) : (
        <p className="text-sm text-neutral-400">Audit history will be available once the job completes.</p>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [jobs,        setJobs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState(new Set());
  const [drawerJobId, setDrawerJobId] = useState(null);
  const [cancelling,  setCancelling]  = useState(null);

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState({ show: false, jobId: null, jobLabel: null });
  const [deleting,    setDeleting]    = useState(false);

  // Bulk delete modal
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
  const [bulkDeleting,    setBulkDeleting]    = useState(false);

  const fetchJobs = useCallback(() =>
    fetch('/api/jobs')
      .then(r => r.json())
      .then(data => { setJobs(data); setLoading(false); }),
  []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 3000);
    return () => clearInterval(t);
  }, [fetchJobs]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleSelect(e, jobId) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(prev =>
      prev.size === filteredJobs.length ? new Set() : new Set(filteredJobs.map(j => j.id))
    );
  }

  // ── Single delete ──────────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteModal.jobId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${deleteModal.jobId}`, { method: 'DELETE' });
      if (res.ok) {
        setJobs(j => j.filter(job => job.id !== deleteModal.jobId));
        setSelected(prev => { const n = new Set(prev); n.delete(deleteModal.jobId); return n; });
        setDeleteModal({ show: false, jobId: null, jobLabel: null });
        if (drawerJobId === deleteModal.jobId) setDrawerJobId(null);
      } else {
        alert('Failed to delete job');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // ── Bulk delete ────────────────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await Promise.all([...selected].map(id =>
        fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      ));
      setJobs(j => j.filter(job => !selected.has(job.id)));
      if (selected.has(drawerJobId)) setDrawerJobId(null);
      setSelected(new Set());
      setBulkDeleteModal(false);
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Cancel job ─────────────────────────────────────────────────────────────
  const handleCancelJob = async (e, jobId) => {
    e.stopPropagation();
    setCancelling(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      if (res.ok) {
        setJobs(j => j.map(job => job.id === jobId ? { ...job, status: 'failed' } : job));
      } else {
        alert('Failed to cancel job');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCancelling(null);
    }
  };

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading jobs...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center">
        <h2 className="text-2xl font-bold text-primary-900 mb-4">No jobs yet</h2>
        <p className="text-neutral-600 mb-6">Create your first automation job to get started</p>
        <Link to="/new-job" className="btn btn-primary btn-lg">+ Create Job</Link>
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const filteredJobs = query
    ? jobs.filter(j => j.label?.toLowerCase().includes(query) || j.type?.toLowerCase().includes(query))
    : jobs;

  const allSelected = selected.size === filteredJobs.length && filteredJobs.length > 0;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="flex items-center gap-3 text-5xl font-bold text-primary-900">
            <img src="/butterfly-icon.png" alt="" className="h-11 w-auto" />
            Job Board
          </h1>
          <p className="text-sm text-neutral-500 mt-2">
            {query ? `${filteredJobs.length} of ${jobs.length}` : jobs.length} job{(query ? filteredJobs.length : jobs.length) === 1 ? '' : 's'} tracked
          </p>
          <p className="text-xs text-accent-600 font-medium mt-1">
            Every automation job, from kickoff to done
          </p>
        </div>
        <Link to="/new-job" className="btn btn-accent">+ New Job</Link>
      </div>

      {/* Company search */}
      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search jobs by company... (e.g. Viva, Imagine)"
          className="pl-9 pr-8 w-full max-w-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 text-sm px-1"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Bulk action toolbar — appears when jobs are selected */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between mb-4 px-4 py-3 bg-primary-50 border border-primary-200 rounded-lg">
          <span className="text-sm font-medium text-primary-800">
            {selected.size} job{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-primary-600 hover:text-primary-800 font-medium"
            >
              Clear selection
            </button>
            <button
              onClick={() => setBulkDeleteModal(true)}
              className="btn btn-sm btn-danger"
            >
              🗑 Delete {selected.size} job{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Select-all row */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          className="w-4 h-4 rounded cursor-pointer accent-primary-600"
          title={allSelected ? 'Deselect all' : 'Select all'}
        />
        <span className="text-xs text-neutral-500 select-none">
          {allSelected ? 'Deselect all' : 'Select all'}
        </span>
      </div>

      {/* Job cards */}
      {filteredJobs.length === 0 ? (
        <p className="text-sm text-neutral-500 py-8 text-center">
          No jobs match "{search}".
        </p>
      ) : (
      <div className="space-y-3">
        {filteredJobs.map(job => {
          const config    = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
          const pct       = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
          const isRunning = job.status === 'running' || job.status === 'queued';
          const isChecked = selected.has(job.id);

          return (
            <div
              key={job.id}
              onClick={() => setDrawerJobId(job.id)}
              className={`card cursor-pointer transition-all duration-150 ${
                isChecked
                  ? 'border-primary-300 bg-primary-50 shadow-sm'
                  : 'hover:border-neutral-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <div className="pt-0.5 shrink-0" onClick={e => toggleSelect(e, job.id)}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="w-4 h-4 rounded cursor-pointer accent-primary-600"
                  />
                </div>

                {/* Card body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-primary-900 truncate text-base leading-snug">
                        {job.label}
                      </h3>
                      <p className="text-xs text-neutral-500 mt-1">
                        {job.type} · {formatLocalTime(job.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`badge ${config.badge}`}>{config.text}</span>

                      {isRunning && (
                        <button
                          onClick={e => handleCancelJob(e, job.id)}
                          disabled={cancelling === job.id}
                          className="btn btn-sm bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
                        >
                          {cancelling === job.id ? '⏳' : '⏸ Cancel'}
                        </button>
                      )}

                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteModal({ show: true, jobId: job.id, jobLabel: job.label });
                        }}
                        className="btn btn-sm btn-ghost text-error hover:bg-red-50"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {job.total > 0 && (
                    <div>
                      <div className="progress-bar mb-1.5">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-neutral-500">
                        <span>{job.completed}/{job.total} completed{job.failed > 0 && <span className="text-error ml-2">{job.failed} failed</span>}</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                    </div>
                  )}

                  {/* Why did this fail? — the job's fatal error, persisted
                      server-side (see setJobStatus's error param) so it's
                      still here after the run that produced it is long
                      gone, not just a live SSE event nobody was watching. */}
                  {job.status === 'failed' && job.error && (
                    <details className="mt-2" onClick={e => e.stopPropagation()}>
                      <summary className="text-xs text-error cursor-pointer select-none hover:underline">
                        Why did this fail?
                      </summary>
                      <pre className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                        {job.error}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* ── Job Detail Drawer ── */}
      {drawerJobId && (
        <JobDrawer
          jobId={drawerJobId}
          onClose={() => setDrawerJobId(null)}
        />
      )}

      {/* ── Single Delete Modal ── */}
      {deleteModal.show && (
        <div className="modal-backdrop" onClick={() => setDeleteModal({ show: false, jobId: null, jobLabel: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-content p-8">
              <h3 className="text-xl font-bold text-primary-900 mb-3">Delete Job?</h3>
              <p className="text-neutral-700 mb-6">
                Are you sure you want to delete <strong>{deleteModal.jobLabel}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-3 justify-end pt-4 border-t border-neutral-200">
                <button
                  onClick={() => setDeleteModal({ show: false, jobId: null, jobLabel: null })}
                  disabled={deleting}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="btn btn-danger"
                >
                  {deleting ? '⏳ Deleting...' : '🗑 Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Modal ── */}
      {bulkDeleteModal && (
        <div className="modal-backdrop" onClick={() => setBulkDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-content p-8">
              <h3 className="text-xl font-bold text-primary-900 mb-3">
                Delete {selected.size} Job{selected.size !== 1 ? 's' : ''}?
              </h3>
              <p className="text-neutral-700 mb-6">
                This will permanently delete <strong>{selected.size}</strong> job{selected.size !== 1 ? 's' : ''} and all their records. This cannot be undone.
              </p>
              <div className="flex gap-3 justify-end pt-4 border-t border-neutral-200">
                <button
                  onClick={() => setBulkDeleteModal(false)}
                  disabled={bulkDeleting}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="btn btn-danger"
                >
                  {bulkDeleting ? '⏳ Deleting...' : `🗑 Delete ${selected.size} Job${selected.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <BackToTopButton />
    </div>
  );
}
