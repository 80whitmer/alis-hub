import { useMemo, useState } from 'react';

/**
 * Data completeness reporting/rollup (Aaron, Sep 2026: "wire into the score
 * Data... raising awareness to missing data will ensure that the system
 * runs smoothly... if scoring is a bridge too far -- just reporting and
 * roll up would be helpful"). Deliberately no score/weighting — a raw gap
 * list per account plus a portfolio-wide "how many are missing this" count
 * per criterion, same shape as every other rollup+table pair on these
 * dashboards.
 *
 * Two of Aaron's originally-named criteria collapsed into one: "ALIS ID
 * confirmed" and "Account Truth set" both come down to the same field
 * (alis_admin_company_id) — see server/db/database.js's Account Truth
 * table comment ("the numeric ALIS Admin Company ID... Account Truth
 * model") and accountTruth.js's own doc comment. Everything below is
 * computed purely client-side from fields every account object already
 * carries (no new server data needed) — same convention as
 * computeGlobalSearchHits/the rollup useMemo elsewhere on these pages.
 */
export const DATA_COMPLETENESS_CRITERIA = [
  {
    key: 'hubspotCrm',
    label: 'HubSpot CRM confirmed',
    hint: 'Tier and Account Manager are both set on the HubSpot company record',
    check: (a) => Boolean(a.tier) && Boolean(a.account_manager_name) && a.account_manager_name !== 'Unassigned',
  },
  {
    key: 'alisCrm',
    label: 'ALIS CRM confirmed',
    hint: '"ALIS CRM" appears in HubSpot\'s alis_products field for this company',
    check: (a) => (a.products || []).includes('ALIS CRM'),
  },
  {
    key: 'alisId',
    label: 'ALIS ID / Account Truth confirmed',
    hint: 'ALIS Admin Company ID is on file (Account Truth model)',
    check: (a) => Boolean(a.alis_admin_company_id),
  },
  {
    key: 'alisSubdomain',
    label: 'ALIS Subdomain confirmed',
    hint: 'An ALIS subdomain (company_host) is mapped for this account',
    check: (a) => Boolean(a.company_host),
  },
  {
    key: 'keyContacts',
    label: '2+ Key Contacts tagged',
    hint: 'At least 2 contacts carry a HubSpot association label (role tag)',
    check: (a) => (a.keyContacts || []).filter((c) => (c.labels || []).length > 0).length >= 2,
  },
  {
    key: 'recurringCall',
    label: 'Recurring Call set',
    hint: 'At least one recurring call is tracked for this account',
    check: (a) => (a.recurringCalls || []).length > 0,
  },
];

export function computeCompletenessGaps(account) {
  return DATA_COMPLETENESS_CRITERIA.filter((c) => !c.check(account));
}

export default function DataCompletenessSection({ accounts, showAccountManager = false }) {
  const [query, setQuery] = useState('');
  const [pill, setPill] = useState('all'); // 'all' | a criterion key

  const rows = useMemo(
    () => accounts.map((a) => ({
      companyName: a.company_name,
      accountManagerName: a.account_manager_name || 'Unassigned',
      hubspotUrl: a.hubspotUrl,
      gaps: computeCompletenessGaps(a),
    })).filter((r) => r.gaps.length > 0),
    [accounts]
  );

  const counts = useMemo(() => {
    const c = { all: rows.length };
    for (const crit of DATA_COMPLETENESS_CRITERIA) {
      c[crit.key] = rows.filter((r) => r.gaps.some((g) => g.key === crit.key)).length;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (pill !== 'all' && !r.gaps.some((g) => g.key === pill)) return false;
      if (!q) return true;
      return (r.companyName || '').toLowerCase().includes(q) || (r.accountManagerName || '').toLowerCase().includes(q);
    });
  }, [rows, query, pill]);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {DATA_COMPLETENESS_CRITERIA.map((c) => (
          <div key={c.key} className="border border-neutral-100 rounded-lg px-3 py-2" title={c.hint}>
            <p className="text-xs text-neutral-500">{c.label}</p>
            <p className="text-lg font-semibold text-neutral-800">
              {counts[c.key] || 0} <span className="text-xs font-normal text-neutral-400">of {accounts.length} missing</span>
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts…"
          className="text-sm px-3 py-1.5 rounded-full border border-neutral-200 focus:outline-none focus:border-accent-400 w-56"
        />
        <button
          type="button"
          onClick={() => setPill('all')}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${pill === 'all' ? 'border-accent-400 bg-accent-50 text-accent-700' : 'border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300'}`}
        >
          Any gap ({counts.all})
        </button>
        {DATA_COMPLETENESS_CRITERIA.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setPill(c.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${pill === c.key ? 'border-accent-400 bg-accent-50 text-accent-700' : 'border-neutral-200 text-neutral-600 bg-white hover:border-neutral-300'}`}
          >
            {c.label} ({counts[c.key] || 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No accounts have a gap matching this filter.</p>
      ) : (
        <div className="overflow-x-auto border border-neutral-100 rounded-lg" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50 sticky top-0">
              <tr className="text-left text-neutral-500">
                <th className="px-3 py-2 font-medium">Company</th>
                {showAccountManager && <th className="px-3 py-2 font-medium">AM</th>}
                <th className="px-3 py-2 font-medium">Missing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-3 py-2 text-neutral-700">
                    {r.hubspotUrl ? <a href={r.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-cool-glacier hover:underline">{r.companyName}</a> : r.companyName}
                  </td>
                  {showAccountManager && <td className="px-3 py-2 text-neutral-500">{r.accountManagerName}</td>}
                  <td className="px-3 py-2 text-neutral-500">{r.gaps.map((g) => g.label).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
