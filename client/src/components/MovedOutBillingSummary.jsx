import { useEffect, useState } from 'react';

/**
 * Summary + download card for a completed moved-out-billing job — one .xlsx
 * per run (see server/api/movedOutBilling.js). Same shape as
 * MedCartReportSummary; surfaces the priority counts inline since those are
 * what's worth noticing before opening the workbook.
 */
export default function MovedOutBillingSummary({ jobId }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`/api/moved-out-billing/${jobId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Failed to load (${r.status})`);
        setSummary(data);
      })
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/moved-out-billing/${jobId}/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = summary.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!summary) return <p className="text-sm text-neutral-400">Loading report…</p>;

  const { counts, communities, companyName, communityFilter } = summary;
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="space-y-3">
      <div className="p-3 rounded border border-neutral-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-primary-900">
              {companyName}{communityFilter ? ` — ${communityFilter}` : ''}
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              {counts.flagged} of {counts.movedOutResidentsWithCharges} moved-out residents flagged · {money(counts.openBalance)} in open invoices
            </p>
          </div>
          <button onClick={download} disabled={downloading} className="btn btn-accent shrink-0 disabled:opacity-50">
            {downloading ? '⏳ Downloading…' : '📥 Excel'}
          </button>
        </div>
      </div>

      <div className={`p-3 rounded border ${counts.high > 0 ? 'border-red-200 bg-red-50' : 'border-neutral-200 bg-neutral-50'}`}>
        <ul className="text-xs text-neutral-700 list-disc list-inside">
          <li><strong>{counts.high}</strong> still have a live recurring charge (open-ended or past move-out)</li>
          <li><strong>{counts.medium}</strong> have an open invoice balance only</li>
          <li><strong>{counts.low}</strong> had a charge that ran past the move-out date</li>
        </ul>
      </div>

      {communities.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-500 border-b border-neutral-200">
              <th className="py-1 pr-2">Community</th>
              <th className="py-1 px-2 text-right">High</th>
              <th className="py-1 px-2 text-right">Medium</th>
              <th className="py-1 px-2 text-right">Low</th>
              <th className="py-1 pl-2 text-right">Open invoices</th>
            </tr>
          </thead>
          <tbody>
            {communities.map((c) => (
              <tr key={c.community} className="border-b border-neutral-100">
                <td className="py-1 pr-2">{c.community}</td>
                <td className="py-1 px-2 text-right">{c.high}</td>
                <td className="py-1 px-2 text-right">{c.medium}</td>
                <td className="py-1 px-2 text-right">{c.low}</td>
                <td className="py-1 pl-2 text-right">{money(c.openBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-neutral-500">
        Proxy report: ALIS's "billing enabled" banner isn't in the export API, so residents with the banner but no live charges or open invoices won't appear. See the Methodology Notes tab.
      </p>
    </div>
  );
}
