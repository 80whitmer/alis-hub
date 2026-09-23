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
  // Free-text "Next Step" — confirmed live (Sep 2026) via the tickets
  // properties endpoint: internal name `next_step` (textarea, group
  // "ticketinformation"). A real per-ticket property, unlike deals' own
  // `hs_next_step` (a different property on a different object type) —
  // just never pulled here before now.
  'next_step',
  // Only the id is stored in snapshots; the note itself is fetched live
  // when someone opens it (GET /api/hubspot/pinned-notes).
  'hs_pinned_engagement_id',
];

// The literal HubSpot pipeline-stage label a ticket must resolve to for it
// to count as "status-flagged Top 3" — confirmed live (Sep 2026) via
// get_properties on TICKET.hs_pipeline_stage: stage id "1372980771" carries
// this exact label. Matched by label (via getPipelineStageLabels), not the
// raw stage id, since a stage id is scoped to one pipeline and a portal can
// have more than one — the label is the stable, human-meaningful signal.
const TOP_3_STATUS_LABEL = 'Top 3 Enhancements';

// Which open-ticket stage labels count as the account manager's actual
// working queue, per Aaron (Sep 2026) — confirmed live against this
// portal's 3 real ticket pipelines (Account Management / ALIS Pay /
// Support Pipeline; get_properties on TICKET.hs_pipeline_stage): "Client
// Submitted" and "In Progress" are the two stages that mean "someone needs
// to act on this," in any pipeline. Everything else that isn't closed
// either belongs to enhancement tracking (see LONG_TERM_STATUS_LABEL /
// TOP_3_STATUS_LABEL below) or is a lower-volume status (Not Started,
// Waiting for confirmation, Check In, ALIS Internal Finance, Done -
// waiting for confirmation, Insignificant Ticket Updates, SPAM, New) that
// isn't part of the focused open count but still isn't silently dropped —
// see otherOpenTickets below.
const FOCUSED_OPEN_STATUS_LABELS = new Set(['Client Submitted', 'In Progress']);

// The pipeline stage a ticket sits in once it's agreed to be a longer-term
// build rather than a quick fix — confirmed live via the same
// get_properties lookup as TOP_3_STATUS_LABEL. Tracked as its own
// "lesser enhancement" bucket, distinct from a Top 3 Enhancement (a ticket
// can be both — see isTopEnhancement below).
const LONG_TERM_STATUS_LABEL = 'Long-Term Projects';

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
 * Retries on HubSpot's 429 (confirmed live, Sep 2026: a full-portfolio
 * Account Health refresh across 371 companies hit `ten_secondly_rolling`
 * rate limiting hard — 311 of 371 companies failed outright with no retry
 * at all, since nothing here previously expected a 429). Every other
 * caller in this app has always been single-company/on-demand, low enough
 * volume that this was never hit before; a 371-company bulk pull is a
 * genuinely different load pattern. Honors a `Retry-After` header when
 * HubSpot sends one, otherwise backs off 1s/2s/4s/8s; gives up after 5
 * total attempts and surfaces the last error as-is.
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
      nextStep: t.properties.next_step || null,
      // Needs nothing but HUBSPOT_PORTAL_ID (no extra API call) — same
      // ticketUrl() used by enrichRepeatIssueFlags/enrichOpenTickets below,
      // now attached to every live-pulled ticket so the Support Review /
      // dashboard listings can link straight to the record.
      url: ticketUrl(t.id),
      pinnedNoteId: t.properties.hs_pinned_engagement_id || null,
    };
  })
    // category_2_0 === "ALIS Internal" (Sep 2026, confirmed live — 11
    // portal-wide, e.g. "ALIS - ALIS Internal - AM Departmental Tea Party...")
    // is internal team/process-tracking noise, not client support work —
    // several are attached to real client companies, so left in they'd
    // inflate that account's open/closed counts, the Ticket Activity
    // heatmaps, and the Open Ticket Volume backlog chart on both
    // dashboards. Filtered out here, at the one shared source both
    // dashboards call, so every downstream count/bucket/chart is clean
    // without needing a separate fix anywhere else.
    .filter((t) => t.category !== 'ALIS Internal');

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

  // Splits the open queue into the buckets Aaron actually wants surfaced
  // separately (Sep 2026): a focused "needs action" queue, two enhancement
  // tiers (Top 3 vs. everything else parked as a longer-term build), and a
  // catch-all for lower-volume statuses so nothing open goes uncounted.
  // isTopEnhancement reuses hasTag/hasStage above rather than
  // topThreeItems directly, since topThreeItems isn't filtered to isOpen.
  const isTopEnhancement = (t) => hasTag(t) || hasStage(t);
  const isLesserEnhancement = (t) => t.pipelineStageLabel === LONG_TERM_STATUS_LABEL && !isTopEnhancement(t);
  // Moved up from where this used to live (right above enhancementRequests
  // below) so focusedOpenTickets can also use it — same category_2_0 ===
  // 'Enhancement'-or-subject-match check, unchanged.
  const isEnhancementRequest = (t) => t.category === 'Enhancement' || /enhancement/i.test(t.subject || '');
  // Excludes enhancement requests (Sep 2026, Aaron: "Open Tickets" should
  // capture Client Submitted + In Progress volume excluding enhancement
  // requests, since those are already broken out in their own Enhancement
  // Requests tile — a ticket categorized "Enhancement" that hasn't been
  // staged into Top 3/Long-Term yet was previously counted in BOTH places).
  // Falls into otherOpenTickets below instead of disappearing, same as
  // every other non-focused open ticket.
  const focusedOpenTickets = openTickets.filter((t) => FOCUSED_OPEN_STATUS_LABELS.has(t.pipelineStageLabel) && !isEnhancementRequest(t));
  const topEnhancementOpenTickets = openTickets.filter(isTopEnhancement);
  const lesserEnhancementOpenTickets = openTickets.filter(isLesserEnhancement);
  const otherOpenTickets = openTickets.filter((t) => (
    (!FOCUSED_OPEN_STATUS_LABELS.has(t.pipelineStageLabel) || isEnhancementRequest(t)) && !isTopEnhancement(t) && !isLesserEnhancement(t)
  ));

  // Broader "Enhancement Requests" bucket for the portfolio-wide Enhancement
  // Requests dashboard section (Sep 2026, Aaron): every OPEN ticket whose
  // category_2_0 is the portal's own "Enhancement" option (confirmed live
  // via the tickets properties endpoint — value and label are both literally
  // "Enhancement") OR whose subject mentions "enhancement" — independent of
  // the Top 3 tag/stage machinery above. A ticket can be a plain
  // Enhancement-categorized request without ever being ranked/staged Top 3,
  // and vice versa, so `isTopThree` is carried per-item rather than assumed.
  const enhancementRequests = openTickets
    .filter(isEnhancementRequest)
    .map((t) => ({ ...t, isTopThree: isTopEnhancement(t) }));

  // Open ALIS Pay tickets (Sep 2026, Aaron) — category_2_0 === 'ALIS Pay',
  // confirmed live as the CURRENT, actively-growing way this portal tracks
  // ALIS Pay support work (newest ticket at time of writing was created
  // same-day). Deliberately NOT the old dedicated "ALIS Pay" HubSpot
  // pipeline (id 221355, ~6,410 tickets) — confirmed live that pipeline
  // has had zero new tickets across every one of its stages since
  // 2025-12-01, i.e. it's a frozen historical backlog from a
  // since-abandoned email-inbox-to-ticket integration, not a live signal.
  // A health-score/dashboard "volume" built on a frozen number would never
  // move, defeating the point of an ongoing indicator.
  const isAlisPayTicket = (t) => t.category === 'ALIS Pay';
  const alisPayTickets = openTickets.filter(isAlisPayTicket);

  // Open "Escalation" tickets (Sep 2026, Aaron) — category_2_0's raw
  // stored value "ALIS Bug" (see CATEGORY_2_0_LABELS above, which already
  // maps it to the display label "ALIS Escalation"), confirmed live as a
  // real, distinct, actively-used category (47 open portal-wide at time
  // of writing). Not to be confused with serviceHealth's OTHER
  // `escalationCount` field (accountHealth.js's mapLiveServiceHealth) —
  // that one is a completely different, currently-unpopulated Jira-ESC
  // concept from the aspirational bridge schema; this is real, live
  // HubSpot category data.
  const isEscalation = (t) => t.category === 'ALIS Escalation';
  const escalationTickets = openTickets.filter(isEscalation);
  // Closed escalations (Sep 2026, Aaron) — same category, but pulled from
  // the full `tickets` population rather than openTickets, for the
  // Escalation Tickets section's "Closed — Trailing 12 Months" heatmap
  // (mirrors the Ticket Activity Opened/Closed heatmap pair on Account
  // Health). All-time, like `closed` above — the heatmap itself only plots
  // the trailing 12 months, so there's no need to pre-filter by date here.
  const closedEscalationTickets = tickets.filter((t) => isEscalation(t) && !t.isOpen);
  // Closed enhancement requests (Sep 2026, Aaron) — same category/subject
  // rule as enhancementRequests above, but pulled from the full `tickets`
  // population rather than openTickets, for EnhancementRequestsSection.jsx's
  // new Opened vs. Closed trend chart (mirrors closedEscalationTickets).
  const closedEnhancementRequests = tickets
    .filter((t) => isEnhancementRequest(t) && !t.isOpen)
    .map((t) => ({ ...t, isTopThree: isTopEnhancement(t) }));

  // Closed-this-calendar-year count, for the Cost to Serve by Tier chart
  // (Sep 2026, Aaron): that metric is meant to read as "current support
  // load," so a ticket closed in a prior calendar year shouldn't still be
  // inflating this year's ratio right alongside every currently-open
  // ticket. `closed` above stays all-time (used elsewhere, e.g. the
  // Accounts table's plain "Closed Tickets" column) — this is a separate,
  // narrower count just for that one chart.
  const currentYear = new Date().getFullYear();
  const closedThisYear = tickets.filter((t) => !t.isOpen && t.closedAt && new Date(t.closedAt).getFullYear() === currentYear).length;

  return {
    total: tickets.length,
    open: openTickets.length,
    closed: tickets.length - openTickets.length,
    closedThisYear,
    focusedOpenTickets,
    enhancementTickets: { top: topEnhancementOpenTickets, lesser: lesserEnhancementOpenTickets },
    enhancementRequests,
    closedEnhancementRequests,
    alisPayTickets,
    escalationTickets,
    closedEscalationTickets,
    otherOpenTickets,
    byCategory,
    agingOpenTickets,
    topThreeEnhancements,
    tickets,
  };
}

// HubSpot's standard CRM object type IDs — used to build direct record
// links (https://app.hubspot.com/contacts/<portal>/record/<type>/<id>).
// Same URL shape regardless of object type; only this ID changes.
const HUBSPOT_OBJECT_TYPE = { ticket: '0-5', deal: '0-3', company: '0-2', contact: '0-1', task: '0-27' };

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
  'dealtype',
  'amount',
  // The portal's own purpose-built "ARR (Total Potential Value)" property
  // — (AL/IL capacity × negotiated rate) × 12 — confirmed live (Sep 2026)
  // via search_properties as the exact property HubSpot's own "2026
  // Booked Revenue" dashboard card sums. Deliberately NOT the same as
  // `amount` (a deal's plain contract-value field, which can be a
  // one-time fee, a partial add-on, or anything else depending on deal
  // type) — arrAddedThisYearCents below uses this instead, so it means
  // the same thing here as it does everywhere else Aaron looks at ARR.
  'arr_value',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
  'hs_is_closed',
  'hs_is_closed_won',
  // "Next step" (free text) and "Next Activity Date" (auto-set by HubSpot
  // whenever a task/call/meeting is logged against the deal) — confirmed
  // live via this portal's own property definitions. closedate doubles as
  // "projected close date" for a still-open deal (that's its literal
  // meaning), so no separate due-date property is needed for that.
  'hs_next_step',
  'notes_next_activity_date',
  'hs_pinned_engagement_id',
  // The deal's own Deal Owner — deliberately separate from the
  // account_manager property read on the company. A deal can be (and
  // often is) closed by a different person than whoever currently owns
  // the account it rolls up to (Aaron, Sep 2026: "deals they closed
  // personally instead of deals that may have been added to portfolio
  // but were not added by them personally"). Resolved to a name the same
  // way account_manager is, via getAccountManagerName.
  'hubspot_owner_id',
  // Implementation/onboarding-project tracking (Sep 2026) — confirmed live
  // against a real deal (Viva Senior Living at South Bend) that these are
  // the exact fields behind the "Implementation" card HubSpot shows on a
  // company record: `project_progress` is the 0-100 display value ("100%"
  // on that card matched `project_progress: 100` exactly) — there's a
  // SEPARATE `project_progress_percent` property too, but that one's a
  // 0-1 fraction meant for other calculations, not display, so it's
  // deliberately left out here. Only recently adopted (roughly mid-2025
  // onward, per Aaron) — most historical deals carry null for all of
  // these, which is expected, not a bug.
  'project_status',
  'project_health_rag',
  'project_progress',
  'project_owner',
  'projected_golive_date',
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
      dealType: p.dealtype || null,
      amount: p.amount != null ? Number(p.amount) : null,
      arrValue: p.arr_value != null ? Number(p.arr_value) : null,
      closeDate: p.closedate || null,
      createdAt: p.createdate,
      lastModifiedAt: p.hs_lastmodifieddate,
      isClosed: p.hs_is_closed === 'true',
      isWon: p.hs_is_closed_won === 'true',
      nextStep: p.hs_next_step || null,
      nextActivityDate: p.notes_next_activity_date || null,
      dealOwnerId: p.hubspot_owner_id || null,
      // See DEAL_PROPERTIES' doc comment above — null on any deal that
      // predates implementation tracking, or was never an onboarding/
      // community-add deal to begin with.
      projectStatus: p.project_status || null,
      projectHealthRag: p.project_health_rag || null,
      projectProgress: p.project_progress != null ? Number(p.project_progress) : null,
      projectOwner: p.project_owner || null,
      projectedGoLiveDate: p.projected_golive_date || null,
      url: hubspotRecordUrl('deal', d.id),
      pinnedNoteId: p.hs_pinned_engagement_id || null,
    };
  });

  const openDeals = deals.filter((d) => !d.isClosed);
  const closedDeals = deals.filter((d) => d.isClosed && d.closeDate && new Date(d.closeDate) >= ninetyDaysAgo);
  // Sums arr_value, not the plain `amount` field (Aaron, Sep 2026: "Open
  // Deals & Value" should read as ARR) — same fix already applied to
  // arrAddedThisYearCents (accountHealth.js's mapLiveFinancialHealth):
  // `amount` is a deal's raw contract-value field (one-time fee, partial
  // add-on, anything), not an annualized figure, while `arr_value` is
  // purpose-built for this ((AL/IL capacity × negotiated rate) × 12).
  // Feeds every "Open Deal Value" display across the app (Account
  // Health/Team AM stat tiles, PDF/Excel exports, QBR deck, qbrFlags.js) —
  // one fix point, not a per-consumer patch.
  const totalOpenValue = openDeals.reduce((sum, d) => sum + (d.arrValue || 0), 0);

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

const TASK_PROPERTIES = ['hs_task_subject', 'hs_task_status', 'hs_timestamp', 'hs_task_is_overdue'];

/** Task IDs associated with one deal, via the v4 associations API — same pagination pattern as getLineItemIdsForDeal. */
async function getTaskIdsForDeal(dealId) {
  const ids = [];
  let after;
  do {
    const path = `/crm/v4/objects/deals/${dealId}/associations/tasks${after ? `?after=${encodeURIComponent(after)}` : ''}`;
    const { status, body } = await hubspotRequest('GET', path);
    if (status !== 200) {
      throw new Error(`HubSpot task associations lookup failed for deal ${dealId} (${status}): ${JSON.stringify(body)}`);
    }
    ids.push(...(body.results || []).map((r) => r.toObjectId));
    after = body.paging?.next?.after;
  } while (after);
  return ids;
}

/** Batch-read full task properties, chunked to HubSpot's 100-input cap — same reasoning as batchReadLineItems. */
async function batchReadTasks(taskIds) {
  if (taskIds.length === 0) return [];

  const results = [];
  for (const batch of chunk(taskIds, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/tasks/batch/read', {
      properties: TASK_PROPERTIES,
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200) {
      throw new Error(`HubSpot task batch read failed (${status}): ${JSON.stringify(body)}`);
    }
    results.push(...(body.results || []));
  }
  return results;
}

/**
 * Open tasks associated with one deal — for the Account Health Dashboard's
 * Deals view ("associated tasks to the deal", so a deal's status is
 * visible without leaving alis-hub). Scoped to open (not-completed) tasks
 * only, since a deal can accumulate a long history of already-done tasks
 * that aren't useful for "what's next." Deliberately swallows its own
 * errors and returns `null` (not `[]` — a real empty list of tasks reads
 * as "confirmed, none open"; a failed lookup should read as "unknown", not
 * "there are definitely no tasks") — this portal's private app token has
 * already been confirmed missing one HubSpot scope this session
 * (crm.objects.owners.read); tasks read access is unverified, and a
 * missing scope here shouldn't fail the whole portfolio refresh over
 * ancillary task visibility on one deal.
 */
async function getOpenTasksForDeal(dealId) {
  try {
    const taskIds = await getTaskIdsForDeal(dealId);
    const raw = await batchReadTasks(taskIds);
    return raw
      .filter((t) => (t.properties.hs_task_status || '').toUpperCase() !== 'COMPLETED')
      .map((t) => ({
        id: t.id,
        subject: t.properties.hs_task_subject,
        status: t.properties.hs_task_status,
        dueDate: t.properties.hs_timestamp || null,
        isOverdue: t.properties.hs_task_is_overdue === 'true',
        url: hubspotRecordUrl('task', t.id),
      }));
  } catch (err) {
    console.error(`[hubspotTickets] Failed to fetch tasks for deal ${dealId} — showing no tasks for it:`, err.message);
    return null;
  }
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

module.exports = {
  getTicketSummaryForCompany, getDealSummaryForCompany, getContractedModulesForCompany, getOpenTasksForDeal,
  enrichRepeatIssueFlags, enrichDealUrls, enrichOpenTickets, hubspotRecordUrl,
  hubspotRequest, chunk, getPipelineStageLabels,
};
