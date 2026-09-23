/**
 * ALIS Internal tickets (category_2_0 = "ALIS Internal") — excluded from
 * every client-facing ticket count in getTicketSummaryForCompany, and
 * usually not associated with any company, so they need their own
 * portal-wide search rather than the per-company pull. Aaron, Sep 2026:
 * these are disposable, iterative capture tickets whose pinned notes
 * collect links (Slack threads, Google Docs, Jira, Loom, ...) — surfaced
 * as a searchable resource index on both dashboards.
 */
const { hubspotRequest, chunk, getPipelineStageLabels, hubspotRecordUrl } = require('./hubspotTickets');
const { getAccountManagerName } = require('./hubspotAccounts');

const INTERNAL_CATEGORY = 'ALIS Internal';
const PROPERTIES = [
  'subject', 'content', 'next_step', 'hs_pipeline', 'hs_pipeline_stage', 'createdate', 'closed_date',
  'hs_lastmodifieddate', 'hubspot_owner_id', 'alis_tags', 'alis_module', 'hs_pinned_engagement_id',
];

const LINK_SOURCES = [
  [/slack\.com$/, 'Slack'],
  [/^docs\.google\.com$/, 'Google Doc'],
  [/^drive\.google\.com$/, 'Google Drive'],
  [/^mail\.google\.com$/, 'Gmail'],
  [/atlassian\.net$/, 'Jira / Confluence'],
  [/hubspot\.com$/, 'HubSpot'],
  [/alisonline\.com$/, 'ALIS'],
  [/loom\.com$/, 'Loom'],
  [/vimeo\.com$/, 'Vimeo'],
  [/read\.ai$/, 'Read.ai'],
];

function linkSource(host) {
  const match = LINK_SOURCES.find(([re]) => re.test(host));
  return match ? match[1] : host.replace(/^www\./, '');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();
}

/** Anchors in note HTML plus bare URLs in plain text. Only http(s) links survive — a malformed href (HubSpot occasionally stores "http://alis%20-%20..." from a pasted label) is dropped rather than rendered as a dead link. */
function extractLinks(html, plainText) {
  const found = new Map();
  const add = (rawUrl, label) => {
    let url;
    try {
      url = new URL(decodeEntities(rawUrl));
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) return;
    const href = url.toString();
    if (found.has(href)) return;
    const text = label && label.trim() && label.trim() !== href ? label.trim() : null;
    found.set(href, { url: href, label: text, source: linkSource(url.hostname) });
  };
  for (const m of (html || '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    add(m[1], htmlToText(m[2]));
  }
  for (const m of (plainText || '').matchAll(/https?:\/\/[^\s<>"')]+/g)) add(m[0], null);
  return [...found.values()];
}

/** Topic from the "ALIS - Topic - Subtopic" subject convention these tickets follow (e.g. "ALIS - AM - Learning - Finance" → AM / Learning). */
const TOPIC_ALIASES = { integrations: 'Integration', enhancements: 'Enhancement', transitions: 'Transition', escalations: 'Escalation', alispay: 'ALIS Pay', 'alis pay': 'ALIS Pay', hubspot: 'HubSpot' };

function parseTopic(subject) {
  const parts = (subject || '')
    .split(/\s+-{1,2}\s+|\s+—\s+/)
    .map((s) => s.replace(/^[-–—\s]+|[-–—\s]+$/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter((s) => s && !/^alis( internal)?$/i.test(s));
  if (parts.length < 2) return { topic: 'General', subtopic: null };
  const raw = parts[0];
  // Long first segments are sentences, not topics ("language around OB to AM handoff…").
  const topic = TOPIC_ALIASES[raw.toLowerCase()] || (raw.length > 28 ? 'General' : raw);
  return { topic, subtopic: parts.length > 2 ? parts[1] : null };
}

async function searchInternalTickets() {
  const tickets = [];
  let after;
  do {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/tickets/search', {
      filterGroups: [{ filters: [{ propertyName: 'category_2_0', operator: 'EQ', value: INTERNAL_CATEGORY }] }],
      properties: PROPERTIES,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (status !== 200) throw new Error(`HubSpot ALIS Internal ticket search failed (${status}): ${JSON.stringify(body)}`);
    tickets.push(...(body.results || []));
    after = body.paging?.next?.after;
  } while (after && tickets.length < 10000);
  return tickets;
}

/** Map<noteId, {html, modifiedAt}> — a pinned engagement that isn't a note (email/call) just doesn't come back. */
async function readPinnedNotes(ids) {
  const result = new Map();
  for (const batch of chunk([...new Set(ids)], 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/notes/batch/read', {
      properties: ['hs_note_body', 'hs_lastmodifieddate'],
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200 && status !== 207) throw new Error(`HubSpot pinned-note batch read failed (${status}): ${JSON.stringify(body)}`);
    for (const n of body.results || []) {
      result.set(n.id, { html: n.properties?.hs_note_body || '', modifiedAt: n.properties?.hs_lastmodifieddate || null });
    }
  }
  return result;
}

async function getInternalTickets() {
  const raw = await searchInternalTickets();
  let stageLabels = new Map();
  try {
    stageLabels = await getPipelineStageLabels('tickets');
  } catch {
    // Raw ids are still usable as filter values.
  }
  let notes = new Map();
  try {
    notes = await readPinnedNotes(raw.map((t) => t.properties.hs_pinned_engagement_id).filter(Boolean));
  } catch (err) {
    console.warn('ALIS Internal pinned-note read failed; continuing without notes:', err.message);
  }

  return raw.map((t) => {
    const p = t.properties;
    const label = stageLabels.get(`${p.hs_pipeline}:${p.hs_pipeline_stage}`);
    const note = p.hs_pinned_engagement_id ? notes.get(p.hs_pinned_engagement_id) : null;
    const description = p.content ? htmlToText(p.content) : null;
    const pinnedNote = note?.html ? htmlToText(note.html) : null;
    const nextStep = p.next_step || null;
    return {
      ticketId: t.id,
      subject: p.subject || '(no subject)',
      ...parseTopic(p.subject),
      description,
      nextStep,
      pinnedNote,
      pinnedNoteModifiedAt: note?.modifiedAt || null,
      links: [
        ...extractLinks(note?.html, null),
        ...extractLinks(p.content, description),
        ...extractLinks(null, nextStep),
      ].filter((l, i, all) => all.findIndex((x) => x.url === l.url) === i),
      pipeline: label?.pipeline || p.hs_pipeline,
      stage: label?.stage || p.hs_pipeline_stage,
      tags: p.alis_tags ? p.alis_tags.split(';').filter(Boolean) : [],
      module: p.alis_module || null,
      ownerName: p.hubspot_owner_id ? getAccountManagerName(p.hubspot_owner_id) : 'Unassigned',
      isOpen: !p.closed_date,
      createdAt: p.createdate || null,
      closedAt: p.closed_date || null,
      lastModifiedAt: p.hs_lastmodifieddate || null,
      url: hubspotRecordUrl('ticket', t.id),
    };
  });
}

module.exports = { getInternalTickets };
