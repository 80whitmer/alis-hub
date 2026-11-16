import { Fragment, useEffect, useMemo, useState } from 'react';

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

const VIEWS = [
  { id: 'assessment', label: 'Assessment basis', hint: 'minutes set by the assessment answer' },
  { id: 'care_plan', label: 'Care plan basis', hint: "the care plan's own minutes and schedule" },
  { id: 'both', label: 'Side by side (internal)', hint: 'compare both; share one basis with surveyors' },
];
const VIEW_TITLE = { assessment: 'Assessment basis', care_plan: 'Care plan basis', both: 'Assessment and care plan, side by side' };

/** The resident as one minutes basis (assessment is the base data; care_plan swaps in the care plan's own rows). */
function projectResident(resident, basis) {
  if (basis !== 'care_plan' || !resident.carePlanView) return resident;
  const cp = resident.carePlanView;
  return {
    ...resident,
    elements: resident.elements.map((e) => {
      const c = cp.elements.find((x) => x.id === e.id);
      return { ...e, status: c.status, statusLabel: c.statusLabel, careRows: c.careRows, weeklyMinutes: c.weeklyMinutes, notes: c.notes };
    }),
    weeklyCaregiverMinutes: cp.weeklyCaregiverMinutes,
    averageDailyMinutes: cp.averageDailyMinutes,
    totalCareItems: cp.totalCareItems,
    prnItems: cp.prnItems,
  };
}

function HeaderBlock({ meta, resident, view }) {
  return (
    <div className="text-xs leading-snug">
      <p className="text-base font-bold text-primary-900">{meta.communityName} · Oregon ABST care element crosswalk{view ? ` · ${VIEW_TITLE[view]}` : ''}</p>
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

function minutesCell(cr) {
  if (cr.source === 'care_plan_only') return '—';
  if (cr.prn) return cr.minutesPerOccurrence != null ? `PRN · ${cr.minutesPerOccurrence}/occ.` : 'PRN';
  return cr.minutesPerOccurrence == null ? 'Not yet configured' : cr.minutesPerOccurrence;
}

function AnswerCell({ el }) {
  const answered = el.questions.filter((q) => q.answered);
  if (answered.length === 0) return <span className="text-neutral-500">No answer on the latest completed evaluation</span>;
  return answered.map((q) => (
    <div key={q.domain + q.text} className="mb-1">
      <span className="text-neutral-500">{q.answers[0]?.question || q.text}: </span>
      {q.answers.map((a) => a.answer).join(' + ')}
    </div>
  ));
}

function rowLine(cr) {
  const mins = cr.source === 'care_plan_only' ? 'not counted' : cr.prn ? (cr.minutesPerOccurrence != null ? `PRN ${cr.minutesPerOccurrence}/occ.` : 'PRN') : cr.minutesPerOccurrence == null ? 'not yet configured' : `${cr.minutesPerOccurrence} min`;
  const wk = !cr.prn && cr.weeklyMinutes != null && cr.source !== 'care_plan_only' && cr.minutesPerOccurrence != null ? ` · ${cr.weeklyMinutes}/wk` : '';
  return `${cr.name} · ${cr.schedule} · ${mins}${wk}`;
}

const sumNote = {
  assessment: 'Minutes are set by the assessment answer (care item minutes in Care Settings).',
  care_plan: "Minutes are the care plan's own minutes x schedule.",
};

function SingleSheet({ meta, resident, view, pageBreak }) {
  const r = projectResident(resident, view);
  return (
    <table className="w-full text-xs border-collapse" style={pageBreak ? { pageBreakAfter: 'always' } : undefined}>
      <thead>
        <tr>
          <th colSpan={7} className="text-left font-normal pb-2 border-b border-neutral-300">
            <HeaderBlock meta={meta} resident={r} view={view} />
          </th>
        </tr>
        <tr className="bg-neutral-100 text-left">
          <th className="p-1 border border-neutral-300 w-[14%]">Care element</th>
          <th className="p-1 border border-neutral-300 w-[26%]">Assessment answer</th>
          <th className="p-1 border border-neutral-300 w-[22%]">Care item</th>
          <th className="p-1 border border-neutral-300 w-[11%]">Schedule</th>
          <th className="p-1 border border-neutral-300 w-[9%]">Mins / scheduled day</th>
          <th className="p-1 border border-neutral-300 w-[6%]">Wkly mins</th>
          <th className="p-1 border border-neutral-300 w-[12%]">Status</th>
        </tr>
      </thead>
      <tbody>
        {r.elements.map((el) =>
          el.careRows.map((cr, i) => (
            <tr key={`${el.id}-${i}`} className="align-top">
              {i === 0 && (
                <>
                  <td rowSpan={el.careRows.length} className="p-1 border border-neutral-300 font-semibold">{el.id}. {el.name}</td>
                  <td rowSpan={el.careRows.length} className="p-1 border border-neutral-300"><AnswerCell el={el} /></td>
                </>
              )}
              <td className="p-1 border border-neutral-300">{cr.name}</td>
              <td className="p-1 border border-neutral-300">{cr.schedule}</td>
              <td className="p-1 border border-neutral-300 text-right">{minutesCell(cr)}</td>
              <td className="p-1 border border-neutral-300 text-right">{cr.prn || cr.weeklyMinutes == null ? '' : cr.weeklyMinutes}</td>
              {i === 0 && (
                <td rowSpan={el.careRows.length} className="p-1 border border-neutral-300"><StatusBadge status={el.status} label={el.statusLabel} /></td>
              )}
            </tr>
          ))
        )}
        <tr className="font-bold bg-neutral-50">
          <td className="p-1 border border-neutral-300" colSpan={5}>
            {sumNote[view]} Total care items: {r.totalCareItems} · Average daily minutes: {r.averageDailyMinutes} ({Math.round((r.averageDailyMinutes / 60) * 100) / 100} hrs) · PRN items: {r.prnItems} (per occurrence, not in totals)
          </td>
          <td className="p-1 border border-neutral-300 text-right">{r.weeklyCaregiverMinutes}</td>
          <td className="p-1 border border-neutral-300 font-normal">Weekly caregiver minutes</td>
        </tr>
      </tbody>
    </table>
  );
}

function SideBySideSheet({ meta, resident, pageBreak }) {
  const cp = resident.carePlanView;
  const diff = Math.round((resident.weeklyCaregiverMinutes - cp.weeklyCaregiverMinutes) * 10) / 10;
  return (
    <table className="w-full text-xs border-collapse" style={pageBreak ? { pageBreakAfter: 'always' } : undefined}>
      <thead>
        <tr>
          <th colSpan={6} className="text-left font-normal pb-2 border-b border-neutral-300">
            <HeaderBlock meta={meta} resident={resident} view="both" />
          </th>
        </tr>
        <tr className="bg-neutral-100 text-left">
          <th className="p-1 border border-neutral-300 w-[12%]">Care element</th>
          <th className="p-1 border border-neutral-300 w-[20%]">Assessment answer</th>
          <th className="p-1 border border-neutral-300 w-[26%]">Assessment basis</th>
          <th className="p-1 border border-neutral-300 w-[26%]">Care plan basis</th>
          <th className="p-1 border border-neutral-300 w-[8%]">Status: assessment</th>
          <th className="p-1 border border-neutral-300 w-[8%]">Status: care plan</th>
        </tr>
      </thead>
      <tbody>
        {resident.elements.map((el) => {
          const c = cp.elements.find((x) => x.id === el.id);
          const differs = el.status !== c.status || el.weeklyMinutes !== c.weeklyMinutes;
          return (
            <tr key={el.id} className={`align-top ${differs ? 'bg-amber-50' : ''}`}>
              <td className="p-1 border border-neutral-300 font-semibold">{el.id}. {el.name}</td>
              <td className="p-1 border border-neutral-300"><AnswerCell el={el} /></td>
              <td className="p-1 border border-neutral-300">
                {el.careRows.map((cr, i) => <div key={i} className="mb-0.5">{rowLine(cr)}</div>)}
                <div className="font-semibold mt-1">{el.weeklyMinutes} min/wk</div>
              </td>
              <td className="p-1 border border-neutral-300">
                {c.careRows.map((cr, i) => <div key={i} className="mb-0.5">{rowLine(cr)}</div>)}
                <div className="font-semibold mt-1">{c.weeklyMinutes} min/wk</div>
              </td>
              <td className="p-1 border border-neutral-300"><StatusBadge status={el.status} label={el.statusLabel} /></td>
              <td className="p-1 border border-neutral-300"><StatusBadge status={c.status} label={c.statusLabel} /></td>
            </tr>
          );
        })}
        <tr className="font-bold bg-neutral-50">
          <td className="p-1 border border-neutral-300" colSpan={2}>Weekly caregiver minutes (shaded rows differ)</td>
          <td className="p-1 border border-neutral-300">Assessment: {resident.weeklyCaregiverMinutes} ({resident.averageDailyMinutes}/day)</td>
          <td className="p-1 border border-neutral-300">Care plan: {cp.weeklyCaregiverMinutes} ({cp.averageDailyMinutes}/day)</td>
          <td className="p-1 border border-neutral-300 font-normal" colSpan={2}>Difference: {diff > 0 ? '+' : ''}{diff} min/wk</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Minutes cells for the vertical summary: numbers for counted minutes, 0 for 0-minute statuses, a dash where nothing is counted. */
function verticalMinutes(el) {
  if (el.status === 'staff_time') return el.weeklyMinutes > 0 ? { daily: Math.round((el.weeklyMinutes / 7) * 10) / 10, weekly: el.weeklyMinutes } : { daily: 'PRN', weekly: '—' };
  if (el.status === 'assessed_no_minutes' || el.status === 'not_assessed') return { daily: '—', weekly: '—' };
  return { daily: 0, weekly: 0 };
}

/** One resident, 22 elements down the page, numbers only (the vertical counterpart of the resident summary row). */
function VerticalSheet({ meta, resident, view, pageBreak }) {
  const both = view === 'both';
  const bases = both ? ['assessment', 'care_plan'] : [view];
  const projected = bases.map((b) => projectResident(resident, b));
  const colSpan = 2 + bases.length * 3;
  return (
    <table className="w-full text-xs border-collapse" style={pageBreak ? { pageBreakAfter: 'always' } : undefined}>
      <thead>
        <tr>
          <th colSpan={colSpan} className="text-left font-normal pb-2 border-b border-neutral-300">
            <HeaderBlock meta={meta} resident={resident} view={view} />
          </th>
        </tr>
        <tr className="bg-neutral-100 text-left">
          <th className="p-1 border border-neutral-300 w-[4%]">#</th>
          <th className="p-1 border border-neutral-300">Care element</th>
          {bases.map((b) => (
            <Fragment key={b}>
              <th className="p-1 border border-neutral-300">{both ? `Status (${b === 'assessment' ? 'assessment' : 'care plan'})` : 'Status'}</th>
              <th className="p-1 border border-neutral-300 text-center">Avg daily min</th>
              <th className="p-1 border border-neutral-300 text-center">Weekly min</th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {projected[0].elements.map((el, i) => (
          <tr key={el.id}>
            <td className="p-1 border border-neutral-300">{el.id}</td>
            <td className="p-1 border border-neutral-300 font-semibold">{el.name}</td>
            {projected.map((p, k) => {
              const e = p.elements[i];
              const m = verticalMinutes(e);
              return (
                <Fragment key={k}>
                  <td className={`p-1 border border-neutral-300 ${STATUS_STYLE[e.status] || ''}`}>{e.statusLabel}</td>
                  <td className="p-1 border border-neutral-300 text-center">{m.daily}</td>
                  <td className="p-1 border border-neutral-300 text-center">{m.weekly}</td>
                </Fragment>
              );
            })}
          </tr>
        ))}
        <tr className="font-bold bg-neutral-50">
          <td className="p-1 border border-neutral-300" colSpan={2}>Total caregiver minutes</td>
          {projected.map((p, k) => (
            <Fragment key={k}>
              <td className="p-1 border border-neutral-300 font-normal">{both ? (k === 0 ? 'Assessment basis' : 'Care plan basis') : ''}</td>
              <td className="p-1 border border-neutral-300 text-center">{p.averageDailyMinutes}</td>
              <td className="p-1 border border-neutral-300 text-center">{p.weeklyCaregiverMinutes}</td>
            </Fragment>
          ))}
        </tr>
        <tr>
          <td className="p-1 text-[11px] text-neutral-600" colSpan={colSpan}>
            Average daily minutes = weekly / 7. PRN-only elements show PRN and are not in totals. Assistance assessed with no minutes set up shows a dash and is flagged in Status.
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function ResidentSheet({ meta, resident, view, pageBreak, format }) {
  if (format === 'summary') return <VerticalSheet meta={meta} resident={resident} view={view} pageBreak={pageBreak} />;
  return view === 'both'
    ? <SideBySideSheet meta={meta} resident={resident} pageBreak={pageBreak} />
    : <SingleSheet meta={meta} resident={resident} view={view} pageBreak={pageBreak} />;
}

const ROLLUP_CODE = { independent: 'IND', outside: 'OUT', nurse: 'RN', not_applicable: 'N/A', assessed_no_minutes: 'TBD', not_assessed: '—' };
const ROLLUP_LEGEND = 'Number = average daily minutes (weekly / 7) for staff time · PRN = PRN only, not in totals · IND = independent · OUT = outside provider · RN = nurse task · N/A = does not apply · TBD = assistance assessed, minutes not yet configured · — = not assessed';

function rollupCell(el) {
  if (el.status === 'staff_time') return el.weeklyMinutes > 0 ? Math.round((el.weeklyMinutes / 7) * 10) / 10 : 'PRN';
  return ROLLUP_CODE[el.status];
}

/** Numbers-only resident summary: the per-resident counterpart of the community roll-up. */
function ResidentRollupTable({ meta, roster, basis, product }) {
  const key = basis === 'care_plan' ? 'carePlan' : 'assessment';
  const rows = roster.residents.filter((r) => product === 'all' || r.productType === product);
  return (
    <div className="mb-4">
      <p className="font-semibold text-sm text-primary-900 mb-2">
        Resident summary: average daily minutes by element ({basis === 'care_plan' ? 'care plan basis' : 'assessment basis'})
      </p>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse w-full">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="p-1 border border-neutral-300">Resident</th>
              <th className="p-1 border border-neutral-300">Unit</th>
              <th className="p-1 border border-neutral-300">Type</th>
              {roster.elements.map((e) => <th key={e.id} className="p-1 border border-neutral-300 text-center" title={e.name}>{e.id}</th>)}
              <th className="p-1 border border-neutral-300 text-center">Avg daily min</th>
              <th className="p-1 border border-neutral-300 text-center">Weekly min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.residentId}>
                <td className="p-1 border border-neutral-300 whitespace-nowrap">{r.name}</td>
                <td className="p-1 border border-neutral-300">{r.unit || '—'}</td>
                <td className="p-1 border border-neutral-300">{r.productType}</td>
                {r[key].elements.map((e) => (
                  <td key={e.id} className={`p-1 border border-neutral-300 text-center ${STATUS_STYLE[e.status] || ''}`}>{rollupCell(e)}</td>
                ))}
                <td className="p-1 border border-neutral-300 text-center font-bold">{r[key].averageDailyMinutes}</td>
                <td className="p-1 border border-neutral-300 text-center font-bold">{r[key].weeklyCaregiverMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-neutral-600 leading-snug">
        <p className="mb-1">{ROLLUP_LEGEND}</p>
        <p>{roster.elements.map((e) => `${e.id} ${e.name}`).join(' · ')}</p>
      </div>
      <p className="mt-1 text-[11px] text-neutral-500 italic">{meta.headerLine}</p>
    </div>
  );
}

function SummaryTable({ title, rows, labels }) {
  return (
    <div className="mb-3">
      <p className="font-semibold text-sm text-primary-900 mb-2">{title}</p>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="p-1 border border-neutral-300">Element</th>
              {STATUS_ORDER.map((s) => <th key={s} className="p-1 border border-neutral-300">{labels[s]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
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
  );
}

export default function AbstCrosswalkReport({ jobId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [allSheets, setAllSheets] = useState(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [view, setView] = useState('assessment');
  const [roster, setRoster] = useState(null);
  const [rosterPrint, setRosterPrint] = useState(false);
  const [format, setFormat] = useState('detail');

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
    fetch(`/api/abst-crosswalk/${jobId}/roster?excludeIndependent=1`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        setRoster(d);
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

  async function printAll() {
    setLoadingAll(true);
    try {
      const res = await fetch(`/api/abst-crosswalk/${jobId}/residents?excludeIndependent=1`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Failed to load (${res.status})`);
      setSelectedId('');
      setRosterPrint(false);
      setAllSheets(d);
      setTimeout(() => window.print(), 400);
    } catch (e) {
      alert(`Could not load residents: ${e.message}`);
    } finally {
      setLoadingAll(false);
    }
  }

  async function download(excludeIndependent = false) {
    setDownloading(true);
    try {
      const res = await fetch(`/api/abst-crosswalk/${jobId}/download${excludeIndependent ? `?excludeIndependent=1&basis=${view}` : ''}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      const sfx = { assessment: '', care_plan: ' (care plan basis)', both: ' (side by side, internal)' }[view];
      a.download = excludeIndependent ? data.filename.replace(/\.xlsx$/i, ` - excl Independent${sfx}.xlsx`) : data.filename;
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

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white flex flex-wrap items-start justify-between gap-3">
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
        <div className="flex flex-col gap-2 shrink-0">
          <button onClick={() => download(true)} disabled={downloading} className="btn btn-accent disabled:opacity-50">
            {downloading ? '⏳ Downloading…' : `📥 Excel: all residents (excl. Independent) · ${{ assessment: 'assessment', care_plan: 'care plan', both: 'side by side' }[view]}`}
          </button>
          <button onClick={() => download(false)} disabled={downloading} className="btn btn-secondary disabled:opacity-50">
            📥 Excel: full detail (internal)
          </button>
        </div>
      </div>

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white">
        <p className="font-semibold text-sm text-primary-900 mb-2">Minutes basis</p>
        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1 rounded border text-xs ${view === v.id ? 'bg-primary-900 text-white border-primary-900' : 'bg-white text-neutral-700 border-neutral-300'}`}
              title={v.hint}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          {VIEWS.find((v) => v.id === view).hint}. The page, print, and Excel export all follow this choice.
          {view === 'both' ? ' Side by side is for internal review of discrepancies.' : ''}
        </p>
      </div>

      <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white">
        {view !== 'care_plan' && <SummaryTable title={`Community summary${view === 'both' ? ' (assessment basis)' : ''}: residents by status, per element`} rows={data.summary} labels={labels} />}
        {view !== 'assessment' && <SummaryTable title={`Community summary${view === 'both' ? ' (care plan basis)' : ''}: residents by status, per element`} rows={data.summaryCarePlan || data.summary} labels={labels} />}
      </div>

      {roster && (
        <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-xs text-neutral-500">Independent-living residents are not included. Follows the minutes basis above.</p>
            <button className="btn btn-secondary" onClick={() => { setAllSheets(null); setSelectedId(''); setRosterPrint(true); setTimeout(() => window.print(), 400); }}>
              🖨️ Print / save as PDF
            </button>
          </div>
          {view !== 'care_plan' && <ResidentRollupTable meta={roster.meta} roster={roster} basis="assessment" product={product} />}
          {view !== 'assessment' && <ResidentRollupTable meta={roster.meta} roster={roster} basis="care_plan" product={product} />}
        </div>
      )}

      {rosterPrint && roster && (
        <div id="abst-print-root" className="p-3 rounded border border-neutral-200 bg-white">
          <p className="abst-no-print text-xs text-neutral-500 mb-2">
            <button className="underline" onClick={() => window.print()}>Print again</button> ·{' '}
            <button className="underline" onClick={() => setRosterPrint(false)}>Close</button>
          </p>
          <HeaderBlock meta={roster.meta} view={view} />
          <div className="mt-2">
            {view !== 'care_plan' && <ResidentRollupTable meta={roster.meta} roster={roster} basis="assessment" product={product} />}
            {view !== 'assessment' && <ResidentRollupTable meta={roster.meta} roster={roster} basis="care_plan" product={product} />}
          </div>
        </div>
      )}

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
          <select className="border border-neutral-300 rounded p-1 text-sm w-full" value={selectedId} onChange={(e) => { setAllSheets(null); setRosterPrint(false); setSelectedId(e.target.value); }}>
            <option value="">Select a resident…</option>
            {residents.map((r) => (
              <option key={r.residentId} value={r.residentId}>
                {r.name} · {r.unit || '—'} · {r.productType}{r.evaluationDate ? '' : ' · no evaluation'}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs">
          <span className="block text-neutral-500 mb-1">Resident page format</span>
          <div className="flex gap-2">
            {[{ id: 'detail', label: 'Detail (audit)' }, { id: 'summary', label: 'Summary (clean)' }].map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`px-3 py-1 rounded border text-xs ${format === f.id ? 'bg-primary-900 text-white border-primary-900' : 'bg-white text-neutral-700 border-neutral-300'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-secondary disabled:opacity-50" disabled={!detail} onClick={() => window.print()}>🖨️ Print / save as PDF</button>
        <button className="btn btn-secondary disabled:opacity-50" disabled={loadingAll} onClick={printAll}>
          {loadingAll ? '⏳ Loading…' : '🖨️ Print all residents (excl. Independent)'}
        </button>
      </div>

      {allSheets && !rosterPrint && (
        <div id="abst-print-root" className="p-3 rounded border border-neutral-200 bg-white space-y-6">
          <p className="abst-no-print text-xs text-neutral-500">
            {allSheets.residents.length} resident pages (Independent-living residents excluded). Use Print to save as PDF.{' '}
            <button className="underline" onClick={() => window.print()}>Print again</button> ·{' '}
            <button className="underline" onClick={() => setAllSheets(null)}>Close</button>
          </p>
          {allSheets.residents.map((r) => <ResidentSheet key={r.residentId} meta={allSheets.meta} resident={r} view={view} format={format} pageBreak />)}
        </div>
      )}

      {selectedId && !detail && <p className="abst-no-print text-sm text-neutral-400">Loading resident…</p>}
      {detail && !allSheets && !rosterPrint && (
        <div id="abst-print-root" className="p-3 rounded border border-neutral-200 bg-white">
          <ResidentSheet meta={detail.meta} resident={detail.resident} view={view} format={format} />
        </div>
      )}
    </div>
  );
}
