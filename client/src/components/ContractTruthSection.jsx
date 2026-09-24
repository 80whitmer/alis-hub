import { useMemo, useState } from 'react';

function usd(cents) {
  return `$${Math.round((cents || 0) / 100).toLocaleString()}`;
}

/**
 * Contract Truth rollup — ported from alis-product-ops's Dashboard (Sep
 * 2026, Aaron: "I don't think these really need to be on the product
 * board" — moved here and onto Account Health, kept the same behavior).
 * Deliberately data-completeness, not human verification (Aaron's own call
 * when this was first built): does each account have a closed-won HubSpot
 * deal with both an ARR value and a close date on file. Computed entirely
 * client-side from `accounts` (already-loaded financialHealth.contractTruth
 * per account — see server/services/hubspotTickets.js's
 * computeContractTruth, attached in both accountHealth.js's and
 * teamAm.js's mapLiveFinancialHealth) — no extra API call, same as this
 * dashboard's other by-tier rollups.
 */
export default function ContractTruthSection({ accounts }) {
  const [open, setOpen] = useState(false);

  const rollup = useMemo(() => {
    const rows = accounts.map((a) => {
      const ct = a.financialHealth?.contractTruth;
      return {
        id: a.hubspot_company_id,
        name: a.company_name,
        tier: a.tier,
        arrCents: a.arr_cents,
        hasClosedWonDeal: !!ct?.hasClosedWonDeal,
        arrConfirmed: !!ct?.arrConfirmed,
        closeDateConfirmed: !!ct?.closeDateConfirmed,
        complete: !!ct?.complete,
        checked: ct != null,
      };
    });
    const gaps = rows.filter((r) => !r.complete);
    return {
      totalAccounts: rows.length,
      completeCount: rows.length - gaps.length,
      noClosedWonDealCount: rows.filter((r) => r.checked && !r.hasClosedWonDeal).length,
      missingArrCount: rows.filter((r) => r.checked && r.hasClosedWonDeal && !r.arrConfirmed).length,
      missingCloseDateCount: rows.filter((r) => r.checked && r.hasClosedWonDeal && !r.closeDateConfirmed).length,
      notYetRefreshedCount: rows.filter((r) => !r.checked).length,
      gaps: gaps.map((r) => ({
        id: r.id, name: r.name, tier: r.tier, arrCents: r.arrCents,
        issue: !r.checked ? 'Not yet refreshed' : !r.hasClosedWonDeal ? 'No closed-won deal on file' : !r.arrConfirmed && !r.closeDateConfirmed ? 'Missing ARR and close date' : !r.arrConfirmed ? 'Missing ARR value' : 'Missing close date',
      })),
    };
  }, [accounts]);

  if (rollup.totalAccounts === 0) return null;
  const pctComplete = Math.round((rollup.completeCount / rollup.totalAccounts) * 1000) / 10;

  return (
    <div>
      <p className="text-xs text-neutral-500 mb-3">
        Every account needs a closed-won HubSpot deal carrying both an ARR value and a close date to count as "confirmed" here —
        not a check against what was actually purchased (that needs HubSpot line-item detail this doesn't check).
      </p>
      <div className="border border-neutral-200 rounded-lg p-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <strong>Contract data confirmed</strong>
          <span className="text-success">{rollup.completeCount} of {rollup.totalAccounts} ({pctComplete}%)</span>
          {rollup.noClosedWonDealCount > 0 && <span className="text-error">{rollup.noClosedWonDealCount} no closed-won deal</span>}
          {rollup.missingArrCount > 0 && <span className="text-warning">{rollup.missingArrCount} missing ARR</span>}
          {rollup.missingCloseDateCount > 0 && <span className="text-warning">{rollup.missingCloseDateCount} missing close date</span>}
          {rollup.notYetRefreshedCount > 0 && <span className="text-neutral-500">{rollup.notYetRefreshedCount} not yet refreshed</span>}
          {rollup.gaps.length > 0 && (
            <button className="text-xs text-accent-600 underline ml-auto" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Show'} {rollup.gaps.length} needing a look
            </button>
          )}
        </div>
        {open && (
          <table className="mt-2">
            <thead><tr><th>Company</th><th>Tier</th><th>ARR</th><th>Gap</th></tr></thead>
            <tbody>
              {rollup.gaps
                .slice()
                .sort((a, b) => (b.arrCents || 0) - (a.arrCents || 0))
                .map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td className="text-neutral-500">{g.tier ?? '—'}</td>
                    <td className="text-neutral-500">{usd(g.arrCents)}</td>
                    <td className="text-error">{g.issue}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
