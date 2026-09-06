import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import Drawer from '../components/Drawer';

// Matches accountHealthScoring.js's SCORE_BANDS exactly (0-40 red / 40-60
// orange / 60-80 blue / 80-100 green) — kept as a parallel client-side map
// rather than fetched from the server, since these are just display colors
// for a score the server already computed and returned.
const BAND_COLOR = { red: '#dc2626', orange: '#ea580c', blue: '#2563eb', green: '#16a34a' };

function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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

function StatCard({ label, value }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
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

function CategoryMixChart({ accounts }) {
  const byCategory = {};
  for (const a of accounts) {
    const mix = a.serviceHealth?.ticketCategoryMix || {};
    for (const [cat, counts] of Object.entries(mix)) {
      byCategory[cat] = (byCategory[cat] || 0) + (counts.total || 0);
    }
  }
  const data = Object.entries(byCategory)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={140} />
        <Tooltip />
        <Bar dataKey="total" fill="#2563eb" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function DealTypeChart({ accounts }) {
  const byType = {};
  for (const a of accounts) {
    const mix = a.financialHealth?.dealsByType || {};
    for (const [type, count] of Object.entries(mix)) {
      byType[type] = (byType[type] || 0) + count;
    }
  }
  const data = Object.entries(byType)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No deal data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626'][i % 5]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function isPastDue(deal) {
  return deal.isOpen && deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date();
}

function AccountDrawer({ account, onClose }) {
  const svc = account.serviceHealth;
  const fin = account.financialHealth;
  const openDeals = (fin?.expansionPipeline?.deals || []).filter((d) => d.isOpen);

  return (
    <Drawer
      title={account.company_name}
      subtitle={`HubSpot company ${account.hubspot_company_id}${account.lifecycle_stage ? ` · lifecycle stage ${account.lifecycle_stage}` : ''}`}
      badge={<ScoreBadge score={account.health_score} band={BAND_LABEL_TO_COLOR[account.health_band] || null} />}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Open Tickets" value={account.open_ticket_count} />
        <StatCard label="Closed Tickets" value={account.closed_ticket_count} />
        <StatCard label="Open Deals" value={account.open_deal_count} />
        <StatCard label="Open Deal Value" value={currencyStr(account.open_deal_value_cents)} />
        <StatCard label="ARR" value={account.arr_cents != null ? currencyStr(account.arr_cents) : '—'} />
      </div>

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
      description={`Open + recently-closed (90 days) across every account — ${filtered.length} of ${allDeals.length} shown`}
    >
      {allDeals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No deals yet — click Refresh to pull them.</p>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/account-health');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
      setAccounts(data.accounts || []);
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
    return {
      totalAccounts: accounts.length,
      openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      openDeals: accounts.reduce((s, a) => s + (a.open_deal_count || 0), 0),
      openDealValueCents: accounts.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
      arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">Account Health</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {rollup.totalAccounts} HubSpot accounts you own
            {refreshResult && ` · last refresh: ${refreshResult.companyCount} accounts, ${refreshResult.errorCount} error(s)`}
          </p>
        </div>
        <RefreshButton onRefreshed={handleRefreshed} />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Accounts" value={rollup.totalAccounts} />
            <StatCard label="Open Tickets" value={rollup.openTickets} />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} />
            <StatCard label="Open Deals" value={rollup.openDeals} />
            <StatCard label="Open Deal Value" value={currencyStr(rollup.openDealValueCents)} />
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <SectionCard title="Tickets by Category 2.0" description="Aggregated across every account, open + closed">
              <CategoryMixChart accounts={accounts} />
            </SectionCard>
            <SectionCard title="Deals by Type" description="Aggregated across every account's deal history">
              <DealTypeChart accounts={accounts} />
            </SectionCard>
          </div>

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
                    <SortableHeader label="Health" column="health_score" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Tickets" column="open_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Closed Tickets" column="closed_ticket_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deals" column="open_deal_count" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Open Deal Value" column="open_deal_value_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr
                      key={a.hubspot_company_id}
                      className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                      onClick={() => setSelected(a)}
                    >
                      <td className="py-2 pr-4 text-neutral-700 font-medium">{a.company_name}</td>
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={BAND_LABEL_TO_COLOR[a.health_band] || null} /></td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.closed_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_deal_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{currencyStr(a.open_deal_value_cents)}</td>
                      <td className="py-2 text-neutral-500">{a.arr_cents != null ? currencyStr(a.arr_cents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-neutral-500 italic py-4">No accounts match "{search}".</p>}
            </div>
          </SectionCard>

          <DealsSection accounts={accounts} />
        </>
      )}

      {selected && <AccountDrawer account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
