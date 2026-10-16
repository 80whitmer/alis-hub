import { useEffect, useState } from 'react';

/**
 * Summary + download card for a completed med-cart-report job — one .xlsx
 * per run (see server/api/medCartReport.js). Mirrors AcuityHistoryDownloads's
 * shape, but surfaces the flag counts inline since those are the thing worth
 * noticing before opening the workbook.
 */
export default function MedCartReportSummary({ jobId }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`/api/med-cart-report/${jobId}`)
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
      const res = await fetch(`/api/med-cart-report/${jobId}/download`);
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

  const { counts, community, period } = summary;
  const flagCount = counts.unmatchedFloorPlan + counts.missingCart + counts.missingFromFloorPlan;

  return (
    <div className="space-y-3">
      <div className="p-3 rounded border border-neutral-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-primary-900">{community.communityName}</p>
            <p className="text-xs text-neutral-500 mt-1">
              {period.startDate} to {period.endDate} · {counts.matchedResidents} of {counts.floorPlanResidents} floor-plan residents matched · {counts.cartsAssigned} with a cart assigned · {counts.ordersCovered} medication orders
            </p>
          </div>
          <button
            onClick={download}
            disabled={downloading}
            className="btn btn-accent shrink-0 disabled:opacity-50"
          >
            {downloading ? '⏳ Downloading…' : '📥 Excel'}
          </button>
        </div>
      </div>
      {flagCount > 0 && (
        <div className="p-3 rounded border border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">⚠️ {flagCount} item(s) flagged — see the Flagged tab in the workbook</p>
          <ul className="text-xs text-amber-800 mt-1 list-disc list-inside">
            {counts.unmatchedFloorPlan > 0 && <li>{counts.unmatchedFloorPlan} floor-plan resident(s) couldn't be matched to an ALIS resident</li>}
            {counts.missingCart > 0 && <li>{counts.missingCart} matched resident(s) have no Default Med Cart set on the floor plan</li>}
            {counts.missingFromFloorPlan > 0 && <li>{counts.missingFromFloorPlan} ALIS resident(s) in this community aren't on the floor plan file at all</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
