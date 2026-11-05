import { useEffect, useState } from 'react';

/** Summary + download card for a completed resident-photos job (server/api/residentPhotos.js). */
export default function ResidentPhotosSummary({ jobId }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch(`/api/resident-photos/${jobId}`)
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
      const res = await fetch(`/api/resident-photos/${jobId}/download`);
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
  if (!summary) return <p className="text-sm text-neutral-400">Loading…</p>;

  const { counts, community } = summary;
  return (
    <div className="p-3 rounded border border-neutral-200 bg-white flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-primary-900">{community.communityName}</p>
        <p className="text-xs text-neutral-500 mt-1">
          {counts.saved} photos saved · {counts.noPhoto} residents with no photo · {counts.failed} failed · {counts.residents} current residents
        </p>
      </div>
      <button className="btn btn-primary shrink-0" onClick={download} disabled={downloading}>
        {downloading ? 'Preparing…' : 'Download .zip'}
      </button>
    </div>
  );
}
