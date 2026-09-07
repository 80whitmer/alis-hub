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

const COMPANY_PROPERTIES = ['name', 'account_manager', 'hs_num_child_companies', 'lifecyclestage', 'createdate', 'arr'];

/** Splits `arr` into chunks of at most `size` items — HubSpot's search endpoint's IN-filter is fine with 109 values in one call today, but this keeps a much bigger future portfolio from silently exceeding it. */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Confirmed live (Sep 2026) via get_properties on COMPANY.lifecyclestage:
// stored value "50833003" carries this portal's custom "Canceled " label
// (trailing space and all, exactly as stored) — the stage an individual
// community moves to once it stops using ALIS.
const CANCELED_LIFECYCLE_STAGE = '50833003';

// Owner ID essentially never changes for a running process — cached in
// memory (not the DB) rather than re-resolved on every refresh.
let ownerIdPromise = null;

/**
 * Resolves the HubSpot owner ID used to filter "my accounts" — specifically
 * against the `account_manager` company property (see getOwnedCompanies),
 * a dedicated enumeration field whose option VALUES are HubSpot owner IDs
 * (confirmed live: option "280699315" is labeled "Aaron Whitmer", matching
 * his real owner ID exactly) but which is a genuinely DIFFERENT assignment
 * from the generic `hubspot_owner_id` — confirmed live on a real company
 * ("Oakwood Senior Living Home Office"): hubspot_owner_id was Aaron, but
 * account_manager was a different person (Patrick Noack) entirely. Only
 * account_manager reflects "assigned to me as account manager"; this
 * resolver still just answers "what is Aaron's owner ID", the same ID
 * plugged into a different property by the caller.
 *
 * Prefers HUBSPOT_OWNER_ID (a direct override, no API call, no scope
 * needed) over the /crm/v3/owners email lookup — confirmed live (Sep
 * 2026) that this portal's private app token does NOT have the
 * crm.objects.owners.read scope the owners endpoint requires (403
 * MISSING_SCOPES), while company search filtered this way works fine
 * with the scopes already granted. Add HUBSPOT_OWNER_ID to server/.env
 * once you know it (visible in this portal's Settings > Users & Teams, or
 * on any company record via the "Account Manager"/"Company owner" field's
 * value in the page source/API) to skip the owners lookup entirely;
 * otherwise grant crm.objects.owners.read to the private app (Settings >
 * Integrations > Private Apps > this app > Scopes) and this falls back to
 * resolving it by email automatically.
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
 * Every "Home Office" company assigned to `ownerId` as its account_manager
 * — "my accounts" for the portfolio dashboard, scoped exactly the way
 * Aaron asked: Home Office (parent) companies only, not their individual
 * communities, and matched on the dedicated account_manager field, not
 * the generic hubspot_owner_id (see getOwnerId's doc comment for why
 * those two differ in practice).
 *
 * "Home Office" isn't its own property anywhere in this portal (checked:
 * community_type's options are Assisted Living/Memory Care/Independent
 * Living/Skilled Nursing/Home Health/Other, no "Home Office" value) — it's
 * HubSpot's native company-hierarchy concept instead. Confirmed live: a
 * "Home Office" company (e.g. "Oakwood Senior Living Home Office") has
 * hs_num_child_companies > 0 and no hs_parent_company_id, while its
 * individual communities (e.g. plain "Oakwood Senior Living") have the
 * reverse — hs_parent_company_id set, hs_num_child_companies = 0.
 * Filtering on hs_num_child_companies > 0 is therefore the real signal,
 * not a name match on "Home Office" (confirmed live via a portal-wide
 * count: 673 total companies carry Aaron's account_manager id, of which
 * 109 are actual Home Office parents — a meaningfully different, smaller,
 * and more accurate "my accounts" set than either the 371 the earlier
 * hubspot_owner_id-based version returned, or all 673 including every
 * individual community).
 *
 * Paginated the same cursor-`after` way as hubspotTickets.js's association
 * lookups, since a full portfolio can exceed one page (HubSpot search
 * defaults to 10, capped at 100 per page).
 *
 * Returns `{ companies, excludedInactiveCommunities }` — see
 * filterHomeOfficesWithActiveCommunity below for the second filtering pass
 * this return value now also reflects (Home Offices with zero remaining
 * active communities are dropped from `companies` and listed there instead).
 */
async function getOwnedCompanies(ownerId) {
  const companies = [];
  let after;
  do {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'account_manager', operator: 'EQ', value: ownerId },
          { propertyName: 'hs_num_child_companies', operator: 'GT', value: '0' },
        ],
      }],
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
      childCompanyCount: c.properties.hs_num_child_companies != null ? Number(c.properties.hs_num_child_companies) : null,
      // Confirmed live against a real company (Viva Senior Living, "arr":
      // "410082.00") — HubSpot's own company-level ARR figure, not
      // something computed here from deals; deliberately not derived from
      // deal line items, which would need a far heavier historical pull
      // across the whole portfolio for the same number.
      arrCents: c.properties.arr != null ? Math.round(Number(c.properties.arr) * 100) : null,
    })));
    after = body.paging?.next?.after;
  } while (after);

  return filterHomeOfficesWithActiveCommunity(companies);
}

/**
 * Drops any Home Office where every one of its individual communities has
 * churned — confirmed live (Sep 2026) against "Pinnacle/RSL Management":
 * all 6 of its child companies carry lifecyclestage "Canceled ", backed up
 * by 4 real "Cancellation"-type deals closed in 2025. hs_num_child_companies
 * > 0 alone (the existing Home Office signal, see getOwnedCompanies above)
 * doesn't distinguish that from a Home Office with one live community — a
 * live portfolio scan (Sep 2026) found 15 of 109 "my accounts" Home
 * Offices in exactly this all-canceled state.
 *
 * One bulk search across every candidate Home Office's children (chunked
 * to 100 IN-filter values, then paginated per chunk) rather than one
 * search per Home Office — keeps this to a handful of calls regardless of
 * portfolio size, not O(n) extra HubSpot round-trips.
 */
async function filterHomeOfficesWithActiveCommunity(companies) {
  if (companies.length === 0) return { companies: [], excludedInactiveCommunities: [] };

  const childStagesByParent = new Map();
  for (const idBatch of chunk(companies.map((c) => c.id), 100)) {
    let after;
    do {
      const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
        filterGroups: [{ filters: [{ propertyName: 'hs_parent_company_id', operator: 'IN', values: idBatch }] }],
        properties: ['hs_parent_company_id', 'lifecyclestage'],
        limit: 100,
        ...(after ? { after } : {}),
      });
      if (status !== 200) {
        throw new Error(`HubSpot child-company lookup failed (${status}): ${JSON.stringify(body)}`);
      }
      for (const c of body.results || []) {
        const parentId = c.properties.hs_parent_company_id;
        if (!parentId) continue;
        if (!childStagesByParent.has(parentId)) childStagesByParent.set(parentId, []);
        childStagesByParent.get(parentId).push(c.properties.lifecyclestage);
      }
      after = body.paging?.next?.after;
    } while (after);
  }

  const active = [];
  const excludedInactiveCommunities = [];
  for (const company of companies) {
    const childStages = childStagesByParent.get(company.id);
    // No child records found at all (shouldn't happen given
    // hs_num_child_companies > 0 already filtered upstream) — fail open
    // rather than silently dropping a real account over a lookup gap.
    const hasActiveCommunity = !childStages || childStages.some((s) => s !== CANCELED_LIFECYCLE_STAGE);
    // Aaron asked (Sep 2026) for a portfolio-wide "total communities"
    // figure — active (non-canceled) child companies specifically, not
    // just hs_num_child_companies, for the same reason the exclusion
    // above exists: a canceled community is still a "child company" in
    // HubSpot's own count, but isn't a real active community anymore.
    // Falls back to the company's own child-count property in the
    // fail-open case above, rather than 0, since "no data" shouldn't
    // read as "no communities."
    company.activeCommunityCount = childStages
      ? childStages.filter((s) => s !== CANCELED_LIFECYCLE_STAGE).length
      : (company.childCompanyCount ?? 0);
    if (hasActiveCommunity) {
      active.push(company);
    } else {
      excludedInactiveCommunities.push({ id: company.id, name: company.name });
    }
  }
  return { companies: active, excludedInactiveCommunities };
}

module.exports = { getOwnerId, getOwnedCompanies };
