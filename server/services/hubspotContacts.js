const https = require('https');
const { hubspotRecordUrl } = require('./hubspotTickets');

/**
 * Pulls each owned company's HubSpot Contacts along with whatever
 * Company<->Contact association LABEL(s) are tagged on each one — e.g.
 * "Billing Admin", "Account Owner", "Decision Maker" — for the Account
 * Health Dashboard's Key Contacts feature (Sep 2026). HubSpot's native
 * *labeled associations* feature is the mechanism (confirmed with Aaron,
 * not a contact property): a label lives on the link between one specific
 * Company and Contact, and a single association can carry more than one
 * label at once (e.g. one person tagged both "Billing Admin" and "Decision
 * Maker" at the same company).
 *
 * Reuses the same Bearer-auth-over-raw-https pattern as
 * hubspotAccounts.js/hubspotTickets.js — duplicated rather than shared,
 * matching this codebase's established per-file convention for this
 * small helper (see hubspotAccounts.js's own doc comment on the same
 * choice).
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hubspotRequestOnce(method, path, body) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return Promise.reject(new Error('HUBSPOT_PRIVATE_APP_TOKEN is not set in server/.env'));
  }

  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : {} });
        } catch {
          reject(new Error('Non-JSON response from HubSpot'));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`HubSpot ${path} timed out after 30s`)));
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Same 429 retry/backoff as hubspotAccounts.js's hubspotRequest — see that file's doc comment for the full story. */
async function hubspotRequest(method, path, body, attempt = 1) {
  const res = await hubspotRequestOnce(method, path, body);
  if (res.status === 429 && attempt < 5) {
    const retryAfterHeader = Number(res.headers?.['retry-after']);
    const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 1000 * 2 ** (attempt - 1);
    await sleep(delayMs);
    return hubspotRequest(method, path, body, attempt + 1);
  }
  return res;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Standard, always-present-on-a-real-portal Contact properties — fetched
// unconditionally, in their own batch/read call separate from the custom
// ones below.
const CORE_CONTACT_PROPERTIES = ['firstname', 'lastname', 'jobtitle', 'email', 'phone', 'mobilephone', 'notes_last_updated'];

// Portal-specific custom properties (Sep 2026, per Aaron): "Fun Facts" —
// internal name confirmed as `fun_facts` — and a free-text "Notes" field.
// Deliberately fetched in a SEPARATE batch/read call from
// CORE_CONTACT_PROPERTIES: an unrecognized/renamed property name here
// should only blank these two columns, not break every contact's core
// fields too (see getKeyContactsForCompany's try/catch around this call).
// If both columns come back empty across the whole portfolio after a real
// refresh, that's a signal one or both of these internal names is wrong —
// check HubSpot's Contact property settings and correct here.
const CUSTOM_CONTACT_PROPERTIES = ['fun_facts', 'notes'];

// Company<->Contact association-label DEFINITIONS (typeId -> display label,
// e.g. 123 -> "Billing Admin") are fetched live from HubSpot rather than
// hardcoded here — the exact label taxonomy is portal config Aaron
// maintains directly in HubSpot (Settings > Objects > Company >
// Associations), and a hardcoded list would silently drift the moment a
// label gets added, renamed, or retired there. Cached in-memory per
// process (labels essentially never change mid-session) — same caching
// shape as hubspotAccounts.js's ownerIdPromise.
let labelDefinitionsPromise = null;

async function getKeyContactLabelDefinitions() {
  if (!labelDefinitionsPromise) {
    labelDefinitionsPromise = (async () => {
      const { status, body } = await hubspotRequest('GET', '/crm/v4/associations/companies/contacts/labels');
      if (status !== 200) {
        throw new Error(`HubSpot company-contact association-labels lookup failed (${status}): ${JSON.stringify(body)}`);
      }
      const byTypeId = new Map();
      for (const l of body.results || []) {
        if (l.label && l.typeId !== DEFAULT_ASSOCIATION_TYPE_ID) byTypeId.set(l.typeId, l.label);
      }
      return byTypeId;
    })().catch((err) => {
      labelDefinitionsPromise = null; // don't cache a failure — retry next call
      throw err;
    });
  }
  return labelDefinitionsPromise;
}

/** Every defined Company<->Contact association label name, portfolio-wide — the authoritative "which key-contact roles exist" list for the missing-contact gap check, so that check never drifts from whatever's actually configured in HubSpot. */
async function listKeyContactLabelNames() {
  const byTypeId = await getKeyContactLabelDefinitions();
  return [...new Set(byTypeId.values())].sort();
}

async function getCompanyContactAssociations(companyId) {
  const results = [];
  let after;
  do {
    const { status, body } = await hubspotRequest(
      'GET',
      `/crm/v4/objects/companies/${companyId}/associations/contacts${after ? `?after=${encodeURIComponent(after)}` : ''}`
    );
    if (status !== 200) {
      throw new Error(`HubSpot company->contact associations lookup failed for company ${companyId} (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
    after = body.paging?.next?.after;
  } while (after);
  return results;
}

async function batchReadContacts(contactIds, properties) {
  const results = [];
  for (const idBatch of chunk(contactIds, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/contacts/batch/read', {
      inputs: idBatch.map((id) => ({ id })),
      properties,
    });
    if (status !== 200) {
      throw new Error(`HubSpot contacts batch-read failed (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
  }
  return results;
}

// HubSpot's own built-in Company<->Contact association (typeId 2,
// "Contact with Primary Company" — the reciprocal of "Primary" on the
// contact->company side) is inlined, with a real non-null label, on
// EVERY contact HubSpot considers linked to the company as its primary
// company (confirmed live, Sep 2026 — it's on literally every
// associated contact tested, regardless of whether anyone tagged them
// with anything). It's the underlying link itself, not a role someone
// deliberately tagged — Aaron's ask (Sep 2026) is Key Contacts should be
// ONLY people carrying one of the real custom tags (Billing Admin,
// Decision Maker, etc.), not every contact merely associated with the
// company. Excluded by typeId (stable, can't be renamed) rather than by
// matching the label string.
const DEFAULT_ASSOCIATION_TYPE_ID = 2;

/** typeId -> label, preferring the label HubSpot inlines directly on the association result over the cached schema lookup (only falls back to the schema map if a given result item omits it). Skips HubSpot's own default "Contact with Primary Company" association — see DEFAULT_ASSOCIATION_TYPE_ID above. */
function resolveLabels(associationTypes, labelDefsByTypeId) {
  const labels = [];
  for (const at of associationTypes || []) {
    if (at.typeId === DEFAULT_ASSOCIATION_TYPE_ID) continue;
    const label = at.label || labelDefsByTypeId.get(at.typeId);
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * One company's tagged Key Contacts — every associated Contact that carries
 * at least one Company<->Contact association label, with that label (or
 * labels — one contact can carry several) attached. Returns `[]` for a
 * company with contacts but none of them labeled, same as one with no
 * contacts at all; callers that need to tell those two apart should check
 * getCompanyContactAssociations's own length separately.
 */
async function getKeyContactsForCompany(companyId) {
  const [associations, labelDefsByTypeId] = await Promise.all([
    getCompanyContactAssociations(companyId),
    getKeyContactLabelDefinitions(),
  ]);

  const labeled = associations
    .map((a) => ({ ...a, labels: resolveLabels(a.associationTypes, labelDefsByTypeId) }))
    .filter((a) => a.labels.length > 0);
  if (labeled.length === 0) return [];

  // toObjectId comes back from the v4 associations endpoint as a JSON
  // number (confirmed live, Sep 2026), but batch/read's own `id` field on
  // each result comes back as a string — stringified here so the Map
  // lookups below (keyed by that string `id`) actually hit instead of
  // silently missing on every contact (Map.get uses strict equality, so
  // 87384099990 !== "87384099990") and falling back to `{}`, which is what
  // was rendering every Key Contact as "Unnamed contact" despite the data
  // being right there in HubSpot.
  const contactIds = labeled.map((a) => String(a.toObjectId));
  const [coreContacts, customContacts] = await Promise.all([
    batchReadContacts(contactIds, CORE_CONTACT_PROPERTIES),
    batchReadContacts(contactIds, CUSTOM_CONTACT_PROPERTIES).catch((err) => {
      console.warn(`[hubspotContacts] Custom contact properties (${CUSTOM_CONTACT_PROPERTIES.join(', ')}) failed to fetch — check these still exist in HubSpot's Contact property settings under those exact internal names. Continuing without Fun Facts/Notes for this company. (${err.message})`);
      return [];
    }),
  ]);
  const coreById = new Map(coreContacts.map((c) => [c.id, c.properties]));
  const customById = new Map(customContacts.map((c) => [c.id, c.properties]));

  return labeled.map((a) => {
    const core = coreById.get(String(a.toObjectId)) || {};
    const custom = customById.get(String(a.toObjectId)) || {};
    const name = [core.firstname, core.lastname].filter(Boolean).join(' ') || null;
    return {
      contactId: a.toObjectId,
      name,
      title: core.jobtitle || null,
      email: core.email || null,
      phone: core.phone || core.mobilephone || null,
      labels: a.labels,
      funFacts: custom.fun_facts || null,
      notes: custom.notes || null,
      lastActivityDate: core.notes_last_updated || null,
      hubspotUrl: hubspotRecordUrl('contact', a.toObjectId),
    };
  });
}

module.exports = { getKeyContactsForCompany, listKeyContactLabelNames };
