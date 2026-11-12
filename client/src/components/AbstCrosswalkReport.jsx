import { useEffect, useMemo, useState } from 'react';

/**
 * Oregon ABST crosswalk viewer for a completed abst-crosswalk job: community
 * summary, resident picker, and a one-resident page built to print / save as PDF.
 * Resident PHI — everything is fetched from the authenticated API
 * (server/api/abstCrosswalk.js) and nothing is cached or logged client-side.
 */

const STATUS_ORDER = ['staff_time', 'independent', 'nurse', 'outside', 'not_applicable', 'assessed_no_minutes', 'not_assessed'];
const STATUS_STYLE = {
  staff_time: 'bg-blue-100 text-blue-900',
  independent: 'bg-green-100 text-green-900',
  nurse: 'bg-purple-100 text-purple-900',
  outside: 'bg-teal-100 text-teal-900',
  not_applicable: 'bg-neutral-100 text-neutral-700',
  assessed_no_minutes: 'bg-amber-200 text-amber-900',
  not_assessed: 'bg-red-200 text-red-900',
};

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #abst-print-root, #abst-print-root * { visibility: visible !important; }
  #abst-print-root { position: absolute; left: 0; top: 0; width: 100%; }
  #abst-print-root thead { display: table-header-group; }
  #abst-print-root tr { page-break-inside: avoid; }
  .abst-no-print { display: none !important; }
  @page { size: letter landscape; margin: 0.4in; }
}`;

function StatusBadge({ status, label }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLE[status] || ''}`}>{label}</span>;
}

function HeaderBlock({ meta, resident }) {
  return (
    <div className="text-xs leading-snug">
      <p className="text-base font-bold text-primary-900">{meta.communityName} · Oregon ABST care element crosswalk</p>
      <p>Generated {new Date(meta.generatedAt).toLocaleString('en-US')} · Data as of: {meta.dataAsOf}</p>
      <p className="italic">{meta.headerLine}</p>
      {meta.footnote ? <p>{meta.footnote}</p> : null}
      {resident && (
        <p className="mt-2 text-sm">
          <b>{resident.name}</b> · Unit {resident.unit || '—'} · {resident.productType} · Latest completed evaluation:{' '}
          {resident.evaluation ? `${resident.evaluation.date}${resident.evaluation.reason ? ` (${resident.evaluation.reason})` : ''}` : 'none on file'} ·
          Care plan published: {resident.carePlanPublishDate || 'none'}
        </p>
      )}
    </div>
  );
}

function CareItemLine({ it }) {
  return (
    <li className="leading-snug">
      {it.name} <span className="text-neutral-500">[{it.category || '?'}]</span> · {it.schedule}
      · {it.minutesPerOccurrence ?? '—'} min{it.prn ? '/occurrence' : ''}
      {!it.prn && it.weeklyMinutes != null ? ` · ${it.countsAsCaregiver ? it.weeklyMinutes : 0} min/wk` : ''}
      {it.periodic ? ' · monthly, per occurrence only' : ''}
      {it.excludedReason ? <span className="text-purple-700"> · not caregiver time</span> : null}
    </li>
  );
}

function ResidentSheet({ meta, resident }) {
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr>
          <th colSpan={5} className="text-left font-normal pb-2 border-b border-neutral-300">
            <HeaderBlock meta={meta} resident={resident} />
          </th>
        </tr>
        <tr className="bg-neutral-100 text-left">
          <th className="p-1 border border-neutral-300 w-[17%]">Care element</th>
          <th className="p-1 border border-neutral-300 w-[27%]">Assessment answer</th>
          <th className="p-1 border border-neutral-300 w-[33%]">Care plan items (ABST)</th>
          <th className="p-1 border border-neutral-300 w-[6%]">Wkly min</th>
          <th className="p-1 border border-neutral-300 w-[17%]">Status</th>
        </tr>
      </thead>
      <tbody>
        {resident.elements.map((el) => (
          <tr key={el.id} className="align-top">
            <td className="p-1 border border-neutral-300 font-semibold">{el.id}. {el.name}</td>
            <td className="p-1 border border-neutral-300">
              {el.questions.filter((q) => q.answered).length === 0 ? (
                <span className="text-neutral-500">No answer on the latest completed evaluation</span>
              ) : (
                el.questions.filter((q) => q.answered).map((q) => (
                  <div key={q.domain + q.text} className="mb-1">
                    <span className="text-neutral-500">{q.text}: </span>
                    {q.answers.map((a) => a.answer).join(' + ')}
                  </div>
                ))
              )}
            </td>
            <td className="p-1 border border-neutral-300">
              {el.subTypes ? (
                <ul className="space-y-1">
                  {el.subTypes.map((s) => (
                    <li key={s.name}>
                      <b>{s.name}</b>: <StatusBadge status={s.status} label={s.statusLabel} />
                      {s.careItems.length > 0 && <ul className="list-disc list-inside ml-2">{s.careItems.map((it) => <CareItemLine key={it.carePlanItemId} it={it} />)}</ul>}
                    </li>
                  ))}
                </ul>
              ) : el.careItems.length ? (
                <ul className="list-disc list-inside">{el.careItems.map((it) => <CareItemLine key={it.carePlanItemId} it={it} />)}</ul>
              ) : (
                <span className="text-neutral-500">None on care plan</span>
              )}
              {el.notes.length > 0 && <p className="mt-1 text-amber-800">{el.notes.join(' ')}</p>}
            </td>
            <td className="p-1 border border-neutral-300 text-right">{el.weeklyMinutes}</td>
            <td className="p-1 border border-neutral-300"><StatusBadge status={el.status} label={el.statusLabel} /></td>
          </tr>
        ))}
        <tr className="font-bold bg-neutral-50">
          <td className="p-1 border border-neutral-300" colSpan={3}>Weekly caregiver minutes (Staff time items only; PRN not multiplied)</td>
          <td className="p-1 border border-neutral-300 text-right">{resident.weeklyCaregiverMinutes}</td>
          <td className="p-1 border border-neutral-300" />
        </tr>
      </tbody>
    </table>
  );
}

export default function AbstCrosswalkReport({ jobId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`/api/abst-crosswalk/${jobId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [jobId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetail(null);
    fetch(`/api/abst-crosswalk/${jobId}/resident/${selectedId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        setDetail(d);
      })
      .catch((e) => setError(e.message));
  }, [jobId, selectedId]);

  const residents = useMemo(
    () => (data ? data.residents.filter((r) => product === 'all' || r.productType === product) : []),
    [data, product]
  );
  const products = useMemo(() => (data ? [...new Set(data.residents.map((r) => r.productType))].sort() : []), [data]);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/abst-crosswalk/${jobId}/download`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-400">Loading report…</p>;

  const labels = data.meta.statusLabels;
  const noEval = data.residents.filter((r) => !r.evaluationDate).length;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-primary-900">{data.meta.communityName}</p>
          <p className="text-xs text-neutral-500 mt-1">
            {data.meta.residentCount} current residents × 22 elements · RET "{data.meta.retName}" · generated {new Date(data.meta.generatedAt).toLocaleString('en-US')}
          </p>
          {noEval > 0 && (
            <p className="text-xs text-amber-800 mt-1">
              {noEval} resident(s) have no completed evaluation (all 22 elements show "Not assessed"). Check the product-type filter.
            </p>
          )}
        </div>
        <button onClick={download} disabled={downloading} className="btn btn-accent shrink-0 disabled:opacity-50">
          {downloading ? '⏳ Downloading…' : '📥 Excel (all residents)'}
        </button>
      </div>

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white">
        <p className="font-semibold text-sm text-primary-900 mb-2">Community summary: residents by status, per element</p>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="p-1 border border-neutral-300">Element</th>
                {STATUS_ORDER.map((s) => <th key={s} className="p-1 border border-neutral-300">{labels[s]}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.summary.map((e) => (
                <tr key={e.id}>
                  <td className="p-1 border border-neutral-300">{e.id}. {e.name}</td>
                  {STATUS_ORDER.map((s) => (
                    <td key={s} className={`p-1 border border-neutral-300 text-center ${(s === 'assessed_no_minutes' || s === 'not_assessed') && e.counts[s] ? STATUS_STYLE[s] : ''}`}>{e.counts[s]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block text-neutral-500 mb-1">Product type</span>
          <select className="border border-neutral-300 rounded p-1 text-sm" value={product} onChange={(e) => { setProduct(e.target.value); setSelectedId(''); }}>
            <option value="all">All</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-xs grow min-w-[260px]">
          <span className="block text-neutral-500 mb-1">Resident ({residents.length})</span>
          <select className="border border-neutral-300 rounded p-1 text-sm w-full" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select a resident…</option>
            {residents.map((r) => (
              <option key={r.residentId} value={r.residentId}>
                {r.name} · {r.unit || '—'} · {r.productType}{r.evaluationDate ? '' : ' · no evaluation'}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary disabled:opacity-50" disabled={!detail} onClick={() => window.print()}>🖨️ Print / save as PDF</button>
      </div>

      {selectedId && !detail && <p className="abst-no-print text-sm text-neutral-400">Loading resident…</p>}
      {detail && (
        <div id="abst-print-root" className="p-3 rounded border border-neutral-200 bg-white">
          <ResidentSheet meta={detail.meta} resident={detail.resident} />
        </div>
      )}
    </div>
  );
}
