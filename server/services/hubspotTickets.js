const https = require('https');

/**
 * Pulls HubSpot tickets associated with a company for the QBR pipeline's
 * Support Review / Enhancement Requests sections.
 *
 * Reuses the Bearer-auth-over-raw-https pattern from server/api/hubspot.js.
 * The portal categorizes tickets with a custom `category_2_0` ("Category
 * 2.0") property, not HubSpot's default `hs_ticket_category` — confirmed
 * live (ticket 25155954083 has category_2_0 set, hs_ticket_category empty).
 * Both are fetched and category_2_0 wins, falling back to hs_ticket_category
 * for any older tickets that only have the legacy field populated.
 *
 * category_2_0's enum options in this portal reuse "true"/"false" as the
 * *stored* values for "Issue" and "General Question" (a copy-paste from an
 * old boolean property, confirmed via the property definition) — the API
 * returns that raw stored value, not the display label, so CATEGORY_2_0_LABELS
 * maps the handful of options whose stored value isn't already its own label.
 */
const CATEGORY_2_0_LABELS = {
  false: 'General Question',
  true: 'Issue',
  Project: 'General Project',
  'ALIS Bug': 'ALIS Escalation',
};

const TICKET_PROPERTIES = [
  'subject',
  'content',
  'hs_pipeline',
  'hs_pipeline_stage',
  'category_2_0',
  'hs_ticket_category',
  'hs_ticket_priority',
  'createdate',
  'hs_lastmodifieddate',
  'closed_date',
  'top_3',
];

// The literal HubSpot pipeline-stage label a ticket must resolve to for it
// to count as "status-flagged Top 3" — confirmed live (Sep 2026) via
// get_properties on TICKET.hs_pipeline_stage: stage id "1372980771" carries
// this exact label. Matched by label (via getPipelineStageLabels), not the
// raw stage id, since a stage id is scoped to one pipeline and a portal can
// have more than one — the label is the stable, human-meaningful signal.
const TOP_3_STATUS_LABEL = 'Top 3 Enhancements';

function hubspotRequest(method, path, body) {
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
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} });
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

/** Splits `arr` into chunks of at most `size` items — HubSpot's batch/read endpoints reject more than 100 inputs per call. */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Ticket IDs associated with a company, via the v4 associations API —
 * paginated (cursor `after`) rather than a single call, since an account
 * with more tickets than fit on one page (confirmed live: Viva Senior
 * Living has enough tickets to hit this) would otherwise silently lose
 * every ticket past the first page.
 */
async function getTicketIdsForCompany(companyId) {
  const ids = [];
  let after;
  do {
    const path = `/crm/v4/objects/companies/${companyId}/associations/tickets${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const { status, body } = await hubspotRequest('GET', path);
    if (status !== 200) {
      throw new Error(`HubSpot associations lookup failed (${status}): ${JSON.stringify(body)}`);
    }
    ids.push(...(body.results || []).map((r) => r.toObjectId));
    after = body.paging?.next?.after;
  } while (after);
  return ids;
}

/**
 * Batch-read full ticket properties for a list of ticket IDs, chunked to
 * HubSpot's hard 100-input cap on `batch/read` calls — confirmed live: a
 * single unchunked call for an account with 100+ tickets (Viva Senior
 * Living) gets rejected outright, and the caller's catch-and-continue in
 * kpiExport.js meant this failure was invisible on the finished report
 * (an ephemeral SSE progress message, not a persisted dataWarning) rather
 * than an empty Support Review section with no explanation.
 */
async function batchReadTickets(ticketIds) {
  if (ticketIds.length === 0) return [];

  const results = [];
  for (const batch of chunk(ticketIds, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/tickets/batch/read', {
      properties: TICKET_PROPERTIES,
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200) {
      throw new Error(`HubSpot ticket batch read failed (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
  }
  return results;
}

function ticketCategory(properties) {
  if (properties.category_2_0) return CATEGORY_2_0_LABELS[properties.category_2_0] || properties.category_2_0;
  return properties.hs_ticket_category || 'uncategorized';
}

function daysOpen(ticket) {
  const created = ticket.properties.createdate;
  const closed = ticket.properties.closed_date;
  const end = closed ? new Date(closed) : new Date();
  const start = new Date(created);
  if (Number.isNaN(start.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/**
 * Fetch and summarize a company's tickets: counts + aging by category and
 * pipeline stage, plus the raw list for the Support Review / Enhancement
 * Requests deck sections.
 */
async function getTicketSummaryForCompany(hubspotCompanyId) {
  const ticketIds = await getTicketIdsForCompany(hubspotCompanyId);
  const raw = await batchReadTickets(ticketIds);

  // Needed to tell a "Top 3 Enhancements" pipeline STAGE apart from every
  // other stage a ticket could sit in — degrades to leaving
  // pipelineStageLabel unresolved (raw id) rather than losing the rest of
  // the ticket over a failed pipeline lookup.
  let stageLabels = new Map();
  try {
    stageLabels = await getPipelineStageLabels('tickets');
  } catch (err) {
    console.error('[hubspotTickets] Failed to resolve ticket stage labels — Top 3 status matching and displayed status will fall back to raw pipeline-stage IDs:', err.message);
  }

  const tickets = raw.map((t) => {
    const stageLabel = stageLabels.get(`${t.properties.hs_pipeline}:${t.properties.hs_pipeline_stage}`)?.stage;
    return {
      id: t.id,
      subject: t.properties.subject,
      category: ticketCategory(t.properties),
      pipelineStage: t.properties.hs_pipeline_stage,
      pipelineStageLabel: stageLabel || t.properties.hs_pipeline_stage,
      priority: t.properties.hs_ticket_priority,
      createdAt: t.properties.createdate,
      closedAt: t.properties.closed_date || null,
      isOpen: !t.properties.closed_date,
      daysOpen: daysOpen(t),
      // The "1"/"2"/"3" tag property (label "Top 3" in HubSpot) — a client's
      // own ranking of their top enhancement asks, independent of pipeline
      // stage (see topThreeEnhancements below for why both are tracked).
      topThreeRank: t.properties.top_3 || null,
      // Needs nothing but HUBSPOT_PORTAL_ID (no extra API call) — same
      // ticketUrl() used by enrichRepeatIssueFlags/enrichOpenTickets below,
      // now attached to every live-pulled ticket so the Support Review /
      // dashboard listings can link straight to the record.
      url: ticketUrl(t.id),
    };
  });

  const byCategory = {};
  for (const t of tickets) {
    byCategory[t.category] = byCategory[t.category] || { total: 0, open: 0, closed: 0 };
    byCategory[t.category].total++;
    byCategory[t.category][t.isOpen ? 'open' : 'closed']++;
  }

  const openTickets = tickets.filter((t) => t.isOpen);
  const agingOpenTickets = openTickets.filter((t) => (t.daysOpen || 0) > 90);

  // Two independent signals for "this is a Top 3 enhancement," per Aaron
  // (Sep 2026): the `top_3` tag property (rank 1/2/3) and a ticket sitting
  // in the "Top 3 Enhancements" pipeline STAGE — these should normally
  // travel together but nothing enforces that in HubSpot itself, so a
  // ticket can drift to having only one. Every ticket with EITHER signal is
  // surfaced.
  //
  // Confirmed live (Sep 2026, real portal data): a CLOSED/completed ticket
  // naturally moves out of the "Top 3 Enhancements" stage into "Completed"
  // while still keeping its top_3 rank (e.g. "Scheduled v. Actual Leave
  // End" — top_3="2", stage="Completed") — that's normal workflow, not a
  // data-quality problem, so alignment is only checked for still-open
  // tickets. The real misalignment case this catches (confirmed live:
  // "Communities: Community Information", top_3="1" but stage="Client
  // Submitted") is an OPEN ticket the client ranked #1 that never actually
  // got moved into the Top 3 stage — that one is worth flagging.
  const hasTag = (t) => t.topThreeRank != null && t.topThreeRank !== '';
  const hasStage = (t) => t.pipelineStageLabel === TOP_3_STATUS_LABEL;
  const topThreeItems = tickets
    .filter((t) => hasTag(t) || hasStage(t))
    .map((t) => ({
      ...t,
      taggedTop3: hasTag(t),
      statusTop3: hasStage(t),
      aligned: !t.isOpen || hasTag(t) === hasStage(t),
    }))
    .sort((a, b) => (a.topThreeRank || '9').localeCompare(b.topThreeRank || '9'));

  const topThreeEnhancements = {
    items: topThreeItems,
    hasAny: topThreeItems.length > 0,
    misaligned: topThreeItems.filter((t) => !t.aligned),
  };

  return {
    total: tickets.length,
    open: openTickets.length,
    closed: tickets.length - openTickets.length,
    byCategory,
    agingOpenTickets,
    topThreeEnhancements,
    tickets,
  };
}

// HubSpot's standard CRM object type IDs — used to build direct record
// links (https://app.hubspot.com/contacts/<portal>/record/<type>/<id>).
// Same URL shape regardless of object type; only this ID changes.
const HUBSPOT_OBJECT_TYPE = { ticket: '0-5', deal: '0-3' };

function hubspotRecordUrl(objectType, id) {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  return portalId && id != null ? `https://app.hubspot.com/contacts/${portalId}/record/${HUBSPOT_OBJECT_TYPE[objectType]}/${id}` : null;
}

function ticketUrl(ticketId) {
  return hubspotRecordUrl('ticket', ticketId);
}

const DEAL_PROPERTIES = [
  'dealname',
  'pipeline',
  'dealstage',
  'amount',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
  'hs_is_closed',
  'hs_is_closed_won',
];

/** Deal IDs associated with a company, via the v4 associations API — same cursor pagination as getTicketIdsForCompany above, for the same reason. */
async function getDealIdsForCompany(companyId) {
  const ids = [];
  let after;
  do {
    const path = `/crm/v4/objects/companies/${companyId}/associations/deals${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const { status, body } = await hubspotRequest('GET', path);
    if (status !== 200) {
      throw new Error(`HubSpot deal associations lookup failed (${status}): ${JSON.stringify(body)}`);
    }
    ids.push(...(body.results || []).map((r) => r.toObjectId));
    after = body.paging?.next?.after;
  } while (after);
  return ids;
}

/** Batch-read full deal properties for a list of deal IDs, chunked to HubSpot's 100-input cap on batch/read calls — same reasoning as batchReadTickets above. */
async function batchReadDeals(dealIds) {
  if (dealIds.length === 0) return [];

  const results = [];
  for (const batch of chunk(dealIds, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/deals/batch/read', {
      properties: DEAL_PROPERTIES,
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200) {
      throw new Error(`HubSpot deal batch read failed (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
  }
  return results;
}

// `pipeline`/`dealstage` (deals) and `hs_pipeline`/`hs_pipeline_stage`
// (tickets) come back from the API as opaque internal IDs ("203920155", not
// "Closed Won") — this resolves them to the labels shown in the HubSpot UI,
// for whichever object type is asked for. Cached per object type for the
// process lifetime: pipeline configuration changes are rare and not worth a
// lookup per call. Degrades to showing the raw ID if the lookup fails
// (missing scope, API error) rather than losing the rest of the record over
// a cosmetic label.
const pipelineStageLabelCachePromises = new Map();
async function getPipelineStageLabels(objectType) {
  if (!pipelineStageLabelCachePromises.has(objectType)) {
    pipelineStageLabelCachePromises.set(objectType, (async () => {
      const { status, body } = await hubspotRequest('GET', `/crm/v3/pipelines/${objectType}`);
      if (status !== 200) {
        throw new Error(`HubSpot ${objectType} pipelines lookup failed (${status}): ${JSON.stringify(body)}`);
      }
      const labels = new Map();
      for (const pipeline of body.results || []) {
        for (const stage of pipeline.stages || []) {
          labels.set(`${pipeline.id}:${stage.id}`, { pipeline: pipeline.label, stage: stage.label });
        }
      }
      return labels;
    })().catch((err) => {
      pipelineStageLabelCachePromises.delete(objectType); // don't cache a failure — retry next call
      throw err;
    }));
  }
  return pipelineStageLabelCachePromises.get(objectType);
}

/**
 * Fetch and summarize a company's deals: open vs. closed-last-90-days, with
 * real names/stages/amounts/links — the deal equivalent of
 * getTicketSummaryForCompany below. Uses `hs_is_closed` (a HubSpot-computed
 * boolean) rather than string-matching the stage label, since stage labels
 * are freeform per pipeline and "Closed Won" in one pipeline might be
 * "Won — Contract Signed" in another.
 */
async function getDealSummaryForCompany(hubspotCompanyId) {
  const dealIds = await getDealIdsForCompany(hubspotCompanyId);
  const raw = await batchReadDeals(dealIds);

  let stageLabels = new Map();
  try {
    stageLabels = await getPipelineStageLabels('deals');
  } catch (err) {
    console.error('[hubspotTickets] Failed to resolve deal stage labels — showing raw IDs instead:', err.message);
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const deals = raw.map((d) => {
    const p = d.properties;
    const labels = stageLabels.get(`${p.pipeline}:${p.dealstage}`);
    return {
      id: d.id,
      name: p.dealname,
      pipeline: labels?.pipeline || p.pipeline,
      stage: labels?.stage || p.dealstage,
      amount: p.amount != null ? Number(p.amount) : null,
      closeDate: p.closedate || null,
      createdAt: p.createdate,
      lastModifiedAt: p.hs_lastmodifieddate,
      isClosed: p.hs_is_closed === 'true',
      isWon: p.hs_is_closed_won === 'true',
      url: hubspotRecordUrl('deal', d.id),
    };
  });

  const openDeals = deals.filter((d) => !d.isClosed);
  const closedDeals = deals.filter((d) => d.isClosed && d.closeDate && new Date(d.closeDate) >= ninetyDaysAgo);
  const totalOpenValue = openDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return {
    total: deals.length,
    open: openDeals.length,
    closed: deals.length - openDeals.length,
    totalOpenValue,
    openDeals,
    closedDeals,
    deals,
  };
}

const LINE_ITEM_PROPERTIES = ['name', 'quantity', 'price', 'recurringbillingfrequency', 'hs_product_id'];

/** Line-item IDs associated with one deal, via the v4 associations API — a single page in practice (a deal has a handful of line items, not hundreds), but paginated the same way as getTicketIdsForCompany/getDealIdsForCompany for consistency and safety. */
async function getLineItemIdsForDeal(dealId) {
  const ids = [];
  let after;
  do {
    const path = `/crm/v4/objects/deals/${dealId}/associations/line_items${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const { status, body } = await hubspotRequest('GET', path);
    if (status !== 200) {
      throw new Error(`HubSpot line-item associations lookup failed for deal ${dealId} (${status}): ${JSON.stringify(body)}`);
    }
    ids.push(...(body.results || []).map((r) => r.toObjectId));
    after = body.paging?.next?.after;
  } while (after);
  return ids;
}

/** Batch-read full line-item properties, chunked to HubSpot's 100-input cap — same reasoning as batchReadTickets/batchReadDeals. */
async function batchReadLineItems(lineItemIds) {
  if (lineItemIds.length === 0) return [];

  const results = [];
  for (const batch of chunk(lineItemIds, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/line_items/batch/read', {
      properties: LINE_ITEM_PROPERTIES,
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200) {
      throw new Error(`HubSpot line-item batch read failed (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
  }
  return results;
}

/**
 * Fetch every deal for a company (regardless of open/closed/won) plus that
 * deal's line items — the "what did this company actually contract for"
 * data source for the usage-audit tool. Unlike getDealSummaryForCompany
 * (which is deliberately open-vs-closed-last-90-days scoped for a QBR's
 * "recent deal activity" section), this returns every deal ever associated
 * with the company: a module purchased on a 2023 deal is still contracted
 * today even though that deal is neither open nor "closed in the last 90
 * days". One-time implementation-fee line items are included as-is (the
 * caller decides whether to filter them out) — they're a genuine signal
 * that a module's onboarding was purchased, separate from its recurring
 * per-bed line item.
 */
async function getContractedModulesForCompany(hubspotCompanyId) {
  const dealIds = await getDealIdsForCompany(hubspotCompanyId);
  const deals = await batchReadDeals(dealIds);

  const results = [];
  for (const deal of deals) {
    const lineItemIds = await getLineItemIdsForDeal(deal.id);
    const rawLineItems = await batchReadLineItems(lineItemIds);
    const lineItems = rawLineItems.map((li) => ({
      id: li.id,
      name: li.properties.name,
      quantity: li.properties.quantity != null ? Number(li.properties.quantity) : null,
      price: li.properties.price != null ? Number(li.properties.price) : null,
      recurringBillingFrequency: li.properties.recurringbillingfrequency || null,
    }));

    results.push({
      dealId: deal.id,
      dealName: deal.properties.dealname,
      isClosed: deal.properties.hs_is_closed === 'true',
      isWon: deal.properties.hs_is_closed_won === 'true',
      closeDate: deal.properties.closedate || null,
      url: hubspotRecordUrl('deal', deal.id),
      lineItems,
    });
  }
  return results;
}

/**
 * Enriches an imported account-health-export's service_health.repeat_issue_flags
 * in place, resolving each category's tickets to {id, subject, status, url}.
 *
 * Three independent capabilities, each degrading on its own:
 * - `url` needs nothing but HUBSPOT_PORTAL_ID (a static env var, no API
 *   call), so it's always attached when that's configured.
 * - `subject`/`status` can arrive two ways: already present on the import
 *   (a `tickets: [{id, subject, status}]` array — what a future version of
 *   the skill should emit, since it already has this from the same HubSpot
 *   query that found the ticket in the first place) or, failing that,
 *   resolved live via a HubSpot batch read. The import's own values always
 *   win — only tickets still missing a subject after the import get looked
 *   up, so an already-rich import costs zero extra API calls.
 * - The live lookup can fail on its own (no token configured, API error,
 *   deleted ticket) — that failure only costs the title/status, never the
 *   link, since url doesn't depend on it.
 *
 * Still accepts the legacy `ticket_ids`/`ticketIds` shape (bare numeric IDs,
 * no subject/status at all) for older skill exports.
 */
async function enrichRepeatIssueFlags(serviceHealth) {
  const flags = serviceHealth?.repeat_issue_flags?.value;
  if (!Array.isArray(flags) || flags.length === 0) return serviceHealth;

  const normalizeTicket = (t) => (t !== null && typeof t === 'object')
    ? { id: t.id, subject: t.subject || null, status: t.status || null }
    : { id: t, subject: null, status: null };

  const normalizedFlags = flags.map((f) => ({
    ...f,
    tickets: (f.tickets || f.ticketIds || f.ticket_ids || []).map(normalizeTicket),
  }));

  const idsNeedingSubject = [...new Set(
    normalizedFlags.flatMap((f) => f.tickets.filter((t) => !t.subject).map((t) => String(t.id)))
  )];

  let liveById = new Map();
  if (idsNeedingSubject.length > 0) {
    try {
      const raw = await batchReadTickets(idsNeedingSubject);
      // hs_pipeline_stage is a raw internal ID ("1067267607"), not a label
      // like "Completed" — resolve it so isClosedTicketStatus (dashboard
      // side) can actually match it against 'closed'/'completed'. Falls
      // back to the raw ID if the pipeline lookup itself fails; status just
      // won't classify as closed in that case, same as today.
      let stageLabels = new Map();
      try {
        stageLabels = await getPipelineStageLabels('tickets');
      } catch (err) {
        console.error('[hubspotTickets] Failed to resolve ticket stage labels — status will show a raw pipeline-stage ID instead:', err.message);
      }
      liveById = new Map(raw.map((t) => {
        const p = t.properties;
        const label = stageLabels.get(`${p.hs_pipeline}:${p.hs_pipeline_stage}`);
        return [String(t.id), { subject: p.subject, status: label?.stage || p.hs_pipeline_stage }];
      }));
    } catch (err) {
      console.error('[hubspotTickets] Failed to resolve repeat-issue ticket titles — links will still work, just without titles:', err.message);
    }
  }

  const enrichedFlags = normalizedFlags.map((f) => ({
    ...f,
    tickets: f.tickets.map((t) => {
      const live = liveById.get(String(t.id));
      return {
        id: t.id,
        subject: t.subject || live?.subject || null,
        status: t.status || live?.status || null,
        url: ticketUrl(t.id),
      };
    }),
  }));

  return {
    ...serviceHealth,
    repeat_issue_flags: { ...serviceHealth.repeat_issue_flags, value: enrichedFlags },
  };
}

/**
 * Enriches an imported account-health-export's financial_health deal lists
 * (open_deals, closed_deals_last_90_days) with a direct HubSpot record link
 * per deal — same pattern as ticketUrl above: needs nothing but the deal ID
 * and HUBSPOT_PORTAL_ID, no API call, so it's always attached when that's
 * configured.
 */
function enrichDealUrls(financialHealth) {
  if (!financialHealth) return financialHealth;

  const withUrls = (dealList) => {
    if (!Array.isArray(dealList?.value)) return dealList;
    return { ...dealList, value: dealList.value.map((d) => ({ ...d, url: hubspotRecordUrl('deal', d.id) })) };
  };

  return {
    ...financialHealth,
    open_deals: withUrls(financialHealth.open_deals),
    closed_deals_last_90_days: withUrls(financialHealth.closed_deals_last_90_days),
  };
}

/**
 * Enriches an imported account-health-export's service_health.open_tickets
 * with a direct HubSpot link per ticket — same "needs nothing but the ID
 * and HUBSPOT_PORTAL_ID, no API call" pattern as the other enrichments.
 * Unlike repeat_issue_flags, this array's subject/status/next_step are
 * expected to already be fully supplied by the skill (that's the point of
 * it — a comprehensive open-ticket list with next steps and PPTX routing),
 * so there's no live-lookup fallback to attempt here, just the link.
 */
function enrichOpenTickets(serviceHealth) {
  const openTickets = serviceHealth?.open_tickets?.value;
  if (!Array.isArray(openTickets) || openTickets.length === 0) return serviceHealth;

  return {
    ...serviceHealth,
    open_tickets: {
      ...serviceHealth.open_tickets,
      value: openTickets.map((t) => ({ ...t, url: hubspotRecordUrl('ticket', t.id) })),
    },
  };
}

module.exports = { getTicketSummaryForCompany, getDealSummaryForCompany, getContractedModulesForCompany, enrichRepeatIssueFlags, enrichDealUrls, enrichOpenTickets };
