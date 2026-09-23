import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { resolveWellnessRow, getVisibleWellnessRows, NOT_TRACKED } from '../utils/wellnessRows';
import { exportWellnessScorecard } from '../utils/wellnessScorecardExport';
import { exportWellnessResidentList } from '../utils/wellnessResidentListExport';
import { exportUpcomingBirthdays } from '../utils/upcomingBirthdaysExport';
import BackToTopButton from '../components/BackToTopButton';
import Drawer from '../components/Drawer';
import FloatingSectionNav from '../components/FloatingSectionNav';
import UpcomingBirthdaysPanel, { hasUpcomingBirthdays } from '../components/UpcomingBirthdaysPanel';

function BenchmarkBadge({ diff }) {
  if (!diff || diff.benchmark == null) return null;
  return (
    <span className={`text-xs font-medium ml-2 ${diff.better ? 'text-success' : 'text-error'}`}>
      {diff.better ? '▲' : '▼'} ALIS 500: {diff.benchmark.toFixed(1)}/1,000 res-days
    </span>
  );
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Cross-component "jump to this section" signal, same pattern (and event name) as AccountHealthDashboard.jsx/KpiDashboard.jsx/TeamAmDashboard.jsx — duplicated rather than shared, matching how this whole SectionCard/StatCard/StatGroup/QuickJumpNav bundle is independently re-implemented per dashboard file in this codebase. */
const JUMP_EVENT = 'alis-hub:jump-to-section';

/**
 * Collapsible section wrapper (Sep 2026, Aaron: "make all the sections here
 * collapsable... with a quick jump section at the top") — same shape as the
 * other 3 dashboards' identical SectionCard: collapsed by default except
 * where the caller overrides `defaultExpanded`, listens for JUMP_EVENT
 * addressed to its own slugified title, expands and scrolls into view.
 */
function SectionCard({ title, children, description, action, collapsible = true, defaultExpanded = false }) {
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

/** Grid of links that jump to (and auto-expand) a SectionCard elsewhere on the page — same component/story as the other 3 dashboards' QuickJumpNav. */
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

/** Single highlight tile — same component/story as the other 3 dashboards' identical StatCard/StatGroup: `jumpTo` turns the whole tile into a jump-and-enlarge control. */
function StatCard({ label, value, jumpTo, jumpLabel = 'Jump to section ↓' }) {
  if (jumpTo) {
    return (
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: jumpTo } }))}
        className="group card relative w-full text-left transition-all duration-200 hover:scale-105 hover:z-10 hover:shadow-xl flex flex-col items-start"
      >
        <p className="text-xs group-hover:text-sm text-neutral-500 uppercase tracking-wide transition-[font-size] min-h-8">{label}</p>
        <p className="text-2xl group-hover:text-3xl font-bold text-primary-900 mt-1 transition-[font-size]">{value}</p>
        <p className="text-xs group-hover:text-sm font-medium text-cool-glacier mt-0.5 transition-[font-size]">{jumpLabel}</p>
      </button>
    );
  }
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
    </div>
  );
}

function StatGroup({ title, children }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-cool-glacier uppercase tracking-wide mb-3">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {children}
      </div>
    </div>
  );
}

const OVERVIEW_SECTIONS = [
  { category: 'Rollup', items: ['Regional Comparison', 'Communities'] },
  { category: 'Report', items: ['Upcoming Birthdays & Milestones', 'Occupancy', 'Portfolio'] },
];

// Matches wellnessHealthScoring.js's SCORE_BANDS exactly (0-40 red / 40-60
// orange / 60-80 blue / 80-100 green) — a parallel client-side color map for
// a score the server already computed, same convention as
// AccountHealthDashboard.jsx's identical BAND_COLOR/ScoreBadge pair.
const BAND_COLOR = { red: '#dc2626', orange: '#ea580c', blue: '#2563eb', green: '#16a34a' };

function ScoreBadge({ score, band }) {
  if (score == null) return <span className="badge badge-neutral">No data</span>;
  const color = BAND_COLOR[band?.color] || '#737373';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
      title={band?.label}
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
 * Sortable/searchable rollup table (Sep 2026, Aaron: "roll up table of
 * communities ala the accounts table") — same SortableHeader/search-box
 * shape as AccountHealthDashboard.jsx's Accounts table. Deliberately no
 * per-community entry in the jump-nav/floating menu (Aaron, Sep 2026: this
 * report can cover 40+ communities) — a community name here is itself the
 * jump control, via the same JUMP_EVENT every SectionCard already listens
 * for on its own slugified title.
 */
function CommunitiesTable({ communityHealth }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ column: 'score', direction: 'asc' }); // worst-first by default — the most actionable view

  function toggleSort(column) {
    setSort((prev) => (prev.column === column ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return communityHealth;
    return communityHealth.filter((c) => c.name.toLowerCase().includes(q) || (c.region || '').toLowerCase().includes(q));
  }, [communityHealth, search]);

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

  function jumpToCommunity(name) {
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: slugify(name) } }));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-4">
        <p className="text-xs text-neutral-500 max-w-md">Click a community to jump to its full weekly detail below.</p>
        <input
          type="text"
          placeholder="Search communities or regions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
              <SortableHeader label="Community" column="name" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Region" column="region" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Health Score" column="score" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Occupancy" column="occupancyPct" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Falls" column="fallsTotal" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Hospital/ER" column="hospitalTotal" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Med Exceptions" column="medExceptionsTotal" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Evals Overdue" column="evaluationsOverdueTotal" sort={sort} onSort={toggleSort} className="text-right" />
              <SortableHeader label="Census" column="census" sort={sort} onSort={toggleSort} className="text-right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={`${c.host}::${c.communityId}`} className="border-b border-neutral-100 last:border-0">
                <td className="py-2 pr-4">
                  <button type="button" onClick={() => jumpToCommunity(c.name)} className="text-left text-primary-700 font-medium hover:text-accent-600 hover:underline">
                    {c.name}
                  </button>
                </td>
                <td className="py-2 pr-4 text-neutral-500">{c.region || '—'}</td>
                <td className="py-2 pr-3 text-right"><ScoreBadge score={c.score} band={c.band} /></td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.occupancyPct != null ? `${(c.occupancyPct * 100).toFixed(1)}%` : '—'}</td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.fallsTotal}</td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.hospitalTotal}</td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.medExceptionsTotal}</td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.evaluationsOverdueTotal}</td>
                <td className="py-2 pr-3 text-right text-neutral-600">{c.census}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <p className="text-sm text-neutral-500 italic mt-3">No communities match "{search}".</p>}
    </div>
  );
}

/**
 * Average Community Health Score by region (Sep 2026, Aaron: "bring in the
 * concept of region... compare regions and call out well performing or
 * underperforming communities"). `region` is ALIS's own community region
 * field (already used for DSO/PPD rollups elsewhere — see
 * kpiNormalizer.js), not a HubSpot property — this portal has none on
 * Company/Deal records (checked live, Sep 2026). A community with no
 * region on file groups under "Unassigned" rather than being dropped.
 */
function RegionComparisonSection({ rollup }) {
  if (!rollup || rollup.byRegion.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No community health data available yet.</p>;
  }
  const portfolioAvg = rollup.avgScore;
  return (
    <div>
      <p className="text-xs text-neutral-500 mb-4">
        Average Community Health Score by region this week{portfolioAvg != null ? ` — portfolio average: ${portfolioAvg}` : ''}.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {rollup.byRegion.map((r) => {
          const delta = r.avgScore != null && portfolioAvg != null ? r.avgScore - portfolioAvg : null;
          return (
            <div key={r.region} className="card-sm">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">{r.region}</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-primary-900">{r.avgScore ?? '—'}</span>
                {delta != null && (
                  <span className={`text-xs font-medium ${delta >= 0 ? 'text-success' : 'text-error'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs. portfolio
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 mt-1">{r.communityCount} communit{r.communityCount === 1 ? 'y' : 'ies'}</p>
            </div>
          );
        })}
      </div>
      {rollup.bestRegion && rollup.worstRegion && rollup.bestRegion.region !== rollup.worstRegion.region && (
        <p className="text-sm text-neutral-600">
          <span className="text-success font-medium">{rollup.bestRegion.region}</span> is the strongest region this week (avg {rollup.bestRegion.avgScore}) —
          {' '}<span className="text-error font-medium">{rollup.worstRegion.region}</span> is the weakest (avg {rollup.worstRegion.avgScore}).
        </p>
      )}
    </div>
  );
}

/**
 * Per client feedback (Gallaher, 2026-09-01): how many of this row's
 * incidents this week still have an incomplete form or intervention — same
 * signal now driving a QBR flag (kpiNormalizer.js's normalizeIncidentCompletion),
 * surfaced here per scope (portfolio and each community) rather than
 * portfolio-only like BenchmarkBadge, since catching this up community by
 * community is the whole point.
 */
/** Small hover-tooltip "i" icon for a row's `note` (WELLNESS_ROWS) — a native `title` attribute rather than a custom popover component, matching DocCompletionBadge's own tooltip approach just below. */
function InfoNote({ note }) {
  if (!note) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 ml-1.5 rounded-full bg-neutral-200 text-neutral-600 text-[10px] font-semibold cursor-help align-middle"
      title={note}
    >
      i
    </span>
  );
}

function DocCompletionBadge({ openDocsTotal, openDocsReporters }) {
  if (!openDocsTotal) return null;
  const title = openDocsReporters?.length
    ? `Reported by: ${openDocsReporters.map((r) => `${r.name}${r.count > 1 ? ` x${r.count}` : ''}`).join(', ')}`
    : 'Incidents this week still missing a completed form or intervention';
  return (
    <span className="text-xs font-medium ml-2 text-error" title={title}>
      ⚠ {openDocsTotal} undocumented
    </span>
  );
}

// Every row here is a risk/concern count — there's no row on this scorecard
// where more is better — so ↑ (more this week) reads as a warning color, ↓
// as success, and → as neutral, on top of just being bigger/bolder.
const TREND_COLOR = { '↑': 'text-error', '↓': 'text-success', '→': 'text-neutral-400' };

function TrendArrow({ trend }) {
  if (!trend || trend === '—') return <span className="text-neutral-300">—</span>;
  return <span className={`text-lg font-bold ${TREND_COLOR[trend] || 'text-neutral-500'}`}>{trend}</span>;
}

/**
 * Resident-level detail behind a row flagged `hasResidentDrawer` (currently
 * "Residents currently hospitalized / in ER" and "New significant change
 * in condition") — same drawer+Excel-export shape as every other KPI
 * drill-down in this app (see Drawer.jsx's own doc comment), just newly
 * wired up here since this page had no drawer at all before now. `items`
 * already carries a unified `detail` string per row type (see
 * wellnessNormalizer.js's attachItems callers), so this stays generic
 * rather than needing to know which row it's showing.
 */
function ResidentDrawer({ label, items, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportWellnessResidentList(label, items);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title={label}
      subtitle={`${items.length} resident${items.length === 1 ? '' : 's'}`}
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
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No residents to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-4">Resident</th>
                <th className="pb-2 pr-4">Community</th>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.residentId}-${i}`} className="border-t border-neutral-100">
                  <td className="py-2 pr-4">{it.residentName || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{it.communityName || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{it.date ? it.date.slice(0, 10) : '—'}</td>
                  <td className="py-2 text-neutral-500">{it.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

const AGE_BANDS = ['<60', '60s', '70s', '80s', '90s', '100+'];

/**
 * Average resident age + decade-band counts for one scope (Aaron, Sep
 * 2026) — rendered inside each WellnessTable (portfolio and every
 * community), same "own small summary, not forced into the AL/MC/Total
 * row shape" treatment as OccupancySection gets, just per-scope instead
 * of portfolio-only since Aaron asked for this to roll up AND break out
 * by community.
 */
function ResidentAgeSummary({ ageData }) {
  if (!ageData || ageData.countedForAge === 0) return null;
  return (
    <div className="mb-4 pb-4 border-b border-neutral-100 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <span className="text-neutral-800">
        <span className="font-semibold">{ageData.avgAge.toFixed(1)}</span>
        <span className="text-neutral-500"> avg resident age</span>
        {ageData.countedForAge < ageData.totalResidents && (
          <span className="text-neutral-400"> ({ageData.countedForAge} of {ageData.totalResidents} with age on file)</span>
        )}
      </span>
      {AGE_BANDS.map((band) => (
        <span key={band} className="text-neutral-500 text-xs uppercase tracking-wide">
          {band}: <span className="font-semibold text-neutral-700 normal-case">{ageData.bandCounts[band]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The row table itself, no title/card chrome of its own anymore (Sep 2026)
 * — the caller wraps every instance (Portfolio + each community) in a
 * SectionCard now so it collapses/expands and jump-navs the same way as
 * every other section on this page, instead of an always-open plain div.
 */
/**
 * Reshapes one community's occupancy.byCommunity bucket (occupied/total +
 * byProductType/byClassification, scoped to that community's own occupied
 * count — see wellnessNormalizer.js's normalizeOccupancySnapshot) into the
 * same shape OccupancySection already expects for the portfolio, so it can
 * be reused here instead of duplicating its table markup.
 */
function communityOccupancyScope(occupancy, communityId) {
  const c = occupancy?.byCommunity?.[communityId];
  if (!c?.total) return null;
  return {
    hasOccupancyData: true,
    pct: c.occupied / c.total,
    occupied: c.occupied,
    total: c.total,
    byProductType: c.byProductType,
    byClassification: c.byClassification,
  };
}

function WellnessTable({ snapshot, communityId, hideUntracked }) {
  let currentCategory = null;
  // Resolved per-row, not by the row's static `source` — a `source: 'rows'`
  // row (e.g. "Residents with declining activity engagement") can still
  // have no real data for this account/week (needs several weeks of
  // history, a module not yet populated, etc.), and Aaron asked (Sep 2026)
  // for the hide toggle to catch those too, not just the always-manual
  // rows: "I just want the flexibility to hide the under construction /
  // not yet captured pieces in the report." Resolving once per row here
  // (rather than filtering first, then resolving again per rendered row)
  // also means the table body below never re-resolves the same row twice.
  const resolved = getVisibleWellnessRows(snapshot).map((row) => ({ row, v: resolveWellnessRow(row, snapshot, communityId) }));
  const rows = hideUntracked ? resolved.filter(({ v }) => v.total !== NOT_TRACKED) : resolved;
  const [drawerRow, setDrawerRow] = useState(null);
  const ageData = communityId ? snapshot.residentAge?.byCommunity?.[communityId] : snapshot.residentAge?.portfolio;
  // Portfolio already gets its own full-width "Occupancy" SectionCard
  // above, so only communities get this compact breakdown here (Aaron, Sep
  // 2026: "add the occupancy breakdown per community on the community
  // sections").
  const occupancyScope = communityId ? communityOccupancyScope(snapshot.rows?.occupancy, communityId) : null;
  return (
    <div>
      <ResidentAgeSummary ageData={ageData} />
      {occupancyScope && (
        <div className="mb-4 pb-4 border-b border-neutral-100">
          <p className="text-xs font-semibold text-cool-glacier uppercase tracking-wide mb-2">Occupancy</p>
          <OccupancySection occupancy={occupancyScope} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Key Indicator</th>
              <th className="py-2 pr-3 text-right">AL</th>
              <th className="py-2 pr-3 text-right">MC</th>
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="py-2 pr-3 text-right">Prior Week</th>
              <th className="py-2 pr-4 text-center">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, v }) => {
              const showCategory = row.category !== currentCategory;
              currentCategory = row.category;
              const diff = row.hasBenchmark ? snapshot.benchmarkDiffs?.[row.key] : null;
              return (
                <tr key={`${row.category}-${row.key}`} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 pr-4 text-neutral-500">{showCategory ? row.category : ''}</td>
                  <td className="py-2 pr-4 text-neutral-800">
                    {row.label}
                    <InfoNote note={row.note} />
                    {!communityId && <BenchmarkBadge diff={diff} />}
                    {row.hasDocCompletion && <DocCompletionBadge openDocsTotal={v.openDocsTotal} openDocsReporters={v.openDocsReporters} />}
                  </td>
                  <td className="py-2 pr-3 text-right">{v.al}</td>
                  <td className="py-2 pr-3 text-right">{v.mc}</td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {row.hasResidentDrawer && v.items?.length > 0 ? (
                      <button onClick={() => setDrawerRow({ label: `${row.label} — ${communityId ? snapshot.communities.find((c) => String(c.communityId) === communityId)?.name : 'Portfolio'}`, items: v.items })} className="underline decoration-dotted hover:text-accent-600">
                        {v.total}
                      </button>
                    ) : v.total}
                  </td>
                  <td className="py-2 pr-3 text-right text-neutral-500">{v.prior}</td>
                  <td className="py-2 pr-4 text-center"><TrendArrow trend={v.trend} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drawerRow && <ResidentDrawer label={drawerRow.label} items={drawerRow.items} onClose={() => setDrawerRow(null)} />}
    </div>
  );
}

/**
 * Occupancy as of the report's week-ending date, broken out by resident
 * product type and classification — not part of the original 25-row
 * mirrored spreadsheet (this page's WellnessTable above is a deliberate
 * digitization of that exact sheet), so it renders as its own section
 * rather than forced into the AL/MC/Total row shape every other row uses.
 * Same breakdown KpiDashboard.jsx's OccupancyByProductTypeSection shows,
 * here as a point-in-time snapshot instead of a period average (see
 * wellnessNormalizer.js's normalizeOccupancySnapshot). No title/card
 * chrome of its own anymore (Sep 2026) — the caller wraps it in a
 * SectionCard now, same as WellnessTable above.
 */
function OccupancySection({ occupancy }) {
  if (!occupancy?.hasOccupancyData) return <p className="text-sm text-neutral-500 italic">No occupancy data available for this week.</p>;

  const renderTable = (title, rows, keyField) => (
    <div>
      <h3 className="font-semibold text-primary-900 text-sm mb-2">{title}</h3>
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
              <td className="py-1.5 text-right text-neutral-500">{r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—'}</td>
              <td className="py-1.5 text-right text-neutral-500">{r.occupied} / {r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="mb-4">
        <span className="text-2xl font-bold text-primary-900">{(occupancy.pct * 100).toFixed(1)}%</span>
        <span className="text-neutral-500 text-sm ml-2">{occupancy.occupied} / {occupancy.total} occupied</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {occupancy.byProductType?.length > 0 && renderTable('By product type', occupancy.byProductType, 'productType')}
        {occupancy.byClassification?.length > 0 && renderTable('By classification', occupancy.byClassification, 'classification')}
      </div>
    </div>
  );
}

/** SectionCard `action` button for "Upcoming Birthdays & Milestones" (Sep 2026, Aaron) — same exporting/error-state shape as every other per-section export button in this app (e.g. KpiDashboard.jsx's IncidentCompletionPanel). */
function UpcomingBirthdaysExportButton({ data, companyName, weekEnding, communities }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      await exportUpcomingBirthdays(data, { companyName, weekEnding, communities });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleExport} disabled={exporting} className="btn btn-secondary btn-sm">
        {exporting ? 'Exporting…' : '⬇ Export to Excel'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
    </div>
  );
}

const HIDE_UNTRACKED_KEY = 'wellness-scorecard:hide-untracked';

export default function WellnessScorecard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  // Persisted across visits — a reviewer scanning this weekly usually wants
  // the same view every time, not to re-toggle it on every job.
  const [hideUntracked, setHideUntracked] = useState(() => {
    try { return localStorage.getItem(HIDE_UNTRACKED_KEY) === 'true'; } catch { return false; }
  });

  function toggleHideUntracked() {
    setHideUntracked((prev) => {
      const next = !prev;
      try { localStorage.setItem(HIDE_UNTRACKED_KEY, String(next)); } catch { /* best-effort */ }
      return next;
    });
  }

  useEffect(() => {
    fetch(`/api/wellness/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no wellness snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data.summary))
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/wellness/${jobId}/export-pdf${hideUntracked ? '?hideUntracked=true' : ''}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snapshot?.companyName || 'Wellness-Scorecard'}-${snapshot?.weekEnding || ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingPdf(false);
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }
  if (!snapshot) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading wellness scorecard...</p></div>;
  }

  // Portfolio-scoped resolution for this summary line (a row could in
  // principle have data at the portfolio level but not for one specific
  // community, or vice versa — this banner isn't meant to be that precise,
  // it's the same "how much of the report has real data" framing the
  // toggle itself uses). See WellnessTable's identical resolve-then-filter
  // reasoning above for why this checks the resolved value, not `source`.
  const visibleRowCount = getVisibleWellnessRows(snapshot).length;
  const trackedRowCount = getVisibleWellnessRows(snapshot).filter((r) => resolveWellnessRow(r, snapshot, null).total !== NOT_TRACKED).length;

  const rollup = snapshot.communityHealthRollup;
  const communityHealth = snapshot.communityHealth || [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{snapshot.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            Week ending {snapshot.weekEnding} · benchmarked against ALIS 500 ({snapshot.benchmarkQuarter}) where published
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={() => exportWellnessScorecard(snapshot, hideUntracked)}>
            Export to Excel
          </button>
          <button className="btn btn-primary" onClick={handleExportPdf} disabled={exportingPdf}>
            {exportingPdf ? 'Exporting...' : 'Export to PDF'}
          </button>
        </div>
      </div>

      {snapshot.dataWarnings?.length > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <div>
            {snapshot.dataWarnings.map((w, i) => <p key={i} className="text-sm">{w}</p>)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <p className="text-xs text-neutral-500 max-w-3xl">
          {hideUntracked ? (
            <>Showing only rows with data. {visibleRowCount - trackedRowCount} row(s) with no data available are hidden — Export to Excel/PDF will match this view ({trackedRowCount} rows).</>
          ) : (
            <>Rows showing "— No data available" aren't computed automatically yet — either that signal isn't built
            in ALIS today, or (for staff training/competency) that ALIS module isn't populated for this account. This
            scorecard is still in development, so these stay blank for the Wellness Director to fill in, same as the
            original spreadsheet — or hide them entirely with the checkbox.</>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-600 shrink-0 ml-4 cursor-pointer select-none">
          <input type="checkbox" checked={hideUntracked} onChange={toggleHideUntracked} className="w-4 h-4 rounded cursor-pointer accent-primary-600" />
          Hide rows with no data
        </label>
      </div>

      <p className="text-xs text-neutral-400 mb-6 max-w-3xl">
        Medication exceptions reflect ALIS's own order-administration status flags (a dose marked "exception" or never recorded) — a client has reported this flag being set incorrectly for a passed dose, so treat this row as a starting point for review, not a final tally.
      </p>

      <SectionCard title="Report Overview" collapsible defaultExpanded>
        <QuickJumpNav sections={OVERVIEW_SECTIONS} />
      </SectionCard>

      <StatGroup title="Portfolio Health">
        <StatCard label="Avg Community Health Score" value={rollup?.avgScore ?? '—'} jumpTo="communities" jumpLabel="Jump to table ↓" />
        <StatCard label="Communities At Risk" value={rollup?.atRiskCount ?? 0} jumpTo="communities" jumpLabel="Jump to table ↓" />
        <StatCard label="Top Performer" value={rollup?.best ? `${rollup.best.name} (${rollup.best.score})` : '—'} jumpTo="communities" jumpLabel="Jump to table ↓" />
      </StatGroup>

      {/* Portfolio-wide rollups of numbers this report already computes per
          row (see snapshot.rows) — pulled to the top as quick-glance tiles
          (Sep 2026, Aaron: "roll up data from the tables"), same
          Operational/Clinical grouping style as KpiDashboard.jsx's own
          StatGroups. Deliberately clinical/operational only, no financial
          tiles (Aaron: "not so much the financial parts") — this report has
          no billing data to roll up anyway. */}
      <StatGroup title="Operational">
        <StatCard label="Occupancy" value={snapshot.rows?.occupancy?.pct != null ? `${(snapshot.rows.occupancy.pct * 100).toFixed(1)}%` : '—'} jumpTo="occupancy" jumpLabel="Jump to section ↓" />
        <StatCard label="Total Residents" value={snapshot.residentAge?.portfolio?.totalResidents ?? '—'} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
        <StatCard label="Avg Resident Age" value={snapshot.residentAge?.portfolio?.avgAge != null ? snapshot.residentAge.portfolio.avgAge.toFixed(1) : '—'} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
        <StatCard label="Staff Active (7d)" value={snapshot.rows?.staffing?.portfolio?.pct != null ? `${(snapshot.rows.staffing.portfolio.pct * 100).toFixed(1)}%` : '—'} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
      </StatGroup>

      <StatGroup title="Clinical & Safety Signals">
        <StatCard label="Falls / 1,000 Res-Days" value={snapshot.benchmarkDiffs?.falls?.actual != null ? snapshot.benchmarkDiffs.falls.actual.toFixed(1) : (snapshot.rows?.falls?.portfolio?.total ?? '—')} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
        <StatCard label="Hospital/ER Visits / 1,000 Res-Days" value={snapshot.benchmarkDiffs?.hospitalCurrent?.actual != null ? snapshot.benchmarkDiffs.hospitalCurrent.actual.toFixed(1) : (snapshot.rows?.hospitalCurrent?.portfolio?.total ?? '—')} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
        <StatCard label="Medication Exceptions" value={snapshot.rows?.medicationExceptions?.portfolio?.total ?? '—'} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
        <StatCard label="Evaluations Needing Attention" value={snapshot.rows?.evaluationsNeedingAttention?.portfolio?.total ?? '—'} jumpTo="portfolio" jumpLabel="Jump to table ↓" />
      </StatGroup>

      <SectionCard title="Regional Comparison" description="Average Community Health Score by ALIS region, this week">
        <RegionComparisonSection rollup={rollup} />
      </SectionCard>

      <SectionCard title="Communities" description="Every community in this report, with its Community Health Score and key weekly KPIs">
        <CommunitiesTable communityHealth={communityHealth} />
      </SectionCard>

      {hasUpcomingBirthdays(snapshot.upcomingBirthdays) && (
        <SectionCard
          title="Upcoming Birthdays & Milestones"
          description="Next 14 days, based on birthdate data already on file in ALIS"
          action={
            <UpcomingBirthdaysExportButton
              data={snapshot.upcomingBirthdays}
              companyName={snapshot.companyName}
              weekEnding={snapshot.weekEnding}
              communities={snapshot.communities}
            />
          }
        >
          <UpcomingBirthdaysPanel data={snapshot.upcomingBirthdays} communities={snapshot.communities} />
        </SectionCard>
      )}

      <SectionCard title="Occupancy" description="As of the week-ending date — a snapshot, not a weekly count like the rows below">
        <OccupancySection occupancy={snapshot.rows?.occupancy} />
      </SectionCard>

      <SectionCard title="Portfolio" description="Portfolio-wide totals across every community in this report">
        <WellnessTable snapshot={snapshot} hideUntracked={hideUntracked} />
      </SectionCard>

      {snapshot.communities.map((c) => (
        <SectionCard key={`${c.host}::${c.communityId}`} title={c.name}>
          <WellnessTable snapshot={snapshot} communityId={String(c.communityId)} hideUntracked={hideUntracked} />
        </SectionCard>
      ))}

      <FloatingSectionNav
        watchSectionId={slugify('Report Overview')}
        sections={OVERVIEW_SECTIONS}
        enabled={!!snapshot}
        onSelect={(title) => window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id: slugify(title) } }))}
      />
      <BackToTopButton />
    </div>
  );
}
