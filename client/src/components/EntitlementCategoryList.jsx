import { useState } from 'react';

/**
 * Live ALIS entitlements grouped by product category (server/services/
 * entitlementCategories.js), each flagged against whether it's recorded
 * as sold in HubSpot's alis_products field — ported from
 * alis-product-ops's EntitlementCategories.jsx (Aaron, Sep 2026: "digging
 * the account truth model -- could we bring it over").
 */

const STATUS = {
  sold_not_enabled: { label: 'Sold — nothing enabled', hint: 'Recommend turning on', bg: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-600' },
  enabled_not_sold: { label: 'Enabled — not recorded as sold', hint: 'Confirm with HubSpot, or disable', bg: 'bg-blue-50', border: 'border-blue-300', dot: 'bg-blue-600' },
  aligned: { label: 'Sold & enabled', hint: null, bg: 'bg-green-50', border: 'border-green-300', dot: 'bg-green-600' },
  not_applicable: { label: 'Not sold', hint: null, bg: 'bg-neutral-50', border: 'border-neutral-200', dot: 'bg-neutral-400' },
  uncategorized: { label: 'Uncategorized', hint: 'Could not be matched to a product by name', bg: 'bg-neutral-50', border: 'border-neutral-200', dot: 'bg-neutral-400' },
};

function CategoryRow({ category }) {
  const [open, setOpen] = useState(category.status === 'sold_not_enabled' || category.status === 'enabled_not_sold');
  const s = STATUS[category.status];
  return (
    <div className={`border ${s.border} ${s.bg} rounded-lg px-3 py-2 mb-2`}>
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
        <strong className="text-xs">{category.name}</strong>
        <span className="text-xs text-neutral-500">{category.enabledCount} of {category.totalCount} on</span>
        <span className="text-xs ml-auto">{s.label}{s.hint ? ` — ${s.hint}` : ''}</span>
        <span className="text-[10px] text-neutral-400">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {category.items.map((f) => (
            <span
              key={f.id}
              title={f.enabled ? 'Enabled' : 'Disabled'}
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                f.enabled ? 'bg-green-100 border border-green-300' : 'bg-white border border-dashed border-neutral-300 text-neutral-500'
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EntitlementCategoryList({ result }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-neutral-500 mb-1">
        {result.enabledCount} of {result.totalFlagCount} entitlements on, as of{' '}
        {new Date(result.capturedAt).toLocaleString()} —{' '}
        <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cool-glacier hover:underline">view in ALIS admin</a>
      </p>
      <p className="text-[11px] text-neutral-400 italic mb-3">
        Categories are inferred from each flag's name, not an official ALIS mapping — treat "Uncategorized" and
        borderline matches as a starting point, not ground truth.
      </p>
      {result.soldWithNoFlags?.length > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Sold in HubSpot but no matching flags were found on this account's ALIS admin page: <strong>{result.soldWithNoFlags.join(', ')}</strong>.
        </div>
      )}
      {result.categories.map((c) => <CategoryRow key={c.name} category={c} />)}
    </div>
  );
}
