import { useEffect, useRef, useState } from 'react';

/**
 * Portfolio-wide roll-up of the Company/Community Usage Audit tool — the
 * "compare usage levels between accounts/communities" replacement for
 * Aaron's old manually-maintained red/yellow/green client spreadsheets
 * (Sep 2026). One row per account with a combined adoption score (average of
 * % features Enabled and % features actually Used, see usageAuditScore.js),
 * expandable to that account's own communities. Same manual/on-demand
 * shape and live SSE log as PortfolioEntitlementsSection — a real ALIS
 * admin login+scrape per account is slow and shouldn't ride along on every
 * regular Refresh.
 */

const BAND_STYLES = {
  red: { bar: 'bg-error', text: 'text-error', chip: 'bg-error/10 text-error' },
  yellow: { bar: 'bg-warning', text: 'text-warning', chip: 'bg-warning/10 text-warning' },
  green: { bar: 'bg-success', text: 'text-success', chip: 'bg-success/10 text-success' },
};

function ScoreBar({ score, band }) {
  if (score == null) return <span className="text-xs text-neutral-400">No data</span>;
  const style = BAND_STYLES[band] || BAND_STYLES.red;
  return (
    <div className="flex items-center gap-2">
      <div className="w-28 h-2.5 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full ${style.bar}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-semibold ${style.text}`}>{score}%</span>
    </div>
  );
}

function Pct({ value }) {
  return value == null ? <span className="text-neutral-300">—</span> : <span>{value}%</span>;
}

function CommunityRow({ c }) {
  return (
    <tr className="border-t border-neutral-100">
      <td className="py-1.5 pl-8 text-neutral-600">{c.name}</td>
      <td className="py-1.5"><ScoreBar score={c.combinedScore} band={c.band} /></td>
      <td className="py-1.5 text-neutral-500"><Pct value={c.enabledPct} /></td>
      <td className="py-1.5 text-neutral-500"><Pct value={c.usedPct} /></td>
    </tr>
  );
}

function CompanyRow({ company }) {
  const [open, setOpen] = useState(false);
  const style = BAND_STYLES[company.band] || null;
  return (
    <>
      <tr className="border-t border-neutral-200 cursor-pointer hover:bg-neutral-50" onClick={() => setOpen((v) => !v)}>
        <td className="py-2 font-medium text-neutral-700">
          <span className="text-neutral-400 mr-1.5">{open ? '▾' : '▸'}</span>
          {company.companyName || company.companyHost}
          {style && <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.chip}`}>{company.band}</span>}
        </td>
        <td className="py-2"><ScoreBar score={company.combinedScore} band={company.band} /></td>
        <td className="py-2 text-neutral-500"><Pct value={company.enabledPct} /></td>
        <td className="py-2 text-neutral-500"><Pct value={company.usedPct} /></td>
      </tr>
      {open && company.communities.length > 0 && company.communities.map((c) => (
        <CommunityRow key={`${c.host}::${c.communityId}`} c={c} />
      ))}
      {open && company.communities.length === 0 && (
        <tr className="border-t border-neutral-100">
          <td colSpan={4} className="py-1.5 pl-8 text-xs text-neutral-400 italic">No community-level detail captured.</td>
        </tr>
      )}
    </>
  );
}

function StatusBanner({ job }) {
  if (job.status === 'idle' && job.snapshotCompanyCount === 0) {
    return <p className="text-sm text-neutral-500 italic">No portfolio usage audit has been run yet.</p>;
  }
  if (job.status === 'running') {
    return (
      <div className="text-sm text-neutral-600 mb-3">
        <p>Checking {job.processed} of {job.total}{job.currentCompany ? ` — currently on ${job.currentCompany}` : ''}…</p>
        <div className="w-full h-2 bg-neutral-100 rounded-full mt-1.5 overflow-hidden">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%` }} />
        </div>
        {job.errors.length > 0 && <p className="text-xs text-error mt-1">{job.errors.length} account(s) failed so far.</p>}
      </div>
    );
  }
  if (job.status === 'cancelled') {
    return (
      <p className="text-sm text-neutral-500 mb-3">
        Cancelled — {job.processed} of {job.total} account(s) were checked before stopping
        {job.finishedAt ? ` (${new Date(job.finishedAt).toLocaleString()})` : ''}. Results from those are still saved below.
        {job.errors.length > 0 && ` ${job.errors.length} account(s) failed.`}
      </p>
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

/** Same dark scrolling terminal-style log as PortfolioEntitlementsSection. */
function LiveLog({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div ref={ref} className="bg-neutral-900 text-emerald-300 font-mono text-xs rounded-lg p-3 mb-3 max-h-56 overflow-y-auto whitespace-pre-wrap">
      {lines.map((l, i) => (
        <div key={i} className={l.level === 'error' ? 'text-red-400' : undefined}>{l.msg}</div>
      ))}
    </div>
  );
}

export default function PortfolioUsageAuditSection({ accounts }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const esRef = useRef(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/account-truth/portfolio-usage-audit/status');
      setStatus(await res.json());
    } catch (err) {
      setError(err.message);
    }
  }

  function connectStream() {
    esRef.current?.close();
    const es = new EventSource('/api/account-truth/portfolio-usage-audit/stream');
    esRef.current = es;
    es.addEventListener('snapshot', (e) => {
      setStatus((prev) => ({ ...prev, job: JSON.parse(e.data) }));
    });
    es.addEventListener('log', (e) => {
      setLogLines((prev) => [...prev, JSON.parse(e.data)]);
    });
    es.addEventListener('complete', (e) => {
      setStatus((prev) => ({ ...prev, job: JSON.parse(e.data) }));
      es.close();
      fetchStatus(); // picks up the finished roll-up, which isn't broadcast over the stream
    });
    es.onerror = () => {
      es.close();
      fetchStatus();
    };
  }

  useEffect(() => {
    fetchStatus().then(() => connectStream());
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companyHostCount = accounts.filter((a) => a.company_host).length;

  async function handleRun() {
    setStarting(true);
    setError(null);
    setLogLines([]);
    try {
      const res = await fetch('/api/account-truth/portfolio-usage-audit/run', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      connectStream();
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch('/api/account-truth/portfolio-usage-audit/cancel', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  const job = status?.job;
  const companies = status?.rollup?.companies || [];
  const running = job?.status === 'running';

  return (
    <div>
      <p className="text-xs text-neutral-500 mb-3">
        {companyHostCount} account{companyHostCount === 1 ? '' : 's'} currently have a known ALIS Company Host on file — only those are covered by this check.
        Combined score = average of % features Enabled and % features actually Used in the last 90 days.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <button className="btn btn-secondary btn-sm" onClick={handleRun} disabled={running || starting || companyHostCount === 0}>
          {running ? 'Running…' : starting ? 'Starting…' : 'Run Portfolio Usage Audit'}
        </button>
        {running && (
          <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={cancelling || job?.status !== 'running'} title="Stops after the account currently being checked finishes — results captured so far are kept">
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
      {error && <div className="text-xs text-error mb-3">{error}</div>}
      {job && <StatusBanner job={job} />}
      <LiveLog lines={logLines} />
      {companies.length > 0 && (
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
              <th className="pb-1">Company</th>
              <th className="pb-1">Combined Score</th>
              <th className="pb-1">% Enabled</th>
              <th className="pb-1">% Used</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => <CompanyRow key={c.hubspotCompanyId} company={c} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}
