import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const SEVERITY_BADGE = {
  risk: 'badge-error',
  opportunity: 'badge-info',
  watch: 'badge-warning',
  info: 'badge-neutral',
};

function pctStr(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
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
        <Bar dataKey="account" name="This account" fill="#2F8FFF" radius={[4, 4, 0, 0]} />
        <Bar dataKey="benchmark" name="ALIS 500 benchmark" fill="#6D6E71" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function KpiDashboard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

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
      const res = await fetch(`/api/qbr/${jobId}/export-pptx`, { method: 'POST' });
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
  const { normalized, diffs, ticketSummary, flags } = summary;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{summary.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            {summary.periodStart} – {summary.periodEnd} · benchmarked against ALIS 500 ({summary.benchmarkQuarter})
          </p>
        </div>
        <button onClick={handleExportPptx} disabled={exporting} className="btn btn-accent">
          {exporting ? 'Building deck...' : '⬇ Export PPTX'}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Occupancy" value={pctStr(normalized.occupancy?.pct)} diff={diffs.occupancyPct} formatBenchmark={(v) => pctStr(v)} />
        <StatCard label="Median Length of Stay" value={normalized.lengthOfStay?.medianDays != null ? `${Math.round(normalized.lengthOfStay.medianDays)}d` : '—'} diff={diffs.medianLosDays} formatBenchmark={(v) => `${v}d`} />
        <StatCard label="12mo Move-Out Rate" value={pctStr(normalized.lengthOfStay?.moveOutWithin?.['12mo'])} diff={diffs.moveOutWithin12mo} formatBenchmark={(v) => pctStr(v)} />
        <StatCard label="Falls / 1,000 res-days" value={normalized.falls?.per1000ResidentDays?.toFixed(1) ?? '—'} diff={diffs.fallsPer1000ResidentDays} />
        <StatCard label="Hospital/SNF visits / 1,000 res-days" value={normalized.hospitalVisits?.per1000ResidentDays?.toFixed(1) ?? '—'} diff={diffs.hospitalVisitsPer1000ResidentDays} />
        <StatCard label="Sedative PRN / 1,000 res-days" value={normalized.prnAdministration?.sedativesAntipsychotics?.toFixed(1) ?? '—'} diff={diffs.sedativePrnPer1000ResidentDays} />
        <StatCard label="Care Tasks Completed" value={pctStr(normalized.careCompletion?.pct)} />
      </div>
      {normalized.careCompletion?.daysSampled > 0 && (
        <p className="text-xs text-neutral-400 mb-8">
          Care completion sampled from {normalized.careCompletion.daysSampled} day(s) — no ALIS 500 benchmark exists for this metric yet.
        </p>
      )}

      {/* Benchmark chart */}
      <div className="card mb-8">
        <h2 className="text-lg font-semibold text-primary-900 mb-3">This account vs. ALIS 500</h2>
        <OccupancyBenchmarkChart normalized={normalized} diffs={diffs} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Tickets */}
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-900 mb-3">Support tickets</h2>
          {ticketSummary ? (
            <div>
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
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No HubSpot company was linked for this pull.</p>
          )}
        </div>

        {/* Communities */}
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-900 mb-3">Communities in this pull</h2>
          <ul className="text-sm text-neutral-700 space-y-1">
            {summary.communities.map((c) => (
              <li key={c.communityId}>{c.name} <span className="text-neutral-400">({c.communityId})</span></li>
            ))}
          </ul>
        </div>
      </div>

      {/* Discussion points */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-primary-900 mb-3">Discussion points — draft for review</h2>
        <p className="text-xs text-neutral-500 mb-3">Generated from this period's benchmark diffs and ticket history. Review before presenting — not client-facing as-is.</p>
        <FlagsPanel flags={flags} />
      </div>
    </div>
  );
}
