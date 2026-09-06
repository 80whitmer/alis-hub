/**
 * Registry of ALIS Settings pages, mapped for Sync ALIS Settings (formerly
 * "Sync Resident Settings" — the underlying capture/apply engine in
 * residentSettingsPage.js was never actually Resident-specific, it just
 * hadn't been pointed anywhere else yet). Confirmed live (Sep 2026,
 * imagineseniorliving) against 18 Settings hub pages — see each entry's
 * `notes` for what's actually there and how ready it is.
 *
 * `scope` matters for what "sync between communities" even means:
 *   'community' — one page per community (communityId in the URL); the
 *                 normal sync-between-communities case.
 *   'account'   — one page per ALIS host, not per community; "syncing"
 *                 this means copying between different ALIS accounts/
 *                 companies, not communities within one account. Still
 *                 useful as a reference view, but a different job shape.
 *   'not-applicable' — confirmed NOT a real sync target; included so
 *                 nobody re-discovers this the hard way.
 */
const DESTINATIONS = {
  resident: {
    label: 'Resident Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Resident/${communityId}`,
    readiness: 'ready',
    notes: '98 real fields at one real account (54 compliance-item checkboxes + evacuation/advanced-directive/move-out/monitoring lists). Label/section extraction fixed and verified live.',
  },
  care: {
    label: 'Care Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Care/${communityId}`,
    readiness: 'ready',
    notes: 'Small (4 fields at one account) — Schedule, Care Planning Options, Care Programs, Current Shifts.',
  },
  medication: {
    label: 'Medication Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Medication/${communityId}`,
    readiness: 'ready',
    notes: 'Largest page found (68 fields at one account: 58 selects) — all label/section correctly now. One real, permanent gap: "Med Pass Time Shifts" (TimeFrames[N].MealTime) is a completely separate embedded micro-frontend (<div id="MedTimePreferences"><app></app></div>), not the same Knockout/MVC form as the rest of the page — mounts asynchronously with inconsistent timing and doesn\'t follow this page\'s DOM conventions. Deliberately excluded from capture/apply (see residentSettingsPage.js\'s isExcludedControl) rather than guessed at — a capture logs a warning when this section is present so nobody assumes full coverage.',
  },
  billing: {
    label: 'Billing Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Billing/${communityId}`,
    readiness: 'ready',
    notes: 'Payer Types, Billing Item Groups, Payment Methods, Auto-Close Settings. Verified live: the name="IncludeDisabled" collision between Payer Types and Payment Methods is handled correctly (positional matching), not a silent misapply.',
  },
  crmProspect: {
    label: 'CRM / Prospect Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Prospect/${communityId}`,
    readiness: 'ready',
    notes: 'Prospect Sources, Stages, Task Outcome Types, Referral Types/Organizations, Task Types, Prospect Scores, Custom Fields.',
  },
  staff: {
    label: 'Staff Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Staff`,
    readiness: 'ready',
    notes: 'Has its own "Compliance Configuration" section, same pattern as Resident Settings\' — but this page is not community-scoped at all.',
  },
  approval: {
    label: 'Approval Center', scope: 'not-applicable',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Approval`,
    readiness: 'not-applicable',
    notes: 'The ~180 "checkboxes" here (Billing Approval) are a staff-picker widget (value="person:NNNNN", no id/name) — a different roster per community by definition, not a syncable setting. Already excluded by the capture engine\'s empty-id/name filter; do not build sync support for this page.',
  },
  company: {
    label: 'Company Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Company`,
    readiness: 'needs-review',
    notes: 'Large (17 checkboxes, 16 tables — Immunizations Center, Community Tasks, On Leave Reasons/Destinations, Observation Types, Resident Checklist, etc.), but account-wide not per-community — "syncing" this means copying between different companies/accounts, a different use case than the community-to-community sync this tool was built for. Not yet tested against captureFormFields.',
  },
  community: {
    label: 'Community (Facility) Settings', scope: 'community',
    urlFor: (host, communityId) => `https://${host}.alisonline.com/Settings/Facility/${communityId}`,
    readiness: 'ready',
    notes: 'Small (3 fields at one account) — General Configuration, Observations.',
  },
  connect: {
    label: 'ALIS Connect Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Connect`,
    readiness: 'ready',
    notes: 'Very small (1 field observed).',
  },
  evaluations: {
    label: 'Resident Evaluation Tool Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Evaluations`,
    readiness: 'ready',
    notes: 'Very small (Evaluation Type only, at least at this account).',
  },
  pharmacy: {
    label: 'Pharmacy Integration Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Integrations?tab=Pharmacy`,
    readiness: 'not-applicable',
    notes: 'Its "Pharmacy Connection Audit History" heading is a false friend for the Audit History tool — real header is Pharmacy | Provider | Communities | Connection Test | Options (integration health, not a Note/Updated At/Updated By log). Not a settings-sync target either — this is a list of external pharmacy connections, not toggleable settings.',
  },
  drugDatabase: {
    label: 'Drug Database Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/DrugDatabase`,
    readiness: 'ready',
    notes: 'Very small (near-empty at this account).',
  },
  billingCenter: {
    label: 'Billing Center Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Tasks/Billing`,
    readiness: 'ready',
    notes: 'Small (General Settings only, at least at this account).',
  },
  residencyAgreement: {
    label: 'Residency Agreement Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/ResidencyAgreement`,
    readiness: 'ready',
    notes: 'Very small at this account.',
  },
  intacctGl: {
    label: 'Intacct GL Integration Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Integrations?tab=Intacct%20GL`,
    readiness: 'ready',
    notes: 'Very small (near-empty at this account, integration not configured).',
  },
  notifications: {
    label: 'Notification Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Notifications`,
    readiness: 'ready',
    notes: 'Very small at this account.',
  },
  calendar: {
    label: 'Calendar Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Calendar`,
    readiness: 'ready',
    notes: 'Small (2 checkboxes, 2 tables).',
  },
  alisHq: {
    label: 'ALIS HQ (Insights) Settings', scope: 'account',
    urlFor: (host) => `https://${host}.alisonline.com/Settings/Insights`,
    readiness: 'ready',
    notes: 'Small (6 checkboxes at this account).',
  },
};

function getSettingsDestination(key) {
  const dest = DESTINATIONS[key];
  const validKeys = Object.keys(DESTINATIONS).filter((k) => DESTINATIONS[k].readiness !== 'not-applicable');
  if (!dest || dest.readiness === 'not-applicable') {
    throw new Error(`Unknown or non-applicable settings destination "${key}" — known types: ${validKeys.join(', ')}`);
  }
  return dest;
}

module.exports = { DESTINATIONS, getSettingsDestination };
