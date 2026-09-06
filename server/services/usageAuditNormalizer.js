/**
 * Assembles the usage-audit tool's final grid: for every catalog feature x
 * every community, a {contracted, enabled, used} triple, from three
 * independently-pulled sources (HubSpot deals/line-items, ALIS Entitlements
 * scrape, ALIS export API activity). See usageAuditCatalog.js for the
 * feature definitions this walks.
 */

const { getCatalog } = require('./usageAuditCatalog');
const { communityKey, getUsageCount } = require('./usageSignals');

const STRIP_SUFFIXES = [
  'assisted living and memory care', 'assisted living & memory care',
  'assisted living', 'memory care', 'independent living',
  'senior living', 'al & mc', 'al/mc', 'al and mc',
];

/** Lowercases, strips punctuation, and drops common facility-type suffixes so "The Gardens at Lake Wellington Assisted Living" and "Imagine Senior Living - The Gardens at Lake Wellington" both reduce to something containing "gardens at lake wellington". */
function normalizeName(str) {
  let s = String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const suffix of STRIP_SUFFIXES) {
    s = s.replace(suffix, ' ').replace(/\s+/g, ' ').trim();
  }
  return s;
}

/**
 * Finds every deal whose name plausibly refers to this community. Matching
 * is deliberately loose (substring containment either direction on
 * normalized names) since HubSpot deal names are hand-typed and follow no
 * fixed convention — a wrong match is possible and expected to need human
 * review, not a guarantee. A community can match multiple deals (e.g. an
 * add-on/expansion deal signed later); all of their line items count as
 * contracted.
 */
function matchDealsToCommunity(communityName, deals) {
  const target = normalizeName(communityName);
  if (!target) return [];
  return deals.filter((d) => {
    const dealNorm = normalizeName(d.dealName);
    return dealNorm.includes(target) || target.includes(dealNorm);
  });
}

/** True if any line item across the matched deals' names contains one of this feature's HubSpot product aliases (case-insensitive substring). */
function findContractedLineItems(matchedDeals, aliases) {
  if (!aliases || aliases.length === 0) return [];
  const found = [];
  for (const deal of matchedDeals) {
    for (const li of deal.lineItems) {
      const name = (li.name || '').toLowerCase();
      if (aliases.some((a) => name.includes(a.toLowerCase()))) {
        found.push({ dealId: deal.dealId, dealName: deal.dealName, lineItemName: li.name, quantity: li.quantity, price: li.price });
      }
    }
  }
  return found;
}

/**
 * @param {object} args
 * @param {string} args.companyName
 * @param {Array<{name, communityId, host}>} args.communities
 * @param {{ [host]: { flags: {[flagId]: boolean}, companyId: string } | null }} args.entitlementsByHost
 *   null for a host the caller didn't scrape entitlements for.
 * @param {Array} args.deals - result of getContractedModulesForCompany, or [] if no HubSpot company was given
 * @param {boolean} args.dealsAvailable - false when no HubSpot company ID was given OR the pull itself failed
 *   (as opposed to a real, successful pull that just found no deals) — an empty `deals` array is otherwise
 *   ambiguous between "this company genuinely has no HubSpot deals" and "we couldn't check," and the two need
 *   different cell states: false (checked, not contracted) vs. null (unknown).
 * @param {object} args.usageMap - result of computeUsageSignals
 * @returns {object} the full audit snapshot summary
 */
function buildAuditGrid({ companyName, communities, entitlementsByHost, deals, dealsAvailable, usageMap }) {
  const catalog = getCatalog();
  const hosts = [...new Set(communities.map((c) => c.host))];

  // Match every community to its contracted deals once, up front.
  const dealsByCommunity = {};
  for (const c of communities) {
    dealsByCommunity[communityKey(c.host, c.communityId)] = matchDealsToCommunity(c.name, deals);
  }

  const features = catalog.map((feature) => {
    const entitlementState = {};
    for (const host of hosts) {
      const entry = entitlementsByHost[host];
      if (!entry || feature.entitlementFlags.length === 0) {
        entitlementState[host] = null; // not scraped for this host, or feature isn't gated at all
      } else {
        // "on" if ANY candidate flag is checked — see catalog notes for ambiguous multi-flag features.
        entitlementState[host] = feature.entitlementFlags.some((flagId) => entry.flags[flagId] === true);
      }
    }

    const byCommunity = {};
    for (const c of communities) {
      const key = communityKey(c.host, c.communityId);
      const matchedDeals = dealsByCommunity[key] || [];
      const contractedLineItems = findContractedLineItems(matchedDeals, feature.hubspotProductAliases);
      const usageCount = getUsageCount(usageMap, c.host, c.communityId, feature.usageSignal);
      const used = usageCount === null ? null : usageCount > 0;

      byCommunity[key] = {
        contracted: (!dealsAvailable || feature.hubspotProductAliases.length === 0) ? null : contractedLineItems.length > 0,
        contractedDetail: contractedLineItems,
        // Real usage is stronger evidence than our own entitlement-flag
        // mapping (per Aaron 2026-09-03: "if something is being used it
        // definitely has been enabled") — a feature actively producing
        // records can't be disabled, so `used` overrides a false/unscraped
        // `entitlementState` reading. This also makes a wrong or ambiguous
        // catalog mapping (see mappingConfidence) self-correct in the
        // common case instead of showing a contradictory enabled=false/
        // used=true cell (exactly what happened with RET on company 353).
        enabled: used === true ? true : entitlementState[c.host],
        used,
        usageCount,
      };
    }

    return {
      id: feature.id,
      category: feature.category,
      label: feature.label,
      mappingConfidence: feature.mappingConfidence,
      notes: feature.notes,
      entitlementFlags: feature.entitlementFlags,
      usageSignal: feature.usageSignal,
      hasUsageSignal: feature.usageSignal !== null,
      entitlementState,
      byCommunity,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    companyName,
    hosts,
    communities: communities.map((c) => ({ name: c.name, communityId: c.communityId, host: c.host })),
    unmatchedDeals: deals
      .filter((d) => !communities.some((c) => matchDealsToCommunity(c.name, [d]).length > 0))
      .map((d) => ({ dealId: d.dealId, dealName: d.dealName, url: d.url, lineItemCount: d.lineItems.length })),
    features,
  };
}

module.exports = { buildAuditGrid, normalizeName, matchDealsToCommunity };
