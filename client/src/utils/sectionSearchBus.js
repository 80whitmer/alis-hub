/**
 * Generic cross-component "push a query into this section's own search box"
 * signal (Aaron, Sep 2026: "add all of the other search functionalities in
 * here as well" — extending the global search's click-through, previously
 * ALIS-Internal-only, to every section with its own search box). Keyed by
 * an arbitrary string each section instance agrees on, since some
 * components (EnhancementRequestsSection) render more than once per page
 * with different scopes (Top 3 vs. all) that must each get only their own
 * query pushed, not each other's.
 */
export const SECTION_SEARCH_SET_EVENT = 'alis-hub:set-section-search';

export function pushSectionSearch(key, query) {
  window.dispatchEvent(new CustomEvent(SECTION_SEARCH_SET_EVENT, { detail: { key, query } }));
}
