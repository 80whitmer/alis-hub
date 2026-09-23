import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PinnedNoteBody } from './PinnedNote';

/**
 * "Tickets: ALIS Internal" — shared by Account Health and Team AM. Aaron,
 * Sep 2026: these disposable, iterative internal tickets (and the links
 * piled into their pinned notes) are a resource index — "state of the state
 * gold." Searchable across subject/description/next step/pinned note/link
 * labels, deep-linkable via ?internal=<query> (so a Chrome site-search
 * shortcut can land straight on a search), and click-counted from here,
 * since HubSpot's API doesn't expose record view counts.
 */

export const INTERNAL_SECTION_TITLE = 'Tickets: ALIS Internal';
export const INTERNAL_QUERY_PARAM = 'internal';
const INTERNAL_SECTION_ID = 'tickets-alis-internal';

/** When the page URL carries ?internal=, expand-and-scroll to this section once the page's sections have rendered. */
export function useInternalDeepLink(ready, jumpEvent) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    if (!new URLSearchParams(window.location.search).has(INTERNAL_QUERY_PARAM)) return;
    done.current = true;
    // setTimeout, not requestAnimationFrame — rAF never fires in a background tab, which is exactly where a Chrome site-search link can open.
    setTimeout(() => window.dispatchEvent(new CustomEvent(jumpEvent, { detail: { id: INTERNAL_SECTION_ID } })), 0);
  }, [ready, jumpEvent]);
}

// Shared across both dashboards for the browser session; Refresh re-pulls.
let cached = null;

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '—';
}

function fmtTimestamp(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

function trackClick(ticketId, target) {
  fetch(`/api/internal-tickets/${ticketId}/click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
    keepalive: true,
  }).catch(() => {});
}

/** Opens in a new tab like any link; counts left and middle clicks. */
function TrackedLink({ href, ticketId, target, onTracked, className, title, children }) {
  const handle = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    trackClick(ticketId, target);
    onTracked?.();
  };
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={handle} onAuxClick={handle} className={className} title={title}>
      {children}
    </a>
  );
}

const HEATMAP_WEEKS = 53;
const HEAT_COLORS = ['#ebedf0', '#e9d5ff', '#c4b5fd', '#8b5cf6', '#6d28d9'];

function heatLevel(count, max) {
  if (!count) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** GitHub-style created-date heatmap — same plain-CSS-grid pattern as EscalationRequestsSection.jsx's (duplicated per this codebase's per-component convention). */
function CreatedHeatmap({ items }) {
  const { cells, monthLabels } = useMemo(() => {
    const countByDate = {};
    for (const t of items) {
      if (!t.createdAt) continue;
      const day = t.createdAt.slice(0, 10);
      countByDate[day] = (countByDate[day] || 0) + 1;
    }
    const max = Math.max(0, ...Object.values(countByDate));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (HEATMAP_WEEKS * 7 - 1));
    const days = [];
    const labels = [];
    let lastMonth = null;
    for (let i = 0, d = new Date(start); d <= end; i++, d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const count = countByDate[iso] || 0;
      const inFuture = d > today;
      days.push({ iso, count: inFuture ? null : count, level: inFuture ? null : heatLevel(count, max) });
      if (d.getUTCDay() === 0 && d.getUTCMonth() !== lastMonth) {
        labels.push({ week: Math.floor(i / 7), label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
        lastMonth = d.getUTCMonth();
      }
    }
    return { cells: days, monthLabels: labels };
  }, [items]);

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto" style={{ width: HEATMAP_WEEKS * 13 }}>
        <div style={{ position: 'relative', height: 14, marginBottom: 4 }}>
          {monthLabels.map(({ week, label }) => (
            <span key={`${week}-${label}`} className="text-xs text-neutral-400" style={{ position: 'absolute', left: week * 13 }}>{label}</span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gridAutoColumns: '11px', gap: 2 }}>
          {cells.map((c) => (
            <div
              key={c.iso}
              title={c.count == null ? '' : `${c.iso}: ${c.count} ticket${c.count === 1 ? '' : 's'} created`}
              style={{ width: 11, height: 11, borderRadius: 2, background: c.level == null ? 'transparent' : HEAT_COLORS[c.level] }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 mt-2 text-xs text-neutral-400">
        <span>Fewer</span>
        {HEAT_COLORS.map((color) => <span key={color} style={{ width: 11, height: 11, borderRadius: 2, background: color, display: 'inline-block' }} />)}
        <span>More</span>
      </div>
    </div>
  );
}

/** Weekly count of internal tickets open as of each week's end, replayed from createdAt/closedAt — no snapshot table needed. */
function OpenOverTimeChart({ items }) {
  const rows = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    return Array.from({ length: 52 }, (_, i) => {
      const weekEnd = new Date(end);
      weekEnd.setUTCDate(weekEnd.getUTCDate() - (51 - i) * 7);
      let open = 0;
      let created = 0;
      for (const t of items) {
        if (!t.createdAt || new Date(t.createdAt) > weekEnd) continue;
        created += 1;
        if (!t.closedAt || new Date(t.closedAt) > weekEnd) open += 1;
      }
      return { date: weekEnd.toISOString().slice(0, 10), open, created };
    });
  }, [items]);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={Math.max(0, Math.ceil(rows.length / 12) - 1)} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="open" name="Still open" stroke="#6d28d9" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="created" name="Created (cumulative)" stroke="#a3a3a3" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-primary-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function matchesSearch(t, q) {
  if (!q) return true;
  const haystack = [
    t.subject, t.topic, t.subtopic, t.description, t.nextStep, t.pinnedNote, t.stage, t.module,
    ...t.tags, ...t.links.map((l) => `${l.label || ''} ${l.source} ${l.url}`),
  ].filter(Boolean).join('\n').toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

const SORTS = {
  created: { label: 'Newest', fn: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') },
  updated: { label: 'Recently updated', fn: (a, b) => (b.lastModifiedAt || '').localeCompare(a.lastModifiedAt || '') },
  clicks: { label: 'Most clicked', fn: (a, b) => b.clicks - a.clicks || b.clicks30d - a.clicks30d },
  links: { label: 'Most links', fn: (a, b) => b.links.length - a.links.length },
};

const TOP_TOPIC_PILLS = 10;
const PAGE_SIZE = 40;

function TicketCard({ t, onTracked, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const previewLinks = t.links.slice(0, 5);
  return (
    <div className="border border-neutral-200 rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{t.topic}</span>
            {t.subtopic && <span className="text-[11px] text-neutral-500">{t.subtopic}</span>}
            {!t.isOpen && <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">Closed</span>}
            {t.tags.map((tag) => <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">{tag}</span>)}
          </div>
          <TrackedLink href={t.url} ticketId={t.ticketId} target="hubspot" onTracked={onTracked} className="font-medium text-primary-900 hover:underline">
            {t.subject}
          </TrackedLink>
          <p className="text-xs text-neutral-400 mt-1">
            {t.stage} · created {fmtDate(t.createdAt)} · updated {fmtDate(t.lastModifiedAt)}
            {t.ownerName && t.ownerName !== 'Aaron Whitmer' ? ` · ${t.ownerName}` : ''}
          </p>
        </div>
        <div className="text-right text-xs text-neutral-500 shrink-0">
          <div>{t.links.length} link{t.links.length === 1 ? '' : 's'}</div>
          <div title="Clicks from this dashboard (all time / last 30 days)">{t.clicks} click{t.clicks === 1 ? '' : 's'}{t.clicks30d ? ` · ${t.clicks30d} in 30d` : ''}</div>
        </div>
      </div>
      {previewLinks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {previewLinks.map((l) => (
            <TrackedLink
              key={l.url}
              href={l.url}
              ticketId={t.ticketId}
              target={l.url}
              onTracked={onTracked}
              title={l.url}
              className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700 hover:border-accent-400 hover:text-accent-600 max-w-[260px] truncate"
            >
              <span className="font-semibold">{l.source}</span>{l.label ? ` · ${l.label}` : ''}
            </TrackedLink>
          ))}
          {t.links.length > previewLinks.length && <span className="text-[11px] text-neutral-400 self-center">+{t.links.length - previewLinks.length} more</span>}
        </div>
      )}
      {(t.description || t.nextStep || t.pinnedNote || t.links.length > previewLinks.length) && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-neutral-500 hover:text-accent-600 mt-2">
          {open ? '▲ Hide details' : '▼ Description, next step, pinned note & all links'}
        </button>
      )}
      {open && (
        <div className="mt-2 space-y-2 text-xs text-neutral-700">
          {t.description && <div><p className="font-semibold text-neutral-500 uppercase tracking-wide text-[11px]">Description</p><p className="whitespace-pre-wrap">{t.description}</p></div>}
          {t.nextStep && <div><p className="font-semibold text-neutral-500 uppercase tracking-wide text-[11px]">Next step</p><p className="whitespace-pre-wrap">{t.nextStep}</p></div>}
          {t.pinnedNote && (
            <div>
              <p className="font-semibold text-neutral-500 uppercase tracking-wide text-[11px]">Pinned note{t.pinnedNoteModifiedAt ? ` · updated ${fmtDate(t.pinnedNoteModifiedAt)}` : ''}</p>
              <PinnedNoteBody segments={t.pinnedNoteSegments} className="max-h-72 overflow-y-auto border border-neutral-100 rounded-lg p-2 bg-neutral-50" />
            </div>
          )}
          {t.links.length > 0 && (
            <div>
              <p className="font-semibold text-neutral-500 uppercase tracking-wide text-[11px]">All links</p>
              <ul className="space-y-0.5">
                {t.links.map((l) => (
                  <li key={l.url} className="truncate">
                    <span className="text-neutral-400">{l.source}:</span>{' '}
                    <TrackedLink href={l.url} ticketId={t.ticketId} target={l.url} onTracked={onTracked} className="hover:underline" title={l.url}>
                      {l.label || l.url}
                    </TrackedLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlisInternalSection({ pagePath }) {
  const [data, setData] = useState(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get(INTERNAL_QUERY_PARAM) || '');
  const [status, setStatus] = useState('open');
  const [topic, setTopic] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('created');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showTip, setShowTip] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/internal-tickets${refresh ? '?refresh=1' : ''}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      cached = body;
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cached) load();
  }, []);

  // Optimistic local bump so a click shows up in counts/Hot Topics without a re-pull.
  function bumpClick(ticketId) {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, tickets: prev.tickets.map((t) => (t.ticketId === ticketId ? { ...t, clicks: t.clicks + 1, clicks30d: t.clicks30d + 1 } : t)) };
      cached = next;
      return next;
    });
  }

  const tickets = data?.tickets || [];
  const statusScoped = useMemo(
    () => tickets.filter((t) => (status === 'all' ? true : status === 'open' ? t.isOpen : !t.isOpen)),
    [tickets, status]
  );

  const topicCounts = useMemo(() => {
    const counts = new Map();
    for (const t of statusScoped) counts.set(t.topic, (counts.get(t.topic) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [statusScoped]);
  const stages = useMemo(() => [...new Set(tickets.map((t) => t.stage))].sort(), [tickets]);
  const sources = useMemo(() => {
    const counts = new Map();
    for (const t of tickets) for (const s of new Set(t.links.map((l) => l.source))) counts.set(s, (counts.get(s) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => statusScoped
      .filter((t) => !topic || t.topic === topic)
      .filter((t) => !stage || t.stage === stage)
      .filter((t) => !source || t.links.some((l) => l.source === source))
      .filter((t) => matchesSearch(t, q))
      .sort(SORTS[sort].fn),
    [statusScoped, topic, stage, source, q, sort]
  );

  const hotTopics = useMemo(
    () => tickets.filter((t) => t.clicks > 0).sort((a, b) => b.clicks30d - a.clicks30d || b.clicks - a.clicks).slice(0, 8),
    [tickets]
  );

  const openCount = tickets.filter((t) => t.isOpen).length;
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const created30 = tickets.filter((t) => t.createdAt && t.createdAt >= since30).length;
  const withLinks = tickets.filter((t) => t.links.length > 0);
  const linkTotal = tickets.reduce((s, t) => s + t.links.length, 0);
  const clicks30 = tickets.reduce((s, t) => s + t.clicks30d, 0);
  const searchUrl = `${window.location.origin}${pagePath}?${INTERNAL_QUERY_PARAM}=%s`;

  if (!data) {
    return loading
      ? <p className="text-sm text-neutral-500">Pulling ALIS Internal tickets from HubSpot…</p>
      : <p className="text-sm text-red-600">{error || 'Not loaded.'} <button type="button" className="underline" onClick={() => load()}>Retry</button></p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <button type="button" className="text-xs px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300" onClick={() => load(true)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="text-xs text-neutral-400">Last pulled {fmtTimestamp(data.fetchedAt)}</span>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <button type="button" className="text-xs text-neutral-500 hover:text-accent-600" onClick={() => setShowTip((v) => !v)}>
          {showTip ? 'Hide' : 'Search this from Chrome\'s address bar'}
        </button>
      </div>
      {showTip && (
        <div className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg p-3 mb-4">
          In Chrome: Settings → Search engine → Manage search engines and site search → Site search → Add. Name it "ALIS Internal",
          shortcut <code>ai</code>, URL <code className="select-all">{searchUrl}</code>. Then type <code>ai</code> + Space + your search
          in the address bar to land here with the results filtered. Any search here can also be shared as a link:{' '}
          <code className="select-all">{searchUrl.replace('%s', encodeURIComponent(search.trim() || 'slack'))}</code>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatTile label="Open" value={openCount} sub={`${tickets.length - openCount} closed`} />
        <StatTile label="Created (30d)" value={created30} />
        <StatTile label="Resource Links" value={linkTotal} sub={`across ${withLinks.length} tickets`} />
        <StatTile label="Clicks (30d)" value={clicks30} sub="from this dashboard" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Created — Trailing 12 Months</h4>
          <CreatedHeatmap items={tickets} />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Open Internal Tickets Over Time</h4>
          <OpenOverTimeChart items={tickets} />
        </div>
      </div>

      <div className="mb-6">
        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Hot Topics</h4>
        {hotTopics.length === 0 ? (
          <p className="text-xs text-neutral-500 italic">
            No clicks recorded yet. Clicks on ticket and resource links below are counted here (HubSpot doesn't expose record views, so only clicks from this dashboard count).
          </p>
        ) : (
          <ol className="space-y-1">
            {hotTopics.map((t) => (
              <li key={t.ticketId} className="text-sm flex items-baseline gap-2">
                <span className="text-xs text-neutral-400 w-20 shrink-0">{t.clicks30d} in 30d · {t.clicks}</span>
                <TrackedLink href={t.url} ticketId={t.ticketId} target="hubspot" onTracked={() => bumpClick(t.ticketId)} className="text-primary-900 hover:underline truncate">
                  {t.subject}
                </TrackedLink>
              </li>
            ))}
          </ol>
        )}
      </div>

      <input
        placeholder="Search subject, description, next step, pinned note, or link names…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }}
        className="w-full mb-3"
      />
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([key, label]) => (
          <Pill key={key} active={status === key} onClick={() => setStatus(key)}>{label}</Pill>
        ))}
        <span className="w-px h-5 bg-neutral-200 mx-1" />
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="text-xs border border-neutral-200 rounded-lg px-2 py-1">
          <option value="">All stages</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="text-xs border border-neutral-200 rounded-lg px-2 py-1">
          <option value="">Any links</option>
          {sources.map(([s, n]) => <option key={s} value={s}>Has {s} link ({n})</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="text-xs border border-neutral-200 rounded-lg px-2 py-1">
          {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>Sort: {s.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <Pill active={!topic} onClick={() => setTopic('')}>All topics ({statusScoped.length})</Pill>
        {topicCounts.slice(0, TOP_TOPIC_PILLS).map(([name, n]) => (
          <Pill key={name} active={topic === name} onClick={() => setTopic(topic === name ? '' : name)}>{name} ({n})</Pill>
        ))}
        {topicCounts.length > TOP_TOPIC_PILLS && (
          <select
            value={topicCounts.slice(0, TOP_TOPIC_PILLS).some(([name]) => name === topic) ? '' : topic}
            onChange={(e) => setTopic(e.target.value)}
            className="text-xs border border-neutral-200 rounded-lg px-2 py-1"
          >
            <option value="">More topics…</option>
            {topicCounts.slice(TOP_TOPIC_PILLS).map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
          </select>
        )}
      </div>

      <p className="text-xs text-neutral-400 mb-2">{filtered.length} of {statusScoped.length} tickets</p>
      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No internal tickets match.</p>
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, limit).map((t) => (
            <TicketCard key={t.ticketId} t={t} onTracked={() => bumpClick(t.ticketId)} defaultOpen={Boolean(q) && filtered.length <= 3} />
          ))}
        </div>
      )}
      {filtered.length > limit && (
        <button type="button" className="text-xs text-accent-600 hover:underline mt-3" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
        </button>
      )}
    </div>
  );
}
