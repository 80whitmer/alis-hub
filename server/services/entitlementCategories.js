/**
 * Groups raw ALIS entitlement flags into the same product families HubSpot's
 * `alis_products` company property uses, so "what's sold" and "what's
 * actually turned on" can be compared apples-to-apples (Aaron, Sep 2026:
 * "breaking out the entitlements by ALIS style... flag any mismatch between
 * hubspot and what has been enabled").
 *
 * The ALIS admin entitlements page carries no category/section markup of
 * its own (confirmed live, Sep 2026 — checkbox ids are flat, no parent
 * grouping) and there's no published flag→product mapping to read from
 * HubSpot or ALIS — this is a best-effort KEYWORD mapping against each
 * flag's humanized label, same "inferred, not authoritative" spirit as
 * moduleInference.js. Expect some flags to land in "Other / Uncategorized"
 * or in the wrong bucket; Aaron is the actual source of truth on where
 * a given feature belongs and should correct this mapping over time.
 */

// Exact values from HubSpot's alis_products property (confirmed live via
// the Properties API, Sep 2026) — this app's canonical category list.
// ALIS Pay's two HubSpot values are folded into one category here since a
// live-enabled Pay flag doesn't distinguish Legacy vs. All-Inclusive, and
// ALIS AI's three tiers are folded the same way.
const CATEGORY_LABELS = [
  'ALIS eHR', 'ALIS eMAR', 'ALIS Care Tracking', 'ALIS RET', 'ALIS HQ', 'ALIS CRM',
  'ALIS RevOps', 'ALIS Connect', 'ALIS Pay', 'ALIS Communications', 'ALIS Move-In Packet',
  'ALIS AI', 'eSign', 'Chromebooks',
];
const OTHER_CATEGORY = 'Other / Uncategorized';

// The alis_products option values that fold into each category above, for
// matching against a company's HubSpot-recorded products.
const HUBSPOT_PRODUCT_VALUES_BY_CATEGORY = {
  'ALIS Pay': ['ALIS Pay', 'ALIS Pay (All-Inclusive)'],
  'ALIS AI': ['ALIS AI', 'ALIS AI (Tier 2)', 'ALIS AI (Tier 3)'],
};
function hubspotProductValuesFor(category) {
  return HUBSPOT_PRODUCT_VALUES_BY_CATEGORY[category] || [category];
}

// Ordered rules, first match wins — same convention as moduleInference.js.
// Matched against the flag's raw id (underscores intact, so "gl"/"mar"
// don't false-positive inside longer words) rather than the humanized label.
const RULES = [
  ['ALIS Pay', /\balis_pay\b|payment_gateway|save_draft_payment|billing_center|collections_center|amount_deduction|subsidi|rent_roll|resident_billing|invoic/],
  ['ALIS RevOps', /_gl_integration|\bgl\b|general_ledger|intacct|multiview|billing_program/],
  ['ALIS eMAR', /\bmar\b|\bemar\b|med_pass|medication|drug_count|drug_database|narcotic|pharmacy_integration/],
  ['ALIS Care Tracking', /care_tracking|care_level|care_plan|community_task|resident_care_management|resident_progress|resident_monitoring|resident_vitals|incident/],
  ['ALIS eHR', /resident_compliance|resident_checklist|resident_audit|resident_report|resident_incident|resident_maximum|immunization|community_compliance|personnel_compliance|personnel_audit/],
  ['ALIS HQ', /_domo|\bhq\b|dashboard|export_to_|length_of_stay|unit_occupancy|multi_community_support|company_wide_settings/],
  ['ALIS CRM', /\bcrm\b|lead_assistant|enquire/],
  ['ALIS Connect', /alis_connect/],
  ['ALIS Communications', /personnel_notification|personnel_memo|zendesk|messenger/],
  ['ALIS Move-In Packet', /move_?in|floor_plan_configuration|document_center/],
  ['ALIS AI', /speech_transcription|scheduling_assistant|support_assistant|_ai_/],
  ['eSign', /esign|hellosign/],
  ['Chromebooks', /chromebook/],
];

function categorize(flagId) {
  const id = flagId.toLowerCase();
  for (const [category, re] of RULES) {
    if (re.test(id)) return category;
  }
  return OTHER_CATEGORY;
}

/**
 * Groups every scraped flag (on AND off — the caller must pass the full
 * set, not just enabled ones, or "recommend enabling" has nothing to
 * suggest) into categories, and cross-references each category against the
 * company's HubSpot `alis_products` list to flag mismatches.
 */
function groupEntitlements(flags, hubspotProducts) {
  const sold = new Set(hubspotProducts || []);
  const byCategory = new Map();
  for (const f of flags) {
    const category = categorize(f.id);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(f);
  }

  const categories = [...CATEGORY_LABELS, OTHER_CATEGORY]
    .filter((name) => byCategory.has(name))
    .map((name) => {
      const items = byCategory.get(name).sort((a, b) => a.label.localeCompare(b.label));
      const enabledCount = items.filter((f) => f.enabled).length;
      const isSold = name === OTHER_CATEGORY ? null : hubspotProductValuesFor(name).some((v) => sold.has(v));
      let status;
      if (name === OTHER_CATEGORY) status = 'uncategorized';
      else if (isSold && enabledCount > 0) status = 'aligned';
      else if (isSold && enabledCount === 0) status = 'sold_not_enabled';
      else if (!isSold && enabledCount > 0) status = 'enabled_not_sold';
      else status = 'not_applicable';
      return { name, isSold, items, enabledCount, totalCount: items.length, status };
    })
    .sort((a, b) => {
      const rank = { sold_not_enabled: 0, enabled_not_sold: 1, aligned: 2, not_applicable: 3, uncategorized: 4 };
      return rank[a.status] - rank[b.status] || b.enabledCount - a.enabledCount;
    });

  // Sold in HubSpot but the category doesn't exist at all in this
  // company's scraped flag set (a portal-wide flag catalog gap, not a
  // configuration choice) — surfaced separately since it can't be
  // represented as a category row above.
  const soldWithNoFlags = [...sold]
    .filter((p) => CATEGORY_LABELS.some((c) => hubspotProductValuesFor(c).includes(p) && !byCategory.has(c)))
    .sort();

  return { categories, soldWithNoFlags };
}

module.exports = { categorize, groupEntitlements, CATEGORY_LABELS, OTHER_CATEGORY };
