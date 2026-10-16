import { useState } from 'react';

/**
 * Small collapsed-by-default sub-block for chart-heavy content nested
 * inside a SectionCard (Aaron, Sep 2026: "put this whole section in a
 * sub-section that is closed by default" — Ticket Activity's/Enhancement
 * Requests' charts pushing a searchable table further down the page than
 * it needed to be). Deliberately its own tiny component, not another
 * SectionCard — SectionCard is the page-level collapsible unit tracked by
 * JUMP_EVENT/the global search filter; this is a second, purely-visual
 * collapse level with no section identity of its own.
 */
export default function CollapsibleSubsection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-accent-600 mb-3"
      >
        <span className="text-xs text-neutral-400">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && children}
    </div>
  );
}
