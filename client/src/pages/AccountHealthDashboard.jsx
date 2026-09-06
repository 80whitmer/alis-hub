import { useEffect, useMemo, useState } from 'react';
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

function AccountDrawer({ account, onClose }) {
  const svc = account.serviceHealth;
  const fin = account.financialHealth;

  return (
    <Drawer
      title={account.company_name}
      subtitle={`HubSpot company ${account.hubspot_company_id}${account.lifecycle_stage ? ` · lifecycle stage ${account.lifecycle_stage}` : ''}`}
      badge={<ScoreBadge score={account.health_score} band={account.health_band === 'Unhealthy' ? 'red' : account.health_band === 'At Risk' ? 'orange' : account.health_band === 'Stable' ? 'blue' : account.health_band === 'Healthy' ? 'green' : null} />}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Open Tickets" value={account.open_ticket_count} />
        <StatCard label="Closed Tickets" value={account.closed_ticket_count} />
        <StatCard label="Open Deals" value={account.open_deal_count} />
        <StatCard label="Open Deal Value" value={currencyStr(account.open_deal_value_cents)} />
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
      {fin?.expansionPipeline?.deals?.length > 0 ? (
        <ul className="text-sm mb-6 space-y-1">
          {fin.expansionPipeline.deals.map((d, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-neutral-700 truncate">{d.name}</span>
              <span className="text-neutral-400 shrink-0">{d.stage} · {currencyStr(d.valueCents)}</span>
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.company_name?.toLowerCase().includes(q));
  }, [accounts, search]);

  const rollup = useMemo(() => {
    const scored = accounts.filter((a) => a.health_score != null);
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, a) => s + a.health_score, 0) / scored.length) : null;
    return {
      totalAccounts: accounts.length,
      openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      openDeals: accounts.reduce((s, a) => s + (a.open_deal_count || 0), 0),
      openDealValueCents: accounts.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
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
                    <th className="pb-2 pr-4">Account</th>
                    <th className="pb-2 pr-4">Health</th>
                    <th className="pb-2 pr-4">Open Tickets</th>
                    <th className="pb-2 pr-4">Closed Tickets</th>
                    <th className="pb-2 pr-4">Open Deals</th>
                    <th className="pb-2">Open Deal Value</th>
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
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={a.health_band === 'Unhealthy' ? 'red' : a.health_band === 'At Risk' ? 'orange' : a.health_band === 'Stable' ? 'blue' : a.health_band === 'Healthy' ? 'green' : null} /></td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.closed_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_deal_count}</td>
                      <td className="py-2 text-neutral-500">{currencyStr(a.open_deal_value_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-neutral-500 italic py-4">No accounts match "{search}".</p>}
            </div>
          </SectionCard>
        </>
      )}

      {selected && <AccountDrawer account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
