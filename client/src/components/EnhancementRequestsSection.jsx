import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
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
function tierSort(a, b) {
  const ai = TIER_ORDER.indexOf(a.name);
  const bi = TIER_ORDER.indexOf(b.name);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}

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
        <Bar dataKey="count" name="Open Enhancement Requests" fill="#2563eb" radius={[4, 4, 0, 0]}>
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
          <p className="text-xs text-neutral-500 uppercase tracking-wide">{topThreeOnly ? 'Top 3 Enhancement Requests' : 'Open Enhancement Requests'}</p>
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
        <h3 className="font-semibold text-primary-900 text-sm">{topThreeOnly ? 'Top 3 Enhancement Requests' : 'All Open Enhancement Requests'}</h3>
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
                  <SortableHeader label="Account Manager" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
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
