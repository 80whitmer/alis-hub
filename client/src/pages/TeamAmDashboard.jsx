import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, LabelList,
  LineChart, Line,
} from 'recharts';
import Drawer from '../components/Drawer';
import BackToTopButton from '../components/BackToTopButton';
import FloatingSectionNav from '../components/FloatingSectionNav';
import TopThreeEnhancementsCard from '../components/TopThreeEnhancementsCard';
import AlisPayTicketsCard from '../components/AlisPayTicketsCard';
import EnhancementRequestsSection from '../components/EnhancementRequestsSection';
import EscalationRequestsSection from '../components/EscalationRequestsSection';
import AlisInternalSection, { INTERNAL_SECTION_TITLE, useInternalDeepLink } from '../components/AlisInternalSection';
import { arrayBufferToBase64 } from '../utils/base64';
import { exportUnmappedAmRecords } from '../utils/unmappedAmExport';
import { exportAtRiskAccounts } from '../utils/atRiskExport';
import { exportUnassignedTierAccounts } from '../utils/unassignedTierExport';
import { exportCompanyHostTemplate, parseCompanyHostTemplate } from '../utils/accountHealthExport';
import { exportTeamAmPortfolioExcel } from '../utils/teamAmExport';
import { exportAllDeals } from '../utils/allDealsExport';
import { exportArrAddedDeals } from '../utils/arrAddedDealsExport';

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Same as AccountHealthDashboard.jsx's pctStr — duplicated, not shared, matching this codebase's per-page convention. */
function pctStr(p) {
  return p != null ? `${(p * 100).toFixed(1)}%` : '—';
}

/** Same as AccountHealthDashboard.jsx's numberStr (Sep 2026, Aaron: "add a comma to the capacity and census numbers... to make them more legible") — duplicated per this file's own convention. */
function numberStr(n) {
  return n == null ? '—' : n.toLocaleString('en-US');
}

/** notes_last_updated (HubSpot's "Last Activity Date") — last note/call/task logged for the company, either ALIS-initiated or a client email/call logged back. */
function lastActivityStr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Same as lastActivityStr but with a time-of-day, for a real ISO timestamp (e.g. refreshed_at) rather than a plain "as of this date" string — matches AccountHealthDashboard.jsx's identical helper. */
function dateTimeStr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** client_tier — HubSpot's Account Management Tier (1-4, based on ARR). 0/null both read as unset, not "Tier 0". */
function tierStr(tier) {
  return (tier == null || tier === 0) ? '—' : `Tier ${tier}`;
}

/** Same unset handling as tierStr, but as a chart bucket label — used to group accounts by tier across the charts below. */
function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}

const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];
function tierSort(a, b) {
  const ai = TIER_ORDER.indexOf(a.name);
  const bi = TIER_ORDER.indexOf(b.name);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
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

/**
 * `jumpTo` (Aaron, Sep 2026: "any tile that has a jump to link... make the
 * entire tile linked... give it the same [enlarging] action as Jump to
 * Section") turns the WHOLE tile into the jump control instead of a small
 * link buried in its `sub` line — same grow/pop-out-on-hover treatment as
 * QuickJumpNav (group + hover:scale-105/shadow-xl/z-10), and `label`/
 * `value`/`note` all step up a text size via group-hover so the growth
 * actually gains legibility rather than just gaining pixels. `note` is
 * plain descriptive text shown either way (e.g. "Client Submitted + In
 * Progress"); `jumpLabel` is the specific "Jump to ___" phrase for this
 * tile, rendered as a static hint (not its own separate `<a>`) since the
 * tile itself is now the click target. Tiles without `jumpTo` keep the
 * plain non-interactive `sub` shape unchanged. Kept in sync with
 * AccountHealthDashboard.jsx's identical component — including its Sep
 * 2026 row-alignment fix: min-h-8 on the label (so a short 1-line title
 * doesn't sit shorter than a 2-line one) plus flex flex-col items-start
 * on the button (confirmed live: a bare <button>, even with `display:
 * block` from `.card`, vertically CENTERS its children within whatever
 * height CSS Grid's row-stretch gives it — a native per-element quirk
 * invisible to getComputedStyle, not fixable by min-h-8 alone — so a
 * card with fewer lines than its tallest row-mate rendered visibly lower
 * than its neighbors until forced to top-anchor explicitly).
 */
function StatCard({ label, value, sub, note, jumpTo, jumpLabel = 'Jump to section ↓' }) {
  if (jumpTo) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: jumpTo } }))}
        className="group card relative w-full text-left transition-all duration-200 hover:scale-105 hover:z-10 hover:shadow-xl flex flex-col items-start"
      >
        <p className="text-xs group-hover:text-sm text-neutral-500 uppercase tracking-wide transition-[font-size] min-h-8">{label}</p>
        <p className="text-2xl group-hover:text-3xl font-bold text-primary-900 mt-1 transition-[font-size]">{value}</p>
        {note && <p className="text-xs group-hover:text-sm text-neutral-400 mt-0.5 transition-[font-size]">{note}</p>}
        <p className="text-xs group-hover:text-sm font-medium text-cool-glacier mt-0.5 transition-[font-size]">{jumpLabel}</p>
      </button>
    );
  }
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide min-h-8">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * Labeled cluster of stat tiles — matches AccountHealthDashboard.jsx's
 * identical component/story (Sep 2026, Aaron: "give the Team AM Dashboard
 * tiles the narrative, leadership vision treatment... consistent between
 * the two dashboards"). Team AM's tile set is thinner than Account
 * Health's (no AR-aging import here), so it only gets three acts —
 * Portfolio Health and Financial & Occupancy carry the same Gary/Evan
 * framing, but there's no "Data You Can Trust" group since this page has
 * no dated/sourced financial data of its own to hang that label on.
 */
function StatGroup({ title, children, columns = 4 }) {
  const gridClass = columns === 5 ? 'grid grid-cols-2 md:grid-cols-5 gap-4' : 'grid grid-cols-2 md:grid-cols-4 gap-4';
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-cool-glacier uppercase tracking-wide mb-3">{title}</p>
      <div className={gridClass}>
        {children}
      </div>
    </div>
  );
}

/** Matches a SectionCard's `title` to the DOM id the "Jump to Section" quick nav scrolls/expands — kept as a single source of truth (title -> id) so the nav never has to hardcode ids that could drift from a renamed title. */
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Cross-component "jump to this section" signal — QuickJumpNav dispatches it, every SectionCard listens for its own id, expands itself if collapsed, and scrolls into view. A DOM event rather than lifted state: this file renders a dozen independent SectionCards (several inside their own child components, e.g. UnmappedAmSection) and threading expanded/onToggle props through all of them just for this would be far more invasive than one shared event. */
const JUMP_EVENT = 'alis-hub:jump-to-section';

// Single source of truth for "every section on this page" — used by both
// the "Account & Operations Overview" card's QuickJumpNav and the floating
// butterfly FloatingSectionNav (Sep 2026) that takes over once that card
// scrolls out of view, so the two navigation menus can never drift apart.
// Same 3-theme taxonomy across all 3 dashboards (Sep 2026, Aaron: "keep the
// alphabetical ordering but introduce a thematic grouping to the links --
// accounts, financials, tickets") — same buckets on Account Health/KPI-QBR
// too, so a section's category means the same thing everywhere. No
// separate Operational catch-all (Aaron, Sep 2026: "totally comfortable
// with sections in that group joining the accounts section") — those items
// (KPI by Account Manager, Onboarding) just live in Accounts instead. Every
// ticket-related title also starts with "Ticket(s)" now (was "Escalation
// Tickets") so they already sort together within their own bucket. Each
// bucket's items are alphabetized here at build time (not hand-ordered) so
// a newly added section can't silently drift out of order.
const OVERVIEW_SECTIONS = [
  { category: 'Accounts', items: ['Accounts', 'Communities by AM by Tier', 'Communities by Tier', 'Companies by Tier', 'Companies by Tier by AM', 'Health Score Distribution', 'KPI by AM', 'Needs an AM', 'Onboarding'].sort((a, b) => a.localeCompare(b)) },
  { category: 'Financials', items: ['All Deals', 'ARR Added This Year', 'ARR by Tier', 'ARR by Tier per AM', 'Cost to Serve by Tier', 'Deals by Type'].sort((a, b) => a.localeCompare(b)) },
  { category: 'Tickets', items: ['Enhancement Requests', 'Enhancement Requests: Top 3', 'Ticket Activity', 'Ticket Volume by AM by Tier', 'Tickets by Category Closed', 'Tickets by Category Open', 'Tickets by Tier', 'Tickets: ALIS Internal', 'Tickets: Escalation'].sort((a, b) => a.localeCompare(b)) },
];

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

// "Toggle the Utilities panel" signal — same window-CustomEvent name/
// mechanism as AccountHealthDashboard.jsx's identical constant (kept in
// sync manually, not shared, matching this file's established per-page
// duplication convention for its other helpers above). Dispatched by the
// "Utilities" button in the header below; UtilityPanel is this page's
// only listener.
const UTILITIES_TOGGLE_EVENT = 'alis-hub:toggle-utilities';

// Fired by a Refresh button once its job finishes successfully (see
// RefreshButton/RefreshOccupancyButton's `finish` below) so the panel
// doesn't just sit open afterward — a portal-wide refresh takes long
// enough (minutes) that leaving the Drawer open post-completion read as
// "did this ever finish?" (Sep 2026, Aaron). Deliberately NOT fired on
// error — the error message renders inside this same panel, so an auto-
// close would hide the thing the user needs to see.
const UTILITIES_CLOSE_EVENT = 'alis-hub:close-utilities';

/**
 * The export/import/refresh buttons, tucked away in a slide-over side
 * Drawer (Sep 2026, Aaron: "add the same utility panel pattern... as the
 * Account Health page") rather than sitting always-visible in the header.
 * Renders nothing until the "Utilities" button in the header toggles it
 * open.
 */
function UtilityPanel({ children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleToggle() { setOpen((v) => !v); }
    function handleClose() { setOpen(false); }
    window.addEventListener(UTILITIES_TOGGLE_EVENT, handleToggle);
    window.addEventListener(UTILITIES_CLOSE_EVENT, handleClose);
    return () => {
      window.removeEventListener(UTILITIES_TOGGLE_EVENT, handleToggle);
      window.removeEventListener(UTILITIES_CLOSE_EVENT, handleClose);
    };
  }, []);

  if (!open) return null;
  return (
    <Drawer title="Utilities" subtitle="Export, import, and refresh actions for this dashboard" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-3">{children}</div>
    </Drawer>
  );
}

/**
 * Grid of links that jump to (and auto-expand) a SectionCard elsewhere on
 * the page, via JUMP_EVENT — no bespoke card of its own anymore (Sep 2026
 * — matches AccountHealthDashboard.jsx's identical simplification), just
 * the link grid; the caller wraps it in a real SectionCard ("Account &
 * Operations Overview") so it collapses/expands the exact same way as
 * every other section instead of the old always-visible, hover-grow
 * stat-tile treatment.
 */
function QuickJumpNav({ sections }) {
  function jumpTo(title) {
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: slugify(title) } }));
  }
  return (
    <div className="space-y-3">
      {sections.map((group) => (
        <div key={group.category}>
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-1.5">{group.category}</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
            {group.items.map((title) => (
              <li key={title} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent-300 shrink-0" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => jumpTo(title)}
                  className="text-left text-base leading-snug text-neutral-700 hover:text-accent-600 hover:underline"
                >
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
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

function CompanyLink({ account, children, className = 'font-medium text-cool-glacier hover:underline' }) {
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
    // Set BEFORE the fetch, not after it resolves (Sep 2026, Aaron: "once
    // clicked... acknowledge the action that was just kicked off... I'm
    // optimizing against people repeatedly mashing the button") — the
    // network round-trip to even create the job can itself take a
    // perceptible moment, and until now nothing changed on screen until
    // that resolved, so a slow first response read as "did my click even
    // register?" and invited a second/third click. `total: 0` here (real
    // total arrives a few lines down) already flips `refreshing` to true
    // and repaints the button immediately.
    setProgress({ completed: 0, total: 0, failed: 0, lastItem: null });
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
        // Piggyback Account Health's own refresh (Sep 2026, Aaron: "refresh
        // the Account Health board as well if the Team AM board is
        // refreshed") — silent and fire-and-forget on purpose: this button
        // stays a pure Team AM control, Account Health's refresh runs on its
        // own synchronous /refresh route (no job/SSE tracking like this one)
        // and its result just shows up next time that page is visited. A
        // failure here (e.g. the same HubSpot scope issue Account Health can
        // hit on its own) shouldn't surface as a Team AM refresh error, so
        // it's swallowed with just a console log for anyone debugging.
        fetch('/api/account-health/refresh', { method: 'POST' }).catch((err) => {
          console.error('[Team AM refresh] piggybacked Account Health refresh failed:', err);
        });
        window.dispatchEvent(new CustomEvent(UTILITIES_CLOSE_EVENT));
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
    <div>
      <button onClick={handleClick} disabled={refreshing} className={`btn btn-sm ${refreshing ? 'btn-accent' : 'btn-secondary'}`}>
        {refreshing ? (progress.total > 0 ? `Refreshing… ${pct}%` : 'Starting…') : '🔄 Refresh HubSpot Data'}
      </button>
      {refreshing && (
        <div className="mt-1 max-w-xs">
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
      {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
          {result.companyCount} companies refreshed{result.errorCount > 0 && `, ${result.errorCount} failed`}
        </p>
      )}
    </div>
  );
}

/**
 * This dashboard's own ALIS occupancy pull (Sep 2026) — same SSE + poll-
 * fallback job-progress pattern as RefreshButton above and as
 * AccountHealthDashboard.jsx's RefreshOccupancyButton, copied rather than
 * shared (same reasoning as RefreshButton's own doc comment: this
 * codebase duplicates this shape per page rather than extracting it, so
 * a change made for one dashboard's button can never break the other's).
 * Real load here scales with how many of these accounts have a mapped
 * ALIS subdomain (company_hosts), not with the full company count — see
 * the coverage lines in the header above.
 */
function RefreshOccupancyButton({ onRefreshed }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleClick() {
    // Set BEFORE the fetch — see RefreshButton's identical comment above
    // (Sep 2026, Aaron: acknowledge the click immediately so people stop
    // mashing the button unsure if it registered).
    setProgress({ completed: 0, total: 0, failed: 0, lastItem: null });
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/team-am/refresh-occupancy', { method: 'POST' });
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
        // Piggyback Account Health's own occupancy refresh (Sep 2026, Aaron:
        // "Account Health updates ... occupancy data when the Team AM
        // dashboard gets updated") — same fire-and-forget reasoning as
        // RefreshButton's identical HubSpot-data piggyback above: this
        // button stays a pure Team AM control, Account Health's occupancy
        // refresh runs on its own job-tracked /refresh-occupancy route and
        // its result just shows up next time that page is visited. A
        // failure here shouldn't surface as a Team AM refresh error, so
        // it's swallowed with just a console log for anyone debugging.
        fetch('/api/account-health/refresh-occupancy', { method: 'POST' }).catch((err) => {
          console.error('[Team AM occupancy refresh] piggybacked Account Health occupancy refresh failed:', err);
        });
        window.dispatchEvent(new CustomEvent(UTILITIES_CLOSE_EVENT));
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
            // The poll only has the job's own counts, not the richer
            // accountsUpdated/accountsSkippedNoMapping split the job_done
            // SSE event carries (job_items don't distinguish a real
            // occupancy update from a no-subdomain-mapped skip) — good
            // enough for "it finished" when SSE never delivered that event.
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
    <div>
      <button onClick={handleClick} disabled={refreshing} className={`btn btn-sm ${refreshing ? 'btn-accent' : 'btn-secondary'}`}>
        {refreshing ? (progress.total > 0 ? `Refreshing… ${pct}%` : 'Starting…') : '🏘️ Refresh Occupancy Data'}
      </button>
      {refreshing && (
        <div className="mt-1 max-w-xs">
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
      {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
      {result && !result.approximate && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
          {result.accountsUpdated} updated, {result.accountsSkippedNoMapping} skipped (no subdomain)
          {result.errorCount > 0 && `, ${result.errorCount} failed`}
        </p>
      )}
      {result?.approximate && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
          {result.processed} processed{result.errorCount > 0 && `, ${result.errorCount} failed`}
        </p>
      )}
    </div>
  );
}

/**
 * Same ALIS-subdomain mapping buttons as AccountHealthDashboard.jsx's
 * CompanyHostMappingButtons, copied rather than shared (this file's
 * established per-page convention) — company_hosts is a single global
 * table (see this page's own `load()` comment above), so a subdomain
 * mapped from either dashboard's template shows up on both; this just
 * gives Team AM its own entry point for filling it in without having to
 * switch pages. Posts to the same existing /api/company-hosts/import route.
 */
function CompanyHostMappingButtons({ accounts, companyHosts, onImported }) {
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // Matches by HubSpot ID first, falling back to company name — same
  // fallback exportCompanyHostTemplate uses, needed for company_hosts rows
  // sourced from the admin.alisonline.com scrape (no HubSpot ID at all).
  const mappedCount = accounts.filter((a) => companyHosts.some((h) =>
    (h.hubspot_company_id && h.hubspot_company_id === a.hubspot_company_id) ||
    (h.company_name || '').trim().toLowerCase() === (a.company_name || '').trim().toLowerCase()
  )).length;

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

  async function handleRefreshFromAdmin() {
    setRefreshing(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/company-hosts/refresh-from-admin', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setResult(data);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  const subdomainStatus = `${mappedCount} of ${accounts.length} accounts have a known ALIS subdomain`;

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleRefreshFromAdmin} className="btn btn-sm btn-secondary" title="Log in to admin.alisonline.com and pull every company's subdomain directly" disabled={refreshing}>
        {refreshing ? 'Refreshing…' : '🔄 Refresh from ALIS Admin'}
      </button>
      <button onClick={handleDownload} className="btn btn-sm btn-secondary" title={subdomainStatus}>📋 Download Subdomain Template</button>
      <label className="btn btn-sm btn-secondary cursor-pointer" title={subdomainStatus}>
        {importing ? 'Importing…' : '📤 Upload Completed Template'}
        <input type="file" accept=".xlsx" onChange={handleUpload} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error max-w-xs">{error}</p>}
      {result && <p className="text-xs text-neutral-500 max-w-xs">{result.imported} subdomain(s) imported{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}{result.found != null ? ` (${result.found} found on admin.alisonline.com)` : ''}</p>}
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
    <div>
      <label className="btn btn-sm btn-secondary cursor-pointer">
        {importing ? 'Importing…' : '📥 Import Aging Report'}
        <input type="file" accept="application/pdf" onChange={handleFile} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
          {result.accountsUpdated} account(s) updated from {result.rowsMatched} of {result.rowsParsed} rows
          {result.unmatchedCount > 0 && ` — ${result.unmatchedCount} row(s) didn't match any account`}
        </p>
      )}
    </div>
  );
}

/**
 * Downloads the portfolio-wide Team AM workbook (Sep 2026, Aaron) — built
 * entirely client-side from data already on the page (accounts + the two
 * rollups), same pattern as AccountHealthDashboard.jsx's ExportButtons
 * "Export Excel" action. Meant to travel outside this app (e.g. into a
 * separate analysis conversation), so it carries the full departmental
 * picture — portfolio KPIs, the AM-level rollup, a tier-level rollup, every
 * account, and every tracked onboarding/implementation project — not just
 * whatever's currently visible on screen.
 */
function ExportExcelButton({ accounts, rollup, rollupByAccountManager }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setExporting(true);
    setError('');
    try {
      await exportTeamAmPortfolioExcel(accounts, rollup, rollupByAccountManager);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={exporting} className="btn btn-sm btn-secondary">
        {exporting ? 'Exporting…' : '📊 Export Excel'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
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

// Fixed per-AM line colors (Aaron, Sep 2026: "Make Patrick Noack green and
// make me Blue, the others are good") — everyone else still cycles through
// PIE_COLORS by volume rank same as before, just with blue/green pulled out
// of that rotation so they can't collide with these two reserved names.
// Used by OpenTicketVolumeChart's "Break Out by AM" line colors.
const AM_LINE_COLOR_OVERRIDES = { 'Patrick Noack': '#16a34a', 'Aaron Whitmer': '#2563eb' };
const AM_LINE_COLOR_FALLBACK = PIE_COLORS.filter((c) => c !== '#16a34a' && c !== '#2563eb');

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

/**
 * Custom two-line Pie label (Aaron, Sep 2026: "avoid labels getting cut
 * off... wrapping would be fine, as long as the detail is legible") —
 * same fix as AccountHealthDashboard.jsx's identical helper: Recharts'
 * default `label` renders one long <text> node ("Tier 1: 148 (27%)") that
 * routinely runs past the SVG edge and gets clipped there, especially for
 * two or three pies sharing a fraction of the row's width. Wraps onto two
 * <tspan> lines (name, then value) instead, replicating the midAngle/
 * outerRadius geometry Recharts' own default label positioning uses so
 * multi-line text still points at the right slice from the right side.
 */
function wrappedPieLabel(valueOf) {
  return (props) => {
    const { cx, cy, midAngle, outerRadius, name } = props;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 18;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const anchor = x > cx ? 'start' : 'end';
    return (
      <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={12} fill="#404040">
        <tspan x={x} dy="-0.3em">{name}</tspan>
        <tspan x={x} dy="1.1em">{valueOf(props)}</tspan>
      </text>
    );
  };
}

// Labels are pre-sorted alphabetically (Aaron, Sep 2026: "anchor" each
// family — ARR/Occupancy/Tickets/Deals — on a common lead word "so they
// will align alphabetically" in this dropdown) rather than sorted at
// render time — same reasoning as AccountHealthDashboard.jsx's identical
// AM_KPI_METRICS. "Accounts"/"Communities" dropped their "Total" prefix
// entirely (Aaron: rename these "just 'Accounts'/'Communities'").
const METRICS = [
  { key: 'totalAccounts', label: 'Accounts', format: (v) => v },
  // Split (Sep 2026, Aaron) — "Added to Book" is account-owner-based (ARR
  // added on accounts this AM currently owns, a workload signal), while
  // "Personally Closed" is deal-owner-based (ARR from deals this AM
  // actually closed, a productivity signal). See
  // computeRollupByAccountManager's doc comment (server/api/teamAm.js)
  // for why these two used to be conflated under one field and disagreed
  // with the Accounts tab's own per-account sums.
  { key: 'arrAddedToBookCents', label: `ARR: Added to Book (${new Date().getFullYear()})`, format: currencyStr },
  { key: 'arrPersonallyClosedCents', label: `ARR: Personally Closed (${new Date().getFullYear()})`, format: currencyStr },
  { key: 'arrCents', label: 'ARR: Total', format: currencyStr },
  { key: 'avgScore', label: 'Avg Health Score', format: (v) => v },
  { key: 'totalCommunities', label: 'Communities', format: (v) => v },
  { key: 'dealsThisYearClosed', label: `Deals: Closed (${new Date().getFullYear()})`, format: (v) => v },
  { key: 'dealsThisYearOpen', label: `Deals: Open (${new Date().getFullYear()})`, format: (v) => v },
  { key: 'totalCapacity', label: 'Occupancy: Capacity', format: (v) => v },
  { key: 'currentCensus', label: 'Occupancy: Census', format: (v) => v },
  { key: 'closedTickets', label: 'Tickets: Closed', format: (v) => v },
  { key: 'openTickets', label: 'Tickets: Open', format: (v) => v },
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
              <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => metric.format(p.total))} isAnimationActive={false}>
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

/** Merges several named point series (each [{recorded_date, value}]) into one row-per-date array — same helper as AccountHealthDashboard.jsx's identical function, duplicated per this file's own convention. */
function mergeSeries(seriesMap, keys) {
  const dates = new Set();
  for (const k of keys) (seriesMap[k] || []).forEach((p) => dates.add(p.recorded_date));
  const sorted = [...dates].sort();
  return sorted.map((date) => {
    const row = { recorded_date: date };
    for (const k of keys) {
      const point = (seriesMap[k] || []).find((p) => p.recorded_date === date);
      row[k] = point ? point.value : null;
    }
    return row;
  });
}

/**
 * "KPI by AM" dropdown's trend chart (Aaron, Sep 2026: "wire up the KPI by
 * AM reports... with the tracking and trending treatment") — trend line
 * for whichever metric is currently selected, same "a point is captured
 * every time you refresh" pattern as HealthScoreTrendSection just above
 * and AccountHealthDashboard.jsx's identical AmKpiTrendSection, backed by
 * this file's own team-wide kpi_metric_history rows (server/api/teamAm.js's
 * /refresh handler). Portfolio-wide, not per-AM — answers "how has the
 * team's number moved," same scope HealthScoreTrendSection already has.
 */
function KpiByAmTrendSection({ metricKey }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/team-am/kpi-metric-history')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || {}))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const merged = mergeSeries(history, [metricKey]);
  if (merged.length < 2) {
    return (
      <p className="text-sm text-neutral-500 italic">
        Not enough history yet for this metric — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
      </p>
    );
  }

  const metric = METRICS.find((m) => m.key === metricKey);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={metric.format} />
        <Tooltip formatter={(v) => metric.format(v)} />
        <Line type="monotone" dataKey={metricKey} name={metric.label} stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Fixed worst-to-best order (matches accountHealthScoring.js's SCORE_BANDS
// exactly: <40 / 40-60 / 60-80 / 80-100) rather than sorted by count, so
// the "spread" reads left-to-right as a quality gradient every time,
// not shuffled depending on which band happens to have the most accounts.
const HEALTH_BANDS = ['Unhealthy', 'At Risk', 'Stable', 'Healthy'];

/**
 * "Health Score Trend" (Sep 2026, Aaron: "capture the progress of this
 * kpi over time... I plan on improving my average 85 and want to capture
 * the effort and result") — portfolio Avg Health Score, one point per day
 * a portal-wide refresh has run. Rendered inside the existing "Health
 * Score Distribution" section below rather than a section of its own —
 * that section's SectionCard already owns the "Avg Health Score" KPI
 * tile's jump link, so folding the trend in here means that one link
 * already covers both the distribution snapshot and its trend, with no
 * new nav entry needed. A brand-new metric with no backfill possible, so
 * a short/empty trail is expected here at first, not an error.
 */
function HealthScoreHistoryChart({ history }) {
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;
  if (history.length < 2) {
    return (
      <p className="text-sm text-neutral-500 italic">
        Not enough history yet — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={history} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(value, name, props) => [`${value}${props.payload.account_count ? ` (avg of ${props.payload.account_count} accounts)` : ''}`, 'Avg Health Score']} />
        <Line type="monotone" dataKey="avg_health_score" name="Avg Health Score" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
          <LabelList dataKey="avg_health_score" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

function HealthScoreTrendSection() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/team-am/health-score-history')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="mt-6 pt-6 border-t border-neutral-100">
      <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
      {error ? <p className="text-sm text-error">{error}</p> : <HealthScoreHistoryChart history={history} />}
    </div>
  );
}

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

/**
 * "Number of tickets by tier" (Aaron, Sep 2026) — open vs. closed ticket
 * volume grouped by client_tier, portfolio-wide. Open/closed kept as
 * separate bars (not summed into one "total tickets" figure) since a
 * tier with a lot of closed tickets and a tier with a lot of OPEN tickets
 * read very differently for triage purposes.
 */
// Same hue as TIER_COST_COLOR, one Tailwind step darker (both scales are
// literally Tailwind's own 600/700 shades) — used to tell Closed apart
// from Open within one tier's color family (Sep 2026, Aaron: "recolor
// this red and blue graph to have tier colors represented in the open
// tickets and... darker shades of the tier colors representing closed
// tickets" — same treatment as AccountHealthDashboard.jsx's identical
// chart).
const TIER_COST_COLOR_DARK = { 'Tier 1': '#15803d', 'Tier 2': '#1d4ed8', 'Tier 3': '#c2410c', 'Tier 4': '#b91c1c', Unassigned: '#525252' };

/**
 * Same bar/pie toggle and per-tier coloring as
 * AccountHealthDashboard.jsx's identical chart — Open colored via
 * TIER_COST_COLOR, Closed via TIER_COST_COLOR_DARK, both bar and pie
 * modes labeled with each tier's share of that series' own total (Sep
 * 2026, Aaron: "add percentages to the labels on the pie and bar
 * graphs"). No "Show Share of Total" mode here — that's specific to
 * Account Health Dashboard's own ARR-comparison story, not ported.
 */
function TicketsByTierChart({ accounts }) {
  const [chartType, setChartType] = useState('bar');
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    if (!byTier[key]) byTier[key] = { name: key, open: 0, closed: 0 };
    byTier[key].open += a.open_ticket_count || 0;
    byTier[key].closed += a.closed_ticket_count || 0;
  }
  const data = Object.values(byTier).filter((d) => d.open > 0 || d.closed > 0).sort(tierSort);
  const openTotal = data.reduce((s, d) => s + d.open, 0);
  const closedTotal = data.reduce((s, d) => s + d.closed, 0);
  const pctOf = (v, total) => (total > 0 ? ` (${Math.round((v / total) * 100)}%)` : '');
  const openPieData = data.filter((d) => d.open > 0).map((d) => ({ name: d.name, value: d.open }));
  const closedPieData = data.filter((d) => d.closed > 0).map((d) => ({ name: d.name, value: d.closed }));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {chartType === 'pie' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center">Open Tickets</h4>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={openPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${p.value}${pctOf(p.value, openTotal)}`)} isAnimationActive={false}>
                  {openPieData.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center">Closed Tickets</h4>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={closedPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${p.value}${pctOf(p.value, closedTotal)}`)} isAnimationActive={false}>
                  {closedPieData.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR_DARK[d.name] || '#525252'} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {/* fill on the Bar itself is only a fallback (Legend swatch)
                — the per-tier Cells below are what actually paint each
                bar. */}
            <Bar dataKey="open" name="Open" fill="#dc2626" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
              <LabelList dataKey="open" position="top" formatter={(v) => `${v}${pctOf(v, openTotal)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
            <Bar dataKey="closed" name="Closed" fill="#2563eb" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR_DARK[d.name] || '#525252'} />)}
              <LabelList dataKey="closed" position="top" formatter={(v) => `${v}${pctOf(v, closedTotal)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

const TIER_COST_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unassigned: '#737373' };

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
 * CALENDAR YEAR) per $1,000 of ARR, aggregated by Client Tier,
 * portfolio-wide. Portfolio-weighted (sum tickets ÷ sum ARR per tier),
 * not an average of each account's own ratio, so one near-zero-ARR
 * account can't blow up its whole tier's number. Aaron asked for this
 * (Sep 2026) to quantify how much more support effort lower-tier
 * accounts cost per revenue dollar than Tier 1, across the whole team,
 * to help justify where AM time/focus should go. Tiers with $0 ARR are
 * excluded (undefined ratio) rather than shown as a misleading
 * infinity/zero.
 *
 * Deliberately excludes tickets closed in a prior calendar year (Aaron,
 * Sep 2026) — this metric is meant to read as current support load, not
 * a lifetime ticket count, so old closed work shouldn't keep inflating
 * it forever. Uses serviceHealth.closedTicketCountThisYear (computed
 * server-side per account — see hubspotTickets.js's closedThisYear),
 * not the plain closed_ticket_count column, which is all-time and still
 * correct/used elsewhere (e.g. the Accounts table's own Closed Tickets
 * column).
 */
function CostToServeByTierChart({ accounts }) {
  const [excludeUnassigned, setExcludeUnassigned] = useState(false);
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    if (!byTier[key]) byTier[key] = { name: key, tickets: 0, arrCents: 0, accountCount: 0 };
    byTier[key].tickets += (a.open_ticket_count || 0) + (a.serviceHealth?.closedTicketCountThisYear || 0);
    byTier[key].arrCents += (a.arr_cents || 0);
    byTier[key].accountCount += 1;
  }
  const allData = Object.values(byTier)
    .filter((d) => d.arrCents > 0)
    .sort(tierSort)
    .map((d) => ({ ...d, ratio: (d.tickets * 100000) / d.arrCents }));

  if (allData.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ARR/ticket data yet — click Refresh to pull it.</p>;
  }

  // "Hide Unassigned" (Aaron, Sep 2026) — Unassigned-tier accounts tend to
  // carry a much higher ratio than any real tier (little/no ARR against a
  // real ticket count), which stretches the Y axis and flattens the
  // real-tier bars into near-invisibility. No explicit domain is set on
  // the YAxis below, so simply dropping Unassigned from `data` lets
  // Recharts auto-rescale to the remaining tiers — exactly the "resize to
  // emphasize the disparity" Aaron asked for, no extra chart config needed.
  const hasUnassigned = allData.some((d) => d.name === 'Unassigned');
  const data = excludeUnassigned ? allData.filter((d) => d.name !== 'Unassigned') : allData;

  return (
    <>
      {hasUnassigned && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setExcludeUnassigned((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              excludeUnassigned ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            {excludeUnassigned ? 'Show Unassigned' : 'Hide Unassigned'}
          </button>
        </div>
      )}
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">Only Unassigned-tier accounts have ARR/ticket data.</p>
      ) : (
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
      )}
    </>
  );
}

const TIER_METRICS = [
  { key: 'arrAddedThisYearCents', label: `ARR: Added (${new Date().getFullYear()})`, format: currencyStr },
  { key: 'arrCents', label: 'ARR: Total', format: currencyStr },
];

/**
 * "Tier by ARR" and "tier by ARR Added this year" (Aaron, Sep 2026) —
 * one reusable chart with a metric dropdown, same bar/pie-toggle shape as
 * KpiByAmChart, just grouped by client_tier instead of Account Manager.
 * Colored per-tier via TIER_COST_COLOR in both bar and pie modes (Sep
 * 2026, Aaron: "verify that all tier related reports are consistent with
 * 1 = green, 2 = blue, 3 = orange, 4 = red") — was a flat green bar /
 * rainbow-indexed pie, same fix as CompaniesByTierChart/
 * TicketsByAmByTierChart below.
 */
function TierByArrChart({ accounts, metricKey, setMetricKey, chartType, setChartType }) {
  const metric = TIER_METRICS.find((m) => m.key === metricKey);
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    const value = metricKey === 'arrAddedThisYearCents' ? (a.arr_added_this_year_cents || 0) : (a.arr_cents || 0);
    byTier[key] = (byTier[key] || 0) + value;
  }
  const data = Object.entries(byTier).map(([name, total]) => ({ name, total })).filter((d) => d.total !== 0).sort(tierSort);
  // Sep 2026, Aaron: "add a '(percentage)' after the dollar amount to the
  // labels... on the ARR by Tier pie graph and bar graph" — share of
  // THIS metric's own total (Total ARR or ARR Added), not portfolio ARR
  // overall, so it always reads as "this tier is X% of what's on this
  // chart right now."
  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const pctOf = (v) => (grandTotal > 0 ? ` (${Math.round((v / grandTotal) * 100)}%)` : '');

  const chartHeight = chartType === 'pie' ? 420 : Math.max(320, data.length * 56);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5">
          {TIER_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No data yet for this metric — click Refresh to pull it.</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chartType === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${metric.format(p.total)}${pctOf(p.total)}`)} isAnimationActive={false}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
              </Pie>
              <Tooltip formatter={(v) => metric.format(v)} />
            </PieChart>
          ) : (
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 96, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={100} />
              <Tooltip formatter={(v) => metric.format(v)} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
                <LabelList dataKey="total" position="right" formatter={(v) => `${metric.format(v)}${pctOf(v)}`} style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </>
  );
}

/**
 * Extracts one metric's per-tier series out of the nested
 * kpi-metric-history-by-tier response ({tier: {metricKey: [{recorded_date,
 * value}]}}) into the flat {tier: [{recorded_date, value}]} shape
 * mergeSeries expects — same helper as AccountHealthDashboard.jsx's
 * identical function, duplicated per this file's own convention.
 */
function extractTierSeries(nested, metricKey) {
  return Object.fromEntries(Object.entries(nested || {}).map(([tier, byMetric]) => [tier, byMetric[metricKey] || []]));
}

/** Same tier ordering as tierSort, just over plain tier-name strings (e.g. Object.keys(...)) rather than {name} objects. */
function sortTierNames(names) {
  return [...names].sort((a, b) => {
    const ai = TIER_ORDER.indexOf(a);
    const bi = TIER_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

/**
 * "ARR by Tier" trend (Sep 2026, Aaron: "tracking and trending" on this
 * section too) — one line per Client Tier for whichever ARR metric is
 * currently selected above (tierMetricKey), same "a point is captured every
 * time you refresh" pattern as KpiByAmTrendSection/DealTypeTrendSection
 * elsewhere on this page, backed by the new per-tier kpi_metric_history rows
 * (see teamAm.js's /refresh handler). Team AM only gets this one trend of
 * the three Aaron asked for (Ticket Volume/Cost to Serve by Tier stay
 * Account Health-only, per his ask).
 */
function ArrByTierTrendSection({ metricKey }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/team-am/kpi-metric-history-by-tier')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || {}))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const tierSeries = extractTierSeries(history, metricKey);
  const tiersPresent = sortTierNames(Object.keys(tierSeries).filter((t) => tierSeries[t].length > 0));
  const merged = mergeSeries(tierSeries, tiersPresent);

  if (merged.length < 2) {
    return (
      <p className="text-sm text-neutral-500 italic">
        Not enough history yet — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
      </p>
    );
  }

  const metric = TIER_METRICS.find((m) => m.key === metricKey);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={metric.format} />
        <Tooltip formatter={(v) => metric.format(v)} />
        <Legend />
        {tiersPresent.map((t) => (
          <Line key={t} type="monotone" dataKey={t} name={t} stroke={TIER_COST_COLOR[t] || '#737373'} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Stacked-bar hover card for ArrByTierByAmChart — same amount the default Tooltip formatter already showed, plus each tier's share of that AM's own total (Aaron, Sep 2026: "add percentages... to the info hover card"), not portfolio ARR overall. */
function ArrByTierByAmTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}</p>
      {payload.map((entry) => {
        const value = entry.value || 0;
        const pct = row?.total > 0 ? Math.round((value / row.total) * 100) : 0;
        return (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {currencyStr(value)} ({pct}%)
          </p>
        );
      })}
    </div>
  );
}

/**
 * "How much of an AM's ARR falls into what tier" (Aaron, Sep 2026) — a
 * stacked-by-tier companion to KpiByAmChart's plain "Total ARR" bar above:
 * that chart answers "who's carrying the most ARR," this one answers "is
 * it concentrated in Tier 1 accounts or spread across lower tiers." Same
 * per-AM grouping key (`account_manager_name || 'Unassigned'`) as
 * teamAm.js's computeRollupByAccountManager, computed client-side from the
 * same `accounts` array every other tier/AM chart on this page already
 * uses — no new API call. Tier colors match TIER_COST_COLOR so "Tier 2"
 * means the same color everywhere on this dashboard.
 *
 * Pie mode (Aaron, Sep 2026: "a toggle to a collection of pie charts that
 * breaks down the amount and percentage of ARR per tier") renders one small
 * pie per AM rather than a single portfolio-wide pie — the stacked bar
 * already answers "who's biggest," these answer "what does THIS AM's own
 * mix look like," so each pie's percentages are of that AM's own total,
 * same convention as TierByArrChart's pctOf just scoped per-AM instead of
 * portfolio-wide.
 */
function ArrByTierByAmChart({ accounts, chartType, setChartType }) {
  const byAm = new Map();
  for (const a of accounts) {
    const amKey = a.account_manager_name || 'Unassigned';
    if (!byAm.has(amKey)) byAm.set(amKey, { name: amKey, total: 0 });
    const row = byAm.get(amKey);
    const tierKey = tierLabel(a.tier);
    row[tierKey] = (row[tierKey] || 0) + (a.arr_cents || 0);
    row.total += (a.arr_cents || 0);
  }
  const data = Array.from(byAm.values()).filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  const tierKeys = TIER_ORDER.filter((t) => data.some((d) => d[t] > 0));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ARR data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {chartType === 'pie' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.map((d) => {
            const pieData = tierKeys.filter((t) => d[t] > 0).map((t) => ({ name: t, value: d[t] }));
            return (
              <div key={d.name}>
                <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center truncate" title={d.name}>{d.name}</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius="68%"
                      label={wrappedPieLabel((p) => `${currencyStr(p.value)} (${Math.round((p.value / d.total) * 100)}%)`)}
                      isAnimationActive={false}
                    >
                      {pieData.map((p, i) => <Cell key={i} fill={TIER_COST_COLOR[p.name] || '#737373'} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${currencyStr(v)} (${Math.round((v / d.total) * 100)}%)`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(420, data.length * 56)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={currencyStr} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={140} />
            <Tooltip content={<ArrByTierByAmTooltip />} />
            <Legend />
            {tierKeys.map((t) => (
              <Bar key={t} dataKey={t} name={t} stackId="arr" fill={TIER_COST_COLOR[t] || '#737373'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

/** Stacked-bar hover card for CommunitiesByTierByAmChart — same shape as ArrByTierByAmTooltip just above, plain community counts instead of currency. */
function CommunitiesByTierByAmTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}</p>
      {payload.map((entry) => {
        const value = entry.value || 0;
        const pct = row?.total > 0 ? Math.round((value / row.total) * 100) : 0;
        return (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {value} ({pct}%)
          </p>
        );
      })}
    </div>
  );
}

/**
 * "How many communities an AM manages, segmented by tier" (Aaron, Sep
 * 2026: add a bar/pie combo to KPI by AM's Total Communities bar that also
 * segments the per-tier quantities by color) — same stacked-bar/
 * per-AM-pie shape as ArrByTierByAmChart above, just keyed on
 * active_community_count instead of arr_cents. KpiByAmChart's plain
 * "Total Communities" bar already answers "who's carrying the most
 * communities"; this answers "is it concentrated in Tier 1 accounts or
 * spread across lower tiers," same division of labor as ArrByTierByAmChart
 * has with the ARR metric.
 */
function CommunitiesByTierByAmChart({ accounts, chartType, setChartType }) {
  const byAm = new Map();
  for (const a of accounts) {
    const amKey = a.account_manager_name || 'Unassigned';
    if (!byAm.has(amKey)) byAm.set(amKey, { name: amKey, total: 0 });
    const row = byAm.get(amKey);
    const tierKey = tierLabel(a.tier);
    row[tierKey] = (row[tierKey] || 0) + (a.active_community_count || 0);
    row.total += (a.active_community_count || 0);
  }
  const data = Array.from(byAm.values()).filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  const tierKeys = TIER_ORDER.filter((t) => data.some((d) => d[t] > 0));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No community data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {chartType === 'pie' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.map((d) => {
            const pieData = tierKeys.filter((t) => d[t] > 0).map((t) => ({ name: t, value: d[t] }));
            return (
              <div key={d.name}>
                <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center truncate" title={d.name}>{d.name}</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius="68%"
                      label={wrappedPieLabel((p) => `${p.value} (${Math.round((p.value / d.total) * 100)}%)`)}
                      isAnimationActive={false}
                    >
                      {pieData.map((p, i) => <Cell key={i} fill={TIER_COST_COLOR[p.name] || '#737373'} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${v} (${Math.round((v / d.total) * 100)}%)`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(420, data.length * 56)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={140} />
            <Tooltip content={<CommunitiesByTierByAmTooltip />} />
            <Legend />
            {tierKeys.map((t) => (
              <Bar key={t} dataKey={t} name={t} stackId="communities" fill={TIER_COST_COLOR[t] || '#737373'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

/**
 * "How many companies each AM manages, segmented by tier" (Aaron, Sep
 * 2026) — same stacked-bar/per-AM-pie shape as CommunitiesByTierByAmChart
 * just above, keyed on a straight account headcount instead of
 * active_community_count. CompaniesByTierChart (right below) already
 * answers "how many companies are in each tier, portfolio-wide"; this
 * answers "whose book is it concentrated in." Reuses
 * CommunitiesByTierByAmTooltip — its {name, value, pct-of-row-total} logic
 * is generic to any stacked-by-tier metric, not community-specific.
 */
function CompaniesByTierByAmChart({ accounts, chartType, setChartType }) {
  const byAm = new Map();
  for (const a of accounts) {
    const amKey = a.account_manager_name || 'Unassigned';
    if (!byAm.has(amKey)) byAm.set(amKey, { name: amKey, total: 0 });
    const row = byAm.get(amKey);
    const tierKey = tierLabel(a.tier);
    row[tierKey] = (row[tierKey] || 0) + 1;
    row.total += 1;
  }
  const data = Array.from(byAm.values()).filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
  const tierKeys = TIER_ORDER.filter((t) => data.some((d) => d[t] > 0));

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No account data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {chartType === 'pie' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.map((d) => {
            const pieData = tierKeys.filter((t) => d[t] > 0).map((t) => ({ name: t, value: d[t] }));
            return (
              <div key={d.name}>
                <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center truncate" title={d.name}>{d.name}</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius="68%"
                      label={wrappedPieLabel((p) => `${p.value} (${Math.round((p.value / d.total) * 100)}%)`)}
                      isAnimationActive={false}
                    >
                      {pieData.map((p, i) => <Cell key={i} fill={TIER_COST_COLOR[p.name] || '#737373'} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${v} (${Math.round((v / d.total) * 100)}%)`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(420, data.length * 56)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={140} />
            <Tooltip content={<CommunitiesByTierByAmTooltip />} />
            <Legend />
            {tierKeys.map((t) => (
              <Bar key={t} dataKey={t} name={t} stackId="companies" fill={TIER_COST_COLOR[t] || '#737373'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

/** "Number of companies per tier" (Aaron, Sep 2026) — a straight headcount, portfolio-wide, same bar/pie-toggle shape as the other tier charts. Colored per-tier via TIER_COST_COLOR in both bar and pie modes (Sep 2026, Aaron: "verify that all tier related reports are consistent with 1 = green, 2 = blue, 3 = orange, 4 = red") — was a flat purple bar / rainbow-indexed pie. */
function CompaniesByTierChart({ accounts, chartType, setChartType }) {
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier).map(([name, total]) => ({ name, total })).sort(tierSort);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No account data yet — click Refresh to pull it.</p>;
  }

  const totalCompanies = data.reduce((s, d) => s + d.total, 0);
  const chartHeight = chartType === 'pie' ? 420 : 320;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-neutral-600">Total: <span className="font-semibold text-neutral-800">{totalCompanies.toLocaleString()}</span> compan{totalCompanies === 1 ? 'y' : 'ies'}</p>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => p.total)} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
            </Pie>
            <Tooltip formatter={(v) => `${v} compan${v === 1 ? 'y' : 'ies'}`} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${v} compan${v === 1 ? 'y' : 'ies'}`} />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
              <LabelList dataKey="total" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

/**
 * "How many communities fall into each tier" (Aaron, Sep 2026) — same
 * bar/pie-toggle shape as CompaniesByTierChart just above, summing
 * active_community_count per tier instead of a straight account
 * headcount — answers "which tiers hold the most communities," not just
 * "which tiers have the most accounts" (a Tier 4 account with 40
 * communities weighs very differently than a Tier 1 account with 2).
 */
function CommunitiesByTierChart({ accounts, chartType, setChartType }) {
  const byTier = {};
  for (const a of accounts) {
    const key = tierLabel(a.tier);
    byTier[key] = (byTier[key] || 0) + (a.active_community_count || 0);
  }
  const data = Object.entries(byTier).map(([name, total]) => ({ name, total })).filter((d) => d.total > 0).sort(tierSort);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No community data yet — click Refresh to pull it.</p>;
  }

  const totalCommunities = data.reduce((s, d) => s + d.total, 0);
  const chartHeight = chartType === 'pie' ? 420 : 320;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-neutral-600">Total: <span className="font-semibold text-neutral-800">{totalCommunities.toLocaleString()}</span> communit{totalCommunities === 1 ? 'y' : 'ies'}</p>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => p.total)} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
            </Pie>
            <Tooltip formatter={(v) => `${v} communit${v === 1 ? 'y' : 'ies'}`} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => `${v} communit${v === 1 ? 'y' : 'ies'}`} />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
              <LabelList dataKey="total" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

/** Click-to-open info popover — same component as AccountHealthDashboard.jsx's identical InfoIcon, kept in sync manually per this file's own convention. Safe to use here (unlike StatCard's jumpTo variant elsewhere in this app) since CategoryMixChart never renders inside a clickable <button> wrapper. */
function InfoIcon({ tooltip }) {
  const [open, setOpen] = useState(false);
  if (!tooltip) return null;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-neutral-200 text-neutral-500 text-[9px] font-bold normal-case tracking-normal cursor-pointer"
        aria-label="More info"
        aria-expanded={open}
      >
        i
      </button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 top-full left-0 mt-1 w-64 block rounded-lg border border-neutral-200 bg-white p-3 shadow-lg text-[15px] leading-snug text-neutral-700 normal-case font-normal tracking-normal"
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

// Category 2.0 values that mean "enhancement/feature ask" even though
// they're not literally "Enhancement" — same as AccountHealthDashboard.jsx's
// identical constant (Sep 2026, Aaron: category_2_0 has grown a
// "FEATURE_REQUEST" option distinct from "Enhancement," plus malformed
// compound values like "Issue;Feature_Request"/"Integration;Feature_Request").
// Substring match so any other "…Feature_Request" compound is caught too.
const isEnhancementIshCategory = (name) => /enhancement|feature_request/i.test(name);

/**
 * Category 2.0 mix, portfolio-wide (team-wide) — same component as
 * AccountHealthDashboard.jsx's identical CategoryMixChart (Sep 2026,
 * Aaron: "add a Tickets Open/Closed by Category 2.0 section to the Team
 * AM board"), just fed this file's own `accounts` (every Home Office,
 * not just Aaron's owned ones). `status` picks 'open' or 'closed' —
 * ticketCategoryMix already carries both per account
 * (server/api/teamAm.js's mapLiveServiceHealth), no server-side change
 * needed here.
 */
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

  const chartHeight = chartType === 'pie' ? 640 : Math.max(480, data.length * 56);
  const totalTickets = data.reduce((s, d) => s + d.total, 0);
  const enhancementIshTotal = data.filter((d) => isEnhancementIshCategory(d.name)).reduce((s, d) => s + d.total, 0);
  // Same pctOf(v) shape as AccountHealthDashboard.jsx's identical block —
  // % of THIS chart's own Total (open or closed), not portfolio-wide.
  const pctOf = (v) => (totalTickets > 0 ? ` (${Math.round((v / totalTickets) * 100)}%)` : '');

  // Breaks "Total" out by pipeline STAGE — same as
  // AccountHealthDashboard.jsx's identical block (see there for the full
  // reasoning): category is WHAT the ticket is about, stage is WHERE it
  // sits in the workflow. Sourced from ticketDates (server/api/teamAm.js's
  // mapLiveServiceHealth), filtered to this chart's own open/closed status
  // by closedAt presence so it always foots to the Total shown above it.
  const stageCounts = {};
  for (const a of accounts) {
    for (const t of a.serviceHealth?.ticketDates || []) {
      const isOpenTicket = !t.closedAt;
      if ((status === 'open') !== isOpenTicket) continue;
      const stage = t.pipelineStageLabel || 'Unknown';
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
  }
  const stageBreakdownText = Object.entries(stageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => `${stage}: ${count}${pctOf(count)}`)
    .join(' · ');

  return (
    <>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-neutral-500 flex items-center gap-1">
            Total: {totalTickets}<InfoIcon tooltip={stageBreakdownText || 'No stage data yet.'} />
          </span>
          <span className="text-xs font-medium text-neutral-500">Enhancement Requests: {enhancementIshTotal}{pctOf(enhancementIshTotal)}</span>
          {chartType === 'pie' && (
            <button
              onClick={() => setShowLegend((v) => !v)}
              className="text-xs px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300 transition-colors"
            >
              {showLegend ? 'Hide Key' : 'Show Key'}
            </button>
          )}
        </div>
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
              label={wrappedPieLabel((p) => `${p.total}${pctOf(p.total)}`)}
              isAnimationActive={false}
            >
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => `${v}${pctOf(v)}`} />
            {showLegend && <Legend />}
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={200} />
            <Tooltip formatter={(v) => `${v}${pctOf(v)}`} />
            <Bar dataKey="total" fill={status === 'open' ? '#dc2626' : '#2563eb'} radius={[0, 4, 4, 0]}>
              <LabelList dataKey="total" position="right" formatter={(v) => `${v}${pctOf(v)}`} style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

// Same "focused queue" hubspotTickets.js's own FOCUSED_OPEN_STATUS_LABELS
// already defines — duplicated here rather than imported, same per-file
// convention as everywhere else in this app (see
// AccountHealthDashboard.jsx's identical constant for the full reasoning:
// matches Aaron's own HubSpot ticket report definition exactly).
const isFocusedQueue = (t) => t.pipelineStageLabel === 'Client Submitted' || t.pipelineStageLabel === 'In Progress';

const HEATMAP_WEEKS = 53;

/** count -> one of 5 shade levels — same as AccountHealthDashboard.jsx's identical helper, duplicated per this file's own convention. */
function heatLevel(count, max) {
  if (!count) return 0;
  if (max <= 1) return count > 0 ? 4 : 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/**
 * Trailing-12-months, GitHub-style contribution heatmap — same cell/week
 * math as AccountHealthDashboard.jsx's identical component, `dateField`/
 * `colorScale` as props so one instance covers "Opened" and another covers
 * "Closed" with visually distinct colors.
 */
function CalendarHeatmap({ items, dateField, colorScale, emptyLabel }) {
  const { cells, monthLabels } = useMemo(() => {
    const countByDate = {};
    for (const item of items) {
      const value = item[dateField];
      if (!value) continue;
      const day = value.slice(0, 10);
      countByDate[day] = (countByDate[day] || 0) + 1;
    }
    const max = Math.max(0, ...Object.values(countByDate));

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (HEATMAP_WEEKS * 7 - 1));

    const days = [];
    const monthLabels = [];
    let lastMonth = null;
    for (let i = 0, d = new Date(start); d <= end; i++, d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const count = countByDate[iso] || 0;
      const inFuture = d > today;
      days.push({ iso, count: inFuture ? null : count, level: inFuture ? null : heatLevel(count, max) });
      const week = Math.floor(i / 7);
      const month = d.getUTCMonth();
      if (d.getUTCDay() === 0 && month !== lastMonth) {
        monthLabels.push({ week, label: d.toLocaleDateString('en-US', { month: 'short' }) });
        lastMonth = month;
      }
    }
    return { cells: days, monthLabels };
  }, [items, dateField]);

  const hasAny = items.some((item) => item[dateField]);
  if (!hasAny) {
    return <p className="text-sm text-neutral-500 italic">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto" style={{ width: HEATMAP_WEEKS * 13 }}>
        <div style={{ position: 'relative', height: 14, marginBottom: 4 }}>
          {monthLabels.map(({ week, label }) => (
            <span key={`${week}-${label}`} className="text-xs text-neutral-400" style={{ position: 'absolute', left: week * 13 }}>{label}</span>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateRows: 'repeat(7, 11px)',
            gridAutoFlow: 'column',
            gridAutoColumns: '11px',
            gap: 2,
          }}
        >
          {cells.map((c) => (
            <div
              key={c.iso}
              title={c.count == null ? '' : `${c.iso}: ${c.count} ticket${c.count === 1 ? '' : 's'}`}
              style={{
                width: 11, height: 11, borderRadius: 2,
                background: c.level == null ? 'transparent' : colorScale[c.level],
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 mt-2 text-xs text-neutral-400">
        <span>Fewer</span>
        {colorScale.map((color, i) => (
          <span key={`${color}-${i}`} style={{ width: 11, height: 11, borderRadius: 2, background: color, display: 'inline-block' }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

const OPENED_COLOR_SCALE = ['#ebedf0', '#c6dcf5', '#8bbcec', '#4f92dd', '#2563eb'];
// Ends in the app's existing `success` token (#10b981, tailwind.config.js) —
// closed tickets read as a resolution/success signal, visually distinct
// from the blue "opened" scale above.
const CLOSED_COLOR_SCALE = ['#ebedf0', '#c3ead9', '#87d6b3', '#4abf8c', '#10b981'];

// Same fixed 5-key row shape as AccountHealthDashboard.jsx's identical
// constants — tier1-4 + unassigned, so computeOpenBacklogSeriesByTier can
// build one wide row per month with every series pre-summed.
const TIER_SERIES_KEYS = ['tier1', 'tier2', 'tier3', 'tier4', 'unassigned'];
const TIER_SERIES_LABELS = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3', tier4: 'Tier 4', unassigned: 'Unassigned' };

function tierSeriesKey(tier) {
  return (tier != null && tier >= 1 && tier <= 4) ? `tier${tier}` : 'unassigned';
}

/** Trailing-12-months OPEN BACKLOG trend, one point per month-end — same definition as AccountHealthDashboard.jsx's identical function (see there for the full reasoning). */
function computeOpenBacklogSeriesByTier(items) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  return months.map((monthStart, idx) => {
    const isCurrentMonth = idx === months.length - 1;
    const cutoff = isCurrentMonth ? now : new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const row = { label, total: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unassigned: 0 };
    for (const t of items) {
      if (!t.createdAt) continue;
      if (new Date(t.createdAt) > cutoff) continue;
      if (t.closedAt && new Date(t.closedAt) <= cutoff) continue;
      row.total += 1;
      row[tierSeriesKey(t.tier)] += 1;
    }
    return row;
  });
}

/**
 * Same trailing-12-months open-backlog shape as computeOpenBacklogSeriesByTier
 * just above, keyed by Account Manager name instead of a fixed tier1-4 set
 * (Aaron, Sep 2026: "add a Break Out by AM toggle") — AM names aren't a
 * fixed small set like tiers, so each row's per-AM keys are whatever names
 * are actually present in `items`, discovered by the caller (see
 * `amKeysPresent` in OpenTicketVolumeChart) rather than a hardcoded list.
 */
function computeOpenBacklogSeriesByAM(items) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  return months.map((monthStart, idx) => {
    const isCurrentMonth = idx === months.length - 1;
    const cutoff = isCurrentMonth ? now : new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const row = { label, total: 0 };
    for (const t of items) {
      if (!t.createdAt) continue;
      if (new Date(t.createdAt) > cutoff) continue;
      if (t.closedAt && new Date(t.closedAt) <= cutoff) continue;
      row.total += 1;
      const am = t.accountManagerName || 'Unassigned';
      row[am] = (row[am] || 0) + 1;
    }
    return row;
  });
}

/** Trailing-12-months CLOSED ticket volume, one point per month — same definition as AccountHealthDashboard.jsx's identical function. */
function computeClosedTicketVolumeByMonth(items) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  return months.map((monthStart) => {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    let count = 0;
    for (const t of items) {
      if (!t.closedAt) continue;
      const closed = new Date(t.closedAt);
      if (closed >= monthStart && closed <= monthEnd) count += 1;
    }
    return count;
  });
}

/** Reads the same wide per-tier row regardless of which lines are actually plotted — same as AccountHealthDashboard.jsx's identical tooltip. */
function OpenTicketVolumeTooltip({ active, payload, label, showClosed }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const breakdown = TIER_SERIES_KEYS.filter((k) => d[k] > 0);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}: {d.total} open</p>
      {showClosed && <p className="text-neutral-600 mb-1">{d.closed} closed that month</p>}
      {breakdown.length > 0 ? (
        breakdown.map((k) => (
          <p key={k} className="text-neutral-600">{TIER_SERIES_LABELS[k]}: {d[k]}</p>
        ))
      ) : (
        <p className="text-neutral-400 italic">No tier data</p>
      )}
    </div>
  );
}

/** Same shape as OpenTicketVolumeTooltip, breaking down by whatever AM keys are actually on this row (see computeOpenBacklogSeriesByAM) instead of a fixed tier set. */
function OpenTicketVolumeByAmTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const breakdown = Object.entries(d)
    .filter(([k, v]) => k !== 'label' && k !== 'total' && v > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}: {d.total} open</p>
      {breakdown.length > 0 ? (
        breakdown.map(([k, v]) => (
          <p key={k} className="text-neutral-600">{k}: {v}</p>
        ))
      ) : (
        <p className="text-neutral-400 italic">No AM data</p>
      )}
    </div>
  );
}

/**
 * Same shape as AccountHealthDashboard.jsx's identical component — see
 * there for the full reasoning behind the single-line default, the
 * Show Closed/Break Out by Tier toggle behavior, and the focused-queue
 * (Client Submitted + In Progress) scoping. `breakout` (Sep 2026, Aaron:
 * "add a Break Out by AM toggle") replaces the old plain `byTier` boolean
 * with a 3-way 'none'|'tier'|'am' mode — Team AM-only, since Account
 * Health's accounts are all one AM's own book, where an AM breakout would
 * be a constant.
 */
function OpenTicketVolumeChart({ items }) {
  const [breakout, setBreakout] = useState('none'); // 'none' | 'tier' | 'am'
  const [showClosed, setShowClosed] = useState(false);
  const closedVisible = showClosed && breakout === 'none';
  const focusedItems = useMemo(() => items.filter(isFocusedQueue), [items]);
  const data = useMemo(() => computeOpenBacklogSeriesByTier(focusedItems), [focusedItems]);
  const amData = useMemo(() => computeOpenBacklogSeriesByAM(focusedItems), [focusedItems]);
  const closedByMonth = useMemo(() => computeClosedTicketVolumeByMonth(items), [items]);
  const combinedData = useMemo(
    () => data.map((row, i) => ({ ...row, closed: closedByMonth[i] ?? 0 })),
    [data, closedByMonth]
  );
  const tierKeysPresent = useMemo(() => TIER_SERIES_KEYS.filter((k) => data.some((d) => d[k] > 0)), [data]);
  const tierLineColors = {
    tier1: TIER_COST_COLOR['Tier 1'], tier2: TIER_COST_COLOR['Tier 2'], tier3: TIER_COST_COLOR['Tier 3'],
    tier4: TIER_COST_COLOR['Tier 4'], unassigned: TIER_COST_COLOR.Unassigned,
  };
  // Sorted by total volume desc (busiest AM first in the legend), same
  // "discover the real keys from the data" approach as tierKeysPresent —
  // AM names aren't a fixed small set, so there's no equivalent constant.
  const amKeysPresent = useMemo(() => {
    const totals = {};
    for (const row of amData) {
      for (const [k, v] of Object.entries(row)) {
        if (k === 'label' || k === 'total') continue;
        totals[k] = (totals[k] || 0) + v;
      }
    }
    return Object.keys(totals).filter((k) => totals[k] > 0).sort((a, b) => totals[b] - totals[a]);
  }, [amData]);
  const amLineColors = useMemo(() => {
    const colors = {};
    let fallbackIdx = 0;
    for (const k of amKeysPresent) {
      colors[k] = AM_LINE_COLOR_OVERRIDES[k] || AM_LINE_COLOR_FALLBACK[fallbackIdx++ % AM_LINE_COLOR_FALLBACK.length];
    }
    return colors;
  }, [amKeysPresent]);

  if (!items.some((t) => t.createdAt)) {
    return <p className="text-sm text-neutral-500 italic">No dated tickets to chart yet — click Refresh to pull them.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-2 gap-2 flex-wrap">
        {breakout === 'none' && (
          <button
            onClick={() => setShowClosed((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              showClosed ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            {showClosed ? '← Hide Closed' : 'Show Closed'}
          </button>
        )}
        <button
          onClick={() => setBreakout((v) => (v === 'tier' ? 'none' : 'tier'))}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            breakout === 'tier' ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {breakout === 'tier' ? '← Show Total' : 'Break Out by Tier'}
        </button>
        <button
          onClick={() => setBreakout((v) => (v === 'am' ? 'none' : 'am'))}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            breakout === 'am' ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {breakout === 'am' ? '← Show Total' : 'Break Out by AM'}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={breakout === 'am' ? amData : combinedData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip content={breakout === 'am' ? <OpenTicketVolumeByAmTooltip /> : <OpenTicketVolumeTooltip showClosed={closedVisible} />} />
          {breakout === 'tier' ? (
            <>
              <Legend />
              {tierKeysPresent.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={TIER_SERIES_LABELS[k]}
                  stroke={tierLineColors[k]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </>
          ) : breakout === 'am' ? (
            <>
              <Legend />
              {amKeysPresent.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={(row) => row[k]}
                  name={k}
                  stroke={amLineColors[k]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </>
          ) : (
            <>
              {closedVisible && <Legend />}
              <Line type="monotone" dataKey="total" name="Open Tickets" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
                <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
              </Line>
              {closedVisible && (
                <Line type="monotone" dataKey="closed" name="Closed Tickets (that month)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
                  <LabelList dataKey="closed" position="bottom" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
                </Line>
              )}
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

/**
 * Portfolio-wide (team-wide) ticket activity — opened vs. closed, day-by-
 * day, trailing 12 months. Sourced from `serviceHealth.ticketDates` (see
 * server/api/teamAm.js's mapLiveServiceHealth), mirroring
 * AccountHealthDashboard.jsx's identical section (Sep 2026, Aaron: "add a
 * ticket activity table to the Team AM dashboard").
 */
function TicketActivitySection({ accounts }) {
  const items = useMemo(
    () => accounts.flatMap((a) => (a.serviceHealth?.ticketDates || []).map((t) => ({ ...t, tier: a.tier, accountManagerName: a.account_manager_name || 'Unassigned' }))),
    [accounts]
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-neutral-700 mb-2">Open Ticket Volume <span className="font-normal text-neutral-400">(Client Submitted + In Progress)</span></h3>
        <OpenTicketVolumeChart items={items} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-neutral-700 mb-2">Opened</h3>
        <CalendarHeatmap items={items} dateField="createdAt" colorScale={OPENED_COLOR_SCALE} emptyLabel="No dated tickets to map yet — click Refresh to pull them." />
      </div>
      <div>
        <h3 className="text-sm font-medium text-neutral-700 mb-2">Closed</h3>
        <CalendarHeatmap items={items} dateField="closedAt" colorScale={CLOSED_COLOR_SCALE} emptyLabel="No closed tickets to map yet." />
      </div>
    </div>
  );
}

/** Stacked-bar hover card for TicketsByAmByTierChart — same shape as CommunitiesByTierByAmTooltip, plain ticket counts instead of community counts. */
function TicketsByAmByTierTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}</p>
      {payload.map((entry) => {
        const value = entry.value || 0;
        const pct = row?.total > 0 ? Math.round((value / row.total) * 100) : 0;
        return (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {value} ({pct}%)
          </p>
        );
      })}
    </div>
  );
}

/**
 * "Ticket volume by AM by tier" (Aaron, Sep 2026) — a stacked bar per
 * Account Manager, segmented by client_tier, so a spike in one AM's
 * ticket volume can be read as "driven by their Tier 1s" vs. spread
 * evenly. Open + closed combined into one "ticket volume" figure per
 * segment — TicketsByTierChart above already covers the open-vs-closed
 * split at the portfolio level. Each tier segment is colored via
 * TIER_COST_COLOR (Sep 2026, Aaron: "verify that all tier related reports
 * are consistent with 1 = green, 2 = blue, 3 = orange, 4 = red") — was
 * rainbow-indexed by PIE_COLORS, same fix as ArrByTierByAmChart above
 * already had.
 *
 * Bar/pie toggle added (Sep 2026, Aaron: working toward a "balance vs.
 * imbalance" read on workload across the team) — pie mode is a small-
 * multiples grid, one per-AM tier-mix pie, same shape as
 * CommunitiesByTierByAmChart's own pie mode just above. Capacity/ARR
 * deliberately left out of this chart for now (ALIS occupancy pull isn't
 * reliable across the whole team yet) — this only answers "is an AM's
 * ticket load concentrated in their Tier 1s or spread across lower
 * tiers," not "relative to how much they're managing."
 */
function TicketsByAmByTierChart({ accounts, chartType, setChartType }) {
  const byAm = new Map();
  const tiersSeen = new Set();
  for (const a of accounts) {
    const am = a.account_manager_name || 'Unassigned';
    const tier = tierLabel(a.tier);
    tiersSeen.add(tier);
    if (!byAm.has(am)) byAm.set(am, { name: am, total: 0 });
    const row = byAm.get(am);
    const count = (a.open_ticket_count || 0) + (a.closed_ticket_count || 0);
    row[tier] = (row[tier] || 0) + count;
    row.total += count;
  }
  const tierKeys = [...tiersSeen].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
  const data = Array.from(byAm.values())
    .filter((r) => tierKeys.some((t) => r[t] > 0))
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {chartType === 'pie' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.map((d) => {
            const pieData = tierKeys.filter((t) => d[t] > 0).map((t) => ({ name: t, value: d[t] }));
            return (
              <div key={d.name}>
                <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center truncate" title={d.name}>{d.name}</h4>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius="68%"
                      label={wrappedPieLabel((p) => `${p.value} (${Math.round((p.value / d.total) * 100)}%)`)}
                      isAnimationActive={false}
                    >
                      {pieData.map((p, i) => <Cell key={i} fill={TIER_COST_COLOR[p.name] || '#737373'} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${v} (${Math.round((v / d.total) * 100)}%)`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(420, data.length * 48)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13 }} width={140} />
            <Tooltip content={<TicketsByAmByTierTooltip />} />
            <Legend />
            {tierKeys.map((t) => (
              <Bar key={t} dataKey={t} name={t} stackId="tickets" fill={TIER_COST_COLOR[t] || '#737373'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

// Implementation/onboarding-project tracking (Sep 2026, Aaron) — same
// fields/reasoning as AccountHealthDashboard.jsx's identical block (kept
// in sync manually, not shared — this file's established per-page
// duplication convention). HubSpot's "Implementation" card on a company
// record is backed by custom DEAL properties, not company properties;
// Merged reads as "superseded elsewhere" (several sibling deals from the
// same community-add batch flipped to it together once one absorbed the
// real tracking, confirmed live against Viva Senior Living), so it counts
// as terminal alongside Completed/Cancelled.
const TERMINAL_PROJECT_STATUSES = new Set(['Completed', 'Cancelled', 'Merged']);
function isOpenProject(p) {
  return !TERMINAL_PROJECT_STATUSES.has(p.projectStatus);
}

const RAG_COLOR = { red: '#dc2626', amber: '#ea580c', green: '#16a34a' };
function RagBadge({ rag }) {
  if (!rag) return <span className="text-neutral-400">—</span>;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: RAG_COLOR[rag] || '#737373' }}
    >
      {rag.charAt(0).toUpperCase() + rag.slice(1)}
    </span>
  );
}

function daysSince(iso) {
  return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

const RAG_SORT_WEIGHT = { red: 0, amber: 1, green: 2 };

/**
 * Trailing-12-months volume of implementation-tracked deals, by creation
 * month — NOT a true "open backlog over time" reconstruction. See
 * AccountHealthDashboard.jsx's identical function for the full reasoning:
 * HubSpot only exposes project_status's CURRENT value, not a history of
 * when a project actually changed status, so creation-date volume is the
 * closest honest trend available without a new periodic-snapshot table.
 * Same dynamic per-tier-label-key row shape as TicketsByAmByTierChart
 * above, rather than AccountHealthDashboard's fixed tier1..4/unassigned
 * keys — matches this file's own established tierLabel()/TIER_ORDER
 * convention instead of porting the other dashboard's.
 *
 * `cumulative` (Sep 2026, Aaron: "31 open projects in the kpi above and
 * trailing to 0 the last two months on the line graph") — a flat
 * per-month bucket reads as "nothing's happening" in a recent month with
 * no NEW open projects, even while the total open count (the stat tile
 * above) stays high because most of it started earlier. For "Total Open
 * Projects" this instead returns a RUNNING total per key — seeded with
 * every currently-open project (per tier) created before the visible
 * window, then adding each month's new-open count — so the final month
 * always lands on the same number as the stat tile above, tier subtotals
 * included. "Projects Started" stays a plain per-month count.
 */
function computeProjectVolumeSeriesByTier(items, cumulative = false) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  const running = { total: 0 };
  if (cumulative) {
    for (const p of items) {
      if (!p.createdAt || new Date(p.createdAt) >= months[0]) continue;
      running.total += 1;
      const tier = tierLabel(p.tier);
      running[tier] = (running[tier] || 0) + 1;
    }
  }

  return months.map((monthStart) => {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const counts = { total: 0 };
    for (const p of items) {
      if (!p.createdAt) continue;
      const d = new Date(p.createdAt);
      if (d < monthStart || d > monthEnd) continue;
      counts.total += 1;
      const tier = tierLabel(p.tier);
      counts[tier] = (counts[tier] || 0) + 1;
    }
    if (!cumulative) return { label, ...counts };
    for (const [k, v] of Object.entries(counts)) running[k] = (running[k] || 0) + v;
    return { label, ...running };
  });
}

function ProjectVolumeTooltip({ active, payload, label, tierKeys, verb, showClosed }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const breakdown = tierKeys.filter((k) => d[k] > 0);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}: {d.total} {verb}</p>
      {showClosed && <p className="text-neutral-600">{d.closed} closed this month</p>}
      {showClosed && <p className="text-neutral-600">{d.closedTotal} closed to date</p>}
      {breakdown.length > 0
        ? breakdown.map((k) => <p key={k} className="text-neutral-600">{k}: {d[k]}</p>)
        : <p className="text-neutral-400 italic">No tier data</p>}
    </div>
  );
}

// Two metrics over the same trailing-12-months creation-date bucketing
// (Sep 2026, Aaron: "add in a couple of reports... total open projects and
// total open projects broken out by tier"). "Total Open Projects" isn't a
// true point-in-time backlog reconstruction — see
// computeProjectVolumeSeriesByTier's own doc comment for why HubSpot can't
// support that — it's the same by-creation-month bucketing as "Projects
// Started", just pre-filtered to CURRENTLY-open projects, so it reads as
// "of what's still open today, here's when it started" — the age
// distribution of the live backlog, which is exactly what makes it (per
// Aaron) "the clearest indication of projects in flight" and why it's the
// default view.
const PROJECT_VOLUME_METRICS = [
  { key: 'open', label: 'Total Open Projects', verb: 'open' },
  { key: 'started', label: 'Projects Started', verb: 'started' },
];

function OnboardingVolumeChart({ allProjects, openProjects }) {
  const [metric, setMetric] = useState('open');
  const [byTier, setByTier] = useState(false);
  const activeMetric = PROJECT_VOLUME_METRICS.find((m) => m.key === metric);
  const items = metric === 'open' ? openProjects : allProjects;
  const data = useMemo(() => computeProjectVolumeSeriesByTier(items, metric === 'open'), [items, metric]);
  const tierKeys = useMemo(
    () => TIER_ORDER.filter((t) => data.some((d) => d[t] > 0)),
    [data]
  );

  // "Closed Projects" overlay (Sep 2026, Aaron: "layer on closed projects
  // by month to the open projects view" — then "capture the total
  // projects closed in the hover detail window, but on the chart only
  // plot projects closed that month") — only alongside the flat "Total
  // Open Projects" total line (not the by-tier breakout, which would get
  // crowded fast with 5 open + 5 closed lines at once). PLOTTED value is
  // a per-month bucket, same non-cumulative shape as "Projects Started" —
  // same creation-month-bucketing caveat as everywhere else in this
  // feature (see computeProjectVolumeSeriesByTier's own doc comment:
  // HubSpot doesn't expose a real close-transition date, so "closed that
  // month" means "created that month, currently closed," not a literal
  // close date). The tooltip separately surfaces the cumulative running
  // total (ending at today's true closed count).
  const closedProjects = useMemo(() => allProjects.filter((p) => !isOpenProject(p)), [allProjects]);
  const showClosedOverlay = !byTier;
  const combinedData = useMemo(() => {
    if (!showClosedOverlay) return data;
    const closedMonthly = computeProjectVolumeSeriesByTier(closedProjects, false);
    const closedCumulative = computeProjectVolumeSeriesByTier(closedProjects, true);
    return data.map((row, i) => ({
      ...row,
      closed: closedMonthly[i]?.total ?? 0,
      closedTotal: closedCumulative[i]?.total ?? 0,
    }));
  }, [data, closedProjects, showClosedOverlay]);

  if (allProjects.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No implementation-tracked deals yet.</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-medium text-neutral-700">
          {activeMetric.label} <span className="font-normal text-neutral-400">(trailing 12 months)</span>
        </h3>
        <div className="flex items-center gap-2">
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5">
            {PROJECT_VOLUME_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button
            onClick={() => setByTier((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              byTier ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            {byTier ? '← Show Total' : 'Break Out by Tier'}
          </button>
        </div>
      </div>
      {items.length === 0 && !(showClosedOverlay && closedProjects.length > 0) ? (
        <p className="text-sm text-neutral-500 italic">No {activeMetric.verb} projects to chart.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={combinedData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip content={<ProjectVolumeTooltip tierKeys={tierKeys} verb={activeMetric.verb} showClosed={showClosedOverlay} />} />
            {byTier ? (
              <>
                <Legend />
                {tierKeys.map((t) => (
                  <Line key={t} type="monotone" dataKey={t} name={t} stroke={TIER_COST_COLOR[t] || '#737373'} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                ))}
              </>
            ) : (
              <>
                {showClosedOverlay && <Legend />}
                <Line type="monotone" dataKey="total" name={activeMetric.label} stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
                  <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
                </Line>
                {showClosedOverlay && (
                  <Line type="monotone" dataKey="closed" name="Closed Projects (that month)" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
                    <LabelList dataKey="closed" position="bottom" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
                  </Line>
                )}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

/**
 * "Onboarding" section (Sep 2026, Aaron) — every implementation-tracked
 * deal portal-wide, across every Account Manager (this page is already
 * portfolio-wide, unlike Account Health Dashboard's owner-scoped
 * equivalent — see that file's identical component for the "my accounts"
 * framing). Open projects sorted worst-first (Red RAG, then Amber, then
 * Green/unset, then soonest Projected Go-Live), terminal ones pushed
 * below. One Home Office can have several of these at once (one per
 * community/batch added), so this lists every project individually.
 */
function ImplementationProjectsSection({ accounts }) {
  const [sort, setSort] = useState(null);
  // Default ON (Sep 2026, Aaron: "it would really clean up the table") —
  // completed/cancelled/merged projects are greyed-out noise most of the
  // time, but still worth pulling up for reference/proof of completion,
  // so this hides rather than drops them entirely.
  const [hideClosed, setHideClosed] = useState(true);

  const projects = useMemo(
    () => accounts.flatMap((a) => (a.financialHealth?.implementationProjects || []).map((p) => ({
      ...p, tier: a.tier, companyName: a.company_name, accountManagerName: a.account_manager_name, companyHubspotUrl: a.hubspotUrl,
    }))),
    [accounts]
  );
  const openProjects = useMemo(() => projects.filter(isOpenProject), [projects]);
  const avgDaysOpen = openProjects.length > 0
    ? Math.round(openProjects.reduce((s, p) => s + (daysSince(p.createdAt) || 0), 0) / openProjects.length)
    : null;

  const tierCounts = TIER_ORDER
    .map((t) => ({ label: t, count: openProjects.filter((p) => tierLabel(p.tier) === t).length }))
    .filter((t) => t.count > 0);

  function toggleSort(column) {
    setSort((prev) => (prev?.column === column ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' }));
  }

  const sorted = useMemo(() => {
    if (sort) {
      const dir = sort.direction === 'asc' ? 1 : -1;
      return [...projects].sort((a, b) => {
        const av = a[sort.column];
        const bv = b[sort.column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string') return av.localeCompare(bv) * dir;
        return (av - bv) * dir;
      });
    }
    return [...projects].sort((a, b) => {
      const aOpen = isOpenProject(a);
      const bOpen = isOpenProject(b);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) {
        const ragDiff = (RAG_SORT_WEIGHT[a.projectHealthRag] ?? 3) - (RAG_SORT_WEIGHT[b.projectHealthRag] ?? 3);
        if (ragDiff !== 0) return ragDiff;
        const aDate = a.projectedGoLiveDate ? new Date(a.projectedGoLiveDate) : null;
        const bDate = b.projectedGoLiveDate ? new Date(b.projectedGoLiveDate) : null;
        if (aDate && bDate) return aDate - bDate;
        return aDate ? -1 : bDate ? 1 : 0;
      }
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }, [projects, sort]);

  const closedCount = projects.length - openProjects.length;
  const visible = hideClosed ? sorted.filter(isOpenProject) : sorted;

  return (
    <SectionCard
      title="Onboarding"
      description="Implementation-tracked deals, portfolio-wide — only deals HubSpot has a Project Status on; tracking only started around mid-2025, so older deals won't show up here"
      defaultExpanded={false}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Open Projects</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{openProjects.length}</p>
          {tierCounts.length > 0 && (
            <p className="text-xs text-neutral-400 mt-0.5">{tierCounts.map((t) => `${t.label}: ${t.count}`).join(' · ')}</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Avg. Days Open</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{avgDaysOpen != null ? `${avgDaysOpen}d` : '—'}</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Red / Amber</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">
            {openProjects.filter((p) => p.projectHealthRag === 'red').length} / {openProjects.filter((p) => p.projectHealthRag === 'amber').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Tracked</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{projects.length}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{projects.length - openProjects.length} completed/closed</p>
        </div>
      </div>

      <div className="mb-6">
        <OnboardingVolumeChart allProjects={projects} openProjects={openProjects} />
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No implementation-tracked deals yet — click Refresh to pull the latest.</p>
      ) : (
        <div className="overflow-x-auto">
          {closedCount > 0 && (
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={() => setHideClosed((v) => !v)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  hideClosed ? 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300' : 'bg-accent-500 text-white border-accent-500'
                }`}
              >
                {hideClosed ? `Show Completed/Closed (${closedCount})` : '← Hide Completed/Closed'}
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Company" column="companyName" sort={sort || {}} onSort={toggleSort} className="pr-4" />
                <th className="pb-2 pr-4">AM</th>
                <SortableHeader label="Tier" column="tier" sort={sort || {}} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Project" column="name" sort={sort || {}} onSort={toggleSort} className="pr-4" />
                <th className="pb-2 pr-4">RAG</th>
                <SortableHeader label="Progress" column="projectProgress" sort={sort || {}} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Status" column="projectStatus" sort={sort || {}} onSort={toggleSort} className="pr-4" />
                <th className="pb-2 pr-4">Owner</th>
                <SortableHeader label="Projected Go-Live" column="projectedGoLiveDate" sort={sort || {}} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                // Compound key, not bare dealId — confirmed live (same
                // issue as EscalationRequestsSection.jsx's own ticket rows)
                // a deal can be associated with more than one company in
                // HubSpot, so the same dealId can legitimately appear
                // twice here, once per company.
                <tr key={`${p.companyName}-${p.dealId}`} className={`border-t border-neutral-100 hover:bg-neutral-50 ${!isOpenProject(p) ? 'opacity-60' : ''}`}>
                  <td className="py-2 pr-4 text-neutral-500">
                    {p.companyHubspotUrl ? (
                      <a href={p.companyHubspotUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent-600 hover:underline">{p.companyName}</a>
                    ) : p.companyName}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{p.accountManagerName}</td>
                  <td className="py-2 pr-4 text-neutral-500">{tierStr(p.tier)}</td>
                  <td className="py-2 pr-4 font-medium">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-neutral-700 hover:text-accent-600 hover:underline">{p.name}</a>
                    ) : p.name}
                  </td>
                  <td className="py-2 pr-4"><RagBadge rag={p.projectHealthRag} /></td>
                  <td className="py-2 pr-4 text-neutral-500">{p.projectProgress != null ? `${p.projectProgress}%` : '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{p.projectStatus || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{p.projectOwner || '—'}</td>
                  <td className="py-2 text-neutral-500">{p.projectedGoLiveDate ? p.projectedGoLiveDate.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="text-sm text-neutral-500 italic py-4">Every tracked project is completed/closed — toggle above to see them.</p>
          )}
        </div>
      )}
    </SectionCard>
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

/** Same unset handling as tierLabel's "Unassigned" bucket — no client_tier property set (or the literal 0) in HubSpot. */
function isUnassignedTier(account) {
  return account.tier == null || account.tier === 0;
}

/**
 * Scrollable drawer of every account with no Client Tier set — the
 * "Unassigned" bucket on the Ticket Volume by AM by Tier chart (Aaron,
 * Sep 2026) — so these can be worked through and tiered in
 * HubSpot rather than staying an opaque bar segment. Sorted by Account
 * Manager then company name so accounts needing the same person's
 * attention group together.
 */
function UnassignedTierDrawer({ accounts, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const sorted = useMemo(
    () => [...accounts].sort((a, b) =>
      (a.account_manager_name || '').localeCompare(b.account_manager_name || '') || a.company_name.localeCompare(b.company_name)),
    [accounts]
  );

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportUnassignedTierAccounts(accounts);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title="Unassigned Tier Companies"
      subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'} with no Client Tier set in HubSpot`}
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
        <p className="text-sm text-neutral-500 italic">Every account has a Client Tier set — nothing to clean up.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((a) => (
            <div key={a.hubspot_company_id} className="border border-neutral-200 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <CompanyLink account={a} className="font-medium text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                <span className="text-xs text-neutral-400 shrink-0">{currencyStr(a.arr_cents)} ARR</span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                {a.account_manager_name} · {a.open_ticket_count || 0} open / {a.closed_ticket_count || 0} closed ticket(s)
              </p>
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
      title="Needs an AM"
      description={`${unmappedAccounts.length} accounts with no real AM name — ${unassignedCount} Unassigned, ${otherAmCount} with an unmapped ID`}
      defaultExpanded={false}
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
                <th className="pb-2 pr-3">AM</th>
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
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{d.name}</a> : d.name}
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
                <th className="pb-2 pr-3">AM</th>
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
                    {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{t.subject}</a> : t.subject}
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

function isPastDue(deal) {
  return deal.isOpen && deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date();
}

/** Same shape as AccountHealthDashboard.jsx's identical flatteners, plus accountManagerName — this file's own established "tag every flattened row with the owning AM" convention (EscalationRequestsSection.jsx, EnhancementRequestsSection.jsx, etc.), duplicated rather than shared per this codebase's per-page convention. */
function flattenDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.expansionPipeline?.deals || []) {
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id, accountManagerName: a.account_manager_name || 'Unassigned', tier: a.tier });
    }
  }
  return rows;
}

function flattenArrAddedDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id, accountManagerName: a.account_manager_name || 'Unassigned', tier: a.tier });
    }
  }
  return rows;
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

/** Same shape as AccountHealthDashboard.jsx's identical DealTypeChart — dealsByType is already server-computed per account (server/api/teamAm.js's mapLiveFinancialHealth), just summed across every account here, portfolio-wide. */
function DealTypeChart({ accounts, chartType, setChartType }) {
  const [showKey, setShowKey] = useState(false);
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
    return (
      <>
        <div className="flex justify-end mb-3"><ChartTypeToggle value={chartType} onChange={setChartType} /></div>
        <p className="text-sm text-neutral-500 italic">No deal data yet — click Refresh to pull it.</p>
      </>
    );
  }

  // Share of total deal COUNT (same metric the bar/pie both plot), not ARR
  // — matches this section's own tooltip, which already shows both
  // numbers per type rather than picking one as "the" percentage basis.
  const totalCount = data.reduce((s, d) => s + d.count, 0);
  const pctOf = (v) => (totalCount > 0 ? ` (${Math.round((v / totalCount) * 100)}%)` : '');

  return (
    <>
      <div className="flex items-center justify-end mb-3 gap-2">
        {chartType === 'pie' && (
          <button
            onClick={() => setShowKey((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300 transition-colors"
          >
            {showKey ? 'Hide Key' : 'Show Key'}
          </button>
        )}
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <ResponsiveContainer width="100%" height={480}>
        {chartType === 'pie' ? (
          <PieChart>
            {/* Show Key (Aaron, Sep 2026: "add a key option ... to give a
                legible accounting") — with ~9 deal types, the default
                inline wrapped labels collide/overlap into an unreadable
                cluster of small slices. Toggling the key drops the inline
                labels entirely (the Tooltip + Legend already carry the
                same count/%) rather than trying to shrink/re-wrap them
                further. */}
            <Pie data={data} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={showKey ? undefined : wrappedPieLabel((p) => `${p.count}${pctOf(p.count)}`)} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<DealTypeTooltip />} />
            {showKey && <Legend />}
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={90} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<DealTypeTooltip />} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

/**
 * "Deals by Type" trend line (Aaron, Sep 2026: "add the tracking and
 * trending feature" to this section) — same single-overall-total-line
 * shape as AccountHealthDashboard.jsx's identical DealTypeTrendSection,
 * backed by this file's own team-wide kpi_metric_history rows
 * (server/api/teamAm.js's /refresh handler).
 */
function DealTypeTrendSection() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/team-am/kpi-metric-history')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || {}))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const merged = mergeSeries(history, ['dealsByTypeTotalArr']);
  if (merged.length < 2) {
    return (
      <p className="text-sm text-neutral-500 italic">
        Not enough history yet — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={currencyStr} />
        <Tooltip formatter={(v) => currencyStr(v)} />
        <Line type="monotone" dataKey="dealsByTypeTotalArr" name="Total ARR (all deal types)" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * The actual deals behind the "ARR Added" roll-up tile, portfolio-wide —
 * same shape as AccountHealthDashboard.jsx's identical ArrAddedDealsSection
 * (including its pipeline-stage filter buttons, added there in the same
 * pass — Aaron, Sep 2026: "add those great deal pipeline stage filters to
 * the ARR added this year sections"), plus an AM column matching this
 * file's own team-wide tables.
 */
function ArrAddedDealsSection({ accounts }) {
  const deals = useMemo(() => flattenArrAddedDeals(accounts), [accounts]);
  const pipelines = useMemo(
    () => [...new Set(deals.map((d) => d.pipeline).filter(Boolean))].sort(),
    [deals]
  );
  const [pipelineFilter, setPipelineFilter] = useState([]); // empty = all pipelines
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'arrValueCents', direction: 'desc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportArrAddedDeals(sorted, true);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function togglePipeline(p) {
    setPipelineFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = pipelineFilter.length === 0 ? deals : deals.filter((d) => pipelineFilter.includes(d.pipeline));
    return q ? base.filter((d) => d.companyName?.toLowerCase().includes(q) || d.accountManagerName?.toLowerCase().includes(q)) : base;
  }, [deals, search, pipelineFilter]);

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
      title="ARR Added This Year"
      description={
        search.trim() || pipelineFilter.length > 0
          ? `${filtered.length} of ${deals.length} closed-won deal(s) shown${search.trim() ? `, matching "${search.trim()}"` : ''} — totaling ${currencyStr(filteredTotalCents)}`
          : `${deals.length} closed-won deal(s) totaling ${currencyStr(totalCents)}`
      }
      defaultExpanded={false}
      action={
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search accounts or AM…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
          />
          <button onClick={handleExport} disabled={exporting || deals.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
        </div>
      }
    >
      {exportError && <p className="text-xs text-error mb-3">{exportError}</p>}
      {deals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No closed-won deals with an ARR value this year yet.</p>
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
          {sorted.length === 0 ? (
            <p className="text-sm text-neutral-500 italic py-4">No deals match the current filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                    <SortableHeader label="Account" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Deal" column="name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Pipeline" column="pipeline" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR Value" column="arrValueCents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Close Date" column="closeDate" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed By" column="dealOwnerName" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((d, i) => (
                    <tr key={`${d.hubspotCompanyId}:${d.name}:${i}`} className="border-t border-neutral-100">
                      <td className="py-2 pr-4 text-neutral-700">{d.companyName}</td>
                      <td className="py-2 pr-4 text-neutral-500">{d.accountManagerName}</td>
                      <td className="py-2 pr-4 text-neutral-500">{tierStr(d.tier)}</td>
                      <td className="py-2 pr-4">
                        {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{d.name}</a> : d.name}
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{d.pipeline}</td>
                      <td className="py-2 pr-4 text-neutral-500">{d.stage}</td>
                      <td className="py-2 pr-4 text-neutral-500">{currencyStr(d.arrValueCents)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{d.closeDate ? d.closeDate.slice(0, 10) : '—'}</td>
                      <td className="py-2 text-neutral-500">{d.dealOwnerName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Portfolio-wide Deals view — every account's open + recently-closed (90
 * day) deals in one flat, filterable/sortable table, same shape as
 * AccountHealthDashboard.jsx's identical DealsSection ("All Deals"),
 * plus an AM column matching this file's own team-wide tables.
 */
function DealsSection({ accounts }) {
  const allDeals = useMemo(() => flattenDeals(accounts), [accounts]);
  const pipelines = useMemo(
    () => [...new Set(allDeals.map((d) => d.pipeline).filter(Boolean))].sort(),
    [allDeals]
  );
  const [pipelineFilter, setPipelineFilter] = useState([]); // empty = all pipelines
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'expectedCloseDate', direction: 'asc' });
  const [expandedKey, setExpandedKey] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportAllDeals(filtered, true);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function togglePipeline(p) {
    setPipelineFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = pipelineFilter.length === 0 ? allDeals : allDeals.filter((d) => pipelineFilter.includes(d.pipeline));
    if (q) base = base.filter((d) => d.companyName?.toLowerCase().includes(q) || d.accountManagerName?.toLowerCase().includes(q));
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
  }, [allDeals, pipelineFilter, search, sort]);

  return (
    <SectionCard
      title="All Deals"
      description={
        search.trim()
          ? `Open + recently-closed (90 days) — ${filtered.length} of ${allDeals.length} shown, matching "${search.trim()}"`
          : `Open + recently-closed (90 days) across every account — ${filtered.length} of ${allDeals.length} shown`
      }
      defaultExpanded={false}
      action={
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search accounts or AM…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
          />
          <button onClick={handleExport} disabled={exporting || allDeals.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
        </div>
      }
    >
      {exportError && <p className="text-xs text-error mb-3">{exportError}</p>}
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
                  <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                  <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
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
                        <td className="py-2 pr-4 text-neutral-500">{d.accountManagerName}</td>
                        <td className="py-2 pr-4 text-neutral-500">{tierStr(d.tier)}</td>
                        <td className="py-2 pr-4">
                          {d.url ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{d.name}</a>
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
                              className="font-medium text-cool-glacier hover:underline text-xs"
                            >
                              {tasks.length} open {expandedKey === key ? '▲' : '▼'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedKey === key && tasks?.length > 0 && (
                        <tr className="bg-neutral-50">
                          <td colSpan={10} className="py-2 px-4">
                            <ul className="text-xs space-y-1">
                              {tasks.map((t) => (
                                <li key={t.id} className={t.isOverdue ? 'text-error font-medium' : 'text-neutral-600'}>
                                  {t.url ? (
                                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{t.subject}</a>
                                  ) : t.subject} — {t.status}{t.dueDate ? ` · due ${t.dueDate.slice(0, 10)}` : ''}{t.isOverdue ? ' (overdue)' : ''}
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

export default function TeamAmDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [rollupByAccountManager, setRollupByAccountManager] = useState([]);
  const [companyHosts, setCompanyHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useInternalDeepLink(!loading && accounts.length > 0, JUMP_EVENT);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState(null);
  const [sort, setSort] = useState({ column: 'health_score', direction: 'asc' });
  const [metricKey, setMetricKey] = useState('avgScore');
  const [chartType, setChartType] = useState('bar');
  const [tierMetricKey, setTierMetricKey] = useState('arrCents');
  const [tierChartType, setTierChartType] = useState('bar');
  const [companiesByTierChartType, setCompaniesByTierChartType] = useState('bar');
  const [communitiesByTierChartType, setCommunitiesByTierChartType] = useState('bar');
  const [arrByTierByAmChartType, setArrByTierByAmChartType] = useState('bar');
  const [companiesByTierByAmChartType, setCompaniesByTierByAmChartType] = useState('bar');
  const [communitiesByTierByAmChartType, setCommunitiesByTierByAmChartType] = useState('bar');
  const [dealTypeChartType, setDealTypeChartType] = useState('bar');
  const [ticketsByAmByTierChartType, setTicketsByAmByTierChartType] = useState('bar');
  const [atRiskOpen, setAtRiskOpen] = useState(false);
  const [unassignedTierOpen, setUnassignedTierOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      // company_hosts is a single global table (server/db/database.js),
      // not owner-scoped — a subdomain mapped via Account Health
      // Dashboard's template already shows up here too, no separate
      // mapping UI needed on this page.
      const [res, hostsRes] = await Promise.all([
        fetch('/api/team-am'),
        fetch('/api/company-hosts'),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
      setAccounts(data.accounts || []);
      setRollupByAccountManager(data.rollupByAccountManager || []);
      setCompanyHosts(hostsRes.ok ? await hostsRes.json() : []);
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

  // Search-filtered but not yet tier-filtered — what the tier pills' own
  // live counts are computed against (Aaron, Sep 2026: "add the filter
  // buttons to the account table a la the filter buttons on the All Deals
  // table").
  const searchFilteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? accounts.filter((a) => a.company_name?.toLowerCase().includes(q) || a.account_manager_name?.toLowerCase().includes(q))
      : accounts;
  }, [accounts, search]);

  const filtered = useMemo(() => {
    const base = tierFilter
      ? searchFilteredAccounts.filter((a) => ((a.tier == null || a.tier === 0) ? 'Unassigned' : `Tier ${a.tier}`) === tierFilter)
      : searchFilteredAccounts;
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
  }, [searchFilteredAccounts, tierFilter, sort]);

  const rollup = useMemo(() => {
    // lifecycle_flag'd accounts (a Home Office whose own HubSpot lifecycle
    // stage isn't "Client - Home Office" — Lead/Canceled/wrong-stage/no-
    // stage — see server/services/hubspotAccounts.js's
    // getLifecycleDataQualityFlag) stay in `accounts` so the Accounts
    // table/search below still shows them — Aaron explicitly didn't want
    // this "too stringent" (Sep 2026) — but are left out of every sum
    // here so a stray $0-ARR non-client record can't drag down the
    // portfolio's avg health score or ARR total.
    const clean = accounts.filter((a) => !a.lifecycle_flag);
    const scored = clean.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
    const distinctAms = new Set(clean.map((a) => a.account_manager_name).filter((n) => n && !n.startsWith('Other AM') && n !== 'Unassigned'));

    // Same "only sum accounts that actually have a real number" pattern as
    // Account Health Dashboard's own rollup — everyone else is left out of
    // these sums entirely rather than silently counted as 0. Two genuinely
    // different sources: hubspotCapacity is HubSpot's own "Total Beds on
    // ALIS" property (free, populated by the regular HubSpot refresh, no
    // ALIS call); total_capacity/current_census come from this dashboard's
    // own ALIS occupancy pull (Refresh Occupancy Data button below) and can
    // legitimately disagree with the HubSpot figure.
    const hubspotCapacityEligible = clean.filter((a) => a.hubspot_capacity != null);
    const hubspotCapacityTotal = hubspotCapacityEligible.reduce((s, a) => s + a.hubspot_capacity, 0);
    const occupancyEligible = clean.filter((a) => a.total_capacity != null);
    const totalCapacity = occupancyEligible.reduce((s, a) => s + a.total_capacity, 0);
    const currentCensus = occupancyEligible.reduce((s, a) => s + (a.current_census || 0), 0);
    const occupancyAsOfDate = accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null;
    // Newest, not first-found — accounts missing from the latest report keep an older date. MM/DD/YYYY → compare year, then MM/DD.
    const agingAsOfDate = accounts.reduce((latest, a) => {
      const d = a.aging_as_of_date;
      return d && (!latest || d.slice(6) + d.slice(0, 5) > latest.slice(6) + latest.slice(0, 5)) ? d : latest;
    }, null);
    // Every account gets the same refreshed_at within one /refresh run (set
    // from a single `new Date()` server-side, not per-account) — first
    // non-null found is as good as a MAX() here, same shorthand
    // agingAsOfDate/occupancyAsOfDate already use (matches Account Health
    // Dashboard's identical rollup.lastHubspotRefreshAt).
    const lastHubspotRefreshAt = accounts.find((a) => a.refreshed_at)?.refreshed_at || null;

    return {
      totalAms: distinctAms.size,
      totalAccounts: accounts.length,
      flaggedAccountCount: accounts.length - clean.length,
      totalCommunities: clean.reduce((s, a) => s + (a.active_community_count || 0), 0),
      openTickets: clean.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: clean.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      escalationCount: clean.reduce((s, a) => s + (a.alis_escalation_open_count || 0), 0),
      enhancementTop: clean.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
      enhancementLesser: clean.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
      otherOpen: clean.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
      arrCents: clean.reduce((s, a) => s + (a.arr_cents || 0), 0),
      arrAddedThisYearCents: clean.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      avgScore,
      hubspotCapacity: hubspotCapacityTotal,
      hubspotCapacityAccountCount: hubspotCapacityEligible.length,
      totalCapacity,
      currentCensus,
      occupancyPct: totalCapacity > 0 ? currentCensus / totalCapacity : null,
      occupancyAccountCount: occupancyEligible.length,
      occupancyAsOfDate,
      agingAsOfDate,
      lastHubspotRefreshAt,
    };
  }, [accounts]);

  // Same mappedCount logic as AccountHealthDashboard's CompanyHostMappingButtons
  // — how many of these accounts have a known ALIS subdomain at all, distinct
  // from occupancyAccountCount (how many actually got real data back). Falls
  // back to a name match when a company_hosts row has no HubSpot ID (true
  // for anything pulled in via the admin.alisonline.com directory scrape,
  // which only knows a company's name) — an ID-only join undercounts those.
  const mappedCount = useMemo(
    () => accounts.filter((a) => companyHosts.some((h) =>
      (h.hubspot_company_id && h.hubspot_company_id === a.hubspot_company_id) ||
      (h.company_name || '').trim().toLowerCase() === (a.company_name || '').trim().toLowerCase()
    )).length,
    [companyHosts, accounts]
  );

  const atRiskAccounts = useMemo(() => accounts.filter(isAtRisk), [accounts]);
  const unassignedTierAccounts = useMemo(() => accounts.filter(isUnassignedTier), [accounts]);

  function jumpToAccounts(e) {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: 'accounts' } }));
  }

  return (
    <div>
      <div className="card mb-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="flex items-center gap-3 text-5xl font-bold text-primary-900">
              <img src="/butterfly-icon.png" alt="" className="h-11 w-auto" />
              Team AM Dashboard
            </h1>
            <p className="text-sm text-neutral-500 mt-2">
              {rollup.totalAccounts} Home Office accounts across {rollup.totalAms} AMs
            </p>
            <p className="text-xs font-medium text-cool-glacier mt-1">
              Proactive health · portfolio financials · data you can trust
            </p>
            {/* Deliberately two separate lines, not one — "mapped" (has a
                subdomain saved) and "has occupancy data" (that pull actually
                returned something) are different concepts, and conflating
                them on Account Health Dashboard once already confused Aaron
                into reading a data gap as a mapping gap. */}
            <p className="text-xs text-neutral-400 mt-1">
              {mappedCount} of {rollup.totalAccounts} have a known ALIS subdomain
            </p>
            <p className="text-xs text-neutral-400">
              {rollup.occupancyAccountCount} of {rollup.totalAccounts} have occupancy data
            </p>
          </div>
          {/* Same header pattern as AccountHealthDashboard.jsx (Sep 2026,
              Aaron: "add the same utility panel pattern AND the accounts
              search functionality... with the same search input and
              buttons") — shares the same `search` state the Accounts
              SectionCard below already filters on, so typing here doesn't
              move the page; Enter/the button dispatches JUMP_EVENT to
              expand-and-scroll to that table, already pre-filtered. */}
          <div className="flex flex-col gap-2 shrink-0">
            <form onSubmit={jumpToAccounts} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search accounts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
              />
              <button type="submit" className="btn btn-sm btn-secondary border border-accent-500/40 w-24 justify-center">Accounts</button>
            </form>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(UTILITIES_TOGGLE_EVENT))}
              className="btn btn-sm btn-secondary border border-accent-500/40 self-end w-24 justify-center"
            >
              Utilities
            </button>
          </div>
        </div>
      </div>

      <UtilityPanel>
        <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <ExportExcelButton accounts={accounts} rollup={rollup} rollupByAccountManager={rollupByAccountManager} />
          <ExportPptButton />
        </div>
        <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <CompanyHostMappingButtons accounts={accounts} companyHosts={companyHosts} onImported={load} />
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <ImportAgingReportButton onImported={load} />
          <p className="text-[11px] text-neutral-400 mt-1">
            {rollup.agingAsOfDate ? `Last updated: as of ${rollup.agingAsOfDate}` : 'Last updated: never'}
          </p>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <RefreshButton onRefreshed={load} />
          <p className="text-[11px] text-neutral-400 mt-1">
            {rollup.lastHubspotRefreshAt ? `Last updated: ${dateTimeStr(rollup.lastHubspotRefreshAt)}` : 'Last updated: never'}
          </p>
        </div>
        <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <RefreshOccupancyButton onRefreshed={load} />
          <p className="text-[11px] text-neutral-400 mt-1">
            {rollup.occupancyAsOfDate ? `Last updated: as of ${rollup.occupancyAsOfDate}` : 'Last updated: never'}
          </p>
        </div>
      </UtilityPanel>

      {error && <div className="alert alert-error mb-6"><span>⚠️</span><p className="text-sm">{error}</p></div>}

      {rollup.flaggedAccountCount > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <p className="text-sm">
            {rollup.flaggedAccountCount} of these Home Offices aren't an active "Client - Home Office" record in
            HubSpot — a pure Lead or Canceled record is dropped from this dashboard entirely unless it still carries
            an aging balance (kept so someone keeps chasing the money owed); Client - Community and no-lifecycle-
            stage-set accounts stay visible either way (look for the amber badge next to the name), since those look
            more like a HubSpot data-entry gap than a real non-client. Either way, flagged accounts are excluded from
            every total/average on this page so they can't skew portfolio ARR or health score.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-neutral-500 mb-4">No cached team data yet.</p>
          <RefreshButton onRefreshed={load} />
        </div>
      ) : (
        <>
          <SectionCard title="Account & Operations Overview">
            <QuickJumpNav sections={OVERVIEW_SECTIONS} />
          </SectionCard>

          {/* Three labeled acts, same story/labels as Account Health
              Dashboard's StatGroup (no "Data You Can Trust" group here —
              see StatGroup's doc comment for why). */}
          <StatGroup title="Portfolio Health — proactive, not reactive">
            <StatCard label="AMs" value={rollup.totalAms} />
            <StatCard label="Total Accounts" value={rollup.totalAccounts} jumpTo="accounts" jumpLabel="Jump to table ↓" />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} jumpTo="health-score-distribution" jumpLabel="Jump to breakdown ↓" />
            <TopThreeEnhancementsCard accounts={accounts} includeAccountManager />
          </StatGroup>

          <StatGroup title="Financial & Occupancy — the whole portfolio, already assembled">
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} jumpTo="arr-by-tier" jumpLabel="Jump to breakdown ↓" />
            <StatCard
              label={`ARR Added (${new Date().getFullYear()})`}
              value={currencyStr(rollup.arrAddedThisYearCents)}
              jumpTo="arr-by-tier"
              jumpLabel="Jump to breakdown ↓"
            />
            <StatCard label="Total Communities" value={rollup.totalCommunities} sub="Active child companies" />
            <StatCard
              label="Total Beds on ALIS (HubSpot)"
              value={rollup.hubspotCapacityAccountCount > 0 ? numberStr(rollup.hubspotCapacity) : '—'}
              sub={`${rollup.hubspotCapacityAccountCount} of ${rollup.totalAccounts} report a capacity`}
            />
            <StatCard
              label={`Total Capacity (ALIS)${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`}
              value={rollup.occupancyAccountCount > 0 ? numberStr(rollup.totalCapacity) : '—'}
              // Same wording lesson as Account Health Dashboard: never call
              // this "accounts mapped" — that already means "has a
              // subdomain saved" (the header's own coverage line), a
              // different concept from "this pull actually returned data."
              sub={rollup.occupancyAccountCount > 0 ? `${rollup.occupancyAccountCount} of ${rollup.totalAccounts} have occupancy data` : 'No occupancy data yet'}
            />
            <StatCard
              label="Current Census"
              value={rollup.occupancyAccountCount > 0 ? numberStr(rollup.currentCensus) : '—'}
              sub={rollup.occupancyPct != null ? `${pctStr(rollup.occupancyPct)} occupied` : undefined}
            />
          </StatGroup>

          <StatGroup title="Support Activity" columns={5}>
            <StatCard
              label="Open Tickets"
              value={rollup.openTickets}
              note="Client Submitted + In Progress, excl. enhancements"
              jumpTo="tickets-by-tier"
              jumpLabel="Jump to breakdown ↓"
            />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} jumpTo="tickets-by-tier" jumpLabel="Jump to breakdown ↓" />
            <StatCard
              label="Open Escalation Tickets"
              value={rollup.escalationCount}
              jumpTo="tickets-escalation"
              jumpLabel="Jump to list ↓"
            />
            <AlisPayTicketsCard accounts={accounts} includeAccountManager />
            <StatCard
              label="Enhancement Requests"
              value={rollup.enhancementTop + rollup.enhancementLesser}
              note={`${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`}
              jumpTo="enhancement-requests"
              jumpLabel="Jump to list ↓"
            />
          </StatGroup>

          {/* Accounts, then Escalation Tickets, then Top 3 Enhancement
              Requests, then Enhancement Requests — directly under the KPI
              tiles (Sep 2026, Aaron: "same pattern as on the Account
              Health Dashboard", which orders these identically right
              after its own Support Activity StatGroup). */}
          <SectionCard
            title="Accounts"
            description="Sorted by Health Score by default — weakest accounts first"
            defaultExpanded={false}
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
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {TIER_ORDER.map((t) => {
                const tCount = searchFilteredAccounts.filter((a) => ((a.tier == null || a.tier === 0) ? 'Unassigned' : `Tier ${a.tier}`) === t).length;
                if (tCount === 0) return null;
                return (
                  <button
                    key={t}
                    onClick={() => setTierFilter((prev) => (prev === t ? null : t))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      tierFilter === t
                        ? 'bg-accent-500 text-white border-accent-500'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {t} ({tCount})
                  </button>
                );
              })}
              {tierFilter && (
                <button onClick={() => setTierFilter(null)} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
                  Clear filter
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                    <SortableHeader label="Account" column="company_name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="AM" column="account_manager_name" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Community" column="active_community_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Health" column="health_score" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Tickets" column="open_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed Tickets" column="closed_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label={`ARR Added (${new Date().getFullYear()})`} column="arr_added_this_year_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Aging Balance" column="aging_total_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Capacity" column="total_capacity" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Current Census" column="current_census" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Last Activity" column="last_activity_date" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.hubspot_company_id} className="border-t border-neutral-100 hover:bg-neutral-50">
                      <td className="py-2 pr-4 font-medium">
                        <CompanyLink account={a} className="text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                        {a.lifecycle_flag_label && (
                          <span
                            title={`Excluded from portfolio totals/averages above: ${a.lifecycle_flag_label}`}
                            className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 align-middle"
                          >
                            ⚠ {a.lifecycle_flag_label}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{a.account_manager_name}</td>
                      <td className="py-2 pr-4 text-neutral-500">{tierStr(a.tier)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.active_community_count ?? '—'}</td>
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={a.health_band} /></td>
                      <td className="py-2 pr-4">{a.open_ticket_count ?? 0}</td>
                      <td className="py-2 pr-4">{a.closed_ticket_count ?? 0}</td>
                      <td className="py-2 pr-4">{currencyStr(a.arr_cents)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.arr_added_this_year_cents ? currencyStr(a.arr_added_this_year_cents) : '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.aging_total_cents != null ? currencyStr(a.aging_total_cents) : '—'}</td>
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

          <SectionCard
            title="Health Score Distribution"
            description="How many accounts fall into each health band, portfolio-wide"
            defaultExpanded={false}
            action={
              <button onClick={() => setAtRiskOpen(true)} className="btn btn-secondary btn-sm">
                View At-Risk Accounts ({atRiskAccounts.length})
              </button>
            }
          >
            <HealthScoreDistributionChart accounts={accounts} />
            <HealthScoreTrendSection />
          </SectionCard>
          {atRiskOpen && <AtRiskDrawer accounts={atRiskAccounts} onClose={() => setAtRiskOpen(false)} />}

          <ImplementationProjectsSection accounts={accounts} />

          <SectionCard title="Tickets: Escalation" description="Every open ticket categorized ALIS Escalation, portfolio-wide — keeps high-priority items top of mind" defaultExpanded={false}>
            <EscalationRequestsSection accounts={accounts} includeAccountManager />
          </SectionCard>

          <SectionCard title="Ticket Activity" description="Trailing 12 months, opened vs. closed, across the whole team's portfolio" defaultExpanded={false}>
            <TicketActivitySection accounts={accounts} />
          </SectionCard>

          <SectionCard title="Enhancement Requests: Top 3" description="Every account's staged Top 3 Enhancement Request, portfolio-wide" defaultExpanded={false}>
            <EnhancementRequestsSection accounts={accounts} includeAccountManager topThreeOnly />
          </SectionCard>

          <SectionCard title="Enhancement Requests" description="Every open ticket categorized or titled as an Enhancement, portfolio-wide — broader than the Enhancement Requests: Top 3 section above" defaultExpanded={false}>
            <EnhancementRequestsSection accounts={accounts} includeAccountManager />
          </SectionCard>

          <SectionCard title="Tickets by Category Open" description="Aggregated across every account, team-wide — current workload" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="open" />
          </SectionCard>
          <SectionCard title="Tickets by Category Closed" description="Aggregated across every account, team-wide — historical mix" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="closed" />
          </SectionCard>
          <SectionCard
            title={INTERNAL_SECTION_TITLE}
            description="Internal capture tickets (Category 2.0 = ALIS Internal) — searchable across description, next step, pinned note, and the links collected in them"
            defaultExpanded={false}
          >
            <AlisInternalSection pagePath="/team-am" />
          </SectionCard>

          <SectionCard
            title="Ticket Volume by AM by Tier"
            description="Open + closed tickets per AM, segmented by Client Tier"
            defaultExpanded={false}
            action={
              <button onClick={() => setUnassignedTierOpen(true)} className="btn btn-secondary btn-sm">
                View Unassigned Tier Companies ({unassignedTierAccounts.length})
              </button>
            }
          >
            <TicketsByAmByTierChart accounts={accounts} chartType={ticketsByAmByTierChartType} setChartType={setTicketsByAmByTierChartType} />
          </SectionCard>

          <SectionCard title="Tickets by Tier" description="Open vs. closed ticket volume grouped by Client Tier, portfolio-wide" defaultExpanded={false}>
            <TicketsByTierChart accounts={accounts} />
          </SectionCard>

          <SectionCard
            title="Cost to Serve by Tier"
            description="Ticket volume (open + closed) per $1,000 of ARR — how much more support each ARR dollar costs at lower tiers"
            defaultExpanded={false}
            action={
              unassignedTierAccounts.length > 0 && (
                <button onClick={() => setUnassignedTierOpen(true)} className="btn btn-secondary btn-sm">
                  View Unassigned Tier Companies ({unassignedTierAccounts.length})
                </button>
              )
            }
          >
            <CostToServeByTierChart accounts={accounts} />
          </SectionCard>
          {unassignedTierOpen && <UnassignedTierDrawer accounts={unassignedTierAccounts} onClose={() => setUnassignedTierOpen(false)} />}

          <SectionCard title="KPI by AM" description="Pick a metric to break down across the team" defaultExpanded={false}>
            <KpiByAmChart
              rollupByAccountManager={rollupByAccountManager}
              metricKey={metricKey}
              setMetricKey={setMetricKey}
              chartType={chartType}
              setChartType={setChartType}
            />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <KpiByAmTrendSection metricKey={metricKey} />
            </div>
          </SectionCard>

          <SectionCard title="Companies by Tier by AM" description="How many companies each AM manages, segmented by Client Tier" defaultExpanded={false}>
            <CompaniesByTierByAmChart accounts={accounts} chartType={companiesByTierByAmChartType} setChartType={setCompaniesByTierByAmChartType} />
          </SectionCard>

          <SectionCard title="Communities by AM by Tier" description="How many communities each AM manages, segmented by Client Tier" defaultExpanded={false}>
            <CommunitiesByTierByAmChart accounts={accounts} chartType={communitiesByTierByAmChartType} setChartType={setCommunitiesByTierByAmChartType} />
          </SectionCard>

          <SectionCard title="ARR by Tier per AM" description="How much of each AM's total ARR falls into each Client Tier" defaultExpanded={false}>
            <ArrByTierByAmChart accounts={accounts} chartType={arrByTierByAmChartType} setChartType={setArrByTierByAmChartType} />
          </SectionCard>

          <SectionCard title="Companies by Tier" description="Number of accounts grouped by Client Tier, portfolio-wide" defaultExpanded={false}>
            <CompaniesByTierChart accounts={accounts} chartType={companiesByTierChartType} setChartType={setCompaniesByTierChartType} />
          </SectionCard>

          <SectionCard title="Communities by Tier" description="Number of communities grouped by Client Tier, portfolio-wide" defaultExpanded={false}>
            <CommunitiesByTierChart accounts={accounts} chartType={communitiesByTierChartType} setChartType={setCommunitiesByTierChartType} />
          </SectionCard>

          <SectionCard title="ARR by Tier" description="Total ARR / ARR Added this year, grouped by Client Tier" defaultExpanded={false}>
            <TierByArrChart
              accounts={accounts}
              metricKey={tierMetricKey}
              setMetricKey={setTierMetricKey}
              chartType={tierChartType}
              setChartType={setTierChartType}
            />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <ArrByTierTrendSection metricKey={tierMetricKey} />
            </div>
          </SectionCard>

          <SectionCard title="Deals by Type" description="Aggregated across every account's deal history — value shown is ARR" defaultExpanded={false}>
            <DealTypeChart accounts={accounts} chartType={dealTypeChartType} setChartType={setDealTypeChartType} />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <DealTypeTrendSection />
            </div>
          </SectionCard>

          <ArrAddedDealsSection accounts={accounts} />

          <DealsSection accounts={accounts} />

          <UnmappedAmSection accounts={accounts} />
        </>
      )}
      <FloatingSectionNav
        watchSectionId={slugify('Account & Operations Overview')}
        sections={OVERVIEW_SECTIONS}
        enabled={!loading && accounts.length > 0}
        onSelect={(title) => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: slugify(title) } }))}
      />
      <BackToTopButton />
    </div>
  );
}
