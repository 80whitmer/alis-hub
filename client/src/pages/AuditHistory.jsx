import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { exportAuditHistory } from '../utils/auditHistoryExport';
import BackToTopButton from '../components/BackToTopButton';

function AuditRow({ row, showTarget }) {
  return (
    <tr className="border-b border-neutral-100 last:border-0">
      {showTarget && <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{row.targetLabel}</td>}
      <td className="py-2 pr-4 text-neutral-800">{row.note}</td>
      <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">{row.updatedAt}</td>
      <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">
        {row.updatedByName}
        {row.updatedByUsername && <span className="text-neutral-400"> ({row.updatedByUsername})</span>}
      </td>
    </tr>
  );
}

function AuditTable({ rows, showTarget }) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-neutral-400 italic py-4">No matching audit rows.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
            {showTarget && <th className="py-2 pr-4">Target</th>}
            <th className="py-2 pr-4">Note</th>
            <th className="py-2 pr-4">Updated At</th>
            <th className="py-2 pr-4">Updated By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => <AuditRow key={i} row={row} showTarget={showTarget} />)}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditHistory() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  // 'combined' or a targetLabel — which view is showing.
  const [activeView, setActiveView] = useState('combined');

  useEffect(() => {
    fetch(`/api/audit-history/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no audit-history snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data.summary))
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/audit-history/${jobId}/export-pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${snapshot?.companyName || 'Audit-History'}.pdf`;
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
    return <div className="text-center py-12"><p className="text-neutral-500">Loading audit history...</p></div>;
  }

  const f = snapshot.filters || {};
  const filterParts = [];
  if (f.startDate || f.endDate) filterParts.push(`${f.startDate || '…'} – ${f.endDate || '…'}`);
  if (f.category) filterParts.push(`Type: ${f.category}`);
  if (f.staffId) filterParts.push(`Staff ID: ${f.staffId}`);
  if (f.notes) filterParts.push(`Notes contains "${f.notes}"`);

  const activeTarget = activeView === 'combined' ? null : snapshot.targets.find((t) => t.targetLabel === activeView);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{snapshot.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            ALIS Audit History · host {snapshot.companyHost} · {snapshot.totalRows} row(s) across {snapshot.targets.length} target(s)
          </p>
          {filterParts.length > 0 && (
            <p className="text-xs text-neutral-500 mt-1">Filters: {filterParts.join(' · ')}</p>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          <button className="btn btn-secondary" onClick={() => exportAuditHistory(snapshot)}>
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

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          className={`btn btn-sm ${activeView === 'combined' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveView('combined')}
        >
          Combined ({snapshot.totalRows})
        </button>
        {snapshot.targets.map((t) => (
          <button
            key={t.targetLabel}
            className={`btn btn-sm ${activeView === t.targetLabel ? 'btn-primary' : 'btn-secondary'} ${t.error ? 'text-error' : ''}`}
            onClick={() => setActiveView(t.targetLabel)}
            title={t.error || undefined}
          >
            {t.targetLabel} ({t.error ? 'failed' : t.rowCount}{t.truncated ? '+' : ''})
          </button>
        ))}
      </div>

      <div className="card">
        {activeTarget?.error ? (
          <p className="text-sm text-error py-4">This target failed to pull: {activeTarget.error}</p>
        ) : (
          <AuditTable
            rows={activeView === 'combined' ? snapshot.combined : activeTarget?.rows}
            showTarget={activeView === 'combined'}
          />
        )}
        {activeTarget?.truncated && (
          <p className="text-xs text-warning mt-3">This target hit the 500-row safety cap — narrow the date range for a complete pull.</p>
        )}
      </div>
      <BackToTopButton />
    </div>
  );
}
