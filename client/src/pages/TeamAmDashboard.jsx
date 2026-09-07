import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, LabelList,
} from 'recharts';
import Drawer from '../components/Drawer';
import BackToTopButton from '../components/BackToTopButton';
import TopThreeEnhancementsCard from '../components/TopThreeEnhancementsCard';
import { arrayBufferToBase64 } from '../utils/base64';
import { exportUnmappedAmRecords } from '../utils/unmappedAmExport';
import { exportAtRiskAccounts } from '../utils/atRiskExport';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const BAND_COLOR = { red: '#dc2626', orange: '#ea580c', blue: '#2563eb', green: '#16a34a' };
const BAND_LABEL_TO_COLOR = { Unhealthy: 'red', 'At Risk': 'orange', Stable: 'blue', Healthy: 'green' };

function ScoreBadge({ score, band }) {
  if (score == null) return <span className="badge badge-neutral">No data</span>;
  const color = BAND_COLOR[BAND_LABEL_TO_COLOR[band]] || '#737373';
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: color }}>
      {score}
    </span>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, children, description, action }) {
  return (
    <div className="card mb-8">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
          {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function SortableHeader({ label, column, sort, onSort, className = '' }) {
  const active = sort.column === column;
  return (
    <th className={`pb-2 cursor-pointer select-none hover:text-neutral-700 ${className}`} onClick={() => onSort(column)}>
      {label}{active && <span className="ml-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function CompanyLink({ account, children, className = 'text-accent-600 hover:underline' }) {
  if (!account.hubspotUrl) return <span>{children}</span>;
  return (
    <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={className}>
      {children}
    </a>
  );
}

/**
 * Job-tracked refresh — same SSE + poll-fallback pattern as
 * AccountHealthDashboard.jsx's RefreshOccupancyButton, copied rather
 * than imported (that component isn't exported from that page). This
 * pull covers every Home Office portal-wide (confirmed live, Sep 2026:
 * 514 active Home Offices across 8+ Account Managers, vs. Aaron's own
 * ~94) — meaningfully slower than a single-AM refresh, so it needs real
 * progress feedback rather than a bare synchronous request.
 */
function RefreshButton({ onRefreshed }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleClick() {
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/team-am/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setProgress({ completed: 0, total: data.total, failed: 0, lastItem: null });

      let finished = false;
      const finish = async (finalResult) => {
        if (finished) return;
        finished = true;
        clearInterval(pollHandle);
        es.close();
        setResult(finalResult);
        setProgress(null);
        await onRefreshed();
      };

      const es = new EventSource(`/api/stream/${data.id}`);
      es.addEventListener('snapshot', (e) => {
        const job = JSON.parse(e.data);
        setProgress((p) => ({ ...(p || {}), completed: job.completed || 0, total: job.total || 0, failed: job.failed || 0 }));
      });
      es.addEventListener('item_start', (e) => {
        const { name } = JSON.parse(e.data);
        setProgress((p) => ({ ...(p || {}), lastItem: name }));
      });
      es.addEventListener('item_done', () => setProgress((p) => ({ ...(p || {}), completed: (p?.completed || 0) + 1 })));
      es.addEventListener('item_fail', () => setProgress((p) => ({ ...(p || {}), completed: (p?.completed || 0) + 1, failed: (p?.failed || 0) + 1 })));
      es.addEventListener('job_done', (e) => finish(JSON.parse(e.data)));
      es.addEventListener('job_error', (e) => {
        if (finished) return;
        finished = true;
        clearInterval(pollHandle);
        setError(JSON.parse(e.data).error || 'Refresh failed');
        setProgress(null);
        es.close();
      });
      es.onerror = () => {
        if (finished) return;
        finished = true;
        clearInterval(pollHandle);
        setError((prev) => prev || 'Lost connection to the refresh job — it may still be running server-side.');
        setProgress(null);
        es.close();
      };

      const pollHandle = setInterval(async () => {
        if (finished) return;
        try {
          const jobRes = await fetch(`/api/jobs/${data.id}`);
          if (!jobRes.ok) return;
          const job = await jobRes.json();
          setProgress((p) => ({ ...(p || {}), completed: job.completed || 0, total: job.total || 0, failed: job.failed || 0 }));
          if (job.status === 'done') {
            await finish({ approximate: true, companyCount: job.completed, errorCount: job.failed || 0 });
          } else if (job.status === 'failed') {
            if (finished) return;
            finished = true;
            clearInterval(pollHandle);
            es.close();
            setError(job.error || 'Refresh failed');
            setProgress(null);
          }
        } catch {
          // Network hiccup on the poll itself — next tick will retry.
        }
      }, 8000);
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  }

  const refreshing = progress != null;
  const pct = refreshing && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={refreshing} className="btn btn-sm btn-secondary">
        {refreshing ? `Refreshing… ${pct}%` : '🔄 Refresh HubSpot Data'}
      </button>
      {refreshing && (
        <div className="mt-1 max-w-xs ml-auto">
          <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div className="h-full bg-accent-500 transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-neutral-400 mt-0.5 truncate">
            {progress.completed} of {progress.total}
            {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
            {progress.lastItem ? ` · ${progress.lastItem}` : ''}
          </p>
        </div>
      )}
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs ml-auto">
          {result.companyCount} companies refreshed{result.errorCount > 0 && `, ${result.errorCount} failed`}
        </p>
      )}
    </div>
  );
}

/** Same manual-PDF-upload flow as AccountHealthDashboard.jsx's ImportAgingReportButton, pointed at the team-wide route/table. */
function ImportAgingReportButton({ onImported }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const pdfBase64 = arrayBufferToBase64(buf);
      const res = await fetch('/api/team-am/import-aging-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setResult(data);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="text-right">
      <label className="btn btn-sm btn-secondary cursor-pointer">
        {importing ? 'Importing…' : '📥 Import Aging Report'}
        <input type="file" accept="application/pdf" onChange={handleFile} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs ml-auto">
          {result.accountsUpdated} account(s) updated from {result.rowsMatched} of {result.rowsParsed} rows
          {result.unmatchedCount > 0 && ` — ${result.unmatchedCount} row(s) didn't match any account`}
        </p>
      )}
    </div>
  );
}

/**
 * Downloads the PPT export — a bar AND a pie slide for every metric the
 * KPI-by-AM dropdown offers (Aaron, Sep 2026: "let's do a KPI per
 * slide... both bar graphs and pie charts"), not just whatever's
 * currently selected on screen.
 */
function ExportPptButton() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch('/api/team-am/export-ppt');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Team-AM-Dashboard.pptx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={exporting} className="btn btn-sm btn-secondary">
        {exporting ? 'Exporting…' : '📊 Export to PPT'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
    </div>
  );
}

const PIE_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4d7c0f', '#9333ea'];

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="flex gap-1 mb-2">
      {['bar', 'pie'].map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
            value === t ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

const METRICS = [
  { key: 'avgScore', label: 'Avg Health Score', format: (v) => v },
  { key: 'totalAccounts', label: 'Total Accounts', format: (v) => v },
  { key: 'totalCommunities', label: 'Total Communities', format: (v) => v },
  { key: 'openTickets', label: 'Open Tickets', format: (v) => v },
  { key: 'closedTickets', label: 'Closed Tickets', format: (v) => v },
  { key: 'dealsThisYearOpen', label: `${new Date().getFullYear()} Open Deals`, format: (v) => v },
  { key: 'dealsThisYearClosed', label: `${new Date().getFullYear()} Closed Deals`, format: (v) => v },
  { key: 'arrCents', label: 'Total ARR', format: currencyStr },
  { key: 'arrAddedThisYearCents', label: `ARR Added (${new Date().getFullYear()})`, format: currencyStr },
  { key: 'totalCapacity', label: 'Total Capacity', format: (v) => v },
  { key: 'currentCensus', label: 'Current Census', format: (v) => v },
];

/**
 * One reusable "value by Account Manager" bar/pie chart, metric picked
 * from a dropdown rather than nine separate always-rendered chart cards
 * — copies CategoryMixChart's (AccountHealthDashboard.jsx) bar/pie-toggle
 * shape, just grouped by account_manager_name instead of ticket category.
 */
function KpiByAmChart({ rollupByAccountManager, metricKey, setMetricKey, chartType, setChartType }) {
  const metric = METRICS.find((m) => m.key === metricKey);

  const data = rollupByAccountManager
    .map((r) => ({ name: r.accountManagerName, total: r[metricKey] || 0 }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  const chartHeight = chartType === 'pie' ? 560 : Math.max(420, data.length * 56);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5"
        >
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No data yet for this metric — click Refresh to pull it.</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chartType === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={({ name, total }) => `${name}: ${metric.format(total)}`} isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => metric.format(v)} />
            </PieChart>
          ) : (
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 64, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={140} />
              <Tooltip formatter={(v) => metric.format(v)} />
              <Bar dataKey="total" fill="#2563eb" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="total" position="right" formatter={metric.format} style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </>
  );
}

// Fixed worst-to-best order (matches accountHealthScoring.js's SCORE_BANDS
// exactly: <40 / 40-60 / 60-80 / 80-100) rather than sorted by count, so
// the "spread" reads left-to-right as a quality gradient every time,
// not shuffled depending on which band happens to have the most accounts.
const HEALTH_BANDS = ['Unhealthy', 'At Risk', 'Stable', 'Healthy'];

/**
 * "Spread of health scores" (Aaron, Sep 2026) — how many accounts fall
 * into each of the app's existing health bands, portfolio-wide. Reuses
 * the same band/color vocabulary as ScoreBadge rather than a generic
 * numeric histogram, since Unhealthy/At Risk/Stable/Healthy is already
 * the language this whole app uses for a health score.
 */
function HealthScoreDistributionChart({ accounts }) {
  const data = HEALTH_BANDS
    .map((band) => ({ name: band, total: accounts.filter((a) => a.health_band === band).length, color: BAND_COLOR[BAND_LABEL_TO_COLOR[band]] }))
    .filter((d) => d.total > 0);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No scored accounts yet — click Refresh to pull data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => `${v} account${v === 1 ? '' : 's'}`} />
        <Bar dataKey="total" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="total" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Score < 60 — the Unhealthy/At Risk bands, matching accountHealthScoring.js's SCORE_BANDS boundary between At Risk and Stable. Aaron asked for "the at risk communities" (Sep 2026); read as both concerning bands together (not just the literally-labeled "At Risk" one) since Unhealthy is the more severe version of the same problem, not a separate one. */
function isAtRisk(account) {
  return account.health_band === 'Unhealthy' || account.health_band === 'At Risk';
}

/**
 * Scrollable drawer of every at-risk account, weakest-first, each with a
 * "why" bullet list — riskReasons is computed server-side (see
 * explainRisk in accountHealthScoring.js), mirroring the exact same
 * signals/thresholds that lowered the score, not a separately-guessed
 * explanation. An account can legitimately have zero reasons captured
 * (e.g. its low score comes entirely from the weighted composite of
 * sub-scores this app can't yet break out further) — shown honestly
 * rather than papered over with a generic line.
 */
function AtRiskDrawer({ accounts, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const sorted = useMemo(() => [...accounts].sort((a, b) => (a.health_score ?? 999) - (b.health_score ?? 999)), [accounts]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportAtRiskAccounts(accounts);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title="At-Risk Accounts"
      subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'} scoring below 60 (Unhealthy or At Risk)`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExport} disabled={exporting} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No at-risk accounts right now.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((a) => (
            <div key={a.hubspot_company_id} className="border border-neutral-200 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <CompanyLink account={a} className="font-medium text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                <ScoreBadge score={a.health_score} band={a.health_band} />
              </div>
              <p className="text-xs text-neutral-500 mb-1.5">{a.account_manager_name}</p>
              {a.riskReasons?.length > 0 ? (
                <ul className="text-xs text-neutral-600 list-disc list-inside space-y-0.5">
                  {a.riskReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : (
                <p className="text-xs text-neutral-400 italic">No specific driver captured — score reflects the weighted composite.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

/** True for an account with no real Account Manager name attached — either no account_manager property at all ("Unassigned") or a real owner ID this app doesn't have a name mapped for ("Other AM (id)", see ACCOUNT_MANAGER_NAMES in hubspotAccounts.js). */
function isUnmappedAm(account) {
  return account.account_manager_name === 'Unassigned' || account.account_manager_name?.startsWith('Other AM');
}

/**
 * Deals/tickets for accounts with no real AM name — Aaron asked for this
 * (Sep 2026) as an actionable list for "dialing in" AM assignment: these
 * accounts' open work is otherwise invisible to whoever should be
 * managing them. Deals come from financialHealth.expansionPipeline.deals
 * (open + last-90-days-closed, already stored per account). Tickets are
 * NOT a full ticket list — this app only caches two curated subsets per
 * account (Top 3 Enhancement, Aged 45+ days), so that's what's shown
 * here, clearly labeled rather than implied as exhaustive.
 */
function flattenUnmappedDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    if (!isUnmappedAm(a)) continue;
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) {
      rows.push({ companyName: a.company_name, accountManagerLabel: a.account_manager_name, ...d });
    }
  }
  return rows;
}

function flattenUnmappedTickets(accounts) {
  const rows = [];
  for (const a of accounts) {
    if (!isUnmappedAm(a)) continue;
    for (const t of a.serviceHealth?.enhancementTopItems || []) {
      rows.push({ companyName: a.company_name, accountManagerLabel: a.account_manager_name, subject: t.subject, type: `Top 3 Enhancement${t.rank ? ` (rank ${t.rank})` : ''}`, stage: t.stage, url: t.url });
    }
    for (const t of a.serviceHealth?.agedTickets || []) {
      rows.push({ companyName: a.company_name, accountManagerLabel: a.account_manager_name, subject: t.subject, type: `Aged (${t.ageDays}d)`, stage: t.stage, url: t.url });
    }
  }
  return rows;
}

/** Collapsible, internally-scrolling panel (Aaron: "scrolling dropdowns") so a long deal/ticket list doesn't push the rest of the page down indefinitely. */
function ScrollDropdown({ title, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-neutral-200 rounded-lg mb-3 last:mb-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-50"
      >
        <span className="font-medium text-primary-900 text-sm">
          {title} <span className="text-neutral-400 font-normal">({count})</span>
        </span>
        <span className="text-neutral-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="max-h-96 overflow-y-auto border-t border-neutral-100 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function UnmappedAmSection({ accounts }) {
  const unmappedAccounts = useMemo(() => accounts.filter(isUnmappedAm), [accounts]);
  const deals = useMemo(() => flattenUnmappedDeals(accounts), [accounts]);
  const tickets = useMemo(() => flattenUnmappedTickets(accounts), [accounts]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const unassignedCount = unmappedAccounts.filter((a) => a.account_manager_name === 'Unassigned').length;
  const otherAmCount = unmappedAccounts.length - unassignedCount;

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportUnmappedAmRecords({ deals, tickets });
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <SectionCard
      title="Needs an Account Manager"
      description={`${unmappedAccounts.length} accounts with no real AM name — ${unassignedCount} Unassigned, ${otherAmCount} with an unmapped ID`}
      action={
        <button
          onClick={handleExport}
          disabled={exporting || (deals.length === 0 && tickets.length === 0)}
          className="btn btn-secondary btn-sm"
        >
          {exporting ? 'Exporting…' : '⬇ Export to Excel'}
        </button>
      }
    >
      {exportError && <p className="text-xs text-error mb-3">{exportError}</p>}
      <ScrollDropdown title="Deals" count={deals.length}>
        {deals.length === 0 ? (
          <p className="text-sm text-neutral-500 italic">No deals found for these accounts.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="pb-2 pr-3">Company</th>
                <th className="pb-2 pr-3">Account Manager</th>
                <th className="pb-2 pr-3">Deal</th>
                <th className="pb-2 pr-3">Stage</th>
                <th className="pb-2 pr-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{d.companyName}</td>
                  <td className="py-1.5 pr-3 text-neutral-500">{d.accountManagerLabel}</td>
                  <td className="py-1.5 pr-3">
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{d.name}</a> : d.name}
                  </td>
                  <td className="py-1.5 pr-3 text-neutral-500">{d.stage}</td>
                  <td className="py-1.5 pr-3 text-right text-neutral-500">{currencyStr(d.valueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollDropdown>
      <ScrollDropdown title="Tickets — Top 3 Enhancement + Aged (45+ days) only" count={tickets.length}>
        {tickets.length === 0 ? (
          <p className="text-sm text-neutral-500 italic">No tickets found for these accounts.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="pb-2 pr-3">Company</th>
                <th className="pb-2 pr-3">Account Manager</th>
                <th className="pb-2 pr-3">Ticket</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2">Stage</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{t.companyName}</td>
                  <td className="py-1.5 pr-3 text-neutral-500">{t.accountManagerLabel}</td>
                  <td className="py-1.5 pr-3">
                    {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{t.subject}</a> : t.subject}
                  </td>
                  <td className="py-1.5 pr-3 text-neutral-500">{t.type}</td>
                  <td className="py-1.5 text-neutral-500">{t.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollDropdown>
    </SectionCard>
  );
}

export default function TeamAmDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [rollupByAccountManager, setRollupByAccountManager] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'health_score', direction: 'asc' });
  const [metricKey, setMetricKey] = useState('avgScore');
  const [chartType, setChartType] = useState('bar');
  const [atRiskOpen, setAtRiskOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/team-am');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
      setAccounts(data.accounts || []);
      setRollupByAccountManager(data.rollupByAccountManager || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: column === 'health_score' ? 'asc' : 'asc' });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? accounts.filter((a) => a.company_name?.toLowerCase().includes(q) || a.account_manager_name?.toLowerCase().includes(q))
      : accounts;
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [accounts, search, sort]);

  const rollup = useMemo(() => {
    const scored = accounts.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
    const distinctAms = new Set(accounts.map((a) => a.account_manager_name).filter((n) => n && !n.startsWith('Other AM') && n !== 'Unassigned'));
    return {
      totalAms: distinctAms.size,
      totalAccounts: accounts.length,
      totalCommunities: accounts.reduce((s, a) => s + (a.active_community_count || 0), 0),
      openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
      arrAddedThisYearCents: accounts.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      avgScore,
    };
  }, [accounts]);

  const atRiskAccounts = useMemo(() => accounts.filter(isAtRisk), [accounts]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">Team AM Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {rollup.totalAccounts} Home Office accounts across {rollup.totalAms} Account Managers
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            Census/capacity shown only where already known from the personal Account Health Dashboard's own occupancy refresh — this page never calls ALIS directly.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 justify-end max-w-2xl">
          <ExportPptButton />
          <ImportAgingReportButton onImported={load} />
          <RefreshButton onRefreshed={load} />
        </div>
      </div>

      {error && <div className="alert alert-error mb-6"><span>⚠️</span><p className="text-sm">{error}</p></div>}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-neutral-500 mb-4">No cached team data yet.</p>
          <RefreshButton onRefreshed={load} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Account Managers" value={rollup.totalAms} />
            <StatCard label="Total Accounts" value={rollup.totalAccounts} />
            <StatCard label="Total Communities" value={rollup.totalCommunities} sub="Active child companies" />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} />
            <StatCard label="Open Tickets" value={rollup.openTickets} sub="Client Submitted + In Progress" />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} />
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} />
            <StatCard label={`ARR Added (${new Date().getFullYear()})`} value={currencyStr(rollup.arrAddedThisYearCents)} />
            <TopThreeEnhancementsCard accounts={accounts} includeAccountManager />
          </div>

          <SectionCard title="KPI by Account Manager" description="Pick a metric to break down across the team">
            <KpiByAmChart
              rollupByAccountManager={rollupByAccountManager}
              metricKey={metricKey}
              setMetricKey={setMetricKey}
              chartType={chartType}
              setChartType={setChartType}
            />
          </SectionCard>

          <SectionCard
            title="Health Score Distribution"
            description="How many accounts fall into each health band, portfolio-wide"
            action={
              <button onClick={() => setAtRiskOpen(true)} className="btn btn-secondary btn-sm">
                View At-Risk Accounts ({atRiskAccounts.length})
              </button>
            }
          >
            <HealthScoreDistributionChart accounts={accounts} />
          </SectionCard>
          {atRiskOpen && <AtRiskDrawer accounts={atRiskAccounts} onClose={() => setAtRiskOpen(false)} />}

          <UnmappedAmSection accounts={accounts} />

          <SectionCard
            title="Accounts"
            description="Sorted by Health Score by default — weakest accounts first"
            action={
              <input
                type="text"
                placeholder="Search accounts or AM…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                    <SortableHeader label="Account" column="company_name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Account Manager" column="account_manager_name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Community" column="active_community_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Health" column="health_score" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Tickets" column="open_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed Tickets" column="closed_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Aging Balance" column="aging_total_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Capacity" column="total_capacity" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Current Census" column="current_census" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.hubspot_company_id} className="border-t border-neutral-100 hover:bg-neutral-50">
                      <td className="py-2 pr-4 font-medium">
                        <CompanyLink account={a} className="text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{a.account_manager_name}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.active_community_count ?? '—'}</td>
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={a.health_band} /></td>
                      <td className="py-2 pr-4">{a.open_ticket_count ?? 0}</td>
                      <td className="py-2 pr-4">{a.closed_ticket_count ?? 0}</td>
                      <td className="py-2 pr-4">{currencyStr(a.arr_cents)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.aging_total_cents != null ? currencyStr(a.aging_total_cents) : '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.total_capacity ?? '—'}</td>
                      <td className="py-2 text-neutral-500">{a.current_census ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-neutral-500 italic py-4">No accounts match "{search}".</p>}
            </div>
          </SectionCard>
        </>
      )}
      <BackToTopButton />
    </div>
  );
}
