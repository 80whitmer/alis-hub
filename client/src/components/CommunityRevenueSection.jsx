import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { exportCommunityRevenue } from '../utils/communityRevenueExport';

// Same event name/id-matching contract as KpiDashboard.jsx's own JUMP_EVENT
// (duplicated, not shared — per-file convention throughout this app):
// QuickJumpNav/FloatingSectionNav dispatch this with {detail:{id}} when a
// jump link is clicked; SectionCard listens for its own slugified title.
// This component isn't a SectionCard (see its single-account return below),
// so it listens for the same event itself to support a "Community Revenue
// & Occupancy" jump link on the QBR page (Sep 2026, Aaron).
const JUMP_EVENT = 'alis-hub:jump-to-section';
const COMMUNITY_REVENUE_SECTION_ID = 'community-revenue-occupancy';

/**
 * Community Revenue & Occupancy — per-community Charges/Credits/Discounts/
 * Net Revenue, Occupancy Unit Days, Census, PPD (both bases), and Move-Ins/
 * Move-Outs, with month-over-month deltas, sourced from the monthly
 * "Community Revenue & Occupancy Snapshot" job (server/automation/
 * communityRevenueSnapshot.js) rather than the live-refreshed `accounts`
 * prop every other section on the dashboards it lives on uses — this is
 * its own fetch against /api/account-health/community-revenue, since the
 * underlying data is stored history (community_revenue_snapshots), not a
 * cached "current state" snapshot recomputed on every dashboard refresh.
 * Matches the exact report shape Viva's finance team was hand-building
 * every month (Charges + Credits + Discounts = Net Revenue, confirmed
 * against their real July/August 2025 spreadsheets).
 *
 * Two usage modes (Sep 2026, moved off Team AM Dashboard per Aaron):
 * - Portfolio (Account Health Dashboard): pass `accounts` — the endpoint
 *   itself isn't owner-scoped (community_revenue_snapshots has no
 *   hubspot_company_id), so rows are filtered client-side to whatever
 *   company names appear in the caller's own (already owner-scoped)
 *   `accounts` list, same convention EnhancementRequestsSection uses.
 * - Single account (KPI/QBR Dashboard): pass `companyName` — fetches that
 *   account's own history via `?companyName=`, hides the Company column
 *   and overdue banner (both meaningless for one account), and renders
 *   nothing at all if the account has no snapshot yet, so the QBR page
 *   only ever shows this "if the data has been run/cached" per Aaron.
 *
 * Unit Capacity is a labeled ESTIMATE, not authoritative — Viva's own
 * report sources it from a manually-maintained file outside ALIS
 * entirely, so no ALIS endpoint (including the floor-plan dedupe this
 * job uses) can reproduce it exactly; confirmed live it matched for 2 of
 * 5 communities checked and undercounted for the rest. Aaron confirmed
 * (Sep 2026) to ship it as a caveated estimate rather than block on it.
 */

function SortableHeader({ label, column, sort, onSort, className = '', title }) {
  const active = sort.column === column;
  return (
    <th className={`pb-2 cursor-pointer select-none hover:text-neutral-700 ${className}`} onClick={() => onSort(column)} title={title}>
      {label}{active && <span className="ml-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

/** Same native-title "i" icon as WellnessScorecard.jsx's InfoNote — duplicated locally rather than shared, matching this codebase's small-helper convention. */
function InfoNote({ note }) {
  if (!note) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 ml-1 rounded-full bg-neutral-200 text-neutral-600 text-[10px] font-semibold cursor-help align-middle"
      title={note}
    >
      i
    </span>
  );
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

/** Renders a current value plus a small colored Δ vs. prior month — green for up, red for down, nothing at all when there's no prior snapshot yet (never fabricates a 0/arrow). */
function TrendCell({ trend, fmt = (n) => n, deltaFmt = (n) => n }) {
  if (!trend || trend.current == null) return <span className="text-neutral-300">—</span>;
  return (
    <span>
      {fmt(trend.current)}
      {trend.deltaAbs != null && (
        <span className={`ml-1.5 text-xs font-medium ${trend.deltaAbs > 0 ? 'text-success' : trend.deltaAbs < 0 ? 'text-error' : 'text-neutral-400'}`}>
          {trend.deltaAbs > 0 ? '▲' : trend.deltaAbs < 0 ? '▼' : '→'} {deltaFmt(Math.abs(trend.deltaAbs))}
        </span>
      )}
    </span>
  );
}

function currencyStr(n) {
  return n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function pctFmt(n) {
  return n == null ? '—' : `${round1(n * 100)}%`;
}

function pctDeltaFmt(n) {
  return `${round1(n * 100)}pp`;
}

/**
 * Occupied-count + composition-% breakdown for one community, by product
 * type or by classification — same {productType|classification, occupied,
 * pct} shape the server's withCategoryDelta already trend-wraps, just
 * rendered as a small standalone table rather than forced into the wide
 * per-community table above (Crissy's team's monthly census-by-product-
 * type/classification pull, Aaron Sep 2026). `pct` is each category's share
 * of that community's own occupied total, matching the composition-mix
 * convention normalizeOccupancy already uses elsewhere — not that
 * category's own fill rate.
 */
function OccupancyBreakdownTable({ title, rows, categoryKey }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-neutral-400 italic">No {title.toLowerCase()} data for this month.</p>;
  }
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">{title}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-400 text-xs uppercase tracking-wide">
            <th className="pb-1 pr-4">{title}</th>
            <th className="pb-1 pr-4">Occupied</th>
            <th className="pb-1">% of Occupied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[categoryKey]} className="border-t border-neutral-100">
              <td className="py-1.5 pr-4">{row[categoryKey]}</td>
              <td className="py-1.5 pr-4"><TrendCell trend={row.occupied} /></td>
              <td className="py-1.5"><TrendCell trend={row.pct} fmt={pctFmt} deltaFmt={pctDeltaFmt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverdueBanner({ overdue, onDismiss }) {
  if (!overdue || overdue.length === 0) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-4">
      <p className="text-sm text-amber-800">
        <span className="font-semibold">Overdue: </span>
        {overdue.map((o) => `${o.companyName} (last snapshot ${o.latestMonth}, ${o.monthsBehind} month${o.monthsBehind === 1 ? '' : 's'} behind)`).join('; ')}
        {' — run a new "Community Revenue & Occupancy Snapshot" job to catch up.'}
      </p>
      <button onClick={onDismiss} className="text-amber-600 hover:text-amber-800 text-sm font-semibold shrink-0">✕</button>
    </div>
  );
}

function apiUrl(companyName, month) {
  const params = new URLSearchParams();
  if (companyName) params.set('companyName', companyName);
  if (month) params.set('month', month);
  const qs = params.toString();
  return `/api/account-health/community-revenue${qs ? `?${qs}` : ''}`;
}

export default function CommunityRevenueSection({ accounts, companyName }) {
  const single = Boolean(companyName);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ column: 'communityName', direction: 'asc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Single-account (QBR) mode only — collapsed by default (Sep 2026,
  // Aaron), same look as KpiDashboard.jsx's own SectionCard chevron
  // header, reimplemented locally rather than wrapped in that component
  // since SectionCard can't conditionally disappear when there's no data
  // (see this component's own return-null branch below).
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);
  // Per-community expand/collapse for the Product Type/Classification
  // occupancy breakdown (Sep 2026) — keyed by `${companyHost}::${communityId}`,
  // same convention as the row's own React key, so expansion state survives
  // a re-sort of the table.
  const [expandedCommunities, setExpandedCommunities] = useState(new Set());
  function toggleCommunityExpanded(key) {
    setExpandedCommunities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  // Portfolio mode only (Sep 2026, Aaron) — narrow the table to one company
  // at a time; meaningless in single-account (QBR) mode, which has no
  // Company column to begin with. Empty string = every owned company.
  const [companyFilter, setCompanyFilter] = useState('');

  useEffect(() => {
    if (!single) return;
    function handleJump(e) {
      if (e.detail?.id !== COMMUNITY_REVENUE_SECTION_ID) return;
      setExpanded(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.addEventListener(JUMP_EVENT, handleJump);
    return () => window.removeEventListener(JUMP_EVENT, handleJump);
  }, [single]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(apiUrl(companyName))
      .then((res) => {
        if (!res.ok) return res.json().catch(() => ({})).then((j) => { throw new Error(j.error || `HTTP ${res.status}`); });
        return res.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyName]);

  function handleMonthChange(month) {
    setLoading(true);
    setError('');
    fetch(apiUrl(companyName, month))
      .then((res) => res.json())
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  // Portfolio mode: community_revenue_snapshots has no hubspot_company_id
  // to filter by server-side, so scope to the caller's own (already
  // owner-scoped) account list client-side instead — same pattern
  // EnhancementRequestsSection uses for the same reason.
  const ownedNames = useMemo(
    () => (accounts ? new Set(accounts.map((a) => a.company_name)) : null),
    [accounts]
  );
  const rows = useMemo(() => {
    const all = data?.rows || [];
    return ownedNames ? all.filter((r) => ownedNames.has(r.companyName)) : all;
  }, [data, ownedNames]);

  // Every distinct company name in this month's (owner-scoped) snapshot —
  // drives the company filter dropdown below. Computed off `rows` (not
  // `filteredRows`) so every option always stays available regardless of
  // the current selection.
  const companyOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.companyName))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(
    () => (companyFilter ? rows.filter((r) => r.companyName === companyFilter) : rows),
    [rows, companyFilter]
  );

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    const valueOf = (r) => {
      switch (column) {
        case 'netRevenue': return r.netRevenue?.current;
        case 'occupiedUnits': return r.totalOccupiedUnits?.current;
        case 'occupancyUnitDays': return r.occupancyUnitDays?.current;
        case 'censusDays': return r.censusDays?.current;
        case 'ppdUnitDays': return r.ppdUnitDays?.current;
        case 'ppdCensus': return r.ppdCensus?.current;
        default: return r[column];
      }
    };
    return [...filteredRows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filteredRows, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportCommunityRevenue(filteredRows, data?.month);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  // Single-account (QBR) mode is entirely self-contained (own title/card,
  // no parent SectionCard wrapping it — see KpiDashboard.jsx) and never
  // shows a loading flash or "no data" placeholder: while loading, or if
  // this account has no snapshot at all, the section simply isn't there,
  // per Aaron's "if the data has been run/cached" ask.
  if (single && (loading || error || !data || data.month == null)) {
    return null;
  }

  if (loading && !data) {
    return <p className="text-sm text-neutral-500 italic">Loading community revenue history…</p>;
  }
  if (error) {
    return <p className="text-sm text-error">Failed to load: {error}</p>;
  }
  if (!data || data.month == null) {
    return (
      <p className="text-sm text-neutral-500 italic">
        No community revenue history yet — run the "Community Revenue & Occupancy Snapshot" job from "+ New Job" for an account (e.g. Viva Senior Living) to get started.
      </p>
    );
  }

  const totalNetRevenue = filteredRows.reduce((s, r) => s + (r.netRevenue?.current || 0), 0);

  const content = (
    <div>
      {!single && !bannerDismissed && <OverdueBanner overdue={data.overdue} onDismiss={() => setBannerDismissed(true)} />}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-neutral-500">Month:</span>
          {data.availableMonths.length > 1 ? (
            <select
              value={data.month}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="text-sm border border-neutral-300 rounded px-2 py-1"
            >
              {data.availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <span className="text-sm font-semibold text-primary-900">{data.month}</span>
          )}
          {!single && companyOptions.length > 1 && (
            <>
              <span className="text-sm text-neutral-500">Company:</span>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="text-sm border border-neutral-300 rounded px-2 py-1"
              >
                <option value="">All companies</option>
                {companyOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </>
          )}
          <span className="text-xs text-neutral-400">{filteredRows.length} communit{filteredRows.length === 1 ? 'y' : 'ies'} · {currencyStr(totalNetRevenue)} total net revenue</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} disabled={exporting || filteredRows.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          {companyFilter ? `No communities for ${companyFilter} in this month's snapshot.` : "No communities in this month's snapshot."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-2 w-6"></th>
                {!single && <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />}
                <SortableHeader label="Community" column="communityName" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Net Revenue" column="netRevenue" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader
                  label="Unit Capacity"
                  column="unitCapacity"
                  sort={sort}
                  onSort={toggleSort}
                  className="pr-4"
                />
                <SortableHeader label="Occupied Units" column="occupiedUnits" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Move Ins" column="moveIns" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Move Outs" column="moveOuts" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Occupancy Unit Days" column="occupancyUnitDays" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Census Days" column="censusDays" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="PPD (Unit Days)" column="ppdUnitDays" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="PPD (Census)" column="ppdCensus" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const key = `${r.companyHost}::${r.communityId}`;
                const hasBreakdown = r.occupancyByProductType?.length > 0 || r.occupancyByClassification?.length > 0;
                const isExpanded = expandedCommunities.has(key);
                const columnCount = (single ? 11 : 12);
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-neutral-100">
                      <td className="py-2 pr-2">
                        {hasBreakdown && (
                          <button
                            onClick={() => toggleCommunityExpanded(key)}
                            className="text-neutral-400 hover:text-neutral-700 text-xs w-4"
                            title="Occupancy by product type / classification"
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        )}
                      </td>
                      {!single && <td className="py-2 pr-4">{r.companyName}</td>}
                      <td className="py-2 pr-4 font-medium text-primary-900">{r.communityName}</td>
                      <td className="py-2 pr-4"><TrendCell trend={r.netRevenue} fmt={currencyStr} deltaFmt={currencyStr} /></td>
                      <td className="py-2 pr-4 text-neutral-500">
                        {r.unitCapacity ?? '—'}
                        <InfoNote note="Estimated from the ALIS floor plan — Viva's own report sources this figure from a manually-maintained file outside ALIS, so treat it as directional, not exact." />
                      </td>
                      <td className="py-2 pr-4"><TrendCell trend={r.totalOccupiedUnits} /></td>
                      <td className="py-2 pr-4 text-neutral-500">{r.moveIns ?? '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{r.moveOuts ?? '—'}</td>
                      <td className="py-2 pr-4"><TrendCell trend={r.occupancyUnitDays} /></td>
                      <td className="py-2 pr-4"><TrendCell trend={r.censusDays} /></td>
                      <td className="py-2 pr-4"><TrendCell trend={r.ppdUnitDays} fmt={(n) => `$${round1(n)}`} deltaFmt={(n) => `$${round1(n)}`} /></td>
                      <td className="py-2"><TrendCell trend={r.ppdCensus} fmt={(n) => `$${round1(n)}`} deltaFmt={(n) => `$${round1(n)}`} /></td>
                    </tr>
                    {isExpanded && hasBreakdown && (
                      <tr className="border-t border-neutral-100 bg-neutral-50">
                        <td colSpan={columnCount} className="py-3 px-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <OccupancyBreakdownTable title="Product Type" rows={r.occupancyByProductType} categoryKey="productType" />
                            <OccupancyBreakdownTable title="Classification" rows={r.occupancyByClassification} categoryKey="classification" />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (!single) return content;

  // Self-contained card for the QBR Dashboard — that page's own SectionCard
  // isn't used here since it can't conditionally disappear when there's no
  // data (see the early return above); this mirrors its title/description/
  // chevron-toggle styling directly instead, collapsed by default like
  // every other SectionCard on this page.
  return (
    <div id={COMMUNITY_REVENUE_SECTION_ID} ref={ref} className="card mb-8 scroll-mt-4">
      <div className="mb-4 cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <h2 className="text-lg font-semibold text-primary-900 flex items-center gap-2">
          <span className="text-xs text-neutral-400">{expanded ? '▼' : '▶'}</span>
          Community Revenue & Occupancy
        </h2>
        <p className="text-xs text-neutral-500 mt-1">Monthly per-community Net Revenue, Occupancy, and PPD with month-over-month variance</p>
      </div>
      {expanded && content}
    </div>
  );
}
