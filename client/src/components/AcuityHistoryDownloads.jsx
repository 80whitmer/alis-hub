import { useEffect, useState } from 'react';

const usd = (n) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Download list for a completed resident-acuity-history job — one .xlsx per
 * community (see server/api/acuityHistory.js). Shared by the Jobs drawer and
 * the full job page.
 */
export default function AcuityHistoryDownloads({ jobId }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    fetch(`/api/acuity-history/${jobId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Failed to load (${r.status})`);
        setSummary(data);
      })
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function download(index, filename) {
    setDownloading(index);
    try {
      const res = await fetch(`/api/acuity-history/${jobId}/download/${index}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!summary) return <p className="text-sm text-neutral-400">Loading reports…</p>;

  return (
    <div className="space-y-3">
      {summary.files.map((f, i) => (
        <div key={i} className="p-3 rounded border border-neutral-200 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-primary-900">{f.communityName}</p>
              {f.error ? (
                <p className="text-xs text-red-600 mt-1">{f.error}</p>
              ) : (
                <>
                  <p className="text-xs text-neutral-500 mt-1">
                    {f.latestResidents} residents in {f.latestMonth} · {usd(f.latestTotalFees)} monthly care level fees
                    {f.firstEvaluationDate ? ` · acuity history from ${f.firstEvaluationDate}` : ' · no evaluations found'}
                  </p>
                  {f.hasBilling ? (
                    <p className="text-xs text-neutral-500 mt-1">
                      Billing in ALIS: {usd(f.latestInvoicedCare)} invoiced care · variance {usd(f.latestVariance)} across {f.latestResidentsWithVariance} resident(s)
                      {f.careItemsCounted?.length ? ` · care items: ${f.careItemsCounted.join(', ')}` : ' · ⚠️ no billing items matched as care — check the Billing Items tab'}
                    </p>
                  ) : f.hasBilling === false ? (
                    <p className="text-xs text-neutral-400 mt-1">No ALIS invoice data — care fee variance not included.</p>
                  ) : null}
                </>
              )}
            </div>
            {!f.error && (
              <button
                onClick={() => download(i, f.filename)}
                disabled={downloading === i}
                className="btn btn-accent shrink-0 disabled:opacity-50"
              >
                {downloading === i ? '⏳ Downloading…' : '📥 Excel'}
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="text-xs text-neutral-400">
        Care level fees are the ALIS benchmark, not invoiced amounts. Where the account bills in ALIS, invoiced care is matched by billing item name (no care tag exists) — see each workbook's Billing Items and Methodology Notes tabs.
      </p>
    </div>
  );
}
