import { useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
  LineChart, Line, Legend,
} from 'recharts';
import { exportEnhancementRequests } from '../utils/enhancementRequestsExport';

/**
 * Portfolio-wide "Enhancement Requests" section — every OPEN ticket whose
 * category_2_0 is HubSpot's own "Enhancement" option, or whose subject
 * mentions "enhancement" (see server/services/hubspotTickets.js's
 * isEnhancementRequest). Broader than, and independent of, the existing
 * Top 3 Enhancement Requests concept (TopThreeEnhancementsCard.jsx) — a
 * ticket can be on this list without ever being ranked/staged Top 3, and
 * "Top 3?" is just one column here.
 *
 * Same flatten-across-accounts architecture as TopThreeEnhancementsCard.jsx:
 * each account's `serviceHealth.enhancementRequests` (computed server-side,
 * see teamAm.js's/accountHealth.js's mapLiveServiceHealth) is already
 * loaded by the calling dashboard — this component does all cross-account
 * aggregation (stats, tier chart, calendar, table) client-side, no new API
 * calls. `includeAccountManager` mirrors TopThreeEnhancementsCard's own
 * prop: Account Health Dashboard's accounts are all owned by the same AM
 * (whoever's logged in — see getOwnedCompanies), so that column would be a
 * constant there and is simply omitted.
 *
 * `topThreeOnly` (Sep 2026, Aaron) renders this exact same component
 * filtered to `isTopThree` items — used for a dedicated "Top 3 Enhancement
 * Requests" section placed just above the general one on both dashboards,
 * distinct from TopThreeEnhancementsCard.jsx's stat-tile-that-opens-a-drawer
 * (that one stays as the quick-glance/portfolio-wide count at the top of
 * the page; this is the same full stats/chart/table treatment as "all
 * enhancement requests," just pre-filtered). The "Top 3?" column and the
 * redundant "Also Ranked Top 3" stat tile are hidden in this mode since
 * every row would trivially read "Yes."
 */

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function tierStr(tier) {
  return (tier == null || tier === 0) ? '—' : `Tier ${tier}`;
}

function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}

const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];
// Same canonical tier palette as every other tier chart across all 3
// dashboards (Sep 2026, Aaron: "verify that all tier related reports are
// consistent with 1 = green, 2 = blue, 3 = orange, 4 = red... make it much
// easier to compare apples to apples"). Duplicated, not shared/imported —
// per this codebase's per-file convention — but the literal hex values
// must be kept in sync with AccountHealthDashboard.jsx/TeamAmDashboard.jsx's
// own TIER_COST_COLOR.
const TIER_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unassigned: '#737373' };
function tierSort(a, b) {
  const ai = TIER_ORDER.indexOf(a.name);
  const bi = TIER_ORDER.indexOf(b.name);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}

// Opened vs. Closed trend chart's "Break Out by AM" line colors (Sep 2026,
// Aaron) — duplicated, not imported, per this codebase's per-file
// convention (see TIER_COLOR above), but the literal values must stay in
// sync with TeamAmDashboard.jsx's own copies of these three constants.
const PIE_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4d7c0f', '#9333ea'];
const AM_LINE_COLOR_OVERRIDES = { 'Patrick Noack': '#16a34a', 'Aaron Whitmer': '#2563eb' };
const AM_LINE_COLOR_FALLBACK = PIE_COLORS.filter((c) => c !== '#16a34a' && c !== '#2563eb');

function CompanyLink({ account, children }) {
  if (!account.hubspotUrl) return <span>{children}</span>;
  return (
    <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">
      {children}
    </a>
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
 * Flattens every account's enhancementRequests into one array, attaching
 * account-level context (company, AM, tier, ARR, size) plus each ticket's
 * 1-indexed position among that company's own open enhancement requests
 * (oldest first) out of that company's total — e.g. "1 of 6".
 */
function flattenEnhancementRequests(accounts, includeAccountManager) {
  const items = [];
  for (const a of accounts) {
    const requests = a.serviceHealth?.enhancementRequests || [];
    const byAge = [...requests].sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || ''));
    byAge.forEach((t, i) => {
      items.push({
        ...t,
        companyName: a.company_name,
        hubspotUrl: a.hubspotUrl,
        ...(includeAccountManager ? { accountManagerName: a.account_manager_name || 'Unassigned' } : {}),
        tier: a.tier,
        arrCents: a.arr_cents,
        totalCapacity: a.total_capacity,
        companyPosition: `${i + 1} of ${byAge.length}`,
      });
    });
  }
  return items;
}

/**
 * Same flatten shape as flattenEnhancementRequests just above, reading
 * `serviceHealth.enhancementClosedItems` instead (Sep 2026, Aaron: "Add 12
 * month tracking... showing opened and closed trends") — feeds the new
 * Opened vs. Closed trend chart's closed-ticket line only, so it skips the
 * table-only fields (companyPosition/arrCents/totalCapacity) that flatten
 * function attaches for the table view.
 */
function flattenClosedEnhancementRequests(accounts, includeAccountManager) {
  const items = [];
  for (const a of accounts) {
    const requests = a.serviceHealth?.enhancementClosedItems || [];
    for (const t of requests) {
      items.push({
        ...t,
        companyName: a.company_name,
        hubspotUrl: a.hubspotUrl,
        ...(includeAccountManager ? { accountManagerName: a.account_manager_name || 'Unassigned' } : {}),
        tier: a.tier,
      });
    }
  }
  return items;
}

/**
 * Trailing-12-months OPEN BACKLOG trend, one point per month-end — same
 * "still open as of month-end" definition as TeamAmDashboard.jsx's
 * computeOpenBacklogSeriesByTier/computeOpenBacklogSeriesByAM, generalized
 * to a single function keyed by whatever `keyFn(item)` returns rather than
 * a fixed tier1-4 set, since this file has no equivalent
 * TIER_SERIES_KEYS constant and needs the same dynamic-key approach for
 * both the tier and AM breakouts.
 */
function computeBacklogSeriesByKey(items, keyFn) {
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
      const key = keyFn(t);
      row[key] = (row[key] || 0) + 1;
    }
    return row;
  });
}

/**
 * Trailing-12-months CLOSED count, one point per month (not cumulative) —
 * same definition as TeamAmDashboard.jsx's computeClosedTicketVolumeByMonth,
 * generalized to a dynamic `keyFn(item)` key the same way as
 * computeBacklogSeriesByKey above (e.g. a fixed `() => 'total'` for the
 * plain "Show Closed" overlay, or the tier/AM keyFn when a breakout is
 * active).
 */
function computeClosedSeriesByKey(items, keyFn) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1)));

  return months.map((monthStart) => {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const row = { label, total: 0 };
    for (const t of items) {
      if (!t.closedAt) continue;
      const closed = new Date(t.closedAt);
      if (closed < monthStart || closed > monthEnd) continue;
      row.total += 1;
      const key = keyFn(t);
      row[key] = (row[key] || 0) + 1;
    }
    return row;
  });
}

/** Reads whichever tier/AM keys are actually present on the row — same idea as TeamAmDashboard.jsx's OpenTicketVolumeTooltip/OpenTicketVolumeByAmTooltip, generalized into one tooltip since both breakouts here share the same dynamic-key row shape. */
function EnhancementVolumeTooltip({ active, payload, label, showClosed, keysPresent }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const breakdown = keysPresent.filter((k) => d[k] > 0);
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{label}: {d.total} open</p>
      {showClosed && <p className="text-neutral-600 mb-1">{d.closed} closed that month</p>}
      {breakdown.length > 0 ? (
        breakdown.map((k) => (
          <p key={k} className="text-neutral-600">{k}: {d[k]}</p>
        ))
      ) : (
        <p className="text-neutral-400 italic">No breakdown data</p>
      )}
    </div>
  );
}

/**
 * "Opened vs. Closed — Trailing 12 Months" trend chart for the Enhancement
 * Requests section (Sep 2026, Aaron: "Add 12 month tracking ala the Ticket
 * Activity section... showing opened and closed trends -- could also break
 * out by tier and AM"). Mirrors TeamAmDashboard.jsx's OpenTicketVolumeChart
 * exactly — same `breakout` state machine ('none'|'tier'|'am'), same
 * Show Closed/Break Out by Tier/Break Out by AM toggle behavior — but the
 * "Break Out by AM" button is omitted entirely (not just hidden) when
 * `includeAccountManager` is false, since Account Health's two call sites
 * pass that prop false (its accounts are all one AM's own book, where an AM
 * breakout would be a constant single line).
 */
function EnhancementVolumeTrendChart({ openItems, closedItems, includeAccountManager }) {
  const [breakout, setBreakout] = useState('none'); // 'none' | 'tier' | 'am'
  const [showClosed, setShowClosed] = useState(false);
  const closedVisible = showClosed && breakout === 'none';

  const tierKeyFn = (t) => tierLabel(t.tier);
  const amKeyFn = (t) => t.accountManagerName || 'Unassigned';

  const data = useMemo(() => computeBacklogSeriesByKey(openItems, tierKeyFn), [openItems]);
  const amData = useMemo(() => computeBacklogSeriesByKey(openItems, amKeyFn), [openItems]);
  const closedByMonth = useMemo(() => computeClosedSeriesByKey(closedItems, () => 'total'), [closedItems]);
  const combinedData = useMemo(
    () => data.map((row, i) => ({ ...row, closed: closedByMonth[i]?.total ?? 0 })),
    [data, closedByMonth]
  );

  const tierKeysPresent = useMemo(() => {
    const totals = {};
    for (const row of data) {
      for (const k of Object.keys(row)) {
        if (k === 'label' || k === 'total') continue;
        totals[k] = (totals[k] || 0) + row[k];
      }
    }
    return Object.keys(totals).filter((k) => totals[k] > 0).sort((a, b) => tierSort({ name: a }, { name: b }));
  }, [data]);

  // Sorted by total volume desc (busiest AM first), same "discover the real
  // keys from the data" approach as TeamAmDashboard.jsx's amKeysPresent —
  // AM names aren't a fixed small set like tiers.
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

  if (!openItems.some((t) => t.createdAt)) {
    return <p className="text-sm text-neutral-500 italic">No dated requests to chart yet — click Refresh to pull the latest.</p>;
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
        {includeAccountManager && (
          <button
            onClick={() => setBreakout((v) => (v === 'am' ? 'none' : 'am'))}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              breakout === 'am' ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            {breakout === 'am' ? '← Show Total' : 'Break Out by AM'}
          </button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={breakout === 'am' ? amData : combinedData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip content={<EnhancementVolumeTooltip showClosed={closedVisible} keysPresent={breakout === 'am' ? amKeysPresent : tierKeysPresent} />} />
          {breakout === 'tier' ? (
            <>
              <Legend />
              {tierKeysPresent.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={k}
                  stroke={TIER_COLOR[k] || '#737373'}
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
              <Line type="monotone" dataKey="total" name="Open Requests" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
                <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1e293b' }} />
              </Line>
              {closedVisible && (
                <Line type="monotone" dataKey="closed" name="Closed Requests (that month)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
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

function EnhancementsByTierChart({ items }) {
  const byTier = {};
  for (const t of items) {
    const key = tierLabel(t.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier).map(([name, count]) => ({ name, count })).sort(tierSort);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No open enhancement requests to break down.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" name="Open Enhancement Requests" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COLOR[d.name] || '#737373'} />)}
          <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const HEATMAP_WEEKS = 53;
const HEATMAP_LEVEL_COLOR = ['#ebedf0', '#c6dcf5', '#8bbcec', '#4f92dd', '#2563eb'];

/** count -> one of 5 shade levels, same idea as GitHub's contribution graph (0 = none, then roughly-even buckets up to the observed max). */
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
 * Trailing-12-months, GitHub-style contribution heatmap of request creation
 * dates — no calendar/heatmap library exists in this codebase, so this is
 * plain CSS grid (grid-auto-flow: column fills week-by-week, matching how
 * GitHub's own graph lays out) with a native `title` tooltip per cell,
 * rather than pulling in a new dependency for one small visual.
 */
function EnhancementCalendarHeatmap({ items }) {
  const { cells, monthLabels } = useMemo(() => {
    const countByDate = {};
    for (const t of items) {
      if (!t.createdAt) continue;
      const day = t.createdAt.slice(0, 10);
      countByDate[day] = (countByDate[day] || 0) + 1;
    }
    const max = Math.max(0, ...Object.values(countByDate));

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    // Align the grid to end-of-week (Saturday) and start 53 full weeks back,
    // aligned to a Sunday, so every week column has all 7 days.
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
  }, [items]);

  const hasAny = items.some((t) => t.createdAt);
  if (!hasAny) {
    return <p className="text-sm text-neutral-500 italic">No dated requests to map yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: HEATMAP_WEEKS * 13, position: 'relative', height: 14, marginBottom: 4 }}>
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
          minWidth: HEATMAP_WEEKS * 13,
        }}
      >
        {cells.map((c) => (
          <div
            key={c.iso}
            title={c.count == null ? '' : `${c.iso}: ${c.count} request${c.count === 1 ? '' : 's'}`}
            style={{
              width: 11, height: 11, borderRadius: 2,
              background: c.level == null ? 'transparent' : HEATMAP_LEVEL_COLOR[c.level],
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1 mt-2 text-xs text-neutral-400">
        <span>Fewer</span>
        {HEATMAP_LEVEL_COLOR.map((color) => (
          <span key={color} style={{ width: 11, height: 11, borderRadius: 2, background: color, display: 'inline-block' }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export default function EnhancementRequestsSection({ accounts, includeAccountManager = false, topThreeOnly = false }) {
  const [sort, setSort] = useState({ column: 'daysOpen', direction: 'desc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const items = useMemo(() => {
    const all = flattenEnhancementRequests(accounts, includeAccountManager);
    return topThreeOnly ? all.filter((t) => t.isTopThree) : all;
  }, [accounts, includeAccountManager, topThreeOnly]);

  const closedItems = useMemo(() => {
    const all = flattenClosedEnhancementRequests(accounts, includeAccountManager);
    return topThreeOnly ? all.filter((t) => t.isTopThree) : all;
  }, [accounts, includeAccountManager, topThreeOnly]);

  const avgAgeDays = items.length
    ? Math.round(items.reduce((sum, t) => sum + (t.daysOpen || 0), 0) / items.length)
    : null;
  const topThreeCount = items.filter((t) => t.isTopThree).length;

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [items, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportEnhancementRequests(items, includeAccountManager, topThreeOnly);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className={`grid grid-cols-2 ${topThreeOnly ? '' : 'md:grid-cols-3'} gap-4 mb-6`}>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">{topThreeOnly ? 'Enhancement Requests: Top 3' : 'Open Enhancement Requests'}</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{items.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Average Age</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{avgAgeDays != null ? `${avgAgeDays}d` : '—'}</p>
        </div>
        {!topThreeOnly && (
          <div className="card">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Also Ranked Top 3</p>
            <p className="text-2xl font-bold text-primary-900 mt-1">{topThreeCount}</p>
          </div>
        )}
      </div>

      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Opened vs. Closed — Trailing 12 Months</h3>
        <EnhancementVolumeTrendChart openItems={items} closedItems={closedItems} includeAccountManager={includeAccountManager} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">By Client Tier</h3>
          <EnhancementsByTierChart items={items} />
        </div>
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Requests Created — Trailing 12 Months</h3>
          <EnhancementCalendarHeatmap items={items} />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-primary-900 text-sm">{topThreeOnly ? 'Enhancement Requests: Top 3' : 'All Open Enhancement Requests'}</h3>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} disabled={exporting || items.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          {topThreeOnly ? 'No accounts have a Top 3 Enhancement Request set yet.' : 'No open enhancement requests found — click Refresh to pull the latest.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                {includeAccountManager && (
                  <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                )}
                <SortableHeader label="Enhancement" column="subject" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Request Date" column="createdAt" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Days Open" column="daysOpen" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Next Step" column="nextStep" sort={sort} onSort={toggleSort} className="pr-4" />
                {!topThreeOnly && (
                  <SortableHeader label="Top 3?" column="isTopThree" sort={sort} onSort={toggleSort} className="pr-4" />
                )}
                <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Size" column="totalCapacity" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="ARR" column="arrCents" sort={sort} onSort={toggleSort} className="pr-4" />
                <th className="pb-2">Company Requests</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.ticketId} className="border-t border-neutral-100">
                  <td className="py-2 pr-4"><CompanyLink account={t}>{t.companyName}</CompanyLink></td>
                  {includeAccountManager && <td className="py-2 pr-4 text-neutral-500">{t.accountManagerName}</td>}
                  <td className="py-2 pr-4">
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{t.subject}</a>
                    ) : t.subject}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.daysOpen ?? '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 max-w-xs truncate" title={t.nextStep || ''}>{t.nextStep || '—'}</td>
                  {!topThreeOnly && <td className="py-2 pr-4 text-neutral-500">{t.isTopThree ? 'Yes' : 'No'}</td>}
                  <td className="py-2 pr-4 text-neutral-500">{tierStr(t.tier)}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.totalCapacity ?? '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{currencyStr(t.arrCents)}</td>
                  <td className="py-2 text-neutral-500 whitespace-nowrap">{t.companyPosition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
