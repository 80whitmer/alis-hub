import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, LabelList,
} from 'recharts';
import Drawer from '../components/Drawer';
import BackToTopButton from '../components/BackToTopButton';
import TopThreeEnhancementsCard from '../components/TopThreeEnhancementsCard';
import AlisPayTicketsCard from '../components/AlisPayTicketsCard';
import EnhancementRequestsSection from '../components/EnhancementRequestsSection';
import CommunityRevenueSection from '../components/CommunityRevenueSection';
import {
  exportAccountHealthPortfolioExcel, exportAccountHealthSingleExcel,
  exportCompanyHostTemplate, parseCompanyHostTemplate,
} from '../utils/accountHealthExport';
import { arrayBufferToBase64 } from '../utils/base64';

function pctStr(p) {
  return p != null ? `${(p * 100).toFixed(1)}%` : '—';
}

// Matches accountHealthScoring.js's SCORE_BANDS exactly (0-40 red / 40-60
// orange / 60-80 blue / 80-100 green) — kept as a parallel client-side map
// rather than fetched from the server, since these are just display colors
// for a score the server already computed and returned.
const BAND_COLOR = { red: '#dc2626', orange: '#ea580c', blue: '#2563eb', green: '#16a34a' };

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** notes_last_updated (HubSpot's "Last Activity Date") stored as an ISO timestamp — covers both an ALIS-initiated note/call/task and a client email/call logged back, whichever happened most recently. */
function lastActivityStr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** client_tier — HubSpot's Account Management Tier (1-4, based on ARR). 0/null both read as unset, not "Tier 0". */
function tierStr(tier) {
  return (tier == null || tier === 0) ? '—' : `Tier ${tier}`;
}

// health_band is stored as its display label (matching accountHealthScoring.js's
// SCORE_BANDS) — this maps it back to the color key ScoreBadge/BAND_COLOR expect.
const BAND_LABEL_TO_COLOR = { Unhealthy: 'red', 'At Risk': 'orange', Stable: 'blue', Healthy: 'green' };

function ScoreBadge({ score, band }) {
  if (score == null) {
    return <span className="badge badge-neutral">No data</span>;
  }
  const color = BAND_COLOR[band] || '#737373';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {score}
    </span>
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

function StatCard({ label, value, sub }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Labeled cluster of stat tiles — the top-of-page grid is grouped into
 * four of these (Sep 2026, Aaron: "arrange the tiles to tell the story
 * TC/Evan/Gary are looking to tell") rather than one flat 18-tile grid,
 * so the page reads as a narrative instead of an alphabet soup of
 * numbers: portfolio health first (Gary's tier-aware, proactive-attention
 * instinct), then financial/occupancy rollups (Evan's Viva-style ask),
 * then data freshness/trust (Trisha's provenance concerns), then the
 * day-to-day support-ticket detail underneath all three.
 */
function StatGroup({ title, children }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-accent-600 uppercase tracking-wide mb-3">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {children}
      </div>
    </div>
  );
}

/** Smooth-scrolls to a section by id, expanding it first if it's a collapsed SectionCard — same 'alis-hub:jump-to-section' event QuickJumpNav uses below, so a stat tile's jump link never lands on a collapsed card. `to` is the section's slugified id (see slugify()). */
function JumpLink({ to, children }) {
  return (
    <a
      href={`#${to}`}
      onClick={(e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('alis-hub:jump-to-section', { detail: { id: to } }));
      }}
      className="text-xs text-accent-600 hover:underline"
    >
      {children}
    </a>
  );
}


function CompanyLink({ account, children, className = 'text-accent-600 hover:underline' }) {
  if (!account.hubspotUrl) return <span>{children}</span>;
  return (
    <a
      href={account.hubspotUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </a>
  );
}

/** Matches a SectionCard's `title` to the DOM id the "Jump to Section" quick nav (and the existing JumpLink stat-card sub-links) scroll/expand to — single source of truth (title -> id) so a renamed title can't silently break a link. */
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Cross-component "jump to this section" signal — QuickJumpNav dispatches it, every SectionCard listens for its own id, expands itself if collapsed, and scrolls into view. A DOM event rather than lifted state: this file renders SectionCards from several independent sub-components (RecurringCallsSection, ArrAddedDealsSection, DealsSection) and threading expanded/onToggle props through all of them just for this would be far more invasive than one shared event. */
const JUMP_EVENT = 'alis-hub:jump-to-section';

function SectionCard({ title, children, description, action, collapsible = true, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const ref = useRef(null);
  const sectionId = slugify(title);

  useEffect(() => {
    function handleJump(e) {
      if (e.detail?.id !== sectionId) return;
      setExpanded(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.addEventListener(JUMP_EVENT, handleJump);
    return () => window.removeEventListener(JUMP_EVENT, handleJump);
  }, [sectionId]);

  const open = !collapsible || expanded;
  return (
    <div id={sectionId} ref={ref} className="card mb-8 scroll-mt-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div
          className={collapsible ? 'cursor-pointer select-none' : ''}
          onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
        >
          <h2 className="text-lg font-semibold text-primary-900 flex items-center gap-2">
            {collapsible && <span className="text-xs text-neutral-400">{open ? '▼' : '▶'}</span>}
            {title}
          </h2>
          {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && children}
    </div>
  );
}

/** Compact "jump to section" card for the stat grid's leftover cells — clicking a link expands (if collapsed) and scrolls to the matching SectionCard via JUMP_EVENT, without either component needing to know about the other beyond the shared title string. Grows and its text sizes up on hover (Aaron, Sep 2026) so a card that's mostly small print doesn't get overlooked next to the big-number stat tiles around it — `relative` + `hover:z-10` keeps the scaled-up card drawing on top of its neighbors instead of being clipped underneath them. */
function QuickJumpNav({ sections, className = '' }) {
  function jumpTo(title) {
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: slugify(title) } }));
  }
  return (
    <div className={`group card relative transition-transform duration-200 hover:scale-105 hover:z-10 hover:shadow-xl ${className}`}>
      <p className="text-xs group-hover:text-sm text-neutral-500 uppercase tracking-wide font-semibold mb-3 transition-[font-size]">Jump to Section</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {sections.map((title) => (
          <li key={title} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-300 shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={() => jumpTo(title)}
              className="text-left text-xs group-hover:text-sm leading-snug text-neutral-600 hover:text-accent-600 hover:underline transition-[font-size]"
            >
              {title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefreshButton({ onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/account-health/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      await onRefreshed(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={refreshing} className="btn btn-sm btn-secondary">
        {refreshing ? 'Refreshing… (can take a couple minutes for a full portfolio)' : '🔄 Refresh HubSpot Data'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
    </div>
  );
}

/**
 * Manual weekly upload of Dave Johnson's Intacct "Customer Aging Report"
 * PDF — see server/services/agingReportParser.js's doc comment for why
 * this is manual rather than automatic Gmail ingestion. Sent as base64 in
 * the JSON body, same transport KpiDashboard.jsx's AccountHealthImport
 * already uses for its own JSON upload.
 */
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
      const res = await fetch('/api/account-health/import-aging-report', {
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
          {result.unmatchedCount > 0 && ` — ${result.unmatchedCount} row(s) didn't match any of your accounts (likely other AMs' clients)`}
        </p>
      )}
    </div>
  );
}

/**
 * Lets Aaron map each account to its ALIS subdomain — the one piece of
 * data needed to pull capacity/census (server/api/companyHosts.js has no
 * UI of its own, only a bulk-import API route). Downloads a template
 * pre-filled with every account name + ID (and any subdomain already
 * known); the upload half reads a completed copy back and posts it to
 * that same existing import route. Confirmed live (Sep 2026): only 7 of
 * 109 accounts have a mapping today, so this is expected to be filled in
 * gradually, not all at once.
 */
function CompanyHostMappingButtons({ accounts, companyHosts, onImported }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const mappedCount = companyHosts.filter((h) => accounts.some((a) => a.hubspot_company_id === h.hubspot_company_id)).length;

  async function handleDownload() {
    await exportCompanyHostTemplate(accounts, companyHosts);
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const rows = await parseCompanyHostTemplate(file);
      if (rows.length === 0) throw new Error('No rows with an ALIS Subdomain filled in were found in this file.');
      const res = await fetch('/api/company-hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
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

  const subdomainStatus = `${mappedCount} of ${accounts.length} accounts have a known ALIS subdomain`;

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleDownload} className="btn btn-sm btn-secondary" title={subdomainStatus}>📋 Download Subdomain Template</button>
      <label className="btn btn-sm btn-secondary cursor-pointer" title={subdomainStatus}>
        {importing ? 'Importing…' : '📤 Upload Completed Template'}
        <input type="file" accept=".xlsx" onChange={handleUpload} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error max-w-xs">{error}</p>}
      {result && <p className="text-xs text-neutral-500 max-w-xs">{result.imported} subdomain(s) imported{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}</p>}
    </div>
  );
}

/**
 * Total capacity + current census refresh — a separate action from the
 * main HubSpot refresh (RefreshButton above), since this hits a
 * genuinely different, Basic-Auth-per-subdomain external API (ALIS's own
 * export API) with much sparser coverage today (see
 * CompanyHostMappingButtons above) than the HubSpot data.
 */
/**
 * Live progress via the same job/SSE plumbing the Playwright automation
 * jobs use (server/api/accountHealth.js's refresh-occupancy route now
 * creates a tracked job instead of just awaiting a bare loop) — Aaron
 * asked for this (Sep 2026) after a real 93-account run gave no sense of
 * whether the button was hung. GET /api/stream/:id's `snapshot` event
 * carries the full job row (completed/total/failed) for hydration;
 * item_start/item_done/item_fail update the running counters live.
 */
function RefreshOccupancyButton({ onRefreshed }) {
  const [progress, setProgress] = useState(null); // { completed, total, failed, lastItem } while running
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleClick() {
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/account-health/refresh-occupancy', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setProgress({ completed: 0, total: data.total, failed: 0, lastItem: null });

      // Confirmed live (Sep 2026): the EventSource connection can go
      // silently dead — no `error` event ever fires, no more messages
      // arrive — while the job itself keeps running and finishes
      // server-side, leaving the button frozen at some mid-run
      // percentage forever (exactly the "is this hung?" problem this
      // whole feature exists to solve, just relocated). A poll-based
      // safety net that doesn't depend on the SSE connection's own
      // health signals at all is what actually closes that gap; `done`
      // is only finalized once, guarded by `finished`, whichever path
      // (SSE event or poll) notices it first.
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
      es.addEventListener('item_done', (e) => {
        setProgress((p) => ({ ...(p || {}), completed: (p?.completed || 0) + 1 }));
      });
      es.addEventListener('item_fail', (e) => {
        setProgress((p) => ({ ...(p || {}), completed: (p?.completed || 0) + 1, failed: (p?.failed || 0) + 1 }));
      });
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
        // A dropped connection (server restart, network blip) shouldn't
        // leave the button stuck showing "Refreshing…" forever with no
        // way to retry — the poll below is the real safety net, but a
        // genuine `error` event (the connection cleanly failing) can
        // still surface faster than the next poll tick.
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
          if (!jobRes.ok) return; // transient — try again next tick
          const job = await jobRes.json();
          setProgress((p) => ({ ...(p || {}), completed: job.completed || 0, total: job.total || 0, failed: job.failed || 0 }));
          if (job.status === 'done') {
            // The poll only has the job's own counts, not the richer
            // accountsUpdated/accountsSkippedNoMapping breakdown the
            // job_done SSE event carries (job_items don't distinguish a
            // real occupancy update from a no-subdomain-mapped skip —
            // both persist as 'success', see runOccupancyRefreshJob's
            // doc comment server-side) — good enough for "it finished,
            // here's roughly what happened" when SSE never delivered
            // that event at all, worded honestly rather than guessing
            // at the updated/skipped split.
            await finish({ approximate: true, processed: job.completed, errorCount: job.failed || 0 });
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
        {refreshing ? `Refreshing… ${pct}%` : '🏘️ Refresh Occupancy Data'}
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
          {result.approximate ? (
            <>Finished — {result.processed} processed{result.errorCount > 0 && `, ${result.errorCount} failed`} (live connection dropped mid-run, so exact updated/skipped counts aren't available; the data itself is current)</>
          ) : (
            <>
              {result.accountsUpdated} account(s) updated
              {result.accountsSkippedNoMapping > 0 && `, ${result.accountsSkippedNoMapping} skipped (no ALIS subdomain mapped)`}
              {result.errorCount > 0 && `, ${result.errorCount} failed`}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Downloads a server-rendered PDF via fetch+Blob — same pattern WellnessScorecard.jsx uses for its export-pdf route. */
async function downloadPdf(url, fallbackFilename) {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Export failed (${res.status})`);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function ExportButtons({ onExcel, onPdf, size = 'sm' }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function run(kind, fn) {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="text-right">
      <div className="flex gap-2 justify-end">
        <button onClick={() => run('excel', onExcel)} disabled={busy != null} className={`btn btn-${size} btn-secondary`}>
          {busy === 'excel' ? 'Exporting…' : '📊 Export Excel'}
        </button>
        <button onClick={() => run('pdf', onPdf)} disabled={busy != null} className={`btn btn-${size} btn-secondary`}>
          {busy === 'pdf' ? 'Exporting…' : '📄 Export PDF'}
        </button>
      </div>
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

function CategoryMixChart({ accounts, status }) {
  const [chartType, setChartType] = useState('bar');
  const [showLegend, setShowLegend] = useState(false);
  const byCategory = {};
  for (const a of accounts) {
    const mix = a.serviceHealth?.ticketCategoryMix || {};
    for (const [cat, counts] of Object.entries(mix)) {
      byCategory[cat] = (byCategory[cat] || 0) + (counts[status] || 0);
    }
  }
  const data = Object.entries(byCategory)
    .map(([name, total]) => ({ name, total }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No {status} ticket data yet — click Refresh to pull it.</p>;
  }

  // Sized to anchor a discussion (Aaron, 2026-09-07) — every category needs
  // a legible label instead of a hover-only tooltip. The bar chart needs
  // more height as categories pile up (each is its own row); the pie
  // doesn't — a taller box just centers the same-size circle in more
  // whitespace, it doesn't spread out slice labels — so it gets one
  // generous fixed height instead (confirmed live: with the real ~28
  // category values this data can have, tying pie height to category
  // count the same way as the bar chart put the actual circle 800+px
  // down an otherwise-blank card).
  const chartHeight = chartType === 'pie' ? 640 : Math.max(480, data.length * 56);

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        {chartType === 'pie' && (
          <button
            onClick={() => setShowLegend((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300 transition-colors"
          >
            {showLegend ? 'Hide Key' : 'Show Key'}
          </button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="68%"
              label={({ name, total }) => `${name}: ${total}`}
              isAnimationActive={false}
            >
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            {showLegend && <Legend />}
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={200} />
            <Tooltip />
            <Bar dataKey="total" fill={status === 'open' ? '#dc2626' : '#2563eb'} radius={[0, 4, 4, 0]}>
              <LabelList dataKey="total" position="right" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

/** Buckets each account's already-computed open_ticket_count / closed_ticket_count by client_tier (1-4, or "Unset" for 0/null) — same tier field/labeling as tierStr, no new data fetch needed. */
function TicketsByTierChart({ accounts }) {
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = { tier: key, open: 0, closed: 0 };
    byTier[key].open += a.open_ticket_count || 0;
    byTier[key].closed += a.closed_ticket_count || 0;
  }
  const data = Object.values(byTier)
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier))
    .map((d) => ({ ...d, name: d.tier === 'unset' ? 'Unset' : `Tier ${d.tier}` }));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="open" name="Open" fill="#dc2626" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="open" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
        <Bar dataKey="closed" name="Closed" fill="#2563eb" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="closed" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Same shape as TeamAmDashboard.jsx's chart of the same name — how many accounts (not communities/tickets) fall into each Client Tier, portfolio-wide. Duplicated locally rather than shared, matching TicketsByTierChart/CostToServeByTierChart just above (this file's established per-page-duplication convention), and uses this file's own "unset" tier-key convention (label "Unset") to stay consistent with its siblings rather than Team AM's "Unassigned." */
function CompaniesByTierChart({ accounts, chartType, setChartType }) {
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier)
    .map(([tier, total]) => ({ tier, total, name: tier === 'unset' ? 'Unset' : `Tier ${tier}` }))
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No account data yet — click Refresh to pull it.</p>;
  }

  const chartHeight = chartType === 'pie' ? 420 : 320;

  return (
    <>
      <div className="flex items-center justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={({ name, total }) => `${name}: ${total}`} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => `${v} compan${v === 1 ? 'y' : 'ies'}`} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${v} compan${v === 1 ? 'y' : 'ies'}`} />
            <Bar dataKey="total" fill="#7c3aed" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="total" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

const TIER_COST_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unset: '#737373' };

function CostToServeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{d.name}</p>
      <p className="text-neutral-600">{d.accountCount} account{d.accountCount === 1 ? '' : 's'}</p>
      <p className="text-neutral-600">{d.tickets} ticket(s) (open + closed this year)</p>
      <p className="text-neutral-600">{currencyStr(d.arrCents)} total ARR</p>
      <p className="text-neutral-700 font-medium mt-1">{d.ratio.toFixed(2)} tickets per $1,000 ARR</p>
    </div>
  );
}

/**
 * "Cost to Serve" — current-load ticket volume (open + closed THIS
 * CALENDAR YEAR) per $1,000 of ARR, aggregated by Client Tier.
 * Portfolio-weighted (sum tickets ÷ sum ARR per tier), not an average of
 * each account's own ratio — same reasoning as the Portfolio DSO figure
 * elsewhere on this page, so one near-zero-ARR account can't blow up its
 * whole tier's number. Aaron asked for this (Sep 2026) to quantify how
 * much more support effort lower-tier accounts cost per revenue dollar
 * than Tier 1, to help justify where AM time/focus should go. Tiers with
 * $0 ARR are excluded (undefined ratio) rather than shown as a
 * misleading infinity/zero.
 *
 * Deliberately excludes tickets closed in a prior calendar year (Aaron,
 * Sep 2026) — this metric is meant to read as current support load, not
 * a lifetime ticket count. Uses serviceHealth.closedTicketCountThisYear
 * (computed server-side per account — see hubspotTickets.js's
 * closedThisYear), not the plain closed_ticket_count column, which is
 * all-time and still correct/used elsewhere on this page.
 */
function CostToServeByTierChart({ accounts }) {
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = { tier: key, tickets: 0, arrCents: 0, accountCount: 0 };
    byTier[key].tickets += (a.open_ticket_count || 0) + (a.serviceHealth?.closedTicketCountThisYear || 0);
    byTier[key].arrCents += (a.arr_cents || 0);
    byTier[key].accountCount += 1;
  }
  const data = Object.values(byTier)
    .filter((d) => d.arrCents > 0)
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier))
    .map((d) => ({
      ...d,
      name: d.tier === 'unset' ? 'Unset' : `Tier ${d.tier}`,
      ratio: (d.tickets * 100000) / d.arrCents,
    }));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ARR/ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          label={{ value: 'Tickets per $1,000 ARR', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#737373' } }}
        />
        <Tooltip content={<CostToServeTooltip />} />
        <Bar dataKey="ratio" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
          <LabelList dataKey="ratio" position="top" formatter={(v) => v.toFixed(2)} style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DealTypeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{d.name}</p>
      <p className="text-neutral-600">{d.count} deal{d.count === 1 ? '' : 's'}</p>
      <p className="text-neutral-600">{currencyStr(d.valueCents)} total ARR</p>
    </div>
  );
}

function DealTypeChart({ accounts }) {
  const byType = {};
  for (const a of accounts) {
    const mix = a.financialHealth?.dealsByType || {};
    for (const [type, { count, valueCents }] of Object.entries(mix)) {
      if (!byType[type]) byType[type] = { count: 0, valueCents: 0 };
      byType[type].count += count;
      byType[type].valueCents += valueCents;
    }
  }
  const data = Object.entries(byType)
    .map(([name, v]) => ({ name, count: v.count, valueCents: v.valueCents }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No deal data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={480}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={90} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip content={<DealTypeTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626'][i % 5]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Mirrors KpiDashboard.jsx's OccupancyByProductTypeSection table shape/style — same {productType|classification, pct, occupied, total} rows, just a different data source (accountHealthOccupancy.js instead of a kpi-export job). */
function OccupancyBreakdownTable({ title, rows, keyField }) {
  if (!rows?.length) return null;
  return (
    <div className="flex-1 min-w-[220px]">
      <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase">
            <th className="py-1">{keyField === 'productType' ? 'Product Type' : 'Classification'}</th>
            <th className="py-1 text-right">% of Census</th>
            <th className="py-1 text-right">Occupied / Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyField]} className="border-t border-neutral-100">
              <td className="py-1.5">{r[keyField]}</td>
              <td className="py-1.5 text-right">{pctStr(r.pct)}</td>
              <td className="py-1.5 text-right">{r.occupied} / {r.total ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isPastDue(deal) {
  return deal.isOpen && deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date();
}

/**
 * Exposes and edits the one piece of data (server/api/companyHosts.js)
 * that determines whether Total Capacity/Current Census populate for
 * this account at all — Aaron asked for this (Sep 2026) after finding
 * "Hickory Senior Living" mapped to a real but completely unrelated
 * ALIS account's subdomain (a data-entry slip in the bulk template, not
 * a bug), with no way to see or fix that from the dashboard itself.
 * Saves via the same bulk-import route the template upload already uses
 * (a single-row array), then immediately pulls fresh occupancy for just
 * this account (POST /api/account-health/:id/refresh-occupancy) so
 * Aaron can confirm a fix worked without waiting for the next full,
 * ~5-minute, 93-account run.
 */
function AlisHostEditor({ account, companyHosts, onUpdated }) {
  const currentHost = companyHosts.find((h) => h.hubspot_company_id === account.hubspot_company_id)?.company_host || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentHost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { setValue(currentHost); }, [currentHost]);

  async function saveAndRefresh(hostValue) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const importRes = await fetch('/api/company-hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ companyName: account.company_name, hubspotCompanyId: account.hubspot_company_id, companyHost: hostValue }] }),
      });
      const importData = await importRes.json();
      if (!importRes.ok) throw new Error(importData.error || 'Failed to save subdomain');

      const refreshRes = await fetch(`/api/account-health/${account.hubspot_company_id}/refresh-occupancy`, { method: 'POST' });
      const refreshData = await refreshRes.json();
      if (!refreshRes.ok) throw new Error(refreshData.error || 'Saved, but occupancy refresh failed');

      setMessage(refreshData.occupancy?.hasOccupancyData
        ? `Refreshed — ${refreshData.occupancy.occupiedRoomDays} / ${refreshData.occupancy.totalRoomDays} occupied as of ${refreshData.occupancy.asOfDate}`
        : 'Saved — but no occupancy data came back for this host (wrong subdomain, or this account may not have ALIS floor-plan data set up).');
      setEditing(false);
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 p-3 border border-neutral-200 rounded-lg">
      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">ALIS Subdomain(s)</p>
      {editing ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. viva or viva1,viva2"
            className="flex-1 text-sm border border-neutral-200 rounded-lg px-2 py-1"
            autoFocus
          />
          <button onClick={() => saveAndRefresh(value)} disabled={busy} className="btn btn-sm btn-secondary">
            {busy ? 'Saving…' : 'Save & Refresh'}
          </button>
          <button onClick={() => { setEditing(false); setValue(currentHost); }} disabled={busy} className="btn btn-sm btn-secondary">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-neutral-700">{currentHost || <span className="italic text-neutral-400">not mapped</span>}</span>
          <div className="flex gap-3 shrink-0">
            <button onClick={() => setEditing(true)} className="text-xs text-accent-600 hover:underline">Edit</button>
            {currentHost && (
              <button onClick={() => saveAndRefresh(currentHost)} disabled={busy} className="text-xs text-accent-600 hover:underline">
                {busy ? 'Refreshing…' : 'Refresh Now'}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-error mt-1">{error}</p>}
      {message && <p className="text-xs text-neutral-500 mt-1">{message}</p>}
      {!editing && !message && !error && account.occupancy_error && (
        <p className="text-xs text-error mt-1">
          Last refresh failed{account.occupancy_error_at ? ` (${account.occupancy_error_at.slice(0, 10)})` : ''}: {account.occupancy_error}
        </p>
      )}
    </div>
  );
}

const CADENCE_OPTIONS = ['Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Other'];

/**
 * Manually-maintained recurring-call cadence per account (Aaron, Sep
 * 2026) — this app has no calendar API integration (no OAuth flow for
 * any calendar provider exists anywhere in this codebase, and HubSpot's
 * own static private-app token isn't a pattern that generalizes to one),
 * so cadence/next-date/notes are entered by hand here rather than synced.
 * The calendar link is just a pasted URL to the real recurring event/
 * series in whatever calendar tool is actually used — works with any
 * provider since it's a stored link, not a live API call, and clicking
 * it opens that real calendar entry directly.
 */
function RecurringCallEditor({ account, onUpdated }) {
  const rc = account.recurringCall;
  const [editing, setEditing] = useState(false);
  const [cadence, setCadence] = useState(rc?.cadence || '');
  const [nextCallDate, setNextCallDate] = useState(rc?.nextCallDate?.slice(0, 10) || '');
  const [calendarLink, setCalendarLink] = useState(rc?.calendarLink || '');
  const [notes, setNotes] = useState(rc?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function resetFields() {
    setCadence(rc?.cadence || '');
    setNextCallDate(rc?.nextCallDate?.slice(0, 10) || '');
    setCalendarLink(rc?.calendarLink || '');
    setNotes(rc?.notes || '');
  }

  useEffect(() => { resetFields(); }, [rc?.cadence, rc?.nextCallDate, rc?.calendarLink, rc?.notes]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/account-health/${account.hubspot_company_id}/recurring-call`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: cadence || null, nextCallDate: nextCallDate || null, calendarLink: calendarLink || null, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setEditing(false);
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/account-health/${account.hubspot_company_id}/recurring-call`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear');
      setEditing(false);
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 p-3 border border-neutral-200 rounded-lg">
      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Recurring Call</p>
      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="text-sm border border-neutral-200 rounded-lg px-2 py-1">
              <option value="">No cadence</option>
              {CADENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="date"
              value={nextCallDate}
              onChange={(e) => setNextCallDate(e.target.value)}
              className="text-sm border border-neutral-200 rounded-lg px-2 py-1"
            />
          </div>
          <input
            type="url"
            value={calendarLink}
            onChange={(e) => setCalendarLink(e.target.value)}
            placeholder="Link to the recurring calendar event (optional)"
            className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1"
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1"
          />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn btn-sm btn-secondary">{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setEditing(false); resetFields(); }} disabled={busy} className="btn btn-sm btn-secondary">Cancel</button>
            {rc && <button onClick={clear} disabled={busy} className="text-xs text-error hover:underline ml-auto">Clear</button>}
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-neutral-700">
            {rc?.cadence ? (
              <>
                <span className="font-medium">{rc.cadence}</span>
                {rc.nextCallDate && <span className="text-neutral-500"> · next {rc.nextCallDate.slice(0, 10)}</span>}
                {rc.calendarLink && (
                  <>
                    {' · '}
                    <a href={rc.calendarLink} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">Open Calendar Event ↗</a>
                  </>
                )}
                {rc.notes && <p className="text-neutral-500 text-xs mt-1">{rc.notes}</p>}
              </>
            ) : <span className="italic text-neutral-400">no recurring call set</span>}
          </div>
          <button onClick={() => setEditing(true)} className="text-xs text-accent-600 hover:underline shrink-0">Edit</button>
        </div>
      )}
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  );
}

function AccountDrawer({ account, onClose, companyHosts, onUpdated }) {
  const svc = account.serviceHealth;
  const fin = account.financialHealth;
  const openDeals = (fin?.expansionPipeline?.deals || []).filter((d) => d.isOpen);
  // All-time closed count — totalDeals/openDealsCount already cover the
  // account's full deal history (see mapLiveFinancialHealth's doc comment
  // server-side), so this needs no new data, just totalDeals minus the
  // open count already shown right next to it.
  const closedDealCount = fin?.totalDeals != null
    ? Math.max(0, fin.totalDeals - (fin.expansionPipeline?.openDealsCount || 0))
    : null;

  return (
    <Drawer
      title={account.company_name}
      subtitle={
        <>
          {account.hubspotUrl ? (
            <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
              Open in HubSpot
            </a>
          ) : `HubSpot company ${account.hubspot_company_id}`}
          {account.lifecycle_stage ? ` · lifecycle stage ${account.lifecycle_stage}` : ''}
        </>
      }
      badge={<ScoreBadge score={account.health_score} band={BAND_LABEL_TO_COLOR[account.health_band] || null} />}
      onClose={onClose}
    >
      <div className="mb-4">
        <ExportButtons
          onExcel={() => exportAccountHealthSingleExcel(account)}
          onPdf={() => downloadPdf(`/api/account-health/${account.hubspot_company_id}/export-pdf`, `${account.company_name}-Account-Health.pdf`)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Open Tickets" value={account.open_ticket_count} sub="Client Submitted + In Progress" />
        <StatCard label="Closed Tickets" value={account.closed_ticket_count} />
        <StatCard label="Open Deals" value={account.open_deal_count} sub={closedDealCount != null ? `${closedDealCount} closed (all-time)` : undefined} />
        <StatCard label="Open Deal Value" value={currencyStr(account.open_deal_value_cents)} />
        <StatCard label="ARR" value={account.arr_cents != null ? currencyStr(account.arr_cents) : '—'} />
        <StatCard label={`ARR Added (${new Date().getFullYear()})`} value={currencyStr(account.arr_added_this_year_cents)} />
        <StatCard label="Aging Balance" value={account.aging_total_cents != null ? currencyStr(account.aging_total_cents) : '—'} />
        <StatCard label="DSO" value={account.dsoDays != null ? `${account.dsoDays}d` : '—'} sub="Rudimentary — see Portfolio DSO note" />
        <StatCard label="Total Capacity" value={account.total_capacity ?? '—'} sub={account.occupancy_as_of_date ? `As of ${account.occupancy_as_of_date}` : 'No ALIS subdomain mapped'} />
        <StatCard label="Current Census" value={account.current_census ?? '—'} sub={account.occupancy_pct != null ? `${pctStr(account.occupancy_pct)} occupied` : undefined} />
      </div>

      <AlisHostEditor account={account} companyHosts={companyHosts} onUpdated={onUpdated} />
      <RecurringCallEditor account={account} onUpdated={onUpdated} />

      {account.priorQbr && (
        <div className="alert alert-info mb-6">
          <span>📊</span>
          <p className="text-sm">
            Most recent QBR ({account.priorQbr.createdAt?.slice(0, 10)}) has {account.priorQbr.flagCount} flag(s) —
            {' '}<a href={`/qbr/${account.priorQbr.jobId}`} className="underline font-medium">open full dashboard</a>.
          </p>
        </div>
      )}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Service Health</h3>
      {svc?.avgTicketAgeDays != null && (
        <p className="text-sm text-neutral-600 mb-3">Average open ticket age: {svc.avgTicketAgeDays.toFixed(1)} days</p>
      )}
      {svc?.agedTickets?.length > 0 ? (
        <ul className="text-sm mb-6 space-y-1">
          {svc.agedTickets.map((t) => (
            <li key={t.ticketId} className="flex justify-between gap-2">
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline truncate">{t.subject}</a>
              <span className="text-neutral-400 shrink-0">{t.ageDays}d · {t.stage}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No tickets open past 45 days.</p>}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Enhancement Tracking</h3>
      {(svc?.enhancementTopItems?.length > 0 || svc?.enhancementLesserCount > 0) ? (
        <div className="text-sm mb-6">
          {svc.enhancementTopItems?.length > 0 && (
            <ul className="space-y-1 mb-2">
              {svc.enhancementTopItems.map((t) => (
                <li key={t.ticketId} className="flex justify-between gap-2">
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline truncate">
                    {t.rank ? `#${t.rank} · ` : ''}{t.subject}
                  </a>
                  <span className="text-neutral-400 shrink-0">{t.stage}</span>
                </li>
              ))}
            </ul>
          )}
          {svc.enhancementLesserCount > 0 && (
            <p className="text-neutral-500">{svc.enhancementLesserCount} additional Long-Term Project(s) tracked as lesser enhancements.</p>
          )}
        </div>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No enhancement requests tracked.</p>}
      {svc?.otherOpenCount > 0 && (
        <p className="text-xs text-neutral-400 -mt-4 mb-6">{svc.otherOpenCount} other open ticket(s) in lower-volume statuses (billing/support), not counted above.</p>
      )}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Financial Health</h3>
      {openDeals.length > 0 ? (
        <ul className="text-sm mb-6 space-y-1">
          {openDeals.map((d, i) => (
            <li key={i}>
              <div className="flex justify-between gap-2">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline truncate">{d.name}</a>
                ) : <span className="text-neutral-700 truncate">{d.name}</span>}
                <span className={`shrink-0 ${isPastDue(d) ? 'text-error font-medium' : 'text-neutral-400'}`}>
                  {d.stage} · {currencyStr(d.valueCents)}{d.expectedCloseDate ? ` · due ${d.expectedCloseDate.slice(0, 10)}${isPastDue(d) ? ' (past due)' : ''}` : ''}
                </span>
              </div>
              {d.nextStep && <p className="text-neutral-400 italic pl-2">↳ {d.nextStep}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No open deals.</p>}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">AR Aging</h3>
      {account.aging ? (
        <div className="mb-6">
          <p className="text-xs text-neutral-400 mb-2">As of {account.aging.asOfDate} — {account.aging.sourceRows.length} Intacct line(s) rolled up</p>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Current</th>
                <th className="py-1 text-right">1-30</th>
                <th className="py-1 text-right">31-60</th>
                <th className="py-1 text-right">61-90</th>
                <th className="py-1 text-right">91-120</th>
                <th className="py-1 text-right">121+</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-neutral-100">
                <td className="py-1.5">{currencyStr(account.aging.currentCents)}</td>
                <td className="py-1.5 text-right">{currencyStr(account.aging.d1_30Cents)}</td>
                <td className="py-1.5 text-right">{currencyStr(account.aging.d31_60Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d61_90Cents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d61_90Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d91_120Cents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d91_120Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d121PlusCents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d121PlusCents)}</td>
                <td className="py-1.5 text-right font-semibold">{currencyStr(account.aging.totalCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-neutral-400">
            From: {account.aging.sourceRows.map((r) => r.customerName).join(', ')}
          </p>
        </div>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No aging data imported for this account yet.</p>}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Occupancy</h3>
      {(account.occupancyByProductType?.length > 0 || account.occupancyByClassification?.length > 0) ? (
        <div className="mb-6">
          <div className="flex gap-6 flex-wrap">
            <OccupancyBreakdownTable title="By Product Type" rows={account.occupancyByProductType} keyField="productType" />
            <OccupancyBreakdownTable title="By Classification" rows={account.occupancyByClassification} keyField="classification" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 italic mb-6">
          {account.occupancy_as_of_date ? 'No product-type/classification breakdown available.' : 'No ALIS subdomain mapped for this account yet — see Refresh Occupancy Data.'}
        </p>
      )}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Sub-scores</h3>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(account.subScores || {}).map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-neutral-700 capitalize">{k}</span>
            <span className="text-neutral-500">{v == null ? '—' : v}</span>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function flattenDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) {
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id });
    }
  }
  return rows;
}

function flattenArrAddedDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id });
    }
  }
  return rows;
}

/**
 * Rollup of every account with a recurring-call cadence set — hand-
 * entered per account via RecurringCallEditor in the drawer (no calendar
 * API integration exists to auto-populate this, see that component's
 * doc comment). Sorted by next call date ascending by default (soonest
 * first, nulls last) so this reads as an actionable "what's coming up"
 * list, not just a static reference table. Row click opens the same
 * AccountDrawer the main Accounts table uses — cadence/date/link/notes
 * are edited there, not inline in this table.
 */
function RecurringCallsSection({ accounts, onSelect }) {
  const rows = useMemo(() => accounts.filter((a) => a.recurringCall?.cadence), [accounts]);
  const [sort, setSort] = useState({ column: 'nextCallDate', direction: 'asc' });

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column === 'company_name' ? a.company_name : a.recurringCall?.[column];
      const bv = column === 'company_name' ? b.company_name : b.recurringCall?.[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  return (
    <SectionCard
      title="Recurring Calls"
      description={`${rows.length} account(s) with a recurring call cadence set — edit cadence/date/link from an account's drawer`}
      defaultExpanded={false}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No recurring calls tracked yet — open an account in the table below and set one from its drawer.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Account" column="company_name" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Cadence" column="cadence" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Next Call" column="nextCallDate" sort={sort} onSort={toggleSort} className="pr-4" />
                <th className="pb-2 pr-4">Calendar</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.hubspot_company_id} className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50" onClick={() => onSelect(a)}>
                  <td className="py-2 pr-4 font-medium text-neutral-700">{a.company_name}</td>
                  <td className="py-2 pr-4 text-neutral-500">{a.recurringCall.cadence}</td>
                  <td className="py-2 pr-4 text-neutral-500">{a.recurringCall.nextCallDate ? a.recurringCall.nextCallDate.slice(0, 10) : '—'}</td>
                  <td className="py-2 pr-4">
                    {a.recurringCall.calendarLink ? (
                      <a
                        href={a.recurringCall.calendarLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-accent-600 hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="py-2 text-neutral-500 truncate max-w-xs">{a.recurringCall.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * The actual deals behind the "ARR Added" roll-up tile — Aaron asked (Sep
 * 2026) for this after the figure jumped once arrAddedThisYearCents
 * switched from summing `amount` to `arr_value`, since a portfolio-wide
 * sum with no way to see what's in it isn't trustworthy on its own.
 */
function ArrAddedDealsSection({ accounts }) {
  const deals = useMemo(() => flattenArrAddedDeals(accounts), [accounts]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'arrValueCents', direction: 'desc' });

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? deals.filter((d) => d.companyName?.toLowerCase().includes(q)) : deals;
  }, [deals, search]);

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filtered, sort]);

  const totalCents = deals.reduce((s, d) => s + d.arrValueCents, 0);
  const filteredTotalCents = filtered.reduce((s, d) => s + d.arrValueCents, 0);

  return (
    <SectionCard
      title="ARR Added This Year — Contributing Deals"
      description={
        search.trim()
          ? `${filtered.length} of ${deals.length} closed-won deal(s) shown, matching "${search.trim()}" — totaling ${currencyStr(filteredTotalCents)}`
          : `${deals.length} closed-won deal(s) totaling ${currencyStr(totalCents)}`
      }
      defaultExpanded={false}
      action={
        <input
          type="text"
          placeholder="Search accounts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
        />
      }
    >
      {deals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No closed-won deals with an ARR value this year yet.</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic py-4">No deals for accounts matching "{search.trim()}".</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Account" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Deal" column="name" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Pipeline" column="pipeline" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="ARR Value" column="arrValueCents" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Close Date" column="closeDate" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={`${d.hubspotCompanyId}:${d.name}:${i}`} className="border-t border-neutral-100">
                  <td className="py-2 pr-4 text-neutral-700">{d.companyName}</td>
                  <td className="py-2 pr-4">
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{d.name}</a> : d.name}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{d.pipeline}</td>
                  <td className="py-2 pr-4 text-neutral-500">{d.stage}</td>
                  <td className="py-2 pr-4 text-neutral-500">{currencyStr(d.arrValueCents)}</td>
                  <td className="py-2 text-neutral-500">{d.closeDate ? d.closeDate.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Portfolio-wide Deals view — every account's open + recently-closed (90
 * day) deals in one flat, filterable/sortable table, so deals that "lurch
 * and progress at strange cadences" can be reviewed and queued up without
 * clicking into each account one at a time. Tasks fetched per-deal server
 * side (see accountHealth.js's mapLiveFinancialHealth) — `tasks: null`
 * (vs. `[]`) means the fetch itself failed for that one deal, shown as
 * "unavailable" rather than a false "no open tasks."
 */
function DealsSection({ accounts, search }) {
  const allDeals = useMemo(() => flattenDeals(accounts), [accounts]);
  const pipelines = useMemo(
    () => [...new Set(allDeals.map((d) => d.pipeline).filter(Boolean))].sort(),
    [allDeals]
  );
  const [pipelineFilter, setPipelineFilter] = useState([]); // empty = all pipelines
  const [sort, setSort] = useState({ column: 'expectedCloseDate', direction: 'asc' });
  const [expandedKey, setExpandedKey] = useState(null);

  function togglePipeline(p) {
    setPipelineFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const base = pipelineFilter.length === 0 ? allDeals : allDeals.filter((d) => pipelineFilter.includes(d.pipeline));
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
  }, [allDeals, pipelineFilter, sort]);

  return (
    <SectionCard
      title="All Deals"
      description={
        search.trim()
          ? `Open + recently-closed (90 days) — ${filtered.length} of ${allDeals.length} shown, matching "${search.trim()}"`
          : `Open + recently-closed (90 days) across every account — ${filtered.length} of ${allDeals.length} shown`
      }
      defaultExpanded={false}
    >
      {allDeals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          {search.trim() ? `No deals for accounts matching "${search.trim()}".` : 'No deals yet — click Refresh to pull them.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {pipelines.map((p) => (
              <button
                key={p}
                onClick={() => togglePipeline(p)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  pipelineFilter.includes(p)
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {p}
              </button>
            ))}
            {pipelineFilter.length > 0 && (
              <button onClick={() => setPipelineFilter([])} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
                Clear filter
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                  <SortableHeader label="Account" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Deal" column="name" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Pipeline" column="pipeline" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Value" column="valueCents" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Close Date" column="expectedCloseDate" sort={sort} onSort={toggleSort} className="pr-4" />
                  <th className="pb-2 pr-4">Next Step</th>
                  <th className="pb-2">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d, i) => {
                  const key = `${d.hubspotCompanyId}:${d.name}:${i}`;
                  const pastDue = isPastDue(d);
                  const tasks = d.tasks;
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-neutral-100">
                        <td className="py-2 pr-4 text-neutral-700">{d.companyName}</td>
                        <td className="py-2 pr-4">
                          {d.url ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{d.name}</a>
                          ) : d.name}
                        </td>
                        <td className="py-2 pr-4 text-neutral-500">{d.pipeline}</td>
                        <td className="py-2 pr-4 text-neutral-500">{d.stage}{!d.isOpen && <span className="text-neutral-400"> (closed)</span>}</td>
                        <td className="py-2 pr-4 text-neutral-500">{currencyStr(d.valueCents)}</td>
                        <td className={`py-2 pr-4 ${pastDue ? 'text-error font-medium' : 'text-neutral-500'}`}>
                          {d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '—'}{pastDue ? ' ⚠' : ''}
                        </td>
                        <td className="py-2 pr-4 text-neutral-500 max-w-xs truncate">{d.nextStep || '—'}</td>
                        <td className="py-2">
                          {tasks === null ? (
                            <span className="text-neutral-400 italic text-xs">unavailable</span>
                          ) : tasks.length === 0 ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <button
                              onClick={() => setExpandedKey(expandedKey === key ? null : key)}
                              className="text-accent-600 hover:underline text-xs"
                            >
                              {tasks.length} open {expandedKey === key ? '▲' : '▼'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedKey === key && tasks?.length > 0 && (
                        <tr className="bg-neutral-50">
                          <td colSpan={8} className="py-2 px-4">
                            <ul className="text-xs space-y-1">
                              {tasks.map((t) => (
                                <li key={t.id} className={t.isOverdue ? 'text-error font-medium' : 'text-neutral-600'}>
                                  {t.subject} — {t.status}{t.dueDate ? ` · due ${t.dueDate.slice(0, 10)}` : ''}{t.isOverdue ? ' (overdue)' : ''}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

export default function AccountHealthDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [companyHosts, setCompanyHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const [companiesByTierChartType, setCompaniesByTierChartType] = useState('bar');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [accountsRes, hostsRes] = await Promise.all([
        fetch('/api/account-health'),
        fetch('/api/company-hosts'),
      ]);
      const data = await accountsRes.json();
      if (!accountsRes.ok) throw new Error(data.error || `Failed to load (${accountsRes.status})`);
      setAccounts(data.accounts || []);
      setCompanyHosts(hostsRes.ok ? await hostsRes.json() : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRefreshed(summary) {
    setRefreshResult(summary);
    await load();
  }

  const [sort, setSort] = useState({ column: 'company_name', direction: 'asc' });

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? accounts.filter((a) => a.company_name?.toLowerCase().includes(q)) : accounts;
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always last, regardless of direction
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [accounts, search, sort]);

  const rollup = useMemo(() => {
    const scored = accounts.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;

    // Weighted, not a simple average-of-averages, so a handful of small
    // accounts with an odd balance/ARR ratio can't swing the portfolio
    // figure — same reasoning as summing dollars before dividing anywhere
    // else in this rollup. Still a rudimentary DSO (see
    // accountHealthScoring.js's computeDsoDays doc comment) — labeled as
    // such wherever it's shown.
    const dsoEligible = accounts.filter((a) => a.aging_total_cents != null && a.arr_cents);
    const dsoAgingTotal = dsoEligible.reduce((s, a) => s + a.aging_total_cents, 0);
    const dsoArrTotal = dsoEligible.reduce((s, a) => s + a.arr_cents, 0);
    const portfolioDsoDays = dsoArrTotal > 0 ? Math.round(dsoAgingTotal / (dsoArrTotal / 365)) : null;

    // Only accounts with a known ALIS subdomain carry occupancy data (see
    // CompanyHostMappingButtons) — everyone else is left out of these
    // sums entirely rather than silently counted as 0 capacity.
    const occupancyEligible = accounts.filter((a) => a.total_capacity != null);
    const totalCapacity = occupancyEligible.reduce((s, a) => s + a.total_capacity, 0);
    const currentCensus = occupancyEligible.reduce((s, a) => s + (a.current_census || 0), 0);
    const occupancyAsOfDate = accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null;

    return {
      totalAccounts: accounts.length,
      totalCommunities: accounts.reduce((s, a) => s + (a.active_community_count || 0), 0),
      recurringCallCount: accounts.filter((a) => a.recurringCall?.cadence).length,
      openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      enhancementTop: accounts.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
      enhancementLesser: accounts.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
      otherOpen: accounts.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
      openDeals: accounts.reduce((s, a) => s + (a.open_deal_count || 0), 0),
      openDealValueCents: accounts.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
      arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
      arrAddedThisYearCents: accounts.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      agingTotalCents: accounts.reduce((s, a) => s + (a.aging_total_cents || 0), 0),
      pastDue61PlusCents: accounts.reduce((s, a) => s + (a.aging_past_due_61_plus_cents || 0), 0),
      agingAsOfDate: accounts.find((a) => a.aging_as_of_date)?.aging_as_of_date || null,
      portfolioDsoDays,
      totalCapacity,
      currentCensus,
      occupancyPct: totalCapacity > 0 ? currentCensus / totalCapacity : null,
      occupancyAccountCount: occupancyEligible.length,
      occupancyAsOfDate,
      avgScore,
      // Lifecycle stages come back as opaque HubSpot property-option IDs
      // (or the literal "lead" for that built-in one) — not resolved to
      // display labels in this pass (would need a company-property-schema
      // lookup this feature doesn't do yet), so this is flagged raw rather
      // than silently treated as "all customers."
      leadCount: accounts.filter((a) => a.lifecycle_stage === 'lead').length,
    };
  }, [accounts]);

  return (
    <div>
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="flex items-center gap-3 text-5xl font-bold text-primary-900">
            <img src="/butterfly-icon.png" alt="" className="h-11 w-auto" />
            Account Health
          </h1>
          <p className="text-sm text-neutral-500 mt-2">
            {rollup.totalAccounts} HubSpot accounts you own
            {refreshResult && ` · last refresh: ${refreshResult.companyCount} accounts, ${refreshResult.errorCount} error(s)`}
          </p>
          <p className="text-xs text-accent-600 font-medium mt-1">
            Proactive health · portfolio financials · data you can trust
          </p>
          {refreshResult?.excludedInactiveCommunities?.length > 0 && (
            <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
              Excluded {refreshResult.excludedInactiveCommunities.length} Home Office(s) with no active ALIS community: {refreshResult.excludedInactiveCommunities.map((c) => c.name).join(', ')}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center justify-end gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
            <ExportButtons
              onExcel={() => exportAccountHealthPortfolioExcel(accounts, rollup)}
              onPdf={() => downloadPdf('/api/account-health/export-pdf', 'Account-Health-Portfolio.pdf')}
            />
          </div>
          <div className="flex items-center justify-end gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
            <ImportAgingReportButton onImported={load} />
          </div>
          <div className="flex items-center justify-end gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
            <CompanyHostMappingButtons accounts={accounts} companyHosts={companyHosts} onImported={load} />
          </div>
          <div className="flex items-center justify-end gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
            <RefreshOccupancyButton onRefreshed={load} />
            <RefreshButton onRefreshed={handleRefreshed} />
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error mb-6"><span>⚠️</span><p className="text-sm">{error}</p></div>}

      {rollup.leadCount > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <p className="text-sm">
            {rollup.leadCount} of these accounts have lifecycle stage "lead" — likely prospects, not active clients.
            This view currently includes every account you own regardless of stage; filtering can be added once you confirm which stages should count.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-neutral-500 mb-4">No cached account health data yet.</p>
          <RefreshButton onRefreshed={handleRefreshed} />
        </div>
      ) : (
        <>
          {/* Four labeled acts instead of one flat 18-tile grid — see
              StatGroup's doc comment for the story each one is carrying. */}
          <StatGroup title="Portfolio Health — proactive, not reactive">
            <StatCard label="Total Accounts" value={rollup.totalAccounts} sub={<JumpLink to="accounts">Jump to table ↓</JumpLink>} />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} />
            <StatCard
              label="Recurring Calls Tracked"
              value={rollup.recurringCallCount}
              sub={<JumpLink to="recurring-calls">Jump to table ↓</JumpLink>}
            />
            <TopThreeEnhancementsCard accounts={accounts} />
          </StatGroup>

          <StatGroup title="Financial & Occupancy — the whole portfolio, already assembled">
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} />
            <StatCard
              label={`ARR Added (${new Date().getFullYear()})`}
              value={currencyStr(rollup.arrAddedThisYearCents)}
              sub={<JumpLink to="arr-added-this-year-contributing-deals">Jump to deals ↓</JumpLink>}
            />
            <StatCard
              label={`Total Capacity${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`}
              value={rollup.occupancyAccountCount > 0 ? rollup.totalCapacity : '—'}
              // Deliberately NOT worded "accounts mapped" — that phrase
              // already means something else (has a subdomain saved,
              // see the "N of 94 have a known ALIS subdomain" line up
              // top) and confused Aaron into thinking this was a mapping
              // gap. Most of these accounts DO have a subdomain mapped;
              // ALIS's own floor-plan data is just genuinely empty for
              // many of them, which is a different, non-fixable-here
              // situation (see the drawer's ALIS Subdomain(s) section).
              sub={rollup.occupancyAccountCount > 0 ? `${rollup.occupancyAccountCount} of ${rollup.totalAccounts} have occupancy data` : 'No occupancy data yet'}
            />
            <StatCard
              label="Current Census"
              value={rollup.occupancyAccountCount > 0 ? rollup.currentCensus : '—'}
              sub={rollup.occupancyPct != null ? `${pctStr(rollup.occupancyPct)} occupied` : undefined}
            />
            <StatCard label="Open Deals" value={rollup.openDeals} sub={<JumpLink to="all-deals">Jump to deals ↓</JumpLink>} />
            <StatCard label="Open Deal Value" value={currencyStr(rollup.openDealValueCents)} sub={<JumpLink to="all-deals">Jump to deals ↓</JumpLink>} />
          </StatGroup>

          <StatGroup title="Data You Can Trust — current, sourced, and dated">
            <StatCard
              label={`Aging Balance${rollup.agingAsOfDate ? ` (as of ${rollup.agingAsOfDate})` : ''}`}
              value={rollup.agingAsOfDate ? currencyStr(rollup.agingTotalCents) : '—'}
            />
            <StatCard
              label="Portfolio DSO"
              value={rollup.portfolioDsoDays != null ? `${rollup.portfolioDsoDays}d` : '—'}
              sub="Rudimentary — AR balance ÷ daily revenue rate, not true invoice-to-payment DSO"
            />
            <StatCard
              label="Past Due 61+ Days"
              value={rollup.agingAsOfDate ? currencyStr(rollup.pastDue61PlusCents) : '—'}
            />
            <StatCard label="Total Communities" value={rollup.totalCommunities} sub="Active child companies" />
          </StatGroup>

          <StatGroup title="Support Activity">
            <StatCard
              label="Open Tickets"
              value={rollup.openTickets}
              sub={<>Client Submitted + In Progress<br /><JumpLink to="open-tickets-by-category-2-0">Jump to breakdown ↓</JumpLink></>}
            />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} sub={<JumpLink to="closed-tickets-by-category-2-0">Jump to breakdown ↓</JumpLink>} />
            <StatCard
              label="Enhancement Requests"
              value={rollup.enhancementTop + rollup.enhancementLesser}
              sub={
                <>
                  {`${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`}
                  <br /><JumpLink to="enhancement-requests">Jump to list ↓</JumpLink>
                </>
              }
            />
            <AlisPayTicketsCard accounts={accounts} />
          </StatGroup>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <QuickJumpNav
              sections={[
                'Recurring Calls',
                'Accounts',
                'Companies by Tier',
                'Community Revenue & Occupancy',
                'Open Tickets by Category 2.0',
                'Closed Tickets by Category 2.0',
                'Ticket Volume by Client Tier',
                'Cost to Serve by Tier',
                'Top 3 Enhancement Requests',
                'Enhancement Requests',
                'Deals by Type',
                'ARR Added This Year — Contributing Deals',
                'All Deals',
              ]}
            />
          </div>

          <RecurringCallsSection accounts={accounts} onSelect={setSelected} />

          <SectionCard
            title="Accounts"
            action={
              <input
                type="text"
                placeholder="Search accounts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                    <SortableHeader label="Account" column="company_name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Health" column="health_score" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Tickets" column="open_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed Tickets" column="closed_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deals" column="open_deal_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deal Value" column="open_deal_value_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Aging Balance" column="aging_total_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="DSO" column="dsoDays" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Capacity" column="total_capacity" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Current Census" column="current_census" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Last Activity" column="last_activity_date" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr
                      key={a.hubspot_company_id}
                      className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                      onClick={() => setSelected(a)}
                    >
                      <td className="py-2 pr-4 font-medium">
                        <div className="flex items-center gap-1.5">
                          <CompanyLink account={a} className="text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                          {a.occupancy_error && (
                            <span
                              title={`Occupancy refresh failed: ${a.occupancy_error}`}
                              className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-error/10 text-error cursor-help"
                            >
                              Failed
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{tierStr(a.tier)}</td>
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={BAND_LABEL_TO_COLOR[a.health_band] || null} /></td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.closed_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_deal_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{currencyStr(a.open_deal_value_cents)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.arr_cents != null ? currencyStr(a.arr_cents) : '—'}</td>
                      <td className={`py-2 pr-4 ${a.aging_past_due_61_plus_cents > 0 ? 'text-error font-medium' : 'text-neutral-500'}`}>
                        {a.aging_total_cents != null ? currencyStr(a.aging_total_cents) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{a.dsoDays != null ? `${a.dsoDays}d` : '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.total_capacity ?? '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.current_census ?? '—'}</td>
                      <td className="py-2 text-neutral-500">
                        <CompanyLink account={a} className="hover:text-accent-600 hover:underline">{lastActivityStr(a.last_activity_date)}</CompanyLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-neutral-500 italic py-4">No accounts match "{search}".</p>}
            </div>
          </SectionCard>

          {/* Companies by Tier + Community Revenue & Occupancy lead the
              section list (Sep 2026, Aaron) — they're the two things
              already built here that directly answer Gary's tier-aware
              health ask and Evan's Viva-style portfolio rollup ask, so
              they open the story instead of being buried under ticket
              detail. */}
          <SectionCard title="Companies by Tier" description="Number of accounts grouped by Client Tier, portfolio-wide" defaultExpanded={false}>
            <CompaniesByTierChart accounts={accounts} chartType={companiesByTierChartType} setChartType={setCompaniesByTierChartType} />
          </SectionCard>

          <SectionCard
            title="Community Revenue & Occupancy"
            description="Monthly per-community Net Revenue, Occupancy, and PPD with month-over-month variance — same report shape Viva's finance team was hand-building every month"
            defaultExpanded={false}
          >
            <CommunityRevenueSection accounts={accounts} />
          </SectionCard>

          <SectionCard title="Open Tickets by Category 2.0" description="Aggregated across every account — current workload" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="open" />
          </SectionCard>
          <SectionCard title="Closed Tickets by Category 2.0" description="Aggregated across every account — historical mix" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="closed" />
          </SectionCard>
          <SectionCard title="Ticket Volume by Client Tier" description="Open + closed tickets aggregated by Account Management Tier" defaultExpanded={false}>
            <TicketsByTierChart accounts={accounts} />
          </SectionCard>
          <SectionCard title="Cost to Serve by Tier" description="Ticket volume (open + closed) per $1,000 of ARR — how much more support each ARR dollar costs at lower tiers" defaultExpanded={false}>
            <CostToServeByTierChart accounts={accounts} />
          </SectionCard>
          <SectionCard title="Top 3 Enhancement Requests" description="Every account's staged Top 3 Enhancement Request, portfolio-wide">
            <EnhancementRequestsSection accounts={accounts} topThreeOnly />
          </SectionCard>
          <SectionCard title="Enhancement Requests" description="Every open ticket categorized or titled as an Enhancement, portfolio-wide — broader than the Top 3 Enhancement Requests section above">
            <EnhancementRequestsSection accounts={accounts} />
          </SectionCard>
          <SectionCard title="Deals by Type" description="Aggregated across every account's deal history — value shown is ARR" defaultExpanded={false}>
            <DealTypeChart accounts={accounts} />
          </SectionCard>

          <ArrAddedDealsSection accounts={accounts} />

          <DealsSection accounts={filtered} search={search} />
        </>
      )}

      {selected && (
        <AccountDrawer
          account={accounts.find((a) => a.hubspot_company_id === selected.hubspot_company_id) || selected}
          onClose={() => setSelected(null)}
          companyHosts={companyHosts}
          onUpdated={load}
        />
      )}
      <BackToTopButton />
    </div>
  );
}
