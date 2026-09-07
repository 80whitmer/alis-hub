import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie,
} from 'recharts';
import Drawer from '../components/Drawer';
import {
  exportAccountHealthPortfolioExcel, exportAccountHealthSingleExcel,
  exportCompanyHostTemplate, parseCompanyHostTemplate,
} from '../utils/accountHealthExport';

function pctStr(p) {
  return p != null ? `${(p * 100).toFixed(1)}%` : '—';
}

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

function StatCard({ label, value, sub }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function CompanyLink({ account, children, className = 'text-accent-600 hover:underline' }) {
  if (!account.hubspotUrl) return <span>{children}</span>;
  return (
    <a
      href={account.hubspotUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </a>
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

/**
 * Manual weekly upload of Dave Johnson's Intacct "Customer Aging Report"
 * PDF — see server/services/agingReportParser.js's doc comment for why
 * this is manual rather than automatic Gmail ingestion. Sent as base64 in
 * the JSON body, same transport KpiDashboard.jsx's AccountHealthImport
 * already uses for its own JSON upload.
 */
function ImportAgingReportButton({ onImported }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const pdfBase64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
      const res = await fetch('/api/account-health/import-aging-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setResult(data);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="text-right">
      <label className="btn btn-sm btn-secondary cursor-pointer">
        {importing ? 'Importing…' : '📥 Import Aging Report'}
        <input type="file" accept="application/pdf" onChange={handleFile} disabled={importing} className="hidden" />
      </label>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs ml-auto">
          {result.accountsUpdated} account(s) updated from {result.rowsMatched} of {result.rowsParsed} rows
          {result.unmatchedCount > 0 && ` — ${result.unmatchedCount} row(s) didn't match any of your accounts (likely other AMs' clients)`}
        </p>
      )}
    </div>
  );
}

/**
 * Lets Aaron map each account to its ALIS subdomain — the one piece of
 * data needed to pull capacity/census (server/api/companyHosts.js has no
 * UI of its own, only a bulk-import API route). Downloads a template
 * pre-filled with every account name + ID (and any subdomain already
 * known); the upload half reads a completed copy back and posts it to
 * that same existing import route. Confirmed live (Sep 2026): only 7 of
 * 109 accounts have a mapping today, so this is expected to be filled in
 * gradually, not all at once.
 */
function CompanyHostMappingButtons({ accounts, companyHosts, onImported }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const mappedCount = companyHosts.filter((h) => accounts.some((a) => a.hubspot_company_id === h.hubspot_company_id)).length;

  async function handleDownload() {
    await exportCompanyHostTemplate(accounts, companyHosts);
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const rows = await parseCompanyHostTemplate(file);
      if (rows.length === 0) throw new Error('No rows with an ALIS Subdomain filled in were found in this file.');
      const res = await fetch('/api/company-hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setResult(data);
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="text-right">
      <p className="text-xs text-neutral-400 mb-1">{mappedCount} of {accounts.length} accounts have a known ALIS subdomain</p>
      <div className="flex gap-2 justify-end">
        <button onClick={handleDownload} className="btn btn-sm btn-secondary">📋 Download Subdomain Template</button>
        <label className="btn btn-sm btn-secondary cursor-pointer">
          {importing ? 'Importing…' : '📤 Upload Completed Template'}
          <input type="file" accept=".xlsx" onChange={handleUpload} disabled={importing} className="hidden" />
        </label>
      </div>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
      {result && <p className="text-xs text-neutral-500 mt-1 max-w-xs ml-auto">{result.imported} subdomain(s) imported{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}</p>}
    </div>
  );
}

/**
 * Total capacity + current census refresh — a separate action from the
 * main HubSpot refresh (RefreshButton above), since this hits a
 * genuinely different, Basic-Auth-per-subdomain external API (ALIS's own
 * export API) with much sparser coverage today (see
 * CompanyHostMappingButtons above) than the HubSpot data.
 */
function RefreshOccupancyButton({ onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleClick() {
    setRefreshing(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/account-health/refresh-occupancy', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setResult(data);
      await onRefreshed();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="text-right">
      <button onClick={handleClick} disabled={refreshing} className="btn btn-sm btn-secondary">
        {refreshing ? 'Refreshing…' : '🏘️ Refresh Occupancy Data'}
      </button>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
      {result && (
        <p className="text-xs text-neutral-500 mt-1 max-w-xs ml-auto">
          {result.accountsUpdated} account(s) updated
          {result.accountsSkippedNoMapping > 0 && `, ${result.accountsSkippedNoMapping} skipped (no ALIS subdomain mapped)`}
        </p>
      )}
    </div>
  );
}

/** Downloads a server-rendered PDF via fetch+Blob — same pattern WellnessScorecard.jsx uses for its export-pdf route. */
async function downloadPdf(url, fallbackFilename) {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Export failed (${res.status})`);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function ExportButtons({ onExcel, onPdf, size = 'sm' }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function run(kind, fn) {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="text-right">
      <div className="flex gap-2 justify-end">
        <button onClick={() => run('excel', onExcel)} disabled={busy != null} className={`btn btn-${size} btn-secondary`}>
          {busy === 'excel' ? 'Exporting…' : '📊 Export Excel'}
        </button>
        <button onClick={() => run('pdf', onPdf)} disabled={busy != null} className={`btn btn-${size} btn-secondary`}>
          {busy === 'pdf' ? 'Exporting…' : '📄 Export PDF'}
        </button>
      </div>
      {error && <p className="text-xs text-error mt-1 max-w-xs ml-auto">{error}</p>}
    </div>
  );
}

const PIE_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4d7c0f', '#9333ea'];

function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="flex gap-1 mb-2">
      {['bar', 'pie'].map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
            value === t ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function CategoryMixChart({ accounts, status }) {
  const [chartType, setChartType] = useState('bar');
  const [showLegend, setShowLegend] = useState(false);
  const byCategory = {};
  for (const a of accounts) {
    const mix = a.serviceHealth?.ticketCategoryMix || {};
    for (const [cat, counts] of Object.entries(mix)) {
      byCategory[cat] = (byCategory[cat] || 0) + (counts[status] || 0);
    }
  }
  const data = Object.entries(byCategory)
    .map(([name, total]) => ({ name, total }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No {status} ticket data yet — click Refresh to pull it.</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        {chartType === 'pie' && (
          <button
            onClick={() => setShowLegend((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300 transition-colors"
          >
            {showLegend ? 'Hide Key' : 'Show Key'}
          </button>
        )}
      </div>
      <ResponsiveContainer width="100%" height={480}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={170} label={({ name, total }) => `${name}: ${total}`}>
              {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            {showLegend && <Legend />}
          </PieChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={180} />
            <Tooltip />
            <Bar dataKey="total" fill={status === 'open' ? '#dc2626' : '#2563eb'} radius={[0, 4, 4, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </>
  );
}

function DealTypeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-primary-900 mb-1">{d.name}</p>
      <p className="text-neutral-600">{d.count} deal{d.count === 1 ? '' : 's'}</p>
      <p className="text-neutral-600">{currencyStr(d.valueCents)} total value</p>
    </div>
  );
}

function DealTypeChart({ accounts }) {
  const byType = {};
  for (const a of accounts) {
    const mix = a.financialHealth?.dealsByType || {};
    for (const [type, { count, valueCents }] of Object.entries(mix)) {
      if (!byType[type]) byType[type] = { count: 0, valueCents: 0 };
      byType[type].count += count;
      byType[type].valueCents += valueCents;
    }
  }
  const data = Object.entries(byType)
    .map(([name, v]) => ({ name, count: v.count, valueCents: v.valueCents }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No deal data yet — click Refresh to pull it.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={480}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={90} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip content={<DealTypeTooltip />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626'][i % 5]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Mirrors KpiDashboard.jsx's OccupancyByProductTypeSection table shape/style — same {productType|classification, pct, occupied, total} rows, just a different data source (accountHealthOccupancy.js instead of a kpi-export job). */
function OccupancyBreakdownTable({ title, rows, keyField }) {
  if (!rows?.length) return null;
  return (
    <div className="flex-1 min-w-[220px]">
      <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">{title}</h4>
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
              <td className="py-1.5 text-right">{pctStr(r.pct)}</td>
              <td className="py-1.5 text-right">{r.occupied} / {r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      subtitle={
        <>
          {account.hubspotUrl ? (
            <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
              Open in HubSpot
            </a>
          ) : `HubSpot company ${account.hubspot_company_id}`}
          {account.lifecycle_stage ? ` · lifecycle stage ${account.lifecycle_stage}` : ''}
        </>
      }
      badge={<ScoreBadge score={account.health_score} band={BAND_LABEL_TO_COLOR[account.health_band] || null} />}
      onClose={onClose}
    >
      <div className="mb-4">
        <ExportButtons
          onExcel={() => exportAccountHealthSingleExcel(account)}
          onPdf={() => downloadPdf(`/api/account-health/${account.hubspot_company_id}/export-pdf`, `${account.company_name}-Account-Health.pdf`)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Open Tickets" value={account.open_ticket_count} sub="Client Submitted + In Progress" />
        <StatCard label="Closed Tickets" value={account.closed_ticket_count} />
        <StatCard label="Open Deals" value={account.open_deal_count} />
        <StatCard label="Open Deal Value" value={currencyStr(account.open_deal_value_cents)} />
        <StatCard label="ARR" value={account.arr_cents != null ? currencyStr(account.arr_cents) : '—'} />
        <StatCard label={`ARR Added (${new Date().getFullYear()})`} value={currencyStr(account.arr_added_this_year_cents)} />
        <StatCard label="Aging Balance" value={account.aging_total_cents != null ? currencyStr(account.aging_total_cents) : '—'} />
        <StatCard label="DSO" value={account.dsoDays != null ? `${account.dsoDays}d` : '—'} sub="Rudimentary — see Portfolio DSO note" />
        <StatCard label="Total Capacity" value={account.total_capacity ?? '—'} sub={account.occupancy_as_of_date ? `As of ${account.occupancy_as_of_date}` : 'No ALIS subdomain mapped'} />
        <StatCard label="Current Census" value={account.current_census ?? '—'} sub={account.occupancy_pct != null ? `${pctStr(account.occupancy_pct)} occupied` : undefined} />
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

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Enhancement Tracking</h3>
      {(svc?.enhancementTopItems?.length > 0 || svc?.enhancementLesserCount > 0) ? (
        <div className="text-sm mb-6">
          {svc.enhancementTopItems?.length > 0 && (
            <ul className="space-y-1 mb-2">
              {svc.enhancementTopItems.map((t) => (
                <li key={t.ticketId} className="flex justify-between gap-2">
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline truncate">
                    {t.rank ? `#${t.rank} · ` : ''}{t.subject}
                  </a>
                  <span className="text-neutral-400 shrink-0">{t.stage}</span>
                </li>
              ))}
            </ul>
          )}
          {svc.enhancementLesserCount > 0 && (
            <p className="text-neutral-500">{svc.enhancementLesserCount} additional Long-Term Project(s) tracked as lesser enhancements.</p>
          )}
        </div>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No enhancement requests tracked.</p>}
      {svc?.otherOpenCount > 0 && (
        <p className="text-xs text-neutral-400 -mt-4 mb-6">{svc.otherOpenCount} other open ticket(s) in lower-volume statuses (billing/support), not counted above.</p>
      )}

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

      <h3 className="font-semibold text-primary-900 text-sm mb-2">AR Aging</h3>
      {account.aging ? (
        <div className="mb-6">
          <p className="text-xs text-neutral-400 mb-2">As of {account.aging.asOfDate} — {account.aging.sourceRows.length} Intacct line(s) rolled up</p>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase">
                <th className="py-1">Current</th>
                <th className="py-1 text-right">1-30</th>
                <th className="py-1 text-right">31-60</th>
                <th className="py-1 text-right">61-90</th>
                <th className="py-1 text-right">91-120</th>
                <th className="py-1 text-right">121+</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-neutral-100">
                <td className="py-1.5">{currencyStr(account.aging.currentCents)}</td>
                <td className="py-1.5 text-right">{currencyStr(account.aging.d1_30Cents)}</td>
                <td className="py-1.5 text-right">{currencyStr(account.aging.d31_60Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d61_90Cents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d61_90Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d91_120Cents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d91_120Cents)}</td>
                <td className={`py-1.5 text-right ${account.aging.d121PlusCents > 0 ? 'text-error font-medium' : ''}`}>{currencyStr(account.aging.d121PlusCents)}</td>
                <td className="py-1.5 text-right font-semibold">{currencyStr(account.aging.totalCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-neutral-400">
            From: {account.aging.sourceRows.map((r) => r.customerName).join(', ')}
          </p>
        </div>
      ) : <p className="text-sm text-neutral-500 italic mb-6">No aging data imported for this account yet.</p>}

      <h3 className="font-semibold text-primary-900 text-sm mb-2">Occupancy</h3>
      {(account.occupancyByProductType?.length > 0 || account.occupancyByClassification?.length > 0) ? (
        <div className="mb-6">
          <div className="flex gap-6 flex-wrap">
            <OccupancyBreakdownTable title="By Product Type" rows={account.occupancyByProductType} keyField="productType" />
            <OccupancyBreakdownTable title="By Classification" rows={account.occupancyByClassification} keyField="classification" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 italic mb-6">
          {account.occupancy_as_of_date ? 'No product-type/classification breakdown available.' : 'No ALIS subdomain mapped for this account yet — see Refresh Occupancy Data.'}
        </p>
      )}

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
function DealsSection({ accounts, search }) {
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
      description={
        search.trim()
          ? `Open + recently-closed (90 days) — ${filtered.length} of ${allDeals.length} shown, matching "${search.trim()}"`
          : `Open + recently-closed (90 days) across every account — ${filtered.length} of ${allDeals.length} shown`
      }
    >
      {allDeals.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">
          {search.trim() ? `No deals for accounts matching "${search.trim()}".` : 'No deals yet — click Refresh to pull them.'}
        </p>
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
  const [companyHosts, setCompanyHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [accountsRes, hostsRes] = await Promise.all([
        fetch('/api/account-health'),
        fetch('/api/company-hosts'),
      ]);
      const data = await accountsRes.json();
      if (!accountsRes.ok) throw new Error(data.error || `Failed to load (${accountsRes.status})`);
      setAccounts(data.accounts || []);
      setCompanyHosts(hostsRes.ok ? await hostsRes.json() : []);
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

    // Weighted, not a simple average-of-averages, so a handful of small
    // accounts with an odd balance/ARR ratio can't swing the portfolio
    // figure — same reasoning as summing dollars before dividing anywhere
    // else in this rollup. Still a rudimentary DSO (see
    // accountHealthScoring.js's computeDsoDays doc comment) — labeled as
    // such wherever it's shown.
    const dsoEligible = accounts.filter((a) => a.aging_total_cents != null && a.arr_cents);
    const dsoAgingTotal = dsoEligible.reduce((s, a) => s + a.aging_total_cents, 0);
    const dsoArrTotal = dsoEligible.reduce((s, a) => s + a.arr_cents, 0);
    const portfolioDsoDays = dsoArrTotal > 0 ? Math.round(dsoAgingTotal / (dsoArrTotal / 365)) : null;

    // Only accounts with a known ALIS subdomain carry occupancy data (see
    // CompanyHostMappingButtons) — everyone else is left out of these
    // sums entirely rather than silently counted as 0 capacity.
    const occupancyEligible = accounts.filter((a) => a.total_capacity != null);
    const totalCapacity = occupancyEligible.reduce((s, a) => s + a.total_capacity, 0);
    const currentCensus = occupancyEligible.reduce((s, a) => s + (a.current_census || 0), 0);
    const occupancyAsOfDate = accounts.find((a) => a.occupancy_as_of_date)?.occupancy_as_of_date || null;

    return {
      totalAccounts: accounts.length,
      openTickets: accounts.reduce((s, a) => s + (a.open_ticket_count || 0), 0),
      closedTickets: accounts.reduce((s, a) => s + (a.closed_ticket_count || 0), 0),
      enhancementTop: accounts.reduce((s, a) => s + (a.enhancement_top_count || 0), 0),
      enhancementLesser: accounts.reduce((s, a) => s + (a.enhancement_lesser_count || 0), 0),
      otherOpen: accounts.reduce((s, a) => s + (a.other_open_ticket_count || 0), 0),
      openDeals: accounts.reduce((s, a) => s + (a.open_deal_count || 0), 0),
      openDealValueCents: accounts.reduce((s, a) => s + (a.open_deal_value_cents || 0), 0),
      arrCents: accounts.reduce((s, a) => s + (a.arr_cents || 0), 0),
      arrAddedThisYearCents: accounts.reduce((s, a) => s + (a.arr_added_this_year_cents || 0), 0),
      agingTotalCents: accounts.reduce((s, a) => s + (a.aging_total_cents || 0), 0),
      pastDue61PlusCents: accounts.reduce((s, a) => s + (a.aging_past_due_61_plus_cents || 0), 0),
      agingAsOfDate: accounts.find((a) => a.aging_as_of_date)?.aging_as_of_date || null,
      portfolioDsoDays,
      totalCapacity,
      currentCensus,
      occupancyPct: totalCapacity > 0 ? currentCensus / totalCapacity : null,
      occupancyAccountCount: occupancyEligible.length,
      occupancyAsOfDate,
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
          {refreshResult?.excludedInactiveCommunities?.length > 0 && (
            <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
              Excluded {refreshResult.excludedInactiveCommunities.length} Home Office(s) with no active ALIS community: {refreshResult.excludedInactiveCommunities.map((c) => c.name).join(', ')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 justify-end max-w-2xl">
          <ExportButtons
            onExcel={() => exportAccountHealthPortfolioExcel(accounts, rollup)}
            onPdf={() => downloadPdf('/api/account-health/export-pdf', 'Account-Health-Portfolio.pdf')}
          />
          <ImportAgingReportButton onImported={load} />
          <CompanyHostMappingButtons accounts={accounts} companyHosts={companyHosts} onImported={load} />
          <RefreshOccupancyButton onRefreshed={load} />
          <RefreshButton onRefreshed={handleRefreshed} />
        </div>
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
            <StatCard
              label="Open Tickets"
              value={rollup.openTickets}
              sub="Client Submitted + In Progress"
            />
            <StatCard label="Closed Tickets" value={rollup.closedTickets} />
            <StatCard label="Avg Health Score" value={rollup.avgScore ?? '—'} />
            <StatCard
              label="Enhancement Requests"
              value={rollup.enhancementTop + rollup.enhancementLesser}
              sub={`${rollup.enhancementTop} Top 3 · ${rollup.enhancementLesser} Long-Term${rollup.otherOpen > 0 ? ` · ${rollup.otherOpen} other open` : ''}`}
            />
            <StatCard label="Open Deals" value={rollup.openDeals} />
            <StatCard label="Open Deal Value" value={currencyStr(rollup.openDealValueCents)} />
            <StatCard label="Total ARR" value={currencyStr(rollup.arrCents)} />
            <StatCard label={`ARR Added (${new Date().getFullYear()})`} value={currencyStr(rollup.arrAddedThisYearCents)} />
            <StatCard
              label={`Total Capacity${rollup.occupancyAsOfDate ? ` (as of ${rollup.occupancyAsOfDate})` : ''}`}
              value={rollup.occupancyAccountCount > 0 ? rollup.totalCapacity : '—'}
              sub={rollup.occupancyAccountCount > 0 ? `${rollup.occupancyAccountCount} of ${rollup.totalAccounts} accounts mapped` : 'No ALIS subdomains mapped yet'}
            />
            <StatCard
              label="Current Census"
              value={rollup.occupancyAccountCount > 0 ? rollup.currentCensus : '—'}
              sub={rollup.occupancyPct != null ? `${pctStr(rollup.occupancyPct)} occupied` : undefined}
            />
            <StatCard
              label={`Aging Balance${rollup.agingAsOfDate ? ` (as of ${rollup.agingAsOfDate})` : ''}`}
              value={rollup.agingAsOfDate ? currencyStr(rollup.agingTotalCents) : '—'}
            />
            <StatCard
              label="Past Due 61+ Days"
              value={rollup.agingAsOfDate ? currencyStr(rollup.pastDue61PlusCents) : '—'}
            />
            <StatCard
              label="Portfolio DSO"
              value={rollup.portfolioDsoDays != null ? `${rollup.portfolioDsoDays}d` : '—'}
              sub="Rudimentary — AR balance ÷ daily revenue rate, not true invoice-to-payment DSO"
            />
          </div>

          <SectionCard title="Open Tickets by Category 2.0" description="Aggregated across every account — current workload">
            <CategoryMixChart accounts={accounts} status="open" />
          </SectionCard>
          <SectionCard title="Closed Tickets by Category 2.0" description="Aggregated across every account — historical mix">
            <CategoryMixChart accounts={accounts} status="closed" />
          </SectionCard>
          <SectionCard title="Deals by Type" description="Aggregated across every account's deal history">
            <DealTypeChart accounts={accounts} />
          </SectionCard>

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
                    <SortableHeader label="ARR" column="arr_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Aging Balance" column="aging_total_cents" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="DSO" column="dsoDays" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Total Capacity" column="total_capacity" sort={sort} onSort={toggleSort} className="pr-4" />
                    <SortableHeader label="Current Census" column="current_census" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr
                      key={a.hubspot_company_id}
                      className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
                      onClick={() => setSelected(a)}
                    >
                      <td className="py-2 pr-4 font-medium">
                        <CompanyLink account={a} className="text-neutral-700 hover:text-accent-600 hover:underline">{a.company_name}</CompanyLink>
                      </td>
                      <td className="py-2 pr-4"><ScoreBadge score={a.health_score} band={BAND_LABEL_TO_COLOR[a.health_band] || null} /></td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.closed_ticket_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.open_deal_count}</td>
                      <td className="py-2 pr-4 text-neutral-500">{currencyStr(a.open_deal_value_cents)}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.arr_cents != null ? currencyStr(a.arr_cents) : '—'}</td>
                      <td className={`py-2 pr-4 ${a.aging_past_due_61_plus_cents > 0 ? 'text-error font-medium' : 'text-neutral-500'}`}>
                        {a.aging_total_cents != null ? currencyStr(a.aging_total_cents) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-neutral-500">{a.dsoDays != null ? `${a.dsoDays}d` : '—'}</td>
                      <td className="py-2 pr-4 text-neutral-500">{a.total_capacity ?? '—'}</td>
                      <td className="py-2 text-neutral-500">{a.current_census ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="text-sm text-neutral-500 italic py-4">No accounts match "{search}".</p>}
            </div>
          </SectionCard>

          <DealsSection accounts={filtered} search={search} />
        </>
      )}

      {selected && <AccountDrawer account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
