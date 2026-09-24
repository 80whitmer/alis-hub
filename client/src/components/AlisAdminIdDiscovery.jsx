import { useState } from 'react';

/**
 * Auto-discovers ALIS Admin Company ID -> HubSpot company mappings by
 * scraping ALIS admin's own company directory and name-matching against
 * the portfolio (server/services/alisCompanyDiscovery.js) — Aaron, Sep
 * 2026: "digging the account truth model... how can we get the company
 * IDs embedded here and easily updated in bulk." A proposal only —
 * confident matches are pre-checked, ambiguous rows default to Skip;
 * nothing is written until "Import Selected" is clicked. Kept separate
 * from CompanyHostMappingButtons' "Refresh from ALIS Admin" (which
 * auto-writes by name with no review step) since a wrong admin-id mapping
 * would go on to trigger a live ALIS admin login for the wrong company —
 * a materially higher-stakes mistake than a wrong subdomain link.
 */
export default function AlisAdminIdDiscovery({ accounts, onImported }) {
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState(null);
  const [discoverError, setDiscoverError] = useState(null);
  const [selections, setSelections] = useState({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoverResult(null);
    setSelections({});
    setApplyResult(null);
    try {
      const slim = accounts.map((a) => ({ id: a.hubspot_company_id, name: a.company_name, alisAdminCompanyId: a.alis_admin_company_id }));
      const res = await fetch('/api/account-truth/alis-admin-ids/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: slim }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setDiscoverResult(body);
      const initial = {};
      body.autoMatched.forEach((m, i) => { initial[`auto:${i}`] = m; });
      setSelections(initial);
    } catch (err) {
      setDiscoverError(err.message);
    } finally {
      setDiscovering(false);
    }
  }

  function toggleAutoMatch(key, match, checked) {
    setSelections((prev) => {
      const next = { ...prev };
      if (checked) next[key] = match; else delete next[key];
      return next;
    });
  }

  function setAmbiguousSelection(key, candidate) {
    setSelections((prev) => {
      const next = { ...prev };
      if (candidate) next[key] = candidate; else delete next[key];
      return next;
    });
  }

  async function handleApply() {
    const rows = Object.values(selections).map((m) => ({
      hubspotCompanyId: m.hubspotCompanyId, companyName: m.companyName, alisAdminCompanyId: m.alisAdminCompanyId,
    }));
    if (rows.length === 0) return;
    setApplying(true);
    setDiscoverError(null);
    try {
      const res = await fetch('/api/account-truth/alis-admin-ids/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Import failed (${res.status})`);
      setApplyResult(`Imported ${body.imported} ALIS Admin Company ID${body.imported === 1 ? '' : 's'}.`);
      setDiscoverResult(null);
      setSelections({});
      await onImported?.();
    } catch (err) {
      setDiscoverError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const selectedCount = Object.keys(selections).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleDiscover} className="btn btn-sm btn-secondary" disabled={discovering} title="Scrape ALIS admin's own company directory and propose ALIS Admin Company ID matches by name">
          {discovering ? '🔍 Scraping ALIS admin…' : '🔍 Discover ALIS Admin Company IDs'}
        </button>
        {applyResult && <span className="text-xs text-neutral-500">{applyResult}</span>}
      </div>
      {discoverError && <p className="text-xs text-error max-w-md">{discoverError}</p>}
      {discoverResult && (
        <div className="border border-neutral-200 rounded-lg p-3 bg-white max-w-2xl">
          <p className="text-xs mb-2">
            {discoverResult.directoryCount} companies found in ALIS admin —{' '}
            {discoverResult.autoMatched.length} confident match{discoverResult.autoMatched.length === 1 ? '' : 'es'},{' '}
            {discoverResult.ambiguous.length} need review,{' '}
            {discoverResult.noCandidate.length} no name match found
            {discoverResult.noAlisId.length > 0 && <>, {discoverResult.noAlisId.length} row(s) had no id in the link</>}.
          </p>
          {discoverResult.autoMatched.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-1">Confident matches (checked = will import)</p>
              <div className="max-h-40 overflow-y-auto mb-2">
                {discoverResult.autoMatched.map((m, i) => {
                  const key = `auto:${i}`;
                  return (
                    <label key={key} className="flex items-center gap-2 text-xs py-0.5">
                      <input type="checkbox" checked={Boolean(selections[key])} onChange={(e) => toggleAutoMatch(key, m, e.target.checked)} />
                      <span><strong>{m.alisCompanyName}</strong> (id {m.alisAdminCompanyId}) → {m.companyName}</span>
                      <span className="text-neutral-400">match {Math.round(m.score * 100)}%</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {discoverResult.ambiguous.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-1">Needs review — pick the right company, or leave as Skip</p>
              <div className="max-h-40 overflow-y-auto mb-2">
                {discoverResult.ambiguous.map((row, i) => {
                  const key = `amb:${i}`;
                  const chosen = selections[key];
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs py-0.5 flex-wrap">
                      <span><strong>{row.alisCompanyName}</strong> (id {row.alisAdminCompanyId})</span>
                      <span>→</span>
                      <select
                        value={chosen ? chosen.hubspotCompanyId : ''}
                        onChange={(e) => {
                          const candidate = row.candidates.find((c) => c.hubspotCompanyId === e.target.value);
                          setAmbiguousSelection(key, candidate
                            ? { hubspotCompanyId: candidate.hubspotCompanyId, companyName: candidate.companyName, alisAdminCompanyId: row.alisAdminCompanyId }
                            : null);
                        }}
                        className="text-xs border border-neutral-200 rounded px-1 py-0.5"
                      >
                        <option value="">Skip</option>
                        {row.candidates.map((c) => (
                          <option key={c.hubspotCompanyId} value={c.hubspotCompanyId}>{c.companyName} ({Math.round(c.score * 100)}%)</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <button onClick={handleApply} className="btn btn-sm btn-accent" disabled={applying || selectedCount === 0}>
            {applying ? 'Importing…' : `Import Selected (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
