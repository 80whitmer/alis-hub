import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { resolveWellnessRow, getVisibleWellnessRows } from '../utils/wellnessRows';
import { exportWellnessScorecard } from '../utils/wellnessScorecardExport';
import { exportWellnessResidentList } from '../utils/wellnessResidentListExport';
import BackToTopButton from '../components/BackToTopButton';
import Drawer from '../components/Drawer';
import UpcomingBirthdaysPanel, { hasUpcomingBirthdays } from '../components/UpcomingBirthdaysPanel';

function BenchmarkBadge({ diff }) {
  if (!diff || diff.benchmark == null) return null;
  return (
    <span className={`text-xs font-medium ml-2 ${diff.better ? 'text-success' : 'text-error'}`}>
      {diff.better ? '▲' : '▼'} ALIS 500: {diff.benchmark.toFixed(1)}/1,000 res-days
    </span>
  );
}

/**
 * Per client feedback (Gallaher, 2026-09-01): how many of this row's
 * incidents this week still have an incomplete form or intervention — same
 * signal now driving a QBR flag (kpiNormalizer.js's normalizeIncidentCompletion),
 * surfaced here per scope (portfolio and each community) rather than
 * portfolio-only like BenchmarkBadge, since catching this up community by
 * community is the whole point.
 */
/** Small hover-tooltip "i" icon for a row's `note` (WELLNESS_ROWS) — a native `title` attribute rather than a custom popover component, matching DocCompletionBadge's own tooltip approach just below. */
function InfoNote({ note }) {
  if (!note) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 ml-1.5 rounded-full bg-neutral-200 text-neutral-600 text-[10px] font-semibold cursor-help align-middle"
      title={note}
    >
      i
    </span>
  );
}

function DocCompletionBadge({ openDocsTotal, openDocsReporters }) {
  if (!openDocsTotal) return null;
  const title = openDocsReporters?.length
    ? `Reported by: ${openDocsReporters.map((r) => `${r.name}${r.count > 1 ? ` x${r.count}` : ''}`).join(', ')}`
    : 'Incidents this week still missing a completed form or intervention';
  return (
    <span className="text-xs font-medium ml-2 text-error" title={title}>
      ⚠ {openDocsTotal} undocumented
    </span>
  );
}

// Every row here is a risk/concern count — there's no row on this scorecard
// where more is better — so ↑ (more this week) reads as a warning color, ↓
// as success, and → as neutral, on top of just being bigger/bolder.
const TREND_COLOR = { '↑': 'text-error', '↓': 'text-success', '→': 'text-neutral-400' };

function TrendArrow({ trend }) {
  if (!trend || trend === '—') return <span className="text-neutral-300">—</span>;
  return <span className={`text-lg font-bold ${TREND_COLOR[trend] || 'text-neutral-500'}`}>{trend}</span>;
}

/**
 * Resident-level detail behind a row flagged `hasResidentDrawer` (currently
 * "Residents currently hospitalized / in ER" and "New significant change
 * in condition") — same drawer+Excel-export shape as every other KPI
 * drill-down in this app (see Drawer.jsx's own doc comment), just newly
 * wired up here since this page had no drawer at all before now. `items`
 * already carries a unified `detail` string per row type (see
 * wellnessNormalizer.js's attachItems callers), so this stays generic
 * rather than needing to know which row it's showing.
 */
function ResidentDrawer({ label, items, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportWellnessResidentList(label, items);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title={label}
      subtitle={`${items.length} resident${items.length === 1 ? '' : 's'}`}
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
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No residents to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <th className="pb-2 pr-4">Resident</th>
                <th className="pb-2 pr-4">Community</th>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.residentId}-${i}`} className="border-t border-neutral-100">
                  <td className="py-2 pr-4">{it.residentName || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{it.communityName || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{it.date ? it.date.slice(0, 10) : '—'}</td>
                  <td className="py-2 text-neutral-500">{it.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

const AGE_BANDS = ['<60', '60s', '70s', '80s', '90s', '100+'];

/**
 * Average resident age + decade-band counts for one scope (Aaron, Sep
 * 2026) — rendered inside each WellnessTable (portfolio and every
 * community), same "own small summary, not forced into the AL/MC/Total
 * row shape" treatment as OccupancySection gets, just per-scope instead
 * of portfolio-only since Aaron asked for this to roll up AND break out
 * by community.
 */
function ResidentAgeSummary({ ageData }) {
  if (!ageData || ageData.countedForAge === 0) return null;
  return (
    <div className="mb-4 pb-4 border-b border-neutral-100 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <span className="text-neutral-800">
        <span className="font-semibold">{ageData.avgAge.toFixed(1)}</span>
        <span className="text-neutral-500"> avg resident age</span>
        {ageData.countedForAge < ageData.totalResidents && (
          <span className="text-neutral-400"> ({ageData.countedForAge} of {ageData.totalResidents} with age on file)</span>
        )}
      </span>
      {AGE_BANDS.map((band) => (
        <span key={band} className="text-neutral-500 text-xs uppercase tracking-wide">
          {band}: <span className="font-semibold text-neutral-700 normal-case">{ageData.bandCounts[band]}</span>
        </span>
      ))}
    </div>
  );
}

function WellnessTable({ title, snapshot, communityId, description, hideUntracked }) {
  let currentCategory = null;
  const visibleRows = getVisibleWellnessRows(snapshot);
  const rows = hideUntracked ? visibleRows.filter((r) => r.source !== 'manual') : visibleRows;
  const [drawerRow, setDrawerRow] = useState(null);
  const ageData = communityId ? snapshot.residentAge?.byCommunity?.[communityId] : snapshot.residentAge?.portfolio;
  return (
    <div className="card mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-primary-900">{title}</h2>
        {description && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
      </div>
      <ResidentAgeSummary ageData={ageData} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Key Indicator</th>
              <th className="py-2 pr-3 text-right">AL</th>
              <th className="py-2 pr-3 text-right">MC</th>
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="py-2 pr-3 text-right">Prior Week</th>
              <th className="py-2 pr-4 text-center">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const v = resolveWellnessRow(row, snapshot, communityId);
              const showCategory = row.category !== currentCategory;
              currentCategory = row.category;
              const diff = row.hasBenchmark ? snapshot.benchmarkDiffs?.[row.key] : null;
              return (
                <tr key={`${row.category}-${row.key}`} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 pr-4 text-neutral-500">{showCategory ? row.category : ''}</td>
                  <td className="py-2 pr-4 text-neutral-800">
                    {row.label}
                    <InfoNote note={row.note} />
                    {!communityId && <BenchmarkBadge diff={diff} />}
                    {row.hasDocCompletion && <DocCompletionBadge openDocsTotal={v.openDocsTotal} openDocsReporters={v.openDocsReporters} />}
                  </td>
                  <td className="py-2 pr-3 text-right">{v.al}</td>
                  <td className="py-2 pr-3 text-right">{v.mc}</td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {row.hasResidentDrawer && v.items?.length > 0 ? (
                      <button onClick={() => setDrawerRow({ label: `${row.label} — ${title}`, items: v.items })} className="underline decoration-dotted hover:text-accent-600">
                        {v.total}
                      </button>
                    ) : v.total}
                  </td>
                  <td className="py-2 pr-3 text-right text-neutral-500">{v.prior}</td>
                  <td className="py-2 pr-4 text-center"><TrendArrow trend={v.trend} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drawerRow && <ResidentDrawer label={drawerRow.label} items={drawerRow.items} onClose={() => setDrawerRow(null)} />}
    </div>
  );
}

/**
 * Occupancy as of the report's week-ending date, broken out by resident
 * product type and classification — not part of the original 25-row
 * mirrored spreadsheet (this page's WellnessTable above is a deliberate
 * digitization of that exact sheet), so it renders as its own section
 * rather than forced into the AL/MC/Total row shape every other row uses.
 * Same breakdown KpiDashboard.jsx's OccupancyByProductTypeSection shows,
 * here as a point-in-time snapshot instead of a period average (see
 * wellnessNormalizer.js's normalizeOccupancySnapshot).
 */
function OccupancySection({ occupancy }) {
  if (!occupancy?.hasOccupancyData) return null;

  const renderTable = (title, rows, keyField) => (
    <div>
      <h3 className="font-semibold text-primary-900 text-sm mb-2">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase">
            <th className="py-1">{keyField === 'productType' ? 'Product Type' : 'Classification'}</th>
            <th className="py-1 text-right">% of Census</th>
            <th className="py-1 text-right">Occupied / Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyField]} className="border-t border-neutral-100">
              <td className="py-1.5">{r[keyField]}</td>
              <td className="py-1.5 text-right text-neutral-500">{r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—'}</td>
              <td className="py-1.5 text-right text-neutral-500">{r.occupied} / {r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="card mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-primary-900">Occupancy</h2>
        <p className="text-xs text-neutral-500 mt-1">As of the week-ending date — a snapshot, not a weekly count like the rows below</p>
      </div>
      <div className="mb-4">
        <span className="text-2xl font-bold text-primary-900">{(occupancy.pct * 100).toFixed(1)}%</span>
        <span className="text-neutral-500 text-sm ml-2">{occupancy.occupied} / {occupancy.total} occupied</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {occupancy.byProductType?.length > 0 && renderTable('By product type', occupancy.byProductType, 'productType')}
        {occupancy.byClassification?.length > 0 && renderTable('By classification', occupancy.byClassification, 'classification')}
      </div>
    </div>
  );
}

const HIDE_UNTRACKED_KEY = 'wellness-scorecard:hide-untracked';

export default function WellnessScorecard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  // Persisted across visits — a reviewer scanning this weekly usually wants
  // the same view every time, not to re-toggle it on every job.
  const [hideUntracked, setHideUntracked] = useState(() => {
    try { return localStorage.getItem(HIDE_UNTRACKED_KEY) === 'true'; } catch { return false; }
  });

  function toggleHideUntracked() {
    setHideUntracked((prev) => {
      const next = !prev;
      try { localStorage.setItem(HIDE_UNTRACKED_KEY, String(next)); } catch { /* best-effort */ }
      return next;
    });
  }

  useEffect(() => {
    fetch(`/api/wellness/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no wellness snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data.summary))
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/wellness/${jobId}/export-pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snapshot?.companyName || 'Wellness-Scorecard'}-${snapshot?.weekEnding || ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingPdf(false);
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }
  if (!snapshot) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading wellness scorecard...</p></div>;
  }

  const visibleRowCount = getVisibleWellnessRows(snapshot).length;
  const trackedRowCount = getVisibleWellnessRows(snapshot).filter((r) => r.source !== 'manual').length;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{snapshot.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            Week ending {snapshot.weekEnding} · benchmarked against ALIS 500 ({snapshot.benchmarkQuarter}) where published
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={() => exportWellnessScorecard(snapshot)}>
            Export to Excel
          </button>
          <button className="btn btn-primary" onClick={handleExportPdf} disabled={exportingPdf}>
            {exportingPdf ? 'Exporting...' : 'Export to PDF'}
          </button>
        </div>
      </div>

      {snapshot.dataWarnings?.length > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <div>
            {snapshot.dataWarnings.map((w, i) => <p key={i} className="text-sm">{w}</p>)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <p className="text-xs text-neutral-500 max-w-3xl">
          {hideUntracked ? (
            <>Showing only rows ALIS computes automatically. {visibleRowCount - trackedRowCount} row(s) not tracked in ALIS are hidden — exports still include all {visibleRowCount} rows.</>
          ) : (
            <>Rows showing "— not tracked in ALIS" aren't computed automatically — either the data isn't reliably
            available in ALIS today, or (for staff training/competency) that ALIS module isn't populated for this
            account yet. These stay blank for the Wellness Director to fill in, same as the original spreadsheet.</>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-600 shrink-0 ml-4 cursor-pointer select-none">
          <input type="checkbox" checked={hideUntracked} onChange={toggleHideUntracked} className="w-4 h-4 rounded cursor-pointer accent-primary-600" />
          Hide rows not tracked in ALIS
        </label>
      </div>

      <p className="text-xs text-neutral-400 mb-6 max-w-3xl">
        Medication exceptions reflect ALIS's own order-administration status flags (a dose marked "exception" or never recorded) — a client has reported this flag being set incorrectly for a passed dose, so treat this row as a starting point for review, not a final tally.
      </p>

      {hasUpcomingBirthdays(snapshot.upcomingBirthdays) && (
        <div className="card mb-8">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-primary-900">Upcoming Birthdays & Milestones</h2>
            <p className="text-sm text-neutral-500">Next 14 days, based on birthdate data already on file in ALIS</p>
          </div>
          <UpcomingBirthdaysPanel data={snapshot.upcomingBirthdays} />
        </div>
      )}

      <OccupancySection occupancy={snapshot.rows?.occupancy} />

      <WellnessTable title="Portfolio" snapshot={snapshot} description="Portfolio-wide totals across every community in this report" hideUntracked={hideUntracked} />

      {snapshot.communities.map((c) => (
        <WellnessTable
          key={`${c.host}::${c.communityId}`}
          title={c.name}
          snapshot={snapshot}
          communityId={String(c.communityId)}
          hideUntracked={hideUntracked}
        />
      ))}
      <BackToTopButton />
    </div>
  );
}
