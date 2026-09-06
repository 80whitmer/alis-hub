const https = require('https');

/**
 * Resolves "my accounts" — the HubSpot companies where a given user is the
 * assigned owner — for the portfolio-wide Account Health Dashboard.
 * hubspotTickets.js already owns per-company ticket/deal detail; this file
 * is the one new piece that codebase was missing: nothing anywhere resolves
 * a HubSpot user to their owner ID or queries objects filtered by owner
 * (confirmed via a full-repo search before writing this).
 *
 * Reuses the same Bearer-auth-over-raw-https pattern as hubspotTickets.js's
 * hubspotRequest — duplicated rather than imported/shared, matching how that
 * same small helper is already independently re-implemented in
 * server/api/hubspot.js and scripts/deploy-to-hubspot.js in this codebase.
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

/**
 * Retries on HubSpot's 429 — see hubspotTickets.js's identical helper for
 * the full story (a 371-company portfolio refresh hit
 * ten_secondly_rolling rate limiting hard on first real-world use).
 * Honors `Retry-After` when present, otherwise backs off 1s/2s/4s/8s;
 * gives up after 5 attempts.
 */
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

const COMPANY_PROPERTIES = ['name', 'hubspot_owner_id', 'lifecyclestage', 'createdate', 'arr'];

// Owner ID essentially never changes for a running process — cached in
// memory (not the DB) rather than re-resolved on every refresh.
let ownerIdPromise = null;

/**
 * Resolves the HubSpot owner ID to filter "my accounts" by.
 *
 * Prefers HUBSPOT_OWNER_ID (a direct override, no API call, no scope
 * needed) over the /crm/v3/owners email lookup — confirmed live (Sep
 * 2026) that this portal's private app token does NOT have the
 * crm.objects.owners.read scope the owners endpoint requires (403
 * MISSING_SCOPES), while company search filtered by hubspot_owner_id
 * works fine with the scopes already granted. Add HUBSPOT_OWNER_ID to
 * server/.env once you know it (visible in this portal's Settings > Users
 * & Teams, or on any company record you own by checking the "Company
 * owner" field's value in the page source/API) to skip the owners lookup
 * entirely; otherwise grant crm.objects.owners.read to the private app
 * (Settings > Integrations > Private Apps > this app > Scopes) and this
 * falls back to resolving it by email automatically.
 */
async function getOwnerId() {
  if (process.env.HUBSPOT_OWNER_ID) return process.env.HUBSPOT_OWNER_ID;

  if (!ownerIdPromise) {
    ownerIdPromise = (async () => {
      const email = process.env.HUBSPOT_OWNER_EMAIL || 'aaron@go-alis.com';
      const { status, body } = await hubspotRequest('GET', `/crm/v3/owners?email=${encodeURIComponent(email)}`);
      if (status !== 200) {
        throw new Error(
          `HubSpot owner lookup failed (${status}): ${JSON.stringify(body)} — ` +
          'either grant this private app the crm.objects.owners.read scope, or set HUBSPOT_OWNER_ID directly in server/.env to skip this lookup.'
        );
      }
      const owner = (body.results || [])[0];
      if (!owner) {
        throw new Error(`No HubSpot owner found for email "${email}" — check HUBSPOT_OWNER_EMAIL.`);
      }
      return owner.id;
    })().catch((err) => {
      ownerIdPromise = null; // don't cache a failure — retry next call
      throw err;
    });
  }
  return ownerIdPromise;
}

/**
 * Every company with hubspot_owner_id = ownerId — "my accounts" for the
 * portfolio dashboard. Paginated the same cursor-`after` way as
 * hubspotTickets.js's association lookups, since a full portfolio can
 * exceed one page (HubSpot search defaults to 10, capped at 100 per page).
 */
async function getOwnedCompanies(ownerId) {
  const companies = [];
  let after;
  do {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId }] }],
      properties: COMPANY_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (status !== 200) {
      throw new Error(`HubSpot owned-companies search failed (${status}): ${JSON.stringify(body)}`);
    }
    companies.push(...(body.results || []).map((c) => ({
      id: c.id,
      name: c.properties.name,
      lifecycleStage: c.properties.lifecyclestage || null,
      createdAt: c.properties.createdate || null,
      // Confirmed live against a real company (Viva Senior Living, "arr":
      // "410082.00") — HubSpot's own company-level ARR figure, not
      // something computed here from deals; deliberately not derived from
      // deal line items, which would need a far heavier historical pull
      // across the whole portfolio for the same number.
      arrCents: c.properties.arr != null ? Math.round(Number(c.properties.arr) * 100) : null,
    })));
    after = body.paging?.next?.after;
  } while (after);
  return companies;
}

module.exports = { getOwnerId, getOwnedCompanies };
