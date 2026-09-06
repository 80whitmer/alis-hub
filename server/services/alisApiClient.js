const https = require('https');

/**
 * Thin Basic-Auth client for the ALIS export API (api.alisonline.com).
 * Mirrors the raw-`https` style already used in server/api/hubspot.js rather
 * than pulling in a new HTTP dependency.
 *
 * Auth is per-company, not a single static credential: the Basic Auth
 * username is `<ALIS_EXPORT_API_USERNAME_BASE>@<companyHost>` (e.g.
 * "aaron.whitmer@viva" for Viva Senior Living, whose ALIS admin subdomain
 * is viva.alisonline.com) — the same local username across every company,
 * just re-scoped by the host suffix. The password is the existing
 * ALIS_PASSWORD (the same login used for Playwright automation) — there is
 * no separate export-API password.
 */

const HOST = 'api.alisonline.com';

function authHeader(companyHost) {
  if (!companyHost) {
    throw new Error('companyHost is required to build ALIS export API Basic Auth (e.g. "viva" for viva.alisonline.com)');
  }
  const usernameBase = process.env.ALIS_EXPORT_API_USERNAME_BASE;
  const pass = process.env.ALIS_PASSWORD;
  if (!usernameBase || !pass) {
    throw new Error('ALIS_EXPORT_API_USERNAME_BASE / ALIS_PASSWORD are not set in server/.env');
  }
  const user = `${usernameBase}@${companyHost}`;
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function buildQuery(params = {}) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

const REQUEST_TIMEOUT_MS = 90000;

function alisApiGetOnce(companyHost, path, params) {
  const query = buildQuery(params);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      path: path + query,
      method: 'GET',
      headers: {
        Authorization: authHeader(companyHost),
        Accept: 'application/json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`ALIS API ${path} returned ${res.statusCode}: ${raw.slice(0, 500)}`));
        }
        try {
          resolve(raw ? JSON.parse(raw) : null);
        } catch {
          reject(new Error(`Non-JSON response from ALIS API ${path}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`ALIS API ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
    req.end();
  });
}

// A handful of ALIS export endpoints (moveInsAndOuts, diagnosesAndAllergies
// in particular — both account-wide, full-history, no query params at all)
// have been observed returning a bare 500 "Unknown error <n>" with no
// further detail. A 401/4xx is a request problem (bad auth, bad path) that
// will fail identically every time — only a 5xx is worth retrying, since
// that's the class of error a transient server hiccup would produce.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function alisApiGet(companyHost, path, params) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await alisApiGetOnce(companyHost, path, params);
    } catch (err) {
      lastErr = err;
      const status = Number(err.message.match(/returned (\d+)/)?.[1]);
      if (!(status >= 500) || attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

// ── Export endpoints (paths confirmed against the live OpenAPI spec at
//    https://api.alisonline.com/specs/v1/openapi.json — Aug 2026) ──────────
// Every function takes `companyHost` first (e.g. "viva") to scope Basic Auth.

// v2 — v1 is deprecated by ALIS in favor of this one. Confirmed live (Aug
// 2026) that the two return identical per-row data for the same
// community/month; the only real difference is v2 is paginated ({ items,
// pageNumber, pageSize, totalPages, hasNextPage, ... }) where v1 was a bare
// array. PAGE_SIZE large enough that a single community-month fits on one
// page in practice (confirmed: ~3k rows/month, one page at 5000) — still
// loops on hasNextPage so an unusually large community doesn't silently
// truncate. MAX_PAGES is a safety cap, not an expected real limit.
async function getOccupancy(companyHost, { communityId, monthAndYear } = {}) {
  const PAGE_SIZE = 5000;
  const MAX_PAGES = 20;
  const items = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const page = await alisApiGet(companyHost, '/v2/export/communities/floorPlan/hqOccupancies', { communityId, monthAndYear, pageNumber, pageSize: PAGE_SIZE });
    items.push(...(page?.items || []));
    if (!page?.hasNextPage) break;
  }
  return items;
}

const getCommunities = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/communities');

const getStaff = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/staff');

const getResidents = (companyHost, { status = 'CurrentResident' } = {}) =>
  alisApiGet(companyHost, '/v1/export/residents', { status });

const getMoveInsAndOuts = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/residents/moveInsAndOuts');

const getHistoricalMoveInMoveOuts = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/residents/historicalMoveInMoveOuts');

const getIncidents = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/residents/incidents');

const getLeaves = (companyHost, { status = 'CurrentResident' } = {}) =>
  alisApiGet(companyHost, '/v1/export/residents/leaves', { status });

const getDiagnosesAndAllergies = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/clinical/diagnosesAndAllergies');

// One row per evaluation (not just the most recent) — isMostCurrent flags
// which row is each resident's active evaluation. isExpired/isCompleted/
// isInProgress are ALIS-computed, not something we need to derive from dates.
const getEvaluations = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/residents/evaluations');

// One row per active recurring charge line (rent, care level fee, add-ons,
// etc.) — unlike most export endpoints, this one actually supports
// server-side date filtering (serviceStartDate/serviceEndDate), so callers
// should scope it to the reporting period directly rather than pulling
// full history and filtering client-side.
const getRecurringCharges = (companyHost, { residentStatus = 'CurrentResident', chargeStatus = 'Active', serviceStartDate, serviceEndDate } = {}) =>
  alisApiGet(companyHost, '/v1/export/billing/recurringCharges', { residentStatus, chargeStatus, serviceStartDate, serviceEndDate });

// v2 — real invoiceStartDate/invoiceEndDate range filtering (unlike most
// v1 billing endpoints), flat array response (not paginated like
// getOutstandingInvoices). Actual billed invoice line items for the
// period, not the active-schedule run-rate getRecurringCharges provides.
const getInvoiceCharges = (companyHost, { invoiceStartDate, invoiceEndDate } = {}) =>
  alisApiGet(companyHost, '/v2/export/billing/invoiceCharges', { invoiceStartDate, invoiceEndDate });

// Paginated ({ items, pageNumber, pageSize, totalPages, hasNextPage, ... })
// unlike every other export endpoint here — this wrapper pages through
// automatically and returns a flat array so callers don't need to know
// about paging. MAX_PAGES is a safety cap (20 * 5000 = 100k invoices),
// not an expected real limit.
async function getOutstandingInvoices(companyHost, { communityId } = {}) {
  const PAGE_SIZE = 5000;
  const MAX_PAGES = 20;
  const items = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const page = await alisApiGet(companyHost, '/v1/export/billing/outstandingInvoices', { communityId, pageNumber, pageSize: PAGE_SIZE });
    items.push(...(page?.items || []));
    if (!page?.hasNextPage) break;
  }
  return items;
}

const getRecordedCare = (companyHost, { communityId, careStartDate, careEndDate } = {}) =>
  alisApiGet(companyHost, '/v1/export/care/recordedCare', { communityId, careStartDate, careEndDate });

// Paginated ({ items, pageNumber, pageSize, totalPages, hasNextPage, ... }).
// includeExpired defaults true on ALIS's side; passed through explicitly so
// callers can request only currently-incomplete/expired items if they want.
// Confirmed live (Aug 2026): populated at some clients (named training
// items with a completion status), entirely empty (zero rows) at others —
// that's a real module-adoption gap, not a pagination bug, so callers
// should not treat 0 rows as an error.
async function getStaffComplianceDetails(companyHost, { staffStatus, includeExpired, expiresOnStartDate, expiresOnEndDate } = {}) {
  const PAGE_SIZE = 2000;
  const MAX_PAGES = 20;
  const items = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const page = await alisApiGet(companyHost, '/v1/export/staff/complianceDetails', { pageNumber, pageSize: PAGE_SIZE, staffStatus, includeExpired, expiresOnStartDate, expiresOnEndDate });
    items.push(...(page?.items || []));
    if (!page?.hasNextPage) break;
  }
  return items;
}

// v2 — paginated, account-wide, NO communityId/date-range query param at
// all (confirmed live — high volume too: 27k+ rows for a 6-community
// account, growing every shift). Confirmed live (Aug 2026) it's returned
// newest-first by occurredOn, so `stopBeforeDate` pages forward only until
// a page's rows have all aged past that cutoff, instead of pulling the
// entire historical log on every weekly run — a real account-wide pull
// here would be tens of thousands of rows per call, most of it irrelevant
// to a 7-day window. observationType is a real, mostly-structured enum at
// ISL ("Daily Log Note", "Nurse's Note", "Change of Condition"/"Change in
// Conditions" — two spellings of the same concept coexist in real data),
// not the freeform field the OpenAPI spec's lack of an enum list implied.
async function getObservations(companyHost, { stopBeforeDate } = {}) {
  const PAGE_SIZE = 2000;
  const MAX_PAGES = 30;
  const cutoff = stopBeforeDate ? new Date(stopBeforeDate).getTime() : null;
  const items = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const page = await alisApiGet(companyHost, '/v2/export/residents/observations', { pageNumber, pageSize: PAGE_SIZE });
    const rows = page?.items || [];
    items.push(...rows);
    const oldestOnPage = rows.reduce((min, r) => {
      const t = new Date(r.occurredOn).getTime();
      return Number.isNaN(t) ? min : Math.min(min, t);
    }, Infinity);
    if (!page?.hasNextPage) break;
    if (cutoff != null && oldestOnPage < cutoff) break;
  }
  return items;
}

// v3 — the earlier "only v1 exists" note here was wrong: it was checked
// against /specs/v1/openapi.json, which is scoped to v1 paths and could
// never have surfaced v2/v3. v1's own deprecation notice points at v2/v3;
// confirmed live (Aug 2026) that v3 accepts the same params and returns the
// same shape. Capped to 3 months of history server-side (startDate/endDate
// default to the current month) — confirmed a real past 3-month range
// still returns data, so the cap isn't strictly "must be the current month."
const getOrderAdministration = (companyHost, { communityId, startDate, endDate } = {}) =>
  alisApiGet(companyHost, '/v3/export/clinical/orderAdministration', { communityId, startDate, endDate });

// Integration (not Export) endpoint — communityId is a path segment, not a
// query param. `localCareDate` takes a single date, not a range; unclear
// yet whether omitting it returns "today" or everything (this looks like a
// live shift-view endpoint for 3rd-party care apps, not a historical
// reporting one — confirm with a real call before relying on it for a
// full-quarter pull).
const getScheduledCareTasks = (companyHost, { communityId, careListID, residentID, shiftID, localCareDate, roomNumber, taskStatus } = {}) =>
  alisApiGet(companyHost, `/v1/integration/care/${communityId}/scheduledCareTasks`, { careListID, residentID, shiftID, localCareDate, roomNumber, taskStatus });

// v2 — "[STREAMING]" per the OpenAPI spec, meaning the server sends the
// response as a chunked-transfer JSON array rather than buffering it fully
// before the first byte — Node's https client already de-chunks
// transfer-encoding transparently, so this needs no special handling beyond
// the same accumulate-then-JSON.parse alisApiGet already does. createdAt
// date range is capped at 3 months per call (confirmed in the spec, same
// class of constraint as orderAdministration/invoiceCharges) — callers
// pulling more than 3 months should chunk by month themselves.
const getProspects = (companyHost, { communityId, createdAtStartDate, createdAtEndDate, inquiryStartDate, inquiryEndDate } = {}) =>
  alisApiGet(companyHost, '/v2/export/prospects', { communityId, createdAtStartDate, createdAtEndDate, inquiryStartDate, inquiryEndDate });

// Integration (not Export) endpoint — confirmed live (Sep 2026) that our
// existing export Basic-Auth creds authenticate against it fine (no separate
// per-community Integration app credential needed, unlike the ALIS App
// Store-issued creds a 3rd-party integration would use). Unlike
// getIncidents() (v1 export, deprecated, account-wide, no staff attribution),
// this is per-community + date-range scoped but returns residentFirstName/
// residentLastName split, staffId/staffFirstName/staffLastName (who filed
// it — not available anywhere in the export API), and both the ID and label
// for incidentType/incidentLocation. Paginated ({ items, pageNumber, pageSize,
// totalPages, hasNextPage, ... }) same shape as the v2 export endpoints.
async function getIncidentsV2(companyHost, { communityId, startDate, endDate } = {}) {
  const PAGE_SIZE = 500;
  const MAX_PAGES = 20;
  const items = [];
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const page = await alisApiGet(companyHost, '/v2/integration/incidents', { CommunityId: communityId, StartDate: startDate, EndDate: endDate, PageNumber: pageNumber, PageSize: PAGE_SIZE });
    items.push(...(page?.items || []));
    if (!page?.hasNextPage) break;
  }
  return items;
}

// Unwired Export endpoint — per-incident structured form data (vitals,
// hospital-transfer flag, physician/emergency-contact notification detail).
// Confirmed live (Sep 2026): returns `[]` until the incident's form is
// actually completed (an incident with only incompleteForms returns empty —
// not an error), and field keys are namespaced per form template
// (`generic.incident_reporting_form.*` confirmed live; other communities may
// use a different template with different keys) rather than a fixed schema
// — callers should read fields defensively, not assume a key exists.
const getIncidentFormData = (companyHost, incidentId) =>
  alisApiGet(companyHost, `/v1/export/residents/incidents/${incidentId}/formData`);

// Unwired Export endpoint — the RET (Resident Evaluation Tool) question/answer
// catalog, keyed by evaluationConfigurationId. `evaluationConfigurationXml`
// carries each question's `IncludeInPoints` flag and each answer's
// `CarePoints` value (confirmed live, Sep 2026: e.g. CarePoints="5"..."90") —
// this is ALIS's own acuity-scoring weight per answer choice, and the only
// place it exists; retXml (from getEvaluationXmlDocuments below) carries just
// the resident's chosen Answer Ids, no point values. See
// server/services/evaluationScoring.js for the join that turns the two into
// a per-resident CarePoints total. No query params — small, account-wide
// (7 configs observed at one client), safe to pull in full every time.
const getEvaluationConfigurations = (companyHost) =>
  alisApiGet(companyHost, '/v1/export/clinical/evaluationConfiguration');

// Unwired Export endpoint — the resident-side half of the CarePoints join
// (see getEvaluationConfigurations above). retXml is
// `<Evaluation><Domain><Question Id><Answer Id/><Notes>...</Notes></Question>`
// — Question/Answer Ids only, no point values or question/answer text of its
// own. `sinceEvaluationDate` lets callers incrementally pull only new/changed
// evaluations instead of full history every time.
const getEvaluationXmlDocuments = (companyHost, { status, sinceEvaluationDate } = {}) =>
  alisApiGet(companyHost, '/v1/export/residents/evaluations/xmlDocuments', { status, sinceEvaluationDate });

module.exports = {
  alisApiGet,
  getOccupancy,
  getCommunities,
  getStaff,
  getResidents,
  getMoveInsAndOuts,
  getHistoricalMoveInMoveOuts,
  getIncidents,
  getLeaves,
  getDiagnosesAndAllergies,
  getEvaluations,
  getRecurringCharges,
  getInvoiceCharges,
  getOutstandingInvoices,
  getRecordedCare,
  getOrderAdministration,
  getScheduledCareTasks,
  getStaffComplianceDetails,
  getObservations,
  getProspects,
  getIncidentsV2,
  getIncidentFormData,
  getEvaluationConfigurations,
  getEvaluationXmlDocuments,
};
