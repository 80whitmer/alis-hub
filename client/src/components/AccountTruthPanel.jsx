import { useState } from 'react';
import EntitlementCategoryList from './EntitlementCategoryList';

/**
 * Account Truth model, ported from alis-product-ops (Aaron, Sep 2026:
 * "digging the account truth model -- could we bring it over and
 * integrate it with the team am / account health dashboards"): HubSpot's
 * own "Enabled" record (alis_products) side by side with a live ALIS
 * admin entitlements check, categorized and cross-checked for mismatches.
 * Shared by both dashboards' account drawers.
 */
export default function AccountTruthPanel({ account, onUpdated }) {
  const [editingAlisId, setEditingAlisId] = useState(false);
  const [alisIdInput, setAlisIdInput] = useState(account.alis_admin_company_id || '');
  const [savingAlisId, setSavingAlisId] = useState(false);
  const [alisIdError, setAlisIdError] = useState(null);
  const [liveEntitlements, setLiveEntitlements] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);

  async function handleSaveAlisId() {
    const value = alisIdInput.trim();
    if (!value) return;
    setSavingAlisId(true);
    setAlisIdError(null);
    try {
      const res = await fetch(`/api/account-truth/${account.hubspot_company_id}/alis-admin-id`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alisAdminCompanyId: value, companyName: account.company_name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (${res.status})`);
      setEditingAlisId(false);
      onUpdated?.();
    } catch (err) {
      setAlisIdError(err.message);
    } finally {
      setSavingAlisId(false);
    }
  }

  async function handleClearAlisId() {
    setSavingAlisId(true);
    setAlisIdError(null);
    try {
      const res = await fetch(`/api/account-truth/${account.hubspot_company_id}/alis-admin-id`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Clear failed (${res.status})`);
      setAlisIdInput('');
      setLiveEntitlements(null);
      onUpdated?.();
    } catch (err) {
      setAlisIdError(err.message);
    } finally {
      setSavingAlisId(false);
    }
  }

  async function handleCheckLive() {
    setLiveLoading(true);
    setLiveError(null);
    setLiveEntitlements(null);
    try {
      const products = (account.products || []).join(',');
      const res = await fetch(`/api/account-truth/${account.hubspot_company_id}/live-entitlements${products ? `?products=${encodeURIComponent(products)}` : ''}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setLiveEntitlements(body);
    } catch (err) {
      setLiveError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-primary-900 mb-2">Account Truth</h3>

      <div className="mb-3">
        <p className="text-xs text-neutral-500 mb-1.5">
          Enabled — per HubSpot's <code>alis_products</code> field, not a live ALIS check
          {account.package && <> · Package: <strong>{account.package}</strong></>}
        </p>
        {account.products?.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {account.products.map((p) => (
              <span key={p} className="text-xs px-2.5 py-0.5 rounded-full bg-accent-50 border border-accent-200 text-accent-700">{p}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400 italic">No products recorded in HubSpot for this account.</p>
        )}
      </div>

      <div className="border border-neutral-200 bg-neutral-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-neutral-700 mb-2">Live ALIS Admin Check</p>
        {!editingAlisId && account.alis_admin_company_id ? (
          <p className="text-xs mb-2">
            ALIS Admin Company ID: <strong>{account.alis_admin_company_id}</strong>{' '}
            <button type="button" className="text-cool-glacier hover:underline ml-1" onClick={() => setEditingAlisId(true)}>Edit</button>{' '}
            <button type="button" className="text-cool-glacier hover:underline" onClick={handleClearAlisId} disabled={savingAlisId}>Clear</button>
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <input
              placeholder="ALIS Admin Company ID"
              value={alisIdInput}
              onChange={(e) => setAlisIdInput(e.target.value)}
              className="text-xs border border-neutral-200 rounded-lg px-2 py-1 w-44"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveAlisId} disabled={savingAlisId || !alisIdInput.trim()}>
              {savingAlisId ? 'Saving…' : 'Save'}
            </button>
            {account.alis_admin_company_id && (
              <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => { setEditingAlisId(false); setAlisIdInput(account.alis_admin_company_id); }}>
                Cancel
              </button>
            )}
          </div>
        )}
        {alisIdError && <p className="text-xs text-error mb-2">{alisIdError}</p>}

        {account.alis_admin_company_id && !editingAlisId && (
          <>
            <button type="button" className="btn btn-accent btn-sm" onClick={handleCheckLive} disabled={liveLoading}>
              {liveLoading ? 'Checking ALIS admin…' : 'Check Live ALIS Entitlements'}
            </button>
            {liveError && <p className="text-xs text-error mt-2">{liveError}</p>}
            {liveEntitlements && <EntitlementCategoryList result={liveEntitlements} />}
          </>
        )}
      </div>
    </div>
  );
}
