/**
 * crmIdAuditNormalizer.js
 * Builds the CRM ID audit report rows — company-level and community-level —
 * from a scraped ALIS Admin company-detail capture plus the matching HubSpot
 * company + child-company records.
 *
 * The core check (Aaron, Sep 2026): ALIS Admin's "CRM ID" field should
 * exactly equal the HubSpot record's Record ID (hs_object_id) — for the
 * company itself, and separately for each of its communities (which are
 * their own child company records in HubSpot). This one numeric ID is the
 * mapping key both systems are supposed to agree on, alongside the ALIS
 * numeric company/community ID used elsewhere in alis-hub.
 *
 * Matching priority (Aaron, Sep 2026, after a first portfolio-wide run hit
 * heavy name-mismatch noise between HubSpot and ALIS Admin display names —
 * "OneLife" / "Ascent Senior Living" / "Hearth and Truss" etc. never found a
 * same-named ALIS company even though a real, correctly-ID'd record likely
 * exists): match by ID FIRST, name only as a last resort. A community whose
 * ALIS CRM ID equals a HubSpot child company's Record ID is the same real
 * record even if their display names differ — that's the whole point of the
 * audit, so an ID match beats a name match every time. Company-level ID
 * matching happens one level up in crmIdAuditBulk.js (it needs the full ALIS
 * directory + company_hosts table, which this module doesn't have); this
 * module does it directly for communities, where the full candidate list
 * (hubspotChildCompanies) is already in hand.
 */

// Onboarding communities ARE audited (Aaron, Sep 2026: "only the training
// tag marks a community as ignorable") — they're actively being provisioned
// and are exactly where a CRM ID mismatch is most likely to slip in
// unnoticed. Only "Training" (a non-production sandbox community, e.g.
// "Training Community", "VIVA Training - NJ" in Aaron's example) is excluded.
const NOT_LIVE_KEYWORD = 'training';

function normalizeNameKey(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A community counts as "not Live" only if it carries a Training badge or has "Training" in its name — Onboarding communities are real, in-progress production communities and are audited like any other. */
function isLikelyNotLive(community) {
  const badges = (community.statusBadges || []).map((b) => b.toLowerCase());
  if (badges.some((b) => b.includes(NOT_LIVE_KEYWORD))) return true;
  const nameLower = (community.communityName || '').toLowerCase();
  return nameLower.includes(NOT_LIVE_KEYWORD);
}

function ids(a, b) {
  const av = a == null ? '' : String(a).trim();
  const bv = b == null ? '' : String(b).trim();
  return { av, bv };
}

/** Compares two ID-like values as strings (trimmed) — HubSpot Record IDs and ALIS CRM IDs are both plain numeric strings, no type coercion needed beyond that. */
function statusFor(alisValue, hubspotValue) {
  const { av, bv } = ids(alisValue, hubspotValue);
  if (!av && !bv) return 'BOTH_BLANK';
  if (!av) return 'MISSING_ON_ALIS_SIDE';
  if (!bv) return 'MISSING_ON_HUBSPOT_SIDE';
  return av === bv ? 'MATCH' : 'MISMATCH';
}

/**
 * Finds the HubSpot child company this ALIS community is actually the same
 * real record as. ID first (community.crmId === a child's Record ID) —
 * matched this way, the two are confirmed the same record regardless of
 * what either system calls it. Name is only a fallback for when the CRM ID
 * field itself is the thing that's wrong/blank, which is squishier (two
 * differently-ID'd records that just happen to share a display name) but
 * still worth surfacing as a probable match to flag.
 */
function findHubspotMatch(community, hubspotChildCompanies) {
  if (!hubspotChildCompanies || hubspotChildCompanies.length === 0) return { match: null, method: null };
  const crmId = (community.crmId || '').trim();
  if (crmId) {
    const byId = hubspotChildCompanies.find((c) => String(c.id).trim() === crmId);
    if (byId) return { match: byId, method: 'id' };
  }
  const nameKey = normalizeNameKey(community.communityName);
  const byName = hubspotChildCompanies.find((c) => normalizeNameKey(c.name) === nameKey);
  if (byName) return { match: byName, method: 'name' };
  return { match: null, method: null };
}

const MATCH_METHOD_DESCRIPTION = { id: 'CRM ID', host: 'ALIS host', name: 'name' };

/** A one-line note when a confirmed (non-name) match has different display names on each side — informational only, never blocks or changes the status. */
function nameMismatchNote(sideALabel, nameA, sideBLabel, nameB, matchMethod) {
  if (normalizeNameKey(nameA) === normalizeNameKey(nameB)) return null;
  return `Names differ: ${sideALabel} "${nameA}" vs ${sideBLabel} "${nameB}" — matched by ${MATCH_METHOD_DESCRIPTION[matchMethod] || matchMethod}, not by name.`;
}

/**
 * @param {object} params
 * @param {string} params.companyName - the HubSpot company name (used for the report header/matching context)
 * @param {string} params.alisAdminCompanyId
 * @param {string} [params.alisCompanyName] - the ALIS Admin company's own display name, if a match was found
 * @param {string|null} params.companyCrmId - scraped from the company detail page
 * @param {string|null} params.hubspotCompanyId
 * @param {string|null} [params.matchMethod] - how the ALIS company record was found: 'id' | 'host' | 'name' | null (unmatched)
 * @param {Array}  params.alisCommunities - scraped Communities table rows
 * @param {Array}  params.hubspotChildCompanies - [{id, name}] from HubSpot, or null if the lookup was skipped/failed
 * @param {string|null} params.hubspotLookupError
 */
function buildCrmIdAuditReport({
  companyName, alisAdminCompanyId, alisCompanyName, companyCrmId, hubspotCompanyId, matchMethod,
  alisCommunities, hubspotChildCompanies, hubspotLookupError,
}) {
  const company = {
    companyName,
    alisCompanyName: alisCompanyName || null,
    alisAdminCompanyId: alisAdminCompanyId || null,
    alisCrmId: companyCrmId || null,
    hubspotRecordId: hubspotCompanyId || null,
    matchMethod: matchMethod || null,
    status: alisAdminCompanyId ? statusFor(companyCrmId, hubspotCompanyId) : 'NO_ALIS_ADMIN_MATCH',
    nameNote: (matchMethod === 'id' || matchMethod === 'host') && alisCompanyName
      ? nameMismatchNote('HubSpot', companyName, 'ALIS Admin', alisCompanyName, matchMethod)
      : null,
  };

  const communities = (alisCommunities || []).map((community) => {
    const notLive = isLikelyNotLive(community);
    const { match: hubspotMatch, method: communityMatchMethod } = findHubspotMatch(community, hubspotChildCompanies);

    let status;
    if (notLive) {
      status = 'SKIPPED_NOT_LIVE';
    } else if (hubspotChildCompanies == null) {
      status = 'HUBSPOT_LOOKUP_UNAVAILABLE';
    } else if (!hubspotMatch) {
      status = community.crmId ? 'NO_HUBSPOT_MATCH' : 'BOTH_BLANK';
    } else {
      status = statusFor(community.crmId, hubspotMatch.id);
    }

    return {
      communityName: community.communityName,
      alisCommunityId: community.alisCommunityId,
      alisCrmId: community.crmId || null,
      statusBadges: community.statusBadges || [],
      hubspotRecordId: hubspotMatch?.id || null,
      hubspotMatchedName: hubspotMatch?.name || null,
      matchMethod: communityMatchMethod,
      status,
      nameNote: communityMatchMethod === 'id' && hubspotMatch
        ? nameMismatchNote('ALIS', community.communityName, 'HubSpot', hubspotMatch.name, communityMatchMethod)
        : null,
    };
  });

  const summary = { company: { status: company.status }, communities: {} };
  for (const c of communities) {
    summary.communities[c.status] = (summary.communities[c.status] || 0) + 1;
  }

  return { company, communities, hubspotLookupError: hubspotLookupError || null, summary };
}

module.exports = { buildCrmIdAuditReport, isLikelyNotLive, normalizeNameKey, findHubspotMatch };
