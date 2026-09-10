import { useEffect, useMemo, useState } from 'react';
import { exportCommunityRevenue } from '../utils/communityRevenueExport';

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
    return [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportCommunityRevenue(rows, data?.month);
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

  const totalNetRevenue = rows.reduce((s, r) => s + (r.netRevenue?.current || 0), 0);

  const content = (
    <div>
      {!single && !bannerDismissed && <OverdueBanner overdue={data.overdue} onDismiss={() => setBannerDismissed(true)} />}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
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
          <span className="text-xs text-neutral-400">{rows.length} communit{rows.length === 1 ? 'y' : 'ies'} · {currencyStr(totalNetRevenue)} total net revenue</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} disabled={exporting || rows.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No communities in this month's snapshot.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
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
              {sorted.map((r) => (
                <tr key={`${r.companyHost}::${r.communityId}`} className="border-t border-neutral-100">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (!single) return content;

  // Self-contained card for the QBR Dashboard — that page's own SectionCard
  // isn't used here since it can't conditionally disappear when there's no
  // data (see the early return above); this mirrors its title/description
  // styling directly instead.
  return (
    <div className="card mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-primary-900">Community Revenue & Occupancy</h2>
        <p className="text-xs text-neutral-500 mt-1">Monthly per-community Net Revenue, Occupancy, and PPD with month-over-month variance</p>
      </div>
      {content}
    </div>
  );
}
