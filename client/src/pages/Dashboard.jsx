import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_CONFIG = {
  queued:  { badge: 'badge-neutral', text: 'Queued' },
  running: { badge: 'badge-warning', text: 'Running' },
  done:    { badge: 'badge-success', text: 'Completed' },
  failed:  { badge: 'badge-error', text: 'Failed' },
};

export default function Dashboard() {
  const [jobs, setJobs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteModal, setDeleteModal] = useState({ show: false, jobId: null, jobLabel: null });
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const fetchJobs = () =>
    fetch('/api/jobs')
      .then(r => r.json())
      .then(data => { setJobs(data); setLoading(false); });

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 3000); // poll while jobs may be running
    return () => clearInterval(t);
  }, []);

  const handleDeleteClick = (jobId, jobLabel) => {
    setDeleteModal({ show: true, jobId, jobLabel });
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal.jobId) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${deleteModal.jobId}`, { method: 'DELETE' });
      if (res.ok) {
        setJobs(jobs.filter(j => j.id !== deleteModal.jobId));
        setDeleteModal({ show: false, jobId: null, jobLabel: null });
      } else {
        alert('Failed to delete job');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelJob = async (jobId) => {
    setCancelling(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      if (res.ok) {
        // Update the job status locally while waiting for poll
        setJobs(jobs.map(j => j.id === jobId ? { ...j, status: 'failed' } : j));
      } else {
        alert('Failed to cancel job');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCancelling(null);
    }
  };

  const handleCloseModal = () => {
    setDeleteModal({ show: false, jobId: null, jobLabel: null });
  };

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
        <Link
          to="/new-job"
          className="btn btn-primary btn-lg"
        >
          + Create Job
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-primary-900">Automation Jobs</h1>
        <Link to="/new-job" className="btn btn-accent">
          + New Job
        </Link>
      </div>

      <div className="space-y-3">
        {jobs.map(job => {
          const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
          const pct = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
          const isRunning = job.status === 'running' || job.status === 'queued';

          return (
            <div
              key={job.id}
              className="card hover:shadow-base transition-all duration-200 group"
            >
              {/* Header with title and status */}
              <div className="flex items-center justify-between gap-4 mb-4">
                <Link
                  to={`/jobs/${job.id}`}
                  className="flex-1 min-w-0 cursor-pointer hover:opacity-80"
                >
                  <h3 className="font-semibold text-primary-900 truncate text-lg">
                    {job.label}
                  </h3>
                  <p className="text-sm text-neutral-500 mt-1">
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </Link>

                {/* Status badge and action buttons */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`badge ${config.badge}`}>
                    {config.text}
                  </span>

                  {/* Cancel button (only for running/queued jobs) */}
                  {isRunning && (
                    <button
                      onClick={() => handleCancelJob(job.id)}
                      disabled={cancelling === job.id}
                      className="btn btn-sm bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Cancel this job"
                    >
                      {cancelling === job.id ? '⏸ Cancelling...' : '⏸ Cancel'}
                    </button>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteClick(job.id, job.label)}
                    className="btn btn-sm btn-ghost text-error hover:bg-red-50"
                    title="Delete this job"
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              {job.total > 0 && (
                <div>
                  <div className="progress-bar mb-3">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-neutral-500">
                    <span>{job.completed}/{job.total} completed</span>
                    <span className="font-medium">{pct}%</span>
                    {job.failed > 0 && (
                      <span className="text-error font-medium">{job.failed} failed</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal.show && (
        <div className="modal-backdrop" onClick={handleCloseModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-primary-900 mb-2">
                  Delete Job?
                </h3>
                <p className="text-neutral-600 text-sm">
                  Are you sure you want to delete <strong>{deleteModal.jobLabel}</strong>? This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCloseModal}
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
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
