import { useState, useCallback, useRef } from 'react';

/**
 * Live resident-evaluation lookup — not a job (no batch pull, no snapshot),
 * a direct on-demand tool: type a host + resident name, get that
 * resident's current evaluation (CarePoints, Care Level) plus a
 * question/answer breakdown where the underlying config version is cached
 * (see server/services/evaluationScoring.js — most evaluations answered
 * against a since-superseded ALIS config aren't scoreable at the question
 * level yet; the summary fields above always work regardless).
 */
export default function EvaluationDetail() {
  const [host, setHost] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  const runSearch = useCallback((h, q) => {
    if (!h || !q || q.length < 2) { setSuggestions([]); return; }
    setSearching(true);
    fetch(`/api/evaluations/search-residents?host=${encodeURIComponent(h)}&q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((data) => setSuggestions(data.residents || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSearching(false));
  }, []);

  function handleQueryChange(value) {
    setQuery(value);
    setSelected(null);
    setDetail(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(host, value), 350);
  }

  function handleSelectResident(resident) {
    setSelected(resident);
    setSuggestions([]);
    setQuery(resident.name);
    setDetail(null);
    setError('');
    setLoading(true);
    fetch(`/api/evaluations/${encodeURIComponent(host)}/${resident.residentId}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || `Server error (${r.status})`); });
        return r.json();
      })
      .then((data) => setDetail(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-primary-900 mb-2">Resident Evaluation Detail</h1>
      <p className="text-neutral-600 mb-8">
        Look up a resident's current evaluation — CarePoints, Care Level, and (where available) the underlying question/answer breakdown.
      </p>

      <div className="card mb-6">
        <label className="input-label">ALIS Company Host (subdomain)</label>
        <input
          type="text"
          className="input mb-4"
          placeholder="imagineseniorliving"
          value={host}
          onChange={(e) => { setHost(e.target.value); setSuggestions([]); setSelected(null); setDetail(null); }}
        />

        <label className="input-label">Resident Name</label>
        <div className="relative">
          <input
            type="text"
            className="input"
            placeholder="Start typing a resident's name..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            disabled={!host}
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-10 w-full bg-white border border-neutral-200 rounded-lg mt-1 shadow-lg max-h-64 overflow-y-auto">
              {suggestions.map((r) => (
                <li key={r.residentId}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-neutral-50 text-sm"
                    onClick={() => handleSelectResident(r)}
                  >
                    {r.name} <span className="text-neutral-400">— community {r.communityId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {searching && <p className="text-xs text-neutral-400 mt-1">Searching...</p>}
        {!host && <p className="text-xs text-neutral-400 mt-1">Enter a host first.</p>}
      </div>

      {error && (
        <div className="alert alert-error mb-6"><span>⚠️</span><p>{error}</p></div>
      )}

      {loading && <p className="text-neutral-500">Loading evaluation...</p>}

      {detail && (
        <div className="card">
          <h2 className="text-xl font-semibold text-primary-900 mb-1">{detail.residentName}</h2>
          <p className="text-sm text-neutral-500 mb-4">{detail.communityName} · {detail.reason} · {detail.evaluationDate ? new Date(detail.evaluationDate).toLocaleDateString() : '—'}</p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">CarePoints</div>
              <div className="text-2xl font-bold text-primary-900">{detail.carePoints ?? '—'}</div>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">Care Level</div>
              <div className="text-2xl font-bold text-primary-900">{detail.careLevel ?? '—'}</div>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">Fee</div>
              <div className="text-2xl font-bold text-primary-900">{detail.fee != null ? `$${detail.fee}` : '—'}</div>
            </div>
          </div>

          {detail.breakdownNote && (
            <p className="text-sm text-neutral-500 italic mb-4">{detail.breakdownNote}</p>
          )}

          {detail.questionBreakdown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
                    <th className="py-2 pr-4">Question</th>
                    <th className="py-2 pr-4">Answer</th>
                    <th className="py-2 pr-4 text-right">Points</th>
                    <th className="py-2 pr-4">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.questionBreakdown.filter((q) => q.matched).map((q, i) => (
                    <tr key={i} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 pr-4 text-neutral-800">{q.questionText || `Q${q.questionId}`}</td>
                      <td className="py-2 pr-4 text-neutral-600">{q.answerText || `A${q.answerId}`}</td>
                      <td className="py-2 pr-4 text-right font-semibold">{q.points > 0 ? q.points : ''}</td>
                      <td className="py-2 pr-4 text-neutral-500 italic">{q.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
