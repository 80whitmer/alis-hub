import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, LineChart, Line, Legend,
} from 'recharts';

/**
 * Tier-rolled-up portfolio KPIs, each with a daily trend — ported from
 * alis-product-ops's KpiCharts.jsx (Aaron, Sep 2026). Shared by Team AM
 * (team-wide, plus the by-AM averages) and Account Health (just the
 * accounts you own). Data comes from GET /api/<page>/tier-kpis, computed
 * server-side by server/services/tierKpiRollup.js; a trend point is
 * recorded on every Refresh. ARR by Tier / ARR Added by Tier aren't
 * repeated here — the page's own "ARR by Tier" section already trends both.
 */

export const TIER_KPI_TITLE = 'Tier KPIs';
export const AM_KPI_TITLE = 'Tier KPIs by AM';

const TIER_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', 'Tier 5': '#7c3aed', Unassigned: '#737373' };
const PALETTE = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4d7c0f', '#9333ea'];

const usd = (cents) => (!cents ? '$0' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const count = (n) => Math.round(n || 0).toLocaleString('en-US');

function useTierKpis(endpoint) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
        if (!cancelled) setState({ data: body, error: '' });
      })
      .catch((err) => !cancelled && setState({ data: null, error: err.message }));
    return () => { cancelled = true; };
  }, [endpoint]);
  return state;
}

function TrendEmptyState() {
  return (
    <p className="text-sm text-neutral-500 italic">
      Not enough history yet — a point is captured on each Refresh. Check back after a few days of refreshes to see the trend.
    </p>
  );
}

/** Flat {scope_key, metric_key, recorded_date, value} rows → one row per day with a column per scope key, optionally dividing by a second metric for the same day. */
function pivot(history, numeratorKey, denominatorKey) {
  const byDate = new Map();
  const denoms = new Map();
  for (const r of history) {
    if (r.metric_key === denominatorKey) denoms.set(`${r.recorded_date}|${r.scope_key}`, r.value);
  }
  for (const r of history) {
    if (r.metric_key !== numeratorKey) continue;
    if (!byDate.has(r.recorded_date)) byDate.set(r.recorded_date, { date: r.recorded_date });
    if (denominatorKey) {
      const d = denoms.get(`${r.recorded_date}|${r.scope_key}`);
      if (d) byDate.get(r.recorded_date)[r.scope_key] = r.value / d;
    } else {
      byDate.get(r.recorded_date)[r.scope_key] = r.value;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function TrendChart({ rows, keys, colorFor, formatValue }) {
  const present = keys.filter((k) => rows.some((r) => r[k] != null));
  if (rows.length < 2 || present.length === 0) return <TrendEmptyState />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickFormatter={formatValue} width={70} />
        <Tooltip formatter={(v) => formatValue(v)} />
        <Legend />
        {present.map((k) => (
          <Line key={k} type="monotone" dataKey={k} name={k} stroke={colorFor(k)} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * One KPI: bars per scope key (tier or AM) for today, plus its trend.
 * With `denominatorKey`, the value is a ratio of two tracked metrics
 * (e.g. arrCents ÷ companyCount = average ARR per company) — trended by
 * dividing the two histories day by day, so no extra storage.
 */
function KpiBlock({ title, description, buckets, keys, history, metricKey, denominatorKey, colorFor, formatValue }) {
  const bars = keys
    .map((key) => {
      const b = buckets?.[key];
      if (!b) return null;
      if (!denominatorKey) return { key, value: b[metricKey] || 0 };
      return b[denominatorKey] > 0 ? { key, value: (b[metricKey] || 0) / b[denominatorKey] } : null;
    })
    .filter(Boolean);
  const trendRows = useMemo(() => pivot(history, metricKey, denominatorKey), [history, metricKey, denominatorKey]);
  const angled = bars.length > 6;

  return (
    <div className="mb-8 pb-8 border-b border-neutral-100 last:border-b-0 last:pb-0 last:mb-0">
      <h3 className="font-semibold text-primary-900 text-sm mb-1">{title}</h3>
      {description && <p className="text-xs text-neutral-500 mb-3">{description}</p>}
      <div className="mb-4">
        {bars.every((d) => !d.value) ? (
          <p className="text-sm text-neutral-500 italic">Nothing to break down yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={angled ? 290 : 260}>
            <BarChart data={bars} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="key" tick={{ fontSize: 12 }} interval={0} angle={angled ? -30 : 0} textAnchor={angled ? 'end' : 'middle'} height={angled ? 70 : 30} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} tickFormatter={formatValue} width={70} />
              <Tooltip formatter={(v) => formatValue(v)} />
              <Bar dataKey="value" name={title} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {bars.map((d) => <Cell key={d.key} fill={colorFor(d.key)} />)}
                <LabelList dataKey="value" position="top" formatter={formatValue} style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Trend</h4>
      <TrendChart rows={trendRows} keys={keys} colorFor={colorFor} formatValue={formatValue} />
    </div>
  );
}

function ArrBandBlock({ current, history }) {
  const data = current.byArrBand;
  const tiers = current.tiers;
  const trendRows = useMemo(() => pivot(history, 'companyCount'), [history]);
  const bands = data.map((d) => d.band);
  return (
    <div className="mb-8 pb-8 border-b border-neutral-100">
      <h3 className="font-semibold text-primary-900 text-sm mb-1">Companies by ARR</h3>
      <p className="text-xs text-neutral-500 mb-3">How many accounts fall into each ARR band, each bar split by tier.</p>
      <div className="mb-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="band" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {tiers.map((tier, i) => (
              <Bar key={tier} dataKey={tier} name={tier} stackId="tier" fill={TIER_COLOR[tier] || '#737373'} isAnimationActive={false} radius={i === tiers.length - 1 ? [4, 4, 0, 0] : undefined}>
                {i === tiers.length - 1 && <LabelList dataKey="companyCount" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Trend</h4>
      <TrendChart rows={trendRows} keys={bands} colorFor={(b) => PALETTE[bands.indexOf(b) % PALETTE.length]} formatValue={count} />
    </div>
  );
}

function LoadState({ error }) {
  return error
    ? <p className="text-sm text-red-600">{error}</p>
    : <p className="text-sm text-neutral-500">Loading…</p>;
}

/** Every tier KPI. `scopeNote` says whose accounts these are (team-wide vs. yours). */
export default function TierKpiSection({ endpoint, scopeNote }) {
  const { data, error } = useTierKpis(endpoint);
  if (!data) return <LoadState error={error} />;
  const { current, history } = data;
  const tiers = current.tiers;
  const year = new Date().getFullYear();
  const tierColor = (t) => TIER_COLOR[t] || '#737373';
  const common = { buckets: current.byTier, keys: tiers, history: history.tier, colorFor: tierColor };

  return (
    <>
      {scopeNote && <p className="text-xs text-neutral-500 mb-6">{scopeNote}</p>}
      <KpiBlock {...common} title="Companies by Tier" metricKey="companyCount" formatValue={count} />
      <KpiBlock {...common} title="Communities by Tier" metricKey="communityCount" formatValue={count} description="Active (non-canceled) communities under each account." />
      <ArrBandBlock current={current} history={history.arrBand} />
      <KpiBlock
        {...common} title={`Companies Contributing ARR (${year}) by Tier`} metricKey="companiesContributingArr" formatValue={count}
        description="Accounts with at least one deal closed-won this calendar year carrying ARR."
      />
      <KpiBlock
        {...common} title={`Communities Contributing ARR (${year}) by Tier`} metricKey="communitiesContributingArr" formatValue={count}
        description="Approximation: the active community count of the accounts above — deals attach to the Home Office, so which communities a deal covered isn't tracked."
      />
      <KpiBlock {...common} title="Average ARR per Company by Tier" metricKey="arrCents" denominatorKey="companyCount" formatValue={usd} />
      <KpiBlock {...common} title="Average ARR per Community by Tier" metricKey="arrCents" denominatorKey="communityCount" formatValue={usd} />
      <KpiBlock
        {...common} title="Average Capacity (beds) per Community by Tier" metricKey="capacityBeds" denominatorKey="communitiesWithCapacity" formatValue={count}
        description="Beds per community. Uses ALIS capacity where occupancy has been refreshed, else HubSpot's company capacity; accounts with neither are left out of both sides of the average."
      />
    </>
  );
}

/** Team AM only: the same averages broken out by Account Manager, biggest book (by ARR) first. */
export function AmKpiSection({ endpoint }) {
  const { data, error } = useTierKpis(endpoint);
  const amKeys = useMemo(() => {
    const byAm = data?.current?.byAm || {};
    return Object.keys(byAm).sort((a, b) => (byAm[b].arrCents || 0) - (byAm[a].arrCents || 0));
  }, [data]);
  if (!data) return <LoadState error={error} />;
  const { current, history } = data;
  const amColor = (k) => PALETTE[amKeys.indexOf(k) % PALETTE.length];
  const common = { buckets: current.byAm, keys: amKeys, history: history.am, colorFor: amColor };

  return (
    <>
      <KpiBlock {...common} title="Average ARR per Company by AM" metricKey="arrCents" denominatorKey="companyCount" formatValue={usd} />
      <KpiBlock
        {...common} title="Average Capacity (beds) per Community by AM" metricKey="capacityBeds" denominatorKey="communitiesWithCapacity" formatValue={count}
        description="Same capacity source rule as Tier KPIs: ALIS where refreshed, else HubSpot."
      />
    </>
  );
}
