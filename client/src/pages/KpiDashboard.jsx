import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { exportResidentsNeedingAttention } from '../utils/residentsAttentionExport';
import { exportInactiveStaff } from '../utils/inactiveStaffExport';
import { exportDso } from '../utils/dsoExport';
import { exportPpd } from '../utils/ppdExport';
import { exportLos } from '../utils/losExport';
import { exportIncidentCompletion } from '../utils/incidentCompletionExport';
import Drawer from '../components/Drawer';

const SEVERITY_BADGE = {
  risk: 'badge-error',
  opportunity: 'badge-info',
  watch: 'badge-warning',
  info: 'badge-neutral',
};

function pctStr(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function currencyStr(n) {
  return n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function daysStr(n) {
  return n == null ? '—' : `${Math.round(n)}d`;
}

function StatCard({ label, value, diff, formatBenchmark = (v) => v }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {diff && diff.benchmark != null && (
        <p className={`text-xs mt-2 font-medium ${diff.better ? 'text-success' : 'text-error'}`}>
          {diff.better ? '▲' : '▼'} ALIS 500: {formatBenchmark(diff.benchmark)}
        </p>
      )}
    </div>
  );
}

function FlagsPanel({ flags }) {
  if (!flags || flags.length === 0) {
    return <p className="text-sm text-neutral-500">No flags this period — all tracked KPIs are at or ahead of the ALIS 500 benchmark.</p>;
  }
  return (
    <div className="space-y-3">
      {flags.map((f, i) => (
        <div key={i} className="card-sm bg-white">
          <div className="flex items-start justify-between gap-3 mb-1">
            <p className="font-semibold text-primary-900 text-sm">{f.title}</p>
            <span className={`badge ${SEVERITY_BADGE[f.severity] || 'badge-neutral'} shrink-0`}>{f.category}</span>
          </div>
          {f.detail && <p className="text-xs text-neutral-600 mb-1">{f.detail}</p>}
          <p className="text-xs italic text-neutral-500">💬 {f.talkingPoint}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Per client feedback (Gallaher, 2026-09-01): a worklist of incident reports
 * still missing documentation (forms) or interventions (tasks) — not just
 * the isComplete flag, since a real pull shows records marked complete that
 * still carry incompleteForms/incompleteTasks > 0. See kpiNormalizer.js's
 * normalizeIncidentCompletion. Fall-related rows are called out — a
 * post-fall intervention is a specific compliance requirement, not just
 * tidiness.
 */
function IncidentCompletionPanel({ data, companyName }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  if (!data?.hasData) {
    return <p className="text-sm text-neutral-500 italic">No incident records for this period.</p>;
  }
  if (data.openItems.length === 0) {
    return <p className="text-sm text-success">✓ All {data.overall.total} incident report(s) this period are fully documented — no open forms or interventions.</p>;
  }

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportIncidentCompletion(data, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const communitiesWithOpenItems = data.byCommunity.filter((c) => c.openItemCount > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-primary-900 text-sm">Incident reports needing completion ({data.openItems.length})</h3>
        <button onClick={handleExport} disabled={exporting} className="btn btn-sm btn-secondary">
          {exporting ? 'Exporting…' : '⬇ Export to Excel'}
        </button>
      </div>
      {exportError && <p className="text-xs text-error mb-2">{exportError}</p>}
      {communitiesWithOpenItems.length > 1 && (
        <div className="mb-3 space-y-1">
          {communitiesWithOpenItems.map((c) => (
            <div key={`${c.host}::${c.communityId}`} className="flex justify-between text-sm">
              <span className="text-neutral-700">{c.name}</span>
              <span className="text-neutral-500">{c.openItemCount} open · {pctStr(c.pctComplete)} fully documented</span>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
              <th className="pb-2 pr-4">Resident</th>
              <th className="pb-2 pr-4">Community</th>
              <th className="pb-2 pr-4">Incident Type</th>
              <th className="pb-2 pr-4">Date</th>
              <th className="pb-2 pr-4">Incomplete Forms</th>
              <th className="pb-2">Incomplete Tasks</th>
            </tr>
          </thead>
          <tbody>
            {data.openItems.slice(0, 25).map((item, i) => {
              const isFall = (item.incidentType || '').toLowerCase().includes('fall');
              return (
                <tr key={item.incidentId ?? i} className="border-t border-neutral-100">
                  <td className="py-2 pr-4 text-neutral-700">{item.residentName || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{item.communityName || '—'}</td>
                  <td className={`py-2 pr-4 ${isFall ? 'text-error font-medium' : 'text-neutral-500'}`}>{item.incidentType || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{item.incidentDateTime ? item.incidentDateTime.slice(0, 10) : '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{item.incompleteForms}</td>
                  <td className="py-2 text-neutral-500">{item.incompleteTasks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.openItems.length > 25 && (
        <p className="text-xs text-neutral-400 mt-2">+ {data.openItems.length - 25} more not shown (included in the Excel export)</p>
      )}
    </div>
  );
}

function OccupancyBenchmarkChart({ normalized, diffs }) {
  const data = [
    { name: 'Occupancy %', account: (normalized.occupancy?.pct || 0) * 100, benchmark: (diffs.occupancyPct?.benchmark || 0) * 100 },
    { name: '12mo Move-Out %', account: (normalized.lengthOfStay?.moveOutWithin?.['12mo'] || 0) * 100, benchmark: (diffs.moveOutWithin12mo?.benchmark || 0) * 100 },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="%" />
        <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
        <Legend />
        <Bar dataKey="account" name="This account" fill="#f06022" radius={[4, 4, 0, 0]} />
        <Bar dataKey="benchmark" name="ALIS 500 benchmark" fill="#6d6e71" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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

function monthLabel(yyyyMm) {
  const [y, m] = yyyyMm.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function momPctStr(pct) {
  if (pct == null) return '';
  const sign = pct > 0 ? '+' : '';
  return ` (${sign}${(pct * 100).toFixed(0)}% MoM)`;
}

// ── DSO (Days Sales Outstanding) ────────────────────────────────────────
// Thresholds match the client's ask: green ≤11d (ideal), yellow 11-30d
// (moderate delay), red >30d (collection risk) — see dsoBand() in
// server/services/kpiNormalizer.js, which computes the same bands
// server-side so this is purely a label/color lookup, not a recompute.
const DSO_BAND_BADGE = { green: 'badge-success', yellow: 'badge-warning', red: 'badge-error' };
const DSO_BAND_LABEL = { green: 'On Target', yellow: 'Moderate Delay', red: 'Collection Risk' };
const DSO_BAND_COLOR = { green: '#16a34a', yellow: '#eab308', red: '#dc2626' };

function dsoStr(days) {
  return days == null ? '—' : `${days.toFixed(1)}d`;
}

function DsoBadge({ band }) {
  if (!band) return null;
  return <span className={`badge ${DSO_BAND_BADGE[band]}`}>{DSO_BAND_LABEL[band]}</span>;
}

function DsoMonthlyChart({ monthly }) {
  if (!monthly || monthly.length < 2) return null;
  const data = monthly.map((m) => ({ name: monthLabel(m.month), dso: m.dsoDays, band: m.band }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="d" />
        <Tooltip formatter={(v) => dsoStr(v)} />
        <Bar dataKey="dso" name="DSO (days)" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={DSO_BAND_COLOR[d.band] || '#a3a3a3'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Fetches /dso-history for one scope/scopeKey and renders it as a simple period-over-period list with ▲/▼ deltas — the MoM/QoQ/YoY trend scaffolding, populated as more kpi-export jobs run for this company over time. */
function DsoHistoryPanel({ jobId, scope, scopeKey, label }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setHistory(null);
    setError('');
    const params = new URLSearchParams({ scope });
    if (scopeKey) params.set('scopeKey', scopeKey);
    fetch(`/api/qbr/${jobId}/dso-history?${params}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.history || []))
      .catch((err) => setError(err.message));
  }, [jobId, scope, scopeKey]);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!history) return <p className="text-xs text-neutral-400">Loading trend…</p>;
  if (history.length < 2) {
    return <p className="text-xs text-neutral-400">Not enough history yet for {label} — a trend appears once a second QBR pull runs for this company.</p>;
  }

  return (
    <div className="space-y-1">
      {history.map((h, i) => {
        const prev = history[i - 1];
        const delta = prev && h.dso_days != null && prev.dso_days != null ? h.dso_days - prev.dso_days : null;
        return (
          <div key={h.id} className="flex justify-between text-sm">
            <span className="text-neutral-700">{h.period_start} – {h.period_end}</span>
            <span className="text-neutral-500">
              {dsoStr(h.dso_days)}
              {delta != null && delta !== 0 && (
                <span className={`ml-2 text-xs ${delta <= 0 ? 'text-success' : 'text-error'}`}>
                  {delta <= 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(1)}d
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Region/Facility/Resident drill-down for DSO, opened from DsoSection. Built on the generic Drawer component (client/src/components/Drawer.jsx) — the reusable template for future KPI drill-downs, not a one-off. */
function DsoDrawer({ dso, companyName, jobId, onClose }) {
  const [selected, setSelected] = useState({ scope: 'company', scopeKey: 'portfolio', label: 'Company' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportDso(dso, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  // Most accounts don't tag communities with an ALIS region — hide the
  // Region table entirely rather than show a single meaningless
  // "Unassigned" row.
  const hasRegions = dso.byRegion.some((r) => r.region && r.region !== 'Unassigned');

  return (
    <Drawer
      title="DSO Breakdown"
      subtitle={`${companyName} · Company / Region / Facility / Resident`}
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
      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Trend — {selected.label}</h3>
        <DsoHistoryPanel jobId={jobId} scope={selected.scope} scopeKey={selected.scopeKey} label={selected.label} />
      </div>

      {hasRegions && (
        <div className="mb-6">
          <h3 className="font-semibold text-primary-900 text-sm mb-3">By Region</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Region</th>
                <th className="py-1 text-right">Billed</th>
                <th className="py-1 text-right">AR</th>
                <th className="py-1 text-right">DSO</th>
              </tr>
            </thead>
            <tbody>
              {dso.byRegion.map((r) => (
                <tr
                  key={r.region}
                  className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setSelected({ scope: 'region', scopeKey: r.region, label: r.region })}
                >
                  <td className="py-1.5">{r.region}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(r.billedRevenue)}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(r.arBalance)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{dsoStr(r.dsoDays)} <DsoBadge band={r.band} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">By Facility</h3>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Facility</th>
                <th className="py-1">Region</th>
                <th className="py-1 text-right">Billed</th>
                <th className="py-1 text-right">AR</th>
                <th className="py-1 text-right">DSO</th>
              </tr>
            </thead>
            <tbody>
              {dso.byCommunity.map((c) => (
                <tr
                  key={`${c.host}::${c.communityId}`}
                  className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setSelected({ scope: 'community', scopeKey: `${c.host}::${c.communityId}`, label: c.name })}
                >
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5 text-neutral-500">{c.region || 'Unassigned'}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(c.billedRevenue)}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(c.arBalance)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{dsoStr(c.dsoDays)} <DsoBadge band={c.band} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Residents with an outstanding balance ({dso.byResident.length})</h3>
        {dso.byResident.length === 0 ? (
          <p className="text-sm text-success">✓ No residents currently carrying a balance.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-neutral-500 text-xs uppercase">
                  <th className="py-1">Resident</th>
                  <th className="py-1 text-right">Billed</th>
                  <th className="py-1 text-right">AR</th>
                  <th className="py-1 text-right">DSO</th>
                </tr>
              </thead>
              <tbody>
                {dso.byResident.map((r) => (
                  <tr key={`${r.host}::${r.residentId}`} className="border-t border-neutral-100">
                    <td className="py-1.5">{r.name || `Resident ${r.residentId}`}</td>
                    <td className="py-1.5 text-right text-neutral-500">{currencyStr(r.billedRevenue)}</td>
                    <td className="py-1.5 text-right text-neutral-500">{currencyStr(r.arBalance)}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">{dsoStr(r.dsoDays)} <DsoBadge band={r.band} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function DsoSection({ dso, companyName, jobId }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!dso?.hasBillingData) {
    return <p className="text-sm text-neutral-500 italic">No billing data available to compute DSO for this period.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Company Avg DSO" value={dsoStr(dso.portfolio.dsoDays)} />
        <StatCard label="Billed Revenue" value={currencyStr(dso.portfolio.billedRevenue)} />
        <StatCard label="Outstanding (this period's invoices)" value={currencyStr(dso.portfolio.arBalance)} />
      </div>
      <div className="flex items-center gap-3 mb-4">
        <DsoBadge band={dso.portfolio.band} />
        <span className="text-xs text-neutral-400">Green ≤11d (ideal) · Yellow 11–30d (moderate delay) · Red &gt;30d (collection risk)</span>
      </div>
      <DsoMonthlyChart monthly={dso.portfolio.monthly} />
      <button onClick={() => setDrawerOpen(true)} className="btn btn-secondary btn-sm mt-4">
        View Region / Facility / Resident breakdown →
      </button>
      {drawerOpen && <DsoDrawer dso={dso} companyName={companyName} jobId={jobId} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

// ── PPD (revenue per occupied/census day) ────────────────────────────────

function ppdStr(n) {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}

function PpdMonthlyChart({ monthly }) {
  if (!monthly || monthly.length < 2) return null;
  const data = monthly.map((m) => ({ name: monthLabel(m.month), 'Unit Days': m.ppdByUnitDays, Census: m.ppdByCensus }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="$" />
        <Tooltip formatter={(v) => ppdStr(v)} />
        <Legend />
        <Bar dataKey="Unit Days" fill="#f06022" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Census" fill="#56a5c9" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Same fetch/render shape as DsoHistoryPanel, against /ppd-history instead. */
function PpdHistoryPanel({ jobId, scope, scopeKey, label }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setHistory(null);
    setError('');
    const params = new URLSearchParams({ scope });
    if (scopeKey) params.set('scopeKey', scopeKey);
    fetch(`/api/qbr/${jobId}/ppd-history?${params}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.history || []))
      .catch((err) => setError(err.message));
  }, [jobId, scope, scopeKey]);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!history) return <p className="text-xs text-neutral-400">Loading trend…</p>;
  if (history.length < 2) {
    return <p className="text-xs text-neutral-400">Not enough history yet for {label} — a trend appears once a second QBR pull runs for this company.</p>;
  }

  return (
    <div className="space-y-1">
      {history.map((h, i) => {
        const prev = history[i - 1];
        const delta = prev && h.ppd_unit_days != null && prev.ppd_unit_days != null ? h.ppd_unit_days - prev.ppd_unit_days : null;
        return (
          <div key={h.id} className="flex justify-between text-sm">
            <span className="text-neutral-700">{h.period_start} – {h.period_end}</span>
            <span className="text-neutral-500">
              {ppdStr(h.ppd_unit_days)}
              {delta != null && delta !== 0 && (
                <span className={`ml-2 text-xs ${delta >= 0 ? 'text-success' : 'text-error'}`}>
                  {delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PpdDrawer({ ppd, companyName, jobId, onClose }) {
  const [selected, setSelected] = useState({ scope: 'company', scopeKey: 'portfolio', label: 'Company' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportPpd(ppd, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const hasRegions = ppd.byRegion.some((r) => r.region && r.region !== 'Unassigned');

  return (
    <Drawer
      title="PPD Breakdown"
      subtitle={`${companyName} · Revenue per occupied/census day — Company / Region / Facility`}
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
      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Trend — {selected.label}</h3>
        <PpdHistoryPanel jobId={jobId} scope={selected.scope} scopeKey={selected.scopeKey} label={selected.label} />
      </div>

      {hasRegions && (
        <div className="mb-6">
          <h3 className="font-semibold text-primary-900 text-sm mb-3">By Region</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Region</th>
                <th className="py-1 text-right">Billed</th>
                <th className="py-1 text-right">PPD (Unit Days)</th>
                <th className="py-1 text-right">PPD (Census)</th>
              </tr>
            </thead>
            <tbody>
              {ppd.byRegion.map((r) => (
                <tr
                  key={r.region}
                  className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setSelected({ scope: 'region', scopeKey: r.region, label: r.region })}
                >
                  <td className="py-1.5">{r.region}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(r.billedRevenue)}</td>
                  <td className="py-1.5 text-right">{ppdStr(r.ppdByUnitDays)}</td>
                  <td className="py-1.5 text-right text-neutral-500">{ppdStr(r.ppdByCensus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="font-semibold text-primary-900 text-sm mb-3">By Facility</h3>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Facility</th>
                <th className="py-1">Region</th>
                <th className="py-1 text-right">Billed</th>
                <th className="py-1 text-right">PPD (Unit Days)</th>
                <th className="py-1 text-right">PPD (Census)</th>
              </tr>
            </thead>
            <tbody>
              {ppd.byCommunity.map((c) => (
                <tr
                  key={`${c.host}::${c.communityId}`}
                  className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setSelected({ scope: 'community', scopeKey: `${c.host}::${c.communityId}`, label: c.name })}
                >
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5 text-neutral-500">{c.region || 'Unassigned'}</td>
                  <td className="py-1.5 text-right text-neutral-500">{currencyStr(c.billedRevenue)}</td>
                  <td className="py-1.5 text-right">{ppdStr(c.ppdByUnitDays)}</td>
                  <td className="py-1.5 text-right text-neutral-500">{ppdStr(c.ppdByCensus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  );
}

function PpdSection({ ppd, companyName, jobId }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!ppd?.hasData) {
    return <p className="text-sm text-neutral-500 italic">No billing/occupancy data available to compute PPD for this period.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="PPD (Unit Days)" value={ppdStr(ppd.portfolio.ppdByUnitDays)} />
        <StatCard label="PPD (Census)" value={ppdStr(ppd.portfolio.ppdByCensus)} />
        <StatCard label="Billed Revenue" value={currencyStr(ppd.portfolio.billedRevenue)} />
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        PPD (Unit Days) = billed revenue ÷ billable/financial occupied days. PPD (Census) = billed revenue ÷ days a resident was physically on premises — these differ when a unit is held/billed during a resident's hospital stay or leave of absence.
      </p>
      <PpdMonthlyChart monthly={ppd.portfolio.monthly} />
      <button onClick={() => setDrawerOpen(true)} className="btn btn-secondary btn-sm mt-4">
        View Region / Facility breakdown →
      </button>
      {drawerOpen && <PpdDrawer ppd={ppd} companyName={companyName} jobId={jobId} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

/** Company/facility drill-down for Length of Stay, opened from LosByProductTypeSection. Community x product-type detail is Excel-only (see losExport.js) — this table stays at the community level to keep the drawer readable. */
function LosDrawer({ lengthOfStay, companyName, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportLos({ portfolio: lengthOfStay, byProductType: lengthOfStay.byProductType, byCommunity: lengthOfStay.byCommunity }, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title="Length of Stay — Community Breakdown"
      subtitle={`${companyName} · Avg/median LOS and move-out rate by community — export for the community x product-type detail`}
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
      {!lengthOfStay.byCommunity?.length ? (
        <p className="text-sm text-neutral-500 italic">No community-level move-out data for this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase">
              <th className="py-1">Community</th>
              <th className="py-1 text-right">Avg LOS</th>
              <th className="py-1 text-right">Median LOS</th>
              <th className="py-1 text-right">12mo Move-Out %</th>
              <th className="py-1 text-right">Move-Outs</th>
            </tr>
          </thead>
          <tbody>
            {lengthOfStay.byCommunity.map((c) => (
              <tr key={`${c.host}::${c.communityId}`} className="border-t border-neutral-100">
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5 text-right text-neutral-500">{daysStr(c.avgDays)}</td>
                <td className="py-1.5 text-right">{daysStr(c.medianDays)}</td>
                <td className="py-1.5 text-right text-neutral-500">{pctStr(c.moveOutWithin?.['12mo'])}</td>
                <td className="py-1.5 text-right text-neutral-500">{c.totalMoveOuts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}

/**
 * Occupancy broken out by resident product type (AL/MC/IL/etc.) and by
 * resident classification — same treatment as LosByProductTypeSection
 * below, since ALIS's own occupancy export already carries both fields
 * per resident (residentProductType, residentClassification), it just
 * wasn't being read before. Classification is frequently blank at
 * accounts that don't use that field at all (confirmed live) — an
 * "Unspecified" row dominating the classification table is expected
 * there, not a bug.
 */
function OccupancyByProductTypeSection({ occupancy }) {
  if (!occupancy?.byProductType?.length && !occupancy?.byClassification?.length) {
    return (
      <p className="text-xs text-neutral-400 mt-3 italic">
        Product-type/classification breakdown isn't available for this job — re-run the kpi-export job to pick it up.
      </p>
    );
  }

  const renderTable = (title, rows, keyField) => (
    <div>
      <h4 className="font-semibold text-primary-900 text-sm mb-2">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase">
            <th className="py-1">{keyField === 'productType' ? 'Product Type' : 'Classification'}</th>
            <th className="py-1 text-right">Occupancy %</th>
            <th className="py-1 text-right">Occupied / Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyField]} className="border-t border-neutral-100">
              <td className="py-1.5">{r[keyField]}</td>
              <td className="py-1.5 text-right text-neutral-500">{pctStr(r.pct)}</td>
              <td className="py-1.5 text-right text-neutral-500">{r.occupied} / {r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
      {occupancy.byProductType?.length > 0 && renderTable('Occupancy by product type', occupancy.byProductType, 'productType')}
      {occupancy.byClassification?.length > 0 && renderTable('Occupancy by classification', occupancy.byClassification, 'classification')}
    </div>
  );
}

/** Rolled-up + by-product-type LOS breakdown, per client feedback wanting more than a single blended LOS number. Community detail (and community x product-type detail, Excel-only) lives behind LosDrawer. */
function LosByProductTypeSection({ lengthOfStay, companyName }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!lengthOfStay || lengthOfStay.totalMoveOuts === 0) {
    return <p className="text-sm text-neutral-500 italic">No move-outs recorded this period — nothing to break out by product type yet.</p>;
  }

  // Older completed jobs' persisted snapshots predate the product-type/
  // community cut — fall back to just the rolled-up row rather than
  // crashing on a missing field.
  if (!lengthOfStay.byProductType?.length) {
    return (
      <div>
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Length of stay</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Avg LOS" value={daysStr(lengthOfStay.avgDays)} />
          <StatCard label="Median LOS" value={daysStr(lengthOfStay.medianDays)} />
          <StatCard label="12mo Move-Out Rate" value={pctStr(lengthOfStay.moveOutWithin?.['12mo'])} />
        </div>
        <p className="text-xs text-neutral-400 mt-3 italic">
          Product-type breakdown isn't available for this job — re-run the kpi-export job to pick it up.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold text-primary-900 text-sm mb-3">Length of stay by product type</h3>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase">
            <th className="py-1">Product Type</th>
            <th className="py-1 text-right">Avg LOS</th>
            <th className="py-1 text-right">Median LOS</th>
            <th className="py-1 text-right">12mo Move-Out %</th>
            <th className="py-1 text-right">Move-Outs</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-neutral-200 font-semibold">
            <td className="py-1.5">All Product Types (Portfolio)</td>
            <td className="py-1.5 text-right text-neutral-500">{daysStr(lengthOfStay.avgDays)}</td>
            <td className="py-1.5 text-right">{daysStr(lengthOfStay.medianDays)}</td>
            <td className="py-1.5 text-right text-neutral-500">{pctStr(lengthOfStay.moveOutWithin?.['12mo'])}</td>
            <td className="py-1.5 text-right text-neutral-500">{lengthOfStay.totalMoveOuts}</td>
          </tr>
          {lengthOfStay.byProductType.map((p) => (
            <tr key={p.productType} className="border-t border-neutral-100">
              <td className="py-1.5">{p.productType}</td>
              <td className="py-1.5 text-right text-neutral-500">{daysStr(p.avgDays)}</td>
              <td className="py-1.5 text-right">{daysStr(p.medianDays)}</td>
              <td className="py-1.5 text-right text-neutral-500">{pctStr(p.moveOutWithin?.['12mo'])}</td>
              <td className="py-1.5 text-right text-neutral-500">{p.totalMoveOuts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setDrawerOpen(true)} className="btn btn-secondary btn-sm">
        View Community breakdown →
      </button>
      {drawerOpen && <LosDrawer lengthOfStay={lengthOfStay} companyName={companyName} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

function AdmissionsDischargesTrend({ data }) {
  if (!data || data.months.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold text-primary-900 text-sm mb-3">Month-over-month trend</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
              <th className="pb-2 pr-4">Month</th>
              <th className="pb-2 pr-4">Admissions</th>
              <th className="pb-2 pr-4">Discharges</th>
              <th className="pb-2">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className="border-t border-neutral-100">
                <td className="py-2 pr-4 text-neutral-700">{monthLabel(m.month)}</td>
                <td className="py-2 pr-4 text-neutral-700">{m.admissions}<span className="text-neutral-400">{momPctStr(m.admissionsMomPct)}</span></td>
                <td className="py-2 pr-4 text-neutral-700">{m.discharges}<span className="text-neutral-400">{momPctStr(m.dischargesMomPct)}</span></td>
                <td className={`py-2 font-medium ${m.net > 0 ? 'text-success' : m.net < 0 ? 'text-error' : 'text-neutral-500'}`}>
                  {m.net > 0 ? `+${m.net}` : m.net}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EVAL_REASON_LABEL = {
  expired: 'Expired',
  incomplete: 'Incomplete',
  overdue: 'Not evaluated in 12+ months',
  neverEvaluated: 'Never evaluated',
};

function CareLevelEvaluations({ data, communities, companyName }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  if (!data || data.totalResidents === 0) {
    return <p className="text-sm text-neutral-500">No non-IL residents found for this account.</p>;
  }
  if (!data.hasEvaluationData) {
    return <p className="text-sm text-neutral-500 italic">This account has no evaluation records in ALIS — either the care-level evaluation module isn't in use, or none have been recorded.</p>;
  }

  // Keyed by host::communityId, same convention as the server's
  // filterByCommunity — two hosts can share a numeric community ID.
  const communityNameByKey = new Map((communities || []).map((c) => [`${c.host}::${c.communityId}`, c.name]));

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportResidentsNeedingAttention(data.flagged, communities, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Residents Considered" value={data.totalResidents} />
        <StatCard label="Needs Attention" value={`${data.needsAttention} (${pctStr(data.pctNeedsAttention)})`} />
        <StatCard label="Expired" value={data.expired} />
        <StatCard label="Incomplete" value={data.incomplete} />
        <StatCard label="Not Evaluated in 12+ mo" value={data.overdue} />
        <StatCard label="Never Evaluated" value={data.neverEvaluated} />
      </div>

      {data.flagged.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-primary-900 text-sm">Residents needing attention</h3>
            <button onClick={handleExport} disabled={exporting} className="btn btn-sm btn-secondary">
              {exporting ? 'Exporting…' : '⬇ Export to Excel'}
            </button>
          </div>
          {exportError && <p className="text-xs text-danger mb-2">{exportError}</p>}
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                  <th className="pb-2 pr-4">Resident</th>
                  <th className="pb-2 pr-4">Community</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Care Level</th>
                  <th className="pb-2 pr-4">Product Type</th>
                  <th className="pb-2 pr-4">Fee</th>
                  <th className="pb-2 pr-4">Move-In</th>
                  <th className="pb-2">Expiration</th>
                </tr>
              </thead>
              <tbody>
                {data.flagged.slice(0, 25).map((f, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="py-2 pr-4 text-neutral-700">{f.name || `Resident ${f.residentId}`}</td>
                    <td className="py-2 pr-4 text-neutral-500">{communityNameByKey.get(`${f.host}::${f.communityId}`) || f.communityId || '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{EVAL_REASON_LABEL[f.reason] || f.reason}</td>
                    <td className="py-2 pr-4 text-neutral-500">{f.careLevel || '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{f.productType || '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{f.fee != null ? currencyStr(f.fee) : '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{f.moveInDate ? f.moveInDate.slice(0, 10) : '—'}</td>
                    <td className="py-2 text-neutral-500">{f.expirationDate ? f.expirationDate.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.flagged.length > 25 && (
            <p className="text-xs text-neutral-400 mt-2">+ {data.flagged.length - 25} more not shown (included in the Excel export)</p>
          )}
        </div>
      )}

      {data.revenueLeakage?.affectedResidents > 0 && (
        <div className="mt-6 pt-6 border-t border-neutral-200">
          <h3 className="font-semibold text-primary-900 text-sm mb-1">Billed below evaluation-recommended fee</h3>
          <p className="text-xs text-neutral-500 mb-3">
            {data.revenueLeakage.affectedResidents} resident(s) · ~{currencyStr(data.revenueLeakage.totalMonthlyGap)}/mo potential — may be a legitimate exception, not automatically a mistake.
          </p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {data.revenueLeakage.items.slice(0, 25).map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-neutral-700">{item.name || `Resident ${item.residentId}`}</span>
                <span className="text-neutral-500">{currencyStr(item.currentFee)} → {currencyStr(item.recommendedFee)}</span>
              </div>
            ))}
          </div>
          {data.revenueLeakage.items.length > 25 && (
            <p className="text-xs text-neutral-400 mt-2">+ {data.revenueLeakage.items.length - 25} more not shown</p>
          )}
        </div>
      )}
    </div>
  );
}

function StaffingSection({ data, communities, companyName }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const communityNameByKey = new Map((communities || []).map((c) => [`${c.host}::${c.communityId}`, c.name]));
  const inactive = data?.inactive || [];

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportInactiveStaff(inactive, communities, companyName);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Staff Active (30d)" value={pctStr(data?.pct)} />
        <StatCard label="Staff : Census Ratio" value={data?.staffToCensusRatio != null ? `1 : ${(1 / data.staffToCensusRatio).toFixed(1)}` : '—'} />
      </div>
      <p className="text-xs text-neutral-400 mt-4">
        Staff activity reflects login recency as of when this report ran, not the reporting period itself. Hires/turnover/tenure data coming soon.
      </p>

      {inactive.length > 0 && (
        <div className="mt-6 pt-6 border-t border-neutral-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-primary-900 text-sm">Not logged in within 30 days ({inactive.length})</h3>
            <button onClick={handleExport} disabled={exporting} className="btn btn-sm btn-secondary">
              {exporting ? 'Exporting…' : '⬇ Export to Excel'}
            </button>
          </div>
          {exportError && <p className="text-xs text-danger mb-2">{exportError}</p>}
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Community</th>
                  <th className="pb-2 pr-4">Hire Date</th>
                  <th className="pb-2 pr-4">Job Role</th>
                  <th className="pb-2">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {inactive.slice(0, 25).map((s, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="py-2 pr-4 text-neutral-700">{s.name || `Staff ${s.staffId}`}</td>
                    <td className="py-2 pr-4 text-neutral-500">{communityNameByKey.get(`${s.host}::${s.communityId}`) || s.communityId || '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{s.hireDate ? s.hireDate.slice(0, 10) : '—'}</td>
                    <td className="py-2 pr-4 text-neutral-500">{s.jobRole || '—'}</td>
                    <td className="py-2 text-neutral-500">{s.lastLogin ? s.lastLogin.slice(0, 10) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inactive.length > 25 && (
            <p className="text-xs text-neutral-400 mt-2">+ {inactive.length - 25} more not shown (included in the Excel export)</p>
          )}
        </div>
      )}
    </div>
  );
}

function fieldLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// HubSpot's category_2_0 field comes through as the literal string "false"
// (or "true", or blank) when a ticket was never actually categorized —
// that's a checkbox/property default leaking through, not a real category.
// Relabeled to "General" as a catch-all bucket name regardless of which
// skill version produced it, rather than depending on every future export
// to pre-clean it.
const JUNK_CATEGORY_VALUES = new Set(['false', 'true', '', 'null', 'undefined']);
function normalizeCategoryLabel(cat) {
  return JUNK_CATEGORY_VALUES.has(String(cat ?? '').trim().toLowerCase()) ? 'General' : cat;
}

// Ticket status strings seen from the account-health-export skill that mean
// "done" — everything else (In Progress, Client Submitted, Long-Term
// Projects, etc.) is treated as still open. A ticket with no status at all
// (bare ID, older skill version) is also treated as open — unknown isn't
// the same as confirmed closed.
const CLOSED_TICKET_STATUSES = new Set(['closed', 'completed']);
function isClosedTicketStatus(status) {
  return CLOSED_TICKET_STATUSES.has((status || '').toLowerCase());
}

/** Renders a `{ value, confidence, method }`-shaped field from an account-health-export import. */
function ConfidenceValue({ field }) {
  if (!field) return '—';
  const { value, confidence, method } = field;
  const display = value == null || (Array.isArray(value) && value.length === 0)
    ? '—'
    : typeof value === 'boolean' ? (value ? 'Yes' : 'No')
    : Array.isArray(value) ? value.length
    : value;
  return (
    <span>
      {display}
      {confidence && confidence !== 'high' && (
        <span
          className={`ml-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${confidence === 'not_available' ? 'bg-neutral-200 text-neutral-500' : 'bg-yellow-100 text-yellow-700'}`}
          title={method || confidence}
        >
          {confidence === 'not_available' ? 'n/a' : 'est.'}
        </span>
      )}
    </span>
  );
}

/** Payer-type / level-of-care breakdown shared by billedRevenue and recurringRevenue — same shape on both. */
function RevenueBreakdown({ data }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Revenue by payer type</h3>
        <div className="space-y-1">
          {Object.entries(data.byPayerType)
            .sort((a, b) => b[1] - a[1])
            .map(([payer, amount]) => (
              <div key={payer} className="flex justify-between text-sm">
                <span className="text-neutral-700">{payer}</span>
                <span className="text-neutral-500">{currencyStr(amount)}</span>
              </div>
            ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-primary-900 text-sm mb-3">Revenue by Product Type</h3>
        <div className="space-y-1">
          {Object.entries(data.byProductType)
            .sort((a, b) => b[1] - a[1])
            .map(([product, amount]) => (
              <div key={product} className="flex justify-between text-sm">
                <span className="text-neutral-700">{product}</span>
                <span className="text-neutral-500">{currencyStr(amount)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Renders a `{ value: [...], confidence, method }` list of HubSpot deals. Hidden entirely when empty. */
function DealList({ title, deals }) {
  if (!deals?.value?.length) return null;
  return (
    <div className="mb-4">
      <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1">
        {deals.value.map((d, i) => {
          const closeDate = d.closedate || d.close_date;
          const label = d.dealname || d.name;
          return (
            <div key={i} className="flex justify-between text-sm gap-2">
              <span className="text-neutral-700 truncate">
                {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{label}</a> : label}
              </span>
              <span className="text-neutral-500 shrink-0">{d.dealstage || d.stage}{closeDate ? ` · ${closeDate}` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Re-pulls live ticket/deal data for this job's linked HubSpot company —
 * lets a "close this during meeting prep, then refresh" workflow update
 * the dashboard (and the next PPTX export) without re-running the whole
 * kpi-export job. See server/api/qbr.js's /refresh-hubspot route.
 */
function HubspotRefreshButton({ jobId, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch(`/api/qbr/${jobId}/refresh-hubspot`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      onRefreshed(data.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={refreshing} className="btn btn-sm btn-secondary">
        {refreshing ? 'Refreshing…' : '🔄 Refresh HubSpot'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
    </div>
  );
}

function AccountHealthImport({ jobId, hubspotHealth, initialWarning, onImported }) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [warning, setWarning] = useState(initialWarning || '');

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportError('');
    setWarning('');
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch(`/api/qbr/${jobId}/health-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      onImported(data.summary);
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  const svc = hubspotHealth?.service_health;
  const fin = hubspotHealth?.financial_health;

  return (
    <SectionCard title="Account Health Import (HubSpot)" description="Bridge data from the account-health-export skill — Service & Financial health, until this app has direct HubSpot integration">
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-neutral-200">
        <div>
          {hubspotHealth?.meta && (
            <p className="text-xs text-neutral-500">
              Imported as of {hubspotHealth.meta.as_of_date} · generated {hubspotHealth.meta.generated_at ? new Date(hubspotHealth.meta.generated_at).toLocaleString() : '—'}
            </p>
          )}
        </div>
        <label className="btn btn-sm btn-secondary cursor-pointer">
          {importing ? 'Importing…' : hubspotHealth ? '↻ Re-import' : '📥 Import JSON'}
          <input type="file" accept="application/json" onChange={handleFile} disabled={importing} className="hidden" />
        </label>
      </div>

      {importError && <div className="alert alert-error mb-4"><span>⚠️</span><p className="text-sm">{importError}</p></div>}
      {warning && <div className="alert alert-warning mb-4"><span>⚠️</span><p className="text-sm">{warning}</p></div>}

      {!hubspotHealth ? (
        <p className="text-sm text-neutral-500 italic">
          No health export imported yet — run the account-health-export skill for this company in HubSpot, download the JSON, and import it here.
        </p>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Service Health */}
          <div>
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Service Health</h3>
            {svc ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <StatCard label="Avg Open Ticket Age" value={<ConfidenceValue field={svc.avg_open_ticket_age_days} />} />
                  <StatCard label="Over 45 Days" value={<ConfidenceValue field={svc.tickets_over_45_days} />} />
                  <StatCard label="Escalations (Qtr)" value={<ConfidenceValue field={svc.escalation_count_this_quarter} />} />
                  <StatCard label="Closed (90d)" value={<ConfidenceValue field={svc.tickets_closed_last_90_days} />} />
                </div>
                {svc.open_tickets_by_stage && (
                  <div className="mb-4">
                    <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Open by stage</p>
                    <div className="space-y-1">
                      {Object.entries(svc.open_tickets_by_stage.value || svc.open_tickets_by_stage).map(([stage, count]) => (
                        <div key={stage} className="flex justify-between text-sm">
                          <span className="text-neutral-700">{fieldLabel(stage)}</span>
                          <span className="text-neutral-500">{count}</span>
                        </div>
                      ))}
                      {svc.tickets_closed_last_90_days?.value != null && (
                        <div className="flex justify-between text-sm border-t border-neutral-100 pt-1 mt-1">
                          <span className="text-neutral-700">Closed (90d)</span>
                          <span className="text-neutral-500">{svc.tickets_closed_last_90_days.value}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {svc.category_mix?.value && Object.keys(svc.category_mix.value).length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Category mix</p>
                    <div className="space-y-1">
                      {Object.entries(svc.category_mix.value).map(([cat, count]) => (
                        <div key={cat} className="flex justify-between text-sm">
                          <span className="text-neutral-700">{normalizeCategoryLabel(cat)}</span>
                          <span className="text-neutral-500">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : <p className="text-sm text-neutral-500 italic">Not populated in this import.</p>}
          </div>

          {/* Financial Health */}
          <div>
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Financial Health</h3>
            {fin ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <StatCard label="Split Pay Pending" value={<ConfidenceValue field={fin.split_pay_pending_count} />} />
                  <StatCard label="Unbilled Addendum Signal" value={<ConfidenceValue field={fin.unbilled_addendum_signal} />} />
                  <StatCard label="Nearest Deal Close" value={<ConfidenceValue field={fin.nearest_open_deal_close_date} />} />
                  <StatCard label="Rate Dispute Active" value={<ConfidenceValue field={fin.rate_dispute_active} />} />
                </div>
                <div className="mb-4">
                  <p className="text-xs text-neutral-500 uppercase tracking-wide mb-2">Contract renewal</p>
                  <p className="text-sm text-neutral-700"><ConfidenceValue field={fin.contract_renewal_date} /></p>
                </div>
                <DealList title="Open deals" deals={fin.open_deals} />
                <DealList title="Closed deals (last 90 days)" deals={fin.closed_deals_last_90_days} />
              </>
            ) : <p className="text-sm text-neutral-500 italic">Not populated in this import.</p>}
          </div>
        </div>

        {/* Full-width, below the Service/Financial split — a category list
            this long reads as one cramped column with a whole empty column
            next to it otherwise; two columns actually use the card's width. */}
        {svc?.repeat_issue_flags?.value?.length > 0 && (
          <div className="mt-6 pt-6 border-t border-neutral-200">
            <p className="text-xs text-neutral-500 uppercase tracking-wide mb-3">Repeat issues flagged <span className="normal-case">(estimated — same category, not confirmed same root cause)</span></p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              {(() => {
                // service_health.open_tickets (see hubspotTickets.js's
                // enrichOpenTickets) is the skill's comprehensive open-ticket
                // list with next steps — repeat_issue_flags only covers
                // categories with 2+ tickets, so this is looked up by ID
                // rather than expecting next_step to live on the
                // repeat-issue ticket objects themselves.
                const nextStepById = new Map((svc.open_tickets?.value || []).map((t) => [String(t.id), t.next_step]).filter(([, step]) => step));
                return svc.repeat_issue_flags.value.map((f, i) => {
                // Field names vary by skill version — category/count/tickets[] is
                // the current shape; pattern/occurrences/ticketIds[] was an earlier one.
                const label = normalizeCategoryLabel(f.category || f.pattern);
                const count = f.count ?? f.occurrences;
                const tickets = f.tickets || f.ticketIds || f.ticket_ids || [];

                const renderTicket = (t, j, showNextStep) => {
                  // Ticket entries vary by skill version: an enriched
                  // object (see hubspotTickets.js's enrichRepeatIssueFlags)
                  // carries a real subject + HubSpot link; a bare ticket
                  // ID (string or number, e.g. an older skill version)
                  // renders as plain text. The title is the useful part
                  // when we have it, but the bare ID stays visible in
                  // parens alongside it rather than being replaced —
                  // it's how anyone cross-references back to HubSpot by
                  // hand if the link itself is ever wrong or stale.
                  const isObj = t !== null && typeof t === 'object';
                  const label2 = isObj ? (t.subject ? `${t.subject} (${t.id})` : t.id) : t;
                  const url = isObj ? t.url : null;
                  const status = isObj ? t.status : null;
                  // Next steps only ever make sense for open tickets —
                  // closed-ticket callers pass showNextStep=false, so a
                  // stale next_step left over from before a ticket closed
                  // never displays as if it's still relevant.
                  const nextStep = showNextStep && isObj ? nextStepById.get(String(t.id)) : null;
                  return (
                    <li key={j} className="truncate">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{label2}</a>
                      ) : label2}
                      {status && <span className="text-neutral-400"> — {status}</span>}
                      {nextStep && <div className="text-neutral-400 italic pl-3">↳ {nextStep}</div>}
                    </li>
                  );
                };

                // Split so the client-facing view leads with what's
                // still actionable — open tickets — rather than
                // burying them in a flat list dominated by old
                // closed ones (some categories here are a multi-year
                // history, not a recent-quarter signal).
                const openTickets = tickets.filter((t) => !isClosedTicketStatus(t !== null && typeof t === 'object' ? t.status : null));
                const closedTickets = tickets.filter((t) => isClosedTicketStatus(t !== null && typeof t === 'object' ? t.status : null));

                return (
                  <div key={i} className="text-sm">
                    <p className="text-neutral-700">{label} <span className="text-neutral-400">({count}×)</span></p>
                    {openTickets.length > 0 && (
                      <div className="mt-1">
                        <p className="text-neutral-400 text-xs uppercase tracking-wide">Open ({openTickets.length})</p>
                        <ul className="text-neutral-400 text-xs list-disc list-inside">
                          {openTickets.map((t, j) => renderTicket(t, j, true))}
                        </ul>
                      </div>
                    )}
                    {closedTickets.length > 0 && (
                      <div className="mt-1">
                        <p className="text-neutral-400 text-xs uppercase tracking-wide">Closed ({closedTickets.length})</p>
                        <ul className="text-neutral-400 text-xs list-disc list-inside">
                          {closedTickets.map((t, j) => renderTicket(t, j, false))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              });
              })()}
            </div>
          </div>
        )}
        </>
      )}
    </SectionCard>
  );
}

function ReleaseRecommendationsImport({ jobId, releaseRecommendations, initialWarning, onImported }) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [warning, setWarning] = useState(initialWarning || '');

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportError('');
    setWarning('');
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch(`/api/qbr/${jobId}/release-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      onImported(data.summary);
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  const releases = releaseRecommendations?.releases || [];
  const meta = releaseRecommendations?.meta;

  return (
    <SectionCard title="Recent ALIS Platform Releases" description="Curated by the release-recommendations Claude Project — highlights relevant releases for the exported deck's Platform Releases slide">
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-neutral-200">
        <div>
          {meta && (
            <p className="text-xs text-neutral-500">
              {[meta.release_range, meta.period_label].filter(Boolean).join('  |  ')}
              {meta.generated_at ? ` · generated ${new Date(meta.generated_at).toLocaleString()}` : ''}
            </p>
          )}
        </div>
        <label className="btn btn-sm btn-secondary cursor-pointer">
          {importing ? 'Importing…' : releases.length > 0 ? '↻ Re-import' : '📥 Import JSON'}
          <input type="file" accept="application/json" onChange={handleFile} disabled={importing} className="hidden" />
        </label>
      </div>

      {importError && <div className="alert alert-error mb-4"><span>⚠️</span><p className="text-sm">{importError}</p></div>}
      {warning && <div className="alert alert-warning mb-4"><span>⚠️</span><p className="text-sm">{warning}</p></div>}

      {releases.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          No release recommendations imported yet — run the release-recommendations Claude Project for this account and import its JSON here to include the Platform Releases slide in the exported deck.
        </p>
      ) : (
        <div className="space-y-2">
          {releases.map((r, i) => (
            <div key={i} className={`p-3 rounded-lg ${i % 2 === 0 ? 'bg-neutral-50' : ''}`}>
              <p className="text-sm font-semibold text-primary-900">{r.title}</p>
              <p className="text-xs text-neutral-600 mt-1">{r.description}</p>
            </div>
          ))}
          {meta?.release_notes_url && (
            <p className="text-xs text-neutral-400 italic pt-2">Full release notes: {meta.release_notes_url}</p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

export default function KpiDashboard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  // Defaults on once billing data is confirmed present (see the effect
  // below) — some accounts never have ALIS billing data at all (billing
  // run elsewhere), and this lets them exclude it from the exported deck
  // without it ever having shown up on the dashboard as something to turn
  // off in the first place.
  const [includeBilling, setIncludeBilling] = useState(true);
  // Same on/off shape as includeBilling — defaults on, controls every
  // HubSpot-sourced slide (Support Review, HubSpot Deals, Account Health,
  // Project Status, Enhancement Requests, Deal-Related Activity).
  const [includeHubspot, setIncludeHubspot] = useState(true);
  // Off by default — the full deck (every section, including "[ Account
  // manager: fill in... ]" placeholders) is what gets printed and
  // customized by hand for an actual QBR. Turning this on drops every
  // no-data slide (and its agenda line) for a lighter monthly/bi-weekly
  // touchpoint deck instead.
  const [truncateEmptySlides, setTruncateEmptySlides] = useState(false);

  useEffect(() => {
    fetch(`/api/qbr/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no KPI snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data))
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function handleExportPptx() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (!includeBilling) params.set('includeBilling', 'false');
      if (!includeHubspot) params.set('includeHubspot', 'false');
      if (truncateEmptySlides) params.set('truncateEmptySlides', 'true');
      const exportUrl = `/api/qbr/${jobId}/export-pptx${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(exportUrl, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snapshot?.company_name || 'QBR'}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }

  if (!snapshot) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading KPI snapshot...</p></div>;
  }

  const { summary } = snapshot;
  const { normalized, diffs, ticketSummary, dealSummary, flags, hubspotHealth, hubspotHealthImportWarning, dataWarnings, releaseRecommendations, releaseImportWarning } = summary;
  const hasAnyBillingData = Boolean(
    normalized.billedRevenue?.hasBillingData || normalized.recurringRevenue?.hasBillingData || normalized.outstandingInvoiceSummary?.hasBillingData
  );
  const hasAnyHubspotData = Boolean(ticketSummary || dealSummary || hubspotHealth);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{summary.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            {summary.periodStart} – {summary.periodEnd} · benchmarked against ALIS 500 ({summary.benchmarkQuarter})
          </p>
        </div>
        <div className="flex items-center gap-4">
          {hasAnyBillingData && (
            <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none" title="Controls whether ALIS billing data (revenue, AR aging, revenue-leakage flags) is included in the exported PPTX. Doesn't affect this dashboard view.">
              <input
                type="checkbox"
                checked={includeBilling}
                onChange={(e) => setIncludeBilling(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-primary-600"
              />
              Include billing in export
            </label>
          )}
          {hasAnyHubspotData && (
            <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none" title="Controls whether HubSpot-sourced sections (Support Review, HubSpot Deals, Account Health, Project Status, Enhancement Requests, Deal-Related Activity) are included in the exported PPTX. Doesn't affect this dashboard view.">
              <input
                type="checkbox"
                checked={includeHubspot}
                onChange={(e) => setIncludeHubspot(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer accent-primary-600"
              />
              Include HubSpot data in export
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none" title="Drops every section with nothing real to show (and its agenda line) — e.g. no HubSpot deals, no enhancement-tagged tickets, the always-blank AM Alignment/Strategic Initiatives/Industry Updates placeholders. Off by default so the full deck can still be printed and filled in by hand; turn this on for a lighter monthly/bi-weekly touchpoint deck.">
            <input
              type="checkbox"
              checked={truncateEmptySlides}
              onChange={(e) => setTruncateEmptySlides(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-primary-600"
            />
            Truncate to sections with data
          </label>
          <button onClick={handleExportPptx} disabled={exporting} className="btn btn-accent">
            {exporting ? 'Building deck...' : '⬇ Export PPTX'}
          </button>
        </div>
      </div>

      {dataWarnings && dataWarnings.length > 0 && (
        <div className="alert alert-warning mb-8">
          <span>⚠️</span>
          <div className="text-sm">
            <p className="font-semibold mb-1">This report has incomplete data — {dataWarnings.length} pull{dataWarnings.length > 1 ? 's' : ''} failed during generation:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {dataWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* 1. OPERATIONAL / FACILITY OVERVIEW */}
      <SectionCard title="Operational / Facility Overview" description="Occupancy, census, and resident movement trends">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="Occupancy %" value={pctStr(normalized.occupancy?.pct)} diff={diffs.occupancyPct} formatBenchmark={(v) => pctStr(v)} />
          <StatCard label="Median Length of Stay" value={normalized.lengthOfStay?.medianDays != null ? `${Math.round(normalized.lengthOfStay.medianDays)}d` : '—'} diff={diffs.medianLosDays} formatBenchmark={(v) => `${v}d`} />
          <StatCard label="12mo Move-Out Rate" value={pctStr(normalized.lengthOfStay?.moveOutWithin?.['12mo'])} diff={diffs.moveOutWithin12mo} formatBenchmark={(v) => pctStr(v)} />
        </div>
        {normalized.occupancy?.hasOccupancyData === false ? (
          <p className="text-sm text-neutral-500 italic">
            This account has no floor-plan occupancy data in ALIS — either it isn't tracked through ALIS for this account, or none was recorded this period. Other Operational metrics above (from resident/move-in-out records) are unaffected.
          </p>
        ) : (
          <>
            <OccupancyBenchmarkChart normalized={normalized} diffs={diffs} />
            <p className="text-xs text-neutral-400 mt-4">
              Occupancy % mirrors ALIS's own floor-plan/occupancy report exactly — it isn't independently reconciled, so a data-entry issue there (a move-in date discrepancy, a room marked occupied that shouldn't be) will show up here too.
            </p>
            <OccupancyByProductTypeSection occupancy={normalized.occupancy} />
          </>
        )}
      </SectionCard>

      {/* 2. QUALITY OF CARE — ALERTS & FLAGS */}
      <SectionCard title="Alerts & Flags" description="Account and usage signals across service, financial, and clinical care — the full discussion-point list for this QBR">
        <div className="mb-6">
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Clinical safety snapshot</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Falls / 1,000 res-days" value={normalized.falls?.per1000ResidentDays?.toFixed(1) ?? '—'} diff={diffs.fallsPer1000ResidentDays} />
            <StatCard label="Hospital/SNF visits / 1,000 res-days" value={normalized.hospitalVisits?.per1000ResidentDays?.toFixed(1) ?? '—'} diff={diffs.hospitalVisitsPer1000ResidentDays} />
            <StatCard label="PRN Administrations / 1,000 res-days" value={normalized.prnAdministration?.overall?.toFixed(1) ?? '—'} diff={diffs.prnAdministrationPer1000ResidentDays} />
            <StatCard label="Incident Reports Fully Documented" value={normalized.incidentCompletion?.hasData ? pctStr(normalized.incidentCompletion.overall.pctComplete) : '—'} />
          </div>
        </div>
        <div className="mb-6">
          <IncidentCompletionPanel data={normalized.incidentCompletion} companyName={summary.companyName} />
        </div>
        <div className="mb-4">
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Discussion Points</h3>
          <p className="text-xs text-neutral-500 mb-3">Spans clinical, service, financial, and relationship signals — categories on the right show which. Import a health export (below) to pull in service/financial/relationship points from HubSpot.</p>
          <FlagsPanel flags={flags} />
        </div>
      </SectionCard>

      {/* 3. FINANCIAL */}
      <SectionCard title="Financial" description="Billed revenue, payer mix, level-of-care mix, and accounts receivable — from real billing data">
        {normalized.billedRevenue?.hasBillingData ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <StatCard label="Billed Revenue" value={currencyStr(normalized.billedRevenue.total)} />
              <StatCard label="Revenue / Resident" value={currencyStr(normalized.billedRevenue.revenuePerResident)} />
            </div>
            <RevenueBreakdown data={normalized.billedRevenue} />
            <p className="text-xs text-neutral-400 mt-4">
              Actual invoiced charges for the reporting period — the real billed figure, not an estimate. Revenue per bed and cost analysis still require GL sync data or HQ Dashboard reports. This mirrors ALIS's own invoice/transaction records and isn't reconciled against an external accounting system (QuickBooks, a rent roll) — a mismatch there is a data-entry issue in the source system, not this report.
            </p>
            {normalized.recurringRevenue?.hasBillingData && (
              <div className="mt-4 pt-4 border-t border-neutral-100">
                <p className="text-xs text-neutral-500">
                  Current active billing schedule (forward-looking run rate, not what was billed this period): <span className="font-medium text-neutral-700">{currencyStr(normalized.recurringRevenue.total)}</span>
                </p>
              </div>
            )}
          </>
        ) : normalized.recurringRevenue?.hasBillingData ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <StatCard label="Active Billing Schedule" value={currencyStr(normalized.recurringRevenue.total)} />
              <StatCard label="Revenue / Resident" value={currencyStr(normalized.recurringRevenue.revenuePerResident)} />
              <StatCard label="Per-Diem Revenue" value={currencyStr(normalized.recurringRevenue.perDiemTotal)} />
            </div>
            <RevenueBreakdown data={normalized.recurringRevenue} />
            <p className="text-xs text-neutral-400 mt-4">
              No billed-invoice data available for this period — showing the active recurring-charge schedule instead, a forward-looking run rate rather than a reconciled invoice total. Revenue per bed and cost analysis still require GL sync data or HQ Dashboard reports.
            </p>
          </>
        ) : (
          <p className="text-sm text-neutral-500 italic mb-6">
            This account has no billing records in ALIS — either billing isn't run through ALIS for this account, or none were active this period. Revenue per bed and cost analysis still require GL sync data or HQ Dashboard reports.
          </p>
        )}

        {normalized.careLevelEvaluations?.revenueLeakage?.affectedResidents > 0 && (
          <div className="mt-6 pt-6 border-t border-neutral-200">
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Potential revenue opportunity</h3>
            <div className="grid grid-cols-2 gap-4 mb-2">
              <StatCard label="Residents Underbilled" value={normalized.careLevelEvaluations.revenueLeakage.affectedResidents} />
              <StatCard label="Potential Monthly Gap" value={currencyStr(normalized.careLevelEvaluations.revenueLeakage.totalMonthlyGap)} />
            </div>
            <p className="text-xs text-neutral-400">
              ALIS-computed: the evaluation's own recommended fee exceeds what's actually being charged. May be a legitimate exception (family agreement, promo rate) — see the flagged residents in Levels of Care below.
            </p>
          </div>
        )}

        {normalized.outstandingInvoiceSummary?.hasBillingData && (
          <div className="mt-6 pt-6 border-t border-neutral-200">
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Accounts receivable aging</h3>
            {normalized.outstandingInvoiceSummary.total > 0 ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  <StatCard label="Total Outstanding" value={currencyStr(normalized.outstandingInvoiceSummary.total)} />
                  <StatCard label="60+ Days Past Due" value={currencyStr((normalized.outstandingInvoiceSummary.aging.days61to90 || 0) + (normalized.outstandingInvoiceSummary.aging.days90plus || 0))} />
                  <StatCard label="Outstanding Invoices" value={normalized.outstandingInvoiceSummary.invoiceCount} />
                </div>
                <div className="space-y-1">
                  {[
                    ['Current', normalized.outstandingInvoiceSummary.aging.current],
                    ['1-30 days', normalized.outstandingInvoiceSummary.aging.days1to30],
                    ['31-60 days', normalized.outstandingInvoiceSummary.aging.days31to60],
                    ['61-90 days', normalized.outstandingInvoiceSummary.aging.days61to90],
                    ['90+ days', normalized.outstandingInvoiceSummary.aging.days90plus],
                  ].map(([label, amount]) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-neutral-700">{label}</span>
                      <span className="text-neutral-500">{currencyStr(amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-success">✓ No outstanding balance — fully collected as of this period.</p>
            )}
          </div>
        )}
      </SectionCard>

      {/* 3b. DAYS SALES OUTSTANDING (DSO) */}
      <SectionCard title="Days Sales Outstanding (DSO)" description="Collection speed — company average, with Region/Facility/Resident drill-down and month-over-month trend">
        <DsoSection dso={normalized.dso} companyName={summary.companyName} jobId={jobId} />
      </SectionCard>

      {/* 3c. REVENUE YIELD (PPD) */}
      <SectionCard title="Revenue Yield (PPD)" description="Revenue per occupied/census day — company average, with Region/Facility drill-down and month-over-month trend">
        <PpdSection ppd={normalized.ppd} companyName={summary.companyName} jobId={jobId} />
      </SectionCard>

      {/* 4. STAFFING */}
      <SectionCard title="Staffing" description="Staff ratios and activity metrics">
        <StaffingSection data={normalized.staffActivity} communities={summary.communities} companyName={summary.companyName} />
      </SectionCard>

      {/* 5. RESIDENT MANAGEMENT */}
      <SectionCard title="Resident Management" description="Census, admissions, discharges, and length of stay">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Residents" value={normalized.demographics?.totalResidents ?? '—'} />
          <StatCard label="Avg Census" value={normalized.occupancy?.occupiedRoomDays != null ? (normalized.occupancy.occupiedRoomDays / (new Date(summary.periodEnd) - new Date(summary.periodStart)) * 1000 * 86400).toFixed(0) : '—'} />
          <StatCard label="Admissions" value={normalized.admissionsDischarges?.totalAdmissions ?? '—'} />
          <StatCard label="Discharges" value={normalized.admissionsDischarges?.totalDischarges ?? '—'} />
          <StatCard
            label="Net Change"
            value={normalized.admissionsDischarges?.netChange != null ? (normalized.admissionsDischarges.netChange > 0 ? `+${normalized.admissionsDischarges.netChange}` : normalized.admissionsDischarges.netChange) : '—'}
          />
        </div>

        <AdmissionsDischargesTrend data={normalized.admissionsDischarges} />

        <div className="mt-6">
          <LosByProductTypeSection lengthOfStay={normalized.lengthOfStay} companyName={summary.companyName} />
        </div>

        {Object.keys(normalized.lengthOfStay?.moveOutReasons || {}).length > 0 && (
          <div className="mt-6">
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Discharges by reason (this period's move-outs)</h3>
            <div className="space-y-1">
              {Object.entries(normalized.lengthOfStay.moveOutReasons)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, pct]) => (
                  <div key={reason} className="flex justify-between text-sm">
                    <span className="text-neutral-700 capitalize">{reason}</span>
                    <span className="text-neutral-500">{pctStr(pct)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* 6. LEVELS OF CARE */}
      <SectionCard title="Levels of Care" description="Care-level evaluation compliance — excludes Independent Living residents">
        <CareLevelEvaluations data={normalized.careLevelEvaluations} communities={summary.communities} companyName={summary.companyName} />
      </SectionCard>

      {/* SUPPORT & CONTEXT */}
      <SectionCard
        title="Support & Context"
        action={
          (ticketSummary || dealSummary) && (
            <HubspotRefreshButton
              jobId={jobId}
              onRefreshed={(newSummary) => setSnapshot((prev) => ({ ...prev, summary: newSummary }))}
            />
          )
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Tickets — flex column stretched to the grid row's full height
              (driven by whichever of the 3 columns has the most natural
              content, often Communities on a large multi-community account)
              so the open-tickets list fills that space before it scrolls,
              rather than always scrolling inside a small fixed box next to
              a much taller column. min-h-0 at each flex level is required
              for the innermost overflow-y-auto to actually shrink/scroll
              instead of forcing the flex column to grow unbounded. */}
          <div className="flex flex-col h-full">
            <h3 className="font-semibold text-primary-900 text-sm mb-3">HubSpot Tickets</h3>
            {ticketSummary ? (
              <div className="flex flex-col flex-1 min-h-0">
                <p className="text-sm text-neutral-600 mb-3">
                  {ticketSummary.total} total · {ticketSummary.open} open · {ticketSummary.closed} closed
                </p>
                <div className="space-y-1">
                  {Object.entries(ticketSummary.byCategory || {}).map(([cat, counts]) => (
                    <div key={cat} className="flex justify-between text-sm">
                      <span className="text-neutral-700">{cat}</span>
                      <span className="text-neutral-500">{counts.total} ({counts.open} open)</span>
                    </div>
                  ))}
                </div>

                {/* Individually linked so an open ticket can be worked/closed
                    directly in HubSpot from here, then picked up by the
                    Refresh HubSpot button above without re-running the job. */}
                {ticketSummary.open > 0 && (
                  <div className="mt-4 pt-4 border-t border-neutral-100 flex flex-col flex-1 min-h-0">
                    <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Open tickets</p>
                    <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
                      {[...ticketSummary.tickets]
                        .filter((t) => t.isOpen)
                        .sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0))
                        .map((t) => (
                          <div key={t.id} className="text-sm">
                            {t.url ? (
                              <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline font-medium break-words">
                                {t.subject || `Ticket #${t.id}`}
                              </a>
                            ) : (
                              <span className="font-medium text-neutral-700 break-words">{t.subject || `Ticket #${t.id}`}</span>
                            )}
                            <div className="text-xs text-neutral-500">
                              {t.category}{t.daysOpen != null ? ` · ${t.daysOpen}d open` : ''}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No HubSpot company was linked for this pull.</p>
            )}
          </div>

          {/* Deals — live-pulled directly from HubSpot by company ID, same
              as Tickets above; independent of whether a health-export JSON
              has been imported for this job. Name/link get their own line
              (not a tight flex row) since deal names routinely run long
              enough to truncate into something unreadable/unclickable. */}
          <div>
            <h3 className="font-semibold text-primary-900 text-sm mb-3">HubSpot Deals</h3>
            {dealSummary ? (
              <div>
                <p className="text-sm text-neutral-600 mb-3">
                  {dealSummary.open} open ({currencyStr(dealSummary.totalOpenValue)}) · {dealSummary.closed} closed
                </p>
                {dealSummary.openDeals.length > 0 ? (
                  <div className="space-y-3">
                    {dealSummary.openDeals.map((d) => (
                      <div key={d.id} className="text-sm">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline font-medium break-words">{d.name}</a>
                        ) : (
                          <span className="font-medium text-neutral-700 break-words">{d.name}</span>
                        )}
                        <div className="text-xs text-neutral-500">{d.stage}{d.amount != null ? ` · ${currencyStr(d.amount)}` : ''}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 italic">No open deals.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No HubSpot company was linked for this pull.</p>
            )}
          </div>

          {/* Communities */}
          <div>
            <h3 className="font-semibold text-primary-900 text-sm mb-3">Communities in this pull</h3>
            <ul className="text-sm text-neutral-700 space-y-1">
              {summary.communities.map((c) => {
                // Community IDs are only unique within a single ALIS host —
                // a multi-host account (see companyHost) can have two
                // communities sharing the same numeric ID, so the React key
                // and the "which account is this from" label both need host.
                const showHost = new Set(summary.communities.map((x) => x.host)).size > 1;
                return (
                  <li key={`${c.host}-${c.communityId}`}>
                    {c.name} <span className="text-neutral-400">({c.communityId}{showHost && c.host ? ` · ${c.host}` : ''})</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </SectionCard>

      {/* TOP 3 ENHANCEMENT REQUESTS — deliberately its own section (not a
          Support & Context grid cell): per Aaron (Sep 2026), these are the
          client's own highest-priority asks and need to be impossible to
          miss, both when present and — just as importantly — when absent
          (an account with nothing tagged/staged Top 3 should read as a
          real gap to close, not a silently-empty section). Two independent
          HubSpot signals (see hubspotTickets.js): the "Top 3" tag property
          (rank 1/2/3) and the "Top 3 Enhancements" pipeline stage — a
          ticket can drift to having only one, which is exactly what
          `misaligned` calls out. */}
      <SectionCard title="Top 3 Enhancement Requests">
        {!ticketSummary ? (
          <p className="text-sm text-neutral-500">No HubSpot company was linked for this pull.</p>
        ) : !ticketSummary.topThreeEnhancements?.hasAny ? (
          <div className="alert alert-warning">
            <span>⚠️</span>
            <p className="text-sm">No tickets are currently tagged (Top 3 rank) or staged (&ldquo;Top 3 Enhancements&rdquo;) as a Top 3 enhancement request for this account. Worth confirming with the client whether that&rsquo;s accurate, or whether their asks just haven&rsquo;t been captured in HubSpot yet.</p>
          </div>
        ) : (
          <div>
            {ticketSummary.topThreeEnhancements.misaligned.length > 0 && (
              <div className="alert alert-warning mb-4">
                <span>⚠️</span>
                <div>
                  <p className="text-sm font-semibold mb-1">
                    {ticketSummary.topThreeEnhancements.misaligned.length} ticket(s) have only one of the two Top 3 signals set — worth reconciling:
                  </p>
                  {ticketSummary.topThreeEnhancements.misaligned.map((t) => (
                    <p key={t.id} className="text-sm">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline font-medium">{t.subject || `Ticket #${t.id}`}</a>
                      ) : (
                        <span className="font-medium">{t.subject || `Ticket #${t.id}`}</span>
                      )}
                      {' — '}
                      {t.taggedTop3 && !t.statusTop3 && `tagged Top ${t.topThreeRank}, but stage is "${t.pipelineStageLabel}" (not "Top 3 Enhancements")`}
                      {!t.taggedTop3 && t.statusTop3 && 'stage is "Top 3 Enhancements", but no Top 3 rank tag is set'}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {ticketSummary.topThreeEnhancements.items.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-4 text-sm py-2 border-b border-neutral-100 last:border-0">
                  <div>
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline font-medium break-words">{t.subject || `Ticket #${t.id}`}</a>
                    ) : (
                      <span className="font-medium text-neutral-700 break-words">{t.subject || `Ticket #${t.id}`}</span>
                    )}
                    <div className="text-xs text-neutral-500">
                      {t.category} · {t.pipelineStageLabel}{t.isOpen ? '' : ' (closed)'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.taggedTop3 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary-100 text-primary-800">Top {t.topThreeRank}</span>
                    )}
                    {!t.aligned && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-warning/20 text-warning" title="Only one of the two Top 3 signals is set">⚠ unaligned</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <AccountHealthImport
        jobId={jobId}
        hubspotHealth={hubspotHealth}
        initialWarning={hubspotHealthImportWarning}
        onImported={(newSummary) => setSnapshot((prev) => ({ ...prev, summary: newSummary }))}
      />

      <ReleaseRecommendationsImport
        jobId={jobId}
        releaseRecommendations={releaseRecommendations}
        initialWarning={releaseImportWarning}
        onImported={(newSummary) => setSnapshot((prev) => ({ ...prev, summary: newSummary }))}
      />
    </div>
  );
}
