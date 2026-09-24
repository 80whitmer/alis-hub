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

// client_teir_2_0 ("Client Tier (New)" in HubSpot's UI — yes, "teir" is a
// typo baked into the internal property name) is the current Account
// Management Tier field. An earlier pass (Sep 2026) preferred the older
// client_tier property instead, on the theory that client_teir_2_0
// defaulted to "4" on unmanaged/prospect companies — but confirmed live
// (Sep 2026, against Jasmine Estates Holdings and Bethesda Senior Living,
// both real managed accounts with an account_manager set) that client_tier
// is the one going stale: blank on accounts where client_teir_2_0 holds
// the real, current tier. resolveTier() below prefers client_teir_2_0 and
// only falls back to the older client_tier for any account that somehow
// has the old field set but not the new one.
// notes_last_updated ("Last Activity Date" — last note/call/meeting/task
// logged for the company, covering both an ALIS-initiated reach-out and a
// client email/call logged back) added Sep 2026 for the Tier + Last
// Activity columns/charts on both dashboards.
// company_total_capacity ("Total Beds on ALIS") is a real, always-populated-
// when-known HubSpot property — unlike this portal's census-shaped
// properties (total_census/census/il_current_census/...), which are all
// "at signing" deal-time snapshots, not live occupancy (confirmed live via
// HubSpot's own property search, Sep 2026). Free to pull here: same bulk
// company-properties fetch, no extra API calls, no ALIS involved at all.
const COMPANY_PROPERTIES = ['name', 'account_manager', 'hs_num_child_companies', 'lifecyclestage', 'createdate', 'arr', 'client_tier', 'client_teir_2_0', 'notes_last_updated', 'company_total_capacity', 'hs_pinned_engagement_id', 'alis_products', 'alis_package'];

/**
 * HubSpot's own multi-select "ALIS Products" checkbox property
 * (semicolon-delimited stored value, AM-maintained — what was sold/
 * configured), ported alongside the Account Truth model (Aaron, Sep
 * 2026). Not a live ALIS check — that's alisEntitlements.js, compared
 * against this list for mismatches.
 */
function parseAlisProducts(raw) {
  return raw ? raw.split(';').map((p) => p.trim()).filter(Boolean) : [];
}

function resolveTier(properties) {
  const newTier = properties.client_teir_2_0;
  if (newTier != null && newTier !== '') return Number(newTier);
  const oldTier = properties.client_tier;
  return oldTier != null && oldTier !== '' ? Number(oldTier) : null;
}

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

// The rest of this portal's lifecyclestage options (confirmed live, Sep
// 2026, via GET /crm/v3/properties/companies/lifecyclestage) — needed
// because "Home Office" (hs_num_child_companies > 0) is a company-
// hierarchy shape, not a lifecycle stage: a Home Office record can still
// sit at Lead, Canceled, or any other non-client stage. Aaron's own
// portfolio audit (Sep 2026) found 36 of 130 "my accounts" Home Offices
// weren't actually active Client - Home Office records — 27 Leads, 3
// Canceled (the Home Office's OWN stage, not a child's — see
// filterHomeOfficesWithActiveCommunity's separate child-stage check
// below, which this doesn't replace), 2 sitting at Client - Community
// instead, and 4 with no stage set at all — quietly padding both
// dashboards' account counts and dragging down portfolio ARR/health
// averages with $0-ARR noise.
const LEAD_LIFECYCLE_STAGE = 'lead';
const CLIENT_HOME_OFFICE_LIFECYCLE_STAGE = '61439006';
const CLIENT_COMMUNITY_LIFECYCLE_STAGE = '57820710';

/**
 * Human label for a company's lifecycleFlag (see getLifecycleDataQualityFlag
 * below) — shared so both dashboards render the exact same wording rather
 * than each inventing their own.
 */
const LIFECYCLE_FLAG_LABELS = {
  lead: 'Lead (not yet a client)',
  canceled: 'Canceled',
  client_community: 'Client - Community (not Home Office)',
  no_stage: 'No lifecycle stage set',
  other_stage: 'Unexpected lifecycle stage',
};

/**
 * Flags a Home Office whose OWN lifecyclestage isn't "Client - Home
 * Office" — the data-quality gap Aaron asked to clean up (Sep 2026): "I
 * don't want anything too stringent that we are potentially [block]
 * companies that should be flowing through... we'd still want some
 * visibility of these marginal accounts." So this deliberately never
 * removes anything from the pull — callers use the returned flag to keep
 * a flagged account fully visible in its accounts table while excluding
 * it from portfolio-wide rollup sums (ARR, avg health score, ticket
 * totals) that a stray Lead or Canceled record would otherwise skew.
 * Returns `null` for the expected value (Client - Home Office) — "no
 * flag" — so callers can test truthiness directly.
 */
function getLifecycleDataQualityFlag(lifecycleStage) {
  if (!lifecycleStage) return 'no_stage';
  if (lifecycleStage === CLIENT_HOME_OFFICE_LIFECYCLE_STAGE) return null;
  if (lifecycleStage === CANCELED_LIFECYCLE_STAGE) return 'canceled';
  if (lifecycleStage === LEAD_LIFECYCLE_STAGE) return 'lead';
  if (lifecycleStage === CLIENT_COMMUNITY_LIFECYCLE_STAGE) return 'client_community';
  return 'other_stage';
}

/**
 * True when a Lead or Canceled Home Office should be dropped from the
 * tracked accounts list entirely, rather than merely flagged-and-summed-
 * out — Aaron's rule (Sep 2026): "we ONLY want Home Office's coming
 * through of active companies... but as a rule we really don't want
 * accounts that are still leads or have been cancelled included... unless
 * they have an aging balance, then they can remain... because they still
 * have an active balance (they owe us money)." So the one thing that
 * keeps a Lead/Canceled record tracked is real money still outstanding —
 * checked directly against the CACHED aging balance (aging_total_cents on
 * the snapshot row), not re-derived here, since aging only ever arrives
 * via the separate weekly PDF import, on its own schedule from the
 * HubSpot refresh that determines lifecycle stage.
 *
 * Deliberately narrower than getLifecycleDataQualityFlag's full set:
 * Client - Community and no-lifecycle-stage-set are a HubSpot
 * miscategorization, not a "this was never/no-longer a real relationship"
 * signal the way Lead/Canceled are — Aaron didn't ask for those to be
 * dropped, so they stay flagged-but-visible (and excluded from rollup
 * sums) regardless of balance.
 *
 * IMPORTANT for callers: this must only ever filter what an already-
 * cached HubSpot pull RETURNS to a dashboard, never what the pull ITSELF
 * fetches/prunes from HubSpot — a Lead/Canceled Home Office dropped from
 * the underlying company_hosts/snapshot table would silently stop being
 * able to match a *future* aging-report row against it, permanently
 * losing the one signal that could ever bring it back.
 */
function shouldDropLifecycleFlaggedAccount(lifecycleFlag, agingTotalCents) {
  if (lifecycleFlag !== 'lead' && lifecycleFlag !== 'canceled') return false;
  return !(agingTotalCents > 0);
}

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
      tier: resolveTier(c.properties),
      lastActivityDate: c.properties.notes_last_updated || null,
      pinnedNoteId: c.properties.hs_pinned_engagement_id || null,
      products: parseAlisProducts(c.properties.alis_products),
      package: c.properties.alis_package || null,
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

/**
 * Manual owner-ID → name mapping for the Team AM Dashboard, supplied
 * directly by Aaron (Sep 2026) after confirming live that neither of the
 * two "resolve it programmatically" options actually work in this portal:
 * - `account_manager`'s property DEFINITION has an empty `options` array —
 *   confirmed live via GET /crm/v3/properties/companies/account_manager:
 *   `referencedObjectType: "OWNER", externalOptions: true`, meaning this
 *   is a dynamic owner-reference field, not a static enum with inline
 *   labels the way a normal dropdown property would be.
 * - `/crm/v3/owners` (the endpoint that WOULD resolve an owner ID to a
 *   name) still 403s MISSING_SCOPES — the same `crm.objects.owners.read`
 *   gap `getOwnerId()` above already works around for Aaron's own ID.
 * Each ID verified live against real `account_manager`-filtered company
 * counts before being hardcoded here (Sep 2026): 280699315→109,
 * 474571664→105, 2558500→61, 77259229→124, 49052011→56, 90345669→4 Home
 * Offices. 212010676 (Evan Kuo) and 1152655184 (Gary Jones) verified as
 * real IDs but currently have 0 assigned Home Offices each — kept in the
 * map anyway (harmless, and correct the moment either is assigned one).
 * A small extra ~10 Home Offices (of 611 portal-wide, 142 with no
 * account_manager at all) belong to an account_manager ID not in this
 * list — `getAccountManagerName()` below falls back to "Unassigned"
 * (no property value) or "Other AM" (a real but unmapped ID) rather than
 * silently dropping those accounts. **How to apply:** update this map
 * when an AM joins/leaves — there's no live sync, this is a point-in-time
 * snapshot Aaron provided, not resolved from HubSpot automatically.
 */
const ACCOUNT_MANAGER_NAMES = {
  280699315: 'Aaron Whitmer',
  474571664: 'Taylor King',
  2558500: 'Patrick Noack',
  49052011: 'Owen Phoenix',
  77259229: 'Jeffery Brown',
  90345669: 'Jessica Crouse',
  212010676: 'Evan Kuo',
  1152655184: 'Gary Jones',
};

/** `null` (no account_manager set — "Unassigned") vs. a real ID this portal doesn't have a name for yet ("Other AM") are genuinely different states, not folded into one fallback string, so a dashboard reader can tell "nobody's assigned this" from "someone is, we just don't have their name mapped." */
function getAccountManagerName(ownerId) {
  if (!ownerId) return 'Unassigned';
  return ACCOUNT_MANAGER_NAMES[ownerId] || `Other AM (${ownerId})`;
}

/**
 * Every Home Office company portal-wide, regardless of account_manager —
 * the Team AM Dashboard's "all accounts" set, vs. getOwnedCompanies'
 * single-AM scope above. Same Home-Office signal (hs_num_child_companies
 * > 0) and the same filterHomeOfficesWithActiveCommunity churn-exclusion
 * pass, just without the `account_manager EQ` filter. Confirmed live
 * (Sep 2026): 611 total Home Offices portal-wide, 142 with no
 * account_manager set at all.
 */
async function getAllHomeOfficeCompanies() {
  const companies = [];
  let after;
  do {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
      filterGroups: [{
        filters: [
          { propertyName: 'hs_num_child_companies', operator: 'GT', value: '0' },
        ],
      }],
      properties: COMPANY_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (status !== 200) {
      throw new Error(`HubSpot all-Home-Offices search failed (${status}): ${JSON.stringify(body)}`);
    }
    companies.push(...(body.results || []).map((c) => ({
      id: c.id,
      name: c.properties.name,
      accountManagerId: c.properties.account_manager || null,
      accountManagerName: getAccountManagerName(c.properties.account_manager),
      lifecycleStage: c.properties.lifecyclestage || null,
      createdAt: c.properties.createdate || null,
      arrCents: c.properties.arr != null ? Math.round(Number(c.properties.arr) * 100) : null,
      tier: resolveTier(c.properties),
      lastActivityDate: c.properties.notes_last_updated || null,
      hubspotCapacity: c.properties.company_total_capacity != null && c.properties.company_total_capacity !== ''
        ? Number(c.properties.company_total_capacity) : null,
      pinnedNoteId: c.properties.hs_pinned_engagement_id || null,
      products: parseAlisProducts(c.properties.alis_products),
      package: c.properties.alis_package || null,
    })));
    after = body.paging?.next?.after;
  } while (after);

  return filterHomeOfficesWithActiveCommunity(companies);
}

module.exports = {
  getOwnerId, getOwnedCompanies, getAllHomeOfficeCompanies, getAccountManagerName,
  getLifecycleDataQualityFlag, LIFECYCLE_FLAG_LABELS, shouldDropLifecycleFlaggedAccount,
};
