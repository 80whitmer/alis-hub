import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const EXAMPLE = JSON.stringify({
  companyUrl:  'https://admin.alisonline.com/Customers/Companies/770',
  communities: [
    {
      name:               'Example Community',
      crm_id:             '12345678901',
      licensed_capacity:  '60',
      physical_capacity:  '60',
      street:             '123 Main St',
      city:               'Atlanta',
      state:              'GA',
      zip:                '30301',
      flags:              [],
    },
  ],
}, null, 2);

export default function NewJob() {
  const navigate = useNavigate();

  const [label,   setLabel]   = useState('');
  const [raw,     setRaw]     = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  // Parse JSON on the fly for preview
  function handleRawChange(val) {
    setRaw(val);
    setError('');
    setPreview(null);
    if (!val.trim()) return;
    try {
      const parsed = JSON.parse(val);
      if (parsed.communities) setPreview(parsed);
    } catch { /* wait for valid JSON */ }
  }

  // File upload — reads JSON file into textarea
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleRawChange(ev.target.result);
    reader.readAsText(file);
  }

  async function handleSubmit() {
    setError('');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError('Invalid JSON — check your input.');
      return;
    }

    if (!parsed.companyUrl) {
      setError('Missing companyUrl in JSON.');
      return;
    }
    if (!Array.isArray(parsed.communities) || parsed.communities.length === 0) {
      setError('communities array is missing or empty.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/jobs/create-communities', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          label:       label || `Create ${parsed.communities.length} communities`,
          companyUrl:  parsed.companyUrl,
          communities: parsed.communities,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      navigate(`/jobs/${data.id}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-display text-sm text-muted uppercase tracking-widest mb-6">
        New Job — Create Communities
      </h1>

      {/* Job label */}
      <div className="mb-5">
        <label className="block font-display text-xs text-muted mb-2 uppercase tracking-wider">
          Job Label <span className="text-muted">(optional)</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. William James Group — 16 communities"
          className="w-full bg-panel border border-border rounded px-4 py-2.5 font-body text-sm text-white placeholder-muted focus:outline-none focus:border-blue transition-colors"
        />
      </div>

      {/* File upload */}
      <div className="mb-4 flex items-center gap-4">
        <label className="font-display text-xs text-muted uppercase tracking-wider">
          Load from file
        </label>
        <label className="cursor-pointer bg-panel border border-border rounded px-3 py-1.5 font-display text-xs text-blue hover:border-blue transition-colors">
          Browse JSON
          <input type="file" accept=".json" onChange={handleFile} className="hidden" />
        </label>
      </div>

      {/* JSON textarea */}
      <div className="mb-2">
        <label className="block font-display text-xs text-muted mb-2 uppercase tracking-wider">
          communities.json payload
        </label>
        <textarea
          value={raw}
          onChange={e => handleRawChange(e.target.value)}
          placeholder={EXAMPLE}
          rows={16}
          className="w-full bg-panel border border-border rounded px-4 py-3 font-display text-xs text-white placeholder-muted focus:outline-none focus:border-blue transition-colors resize-y"
          spellCheck={false}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-danger font-display text-xs border border-danger/30 bg-danger/10 rounded px-4 py-2">
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="mb-5 bg-panel border border-border rounded-lg p-4">
          <div className="font-display text-xs text-muted uppercase tracking-wider mb-3">
            Preview — {preview.communities.length} communities
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {preview.communities.map((c, i) => (
              <div key={i} className="flex items-center gap-3 font-display text-xs">
                <span className="text-muted w-5 text-right flex-shrink-0">{i + 1}</span>
                <span className="text-white flex-1 truncate">{c.name}</span>
                <span className="text-muted flex-shrink-0">{c.city}, {c.state}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border font-display text-xs text-muted">
            Company URL: <span className="text-blue">{preview.companyUrl}</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || !raw.trim()}
        className="bg-accent text-ink font-display text-sm font-medium px-6 py-3 rounded hover:bg-green-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Starting...' : 'Run Job →'}
      </button>
    </div>
  );
}
