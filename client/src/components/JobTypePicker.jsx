import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * JobTypePicker.jsx
 * The "Job Type" tile grid on the New Job page, grouped by theme with a search box.
 *
 * - Groups are defined here by template id so a job type's home doesn't depend on the
 *   loose `category` field in templates.json. Anything not listed lands in "Other",
 *   so a new template can never disappear from the page.
 * - Search matches the tile name and its description (every word must match).
 *   Enter picks the first match, Esc clears, and "/" jumps to the search box.
 * - Tiles are unchanged from before: icon, name, dashed border for the Evaluation Lookup
 *   tool, and the ⓘ popover with the description.
 */
const GROUPS = [
  { title: 'Setup & provisioning', hint: 'Create and configure communities', ids: ['create-communities', 'sync-resident-settings', 'il-incident-types'] },
  { title: 'Staff & alerts', hint: 'Who gets notified', ids: ['alert-subscriptions'] },
  { title: 'Residents & care', hint: 'Bulk resident and care-item changes', ids: ['resident-move-out', 'care-item-assistance-level', 'care-item-reporting-label', 'resident-photos', 'resident-acuity-history'] },
  { title: 'Billing & finance', hint: 'GL accounts, open billing, revenue', ids: ['sync-gl-accounts', 'moved-out-billing', 'community-revenue-snapshot'] },
  { title: 'Reports & analytics', hint: 'Exports, scorecards and QBR material', ids: ['kpi-export', 'wellness-scorecard', 'med-cart-report', 'abst-crosswalk', 'company-usage-audit'] },
  { title: 'Audits & lookups', hint: 'Checks and live look-ups', ids: ['audit-history', 'crm-id-audit', 'crm-id-audit-bulk', 'evaluation-lookup'] },
];

const byName = (a, b) => a.name.localeCompare(b.name);

export default function JobTypePicker({ templates, selectedTemplate, onSelect, infoOpenId, setInfoOpenId, infoPopoverRef }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  // "/" jumps to the search box from anywhere on the page (unless already typing somewhere).
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.target?.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sections = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    // Names match anywhere in the word; descriptions only at the start of a word, so a
    // short term like "gl" finds "Sync GL Accounts" but not every description with "single".
    const matches = (t) => {
      if (!words.length) return true;
      const name = t.name.toLowerCase();
      const desc = (t.description || '').toLowerCase();
      return words.every((w) => {
        if (name.includes(w)) return true;
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${esc}`).test(desc);
      });
    };
    const byId = new Map(templates.map((t) => [t.id, t]));
    const placed = new Set();
    const out = GROUPS.map((g) => {
      const items = g.ids.map((id) => byId.get(id)).filter(Boolean);
      items.forEach((t) => placed.add(t.id));
      return { ...g, items: items.filter(matches).sort(byName) };
    });
    const others = templates.filter((t) => !placed.has(t.id));
    out.push({ title: 'Other', hint: '', items: others.filter(matches).sort(byName) });
    return out.filter((s) => s.items.length);
  }, [templates, query]);

  const firstMatch = sections[0]?.items[0];

  function onSearchKey(e) {
    if (e.key === 'Enter' && firstMatch) {
      e.preventDefault();
      onSelect(firstMatch.id);
      setQuery('');
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setQuery('');
      e.currentTarget.blur();
    }
  }

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <label className="input-label mb-0">Job Type</label>
        <div className="relative w-full sm:w-80">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search job types…  ( / )"
            aria-label="Search job types"
            className="w-full"
          />
        </div>
      </div>

      {sections.length === 0 && (
        <p className="text-sm text-neutral-500 py-6">No job types match “{query}”.</p>
      )}

      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">{section.title}</h3>
              {section.hint && <span className="text-xs text-neutral-400">{section.hint}</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {section.items.map((template) => (
                <div key={template.id} className="relative">
                  <button
                    onClick={() => { onSelect(template.id); setInfoOpenId(null); }}
                    className={`w-full flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl border-2 text-center transition-all ${
                      template.isTool ? 'border-dashed ' : ''
                    }${
                      selectedTemplate === template.id
                        ? 'border-accent-500 bg-accent-50'
                        : template.isTool
                          ? 'border-neutral-200 bg-white hover:border-accent-300'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                    }`}
                  >
                    <span className="text-2xl leading-none">{template.icon}</span>
                    <span className="text-sm font-semibold text-primary-900 leading-tight">{template.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setInfoOpenId(infoOpenId === template.id ? null : template.id); }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-accent-600 hover:border-accent-300 flex items-center justify-center text-[10px] font-bold leading-none"
                    aria-label={`About ${template.name}`}
                    title="What does this do?"
                  >
                    i
                  </button>
                  {infoOpenId === template.id && (
                    <div
                      ref={infoPopoverRef}
                      className="absolute z-20 top-full mt-1.5 left-0 right-0 p-3 rounded-lg border border-neutral-200 bg-white shadow-lg text-xs text-neutral-600 text-left"
                    >
                      {template.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
