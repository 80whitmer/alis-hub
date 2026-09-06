/**
 * Registry of ALIS "Audit History" destinations — every page confirmed
 * live (Sep 2026) to carry the same Note/Updated At/Updated By widget that
 * server/automation/playwright/auditHistoryPage.js scrapes. A new
 * destination (per Aaron: "may need to add additional audit destinations
 * in the future") is a new entry here, not new scraping logic — the
 * scraper itself is generic.
 *
 * Each entry's `urlFor(host, id)` builds the destination URL; `id` is
 * unused for 'company' (account-wide, not scoped to one entity).
 */
const DESTINATIONS = {
  company: {
    type: 'company',
    label: 'Company',
    urlFor: (host) => `https://${host}.alisonline.com/Communities?tab=Company`,
  },
  community: {
    type: 'community',
    label: 'Community',
    urlFor: (host, id) => `https://${host}.alisonline.com/Communities/Profiles/${id}`,
  },
  resident: {
    type: 'resident',
    label: 'Resident',
    urlFor: (host, id) => `https://${host}.alisonline.com/Residents/Profiles/${id}`,
  },
};

function getDestination(type) {
  const dest = DESTINATIONS[type];
  if (!dest) throw new Error(`Unknown audit-history destination type "${type}" — known types: ${Object.keys(DESTINATIONS).join(', ')}`);
  return dest;
}

module.exports = { DESTINATIONS, getDestination };
