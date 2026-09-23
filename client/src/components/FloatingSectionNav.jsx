import { useEffect, useState } from 'react';

/**
 * Floating ALIS-butterfly quick-nav (Sep 2026, Aaron: "a floating side pop
 * out panel... appears as a button in the shape of the ALIS Butterfly...
 * same scale as the butterfly up at the title of the dashboard"). Shown
 * once the page's own "Account & Operations Overview" section — which
 * already lists every section as a clickable jump link, via QuickJumpNav —
 * has scrolled out of the viewport, so that same instant-navigation menu
 * stays reachable without scrolling back to the top.
 *
 * The button IS the butterfly icon at title-scale (h-11, no circular
 * button chrome around it) per Aaron's own wording, rather than a smaller
 * icon inside a generic round button. Pinned to the vertical center of the
 * viewport (Sep 2026, Aaron: "just to the right of where a mouse pointer
 * [is] hanging in the middle of a screen while a mouse wheel is
 * navigating down the page... an easy slide to the right") rather than
 * the bottom corner — a scroll-then-slide-right motion from wherever the
 * cursor naturally sits mid-scroll, not a trip all the way to the corner.
 * Independent of BackToTopButton's own fixed bottom-6/right-6 spot — the
 * two coexist without overlapping since one's vertically centered and the
 * other's pinned to the bottom corner. Its own popout panel is a compact
 * anchored flyout, not the shared Drawer component the rest of this app
 * uses for data drill-downs (AtRiskDrawer, AccountDrawer, UtilityPanel): a
 * full-screen backdrop+blur modal reads as too heavy for "here's a list
 * of links," and "pop out panel" matches a flyout anchored to the button,
 * not a modal takeover — opens immediately to the button's left, along
 * the same slide-right approach path.
 *
 * `watchSectionId` is the target section's own DOM id (slugify(title) —
 * every SectionCard already sets this) — read directly via
 * document.getElementById rather than a forwarded ref, so this component
 * stays fully decoupled from SectionCard's internals. `enabled` gates
 * observing at all (pass false while the page is still loading and that
 * section hasn't rendered yet); this component re-attaches its observer
 * whenever `enabled` flips true, which is when the target section first
 * exists in the DOM.
 *
 * `sections` is grouped by theme (Sep 2026, Aaron: "keep the alphabetical
 * ordering but introduce a thematic grouping") — `{ category, items }[]`,
 * each dashboard's own copy of the same 4-bucket taxonomy (Accounts,
 * Financials, Tickets, Operational), items already alphabetized within
 * their bucket. Mirrors each dashboard's own QuickJumpNav grouping exactly
 * so the two navigation surfaces can never drift apart.
 */
export default function FloatingSectionNav({ watchSectionId, sections, onSelect, enabled = true }) {
  const [pastSection, setPastSection] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPastSection(false);
      return;
    }
    const node = document.getElementById(watchSectionId);
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setPastSection(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [watchSectionId, enabled]);

  // Scrolling back up past the watched section closes any open flyout too
  // — otherwise it could reappear stale the next time the button shows.
  useEffect(() => {
    if (!pastSection) setOpen(false);
  }, [pastSection]);

  if (!pastSection) return null;

  function handleSelect(title) {
    setOpen(false);
    onSelect(title);
  }

  return (
    <>
      {open && (
        <div className="fixed top-1/2 right-24 -translate-y-1/2 z-50 w-80 max-h-[70vh] overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-primary-900">Jump to section</p>
            <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700 transition-colors" aria-label="Close">✕</button>
          </div>
          <div className="space-y-3">
            {sections.map((group) => (
              <div key={group.category}>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1">{group.category}</p>
                <ul className="space-y-1">
                  {group.items.map((title) => (
                    <li key={title}>
                      <button
                        type="button"
                        onClick={() => handleSelect(title)}
                        className="w-full text-left text-sm text-neutral-600 hover:text-accent-600 hover:underline py-0.5"
                      >
                        {title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed top-1/2 right-6 -translate-y-1/2 z-50 hover:scale-110 transition-transform drop-shadow-lg"
        aria-label="Jump to a section"
        title="Jump to a section"
      >
        <img src="/butterfly-icon.png" alt="" className="h-11 w-auto" />
      </button>
    </>
  );
}
