/**
 * Turns pre-fetched ALIS export API rows into a per-community "is this
 * feature actually being used" signal for the usage-audit tool.
 *
 * This is deliberately the same informal heuristic already leaned on
 * elsewhere in the codebase (see alisApiClient.js's getStaffComplianceDetails
 * comment: a module returning zero rows over a real window is itself a
 * finding, not a pull failure) — real activity in the lookback window means
 * "used", zero rows means "not used" (or not adopted), there is no ALIS
 * field anywhere that says "feature X is actively used" directly.
 *
 * Each row in the input arrays is expected to carry `communityId` and
 * `_host` (the same tagging convention wellnessExport.js / kpiExport.js use
 * for multi-host account-wide pulls).
 */

const SIGNAL_KEYS = [
  'billing', 'orderAdministration', 'recordedCare', 'evaluations', 'staffComplianceDetails', 'observations',
  'residents', 'prospects', 'referralSourcesUsed', 'dailyStandUp',
];

function communityKey(host, communityId) {
  return `${host}::${communityId}`;
}

/** Seeds every community with a 0 count for every signal, so a community with zero activity shows a real "not used" rather than being silently absent from the map. */
function seedUsageMap(communities) {
  const map = {};
  for (const c of communities) {
    map[communityKey(c.host, c.communityId)] = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 0]));
  }
  return map;
}

function tally(map, rows, signalKey) {
  for (const row of rows || []) {
    const key = communityKey(row._host, row.communityId);
    if (map[key]) map[key][signalKey] = (map[key][signalKey] || 0) + 1;
  }
}

/**
 * @param {object} pulledData - one array per SIGNAL_KEYS entry, each tagged
 *   with `_host` + `communityId`. `billing` is expected to already be the
 *   merged result of recurringCharges + invoiceCharges + outstandingInvoices
 *   (any billing activity counts); `referralSourcesUsed` is expected to
 *   already be pre-filtered to prospect rows that actually have a referral
 *   source/organization populated (not just every prospect row) — see
 *   usageAudit.js for both.
 * @param {Array<{host, communityId}>} communities
 * @returns {{ [communityKey]: { [signalKey]: number } }}
 */
function computeUsageSignals(pulledData, communities) {
  const map = seedUsageMap(communities);
  for (const key of SIGNAL_KEYS) {
    tally(map, pulledData[key], key);
  }
  return map;
}

/** Looks up the count for one feature's usageSignal at one community, or null if the feature has no usage signal defined. */
function getUsageCount(usageMap, host, communityId, signalKey) {
  if (!signalKey) return null;
  const bucket = usageMap[communityKey(host, communityId)];
  return bucket ? (bucket[signalKey] ?? 0) : 0;
}

/**
 * Directly sets one community's count for one signal — for a signal that's
 * already an aggregate when it arrives (e.g. dailyStandUp's page-scrape
 * rowCount) rather than a list of discrete rows to tally one-by-one like
 * every other SIGNAL_KEYS entry above.
 */
function setUsageCount(map, host, communityId, signalKey, count) {
  const key = communityKey(host, communityId);
  if (map[key]) map[key][signalKey] = count;
}

module.exports = { SIGNAL_KEYS, communityKey, computeUsageSignals, getUsageCount, setUsageCount };
