import { useEffect, useRef, useState } from 'react';

/**
 * "Callout of what percentage of ALIS live environments have those
 * specific entitlements enabled" (Aaron, Sep 2026) — ported from
 * alis-product-ops's PortfolioEntitlementsSection.jsx. A manual, on-demand
 * portfolio-wide scrape, not folded into either dashboard's regular
 * refresh, since a real ALIS admin login+scrape per account is slow and
 * this should only hit production when asked. Shared by both dashboards
 * (the underlying alis_admin_ids table and entitlement_snapshots are
 * portfolio-wide, not per-page) — only covers accounts with an ALIS Admin
 * Company ID on file; see AlisAdminIdDiscovery to grow that coverage.
 */

const POLL_MS = 3000;

function StatusBanner({ job }) {
  if (job.status === 'idle' && job.snapshotCompanyCount === 0) {
    return <p className="text-sm text-neutral-500 italic">No portfolio entitlement check has been run yet.</p>;
  }
  if (job.status === 'running') {
    return (
      <div className="text-sm text-neutral-600 mb-3">
        <p>Checking {job.processed} of {job.total}{job.currentCompany ? ` — currently on ${job.currentCompany}` : ''}…</p>
        <div className="w-full h-2 bg-neutral-100 rounded-full mt-1.5 overflow-hidden">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%` }} />
        </div>
        {job.errors.length > 0 && <p className="text-xs text-error mt-1">{job.errors.length} account(s) failed so far (stale ALIS Admin Company ID, or the account no longer exists in ALIS).</p>}
      </div>
    );
  }
  return (
    <p className="text-sm text-neutral-500 mb-3">
      Last run covered {job.snapshotCompanyCount} account{job.snapshotCompanyCount === 1 ? '' : 's'}
      {job.finishedAt ? ` — finished ${new Date(job.finishedAt).toLocaleString()}` : ''}.
      {job.errors.length > 0 && ` ${job.errors.length} account(s) failed.`}
    </p>
  );
}

function CategoryBlock({ category }) {
  const [open, setOpen] = useState(false);
  const avgPct = category.flags.length > 0
    ? Math.round((category.flags.reduce((s, f) => s + f.pctEnabled, 0) / category.flags.length) * 10) / 10
    : 0;
  return (
    <div className="border border-neutral-200 rounded-lg p-3 mb-2">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <strong className="text-sm">{category.name}</strong>
        <span className="text-xs text-neutral-500">{category.flags.length} flag{category.flags.length === 1 ? '' : 's'} · avg {avgPct}% enabled</span>
        <span className="text-xs text-neutral-400 ml-auto">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
              <th className="pb-1">Flag</th><th className="pb-1">Enabled</th><th className="pb-1">% of checked environments</th>
            </tr>
          </thead>
          <tbody>
            {category.flags.map((f) => (
              <tr key={f.flagId} className="border-t border-neutral-100">
                <td className="py-1.5">{f.label}</td>
                <td className="py-1.5 text-neutral-500">{f.enabledCount} of {f.totalCount}</td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-neutral-100 rounded-full overflow-hidden">
                      <div className="h-full bg-accent-500" style={{ width: `${f.pctEnabled}%` }} />
                    </div>
                    <span className="text-xs text-neutral-500">{f.pctEnabled}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function PortfolioEntitlementsSection({ accounts }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  async function poll() {
    try {
      const res = await fetch('/api/account-truth/portfolio-entitlements/status');
      const s = await res.json();
      setStatus(s);
      if (s.job.status === 'running') pollRef.current = setTimeout(poll, POLL_MS);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    poll();
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alisAdminIdCount = accounts.filter((a) => a.alis_admin_company_id).length;

  async function handleRun() {
    setStarting(true);
    setError(null);
    try {
      const slim = accounts.map((a) => ({ id: a.hubspot_company_id, name: a.company_name }));
      const res = await fetch('/api/account-truth/portfolio-entitlements/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: slim }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      poll();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  const job = status?.job;
  const rollup = status?.rollup;
  const running = job?.status === 'running';

  return (
    <div>
      <p className="text-xs text-neutral-500 mb-3">
        {alisAdminIdCount} account{alisAdminIdCount === 1 ? '' : 's'} currently have an ALIS Admin Company ID on file — only those are covered by this check.
      </p>
      <button className="btn btn-secondary btn-sm mb-3" onClick={handleRun} disabled={running || starting || alisAdminIdCount === 0}>
        {running ? 'Running…' : starting ? 'Starting…' : 'Run Portfolio Entitlement Check'}
      </button>
      {error && <div className="text-xs text-error mb-3">{error}</div>}
      {job && <StatusBanner job={job} />}
      {rollup && rollup.categories.length > 0 && (
        <div className="mt-2">
          {rollup.categories.map((c) => <CategoryBlock key={c.name} category={c} />)}
        </div>
      )}
    </div>
  );
}
