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
import CommunityRevenueSection from '../components/CommunityRevenueSection';
import {
  exportAccountHealthPortfolioExcel, exportAccountHealthSingleExcel,
  exportCompanyHostTemplate, parseCompanyHostTemplate,
  exportRecurringCallsExcel, exportRecurringCallsTemplate, parseRecurringCallsTemplate,
  exportKeyContactsExcel, flattenKeyContacts,
} from '../utils/accountHealthExport';
import { arrayBufferToBase64 } from '../utils/base64';
import { exportUnassignedTierAccounts } from '../utils/unassignedTierExport';
import { exportAllDeals } from '../utils/allDealsExport';
import { exportArrAddedDeals } from '../utils/arrAddedDealsExport';

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

/** Thousands-separated plain count (Sep 2026, Aaron: "add a comma to the capacity and census numbers... to make them more legible") — capacity/census/beds regularly run into 5-6 figures portfolio-wide, unlike the smaller per-category ticket counts elsewhere that don't need it. */
function numberStr(n) {
  return n == null ? '—' : n.toLocaleString('en-US');
}

/** notes_last_updated (HubSpot's "Last Activity Date") stored as an ISO timestamp — covers both an ALIS-initiated note/call/task and a client email/call logged back, whichever happened most recently. */
function lastActivityStr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Same as lastActivityStr but with a time-of-day, for a real ISO timestamp (e.g. refreshed_at) rather than a plain "as of this date" string — those (aging_as_of_date/occupancy_as_of_date) carry no meaningful time component, so lastActivityStr's date-only format stays right for them. */
function dateTimeStr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
 * plain non-interactive `sub` shape unchanged.
 */
// min-h-8 on the label line (Sep 2026) — a 2-word title like "Open
// Tickets" fits on one line, but "Enhancement Requests" (or any longer
// label) wraps to two, pushing that card's value/note/jump-link down
// relative to its neighbors in the same row and breaking the row's
// horizontal alignment. Reserving room for 2 lines up front means every
// card's value sits at the same vertical position regardless of how long
// its own title happens to be.
//
// flex flex-col items-start (button variant) is the OTHER half of that
// same fix, and the one that actually matters more: confirmed live that
// a bare <button> — even with our own `display: block` from the `.card`
// class — vertically CENTERS its children within whatever height CSS
// Grid's default row-stretch gives it, a native per-element quirk that
// doesn't show up in getComputedStyle (button, label, and padding all
// read identically between a misaligned pair) and isn't affected by
// min-h-8 alone. A card with fewer child lines than its tallest row-mate
// (e.g. "Closed Tickets," 3 lines, next to "Open Tickets," 4 lines) was
// getting real, extra top-padding worth of centering, offsetting its
// whole content block down instead of just leaving blank space below it.
// Forcing an explicit top-anchored flex column overrides that native
// button-content-centering behavior outright, regardless of its cause.
// `secondaryValue` lets one card carry two related numbers on one line,
// e.g. "27 / $53,189" (Sep 2026: Open Deals + Open Deal Value merged into
// one "Open Deals & Value" tile since they jumped to the same place
// anyway) — freeing up a grid slot so the remaining cards can widen and
// stop clipping long dollar figures.
// `tooltip` hides an explanatory caveat (e.g. Portfolio DSO's "rudimentary"
// disclaimer) behind a hover-only info icon instead of a permanent `sub`
// line, for text that matters but doesn't need to sit on the card at all
// times.
// Click-to-toggle rather than hover (Sep 2026, Aaron: "the hover action
// makes reading the text tricky" — a native `title` tooltip vanishes the
// moment the mouse drifts off it, mid-read). Stays open until the icon is
// clicked again, not on mouse-out/click-outside, matching exactly what
// Aaron asked for. `stopPropagation` keeps a click here from also firing
// whatever click handler the label row it's sitting in belongs to.
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
      {/* `span`, not `div` — this can render inside a StatCard's `<p>`
          label (e.g. "PORTFOLIO DSO ⓘ"), and a `<div>` there is invalid
          HTML that makes the browser silently close the `<p>` early,
          breaking this popover's positioning against it. `block` gives
          this span the same box behavior a div would have had. */}
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

function StatCard({ label, value, secondaryValue, sub, note, tooltip, jumpTo, jumpLabel = 'Jump to section ↓' }) {
  const valueBlock = secondaryValue != null ? (
    <p className="text-2xl group-hover:text-3xl font-bold text-primary-900 mt-1 transition-[font-size]">
      {value} <span className="text-neutral-300">/</span> {secondaryValue}
    </p>
  ) : (
    <p className="text-2xl group-hover:text-3xl font-bold text-primary-900 mt-1 transition-[font-size]">{value}</p>
  );

  if (jumpTo) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: jumpTo } }))}
        className="group card relative w-full text-left transition-all duration-200 hover:scale-105 hover:z-10 hover:shadow-xl flex flex-col items-start"
      >
        <p className="text-xs group-hover:text-sm text-neutral-500 uppercase tracking-wide transition-[font-size] min-h-8 flex items-center gap-1">
          {label}<InfoIcon tooltip={tooltip} />
        </p>
        {valueBlock}
        {note && <p className="text-xs group-hover:text-sm text-neutral-400 mt-0.5 transition-[font-size]">{note}</p>}
        <p className="text-xs group-hover:text-sm font-medium text-cool-glacier mt-0.5 transition-[font-size]">{jumpLabel}</p>
      </button>
    );
  }
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide min-h-8 flex items-center gap-1">
        {label}<InfoIcon tooltip={tooltip} />
      </p>
      {valueBlock}
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
// columns defaults to 4 (every existing StatGroup keeps its current width
// unchanged) — Support Activity and Financial & Occupancy are both 5-wide
// (Sep 2026), so this is a small literal-string branch rather than an
// interpolated class name, since Tailwind's JIT only picks up class
// strings it can find verbatim in the source, not ones built at runtime
// like `md:grid-cols-${columns}`.
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

function CompanyLink({ account, children, className = 'font-medium text-cool-glacier hover:underline' }) {
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

/** Matches a SectionCard's `title` to the DOM id the "Jump to Section" quick nav (and any StatCard's `jumpTo`) scroll/expand to — single source of truth (title -> id) so a renamed title can't silently break a link. */
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Cross-component "jump to this section" signal — QuickJumpNav dispatches it, every SectionCard listens for its own id, expands itself if collapsed, and scrolls into view. A DOM event rather than lifted state: this file renders SectionCards from several independent sub-components (RecurringCallsSection, ArrAddedDealsSection, DealsSection) and threading expanded/onToggle props through all of them just for this would be far more invasive than one shared event. */
const JUMP_EVENT = 'alis-hub:jump-to-section';

// Single source of truth for "every section on this page" — used by both
// the "Account & Operations Overview" card's QuickJumpNav and the floating
// butterfly FloatingSectionNav (Sep 2026) that takes over once that card
// scrolls out of view, so the two navigation menus can never drift apart.
// Same 3-theme taxonomy across all 3 dashboards (Sep 2026, Aaron: "keep the
// alphabetical ordering but introduce a thematic grouping to the links --
// accounts, financials, tickets") — same buckets on Team AM/KPI-QBR too, so
// a section's category means the same thing everywhere. No separate
// Operational catch-all (Aaron, Sep 2026: "totally comfortable with
// sections in that group joining the accounts section") — those items
// (AM KPI, Onboarding) just live in Accounts instead.
// Every ticket-related title also starts with "Ticket(s)" now (was
// "Escalation Tickets"/"Open Tickets by Category 2.0"/"Closed Tickets by
// Category 2.0") so they already sort together within their own bucket.
// Each bucket's items are alphabetized here at build time (not
// hand-ordered) so a newly added section can't silently drift out of
// order.
const OVERVIEW_SECTIONS = [
  { category: 'Accounts', items: ['Accounts', 'AM KPI', 'Companies by Tier', 'Health Score by Tier', 'Health Score Trend', 'Key Contacts', 'Onboarding', 'Recurring Calls'].sort((a, b) => a.localeCompare(b)) },
  { category: 'Financials', items: ['All Deals', 'ARR Added This Year', 'ARR by Tier', 'Community Revenue & Occupancy', 'Cost to Serve by Tier', 'Deals by Type'].sort((a, b) => a.localeCompare(b)) },
  { category: 'Tickets', items: ['Enhancement Requests', 'Enhancement Requests: Top 3', 'Ticket Activity', 'Ticket Volume by Client Tier', 'Tickets by Category Closed', 'Tickets by Category Open', 'Tickets: Escalation'].sort((a, b) => a.localeCompare(b)) },
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

// "Toggle the Utilities panel" signal — window-CustomEvent rather than a
// plain prop/lifted-state toggle (Sep 2026) since it started out dispatched
// from App.jsx's top nav bar (a sibling of this page under <Routes>) and
// this was the lower-effort way to reach across that boundary; the
// dispatcher later moved onto this same page (the "🛠️ Utilities" button
// under "Accounts") but the event plumbing was left as-is rather than
// rewired to local state, since it already works and there's no second
// listener anywhere to justify the churn.
const UTILITIES_TOGGLE_EVENT = 'alis-hub:toggle-utilities';

// Fired by a Refresh button once its refresh finishes successfully (see
// RefreshButton/RefreshOccupancyButton below) so the panel doesn't just
// sit open afterward — same reasoning/mechanism as TeamAmDashboard.jsx's
// identical constant (kept in sync manually, matching this pair of
// pages' established duplication convention). Deliberately NOT fired on
// error — the error message renders inside this same panel, so an auto-
// close would hide the thing the user needs to see.
const UTILITIES_CLOSE_EVENT = 'alis-hub:close-utilities';

/**
 * The export/import/refresh buttons, tucked away in a slide-over side
 * Drawer (Sep 2026, Aaron: "open a side panel with the utility button
 * options" — same reusable Drawer component every KPI drill-down and the
 * account detail view already use) rather than expanding inline on the
 * page. Renders nothing until the "🛠️ Utilities" button (under "Accounts"
 * in the header) toggles it open; deliberately no visible toggle control
 * of its own here — that button (and this Drawer's own ✕) are the only
 * way to open/close.
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
 * the page, via JUMP_EVENT — no bespoke card of its own anymore (Sep
 * 2026, Aaron: "minimize like the other sections — accounts, Companies by
 * Tier"), just the link grid; the caller wraps it in a real SectionCard
 * ("Account & Operations Overview") so it collapses/expands the exact
 * same way as every other section instead of the old always-visible,
 * hover-grow stat-tile treatment.
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
      window.dispatchEvent(new CustomEvent(UTILITIES_CLOSE_EVENT));
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={refreshing} className={`btn btn-sm ${refreshing ? 'btn-accent' : 'btn-secondary'}`}>
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
    <div>
      <label className="btn btn-sm btn-secondary cursor-pointer">
        {importing ? 'Importing…' : '📥 Import Aging Report'}
        <input type="file" accept="application/pdf" onChange={handleFile} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs">
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
    // Set BEFORE the fetch, not after it resolves (Sep 2026, Aaron: "once
    // clicked... acknowledge the action that was just kicked off... I'm
    // optimizing against people repeatedly mashing the button") — the
    // round-trip to create the job could itself take a perceptible
    // moment, and until now nothing changed on screen until that
    // resolved. `total: 0` here (the real total lands a few lines down)
    // already flips `refreshing` to true and repaints the button
    // immediately.
    setProgress({ completed: 0, total: 0, failed: 0, lastItem: null });
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
      <button onClick={handleClick} disabled={refreshing} className={`btn btn-sm ${refreshing ? 'btn-accent' : 'btn-secondary'}`}>
        {refreshing ? (progress.total > 0 ? `Refreshing… ${pct}%` : 'Starting…') : '🏘️ Refresh Occupancy Data'}
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

/**
 * Custom two-line Pie label (Aaron, Sep 2026: "avoid labels getting cut
 * off... wrapping would be fine, as long as the detail is legible") —
 * Recharts' default `label` renders one long <text> node ("Tier 1: 148
 * (27%)") that routinely runs past the SVG edge and gets clipped there,
 * especially for two or three pies sharing a fraction of the row's width.
 * Wraps onto two <tspan> lines (name, then value) instead — same
 * midAngle/outerRadius geometry Recharts' own default label positioning
 * uses, replicated here so multi-line text still points at the right
 * slice from the right side. `valueOf(props)` gets the same full props
 * object Recharts already passes to `label` (name, value/total, plus the
 * geometry fields used below) and returns just the value/percent line.
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

const HEATMAP_WEEKS = 53;

/** count -> one of 5 shade levels, same idea as GitHub's contribution graph (0 = none, then roughly-even buckets up to the observed max). Same logic as EnhancementRequestsSection.jsx's own heatLevel — duplicated, not shared, matching this codebase's per-page convention for small visual helpers. */
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
 * math as EnhancementRequestsSection.jsx's EnhancementCalendarHeatmap
 * (plain CSS grid, no calendar library in this codebase), generalized here
 * so `dateField`/`colorScale` are props instead of hardcoded to
 * `createdAt` + blue, since Ticket Activity needs two instances (opened
 * via createdAt, closed via closedAt) with visually distinct colors.
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
      {/* Fixed-width + mx-auto centers the grid within the card on wide
          viewports (it used to just hang on the left margin); the
          overflow-x-auto on the outer div still lets it scroll rather
          than get clipped on a viewport narrower than the grid itself. */}
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

/**
 * Aaron's own ticket activity, portfolio-wide (Sep 2026) — opened vs.
 * closed, day-by-day, trailing 12 months. Sourced from
 * `serviceHealth.ticketDates` (server/api/accountHealth.js's
 * mapLiveServiceHealth), a slim {createdAt, closedAt} list per ticket
 * already populated by the regular HubSpot refresh — no new API calls.
 * Same flatten-across-accounts approach as EnhancementRequestsSection.jsx.
 */
// Same "focused queue" hubspotTickets.js's own FOCUSED_OPEN_STATUS_LABELS
// already defines for this app's live service-health scoring and the
// "Open Tickets" stat tile (sub-labeled "Client Submitted + In Progress"
// everywhere it appears) — duplicated here rather than imported, same
// per-file convention as everywhere else in this app. Matches Aaron's own
// HubSpot ticket report definition exactly: status is Client Submitted or
// In Progress (HubSpot's own filter additionally excludes Long-Term
// Projects/Top 3 Enhancements/Completed/Closed, which is redundant with
// the first condition — those are mutually exclusive statuses anyway).
const isFocusedQueue = (t) => t.pipelineStageLabel === 'Client Submitted' || t.pipelineStageLabel === 'In Progress';

// Buckets a ticket's owning account's client_tier the same way every other
// tier chart on this dashboard does ((a.tier == null || a.tier === 0) ->
// unset) — folded here into a fixed 5-key row shape (tier1-4 + unassigned)
// so computeOpenBacklogSeriesByTier can build one wide row per month with
// every series pre-summed, rather than a dynamic per-month key set.
const TIER_SERIES_KEYS = ['tier1', 'tier2', 'tier3', 'tier4', 'unassigned'];
const TIER_SERIES_LABELS = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3', tier4: 'Tier 4', unassigned: 'Unassigned' };

function tierSeriesKey(tier) {
  return (tier != null && tier >= 1 && tier <= 4) ? `tier${tier}` : 'unassigned';
}

/**
 * Trailing-12-months OPEN BACKLOG trend, one point per month-end — how many
 * tickets were sitting open at that point in time, not how many were newly
 * created (the Opened heatmap below covers creation volume; this is the
 * complementary "how big is the queue" signal). A ticket counts as open at
 * cutoff `d` iff createdAt <= d AND (no closedAt OR closedAt > d) — no data
 * needed beyond ticketDates (already flattened, tier-tagged, in
 * TicketActivityHeatmap below) and no periodic snapshot table required
 * since the two dates alone fully determine a ticket's state at any past
 * moment. Tallied into a `total` AND each of the 5 tier buckets per month in
 * one pass — one shared data shape for both the clean single-line view and
 * the by-tier toggle (Aaron, Sep 2026: "having a toggle to the busier,
 * trending detail could be super insightful"), and for the hover tooltip's
 * per-tier breakdown even while the clean view is showing.
 */
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
 * Trailing-12-months CLOSED ticket volume, one point per month — count of
 * tickets whose closedAt falls in that month (not cumulative, not a
 * backlog). Same closedAt-presence definition as the "Closed" heatmap
 * below, so deliberately reads the FULL `items` list rather than the
 * focused-queue subset computeOpenBacklogSeriesByTier uses — a closed
 * ticket's current pipelineStageLabel is "Closed," never "Client
 * Submitted"/"In Progress," so isFocusedQueue-filtered items would show
 * zero closures every month. Shares this file's months array-building
 * exactly so the two series line up on the same x-axis.
 */
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

/** Reads the same wide per-tier row regardless of which lines are actually plotted — the clean single-"total"-line view still gets the full tier breakdown on hover, not just the total the line itself shows. */
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

/**
 * Single line by default — back to this after a 3-line version read as too
 * busy. A toggle (Aaron, Sep 2026) switches to up to 5 lines, one per
 * Account Management Tier plus Unassigned, to see each tier's trajectory
 * independently rather than just the portfolio total — reuses
 * TIER_COST_COLOR's exact tier color language (defined further down this
 * file, safe to reference here since it's only read once this component
 * actually renders, well after module load) so "Tier 2" means the same
 * color everywhere on this dashboard. Series with zero activity across
 * all 12 months are left out of the by-tier view rather than plotted as a
 * flat line at 0. Deliberately the FOCUSED queue only (Client Submitted +
 * In Progress), not every open status — matches the "Open Tickets" stat
 * tile elsewhere on this dashboard and Aaron's own HubSpot ticket report,
 * rather than the broader "every non-internal ticket including Long-Term
 * Projects" reading the very first version of this chart used.
 */
function OpenTicketVolumeChart({ items }) {
  const [byTier, setByTier] = useState(false);
  // Independent of byTier — Aaron, Sep 2026: "toggle closed visible and not
  // visible to combine and isolate with the open tickets." Forced off
  // whenever byTier is on (its own toggle below is hidden in that state,
  // same mutual-exclusivity call OnboardingVolumeChart's closed overlay
  // already makes) — layering a closed line onto up to 5 tier lines reads
  // as noise, not signal.
  const [showClosed, setShowClosed] = useState(false);
  const closedVisible = showClosed && !byTier;
  const focusedItems = useMemo(() => items.filter(isFocusedQueue), [items]);
  const data = useMemo(() => computeOpenBacklogSeriesByTier(focusedItems), [focusedItems]);
  const closedByMonth = useMemo(() => computeClosedTicketVolumeByMonth(items), [items]);
  const combinedData = useMemo(
    () => data.map((row, i) => ({ ...row, closed: closedByMonth[i] ?? 0 })),
    [data, closedByMonth]
  );
  const tierKeysPresent = useMemo(() => TIER_SERIES_KEYS.filter((k) => data.some((d) => d[k] > 0)), [data]);
  const tierLineColors = {
    tier1: TIER_COST_COLOR['Tier 1'], tier2: TIER_COST_COLOR['Tier 2'], tier3: TIER_COST_COLOR['Tier 3'],
    tier4: TIER_COST_COLOR['Tier 4'], unassigned: TIER_COST_COLOR.Unset,
  };

  if (!items.some((t) => t.createdAt)) {
    return <p className="text-sm text-neutral-500 italic">No dated tickets to chart yet — click Refresh to pull them.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-2 gap-2">
        {!byTier && (
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
          onClick={() => setByTier((v) => !v)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            byTier ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {byTier ? '← Show Total' : 'Break Out by Tier'}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={combinedData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip content={<OpenTicketVolumeTooltip showClosed={closedVisible} />} />
          {byTier ? (
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

function TicketActivityHeatmap({ accounts }) {
  // Each ticket tagged with its own account's client_tier (Sep 2026) —
  // needed for OpenTicketVolumeChart's by-tier breakout/toggle below; the
  // heatmaps further down don't use it, only ever reading dateField.
  const items = useMemo(
    () => accounts.flatMap((a) => (a.serviceHealth?.ticketDates || []).map((t) => ({ ...t, tier: a.tier }))),
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

// Category 2.0 values that mean "enhancement/feature ask" even though
// they're not literally "Enhancement" (Sep 2026, Aaron: category_2_0 has
// grown a "FEATURE_REQUEST" option distinct from "Enhancement," plus a
// couple of malformed compound values — "Issue;Feature_Request",
// "Integration;Feature_Request" — that look like a multi-select field got
// concatenated at some point). Substring match, not an exact-value list,
// so any other "…Feature_Request" compound this portal grows later is
// caught automatically. Matches on the CATEGORY LABEL only, deliberately
// not hubspotTickets.js's own isEnhancementRequest (which also checks the
// ticket SUBJECT) — this is a display-only rollup over an already-
// aggregated byCategory total, not a per-ticket reclassification, so it
// can't reach into subject text the same way.
const isEnhancementIshCategory = (name) => /enhancement|feature_request/i.test(name);

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
  const totalTickets = data.reduce((s, d) => s + d.total, 0);
  const enhancementIshTotal = data.filter((d) => isEnhancementIshCategory(d.name)).reduce((s, d) => s + d.total, 0);
  // Same pctOf(v, total) shape as ArrByTierByAmChart/TierByArrChart's own
  // "(percentage)" labels elsewhere on this dashboard — % of THIS chart's
  // own Total (open or closed), not portfolio-wide.
  const pctOf = (v) => (totalTickets > 0 ? ` (${Math.round((v / totalTickets) * 100)}%)` : '');

  // Breaks "Total" out by pipeline STAGE (Sep 2026, Aaron) — a second,
  // orthogonal axis to the category breakdown the chart itself already
  // shows: category is WHAT the ticket is about, stage is WHERE it sits
  // in the workflow. Sourced from ticketDates (already carries
  // pipelineStageLabel per ticket, same population byCategory/data above
  // was built from — see hubspotTickets.js's getTicketSummaryForCompany),
  // filtered to this chart's own open/closed status by closedAt presence
  // so it always foots to the same Total shown above it.
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

/**
 * Same tier-bucketing as TicketsByTierChart's volume view, but as each
 * tier's SHARE of the portfolio total — ticket volume share next to ARR
 * share, side by side (Aaron, Sep 2026: "big ARR clients are not getting
 * their due % of attention as the smaller clients end up demanding a
 * disproportionate amount of attention as compared with their ARR"). Tracks
 * BOTH total (open+closed) and open-only ticket shares — a toggle in
 * TierShareCharts below picks which one plots against ARR share, since
 * Aaron specifically wanted open-only as a way to check whether CURRENT
 * (not historical) ticket load lines up with ARR: "would give a good
 * indication if the current ARR flow lined up with the Current ARR
 * volume." Tiers with zero tickets/open tickets/ARR are left out of their
 * respective chart rather than plotted as a misleading 0%.
 */
function computeTierShareData(accounts) {
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = { tier: key, tickets: 0, openTickets: 0, arrCents: 0 };
    byTier[key].tickets += (a.open_ticket_count || 0) + (a.closed_ticket_count || 0);
    byTier[key].openTickets += a.open_ticket_count || 0;
    byTier[key].arrCents += (a.arr_cents || 0);
  }
  const totalTickets = Object.values(byTier).reduce((s, d) => s + d.tickets, 0);
  const totalOpenTickets = Object.values(byTier).reduce((s, d) => s + d.openTickets, 0);
  const totalArrCents = Object.values(byTier).reduce((s, d) => s + d.arrCents, 0);
  return Object.values(byTier)
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier))
    .map((d) => ({
      ...d,
      name: d.tier === 'unset' ? 'Unset' : `Tier ${d.tier}`,
      ticketPct: totalTickets > 0 ? (d.tickets / totalTickets) * 100 : 0,
      openTicketPct: totalOpenTickets > 0 ? (d.openTickets / totalOpenTickets) * 100 : 0,
      arrPct: totalArrCents > 0 ? (d.arrCents / totalArrCents) * 100 : 0,
    }));
}

/**
 * One bar-or-pie mini chart for a single %-of-total series — shared by
 * both halves of TierShareCharts below so "Share of Ticket Volume" and
 * "Share of ARR" render identically. Colored per-tier via TIER_COST_COLOR
 * (Sep 2026, Aaron: "verify that all tier related reports are consistent
 * with 1 = green, 2 = blue, 3 = orange, 4 = red") rather than a flat color
 * per mini-chart — was red for the tickets side / green for the ARR side,
 * which distinguished the two panels from each other but meant "Tier 1"
 * wasn't the same color as every other tier chart on this dashboard.
 */
function TierShareMiniChart({ data, chartType }) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No data yet.</p>;
  }
  return chartType === 'pie' ? (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${p.value.toFixed(1)}%`)} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
        </Pie>
        <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
      </PieChart>
    </ResponsiveContainer>
  ) : (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
        <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
          {/* dataKey="pctLabel" (a pre-formatted string) rather than
              "value" + a formatter prop — matches the plain-dataKey shape
              every other LabelList in this file already uses, so this
              chart's labels stay consistent with the rest of the
              dashboard's convention. */}
          <LabelList dataKey="pctLabel" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * `ticketFilter` ('total' | 'open') swaps which ticket-share field plots
 * against ARR share — 'total' (open+closed, the original view) answers
 * "which tiers have historically consumed the most attention," 'open'
 * answers Aaron's sharper question: does what a tier owes RIGHT NOW in
 * open tickets line up with what it's worth in ARR right now. ARR itself
 * has no open/closed concept, so only the ticket side switches.
 */
function TierShareCharts({ data, chartType }) {
  const [ticketFilter, setTicketFilter] = useState('total');
  const ticketField = ticketFilter === 'open' ? 'openTickets' : 'tickets';
  const ticketPctField = ticketFilter === 'open' ? 'openTicketPct' : 'ticketPct';
  const ticketData = data.filter((d) => d[ticketField] > 0).map((d) => ({ name: d.name, value: d[ticketPctField], pctLabel: `${d[ticketPctField].toFixed(1)}%` }));
  const arrData = data.filter((d) => d.arrCents > 0).map((d) => ({ name: d.name, value: d.arrPct, pctLabel: `${d.arrPct.toFixed(1)}%` }));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h4 className="text-sm font-medium text-neutral-700">Share of Ticket Volume</h4>
          <div className="flex gap-1">
            {[{ key: 'total', label: 'Total' }, { key: 'open', label: 'Open Only' }].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setTicketFilter(opt.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  ticketFilter === opt.key ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <TierShareMiniChart data={ticketData} chartType={chartType} />
      </div>
      <div>
        <h4 className="text-sm font-medium text-neutral-700 mb-2">Share of ARR</h4>
        <TierShareMiniChart data={arrData} chartType={chartType} />
      </div>
    </div>
  );
}

// Same hue as TIER_COST_COLOR, one Tailwind step darker (both scales are
// literally Tailwind's own 600/700 shades) — used to tell Closed apart
// from Open within one tier's color family, rather than an unrelated flat
// color, so "this bar is Tier 3" reads the same regardless of open/closed
// (Sep 2026, Aaron: "recolor this red and blue graph to have tier colors
// represented in the open tickets and... darker shades of the tier colors
// representing closed tickets").
const TIER_COST_COLOR_DARK = { 'Tier 1': '#15803d', 'Tier 2': '#1d4ed8', 'Tier 3': '#c2410c', 'Tier 4': '#b91c1c', Unset: '#525252' };

/**
 * Buckets each account's already-computed open_ticket_count/
 * closed_ticket_count by client_tier (1-4, or "Unset" for 0/null) — same
 * tier field/labeling as tierStr, no new data fetch needed. A toggle (Sep
 * 2026, Aaron) switches from this absolute open/closed volume view to
 * TierShareCharts above — see that function's doc comment for the "is
 * this tier getting more attention than its ARR justifies" story it's
 * built to tell. Within "volume" mode, a second bar/pie toggle (Sep 2026,
 * Aaron: "add a pie chart toggle... one for the closed tickets... and one
 * of the open tickets ala the ARR by tier pie chart") swaps the grouped
 * bar for two side-by-side pies — Open tickets by tier, Closed tickets by
 * tier — each colored via TIER_COST_COLOR/TIER_COST_COLOR_DARK so a tier
 * means the same color whether it's a bar or a pie slice.
 */
function TicketsByTierChart({ accounts }) {
  const [mode, setMode] = useState('volume');
  const [chartType, setChartType] = useState('bar');
  const [volumeChartType, setVolumeChartType] = useState('bar');

  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = { tier: key, open: 0, closed: 0 };
    byTier[key].open += a.open_ticket_count || 0;
    byTier[key].closed += a.closed_ticket_count || 0;
  }
  const volumeData = Object.values(byTier)
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier))
    .map((d) => ({ ...d, name: d.tier === 'unset' ? 'Unset' : `Tier ${d.tier}` }));
  const openPieData = volumeData.filter((d) => d.open > 0).map((d) => ({ name: d.name, value: d.open }));
  const closedPieData = volumeData.filter((d) => d.closed > 0).map((d) => ({ name: d.name, value: d.closed }));
  // Sep 2026, Aaron: "add percentages to the labels on the pie and bar
  // graphs" — each tier's share of ITS OWN series total (Open % of all
  // open, Closed % of all closed), not of open+closed combined.
  const openTotal = volumeData.reduce((s, d) => s + d.open, 0);
  const closedTotal = volumeData.reduce((s, d) => s + d.closed, 0);
  const pctOf = (v, total) => (total > 0 ? ` (${Math.round((v / total) * 100)}%)` : '');

  const shareData = useMemo(() => computeTierShareData(accounts), [accounts]);

  if (volumeData.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <button
          onClick={() => setMode((m) => (m === 'volume' ? 'share' : 'volume'))}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            mode === 'share' ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {mode === 'volume' ? 'Show Share of Total (Tickets vs. ARR)' : '← Show Volume'}
        </button>
        {mode === 'share' && <ChartTypeToggle value={chartType} onChange={setChartType} />}
        {mode === 'volume' && <ChartTypeToggle value={volumeChartType} onChange={setVolumeChartType} />}
      </div>
      {mode === 'volume' ? (
        volumeChartType === 'pie' ? (
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
            <BarChart data={volumeData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 13 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {/* fill on the Bar itself is only a fallback (Legend swatch,
                  and any row that somehow has no matching Cell) — the
                  per-tier Cells below are what actually paint each bar. */}
              <Bar dataKey="open" name="Open" fill="#dc2626" radius={[4, 4, 0, 0]}>
                {volumeData.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
                <LabelList dataKey="open" position="top" formatter={(v) => `${v}${pctOf(v, openTotal)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
              <Bar dataKey="closed" name="Closed" fill="#2563eb" radius={[4, 4, 0, 0]}>
                {volumeData.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR_DARK[d.name] || '#525252'} />)}
                <LabelList dataKey="closed" position="top" formatter={(v) => `${v}${pctOf(v, closedTotal)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      ) : (
        <TierShareCharts data={shareData} chartType={chartType} />
      )}
    </>
  );
}

/**
 * "AM KPI" (Aaron, Sep 2026: "revamp the Capacity & Census by Tier Section
 * ... after the pattern of the KPI by AM... bring over any of the other
 * reports from the KPI by AM collection filtered for my accounts") —
 * replaces the old always-Capacity/Census chart with the same
 * metric-dropdown + Bar/Pie-toggle pattern as TeamAmDashboard.jsx's KPI by
 * AM, just grouped by Client Tier instead of Account Manager (there's only
 * one AM's worth of data on this page — this account's owner — so "by AM"
 * would be a single bar; by Tier is what's actually interesting here,
 * matching how CompaniesByTierChart/TicketsByTierChart/CostToServeByTierChart
 * already group). `capacityCensus` is a special combo entry (two series)
 * rather than a single-value METRICS row, since it's the one metric this
 * dashboard shows as a pair rather than one number.
 */
// Labels are pre-sorted alphabetically (Aaron, Sep 2026: "anchor" each
// family — ARR/Occupancy/Tickets/Deals — on a common lead word "so they
// will align alphabetically" in this dropdown) rather than sorted at
// render time — a static list reads top-to-bottom exactly as declared, and
// this way the array order IS the intended dropdown order, no separate
// .sort() to keep in sync. "Accounts"/"Communities" dropped their "Total"
// prefix entirely (Aaron: rename these "just 'Accounts'/'Communities'") —
// nothing to anchor them to, and no other metric here starts with those
// words, so alphabetizing needs no help there.
const AM_KPI_METRICS = [
  { key: 'totalAccounts', label: 'Accounts', agg: 'count', format: (v) => v },
  { key: 'arrAddedThisYearCents', label: `ARR: Added (${new Date().getFullYear()})`, field: 'arr_added_this_year_cents', agg: 'sum', format: currencyStr },
  { key: 'arrCents', label: 'ARR: Total', field: 'arr_cents', agg: 'sum', format: currencyStr },
  { key: 'avgScore', label: 'Avg Health Score', field: 'health_score', agg: 'avg', format: (v) => v },
  { key: 'totalCommunities', label: 'Communities', field: 'active_community_count', agg: 'sum', format: (v) => v },
  { key: 'openDealCount', label: 'Deals: Open', field: 'open_deal_count', agg: 'sum', format: (v) => v },
  { key: 'openDealValueCents', label: 'Deals: Open Value (ARR)', field: 'open_deal_value_cents', agg: 'sum', format: currencyStr },
  { key: 'totalCapacity', label: 'Occupancy: Capacity', field: 'total_capacity', agg: 'sum', format: (v) => v },
  { key: 'capacityCensus', label: 'Occupancy: Capacity & Census' },
  { key: 'currentCensus', label: 'Occupancy: Census', field: 'current_census', agg: 'sum', format: (v) => v },
  { key: 'closedTickets', label: 'Tickets: Closed', field: 'closed_ticket_count', agg: 'sum', format: (v) => v },
  { key: 'enhancementVsOther', label: 'Tickets: Enhancement vs. Other' },
  { key: 'openTickets', label: 'Tickets: Open', field: 'open_ticket_count', agg: 'sum', format: (v) => v },
];

/**
 * The AM KPI dropdown's two "combo" entries (rendered as a pair of series
 * instead of one) — `compute(list)` reduces one tier's accounts down to
 * `{ a, b }`. Keyed by AM_KPI_METRICS' own `key` so AmKpiChart can look one
 * up generically instead of hardcoding a branch per combo.
 */
const AM_KPI_COMBOS = {
  capacityCensus: {
    seriesALabel: 'Total Capacity',
    seriesBLabel: 'Current Census',
    compute: (list) => ({
      a: list.reduce((s, a) => s + (a.total_capacity || 0), 0),
      b: list.reduce((s, a) => s + (a.current_census || 0), 0),
    }),
    emptyMessage: 'No occupancy data yet — click Refresh to pull it.',
  },
  // "Enhancement" = tickets already tracked as Top 3 or Long-Term-Project
  // enhancement work (enhancement_top_count/enhancement_lesser_count — see
  // TopThreeEnhancementsCard.jsx/EnhancementRequestsSection.jsx); "Other"
  // is every other currently-open ticket. Answers "how much of my open
  // queue is active issue/project work vs. longer-term wait/see/advocate
  // enhancement asks" (Aaron, Sep 2026).
  enhancementVsOther: {
    seriesALabel: 'Other Open Tickets',
    seriesBLabel: 'Enhancement Tickets',
    compute: (list) => {
      const enhancement = list.reduce((s, a) => s + (a.enhancement_top_count || 0) + (a.enhancement_lesser_count || 0), 0);
      const totalOpen = list.reduce((s, a) => s + (a.open_ticket_count || 0), 0);
      return { a: Math.max(0, totalOpen - enhancement), b: enhancement };
    },
    emptyMessage: 'No ticket data yet — click Refresh to pull it.',
  },
};

// Same "exclude lifecycle_flag'd accounts from every $/score/count total"
// rule as this page's own portfolio stat tiles (see the `clean` variable
// below the accounts-loading effect) and teamAm.js's
// computeRollupByAccountManager — a stray $0-ARR non-client record
// shouldn't drag down a tier's avg health score or ARR total.
function tierGroups(accounts) {
  const clean = accounts.filter((a) => !a.lifecycle_flag);
  const byTier = {};
  for (const a of clean) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = [];
    byTier[key].push(a);
  }
  return Object.entries(byTier)
    .sort(([a], [b]) => (a === 'unset' ? 1 : b === 'unset' ? -1 : a - b))
    .map(([tier, list]) => ({ tier, name: tier === 'unset' ? 'Unset' : `Tier ${tier}`, list }));
}

function aggregateMetric(list, metric) {
  if (metric.agg === 'count') return list.length;
  if (metric.agg === 'avg') {
    const scored = list.filter((a) => a[metric.field] != null);
    return scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a[metric.field], 0) / scored.length) : null;
  }
  return list.reduce((s, a) => s + (a[metric.field] || 0), 0);
}

function AmKpiChart({ accounts, metricKey, setMetricKey, chartType, setChartType }) {
  const groups = tierGroups(accounts);
  const metricSelect = (
    <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5">
      {AM_KPI_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  );

  const combo = AM_KPI_COMBOS[metricKey];
  if (combo) {
    const data = groups
      .map((g) => {
        const { a, b } = combo.compute(g.list);
        return { name: g.name, a, b };
      })
      .filter((d) => d.a > 0 || d.b > 0);

    if (data.length === 0) {
      return (
        <>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">{metricSelect}<ChartTypeToggle value={chartType} onChange={setChartType} /></div>
          <p className="text-sm text-neutral-500 italic">{combo.emptyMessage}</p>
        </>
      );
    }

    // Each series' own share of ITS OWN total across tiers (Aaron, Sep
    // 2026: "add percentages after the quantities... gives quick insight
    // into balance or imbalance") — same "share of that series' own
    // total, not the other series'" convention as TeamAmDashboard.jsx's
    // TierByArrChart/ArrByTierByAmChart pctOf.
    const totalA = data.reduce((s, d) => s + d.a, 0);
    const totalB = data.reduce((s, d) => s + d.b, 0);
    const pctA = (v) => (totalA > 0 ? ` (${Math.round((v / totalA) * 100)}%)` : '');
    const pctB = (v) => (totalB > 0 ? ` (${Math.round((v / totalB) * 100)}%)` : '');

    return (
      <>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">{metricSelect}<ChartTypeToggle value={chartType} onChange={setChartType} /></div>
        {chartType === 'pie' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { field: 'a', label: combo.seriesALabel, colors: TIER_COST_COLOR, pct: pctA },
              { field: 'b', label: combo.seriesBLabel, colors: TIER_COST_COLOR_DARK, pct: pctB },
            ].map(({ field, label, colors, pct }) => {
              const pieData = data.filter((d) => d[field] > 0).map((d) => ({ name: d.name, value: d[field] }));
              return (
                <div key={field}>
                  <h4 className="text-sm font-medium text-neutral-700 mb-2 text-center">{label}</h4>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${p.value}${pct(p.value)}`)} isAnimationActive={false}>
                        {pieData.map((p, i) => <Cell key={i} fill={colors[p.name] || '#737373'} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v}${pct(v)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 13 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {/* fill on the Bar itself is only a fallback (Legend swatch)
                  — the per-tier Cells below are what actually paint each
                  bar. */}
              <Bar dataKey="a" name={combo.seriesALabel} fill="#2563eb" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
                <LabelList dataKey="a" position="top" formatter={(v) => `${v}${pctA(v)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
              <Bar dataKey="b" name={combo.seriesBLabel} fill="#16a34a" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR_DARK[d.name] || '#525252'} />)}
                <LabelList dataKey="b" position="top" formatter={(v) => `${v}${pctB(v)}`} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </>
    );
  }

  const metric = AM_KPI_METRICS.find((m) => m.key === metricKey);
  const data = groups.map((g) => ({ name: g.name, total: aggregateMetric(g.list, metric) })).filter((d) => d.total != null && d.total !== 0);
  const chartHeight = chartType === 'pie' ? 420 : 320;
  // Share of this metric's own grand total across tiers (Aaron, Sep 2026:
  // "add percentages here after the quantities... Total ARR too") — not
  // meaningful for an average (agg: 'avg'), so skipped there.
  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const pctOf = (v) => (metric.agg === 'avg' || grandTotal <= 0 ? '' : ` (${Math.round((v / grandTotal) * 100)}%)`);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">{metricSelect}<ChartTypeToggle value={chartType} onChange={setChartType} /></div>
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No data yet for this metric — click Refresh to pull it.</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chartType === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius="68%" label={wrappedPieLabel((p) => `${metric.format(p.total)}${pctOf(p.total)}`)} isAnimationActive={false}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
              </Pie>
              <Tooltip formatter={(v) => `${metric.format(v)}${pctOf(v)}`} />
            </PieChart>
          ) : (
            <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 13 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip formatter={(v) => `${metric.format(v)}${pctOf(v)}`} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
                <LabelList dataKey="total" position="top" formatter={(v) => `${metric.format(v)}${pctOf(v)}`} style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </>
  );
}

/** Merges several named point series (each [{recorded_date, value}]) into one row-per-date array, e.g. [{recorded_date, totalCapacity, currentCensus}] — the shape Recharts' <Line> needs to plot more than one series on a shared x-axis. */
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

// Which kpi_metric_history metric_keys back each AM_KPI_COMBOS entry's two
// lines — server/api/accountHealth.js's refresh handler is what actually
// writes these keys (see recordKpiMetricSnapshots there).
const AM_KPI_COMBO_TREND_KEYS = {
  capacityCensus: [{ key: 'totalCapacity', name: 'Total Capacity', color: '#2563eb' }, { key: 'currentCensus', name: 'Current Census', color: '#16a34a' }],
  enhancementVsOther: [{ key: 'otherOpenTickets', name: 'Other Open Tickets', color: '#2563eb' }, { key: 'enhancementTickets', name: 'Enhancement Tickets', color: '#16a34a' }],
};

/**
 * "Tracking / trending over time... put in perspective with recent
 * volumes" (Aaron, Sep 2026) — trend line(s) for whichever AM KPI metric is
 * currently selected, same "a point is captured every time you refresh"
 * pattern as HealthScoreTrendSection elsewhere on this page, just backed
 * by the new general-purpose kpi_metric_history table (see database.js)
 * instead of the health-score-only one. A brand-new metric has no
 * backfill possible, so a short/empty trail is expected here at first for
 * every metric except Avg Health Score, not an error.
 */
function AmKpiTrendSection({ metricKey }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account-health/kpi-metric-history')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || {}))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const comboTrend = AM_KPI_COMBO_TREND_KEYS[metricKey];
  const keys = comboTrend ? comboTrend.map((l) => l.key) : [metricKey];
  const merged = mergeSeries(history, keys);

  if (merged.length < 2) {
    return (
      <p className="text-sm text-neutral-500 italic">
        Not enough history yet for this metric — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
      </p>
    );
  }

  const metric = AM_KPI_METRICS.find((m) => m.key === metricKey);
  const lineDefs = comboTrend || [{ key: metricKey, name: metric.label, color: '#7c3aed' }];
  const fmt = comboTrend ? (v) => v : metric.format;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} />
        <Tooltip formatter={(v) => fmt(v)} />
        {lineDefs.length > 1 && <Legend />}
        {lineDefs.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
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

// Same TIER_ORDER/tierSort pattern as TeamAmDashboard.jsx's own copy —
// named locally (not TIER_ORDER/tierSort) since this file doesn't already
// define those, to avoid colliding with any future page-local tier-sort
// helper someone adds for a different naming convention (see
// CostToServeByTierChart's own numeric-tier sort just below, which sorts
// a different shape of data).
const ARR_TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];
function arrTierSort(a, b) {
  const ai = ARR_TIER_ORDER.indexOf(a.name);
  const bi = ARR_TIER_ORDER.indexOf(b.name);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}

const ARR_TIER_METRICS = [
  { key: 'arrAddedThisYearCents', label: `ARR: Added (${new Date().getFullYear()})`, format: currencyStr },
  { key: 'arrCents', label: 'ARR: Total', format: currencyStr },
];

/**
 * "ARR by Tier" (Sep 2026, Aaron: "just like the ARR by Tier section of
 * the Team AM board, but just filtered for my accounts") — same reusable
 * metric-dropdown + bar/pie-toggle chart as TeamAmDashboard.jsx's
 * identical-name chart, ported here scoped to this page's own owned
 * `accounts` rather than Team AM's broader set. Duplicated, not shared or
 * imported, per this file's established per-page-duplication convention
 * for these small tier charts (see CostToServeByTierChart just below) —
 * including matching Team AM's own "Unassigned" tier-bucket label exactly
 * (a deliberate one-off: CostToServeByTierChart's sibling chart on this
 * page uses "Unset" instead, but this chart is meant to be a literal port
 * of Team AM's, not a new page-local convention). Colored per-tier via
 * TIER_COST_COLOR in both bar and pie modes (Sep 2026, Aaron: "verify
 * that all tier related reports are consistent with 1 = green, 2 = blue,
 * 3 = orange, 4 = red") — was a flat green bar / rainbow-indexed pie,
 * matching Team AM's own now-fixed original.
 */
function TierByArrChart({ accounts, metricKey, setMetricKey, chartType, setChartType }) {
  const metric = ARR_TIER_METRICS.find((m) => m.key === metricKey);
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'Unassigned' : `Tier ${a.tier}`;
    const value = metricKey === 'arrAddedThisYearCents' ? (a.arr_added_this_year_cents || 0) : (a.arr_cents || 0);
    byTier[key] = (byTier[key] || 0) + value;
  }
  const data = Object.entries(byTier).map(([name, total]) => ({ name, total })).filter((d) => d.total !== 0).sort(arrTierSort);
  // Sep 2026, Aaron: "add a '(percentage)' after the dollar amount to the
  // labels... on the ARR by Tier pie graph and bar graph" — share of THIS
  // metric's own total (Total ARR or ARR Added), not portfolio ARR
  // overall, so it always reads as "this tier is X% of what's on this
  // chart right now."
  const grandTotal = data.reduce((s, d) => s + d.total, 0);
  const pctOf = (v) => (grandTotal > 0 ? ` (${Math.round((v / grandTotal) * 100)}%)` : '');

  const chartHeight = chartType === 'pie' ? 420 : Math.max(320, data.length * 56);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5">
          {ARR_TIER_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
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

const TIER_COST_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unset: '#737373', Unassigned: '#737373' };

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
  const [excludeUnassigned, setExcludeUnassigned] = useState(false);
  const byTier = {};
  for (const a of accounts) {
    const key = (a.tier == null || a.tier === 0) ? 'unset' : a.tier;
    if (!byTier[key]) byTier[key] = { tier: key, tickets: 0, arrCents: 0, accountCount: 0 };
    byTier[key].tickets += (a.open_ticket_count || 0) + (a.serviceHealth?.closedTicketCountThisYear || 0);
    byTier[key].arrCents += (a.arr_cents || 0);
    byTier[key].accountCount += 1;
  }
  const allData = Object.values(byTier)
    .filter((d) => d.arrCents > 0)
    .sort((a, b) => (a.tier === 'unset' ? 1 : b.tier === 'unset' ? -1 : a.tier - b.tier))
    .map((d) => ({
      ...d,
      name: d.tier === 'unset' ? 'Unset' : `Tier ${d.tier}`,
      ratio: (d.tickets * 100000) / d.arrCents,
    }));

  if (allData.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ARR/ticket data yet — click Refresh to pull it.</p>;
  }

  // "Hide Unassigned" (Aaron, Sep 2026) — same reasoning as
  // TeamAmDashboard.jsx's identical toggle: an Unset tier's ratio tends to
  // dwarf any real tier's, stretching the Y axis and flattening the real
  // bars. No explicit YAxis domain below, so dropping it from `data` lets
  // Recharts auto-rescale to just the real tiers.
  const hasUnassigned = allData.some((d) => d.tier === 'unset');
  const data = excludeUnassigned ? allData.filter((d) => d.tier !== 'unset') : allData;

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

/**
 * Extracts one metric's per-tier series out of the nested
 * kpi-metric-history-by-tier response ({tier: {metricKey: [{recorded_date,
 * value}]}}) into the flat {tier: [{recorded_date, value}]} shape
 * mergeSeries expects — the same shape it was already built for, just with
 * tier names standing in for metric keys, so no new merge helper is needed.
 */
function extractTierSeries(nested, metricKey) {
  return Object.fromEntries(Object.entries(nested || {}).map(([tier, byMetric]) => [tier, byMetric[metricKey] || []]));
}

/** Same tier ordering as arrTierSort, just over plain tier-name strings (e.g. Object.keys(...)) rather than {name} objects — used by the by-tier trend sections below to order their lines/legend consistently. */
function sortTierNames(names) {
  return [...names].sort((a, b) => {
    const ai = ARR_TIER_ORDER.indexOf(a);
    const bi = ARR_TIER_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

/** Shared "not enough history yet" copy — same wording as AmKpiTrendSection/DealTypeTrendSection's own empty-history message, just not metric-specific. */
const NOT_ENOUGH_TIER_HISTORY = (
  <p className="text-sm text-neutral-500 italic">
    Not enough history yet — a point is captured every time you refresh this dashboard. Check back after a couple more refreshes to see the trend.
  </p>
);

/**
 * Shared fetch-once-on-mount for the by-tier trend endpoint — same
 * loading/error handling as AmKpiTrendSection, just backed by
 * kpi-metric-history-by-tier instead of the flat portfolio one, since all
 * three tier trend subsections below (ARR by Tier, Ticket Volume by Client
 * Tier, Cost to Serve by Tier) read from the same nested response.
 */
function useTierMetricHistory() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account-health/kpi-metric-history-by-tier')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || {}))
      .catch((err) => setError(err.message));
  }, []);

  return { history, error };
}

/**
 * "ARR by Tier" trend (Sep 2026, Aaron: "tracking and trending" on this
 * section too) — one line per Client Tier for whichever ARR metric is
 * currently selected above (arrByTierMetricKey), same "a point is captured
 * every time you refresh" pattern as AmKpiTrendSection/DealTypeTrendSection
 * elsewhere on this page, backed by the new per-tier kpi_metric_history rows
 * (see accountHealth.js's /refresh handler).
 */
function ArrByTierTrendSection({ metricKey }) {
  const { history, error } = useTierMetricHistory();

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const tierSeries = extractTierSeries(history, metricKey);
  const tiersPresent = sortTierNames(Object.keys(tierSeries).filter((t) => tierSeries[t].length > 0));
  const merged = mergeSeries(tierSeries, tiersPresent);

  if (merged.length < 2) return NOT_ENOUGH_TIER_HISTORY;

  const metric = ARR_TIER_METRICS.find((m) => m.key === metricKey);

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

/**
 * "Ticket Volume by Client Tier" trend (Sep 2026, Aaron: "tracking and
 * trending" on this section too) — one line per Client Tier, with its own
 * local Open/Closed toggle (defaulting to Open) rather than reusing the
 * chart above's own state, since the volume chart above doesn't have a
 * single open/closed selection of its own to mirror.
 */
function TicketsByTierTrendSection() {
  const { history, error } = useTierMetricHistory();
  const [status, setStatus] = useState('open');

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const metricKey = status === 'open' ? 'ticketsOpenCount' : 'ticketsClosedCount';
  const tierSeries = extractTierSeries(history, metricKey);
  const tiersPresent = sortTierNames(Object.keys(tierSeries).filter((t) => tierSeries[t].length > 0));
  const merged = mergeSeries(tierSeries, tiersPresent);

  const toggle = (
    <div className="flex gap-1 mb-2">
      {['open', 'closed'].map((s) => (
        <button
          key={s}
          onClick={() => setStatus(s)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
            status === s ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );

  if (merged.length < 2) {
    return (
      <>
        {toggle}
        {NOT_ENOUGH_TIER_HISTORY}
      </>
    );
  }

  return (
    <>
      {toggle}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip />
          <Legend />
          {tiersPresent.map((t) => (
            <Line key={t} type="monotone" dataKey={t} name={t} stroke={TIER_COST_COLOR[t] || '#737373'} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

/**
 * "Cost to Serve by Tier" trend (Sep 2026, Aaron: "tracking and trending"
 * on this section too) — one line per Client Tier, single metric
 * (costToServeRatio), no picker needed since the chart above has none
 * either.
 */
function CostToServeByTierTrendSection() {
  const { history, error } = useTierMetricHistory();

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!history) return <p className="text-sm text-neutral-400">Loading trend…</p>;

  const tierSeries = extractTierSeries(history, 'costToServeRatio');
  const tiersPresent = sortTierNames(Object.keys(tierSeries).filter((t) => tierSeries[t].length > 0));
  const merged = mergeSeries(tierSeries, tiersPresent);

  if (merged.length < 2) return NOT_ENOUGH_TIER_HISTORY;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={merged} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="recorded_date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => v.toFixed(2)} />
        <Tooltip formatter={(v) => v.toFixed(2)} />
        <Legend />
        {tiersPresent.map((t) => (
          <Line key={t} type="monotone" dataKey={t} name={t} stroke={TIER_COST_COLOR[t] || '#737373'} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Same "no client_tier set" handling as every other tier chart's own "Unset" bucket. Same shape as TeamAmDashboard.jsx's identical helper, duplicated per this file's per-page convention. */
function isUnassignedTier(account) {
  return account.tier == null || account.tier === 0;
}

/**
 * Scrollable drawer of every owned account with no Client Tier set (Sep
 * 2026, Aaron: "put in an excel export and a scrolling display of the
 * unassigned accounts... this will assist in sussing out incomplete
 * data") — the "Unset" bucket on Cost to Serve by Tier just above, whose
 * ratio reads as an outlier precisely because these accounts are missing
 * the ARR/tier data that would put them in a real tier. Same
 * drawer+export shape as TeamAmDashboard.jsx's own UnassignedTierDrawer
 * (there it's hung off Ticket Volume by AM by Tier instead) — duplicated,
 * not shared, per this file's per-page convention. Sorted by company name
 * (no Account Manager grouping here — Account Health's accounts are all
 * one AM's, unlike Team AM's portfolio-wide set).
 */
function UnassignedTierDrawer({ accounts, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const sorted = useMemo(() => [...accounts].sort((a, b) => a.company_name.localeCompare(b.company_name)), [accounts]);

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
                <CompanyLink account={a}>{a.company_name}</CompanyLink>
                <span className="text-xs text-neutral-400 shrink-0">{currencyStr(a.arr_cents)} ARR</span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                {a.open_ticket_count || 0} open / {a.closed_ticket_count || 0} closed ticket(s)
              </p>
            </div>
          ))}
        </div>
      )}
    </Drawer>
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
                legible accounting") — same reasoning as
                TeamAmDashboard.jsx's identical toggle: with several deal
                types, the default inline wrapped labels collide into an
                unreadable cluster on small slices. Toggling the key drops
                the inline labels entirely in favor of the Legend (the
                Tooltip already carries the same count/% on hover). */}
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
 * trending feature" to this section) — one overall total across every
 * deal type, not a line per type (see accountHealth.js's dealsByTypeTotalArr
 * capture for why), same "a point is captured every time you refresh"
 * pattern as AmKpiTrendSection/HealthScoreTrendSection elsewhere on this
 * page, reusing that same kpi-metric-history endpoint rather than a new one.
 */
function DealTypeTrendSection() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account-health/kpi-metric-history')
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
            <button onClick={() => setEditing(true)} className="text-xs font-medium text-cool-glacier hover:underline">Edit</button>
            {currentHost && (
              <button onClick={() => saveAndRefresh(currentHost)} disabled={busy} className="text-xs font-medium text-cool-glacier hover:underline">
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

// The recurring PATTERN itself (which day, what time) — distinct from
// nextCallDate (a single upcoming occurrence) — same fixed-order-array
// sort pattern as TIER_ORDER/tierSort in EnhancementRequestsSection.jsx.
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "14:00" -> "2:00 PM" — native <input type="time"> always gives/takes 24-hour HH:MM, this is purely for display. */
function formatTime(time) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Empty-state-aware field values shared by RecurringCallCard's edit mode and the "+ Add Recurring Call" form below — a plain controlled-inputs block, no fetch/state logic of its own. */
function RecurringCallFormFields({ values, onChange }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value });
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={values.label}
        onChange={set('label')}
        placeholder="Label — e.g. 'Weekly Ops Sync' (optional, helps tell multiple calls apart)"
        className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1"
      />
      <div className="flex gap-2">
        <select value={values.cadence} onChange={set('cadence')} className="text-sm border border-neutral-200 rounded-lg px-2 py-1">
          <option value="">No cadence</option>
          {CADENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={values.nextCallDate} onChange={set('nextCallDate')} className="text-sm border border-neutral-200 rounded-lg px-2 py-1" />
      </div>
      <div className="flex gap-2">
        <select value={values.dayOfWeek} onChange={set('dayOfWeek')} className="text-sm border border-neutral-200 rounded-lg px-2 py-1">
          <option value="">No day set</option>
          {DAY_ORDER.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="time" value={values.time} onChange={set('time')} className="text-sm border border-neutral-200 rounded-lg px-2 py-1" />
      </div>
      <input
        type="url"
        value={values.calendarLink}
        onChange={set('calendarLink')}
        placeholder="Link to the recurring calendar event (optional)"
        className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1"
      />
      <input
        type="text"
        value={values.notes}
        onChange={set('notes')}
        placeholder="Notes (optional)"
        className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1"
      />
    </div>
  );
}

const BLANK_RECURRING_CALL_FIELDS = { label: '', cadence: '', nextCallDate: '', calendarLink: '', notes: '', dayOfWeek: '', time: '' };

function fieldsFromCall(call) {
  return {
    label: call?.label || '',
    cadence: call?.cadence || '',
    nextCallDate: call?.nextCallDate?.slice(0, 10) || '',
    calendarLink: call?.calendarLink || '',
    notes: call?.notes || '',
    dayOfWeek: call?.dayOfWeek || '',
    time: call?.time || '',
  };
}

/** One existing recurring call — view/edit/delete, scoped to its own id so touching one never affects any other call on the same account. */
function RecurringCallCard({ call, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(fieldsFromCall(call));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setFields(fieldsFromCall(call)); }, [call.label, call.cadence, call.nextCallDate, call.calendarLink, call.notes, call.dayOfWeek, call.time]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/account-health/recurring-calls/${call.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: fields.label || null, cadence: fields.cadence || null, nextCallDate: fields.nextCallDate || null,
          calendarLink: fields.calendarLink || null, notes: fields.notes || null, dayOfWeek: fields.dayOfWeek || null, time: fields.time || null,
        }),
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

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/account-health/recurring-calls/${call.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      await onUpdated();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 p-3 border border-neutral-200 rounded-lg">
      {editing ? (
        <div className="space-y-2">
          <RecurringCallFormFields values={fields} onChange={setFields} />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn btn-sm btn-secondary">{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setEditing(false); setFields(fieldsFromCall(call)); }} disabled={busy} className="btn btn-sm btn-secondary">Cancel</button>
            <button onClick={remove} disabled={busy} className="text-xs text-error hover:underline ml-auto">Delete</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-neutral-700">
            {call.label && <span className="font-medium">{call.label}</span>}
            {call.cadence && <span className={call.label ? 'text-neutral-500' : 'font-medium'}>{call.label ? ` · ${call.cadence}` : call.cadence}</span>}
            {call.dayOfWeek && <span className="text-neutral-500"> · {call.dayOfWeek}s{call.time ? ` at ${formatTime(call.time)}` : ''}</span>}
            {call.nextCallDate && <span className="text-neutral-500"> · next {call.nextCallDate.slice(0, 10)}</span>}
            {call.calendarLink && (
              <>
                {' · '}
                <a href={call.calendarLink} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">Open Calendar Event ↗</a>
              </>
            )}
            {call.notes && <p className="text-neutral-500 text-xs mt-1">{call.notes}</p>}
          </div>
          <button onClick={() => setEditing(true)} className="text-xs font-medium text-cool-glacier hover:underline shrink-0">Edit</button>
        </div>
      )}
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  );
}

/** Blank creation form for a brand-new recurring call on this account — same field set as RecurringCallCard's edit mode, POSTs instead of PUTs. */
function NewRecurringCallForm({ hubspotCompanyId, onUpdated, onDone }) {
  const [fields, setFields] = useState(BLANK_RECURRING_CALL_FIELDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/account-health/${hubspotCompanyId}/recurring-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: fields.label || null, cadence: fields.cadence || null, nextCallDate: fields.nextCallDate || null,
          calendarLink: fields.calendarLink || null, notes: fields.notes || null, dayOfWeek: fields.dayOfWeek || null, time: fields.time || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      await onUpdated();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 p-3 border border-dashed border-neutral-300 rounded-lg">
      <RecurringCallFormFields values={fields} onChange={setFields} />
      <div className="flex items-center gap-2 mt-2">
        <button onClick={save} disabled={busy} className="btn btn-sm btn-secondary">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onDone} disabled={busy} className="btn btn-sm btn-secondary">Cancel</button>
      </div>
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  );
}

/**
 * Manually-maintained recurring-call cadence per account (Aaron, Sep
 * 2026) — this app has no calendar API integration (no OAuth flow for
 * any calendar provider exists anywhere in this codebase, and HubSpot's
 * own static private-app token isn't a pattern that generalizes to one),
 * so cadence/next-date/notes are entered by hand here rather than synced.
 * The calendar link is just a pasted URL to the real recurring event/
 * series in whatever calendar tool is actually used — works with any
 * provider since it's a stored link, not a live API call, and clicking
 * it opens that real calendar entry directly. An account can have more
 * than one call (Sep 2026 — some genuinely do, e.g. a weekly ops sync
 * plus a separate monthly QBR-prep call) — each is its own independent
 * row/card, `label` is the one field that exists purely to tell them
 * apart when there's more than one.
 */
function RecurringCallEditor({ account, onUpdated }) {
  const calls = account.recurringCalls || [];
  const [adding, setAdding] = useState(false);

  return (
    <div className="mb-6">
      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Recurring Calls</p>
      {calls.length === 0 && !adding && <p className="text-sm italic text-neutral-400 mb-2">no recurring calls set</p>}
      {calls.map((call) => <RecurringCallCard key={call.id} call={call} onUpdated={onUpdated} />)}
      {adding ? (
        <NewRecurringCallForm hubspotCompanyId={account.hubspot_company_id} onUpdated={onUpdated} onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs font-medium text-cool-glacier hover:underline">+ Add Recurring Call</button>
      )}
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
            <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">
              Open in HubSpot
            </a>
          ) : `HubSpot company ${account.hubspot_company_id}`}
          {account.lifecycle_flag_label ? ` · ⚠️ ${account.lifecycle_flag_label}` : ''}
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
        <StatCard
          label="Account Health Score"
          value={account.health_score ?? '—'}
          sub={account.health_band || undefined}
          tooltip="Weighted blend of Service + Financial health (Relationship/Product folded in only when that data exists). Starts at 100; deducts for aged/escalated tickets, repeat issues, open ALIS Pay tickets, past-due AR balance, and DSO."
        />
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide min-h-8 flex items-center gap-1">
            Sub-scores
            <InfoIcon tooltip="Service: ticket age, escalations, repeat issues, open ALIS Pay tickets. Financial: AR aging, DSO, rate disputes, renewal timing. Relationship & Product need a manual data import this dashboard doesn't wire in on a regular refresh — expect '—' for those two until one exists." />
          </p>
          <div className="mt-1 space-y-1">
            {Object.entries(account.subScores || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-neutral-600 capitalize">{k}</span>
                <span className="font-semibold text-primary-900">{v == null ? '—' : v}</span>
              </div>
            ))}
          </div>
        </div>
        <StatCard label="Open Tickets" value={account.open_ticket_count} sub="Client Submitted + In Progress, excl. enhancements" tooltip="Client Submitted + In Progress tickets, excluding enhancement requests — those are tracked separately in the Enhancement Requests tile so total ticket volume isn't double-counted." />
        <StatCard label="Closed Tickets" value={account.closed_ticket_count} />
        <StatCard label="Open Deals" value={account.open_deal_count} sub={closedDealCount != null ? `${closedDealCount} closed (all-time)` : undefined} />
        <StatCard label="Open Deal Value" value={currencyStr(account.open_deal_value_cents)} />
        <StatCard label="ARR" value={account.arr_cents != null ? currencyStr(account.arr_cents) : '—'} />
        <StatCard label={`ARR Added to Book (${new Date().getFullYear()})`} value={currencyStr(account.arr_added_this_year_cents)} />
        <StatCard label={`ARR Personally Closed (${new Date().getFullYear()})`} value={currencyStr(account.arr_personally_closed_this_year_cents)} />
        <StatCard label="Aging Balance" value={account.aging_total_cents != null ? currencyStr(account.aging_total_cents) : '—'} />
        <StatCard label="DSO" value={account.dsoDays != null ? `${account.dsoDays}d` : '—'} sub="Rudimentary — see Portfolio DSO note" />
        <StatCard label="Total Capacity" value={numberStr(account.total_capacity)} sub={account.occupancy_as_of_date ? `As of ${account.occupancy_as_of_date}` : 'No ALIS subdomain mapped'} />
        <StatCard label="Current Census" value={numberStr(account.current_census)} sub={account.occupancy_pct != null ? `${pctStr(account.occupancy_pct)} occupied` : undefined} />
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

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Key Contacts</h3>
      {account.keyContacts?.length > 0 ? (
        <ul className="text-sm mb-3">
          {account.keyContacts.map((c) => (
            <li key={c.contactId} className="flex flex-col gap-0.5 py-1.5 border-b border-neutral-100 last:border-b-0">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium text-neutral-700">
                  {c.hubspotUrl ? (
                    <a href={c.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cool-glacier hover:underline">{c.name || 'Unnamed contact'}</a>
                  ) : (c.name || 'Unnamed contact')}
                  {c.title && <span className="text-neutral-400 font-normal"> — {c.title}</span>}
                </span>
                <span className="text-neutral-400 shrink-0 text-xs">{(c.labels || []).join(', ')}</span>
              </div>
              {(c.email || c.phone) && <p className="text-xs text-neutral-400">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>}
              {c.funFacts && <p className="text-xs text-neutral-400 italic">{c.funFacts}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-neutral-500 italic mb-3">No Key Contacts tagged for this account yet — tag contacts via HubSpot's Company↔Contact association labels.</p>}
      {account.missingKeyContactLabels?.length > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <p className="text-sm">No contact tagged as: {account.missingKeyContactLabels.join(', ')}.</p>
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
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline truncate">{t.subject}</a>
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
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline truncate">
                    {t.rank ? `#${t.rank} · ` : ''}{t.subject}
                  </a>
                  <span className="text-neutral-400 shrink-0">{t.stage}</span>
                </li>
              ))}
            </ul>
          )}
          {svc.enhancementLesserCount > 0 && (
            <div>
              <p className="text-neutral-500 mb-1">{svc.enhancementLesserCount} additional Long-Term Project(s) tracked as lesser enhancements:</p>
              <ul className="space-y-1">
                {(svc.enhancementLesserItems || []).map((t) => (
                  <li key={t.ticketId} className="flex justify-between gap-2">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:underline truncate">
                      {t.subject}
                    </a>
                    <span className="text-neutral-400 shrink-0">{t.stage}</span>
                  </li>
                ))}
              </ul>
            </div>
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
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline truncate">{d.name}</a>
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
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id, tier: a.tier });
    }
  }
  return rows;
}

function flattenArrAddedDeals(accounts) {
  const rows = [];
  for (const a of accounts) {
    for (const d of a.financialHealth?.arrAddedThisYearDeals || []) {
      rows.push({ ...d, companyName: a.company_name, hubspotCompanyId: a.hubspot_company_id, tier: a.tier });
    }
  }
  return rows;
}

/**
 * Open-deals drill-down for the "AM KPI" section's Deals: Open (count) /
 * Deals: Open Value (ARR) metrics (Aaron, Sep 2026: "give access to a
 * scrolling table of the open deals in this section... tie these numbers
 * back to actionable motions") — the tier-bucketed bar/pie above answers
 * "how much," this answers "which deals specifically," without leaving the
 * AM KPI card to go find them in the portfolio-wide All Deals section
 * further down the page. arrValueCents (not the amount-based valueCents
 * DealsSection's own table uses) is what this sums by, so its rows and
 * total actually tie back to what the chart above shows — see
 * accountHealth.js's mapLiveFinancialHealth doc comment for why those two
 * fields diverge. Deliberately its own compact table (search + sort, no
 * pipeline-chip filter/export) rather than reusing DealsSection — this one
 * lives inside an already-scrollable card and only ever shows open deals.
 */
function OpenDealsTable({ accounts }) {
  const deals = useMemo(() => flattenDeals(accounts).filter((d) => d.isOpen), [accounts]);
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

  const totalCents = filtered.reduce((s, d) => s + (d.arrValueCents || 0), 0);

  return (
    <div className="mt-6 pt-6 border-t border-neutral-100">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-medium text-neutral-700">
          Open Deals
          <span className="text-neutral-400 font-normal ml-2">
            {filtered.length} of {deals.length} — {currencyStr(totalCents)}
          </span>
        </h3>
        <input
          type="text"
          placeholder="Search accounts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
        />
      </div>
      {deals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No open deals yet — click Refresh to pull them.</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No open deals for accounts matching "{search.trim()}".</p>
      ) : (
        <div className="max-h-96 overflow-y-auto overflow-x-auto border border-neutral-100 rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-neutral-200">
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Account" column="companyName" sort={sort} onSort={toggleSort} className="pl-3 pr-4" />
                <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Deal" column="name" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Value (ARR)" column="arrValueCents" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Close Date" column="expectedCloseDate" sort={sort} onSort={toggleSort} className="pr-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={`${d.hubspotCompanyId}:${d.name}:${i}`} className="border-t border-neutral-100">
                  <td className="py-2 pl-3 pr-4 text-neutral-700">{d.companyName}</td>
                  <td className="py-2 pr-4 text-neutral-500">{tierStr(d.tier)}</td>
                  <td className="py-2 pr-4">
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{d.name}</a> : d.name}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{d.stage || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{currencyStr(d.arrValueCents)}</td>
                  <td className="py-2 pr-3 text-neutral-500">{d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Bulk-import buttons for Recurring Calls (Sep 2026) — mirrors
 * CompanyHostMappingButtons' exact UI/state pattern (download, upload-
 * with-file-input, importing state, result message), same reasoning:
 * editing one account at a time via the drawer doesn't scale to setting
 * up many accounts' call schedules at once. Tucked behind a single
 * "🔗 Update" link (Sep 2026, Aaron: "put these utility buttons behind an
 * update link") rather than sitting always-visible in the section header
 * — same tuck-it-away idea as the page-level Utilities panel, just local
 * to this one section instead of nav-bar-triggered. Export to Excel is
 * NOT behind this toggle (Sep 2026, Aaron: "pull the Export to Excel
 * button out from behind the update option") — it's a read-only action
 * with nothing to hide, unlike Download/Upload Template's bulk-edit flow.
 */
function RecurringCallsExportButtons({ accounts, onImported }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState('');

  async function handleDownloadTemplate() {
    await exportRecurringCallsTemplate(accounts);
  }

  // Every call with a pasted calendarLink gets its nextCallDate/dayOfWeek/
  // time refreshed from the live Google Calendar event/series — label,
  // cadence, and notes (hand-entered context Calendar doesn't know) are
  // left untouched. See server/api/accountHealth.js's sync-from-calendar
  // route doc comment for why calendarLink is required per-call rather
  // than this being automatic on every dashboard load (a live Calendar API
  // round-trip per call isn't something we want happening on every page view).
  async function handleSyncFromCalendar() {
    setSyncing(true);
    setSyncError('');
    setSyncResult(null);
    try {
      const res = await fetch('/api/account-health/recurring-calls/sync-from-calendar', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`);
      setSyncResult(data);
      await onImported();
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const importRows = await parseRecurringCallsTemplate(file);
      if (importRows.length === 0) throw new Error('No rows with a recurring-call field filled in were found in this file.');
      const res = await fetch('/api/account-health/recurring-calls/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importRows }),
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
    <div className="flex items-center gap-2">
      {/* Toggle itself, not a one-way reveal (Sep 2026, Aaron: "a way to
          toggle this back and hide these buttons without performing the
          update action" — clicking Update just to see what it does
          shouldn't require an actual export/import to get rid of it
          again) — always visible, label/icon flips with `open`. */}
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-sm btn-secondary">
        {open ? '✕ Hide' : '🔗 Update'}
      </button>
      <button type="button" onClick={handleSyncFromCalendar} disabled={syncing} className="btn btn-sm btn-secondary">
        {syncing ? 'Syncing…' : '📅 Sync from Calendar'}
      </button>
      {open && (
        <>
          <button onClick={handleDownloadTemplate} className="btn btn-sm btn-secondary">📋 Download Template</button>
          <label className="btn btn-sm btn-secondary cursor-pointer">
            {importing ? 'Importing…' : '📤 Upload Completed Template'}
            <input type="file" accept=".xlsx" onChange={handleUpload} disabled={importing} className="hidden" />
          </label>
        </>
      )}
      {error && <p className="text-xs text-error max-w-xs">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 max-w-xs">
          {result.imported} row(s) imported{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}
          {result.staleIdFallbackCount > 0 && (
            <>
              {' — '}
              <span className="text-warning">
                {result.staleIdFallbackCount} row(s) had a Call ID that didn't match an existing call, created as new instead
              </span>
            </>
          )}
        </p>
      )}
      {syncError && <p className="text-xs text-error max-w-xs">{syncError}</p>}
      {syncResult && (
        <p className="text-xs text-neutral-500 max-w-xs">
          {syncResult.synced} synced from Calendar
          {syncResult.skippedNoLink > 0 ? `, ${syncResult.skippedNoLink} skipped (no calendar link)` : ''}
          {syncResult.failed > 0 && (
            <>
              {' — '}
              <span className="text-warning">{syncResult.failed} failed: {syncResult.failures.map((f) => f.label || `Call #${f.id}`).join(', ')}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Every individual recurring call across the whole portfolio — hand-
 * entered per account via RecurringCallEditor in the drawer (an account
 * can have more than one, Sep 2026), or in bulk via
 * RecurringCallsExportButtons' Download/Upload Template flow. One row per
 * CALL, not per account — an account with two calls shows two rows, the
 * "Call" column (its label, or a positional "Call N" fallback) is what
 * tells them apart. Sorted by day/time by default (soonest-in-the-week
 * first, nulls last) so this reads as an actionable real schedule, not
 * just a static reference table. Row click opens that call's account in
 * the same AccountDrawer the main Accounts table uses — cadence/date/
 * link/notes are edited there, not inline in this table.
 */
// Same interval-in-days approximation for every cadence (Sep 2026, Aaron:
// "a forward looking heat map of the next 12 months as currently
// scheduled") — anchored to nextCallDate and repeated at this fixed
// interval, which keeps every projected occurrence landing on the same
// dayOfWeek the call is actually scheduled for (a real calendar-month step
// for "Monthly" can drift onto a different weekday; 4/13-week steps
// can't). "Other" has no defined interval, so it isn't repeated at all —
// just its own single nextCallDate occurrence, if any, rather than
// guessing a cadence for it.
const CADENCE_INTERVAL_DAYS = { Weekly: 7, 'Bi-Weekly': 14, Monthly: 28, Quarterly: 91 };

// Distinct color per cadence (Sep 2026, Aaron: "using a github heat map...
// is really not very enlightening -- is there something with a calendar
// that would capture the spread of weekly, bi-weekly, monthly and
// quarterly cadences") — a density heatmap answers "how many calls land
// on a day" (almost always 0 or 1 here, across just a dozen-odd accounts),
// which isn't the useful question; coloring a real calendar grid by
// CADENCE instead makes the actual rhythms visible: Weekly reads as a dot
// on the same weekday every single week, Monthly as one dot roughly every
// 4 weeks, Quarterly as one dot every ~3 months. Doesn't reuse any other
// heatmap's color on this page (blue is tickets-opened, green is
// tickets-closed, red is escalations) so this still reads as its own
// thing at a glance. Bi-Weekly/Monthly reworked (Sep 2026, Aaron: "color
// indicators... more high contrasting" — the original blue/cyan pair was
// nearly indistinguishable at dot size) into four hues spread further
// apart around the wheel (violet/blue/gold/magenta) while still avoiding
// red and green, which stay reserved for the escalation/closed-ticket
// heatmaps elsewhere on this page.
const CADENCE_COLOR = { Weekly: '#7c3aed', 'Bi-Weekly': '#2563eb', Monthly: '#ca8a04', Quarterly: '#db2777', Other: '#57534e' };
const CALENDAR_MONTHS_AHEAD = 12;

// Monday-first index of a weekday name — mirrors DAY_ORDER above, but that
// constant isn't in scope yet at this point in the file (declared further
// down alongside the recurring-call form), so this is its own local
// lookup rather than a forward reference.
const WEEKDAY_INDEX = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0 };

/** The next date (on or after `from`) that falls on `dayOfWeek` — used as a projection anchor for a call that has a day/time schedule but no explicit next-call-date picked yet. */
function nextDateForWeekday(from, dayOfWeek) {
  const targetJsDay = WEEKDAY_INDEX[dayOfWeek];
  if (targetJsDay == null) return null;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + ((targetJsDay - d.getUTCDay() + 7) % 7));
  return d;
}

/**
 * Same forward-projection logic as this feature's original
 * computeFutureCallDates (CADENCE_INTERVAL_DAYS, anchored to
 * nextCallDate), but keyed by date and carrying WHICH account/cadence
 * landed there rather than just a count — the calendar below colors each
 * day by cadence, not by occurrence density.
 */
function computeFutureCallsByDate(rows) {
  const byDate = new Map();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCMonth(horizon.getUTCMonth() + CALENDAR_MONTHS_AHEAD);

  for (const r of rows) {
    // A call with a day/time schedule but no next-call-date ever picked
    // (confirmed live, Sep 2026: both of the portfolio's Quarterly QBR
    // Sync calls are set up exactly this way) used to be dropped from this
    // calendar entirely — silently, with no indication anything was
    // excluded — since projection had nothing to anchor to. Falling back
    // to the next matching weekday from today keeps it on the calendar;
    // it's an approximation of the real anchor date, not the literal one
    // Aaron picked, so accuracy still improves once a real next-call-date
    // is set on that account's recurring call.
    const anchorSource = r.nextCallDate ? `${r.nextCallDate.slice(0, 10)}T00:00:00Z` : null;
    const first = anchorSource ? new Date(anchorSource) : (r.dayOfWeek ? nextDateForWeekday(today, r.dayOfWeek) : null);
    if (!first || Number.isNaN(first.getTime())) continue;
    const interval = CADENCE_INTERVAL_DAYS[r.cadence];
    const cadence = interval ? r.cadence : 'Other';
    const entry = { cadence, label: `${r.company_name} — ${r.callLabel}` };

    if (!interval) {
      if (first >= today && first <= horizon) {
        const iso = first.toISOString().slice(0, 10);
        if (!byDate.has(iso)) byDate.set(iso, []);
        byDate.get(iso).push(entry);
      }
      continue;
    }
    for (let d = new Date(first); d <= horizon; d = new Date(d.getTime() + interval * 86400000)) {
      if (d < today) continue;
      const iso = d.toISOString().slice(0, 10);
      if (!byDate.has(iso)) byDate.set(iso, []);
      byDate.get(iso).push(entry);
    }
  }
  return byDate;
}

/** One real-calendar month grid (Sun-Sat) — today ringed, days already past dimmed since only the future matters here, up to 3 cadence-colored dots per day. Sized for a fixed-width scroll-strip card (see RecurringCallsCalendar) rather than a squeezed grid column, so the day numbers/dots stay legible at a glance (Sep 2026, Aaron: "the big picture is just too small right now"). */
function MiniMonthCalendar({ monthStart, callsByDate, todayIso }) {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const firstWeekday = monthStart.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  return (
    <div className="border border-neutral-200 rounded-lg p-4 h-full">
      <p className="text-sm font-semibold text-neutral-700 mb-3">
        {monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
      </p>
      <div className="grid grid-cols-7 gap-y-1.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="text-[11px] text-neutral-400 font-medium">{d}</span>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = iso === todayIso;
          const isPast = iso < todayIso;
          const calls = callsByDate.get(iso) || [];
          const cadences = [...new Set(calls.map((c) => c.cadence))];
          return (
            <div
              key={i}
              title={calls.length > 0 ? calls.map((c) => `${c.label} (${c.cadence})`).join('\n') : undefined}
              className={`relative aspect-square flex flex-col items-center justify-center rounded ${isToday ? 'ring-2 ring-accent-500' : ''} ${isPast ? 'opacity-30' : ''}`}
            >
              <span className="text-xs text-neutral-500 leading-none">{day}</span>
              {cadences.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {cadences.slice(0, 3).map((c) => (
                    <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: CADENCE_COLOR[c] }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Forward-looking 12-month CALENDAR of scheduled calls (Sep 2026, Aaron:
 * replacing the density heatmap above — see CADENCE_COLOR's doc comment
 * for why). One real mini month-grid per month, each day dotted by
 * cadence rather than shaded by count, so the different rhythms (Weekly/
 * Bi-Weekly/Monthly/Quarterly) are visually distinguishable at a glance
 * instead of collapsing into an undifferentiated "some activity here"
 * heat blob. Horizontally-scrolling strip rather than a wrapping grid
 * (Sep 2026, Aaron: "scrolling into the future... each month can be
 * bigger, the big picture is just too small right now") — a fixed 2/3/4-
 * per-row grid forced 12 months into whatever the viewport happened to
 * fit, capping how large any one month could get; a scroll strip instead
 * gives every month a fixed, roomy width and lets width grow independent
 * of how many months there are.
 */
function RecurringCallsCalendar({ rows }) {
  const { months, callsByDate, hasAny, todayIso } = useMemo(() => {
    const callsByDate = computeFutureCallsByDate(rows);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const months = Array.from({ length: CALENDAR_MONTHS_AHEAD }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1)));
    return { months, callsByDate, hasAny: callsByDate.size > 0, todayIso: today.toISOString().slice(0, 10) };
  }, [rows]);

  if (!hasAny) {
    return <p className="text-sm text-neutral-500 italic">No upcoming calls to map yet — set a cadence and next call date from an account's drawer.</p>;
  }

  const usedCadences = new Set();
  for (const calls of callsByDate.values()) for (const c of calls) usedCadences.add(c.cadence);

  return (
    <div>
      <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth">
        {months.map((m) => (
          <div key={m.toISOString()} className="shrink-0 snap-start w-[85vw] max-w-[22rem] sm:w-80">
            <MiniMonthCalendar monthStart={m} callsByDate={callsByDate} todayIso={todayIso} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-neutral-500 flex-wrap">
        {Object.entries(CADENCE_COLOR).filter(([c]) => usedCadences.has(c)).map(([cadence, color]) => (
          <span key={cadence} className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {cadence}
          </span>
        ))}
      </div>
    </div>
  );
}

function flattenRecurringCalls(accounts) {
  const rows = [];
  for (const a of accounts) {
    (a.recurringCalls || []).forEach((call, i) => {
      rows.push({
        ...call,
        callLabel: call.label || `Call ${i + 1}`,
        company_name: a.company_name,
        hubspot_company_id: a.hubspot_company_id,
        account: a,
      });
    });
  }
  return rows;
}

function RecurringCallsSection({ accounts, onSelect, onImported }) {
  const rows = useMemo(() => flattenRecurringCalls(accounts), [accounts]);
  const [search, setSearch] = useState('');
  // Defaults to the actual weekly schedule (day, then time) — the "unified
  // list" Aaron asked for, rolling every account's own recurring-call
  // pattern into one real Monday-through-Sunday view — rather than
  // nextCallDate, which only says which one happens to be soonest.
  const [sort, setSort] = useState({ column: 'schedule', direction: 'asc' });

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.company_name?.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (column === 'schedule') {
        const aDay = DAY_ORDER.indexOf(a.dayOfWeek);
        const bDay = DAY_ORDER.indexOf(b.dayOfWeek);
        if (aDay === -1 && bDay === -1) return 0;
        if (aDay === -1) return 1;
        if (bDay === -1) return -1;
        if (aDay !== bDay) return (aDay - bDay) * dir;
        return (a.time || '').localeCompare(b.time || '') * dir;
      }
      const av = column === 'company_name' ? a.company_name : a[column];
      const bv = column === 'company_name' ? b.company_name : b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filtered, sort]);

  return (
    <SectionCard
      title="Recurring Calls"
      description={
        search.trim()
          ? `${filtered.length} of ${rows.length} call(s) shown, matching "${search.trim()}"`
          : `${rows.length} call(s) tracked across ${new Set(rows.map((r) => r.hubspot_company_id)).size} account(s) — edit from an account's drawer, or set/update many at once below`
      }
      defaultExpanded={false}
      action={
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
          />
          <button onClick={() => exportRecurringCallsExcel(rows)} disabled={rows.length === 0} className="btn btn-sm btn-secondary">⬇ Export to Excel</button>
          <RecurringCallsExportButtons accounts={accounts} onImported={onImported} />
        </div>
      }
    >
      {rows.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-neutral-700 mb-2">Scheduled Calls <span className="font-normal text-neutral-400">(next 12 months — scroll to see more →)</span></h3>
          <RecurringCallsCalendar rows={filtered} />
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No recurring calls tracked yet — open an account in the table below and set one from its drawer.</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic py-4">No recurring calls for accounts matching "{search.trim()}".</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Account" column="company_name" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Call" column="callLabel" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Cadence" column="cadence" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Day / Time" column="schedule" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Next Call" column="nextCallDate" sort={sort} onSort={toggleSort} className="pr-4" />
                <th className="pb-2 pr-4">Calendar</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50" onClick={() => onSelect(r.account)}>
                  <td className="py-2 pr-4 font-medium text-neutral-700">{r.company_name}</td>
                  <td className="py-2 pr-4 text-neutral-500">{r.callLabel}</td>
                  <td className="py-2 pr-4 text-neutral-500">{r.cadence || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">
                    {r.dayOfWeek ? `${r.dayOfWeek.slice(0, 3)}${r.time ? ` · ${formatTime(r.time)}` : ''}` : '—'}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{r.nextCallDate ? r.nextCallDate.slice(0, 10) : '—'}</td>
                  <td className="py-2 pr-4">
                    {r.calendarLink ? (
                      <a
                        href={r.calendarLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-cool-glacier hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="py-2 text-neutral-500 truncate max-w-xs">{r.notes || '—'}</td>
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
      await exportArrAddedDeals(sorted);
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
    return q ? base.filter((d) => d.companyName?.toLowerCase().includes(q)) : base;
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
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
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
 * Every labeled Key Contact, portfolio-wide — one row per (contact,
 * account) pair, rolling up HubSpot's Company<->Contact association
 * labels (Sep 2026 — see hubspotContacts.js's doc comment for the
 * labeled-associations mechanism this reflects, straight from the ALIS
 * Help Desk's General SOP article's role matrix) into one browsable,
 * exportable table. Same search+sort shape as ArrAddedDealsSection above,
 * plus its own dedicated Export to Excel button (matching
 * RecurringCallsSection's precedent) since email/phone are worth having
 * in the export without cluttering this on-screen table with them.
 */
function KeyContactsSection({ accounts, onSelect }) {
  const rows = useMemo(() => flattenKeyContacts(accounts), [accounts]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'companyName', direction: 'asc' });

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.companyName?.toLowerCase().includes(q)
      || r.name?.toLowerCase().includes(q)
      || (r.labels || []).some((l) => l.toLowerCase().includes(q)));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = column === 'labels' ? (a.labels || []).join(', ') : a[column];
      const bv = column === 'labels' ? (b.labels || []).join(', ') : b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filtered, sort]);

  const missingCount = accounts.filter((a) => a.missingKeyContactLabels?.length > 0).length;

  return (
    <SectionCard
      title="Key Contacts"
      description={`${rows.length} labeled contact(s) across ${new Set(rows.map((r) => r.companyName)).size} account(s)${missingCount > 0 ? ` — ${missingCount} account(s) missing at least one tagged role` : ''}`}
      defaultExpanded={false}
      action={
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search name, company, label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
          />
          <button onClick={() => exportKeyContactsExcel(rows)} disabled={rows.length === 0} className="btn btn-sm btn-secondary">⬇ Export to Excel</button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          No Key Contacts tagged yet — tag contacts via HubSpot's Company↔Contact association labels (see the ALIS Help Desk's General SOP article for the role definitions).
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-neutral-500 italic py-4">No Key Contacts match "{search.trim()}".</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Name" column="name" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Title" column="title" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Label(s)" column="labels" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Fun Facts" column="funFacts" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Notes" column="notes" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Last Activity" column="lastActivityDate" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={`${c.hubspotCompanyId}:${c.contactId}`}
                  className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                  onClick={() => onSelect(c.account)}
                >
                  <td className="py-2 pr-4 font-medium text-neutral-700">
                    {c.hubspotUrl ? (
                      <a href={c.hubspotUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-cool-glacier hover:underline">
                        {c.name || 'Unnamed contact'}
                      </a>
                    ) : (c.name || 'Unnamed contact')}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{c.title || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{c.companyName}</td>
                  <td className="py-2 pr-4 text-neutral-500">{c.tier ? `Tier ${c.tier}` : '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{(c.labels || []).join(', ') || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 truncate max-w-xs">{c.funFacts || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 truncate max-w-xs">{c.notes || '—'}</td>
                  <td className="py-2 text-neutral-500 whitespace-nowrap">{c.lastActivityDate ? c.lastActivityDate.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// Implementation/onboarding-project tracking (Sep 2026, Aaron) — HubSpot's
// "Implementation" card on a company record is actually backed by a
// handful of custom DEAL properties, not company properties (confirmed
// live against a real deal, Viva Senior Living at South Bend) — see
// hubspotTickets.js's DEAL_PROPERTIES doc comment for the full field
// mapping. Merged specifically showed up live as several sibling deals
// from the same community-add batch all flipping to it together once one
// of them absorbed the real tracking — it reads as "superseded
// elsewhere," not "still in flight," same as Completed/Cancelled, so all
// three count as terminal here per Aaron's own framing ("if no project
// status then we do not have to track" — Merged still HAS a status, but
// isn't a live one).
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

// Sort weight for open projects — Red (most concerning) first, then Amber,
// then Green/unset, matching the same "worst first" convention AtRiskDrawer
// already uses for health score.
const RAG_SORT_WEIGHT = { red: 0, amber: 1, green: 2 };

/**
 * Trailing-12-months volume of implementation-tracked deals, by creation
 * month — deliberately NOT a true "open backlog over time" reconstruction
 * the way OpenTicketVolumeChart builds one for tickets. HubSpot only
 * exposes project_status's CURRENT value, not a history of when each
 * project actually transitioned between statuses (a ticket's
 * createdAt/closedAt pair are real point-in-time facts; an implementation
 * deal's own closedate is a SALES close date that has nothing to do with
 * when the onboarding project itself finished — confirmed live: Viva's
 * "South Bend" deal closed-won just 17 days after creation but didn't
 * show 100%/Completed until sometime later, unknowable from a single
 * snapshot read). Creation-date volume is the closest honest trend
 * available without adding a new periodic-snapshot table to accumulate
 * real open/closed history going forward — reuses TIER_SERIES_KEYS/
 * TIER_SERIES_LABELS/tierSeriesKey from the Ticket Activity chart above
 * for the exact same by-tier toggle shape.
 *
 * `cumulative` (Sep 2026, Aaron: "why is my Total Open Projects showing
 * as 0 on the graph and 3 in the KPI 'Open Projects' above") — a flat
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

  const running = { total: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unassigned: 0 };
  if (cumulative) {
    for (const p of items) {
      if (!p.createdAt || new Date(p.createdAt) >= months[0]) continue;
      running.total += 1;
      running[tierSeriesKey(p.tier)] += 1;
    }
  }

  return months.map((monthStart) => {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const counts = { total: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unassigned: 0 };
    for (const p of items) {
      if (!p.createdAt) continue;
      const d = new Date(p.createdAt);
      if (d < monthStart || d > monthEnd) continue;
      counts.total += 1;
      counts[tierSeriesKey(p.tier)] += 1;
    }
    if (!cumulative) return { label, ...counts };
    for (const k of Object.keys(counts)) running[k] += counts[k];
    return { label, ...running };
  });
}

function ProjectVolumeTooltip({ active, payload, label, verb, showClosed }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const breakdown = TIER_SERIES_KEYS.filter((k) => d[k] > 0);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}: {d.total} {verb}</p>
      {showClosed && <p className="text-neutral-600">{d.closed} closed this month</p>}
      {showClosed && <p className="text-neutral-600">{d.closedTotal} closed to date</p>}
      {breakdown.length > 0
        ? breakdown.map((k) => <p key={k} className="text-neutral-600">{TIER_SERIES_LABELS[k]}: {d[k]}</p>)
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
  const tierKeysPresent = useMemo(() => TIER_SERIES_KEYS.filter((k) => data.some((d) => d[k] > 0)), [data]);
  const tierLineColors = {
    tier1: TIER_COST_COLOR['Tier 1'], tier2: TIER_COST_COLOR['Tier 2'], tier3: TIER_COST_COLOR['Tier 3'],
    tier4: TIER_COST_COLOR['Tier 4'], unassigned: TIER_COST_COLOR.Unset,
  };

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
            <Tooltip content={<ProjectVolumeTooltip verb={activeMetric.verb} showClosed={showClosedOverlay} />} />
            {byTier ? (
              <>
                <Legend />
                {tierKeysPresent.map((k) => (
                  <Line key={k} type="monotone" dataKey={k} name={TIER_SERIES_LABELS[k]} stroke={tierLineColors[k]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
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
 * "Health Score Trend" (Sep 2026, Aaron: "capture the progress of this
 * kpi over time... I plan on improving my average 85 and want to capture
 * the effort and result") — portfolio Avg Health Score, one point per day
 * this dashboard's Refresh has run. A brand-new metric with no backfill
 * possible, so a short/empty trail is expected here at first, not an
 * error — see the "not enough history" fallback below.
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

/**
 * "Health Score by Tier" (Sep 2026, Aaron: "add the Account health by tier
 * graph in addition to the health score trend") — avg Health Score per
 * Client Tier, portfolio-wide (Aaron's own accounts). Reuses the same
 * tierGroups/aggregateMetric helpers the AM KPI section's "Avg Health
 * Score" metric already computes with, just surfaced as its own always-
 * visible bar chart next to the Trend line — the Trend only shows the
 * portfolio-wide average moving over time, not which tier is currently
 * dragging it down or holding it up.
 */
function HealthScoreByTierChart({ accounts }) {
  const groups = tierGroups(accounts);
  const avgScoreMetric = AM_KPI_METRICS.find((m) => m.key === 'avgScore');
  const data = groups
    .map((g) => ({ name: g.name, score: aggregateMetric(g.list, avgScoreMetric) }))
    .filter((d) => d.score != null);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No scored accounts yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => [`${v}`, 'Avg Health Score']} />
        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COST_COLOR[d.name] || '#737373'} />)}
          <LabelList dataKey="score" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function HealthScoreTrendSection() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account-health/health-score-history')
      .then((r) => r.json())
      .then((data) => setHistory(data.history || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <SectionCard title="Health Score Trend" description="Portfolio average Health Score, captured on every refresh" defaultExpanded={false}>
      {error ? <p className="text-sm text-error">{error}</p> : <HealthScoreHistoryChart history={history} />}
    </SectionCard>
  );
}

/**
 * "Onboarding" section (Sep 2026, Aaron) — every implementation-tracked
 * deal across your portfolio (this page is already scoped to accounts you
 * own, so no separate "my accounts" filter is needed here). Open projects
 * sorted worst-first (Red RAG, then Amber, then Green/unset, then soonest
 * Projected Go-Live), terminal ones (Completed/Cancelled/Merged) pushed
 * below, most-recently-created first. One Home Office can have several of
 * these at once (one per community/batch added — confirmed live: Viva
 * Senior Living alone had 5+), so this lists every project individually
 * rather than collapsing to one status per account.
 */
function ImplementationProjectsSection({ accounts }) {
  const [sort, setSort] = useState(null);
  // Company filter (Sep 2026, Aaron) — same pattern as
  // CommunityRevenueSection.jsx's own company dropdown: options come from
  // the unfiltered project list so every company stays selectable
  // regardless of the current selection.
  const [companyFilter, setCompanyFilter] = useState('');
  // Default ON (Sep 2026, Aaron: "it would really clean up the table") —
  // completed/cancelled/merged projects are greyed-out noise most of the
  // time, but still worth pulling up for reference/proof of completion,
  // so this hides rather than drops them entirely.
  const [hideClosed, setHideClosed] = useState(true);

  const allProjects = useMemo(
    () => accounts.flatMap((a) => (a.financialHealth?.implementationProjects || []).map((p) => ({
      ...p, tier: a.tier, companyName: a.company_name, companyHubspotUrl: a.hubspotUrl,
    }))),
    [accounts]
  );
  const companyOptions = useMemo(
    () => Array.from(new Set(allProjects.map((p) => p.companyName))).sort((a, b) => a.localeCompare(b)),
    [allProjects]
  );
  const projects = useMemo(
    () => (companyFilter ? allProjects.filter((p) => p.companyName === companyFilter) : allProjects),
    [allProjects, companyFilter]
  );
  const openProjects = useMemo(() => projects.filter(isOpenProject), [projects]);
  const avgDaysOpen = openProjects.length > 0
    ? Math.round(openProjects.reduce((s, p) => s + (daysSince(p.createdAt) || 0), 0) / openProjects.length)
    : null;

  const tierCounts = TIER_SERIES_KEYS
    .map((k) => ({ key: k, label: TIER_SERIES_LABELS[k], count: openProjects.filter((p) => tierSeriesKey(p.tier) === k).length }))
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
    // Default "what needs attention" ordering — see this function's doc comment.
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
      {companyOptions.length > 1 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-neutral-500">Company:</span>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="text-sm border border-neutral-300 rounded px-2 py-1"
          >
            <option value="">All companies</option>
            {companyOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}

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

/**
 * Portfolio-wide Deals view — every account's open + recently-closed (90
 * day) deals in one flat, filterable/sortable table, so deals that "lurch
 * and progress at strange cadences" can be reviewed and queued up without
 * clicking into each account one at a time. Tasks fetched per-deal server
 * side (see accountHealth.js's mapLiveFinancialHealth) — `tasks: null`
 * (vs. `[]`) means the fetch itself failed for that one deal, shown as
 * "unavailable" rather than a false "no open tasks."
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
      await exportAllDeals(filtered);
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
    if (q) base = base.filter((d) => d.companyName?.toLowerCase().includes(q));
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
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-56"
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
                          <td colSpan={9} className="py-2 px-4">
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

export default function AccountHealthDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [companyHosts, setCompanyHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const [companiesByTierChartType, setCompaniesByTierChartType] = useState('bar');
  const [arrByTierMetricKey, setArrByTierMetricKey] = useState('arrCents');
  const [arrByTierChartType, setArrByTierChartType] = useState('bar');
  const [unassignedTierOpen, setUnassignedTierOpen] = useState(false);
  // Single-select Tier filter pills on the Accounts table (Aaron, Sep 2026:
  // "add the filter buttons to the account table a la the filter buttons
  // on the All Deals table") — same pill pattern as AllDealsSection's
  // pipeline-category filter, just keyed by tier instead of deal category.
  const [tierFilter, setTierFilter] = useState(null);
  const [amKpiMetricKey, setAmKpiMetricKey] = useState('capacityCensus');
  const [amKpiChartType, setAmKpiChartType] = useState('bar');
  const [dealTypeChartType, setDealTypeChartType] = useState('bar');

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

  // Tier-filtered set the pills work from, and what their own live counts
  // are computed against — search-filtered but not yet tier-filtered, same
  // "counts reflect current search" behavior as alis-product-ops's
  // TierFilterPills.
  const searchFilteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? accounts.filter((a) => a.company_name?.toLowerCase().includes(q)) : accounts;
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
      if (av == null) return 1; // nulls always last, regardless of direction
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [searchFilteredAccounts, tierFilter, sort]);

  const unassignedTierAccounts = useMemo(() => accounts.filter(isUnassignedTier), [accounts]);

  const rollup = useMemo(() => {
    // lifecycle_flag'd accounts (a Home Office whose own HubSpot lifecycle
    // stage isn't "Client - Home Office" — Lead/Canceled/Client-Community/
    // no-stage/other — see server/services/hubspotAccounts.js's
    // getLifecycleDataQualityFlag) stay in `accounts` so the Accounts table
    // below still shows them — Aaron explicitly didn't want this "too
    // stringent" (Sep 2026): "we'd still want some visibility of these
    // marginal accounts" — but are left out of every sum here so a stray
    // $0-ARR non-client record can't drag down the portfolio's avg health
    // score, ARR total, or DSO. Replaces the earlier "lead"-only banner
    // this rollup used to compute (see git history) with the full
    // lifecycle-flag breakdown below.
    const clean = accounts.filter((a) => !a.lifecycle_flag);
    const scored = clean.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;

    // Weighted, not a simple average-of-averages, so a handful of small
    // accounts with an odd balance/ARR ratio can't swing the portfolio
    // figure — same reasoning as summing dollars before dividing anywhere
    // else in this rollup. Still a rudimentary DSO (see
    // accountHealthScoring.js's computeDsoDays doc comment) — labeled as
    // such wherever it's shown.
    const dsoEligible = clean.filter((a) => a.aging_total_cents != null && a.arr_cents);
    const dsoAgingTotal = dsoEligible.reduce((s, a) => s + a.aging_total_cents, 0);
    const dsoArrTotal = dsoEligible.reduce((s, a) => s + a.arr_cents, 0);
    const portfolioDsoDays = dsoArrTotal > 0 ? Math.round(dsoAgingTotal / (dsoArrTotal / 365)) : null;

    // Only accounts with a known ALIS subdomain carry occupancy data (see
    // CompanyHostMappingButtons) — everyone else is left out of these
    // sums entirely rather than silently counted as 0 capacity.
    const occupancyEligible = clean.filter((a) => a.total_capacity != null);
    const totalCapacity = occupancyEligible.reduce((s, a) => s + a.total_capacity, 0);
    const currentCensus = occupancyEligible.reduce((s, a) => s + (a.current_census || 0), 0);
    const occupancyAsOfDate = accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null;

    return {
      totalAccounts: accounts.length,
      flaggedAccountCount: accounts.length - clean.length,
      totalCommunities: clean.reduce((s, a) => s + (a.active_community_count || 0), 0),
      recurringCallCount: clean.reduce((s, a) => s + (a.recurringCalls?.length || 0), 0),
      openTickets: clean.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: clean.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      enhancementTop: clean.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
      enhancementLesser: clean.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
      otherOpen: clean.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
      escalationCount: clean.reduce((s, a) => s + (a.alis_escalation_open_count || 0), 0),
      openDeals: clean.reduce((s, a) => s + (a.open_deal_count || 0), 0),
      openDealValueCents: clean.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
      arrCents: clean.reduce((s, a) => s + (a.arr_cents || 0), 0),
      // "Added to Book" (workload — ARR added on accounts you currently
      // own, regardless of who closed the deal) vs. "Personally Closed"
      // (productivity/growth — ARR from deals you actually closed, Sep
      // 2026, Aaron) — see server/api/accountHealth.js's /refresh handler
      // for how the latter is computed and stored per account.
      arrAddedThisYearCents: clean.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      arrPersonallyClosedThisYearCents: clean.reduce((s, a) => s + (a.arr_personally_closed_this_year_cents || 0), 0),
      agingTotalCents: clean.reduce((s, a) => s + (a.aging_total_cents || 0), 0),
      pastDue61PlusCents: clean.reduce((s, a) => s + (a.aging_past_due_61_plus_cents || 0), 0),
      // Newest, not first-found — accounts missing from the latest report keep an older date. MM/DD/YYYY → compare year, then MM/DD.
      agingAsOfDate: accounts.reduce((latest, a) => {
        const d = a.aging_as_of_date;
        return d && (!latest || d.slice(6) + d.slice(0, 5) > latest.slice(6) + latest.slice(0, 5)) ? d : latest;
      }, null),
      // Every account gets the same refreshed_at within one /refresh run
      // (set from a single `new Date()` server-side, not per-account) —
      // first non-null found is as good as a MAX() here, same shorthand
      // agingAsOfDate/occupancyAsOfDate already use.
      lastHubspotRefreshAt: accounts.find((a) => a.refreshed_at)?.refreshed_at || null,
      portfolioDsoDays,
      totalCapacity,
      currentCensus,
      occupancyPct: totalCapacity > 0 ? currentCensus / totalCapacity : null,
      occupancyAccountCount: occupancyEligible.length,
      occupancyAsOfDate,
      avgScore,
    };
  }, [accounts]);

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
              Account Health
            </h1>
            <p className="text-sm text-neutral-500 mt-2">
              {rollup.totalAccounts} HubSpot accounts you own
              {refreshResult && ` · last refresh: ${refreshResult.companyCount} accounts, ${refreshResult.errorCount} error(s)`}
            </p>
            <p className="text-xs font-medium text-cool-glacier mt-1">
              Proactive health · portfolio financials · data you can trust
            </p>
            {refreshResult?.excludedInactiveCommunities?.length > 0 && (
              <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                {refreshResult.excludedInactiveCommunities.length} Home Office(s) excluded — no active ALIS community
                <InfoIcon tooltip={`Excluded (no active ALIS community): ${refreshResult.excludedInactiveCommunities.map((c) => c.name).join(', ')}`} />
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {/* Shares the same `search` state as the Accounts SectionCard's
                own search box below (Sep 2026) — typing here doesn't move
                the page (so it doesn't scroll itself out from under the
                cursor while typing), Enter/the button dispatches
                JUMP_EVENT to expand-and-scroll to that table, already
                pre-filtered. */}
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
            {/* Utilities toggle moved here from the main nav bar (Sep
                2026, Aaron: "tucking it tidily under the newly named
                Accounts button") — same UTILITIES_TOGGLE_EVENT UtilityPanel
                already listens for, just dispatched from this page instead
                of App.jsx now that nothing outside this page needs it. No
                icon (Sep 2026, Aaron: "remove the utilities icon... so it
                can be the same size as the accounts button") so the two
                buttons' labels are both a single plain word. */}
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

      {/* Export/import/refresh actions — a side Drawer (Sep 2026, Aaron:
          "open a side panel with the utility button options"), toggled
          from the "🛠️ Utilities" button right under "Accounts" above
          (moved off the main nav bar, Sep 2026 — it's only ever
          meaningful on this one page). */}
      <UtilityPanel>
        <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <ExportButtons
            onExcel={() => exportAccountHealthPortfolioExcel(accounts, rollup)}
            onPdf={() => downloadPdf('/api/account-health/export-pdf', 'Account-Health-Portfolio.pdf')}
          />
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
        <div className="flex items-start gap-4 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
          <div>
            <RefreshOccupancyButton onRefreshed={load} />
            <p className="text-[11px] text-neutral-400 mt-1">
              {rollup.occupancyAsOfDate ? `Last updated: as of ${rollup.occupancyAsOfDate}` : 'Last updated: never'}
            </p>
          </div>
          <div>
            <RefreshButton onRefreshed={handleRefreshed} />
            <p className="text-[11px] text-neutral-400 mt-1">
              {rollup.lastHubspotRefreshAt ? `Last updated: ${dateTimeStr(rollup.lastHubspotRefreshAt)}` : 'Last updated: never'}
            </p>
          </div>
        </div>
      </UtilityPanel>

      {error && <div className="alert alert-error mb-6"><span>⚠️</span><p className="text-sm">{error}</p></div>}

      {rollup.flaggedAccountCount > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <p className="text-sm">
            {rollup.flaggedAccountCount} of these accounts aren't an active "Client - Home Office" record in HubSpot
            — a pure Lead or Canceled record is dropped from this dashboard entirely unless it still carries an aging
            balance (kept so someone keeps chasing the money owed); Client - Community and no-lifecycle-stage-set
            accounts stay visible below either way (amber badge next to the name), since those look more like a
            HubSpot data-entry gap than a real non-client. Either way, flagged accounts are excluded from every
            total/average on this page so they can't skew ARR or health score.
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
          <SectionCard title="Account & Operations Overview">
            <QuickJumpNav sections={OVERVIEW_SECTIONS} />
          </SectionCard>

          {/* Four labeled acts instead of one flat 18-tile grid — see
              StatGroup's doc comment for the story each one is carrying. */}
          <StatGroup title="Portfolio Health — proactive, not reactive">
            <StatCard label="Total Accounts" value={rollup.totalAccounts} jumpTo="accounts" jumpLabel="Jump to table ↓" />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} jumpTo="health-score-trend" jumpLabel="Jump to trend ↓" />
            <StatCard
              label="Recurring Calls Tracked"
              value={rollup.recurringCallCount}
              jumpTo="recurring-calls"
              jumpLabel="Jump to table ↓"
            />
            <TopThreeEnhancementsCard accounts={accounts} />
          </StatGroup>

          <StatGroup title="Financial & Occupancy — the whole portfolio, already assembled" columns={5}>
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} />
            <StatCard
              label={`ARR Added to Book (${new Date().getFullYear()})`}
              value={currencyStr(rollup.arrAddedThisYearCents)}
              tooltip="ARR added this year on accounts you currently own — counts whether you personally closed the deal or inherited it (a handoff, a manager assist). A workload signal: this is what's actually landed in your book."
              jumpTo="arr-added-this-year"
              jumpLabel="Jump to deals ↓"
            />
            <StatCard
              label={`ARR Personally Closed (${new Date().getFullYear()})`}
              value={currencyStr(rollup.arrPersonallyClosedThisYearCents)}
              tooltip="ARR added this year from deals you actually closed yourself, on any account — a productivity/growth signal, distinct from ARR Added to Book (which counts inherited deals too)."
            />
            <StatCard
              label={`Total Capacity${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`}
              value={rollup.occupancyAccountCount > 0 ? numberStr(rollup.totalCapacity) : '—'}
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
              value={rollup.occupancyAccountCount > 0 ? numberStr(rollup.currentCensus) : '—'}
              sub={rollup.occupancyPct != null ? `${pctStr(rollup.occupancyPct)} occupied` : undefined}
            />
            <StatCard
              label="Open Deals & Value"
              value={rollup.openDeals}
              secondaryValue={currencyStr(rollup.openDealValueCents)}
              tooltip="Value shown is ARR (arr_value — capacity × negotiated rate × 12), not a deal's raw amount field, same convention as ARR Added and Deals by Type."
              jumpTo="all-deals"
              jumpLabel="Jump to deals ↓"
            />
          </StatGroup>

          <StatGroup title="Data You Can Trust — current, sourced, and dated">
            <StatCard
              label={`Aging Balance${rollup.agingAsOfDate ? ` (as of ${rollup.agingAsOfDate})` : ''}`}
              value={rollup.agingAsOfDate ? currencyStr(rollup.agingTotalCents) : '—'}
            />
            <StatCard
              label="Portfolio DSO"
              value={rollup.portfolioDsoDays != null ? `${rollup.portfolioDsoDays}d` : '—'}
              tooltip="Rudimentary — AR balance ÷ daily revenue rate, not true invoice-to-payment DSO"
            />
            <StatCard
              label="Past Due 61+ Days"
              value={rollup.agingAsOfDate ? currencyStr(rollup.pastDue61PlusCents) : '—'}
            />
            <StatCard label="Total Communities" value={rollup.totalCommunities} sub="Active child companies" />
          </StatGroup>

          <StatGroup title="Support Activity" columns={5}>
            <StatCard
              label="Open Tickets"
              value={rollup.openTickets}
              note="Client Submitted + In Progress, excl. enhancements"
              jumpTo="tickets-open-by-category-2-0"
              jumpLabel="Jump to breakdown ↓"
            />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} jumpTo="tickets-closed-by-category-2-0" jumpLabel="Jump to breakdown ↓" />
            <StatCard
              label="Open Escalation Tickets"
              value={rollup.escalationCount}
              jumpTo="tickets-escalation"
              jumpLabel="Jump to list ↓"
            />
            <AlisPayTicketsCard accounts={accounts} />
            <StatCard
              label="Enhancement Requests"
              value={rollup.enhancementTop + rollup.enhancementLesser}
              note={`${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`}
              jumpTo="enhancement-requests"
              jumpLabel="Jump to list ↓"
            />
          </StatGroup>

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
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {ARR_TIER_ORDER.filter((t) => t !== 'Tier 5').map((t) => {
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
                    <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Health" column="health_score" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Tickets" column="open_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed Tickets" column="closed_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deals" column="open_deal_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deal Value" column="open_deal_value_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label={`ARR Added (${new Date().getFullYear()})`} column="arr_added_this_year_cents" sort={sort} onSort={toggleSort} className="pr-4" />
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
                          {a.lifecycle_flag_label && (
                            <span
                              title={`Excluded from portfolio totals/averages above: ${a.lifecycle_flag_label}`}
                              className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 cursor-help"
                            >
                              ⚠ {a.lifecycle_flag_label}
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
                      <td className="py-2 pr-4 text-neutral-500">{a.arr_added_this_year_cents ? currencyStr(a.arr_added_this_year_cents) : '—'}</td>
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

          <HealthScoreTrendSection />

          <SectionCard title="Health Score by Tier" description="Avg Health Score grouped by Client Tier, portfolio-wide" defaultExpanded={false}>
            <HealthScoreByTierChart accounts={accounts} />
          </SectionCard>

          <ImplementationProjectsSection accounts={accounts} />

          <KeyContactsSection accounts={accounts} onSelect={setSelected} />

          <RecurringCallsSection accounts={accounts} onSelect={setSelected} onImported={load} />

          <SectionCard title="Tickets: Escalation" description="Every open ticket categorized ALIS Escalation, portfolio-wide — keeps high-priority items top of mind" defaultExpanded={false}>
            <EscalationRequestsSection accounts={accounts} />
          </SectionCard>
          <SectionCard title="Enhancement Requests: Top 3" description="Every account's staged Top 3 Enhancement Request, portfolio-wide" defaultExpanded={false}>
            <EnhancementRequestsSection accounts={accounts} topThreeOnly />
          </SectionCard>
          <SectionCard title="Ticket Activity" description="Trailing 12 months, opened vs. closed, across your whole portfolio" defaultExpanded={false}>
            <TicketActivityHeatmap accounts={accounts} />
          </SectionCard>
          <SectionCard title="Enhancement Requests" description="Every open ticket categorized or titled as an Enhancement, portfolio-wide — broader than the Enhancement Requests: Top 3 section above" defaultExpanded={false}>
            <EnhancementRequestsSection accounts={accounts} />
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

          <SectionCard title="AM KPI" description="Pick a metric to break down across your accounts by Client Tier" defaultExpanded={false}>
            <AmKpiChart accounts={accounts} metricKey={amKpiMetricKey} setMetricKey={setAmKpiMetricKey} chartType={amKpiChartType} setChartType={setAmKpiChartType} />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <AmKpiTrendSection metricKey={amKpiMetricKey} />
            </div>
            {(amKpiMetricKey === 'openDealCount' || amKpiMetricKey === 'openDealValueCents') && (
              <OpenDealsTable accounts={accounts} />
            )}
          </SectionCard>

          <SectionCard
            title="Community Revenue & Occupancy"
            description="Monthly per-community Net Revenue, Occupancy, and PPD with month-over-month variance — same report shape Viva's finance team was hand-building every month"
            defaultExpanded={false}
          >
            <CommunityRevenueSection accounts={accounts} />
          </SectionCard>

          <SectionCard title="Tickets by Category Open" description="Aggregated across every account — current workload" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="open" />
          </SectionCard>
          <SectionCard title="Tickets by Category Closed" description="Aggregated across every account — historical mix" defaultExpanded={false}>
            <CategoryMixChart accounts={accounts} status="closed" />
          </SectionCard>
          <SectionCard title="Ticket Volume by Client Tier" description="Open + closed tickets aggregated by Account Management Tier" defaultExpanded={false}>
            <TicketsByTierChart accounts={accounts} />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <TicketsByTierTrendSection />
            </div>
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
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <CostToServeByTierTrendSection />
            </div>
          </SectionCard>
          {unassignedTierOpen && <UnassignedTierDrawer accounts={unassignedTierAccounts} onClose={() => setUnassignedTierOpen(false)} />}
          <SectionCard title="ARR by Tier" description="Total ARR / ARR Added this year, grouped by Client Tier" defaultExpanded={false}>
            <TierByArrChart
              accounts={accounts}
              metricKey={arrByTierMetricKey}
              setMetricKey={setArrByTierMetricKey}
              chartType={arrByTierChartType}
              setChartType={setArrByTierChartType}
            />
            <div className="mt-6 pt-6 border-t border-neutral-100">
              <h3 className="text-sm font-medium text-neutral-700 mb-2">Trend</h3>
              <ArrByTierTrendSection metricKey={arrByTierMetricKey} />
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
