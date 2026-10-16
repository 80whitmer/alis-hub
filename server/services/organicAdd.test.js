const test = require('node:test');
const assert = require('node:assert');
const { validateOrganicAddPayload } = require('./organicAdd');

function good() {
  return {
    schema_version: 1,
    form_url: 'https://medtelligent.atlassian.net/jira/core/projects/ODM/form/432',
    companyUrl: 'thecottages.alisonline.com',
    community: { name: 'Test Place', crm_id: '555', licensed_capacity: '50', physical_capacity: '48', street: '1 Main', city: 'Provo', state: 'UT', zip: '84601' },
    fields: {
      summary: 'Organic Add - Test Place',
      project_request: 'Organic Add Onboarding',
      what_is_needed: { intent: 'data + training', value: ['Data Import', 'Training'] },
      acquisition_or_new_building: 'New building',
      desired_go_live_date: '2026-12-01',
      current_ehr: 'PCC',
      pharmacy_contact_info: 'TBD',
      assessment_info: { intent: 'new RET?', value: null },
      client_community_contact: 'Pat Doe',
      organic_add_details_md: '## Details\n- **bold**',
      copy_settings_from: 'Other Place',
      settings_configuration_needed: { intent: 'billing', value: 'Billing Settings' },
      requested_completion_date: '2026-11-15',
      description_md: 'desc',
    },
    flags: ['check capacity'],
    unresolved: [],
  };
}

test('accepts a good payload and surfaces null dropdowns as needing a pick', () => {
  const r = validateOrganicAddPayload(good());
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.review.dropdowns.assessment_info.needsPick, true);
  assert.equal(r.review.dropdowns.what_is_needed.needsPick, false);
});

test('rejects malformed JSON, bad version, missing keys', () => {
  assert.equal(validateOrganicAddPayload('{nope').ok, false);
  const v = good(); v.schema_version = 2;
  assert.equal(validateOrganicAddPayload(v).ok, false);
  const m = good(); delete m.flags;
  assert.match(validateOrganicAddPayload(m).errors[0], /Missing key: flags/);
});

test('companyUrl: real value is format-checked; missing or [ID NEEDED] needs a human entry', () => {
  const a = good(); a.companyUrl = '[ID NEEDED]';
  const ra = validateOrganicAddPayload(a);
  assert.equal(ra.ok, true);
  assert.equal(ra.review.formFields[1].needsUrl, true);
  const b = good(); delete b.companyUrl;
  assert.equal(validateOrganicAddPayload(b).review.formFields[1].needsUrl, true);
  for (const bad of ['https://admin.alisonline.com/Customers/Companies/12', 'viva.example.com', 'admin.alisonline.com', 'viva.alisonline.com/foo']) {
    const c = good(); c.companyUrl = bad;
    assert.equal(validateOrganicAddPayload(c).ok, false, bad);
  }
  for (const okUrl of ['viva.alisonline.com', 'https://thecottages.alisonline.com', 'thecottages.alisonline.com/']) {
    const d = good(); d.companyUrl = okUrl;
    const r = validateOrganicAddPayload(d);
    assert.equal(r.ok, true, okUrl);
    assert.equal(r.review.formFields[1].needsUrl, false);
  }
});

test('date rules: real dates, non-null completion, completion <= go-live', () => {
  const a = good(); a.fields.desired_go_live_date = '2026-02-30';
  assert.equal(validateOrganicAddPayload(a).ok, false);
  const b = good(); b.fields.requested_completion_date = null;
  const rb = validateOrganicAddPayload(b);
  assert.equal(rb.ok, true);
  assert.equal(rb.review.formFields.find((x) => x.needsDate).label, 'Requested Completion Date');
  const c = good(); c.fields.requested_completion_date = '2026-12-02';
  assert.match(validateOrganicAddPayload(c).errors.join(), /later than/);
});

test('dropdown values must match options exactly (no fuzzy), single-select enforced', () => {
  const a = good(); a.fields.settings_configuration_needed.value = 'billing settings';
  assert.equal(validateOrganicAddPayload(a).ok, false);
  const b = good(); b.fields.assessment_info.value = ['New RET build', 'N/A'];
  assert.equal(validateOrganicAddPayload(b).ok, false);
});
