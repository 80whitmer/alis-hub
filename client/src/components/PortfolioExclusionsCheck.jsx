import { useState } from 'react';

/**
 * Surfaces accounts owned by a known AM that never show up in the normal
 * Account Health / Team AM pull (Sep 2026, Aaron — investigating why two
 * real Owen-owned enhancement tickets, Western States Lodging and Charter
 * Senior Living, never appeared on either dashboard). Confirmed live: this
 * is systemic — 15 owned Home Office companies across 5 AMs have their
 * communities linked via the wrong HubSpot association type, so
 * hs_num_child_companies reads 0 and getOwnedCompanies' hs_num_child_
 * companies > 0 filter silently drops every one of them, along with
 * everything downstream (health score, ARR, tickets, occupancy).
 *
 * Live, on-demand HubSpot check (server/services/hubspotAccounts.js's
 * findExcludedPortfolioAccounts) — not cached, same reasoning as
 * AlisAdminIdDiscovery's own Discover button.
 */
const REASON_LABELS = {
  lead: 'Lead — not yet a client',
  canceled: 'Canceled',
  client_community: 'Lifecycle set to Client - Community (should be Home Office)',
  other_stage: 'Unrecognized lifecycle stage',
  no_stage: 'No lifecycle stage set',
  wrong_association_type: 'Communities linked via the wrong HubSpot association type',
  no_child_companies: 'No child companies linked at all',
};

export default function PortfolioExclusionsCheck() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/account-truth/excluded');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setResult(body.excluded);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  const byReason = {};
  for (const row of result || []) {
    (byReason[row.reason] ||= []).push(row);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleCheck} className="btn btn-sm btn-secondary" disabled={checking} title="Check for accounts owned by a known AM that don't show up on Account Health / Team AM, and why">
          {checking ? '🔎 Checking portfolio…' : '🔎 Check for Excluded Accounts'}
        </button>
        {result && <span className="text-xs text-neutral-500">{result.length} excluded account{result.length === 1 ? '' : 's'} found.</span>}
      </div>
      <p className="text-xs text-neutral-400 max-w-md">
        Only catches accounts with an Account Manager set in HubSpot — an account with no AM assigned at all (e.g. a brand-new Lead) can't be found this way and needs that set in HubSpot first.
      </p>
      {error && <p className="text-xs text-error max-w-md">{error}</p>}
      {result && result.length === 0 && <p className="text-xs text-success">No excluded accounts found — every owned account is showing up on the dashboards.</p>}
      {result && result.length > 0 && (
        <div className="border border-neutral-200 rounded-lg p-3 bg-white max-w-2xl">
          {Object.entries(byReason).map(([reason, rows]) => (
            <div key={reason} className="mb-3 last:mb-0">
              <p className="text-xs font-semibold mb-1">{REASON_LABELS[reason] || reason} ({rows.length})</p>
              <div className="max-h-48 overflow-y-auto">
                {rows.map((row) => (
                  <div key={row.hubspotCompanyId} className="text-xs py-1 border-b border-neutral-100 last:border-b-0">
                    {row.hubspotUrl ? (
                      <a href={row.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-600 hover:underline">
                        {row.companyName}
                      </a>
                    ) : (
                      <span className="font-medium">{row.companyName}</span>
                    )}
                    <span className="text-neutral-400"> — {row.accountManagerName}</span>
                    <p className="text-neutral-500 mt-0.5">{row.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
