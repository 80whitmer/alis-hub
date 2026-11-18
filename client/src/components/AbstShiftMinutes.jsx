import { useState } from 'react';

/**
 * Oregon ABST rule (D): estimated staff minutes per shift, per day. Pulled live from ALIS for the
 * job's community via the authenticated API (server/api/abstCrosswalk.js). Aggregates only, no
 * resident names. Estimated minutes for every scheduled ABST occurrence; recorded status ignored.
 */

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const nf = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

export default function AbstShiftMinutes({ jobId }) {
  const [start, setStart] = useState(isoDay(-7));
  const [end, setEnd] = useState(isoDay(-1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  const qs = `start=${start}&end=${end}`;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/abst-crosswalk/${jobId}/shift-minutes?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/abst-crosswalk/${jobId}/shift-minutes/download?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data?.meta.communityName || 'ABST'} - ABST minutes by shift (${start} to ${end}).xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const shifts = data?.meta.shifts || [];

  return (
    <div className="abst-no-print p-3 rounded border border-neutral-200 bg-white space-y-3">
      <div>
        <p className="font-semibold text-primary-900">Staffing minutes by shift, per day</p>
        <p className="text-xs text-neutral-500 mt-1">
          Oregon rule (D). Estimated minutes for every scheduled ABST task, summed by care date and shift. Whether staff documented the task is not counted.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label>
          <span className="block text-neutral-500 mb-1">From</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="border border-neutral-300 rounded px-2 py-1" />
        </label>
        <label>
          <span className="block text-neutral-500 mb-1">To</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="border border-neutral-300 rounded px-2 py-1" />
        </label>
        <button className="btn btn-accent disabled:opacity-50" disabled={loading || !start || !end} onClick={load}>
          {loading ? '⏳ Pulling from ALIS…' : 'Show minutes by shift'}
        </button>
        <button className="btn btn-secondary disabled:opacity-50" disabled={downloading || !start || !end} onClick={download}>
          {downloading ? '⏳ Downloading…' : '📥 Excel'}
        </button>
        <span className="text-neutral-400">Up to 92 days. Longer ranges take longer (about 5 seconds per week).</span>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {data && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr className="bg-primary-900 text-white text-xs">
                  <th className="text-left px-2 py-1">Date</th>
                  {shifts.map((s) => <th key={s} className="text-right px-2 py-1">{s}</th>)}
                  <th className="text-right px-2 py-1">Total (min)</th>
                  <th className="text-right px-2 py-1">Residents</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.date} className="border-b border-neutral-100">
                    <td className="px-2 py-1">{d.date} <span className="text-neutral-400">{d.weekday.slice(0, 3)}</span></td>
                    {d.shifts.map((c) => <td key={c.shift} className="text-right px-2 py-1 tabular-nums">{nf(c.minutes)}</td>)}
                    <td className="text-right px-2 py-1 font-semibold tabular-nums">{nf(d.totalMinutes)}</td>
                    <td className="text-right px-2 py-1 tabular-nums text-neutral-500">{d.residents}</td>
                  </tr>
                ))}
                <tr className="bg-neutral-50 font-semibold">
                  <td className="px-2 py-1">Average per day</td>
                  {data.totals.map((t) => <td key={t.shift} className="text-right px-2 py-1 tabular-nums">{nf(t.averagePerDay)}</td>)}
                  <td className="text-right px-2 py-1 tabular-nums">{nf(data.averageDailyMinutes)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-500">
            Shift hours are listed under the table in the Excel export. PRN tasks ({data.meta.prnTasks}) are listed separately and not in these totals.
            {data.meta.tasksWithoutMinutes > 0 && (
              <span className="text-amber-800"> {data.meta.tasksWithoutMinutes} scheduled task(s) have no estimated minutes and count as 0.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
