const options = require('../config/organicAddOptions.json');

/**
 * Validates and shapes the JSON payload produced by the "/organic-add" skill
 * (schema_version 1) for the ODM "Organic Add Onboarding" Jira form. Pure —
 * no Jira calls; the hub never submits the form, it shows a review screen
 * and hands the values to the user to paste/submit (see api/organicAdd.js).
 *
 * Dropdown values are matched EXACTLY against the live form options (never
 * fuzzy). A null dropdown value means a human has to choose — the review
 * carries the real option list so the UI can offer the picker.
 */
const COMPANY_URL_RE = /^https:\/\/admin\.alisonline\.com\/Customers\/Companies\/\d+$/;

const REQUIRED_TOP = ['schema_version', 'form_url', 'companyUrl', 'community', 'fields', 'flags', 'unresolved'];
const REQUIRED_COMMUNITY = ['name', 'crm_id', 'licensed_capacity', 'physical_capacity', 'street', 'city', 'state', 'zip'];
const STRING_FIELDS = [
  'summary', 'project_request', 'acquisition_or_new_building', 'current_ehr', 'pharmacy_contact_info',
  'client_community_contact', 'organic_add_details_md', 'copy_settings_from', 'description_md',
];
const DATE_FIELDS = ['desired_go_live_date', 'requested_completion_date'];
const DROPDOWN_FIELDS = {
  what_is_needed: options.whatIsNeeded,
  assessment_info: options.assessmentInfo,
  settings_configuration_needed: options.settingsConfigurationNeeded,
};

function isRealIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toArray(v) {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/**
 * @param {string|object} input raw JSON text or an already-parsed object
 * @returns {{ ok: boolean, errors: string[], review: object|null }}
 *   ok = payload is structurally valid (it may still have unresolved items
 *   or null dropdowns — those are in `review`, and gate the open-form step
 *   in the UI rather than failing validation).
 */
function validateOrganicAddPayload(input) {
  const errors = [];
  let p = input;
  if (typeof input === 'string') {
    try { p = JSON.parse(input); } catch (err) { return { ok: false, errors: [`Malformed JSON: ${err.message}`], review: null }; }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['Payload must be a JSON object'], review: null };

  if (p.schema_version !== 1) errors.push(`Unsupported schema_version ${JSON.stringify(p.schema_version)} (expected 1)`);
  for (const k of REQUIRED_TOP) if (!(k in p)) errors.push(`Missing key: ${k}`);
  if (errors.length) return { ok: false, errors, review: null };

  if (typeof p.companyUrl !== 'string' || !COMPANY_URL_RE.test(p.companyUrl)) {
    errors.push(`companyUrl must match https://admin.alisonline.com/Customers/Companies/<digits> (got ${JSON.stringify(p.companyUrl)})`);
  }
  if (!p.community || typeof p.community !== 'object') errors.push('community must be an object');
  else for (const k of REQUIRED_COMMUNITY) {
    if (typeof p.community[k] !== 'string') errors.push(`community.${k} must be a string`);
  }
  if (!p.fields || typeof p.fields !== 'object') errors.push('fields must be an object');
  if (!Array.isArray(p.flags)) errors.push('flags must be an array');
  if (!Array.isArray(p.unresolved)) errors.push('unresolved must be an array');
  if (errors.length) return { ok: false, errors, review: null };

  const f = p.fields;
  for (const k of STRING_FIELDS) if (typeof f[k] !== 'string') errors.push(`fields.${k} must be a string`);
  if (f.project_request !== 'Organic Add Onboarding') errors.push('fields.project_request must be "Organic Add Onboarding"');
  for (const k of DATE_FIELDS) {
    if (f[k] == null) errors.push(`fields.${k} is required (got null)`);
    else if (!isRealIsoDate(f[k])) errors.push(`fields.${k} is not a real YYYY-MM-DD date (got ${JSON.stringify(f[k])})`);
  }
  if (isRealIsoDate(f.desired_go_live_date) && isRealIsoDate(f.requested_completion_date)
      && f.requested_completion_date > f.desired_go_live_date) {
    errors.push('fields.requested_completion_date must not be later than desired_go_live_date');
  }

  const dropdowns = {};
  for (const [key, cfg] of Object.entries(DROPDOWN_FIELDS)) {
    const d = f[key];
    if (!d || typeof d !== 'object' || typeof d.intent !== 'string' || !('value' in d)) {
      errors.push(`fields.${key} must be {intent: string, value: string|null}`);
      continue;
    }
    const chosen = toArray(d.value);
    if (d.value != null && !chosen.every((v) => typeof v === 'string')) {
      errors.push(`fields.${key}.value must be a string, an array of strings, or null`);
      continue;
    }
    if (chosen.length > 1 && cfg.multiSelect === false) errors.push(`fields.${key} allows only one option (got ${chosen.length})`);
    for (const bad of chosen.filter((v) => !cfg.options.includes(v))) {
      errors.push(`fields.${key}: "${bad}" is not an option on the form (${cfg.options.join(', ')})`);
    }
    dropdowns[key] = {
      intent: d.intent,
      value: d.value == null ? null : chosen,
      needsPick: chosen.length === 0,
      options: cfg.options,
      multiSelect: cfg.multiSelect,
    };
  }
  if (errors.length) return { ok: false, errors, review: null };

  return {
    ok: true,
    errors: [],
    review: {
      formUrl: options.formUrl,
      payloadFormUrl: p.form_url,
      community: p.community,
      // Order matches the form top to bottom.
      formFields: [
        { label: 'Summary', value: f.summary, kind: 'text' },
        { label: 'ALIS Company URL', value: p.companyUrl, kind: 'text' },
        { label: 'Project Request', value: f.project_request, kind: 'dropdown' },
        { label: 'What is Needed?', dropdownKey: 'what_is_needed', kind: 'dropdown' },
        { label: 'Acquisition or new building?', value: f.acquisition_or_new_building, kind: 'text' },
        { label: 'Desired Go-Live Date', value: f.desired_go_live_date, kind: 'date' },
        { label: 'Current eHR', value: f.current_ehr, kind: 'text' },
        { label: 'Pharmacy Contact Info', value: f.pharmacy_contact_info, kind: 'text' },
        { label: 'Assessment Info', dropdownKey: 'assessment_info', kind: 'dropdown' },
        { label: 'Client/Community Contact', value: f.client_community_contact, kind: 'text' },
        { label: 'Organic Add Details', value: f.organic_add_details_md, kind: 'markdown' },
        { label: 'Which community should we copy settings FROM?', value: f.copy_settings_from, kind: 'text' },
        { label: 'Settings Configuration Needed', dropdownKey: 'settings_configuration_needed', kind: 'dropdown' },
        { label: 'Requested Completion Date', value: f.requested_completion_date, kind: 'date' },
        { label: 'Assignee', value: 'Unassigned — leave as-is (PM team assigns)', kind: 'note' },
        { label: 'Description', value: f.description_md, kind: 'markdown' },
      ],
      dropdowns,
      flags: p.flags,
      unresolved: p.unresolved,
    },
  };
}

module.exports = { validateOrganicAddPayload, isRealIsoDate, COMPANY_URL_RE };
