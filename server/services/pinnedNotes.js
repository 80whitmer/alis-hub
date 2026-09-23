/**
 * HubSpot pinned notes (hs_pinned_engagement_id on tickets, deals, and
 * companies) as display-safe segments: note HTML → an array of plain-text
 * strings and {label, href} links, so the client renders real clickable
 * links without ever injecting HubSpot HTML. Only http(s) links survive.
 * Aaron, Sep 2026: expand the pinned-note experience to every ticket,
 * deal, and Home Office on the AM dashboards (the Home Office pinned note
 * is an Evan Kuo initiative).
 */
const { hubspotRequest, chunk } = require('./hubspotTickets');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function fragmentToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n');
}

function htmlToText(html) {
  return fragmentToText(html || '').trim();
}

/** A usable absolute http(s) URL, or null — HubSpot sometimes stores a pasted label as the href ("http://alis%20-%20..."). */
function safeHref(raw) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const BARE_URL = /https?:\/\/[^\s<>"')]+/g;

function linkifyText(text, out) {
  let last = 0;
  for (const m of text.matchAll(BARE_URL)) {
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    const href = safeHref(raw);
    if (!href) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ label: raw, href });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
}

function htmlToSegments(html) {
  const out = [];
  const anchor = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let last = 0;
  let m;
  while ((m = anchor.exec(html))) {
    linkifyText(fragmentToText(html.slice(last, m.index)), out);
    const href = safeHref(decodeEntities(m[1]));
    const label = fragmentToText(m[2]).trim();
    if (href) out.push({ label: label || href, href });
    else if (label) out.push(label);
    last = anchor.lastIndex;
  }
  linkifyText(fragmentToText(html.slice(last)), out);
  if (typeof out[0] === 'string') out[0] = out[0].replace(/^\s+/, '');
  if (typeof out[out.length - 1] === 'string') out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '');
  return out.filter((s) => s !== '');
}

function toNote(id, properties) {
  const html = properties?.hs_note_body || '';
  const segments = htmlToSegments(html);
  return {
    id,
    modifiedAt: properties?.hs_lastmodifieddate || null,
    text: htmlToText(html),
    segments,
    links: segments.filter((s) => typeof s === 'object'),
  };
}

/** Map<id, note>. Ids that aren't notes (a pinned email/call) are simply absent. */
async function getPinnedNotes(ids) {
  const now = Date.now();
  const result = new Map();
  const missing = [];
  for (const id of new Set(ids.map(String))) {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      if (hit.note) result.set(id, hit.note);
    } else {
      missing.push(id);
    }
  }
  for (const batch of chunk(missing, 100)) {
    const { status, body } = await hubspotRequest('POST', '/crm/v3/objects/notes/batch/read', {
      properties: ['hs_note_body', 'hs_lastmodifieddate'],
      inputs: batch.map((id) => ({ id })),
    });
    if (status !== 200 && status !== 207) {
      throw new Error(`HubSpot pinned-note batch read failed (${status}): ${JSON.stringify(body)}`);
    }
    const found = new Map((body.results || []).map((n) => [String(n.id), toNote(String(n.id), n.properties)]));
    for (const id of batch) {
      const note = found.get(id) || null;
      cache.set(id, { at: now, note });
      if (note) result.set(id, note);
    }
  }
  return result;
}

module.exports = { getPinnedNotes, htmlToText, htmlToSegments, safeHref, decodeEntities };
