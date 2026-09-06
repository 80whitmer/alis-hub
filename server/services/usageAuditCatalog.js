/**
 * Feature catalog for the Company/Community ALIS Usage Audit tool.
 *
 * Maps the 36 features from Imagine Senior Living's 2024 manually-maintained
 * roadmap tracker (RAG spreadsheet) to:
 *   - entitlementFlags: the ALIS admin Entitlements checkbox ID(s) that gate
 *     this feature at the company level (captured live from
 *     admin.alisonline.com/Customers/EntitlementSets/EditCompany/{id} for
 *     company 353 on 2026-09-03 — see scratchpad-audit-recon/entitlements.json).
 *     Empty array = no matching flag was found among the 131 captured; this
 *     usually means the feature is core/ungated rather than that the mapping
 *     is wrong (see mappingConfidence: 'ungated').
 *   - hubspotProductAliases: substrings matched (case-insensitively) against
 *     HubSpot line-item names to detect this feature was actually purchased.
 *   - usageSignal: which pre-fetched ALIS export API dataset (see
 *     usageSignals.js) indicates real usage, and how — null where no export
 *     endpoint cleanly proxies this feature yet.
 *
 * This is a best-guess first pass, not a verified mapping — mappingConfidence
 * flags where a human should double check:
 *   'confident' — name match is clean, or corroborated by a second signal
 *   'ambiguous' — 2+ candidate entitlement flags exist and only one (or none)
 *                 is likely correct; entitlementFlags lists all candidates
 *   'ungated'   — no entitlement flag exists; feature is presumed always-on
 *
 * See the "Imagine Entitlement Mapping" review artifact (published
 * 2026-09-03) for the full reasoning behind each row.
 */

const CATALOG = [
  // ── Prospects ─────────────────────────────────────────────────────────
  {
    id: 'prospects', category: 'Prospects', label: 'Prospects',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'prospects',
    mappingConfidence: 'ungated', notes: 'Core prospect pipeline — no toggle found; usage = any prospect record created in the lookback window.',
  },
  {
    id: 'referralSources', category: 'Prospects', label: 'Referral Sources',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'referralSourcesUsed',
    mappingConfidence: 'ungated', notes: 'Core prospect pipeline — no toggle found; usage = prospects in the window with a referral source/organization actually recorded (not just any prospect).',
  },
  {
    id: 'crmDashboard', category: 'Prospects', label: 'CRM Dashboard',
    entitlementFlags: ['dashboards_beta_entitlement_104'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ambiguous', notes: 'May be the general BI dashboards flag, not CRM-specific.',
  },
  {
    id: 'tasks', category: 'Prospects', label: 'Tasks',
    entitlementFlags: ['community_tasks_entitlement_106'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ambiguous', notes: 'May be community task management, not prospect tasks specifically.',
  },

  // ── Residents ─────────────────────────────────────────────────────────
  {
    id: 'facesheet', category: 'Residents', label: 'Facesheet',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'residents',
    mappingConfidence: 'ungated', notes: 'Core resident record, effectively always used — usage = any current resident on file (a resident record implies a facesheet).',
  },
  {
    id: 'basicInformation', category: 'Residents', label: 'Basic Information',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'residents',
    mappingConfidence: 'ungated', notes: 'Core resident record, effectively always used — usage = any current resident on file with basic info populated.',
  },
  {
    id: 'crmIntegrations', category: 'Residents', label: 'CRM Integrations',
    entitlementFlags: ['enquire_crm_entitlement_50', 'sherpa_crm_entitlement_36', 'youve_got_leads_crm_entitlement_41'],
    hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'All three 3rd-party CRM flags — "on" if any is enabled.',
  },
  {
    id: 'residentCompliance', category: 'Residents', label: 'Resident Compliance',
    entitlementFlags: ['resident_compliance_entitlement_8'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'residentChecklist', category: 'Residents', label: 'Resident Checklist',
    entitlementFlags: ['resident_checklist_entitlement_93'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'observations', category: 'Residents', label: 'Observations',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'observations',
    mappingConfidence: 'ungated', notes: 'No dedicated flag (optimized_observations_pdf is PDF formatting, not the feature) — usage signal available.',
  },
  {
    id: 'immunizations', category: 'Residents', label: 'Immunizations',
    entitlementFlags: ['immunizations_center_configuration_entitlement_72'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Clear match.',
  },
  {
    id: 'residentMonitoring', category: 'Residents', label: 'Resident Monitoring',
    entitlementFlags: ['resident_monitoring_entitlement_86'], hubspotProductAliases: [], usageSignal: 'observations',
    mappingConfidence: 'confident', notes: 'Exact name match; observations pull doubles as a usage proxy.',
  },
  {
    id: 'mealtimeAttendance', category: 'Residents', label: 'Mealtime Attendance',
    entitlementFlags: ['attendance_entitlement_102'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ambiguous', notes: '"Attendance" may cover more than meals (e.g. activities).',
  },
  {
    id: 'weightTracking', category: 'Residents', label: 'Weight Tracking',
    entitlementFlags: ['resident_vitals_tracking_entitlement_12', 'scheduled_wellness_vitals_entitlement_96'],
    hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ambiguous', notes: 'Weight is one vital among several — unclear if a dedicated flag exists.',
  },
  {
    id: 'alisConnect', category: 'Residents', label: 'ALIS Connect',
    entitlementFlags: ['alis_connect_entitlement_40'], hubspotProductAliases: ['ALIS Connect'], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Matches HubSpot line item name exactly, plus flag.',
  },
  {
    id: 'communityContacts', category: 'Residents', label: 'Community Contacts',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ungated', notes: 'Core contact record — no toggle found.',
  },

  // ── Medications ───────────────────────────────────────────────────────
  {
    id: 'routine', category: 'Medications', label: 'Routine',
    entitlementFlags: [], hubspotProductAliases: ['ALIS eMAR', 'eMAR'], usageSignal: 'orderAdministration',
    mappingConfidence: 'ungated', notes: 'Core eMAR behavior once eMAR is purchased — not separately gated.',
  },
  {
    id: 'prns', category: 'Medications', label: 'PRNs',
    entitlementFlags: [], hubspotProductAliases: ['ALIS eMAR', 'eMAR'], usageSignal: 'orderAdministration',
    mappingConfidence: 'ungated', notes: 'Same as Routine.',
  },
  {
    id: 'pharmacyIntegration', category: 'Medications', label: 'Pharmacy integration',
    entitlementFlags: ['pharmacy_integration_entitlement_33'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'drugCount', category: 'Medications', label: 'Drug Count',
    entitlementFlags: ['drug_counting_entitlement_35', 'narcotic_controlled_drug_count_entitlement_27'],
    hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Two related flags — general + narcotics-specific.',
  },

  // ── Care ──────────────────────────────────────────────────────────────
  {
    id: 'residentEvaluationTool', category: 'Care', label: 'Resident Evaluation Tool',
    entitlementFlags: ['ret_forms_entitlement_100'],
    hubspotProductAliases: ['Resident Evaluation Tool', 'RET'], usageSignal: 'evaluations',
    mappingConfidence: 'ambiguous',
    notes: 'FLAG FOUND OFF for company 353 despite a paid RET line item on the Jan 2026 Lake Wellington deal — confirm ret_forms_entitlement is actually the RET gate before treating this as a real gap.',
  },
  {
    id: 'careTracking', category: 'Care', label: 'Care Tracking',
    entitlementFlags: ['resident_care_management_entitlement_10', 'care_tracking_sheet__inline_pdf_entitlement_81'],
    hubspotProductAliases: ['ALIS Care Tracking', 'Care Tracking'], usageSignal: 'recordedCare',
    mappingConfidence: 'confident', notes: 'Both related flags, matches HubSpot line item.',
  },
  {
    id: 'prnCare', category: 'Care', label: 'PRN care',
    entitlementFlags: [], hubspotProductAliases: ['ALIS Care Tracking', 'Care Tracking'], usageSignal: 'recordedCare',
    mappingConfidence: 'ungated', notes: 'Bundled into Care Tracking — no separate flag.',
  },

  // ── Staff ─────────────────────────────────────────────────────────────
  {
    id: 'staffCompliance', category: 'Staff', label: 'Staff Compliance',
    entitlementFlags: ['personnel_compliance_entitlement_3'], hubspotProductAliases: [], usageSignal: 'staffComplianceDetails',
    mappingConfidence: 'confident', notes: '"Personnel" = staff in ALIS\'s flag naming.',
  },

  // ── Billing ───────────────────────────────────────────────────────────
  {
    id: 'recurringCharges', category: 'Billing', label: 'Recurring Charges',
    entitlementFlags: ['billing_programs_entitlement_51'], hubspotProductAliases: [], usageSignal: 'billing',
    mappingConfidence: 'ambiguous', notes: '"Billing Programs" may mean rate plans generally, not recurring charges specifically.',
  },
  {
    id: 'incidentals', category: 'Billing', label: 'Incidentals',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'billing',
    mappingConfidence: 'ungated', notes: 'No dedicated flag found — likely bundled into Billing Center.',
  },
  {
    id: 'billingCenter', category: 'Billing', label: 'Billing Center',
    entitlementFlags: ['billing_center_entitlement_48'], hubspotProductAliases: [], usageSignal: 'billing',
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'achProcessing', category: 'Billing', label: 'ACH Processing',
    entitlementFlags: ['payment_gateway_entitlement_56'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ambiguous', notes: '"Payment Gateway" could mean card processing broadly, not ACH specifically.',
  },

  // ── Communities ───────────────────────────────────────────────────────
  {
    id: 'communityCompliance', category: 'Communities', label: 'Community Compliance',
    entitlementFlags: ['community_compliance_entitlement_22'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'inboundDocumentCenter', category: 'Communities', label: 'Inbound Document Center',
    entitlementFlags: ['document_center_entitlement_89'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Likely match; "inbound" qualifier not reflected in flag name.',
  },
  {
    id: 'floorPlanMarketRates', category: 'Communities', label: 'Floor Plan with Market rates (Rent Roll)',
    entitlementFlags: ['community_floor_plan_configuration_entitlement_25', 'rent_roll_v15_entitlement_83'],
    hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Floor plan + rent roll flags both present, matching the two-part feature name.',
  },
  {
    id: 'calendar', category: 'Communities', label: 'Calendar',
    entitlementFlags: ['calendar_entitlement_49'], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Exact name match.',
  },
  {
    id: 'logos', category: 'Communities', label: 'Logos',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ungated', notes: 'Cosmetic setting, likely always available.',
  },
  {
    id: 'alisHq', category: 'Communities', label: 'ALIS HQ',
    entitlementFlags: ['alis_hq__domo_entitlement_77'], hubspotProductAliases: ['ALIS HQ'], usageSignal: null,
    mappingConfidence: 'confident', notes: 'Matches HubSpot line item exactly.',
  },

  // ── Reports ───────────────────────────────────────────────────────────
  {
    id: 'dailyStandUp', category: 'Reports', label: 'Daily Stand-up',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: 'dailyStandUp',
    mappingConfidence: 'ungated', notes: 'No entitlement flag or export-API endpoint exists for this — usage signal comes from a live Playwright scrape of the community\'s own Daily Stand-Up report page (see server/automation/playwright/dailyStandUpPage.js), not the export API.',
  },
  {
    id: 'alerts', category: 'Reports', label: 'Alerts',
    entitlementFlags: [], hubspotProductAliases: [], usageSignal: null,
    mappingConfidence: 'ungated', notes: 'No matching flag found among the 131 captured.',
  },
];

const CATEGORIES = [...new Set(CATALOG.map((f) => f.category))];

/**
 * What each usageSignal key actually counts, and — critically — whether
 * that count is scoped to the audit's lookback window or reflects a
 * point-in-time/full-history snapshot instead. Several ALIS export
 * endpoints have no date filter at all (evaluations, staffComplianceDetails,
 * outstandingInvoices, residents), so "usage" for those features means
 * "on file right now," not "activity in the last N days" — conflating the
 * two would misstate what the number means on the exported report.
 * Keyed exactly by usageSignal in CATALOG above; surfaced in the job
 * summary (see usageAudit.js) so the Excel export's Explanation tab reads
 * this instead of hardcoding its own copy.
 */
const SIGNAL_DESCRIPTIONS = {
  billing: 'Count of billing records: active recurring charges and invoiced charges within the lookback window, plus all currently outstanding invoices (which are NOT date-limited — this reflects the current unpaid balance regardless of age).',
  orderAdministration: 'Count of medication administration records (doses given, refused, or held) within the lookback window.',
  recordedCare: 'Count of care-tracking / task-completion records within the lookback window.',
  evaluations: 'Count of resident evaluation records on file. NOT limited to the lookback window — this is the full evaluation history, since the ALIS export endpoint has no date filter.',
  staffComplianceDetails: 'Count of staff compliance/training item records on file. NOT limited to the lookback window — this is current compliance data, since the ALIS export endpoint has no date filter.',
  observations: 'Count of observation notes recorded, approximately within the lookback window (the endpoint pages newest-first and stops once past the window start).',
  residents: 'Count of current active residents on file — a point-in-time snapshot as of when the audit ran, not limited to the lookback window.',
  prospects: 'Count of prospect records created within the lookback window.',
  referralSourcesUsed: 'Count of prospect records created within the lookback window that have a referral source or referral organization actually populated (not just any prospect).',
  dailyStandUp: 'Count of resident rows shown on the community\'s live Daily Stand-Up report page as of when the audit ran (a live Playwright page-scrape, not an export API call — no export endpoint exists for this report). A point-in-time snapshot, not lookback-window-limited. Not yet confirmed against a community where this module is genuinely disabled — a 0 here could mean "no residents on today\'s stand-up" or "not licensed," and login failures for a host are recorded in dataWarnings rather than silently producing a 0.',
};

function getCatalog() {
  return CATALOG;
}

function getCategories() {
  return CATEGORIES;
}

function getSignalDescriptions() {
  return SIGNAL_DESCRIPTIONS;
}

module.exports = { getCatalog, getCategories, getSignalDescriptions };
