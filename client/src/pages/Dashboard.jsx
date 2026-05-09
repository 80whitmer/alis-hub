import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_CONFIG = {
  queued:  { badge: 'badge-neutral', dot: 'status-dot-pending', text: 'Queued' },
  running: { badge: 'badge-warning', dot: 'status-dot-running', text: 'Running' },
  done:    { badge: 'badge-success', dot: 'status-dot-active', text: 'Completed' },
  failed:  { badge: 'badge-error', dot: 'status-dot-error', text: 'Failed' },
};

export default function Dashboard() {
  const [jobs, setJobs]       = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = () =>
    fetch('/api/jobs')
      .then(r => r.json())
      .then(data => { setJobs(data); setLoading(false); });

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 3000); // poll while jobs may be running
    return () => clearInterval(t);
  }, []);

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

          return (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="card hover:shadow-base transition-all duration-200"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Status indicator */}
                  <span className={`status-dot ${config.dot} flex-shrink-0`}></span>

                  {/* Job label */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-primary-900 truncate">
                      {job.label}
                    </h3>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Status badge */}
                <span className={`badge ${config.badge} flex-shrink-0`}>
                  {config.text}
                </span>
              </div>

              {/* Progress bar */}
              {job.total > 0 && (
                <div className="mb-3">
                  <div className="progress-bar">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center mt-2 text-xs text-neutral-500">
                    <span>{job.completed}/{job.total} completed</span>
                    <span className="font-medium">{pct}%</span>
                    {job.failed > 0 && (
                      <span className="text-error font-medium">{job.failed} failed</span>
                    )}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
