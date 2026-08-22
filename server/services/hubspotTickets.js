const https = require('https');

/**
 * Pulls HubSpot tickets associated with a company for the QBR pipeline's
 * Support Review / Enhancement Requests sections.
 *
 * Reuses the Bearer-auth-over-raw-https pattern from server/api/hubspot.js.
 * Property names (hs_ticket_category, hs_pipeline_stage) match HubSpot's
 * default ticket object — confirm against the real portal on first run and
 * adjust TICKET_PROPERTIES / bucketing below if the portal uses custom
 * property names for category/status.
 */

const TICKET_PROPERTIES = [
  'subject',
  'content',
  'hs_pipeline',
  'hs_pipeline_stage',
  'hs_ticket_category',
  'hs_ticket_priority',
  'createdate',
  'hs_lastmodifieddate',
  'closed_date',
];

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

/** Ticket IDs associated with a company, via the v4 associations API. */
async function getTicketIdsForCompany(companyId) {
  const { status, body } = await hubspotRequest(
    'GET',
    `/crm/v4/objects/companies/${companyId}/associations/tickets`
  );
  if (status !== 200) {
    throw new Error(`HubSpot associations lookup failed (${status}): ${JSON.stringify(body)}`);
  }
  return (body.results || []).map((r) => r.toObjectId);
}

/** Batch-read full ticket properties for a list of ticket IDs. */
async function batchReadTickets(ticketIds) {
  if (ticketIds.length === 0) return [];

  const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/tickets/batch/read', {
    properties: TICKET_PROPERTIES,
    inputs: ticketIds.map((id) => ({ id })),
  });
  if (status !== 200) {
    throw new Error(`HubSpot ticket batch read failed (${status}): ${JSON.stringify(body)}`);
  }
  return body.results || [];
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

  const tickets = raw.map((t) => ({
    id: t.id,
    subject: t.properties.subject,
    category: t.properties.hs_ticket_category || 'uncategorized',
    pipelineStage: t.properties.hs_pipeline_stage,
    priority: t.properties.hs_ticket_priority,
    createdAt: t.properties.createdate,
    closedAt: t.properties.closed_date || null,
    isOpen: !t.properties.closed_date,
    daysOpen: daysOpen(t),
  }));

  const byCategory = {};
  for (const t of tickets) {
    byCategory[t.category] = byCategory[t.category] || { total: 0, open: 0, closed: 0 };
    byCategory[t.category].total++;
    byCategory[t.category][t.isOpen ? 'open' : 'closed']++;
  }

  const openTickets = tickets.filter((t) => t.isOpen);
  const agingOpenTickets = openTickets.filter((t) => (t.daysOpen || 0) > 90);

  return {
    total: tickets.length,
    open: openTickets.length,
    closed: tickets.length - openTickets.length,
    byCategory,
    agingOpenTickets,
    tickets,
  };
}

module.exports = { getTicketSummaryForCompany };
