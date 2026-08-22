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

function alisApiGet(companyHost, path, params) {
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

// ── Export endpoints (paths confirmed against the live OpenAPI spec at
//    https://api.alisonline.com/specs/v1/openapi.json — Aug 2026) ──────────
// Every function takes `companyHost` first (e.g. "viva") to scope Basic Auth.

const getOccupancy = (companyHost, { communityId, monthAndYear } = {}) =>
  alisApiGet(companyHost, '/v1/export/communities/floorPlan/hqOccupancies', { communityId, monthAndYear });

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

const getRecordedCare = (companyHost, { communityId, careStartDate, careEndDate } = {}) =>
  alisApiGet(companyHost, '/v1/export/care/recordedCare', { communityId, careStartDate, careEndDate });

// Only v1 actually exists — the "use v2/v3 instead" deprecation note on v1
// doesn't correspond to any registered path in the spec. Capped to 3 months
// of history server-side (startDate/endDate default to the current month).
const getOrderAdministration = (companyHost, { communityId, startDate, endDate } = {}) =>
  alisApiGet(companyHost, '/v1/export/clinical/orderAdministration', { communityId, startDate, endDate });

// Integration (not Export) endpoint — communityId is a path segment, not a
// query param. `localCareDate` takes a single date, not a range; unclear
// yet whether omitting it returns "today" or everything (this looks like a
// live shift-view endpoint for 3rd-party care apps, not a historical
// reporting one — confirm with a real call before relying on it for a
// full-quarter pull).
const getScheduledCareTasks = (companyHost, { communityId, careListID, residentID, shiftID, localCareDate, roomNumber, taskStatus } = {}) =>
  alisApiGet(companyHost, `/v1/integration/care/${communityId}/scheduledCareTasks`, { careListID, residentID, shiftID, localCareDate, roomNumber, taskStatus });

module.exports = {
  alisApiGet,
  getOccupancy,
  getResidents,
  getMoveInsAndOuts,
  getHistoricalMoveInMoveOuts,
  getIncidents,
  getLeaves,
  getDiagnosesAndAllergies,
  getRecordedCare,
  getOrderAdministration,
  getScheduledCareTasks,
};
