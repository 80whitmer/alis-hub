import { useEffect, useState } from 'react';

/**
 * Results view for an alert-subscriptions job, used in the Job Board side panel and on the full
 * job page: headline counts, who needs follow-up and why, a per-person rollup, and the Excel
 * download. Data comes from /api/alert-subscriptions/:jobId (the job's results.json).
 * While the job is running it refreshes every few seconds so the panel is useful mid-run.
 */
const COUNT_CARDS = [
  { key: 'set', label: 'Set', tone: 'text-green-700' },
  { key: 'partial', label: 'One route only', tone: 'text-amber-600' },
  { key: 'already-set', label: 'Already set', tone: 'text-neutral-700' },
  { key: 'dry-run', label: 'Dry run', tone: 'text-blue-700', dryOnly: true },
  { key: 'skipped-no-route', label: 'Skipped', tone: 'text-amber-600' },
  { key: 'failed', label: 'Failed', tone: 'text-red-600' },
];

export default function AlertSubscriptionsResults({ job }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const running = job.status === 'running' || job.status === 'queued';

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/alert-subscriptions/${job.id}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        if (alive) { setData(d); setError(null); }
      })
      .catch((e) => { if (alive) setError(e.message); });
    load();
    if (!running) return () => { alive = false; };
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [job.id, running]);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/alert-subscriptions/${job.id}/download`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Sentinel Event alert subscriptions${data?.dryRun ? ' (dry run)' : ''}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-neutral-500">{job.status === 'failed' && !job.completed ? (job.error || 'This run failed before processing any pairs.') : error}</p>;
  }
  if (!data) return <div className="h-24 bg-neutral-100 rounded animate-pulse" />;

  const cards = COUNT_CARDS.filter((c) => (c.dryOnly ? data.dryRun : true) && (data.counts[c.key] || c.key === 'failed' || c.key === 'set'));

  return (
    <div className="space-y-5">
      {data.dryRun && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
          Dry run — nothing was changed in ALIS.
        </div>
      )}

      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-neutral-600">
            <strong className="text-primary-900">{data.total}</strong> of{' '}
            <strong className="text-primary-900">{job.total}</strong> person/community pairs processed
            {running ? ' (running…)' : ''}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {cards.map((c) => (
            <div key={c.key} className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className={`text-xl font-bold ${c.tone}`}>{data.counts[c.key] || 0}</div>
              <div className="text-xs text-neutral-500">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={download} disabled={busy} className="btn btn-primary w-full">
        {busy ? 'Building…' : 'Download Excel report'}
      </button>
      <p className="text-xs text-neutral-500 -mt-3">Sheets: Summary by person · Needs follow-up · All results</p>

      <div>
        <h4 className="text-sm font-semibold text-primary-900 mb-2">Needs follow-up ({data.followUps.length})</h4>
        {data.followUps.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing needs follow-up.</p>
        ) : (
          <ul className="space-y-2">
            {data.followUps.map((f) => (
              <li key={`${f.person}|${f.category}`} className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                <div className="text-sm font-semibold text-primary-900">{f.person}</div>
                <div className="text-sm text-neutral-800">{f.category} <span className="text-neutral-500">· {f.communities.length} {f.communities.length === 1 ? 'community' : 'communities'}</span></div>
                <div className="text-xs text-neutral-600 mt-1">{f.action}</div>
                {f.communities.length <= 4 && <div className="text-xs text-neutral-500 mt-1">{f.communities.join(', ')}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-primary-900 mb-2">By person</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1 pr-2 font-medium">Person</th>
              <th className="py-1 px-1 font-medium text-right">Pairs</th>
              <th className="py-1 px-1 font-medium text-right">Set</th>
              <th className="py-1 px-1 font-medium text-right">1 route</th>
              <th className="py-1 pl-1 font-medium text-right">Failed</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.person} className="border-t border-neutral-100">
                <td className="py-1 pr-2 text-neutral-800">{p.person}</td>
                <td className="py-1 px-1 text-right text-neutral-600">{p.total}</td>
                <td className="py-1 px-1 text-right text-neutral-600">{(p.counts.set || 0) + (p.counts['already-set'] || 0) + (p.counts['dry-run'] || 0)}</td>
                <td className="py-1 px-1 text-right text-amber-600">{p.counts.partial || '—'}</td>
                <td className="py-1 pl-1 text-right text-red-600 font-semibold">{p.counts.failed || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
