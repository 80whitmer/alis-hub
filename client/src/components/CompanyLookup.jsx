import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Autocomplete search box backed by /api/hubspot/search.
 * Lets the user pick a company by name instead of hand-typing
 * companyName + hubspotCompanyId (the two fields most likely to cause a
 * silent mismatch — e.g. wrong ticket history pulled for a QBR).
 */
export default function CompanyLookup({ companyName, hubspotCompanyId, onSelect }) {
  const [query, setQuery] = useState(companyName || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Keep the input in sync if the parent resets formData (e.g. template switch)
  useEffect(() => {
    setQuery(companyName || '');
  }, [companyName]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runSearch = useCallback((q) => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    fetch(`/api/hubspot/search?q=${encodeURIComponent(q.trim())}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `Search failed (${r.status})`);
        return data;
      })
      .then((data) => {
        setResults(data.companies || []);
        setOpen(true);
      })
      .catch((err) => {
        setError(err.message);
        setResults([]);
        setOpen(true);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    // Typing invalidates any previously-selected hubspotCompanyId — the
    // parent should treat the account as "unlinked" until a new selection.
    onSelect({ name: val, hubspotId: '' });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  }

  function handlePick(company) {
    setQuery(company.name);
    setOpen(false);
    onSelect({ name: company.name, hubspotId: company.hubspotId });
  }

  const isLinked = Boolean(hubspotCompanyId);

  return (
    <div className="input-group mb-6" ref={containerRef}>
      <label className="input-label">Company / Account Name</label>
      <div className="relative">
        <input
          type="text"
          placeholder="Start typing a company name…"
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">Searching…</span>
        )}

        {open && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-neutral-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {error ? (
              <p className="px-4 py-3 text-sm text-error">{error}</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-neutral-500">
                {loading ? 'Searching…' : 'No matching HubSpot companies — you can still type the name manually.'}
              </p>
            ) : (
              results.map((c) => (
                <button
                  key={c.hubspotId}
                  type="button"
                  onClick={() => handlePick(c)}
                  className="w-full text-left px-4 py-2 hover:bg-neutral-50 border-b border-neutral-100 last:border-0"
                >
                  <p className="text-sm font-medium text-primary-900">{c.name}</p>
                  <p className="text-xs text-neutral-500">
                    {[c.city, c.state].filter(Boolean).join(', ') || 'No address on file'} · HubSpot ID {c.hubspotId}
                  </p>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <p className={`input-help ${isLinked ? 'text-success' : 'text-neutral-500'}`}>
        {isLinked
          ? `✓ Linked to HubSpot company ${hubspotCompanyId} — ticket history will be pulled for this QBR.`
          : 'Not linked to a HubSpot company yet — pick one from the dropdown to pull ticket history, or leave unlinked.'}
      </p>
    </div>
  );
}
