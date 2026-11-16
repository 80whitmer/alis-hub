import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Job Board side-panel content for a completed abst-crosswalk job: what it covers, the headline counts,
 * the Excel downloads, and a link to the full report page (tables, print views). Resident PHI stays behind
 * the authenticated API (server/api/abstCrosswalk.js); only counts are shown here.
 */
const EXPORTS = [
  { key: 'assessment', label: 'Excel: assessment basis', hint: 'Survey-facing. All residents, Independent-living excluded', query: '?excludeIndependent=1&basis=assessment', suffix: '' },
  { key: 'care_plan', label: 'Excel: care plan basis', hint: 'Survey-facing. Same layout, care plan minutes', query: '?excludeIndependent=1&basis=care_plan', suffix: ' (care plan basis)' },
  { key: 'both', label: 'Excel: side by side (internal)', hint: 'Both bases with a difference column, for internal review', query: '?excludeIndependent=1&basis=both', suffix: ' (side by side, internal)' },
  { key: 'full', label: 'Excel: full detail (internal)', hint: 'Care item detail, setup gaps, unmapped items', query: '', suffix: null },
];

export default function AbstCrosswalkDrawerDetail({ job }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (job.status !== 'done') return;
    fetch(`/api/abst-crosswalk/${job.id}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [job.id, job.status]);

  async function download(ex) {
    setBusy(ex.key);
    try {
      const res = await fetch(`/api/abst-crosswalk/${job.id}/download${ex.query}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = ex.suffix === null ? data.filename : data.filename.replace(/\.xlsx$/i, ` - excl Independent${ex.suffix}.xlsx`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  if (job.status === 'failed') {
    return <p className="text-sm text-red-600">This run failed{job.error ? `: ${job.error}` : '.'} Run it again; the ALIS answers pull occasionally times out.</p>;
  }
  if (job.status !== 'done') {
    return <p className="text-sm text-neutral-400">The report and Excel exports will be available once the job completes.</p>;
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-400">Loading report…</p>;

  const total = data.meta.residentCount;
  const independent = data.residents.filter((r) => r.productType === 'Independent').length;
  // Counts cover the residents in the survey exports (Independent living has no evaluation, so it would only inflate "not assessed").
  const inScope = data.residents.filter((r) => r.productType !== 'Independent');
  const gaps = inScope.reduce((s, r) => s + (r.gaps || 0), 0);
  const notAssessed = inScope.reduce((s, r) => s + (r.notAssessed || 0), 0);

  return (
    <div className="space-y-5">
      <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
        <p className="font-semibold text-primary-900">{data.meta.communityName}</p>
        <p className="text-xs text-neutral-500 mt-1">
          RET "{data.meta.retName}" · generated {new Date(data.meta.generatedAt).toLocaleString('en-US')}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-3">
          <dt className="text-neutral-500">Current residents</dt><dd className="font-semibold text-primary-900">{total}</dd>
          <dt className="text-neutral-500">In the survey exports</dt><dd className="font-semibold text-primary-900">{inScope.length}</dd>
          <dt className="text-neutral-500">Independent living (not evaluated, excluded)</dt><dd className="font-semibold text-primary-900">{independent}</dd>
          <dt className="text-neutral-500">Elements per resident</dt><dd className="font-semibold text-primary-900">22</dd>
          <dt className="text-neutral-500">Element-rows: minutes not yet configured</dt><dd className="font-semibold text-primary-900">{gaps}</dd>
          <dt className="text-neutral-500">Element-rows: not assessed</dt><dd className="font-semibold text-primary-900">{notAssessed}</dd>
        </dl>
      </div>

      <div>
        <Link to={`/jobs/${job.id}`} className="btn btn-accent">📋 Open report: tables and print views →</Link>
        <p className="text-xs text-neutral-500 mt-2">
          Community summary, resident summary, per-resident pages (detail or clean), and PDF printing. Choose assessment basis, care plan basis, or side by side.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Downloads</p>
        <div className="space-y-2">
          {EXPORTS.map((ex) => (
            <div key={ex.key}>
              <button onClick={() => download(ex)} disabled={busy !== null} className="btn btn-secondary w-full justify-start disabled:opacity-50">
                {busy === ex.key ? '⏳ Downloading…' : `📥 ${ex.label}`}
              </button>
              <p className="text-[11px] text-neutral-400 mt-0.5 ml-1">{ex.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-neutral-400">Contains resident information. Reports stay inside the signed-in app.</p>
    </div>
  );
}
