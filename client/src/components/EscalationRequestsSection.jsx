import { useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, LineChart, Line, Legend,
} from 'recharts';
import { exportEscalationTickets } from '../utils/escalationTicketsExport';
import PinnedNoteButton from './PinnedNote';

/**
 * Portfolio-wide "Escalation Tickets" section (Sep 2026) — every OPEN
 * ticket whose category_2_0 is HubSpot's own "ALIS Bug" option (displayed
 * as "ALIS Escalation" — see server/services/hubspotTickets.js's
 * isEscalation). Same architecture as EnhancementRequestsSection.jsx:
 * each account's `serviceHealth.alisEscalationOpenItems` (computed
 * server-side, see accountHealth.js's mapLiveServiceHealth) is already
 * loaded by the dashboard — this component does all cross-account
 * aggregation (stats, tier chart, calendar, table) client-side, no new
 * API calls. No "Top 3?" concept here — escalations aren't ranked the way
 * enhancement requests are, so this is structurally closest to that
 * component's topThreeOnly mode (2 stat tiles, no Top 3 column).
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
 * Flattens every account's alisEscalationOpenItems into one array,
 * attaching account-level context (company, AM, tier, ARR, size) plus
 * each ticket's 1-indexed position among that company's own open
 * escalations (oldest first) out of that company's total — e.g. "1 of 3".
 */
function flattenEscalationTickets(accounts, includeAccountManager) {
  const items = [];
  for (const a of accounts) {
    const requests = a.serviceHealth?.alisEscalationOpenItems || [];
    const byAge = [...requests].sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || ''));
    byAge.forEach((t, i) => {
      items.push({
        ...t,
        companyName: a.company_name,
        hubspotCompanyId: a.hubspot_company_id,
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
 * Flattens every account's alisEscalationClosedItems for the "Closed —
 * Trailing 12 Months" heatmap and the open-escalations trend line below —
 * deliberately a separate array from flattenEscalationTickets above (which
 * stays open-only, feeding the stat tiles / tier chart / table that are
 * this section's whole "what's still outstanding" point). Carries `tier`
 * (Aaron, Sep 2026: trend line's "by tier" toggle) even though the heatmap
 * itself only reads closedAt — same account-level attach as
 * flattenEscalationTickets does for open items.
 */
function flattenClosedEscalationTickets(accounts) {
  const items = [];
  for (const a of accounts) {
    const closed = a.serviceHealth?.alisEscalationClosedItems || [];
    for (const t of closed) items.push({ ...t, tier: a.tier });
  }
  return items;
}

function EscalationsByTierChart({ items }) {
  const byTier = {};
  for (const t of items) {
    const key = tierLabel(t.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier).map(([name, count]) => ({ name, count })).sort(tierSort);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No open escalation tickets to break down.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" name="Open Escalation Tickets" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COLOR[d.name] || '#737373'} />)}
          <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * "Trailing open escalation ticket[s]" line graph (Aaron, Sep 2026: "add a
 * trailing open escalation ticket line graph - total and then toggle to
 * split out by tier... visual for high value resolution and advocation
 * action"). A true reconstructed history, not an approximation: replays
 * each ticket's own createdAt (open + closed items both have one) and
 * closedAt (closed items only — still-open tickets never got one) week by
 * week, counting a ticket as open on a given week-ending date whenever it
 * was created on or before that date and not yet closed as of it. Needs no
 * new snapshot table — unlike the AM KPI dropdown's portfolio-SUM metrics
 * (which only exist as of "right now" and genuinely need a captured daily
 * point to trend), a per-ticket open/close date pair already carries its
 * whole history, so the past can be replayed directly from data already on
 * the page.
 */
function computeOpenEscalationTrend(openItems, closedItems, weeks = 52) {
  const episodes = [
    ...openItems.map((t) => ({ tier: tierLabel(t.tier), createdAt: t.createdAt, closedAt: null })),
    ...closedItems.map((t) => ({ tier: tierLabel(t.tier), createdAt: t.createdAt, closedAt: t.closedAt })),
  ].filter((e) => e.createdAt);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const tiersSeen = new Set();
  const rows = Array.from({ length: weeks }, (_, i) => {
    const weekEnd = new Date(end);
    weekEnd.setUTCDate(weekEnd.getUTCDate() - (weeks - 1 - i) * 7);
    const row = { date: weekEnd.toISOString().slice(0, 10), total: 0 };
    for (const e of episodes) {
      const created = new Date(e.createdAt);
      if (created > weekEnd) continue;
      if (e.closedAt && new Date(e.closedAt) <= weekEnd) continue;
      row.total += 1;
      row[e.tier] = (row[e.tier] || 0) + 1;
      tiersSeen.add(e.tier);
    }
    return row;
  });
  return { rows, tierKeys: TIER_ORDER.filter((t) => tiersSeen.has(t)) };
}

function OpenEscalationTrendChart({ openItems, closedItems }) {
  const [splitByTier, setSplitByTier] = useState(false);
  const { rows, tierKeys } = useMemo(() => computeOpenEscalationTrend(openItems, closedItems), [openItems, closedItems]);

  if (!rows.some((r) => r.total > 0)) {
    return <p className="text-sm text-neutral-500 italic">No dated escalations to trend yet.</p>;
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        <div className="flex gap-1">
          {[{ key: false, label: 'Total' }, { key: true, label: 'By Tier' }].map((opt) => (
            <button
              key={String(opt.key)}
              type="button"
              onClick={() => setSplitByTier(opt.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                splitByTier === opt.key ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={Math.max(0, Math.ceil(rows.length / 12) - 1)} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip />
          {splitByTier ? (
            <>
              <Legend />
              {tierKeys.map((t) => (
                <Line key={t} type="monotone" dataKey={t} name={t} stroke={TIER_COLOR[t] || '#737373'} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </>
          ) : (
            <Line type="monotone" dataKey="total" name="Open Escalation Tickets" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

const HEATMAP_WEEKS = 53;
const CREATED_COLOR_SCALE = ['#ebedf0', '#f4c7c3', '#e8938c', '#dc625a', '#dc2626'];
// Same green used by AccountHealthDashboard.jsx's TicketActivityHeatmap for
// its "Closed" heatmap — reused deliberately (not duplicated-then-drifted)
// so "closed" reads the same color across both dashboards.
const CLOSED_COLOR_SCALE = ['#ebedf0', '#c3ead9', '#87d6b3', '#4abf8c', '#10b981'];

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
 * Trailing-12-months, GitHub-style contribution heatmap of escalation
 * created/closed dates — same plain-CSS-grid pattern as
 * EnhancementRequestsSection.jsx's own heatmap and AccountHealthDashboard's
 * TicketActivityHeatmap (duplicated, not shared, matching this codebase's
 * per-component convention). `dateField`/`colorScale`/`emptyLabel` are
 * props (Sep 2026, Aaron) rather than hardcoded to createdAt + red, since
 * this section needs two instances stacked — Created (red, urgency) and
 * Closed (green, matching the Opened/Closed convention already established
 * on Account Health's Ticket Activity heatmap).
 */
function EscalationCalendarHeatmap({ items, dateField, colorScale, emptyLabel }) {
  const { cells, monthLabels } = useMemo(() => {
    const countByDate = {};
    for (const t of items) {
      const value = t[dateField];
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

  const hasAny = items.some((t) => t[dateField]);
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
              title={c.count == null ? '' : `${c.iso}: ${c.count} escalation${c.count === 1 ? '' : 's'}`}
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

export default function EscalationRequestsSection({ accounts, includeAccountManager = false }) {
  const [sort, setSort] = useState({ column: 'daysOpen', direction: 'desc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  // Company search + multiselect Tier filter pills (Sep 2026, Aaron: "put a
  // company search in all the sections with 'Company' tables... filter
  // pills that can be multiselected") — same pattern as
  // EnhancementRequestsSection's own copy of this. `items` stays the full
  // unfiltered set (drives the stat tiles/charts above); only the table
  // narrows to `filteredItems`.
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState(() => new Set());

  const items = useMemo(() => flattenEscalationTickets(accounts, includeAccountManager), [accounts, includeAccountManager]);
  const closedItems = useMemo(() => flattenClosedEscalationTickets(accounts), [accounts]);

  const searchFilteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      t.companyName?.toLowerCase().includes(q) ||
      t.accountManagerName?.toLowerCase().includes(q) ||
      t.subject?.toLowerCase().includes(q) ||
      t.nextStep?.toLowerCase().includes(q)
    );
  }, [items, search]);

  const filteredItems = useMemo(() => {
    if (tierFilter.size === 0) return searchFilteredItems;
    return searchFilteredItems.filter((t) => tierFilter.has(tierLabel(t.tier)));
  }, [searchFilteredItems, tierFilter]);

  const avgAgeDays = items.length
    ? Math.round(items.reduce((sum, t) => sum + (t.daysOpen || 0), 0) / items.length)
    : null;

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filteredItems, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportEscalationTickets(filteredItems, includeAccountManager);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Open Escalation Tickets</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{items.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Average Age</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{avgAgeDays != null ? `${avgAgeDays}d` : '—'}</p>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">By Client Tier</h3>
        <EscalationsByTierChart items={items} />
      </div>

      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Open Escalation Tickets — Trailing 12 Months</h3>
        <OpenEscalationTrendChart openItems={items} closedItems={closedItems} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Escalations Created — Trailing 12 Months</h3>
          <EscalationCalendarHeatmap items={items} dateField="createdAt" colorScale={CREATED_COLOR_SCALE} emptyLabel="No dated escalations to map yet." />
        </div>
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Escalations Closed — Trailing 12 Months</h3>
          <EscalationCalendarHeatmap items={closedItems} dateField="closedAt" colorScale={CLOSED_COLOR_SCALE} emptyLabel="No closed escalations to map yet." />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-primary-900 text-sm">Open Escalation Tickets</h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search company, AM, subject, or next step…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
          />
          <button onClick={handleExport} disabled={exporting || filteredItems.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {TIER_ORDER.filter((t) => t !== 'Tier 5').map((t) => {
            const tCount = searchFilteredItems.filter((r) => tierLabel(r.tier) === t).length;
            if (tCount === 0) return null;
            return (
              <button
                key={t}
                onClick={() => setTierFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(t)) next.delete(t); else next.add(t);
                  return next;
                })}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  tierFilter.has(t)
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {t} ({tCount})
              </button>
            );
          })}
          {tierFilter.size > 0 && (
            <button onClick={() => setTierFilter(new Set())} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
              Clear filter
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No open escalation tickets found — click Refresh to pull the latest.</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No escalations match that search/filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                {includeAccountManager && (
                  <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                )}
                <SortableHeader label="Escalation" column="subject" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Request Date" column="createdAt" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Days Open" column="daysOpen" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Next Step" column="nextStep" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Size" column="totalCapacity" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="ARR" column="arrCents" sort={sort} onSort={toggleSort} className="pr-4" />
                <th className="pb-2">Company Escalations</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                // Compound key, not bare ticketId — confirmed live (Sep
                // 2026) a real ticket can be associated with more than one
                // of Aaron's companies in HubSpot (e.g. ticket 48456650622
                // tied to both NorthCare Management LLC and Tenfold Senior
                // Living), so the same ticketId can legitimately appear
                // twice here, once per company — a bare key collided and
                // triggered a React duplicate-key warning.
                <tr key={`${t.hubspotCompanyId}-${t.ticketId}`} className="border-t border-neutral-100">
                  <td className="py-2 pr-4"><CompanyLink account={t}>{t.companyName}</CompanyLink></td>
                  {includeAccountManager && <td className="py-2 pr-4 text-neutral-500">{t.accountManagerName}</td>}
                  <td className="py-2 pr-4">
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{t.subject}</a>
                    ) : t.subject}
                    <PinnedNoteButton noteId={t.pinnedNoteId} title={t.subject} />
                  </td>
                  <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.daysOpen ?? '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 max-w-xs truncate" title={t.nextStep || ''}>{t.nextStep || '—'}</td>
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
