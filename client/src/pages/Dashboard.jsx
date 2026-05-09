import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_COLORS = {
  queued:  'text-muted',
  running: 'text-warn',
  done:    'text-accent',
  failed:  'text-danger',
};

const STATUS_DOT = {
  queued:  'bg-muted',
  running: 'bg-warn pulse',
  done:    'bg-accent',
  failed:  'bg-danger',
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
      <div className="text-muted font-display text-sm mt-12 text-center">
        Loading...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="max-w-xl mx-auto mt-24 text-center">
        <p className="text-muted font-display text-sm mb-4">No jobs yet.</p>
        <Link
          to="/new-job"
          className="inline-block bg-accent text-ink font-display text-sm font-medium px-5 py-2.5 rounded hover:bg-green-300 transition-colors"
        >
          + Create your first job
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-sm text-muted uppercase tracking-widest">
          Jobs
        </h1>
        <Link
          to="/new-job"
          className="bg-accent text-ink font-display text-xs font-medium px-4 py-2 rounded hover:bg-green-300 transition-colors"
        >
          + New Job
        </Link>
      </div>

      <div className="space-y-2">
        {jobs.map(job => (
          <Link
            key={job.id}
            to={`/jobs/${job.id}`}
            className="block bg-panel border border-border rounded-lg px-5 py-4 hover:border-muted transition-colors"
          >
            <div className="flex items-center gap-3">
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[job.status] || 'bg-muted'}`} />

              {/* Label */}
              <span className="font-body text-sm text-white flex-1 truncate">
                {job.label}
              </span>

              {/* Progress */}
              <span className="font-display text-xs text-muted flex-shrink-0">
                {job.completed}/{job.total}
                {job.failed > 0 && (
                  <span className="text-danger ml-2">{job.failed} failed</span>
                )}
              </span>

              {/* Status badge */}
              <span className={`font-display text-xs flex-shrink-0 ${STATUS_COLORS[job.status] || 'text-muted'}`}>
                {job.status}
              </span>
            </div>

            {/* Progress bar */}
            {job.total > 0 && (
              <div className="mt-3 h-1 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((job.completed / job.total) * 100)}%` }}
                />
              </div>
            )}

            <div className="mt-2 font-display text-xs text-muted">
              {new Date(job.created_at).toLocaleString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
