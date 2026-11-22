/**
 * Job groups — one definition shared by the New Job page (grouped, color-coded tiles) and
 * the Job Board (finished jobs tinted in their group's color, plus a small group chip).
 *
 * A job's group is decided by its template id (`jobs.type`). Anything not listed lands in
 * "Other" on the New Job page; on the Job Board a type with no group (e.g. background
 * refresh jobs that aren't templates) simply stays uncolored.
 *
 * Class names are written out in full (never built from a color name) so Tailwind's
 * scanner can see them.
 */
export const JOB_GROUPS = [
  {
    key: 'setup', title: 'Setup & provisioning', hint: 'Create and configure communities',
    ids: ['create-communities', 'sync-resident-settings', 'il-incident-types'],
    c: { dot: 'bg-indigo-500', heading: 'text-indigo-700', tile: 'bg-indigo-50/60 border-indigo-200 hover:border-indigo-400', stripe: 'border-l-indigo-500', tint: 'bg-indigo-50/70', chip: 'bg-indigo-100 text-indigo-700' },
  },
  {
    key: 'staff', title: 'Staff & alerts', hint: 'Who gets notified',
    ids: ['alert-subscriptions'],
    c: { dot: 'bg-violet-500', heading: 'text-violet-700', tile: 'bg-violet-50/60 border-violet-200 hover:border-violet-400', stripe: 'border-l-violet-500', tint: 'bg-violet-50/70', chip: 'bg-violet-100 text-violet-700' },
  },
  {
    key: 'residents', title: 'Residents & care', hint: 'Bulk resident and care-item changes',
    ids: ['resident-move-out', 'care-item-assistance-level', 'care-item-reporting-label', 'resident-photos', 'resident-acuity-history'],
    c: { dot: 'bg-teal-500', heading: 'text-teal-700', tile: 'bg-teal-50/60 border-teal-200 hover:border-teal-400', stripe: 'border-l-teal-500', tint: 'bg-teal-50/70', chip: 'bg-teal-100 text-teal-700' },
  },
  {
    key: 'billing', title: 'Billing & finance', hint: 'GL accounts, open billing, revenue',
    ids: ['sync-gl-accounts', 'moved-out-billing', 'community-revenue-snapshot'],
    c: { dot: 'bg-emerald-500', heading: 'text-emerald-700', tile: 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-400', stripe: 'border-l-emerald-500', tint: 'bg-emerald-50/70', chip: 'bg-emerald-100 text-emerald-700' },
  },
  {
    key: 'reports', title: 'Reports & analytics', hint: 'Exports, scorecards and QBR material',
    ids: ['kpi-export', 'wellness-scorecard', 'med-cart-report', 'abst-crosswalk', 'company-usage-audit'],
    c: { dot: 'bg-sky-500', heading: 'text-sky-700', tile: 'bg-sky-50/60 border-sky-200 hover:border-sky-400', stripe: 'border-l-sky-500', tint: 'bg-sky-50/70', chip: 'bg-sky-100 text-sky-700' },
  },
  {
    key: 'audits', title: 'Audits & lookups', hint: 'Checks and live look-ups',
    ids: ['audit-history', 'crm-id-audit', 'crm-id-audit-bulk', 'evaluation-lookup'],
    c: { dot: 'bg-amber-500', heading: 'text-amber-700', tile: 'bg-amber-50/60 border-amber-200 hover:border-amber-400', stripe: 'border-l-amber-500', tint: 'bg-amber-50/70', chip: 'bg-amber-100 text-amber-700' },
  },
];

export const OTHER_GROUP = {
  key: 'other', title: 'Other', hint: '', ids: [],
  c: { dot: 'bg-slate-400', heading: 'text-slate-600', tile: 'bg-white border-neutral-200 hover:border-neutral-300', stripe: 'border-l-slate-400', tint: 'bg-slate-50', chip: 'bg-slate-100 text-slate-600' },
};

const BY_TEMPLATE_ID = new Map(JOB_GROUPS.flatMap((g) => g.ids.map((id) => [id, g])));

/** The group for a template id / job type, or null when it isn't in any group. */
export function groupForType(type) {
  return BY_TEMPLATE_ID.get(type) || null;
}
