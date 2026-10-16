import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import PinnedNoteButton from './PinnedNote';
import { exportTicketActivity } from '../utils/ticketActivityExport';
import { SECTION_SEARCH_SET_EVENT } from '../utils/sectionSearchBus';

// The SectionCard title this table lives under on both dashboards (see
// each dashboard's own call site) — reused as the global search's hit
// title and as the section-search-bus key, so a hit and this component
// always agree on identity.
export const TICKET_ACTIVITY_TITLE = 'Ticket Activity';

const STATUS_PILLS = [
  { key: 'open', label: 'Open' },
  { key: 'longTerm', label: 'Long-Term Projects' },
  { key: 'completed', label: 'Completed' },
  { key: 'closed', label: 'Closed' },
];

// Mutually exclusive so counts foot to the total (Sep 2026, Aaron: "filter
// out the 'Completed' from the open, and add in a filter pill for
// 'Completed'", then "I am hoping to capture and manage tickets that are
// in the Client Submitted and In Progress stage here... the KPI [should]
// capture only Client Submitted and In Progress... add a long-term
// projects filter pill") — "open" is now the true focused working queue
// (same two stages as the Open Ticket Volume chart above/isFocusedQueue
// elsewhere on these dashboards), not just "anything not yet closed."
// Long-Term Projects gets its own bucket/pill rather than folding into
// "open" or disappearing — still reachable in this table, just not
// counted toward the Open Tickets KPI. A ticket in some other open stage
// (Not Started, Waiting for confirmation, etc.) falls through to 'other' —
// not surfaced as its own pill, but still included whenever no status
// filter is applied.
function ticketBucket(t) {
  if (t.pipelineStageLabel === 'Completed') return 'completed';
  if (t.pipelineStageLabel === 'Long-Term Projects') return 'longTerm';
  if (!t.isOpen) return 'closed';
  if (t.pipelineStageLabel === 'Client Submitted' || t.pipelineStageLabel === 'In Progress') return 'open';
  return 'other';
}

function tierStr(tier) {
  return (tier == null || tier === 0) ? '—' : `Tier ${tier}`;
}
function tierLabel(tier) {
  return (tier == null || tier === 0) ? 'Unassigned' : `Tier ${tier}`;
}
// Same canonical tier palette as every other tier chart across all 3
// dashboards (1 = green, 2 = blue, 3 = orange, 4 = red) — duplicated, not
// shared/imported, per this codebase's per-file convention.
const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Unassigned'];
const TIER_COLOR = { 'Tier 1': '#16a34a', 'Tier 2': '#2563eb', 'Tier 3': '#ea580c', 'Tier 4': '#dc2626', Unassigned: '#737373' };
function tierSort(a, b) {
  const ai = TIER_ORDER.indexOf(a.name);
  const bi = TIER_ORDER.indexOf(b.name);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}
function currencyStr(cents) {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function CompanyLink({ account, children }) {
  if (!account.hubspotUrl) return <span>{children}</span>;
  return (
    <a href={account.hubspotUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">
      {children}
    </a>
  );
}

function SortableHeader({ label, column, sort, onSort, className = '' }) {
  const active = sort.column === column;
  return (
    <th className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-neutral-700 ${className}`} onClick={() => onSort(column)}>
      {label}{active && <span className="ml-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

/** Matches TicketTable's own search predicate — reused by each dashboard's computeGlobalSearchHits so the header dropdown's count matches what typing the same query into this table would return. */
export function ticketMatchesQuery(t, q) {
  if (!q) return true;
  return (
    (t.subject || '').toLowerCase().includes(q) ||
    (t.companyName || '').toLowerCase().includes(q) ||
    (t.category || '').toLowerCase().includes(q) ||
    (t.nextStep || '').toLowerCase().includes(q) ||
    (t.accountManagerName || '').toLowerCase().includes(q)
  );
}

/** "By Client Tier" bar chart for currently-open (non-Completed) tickets — same shape as EscalationRequestsSection's EscalationsByTierChart. */
function TicketsByTierChart({ items }) {
  const byTier = {};
  for (const t of items) {
    const key = tierLabel(t.tier);
    byTier[key] = (byTier[key] || 0) + 1;
  }
  const data = Object.entries(byTier).map(([name, count]) => ({ name, count })).sort(tierSort);

  if (data.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No open tickets to break down.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 13 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" name="Open Tickets" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={TIER_COLOR[d.name] || '#737373'} />)}
          <LabelList dataKey="count" position="top" style={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Searchable/filterable/sortable/exportable ticket rollup under Ticket
 * Activity's charts (Aaron, Sep 2026 — first "add a tickets table... search
 * bar and pill filters", then "I would love this parity" with the
 * Escalation/Enhancement sections: avg-age tile, by-tier chart, sortable +
 * exportable table, then "filter out Completed from open... make the
 * filter pills multi select... add a row of account manager filter pills
 * under the tiers... update the search bar and export button after the
 * Escalation section's design/placement"). Shared between AH's
 * TicketActivityHeatmap and Team AM's TicketActivitySection — same enriched
 * ticketDates shape (subject/url/category/pinnedNoteId/nextStep/isOpen,
 * plus tier/companyName/hubspotUrl/arrCents/totalCapacity/daysOpen/
 * companyPosition attached by the caller's own flatMap). `items` is
 * expected to already exclude Enhancement/Escalation tickets — those have
 * their own dedicated sections.
 */
export default function TicketTable({ items, showAccountManager = false }) {
  const [query, setQuery] = useState('');
  // Multiselect status/Tier/AM pills (Sep 2026, Aaron: "make the filter
  // pills multi select... add a row of account manager filter pills under
  // the tiers") — each is a Set of active keys, empty = no filter applied,
  // same pattern EscalationRequestsSection's own tierFilter already used.
  const [statusFilter, setStatusFilter] = useState(() => new Set(['open']));
  const [tierFilter, setTierFilter] = useState(() => new Set());
  const [amFilter, setAmFilter] = useState(() => new Set());
  const [sort, setSort] = useState({ column: 'daysOpen', direction: 'desc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  // Lets the page-level global search push a query into this table's own
  // search box (Aaron: "both of these search bars should be wired in with
  // the global search bar").
  useEffect(() => {
    function handleSetSearch(e) {
      if (e.detail?.key === TICKET_ACTIVITY_TITLE && typeof e.detail?.query === 'string') setQuery(e.detail.query);
    }
    window.addEventListener(SECTION_SEARCH_SET_EVENT, handleSetSearch);
    return () => window.removeEventListener(SECTION_SEARCH_SET_EVENT, handleSetSearch);
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, open: 0, longTerm: 0, completed: 0, closed: 0, other: 0 };
    for (const t of items) c[ticketBucket(t)] += 1;
    return c;
  }, [items]);

  const openItems = useMemo(() => items.filter((t) => ticketBucket(t) === 'open'), [items]);
  const avgAgeDays = openItems.length
    ? Math.round(openItems.reduce((sum, t) => sum + (t.daysOpen || 0), 0) / openItems.length)
    : null;

  const searchFilteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((t) => {
      if (statusFilter.size > 0 && !statusFilter.has(ticketBucket(t))) return false;
      return ticketMatchesQuery(t, q);
    });
  }, [items, query, statusFilter]);

  const tierFilteredItems = useMemo(() => {
    if (tierFilter.size === 0) return searchFilteredItems;
    return searchFilteredItems.filter((t) => tierFilter.has(tierLabel(t.tier)));
  }, [searchFilteredItems, tierFilter]);

  const filtered = useMemo(() => {
    if (amFilter.size === 0) return tierFilteredItems;
    return tierFilteredItems.filter((t) => amFilter.has(t.accountManagerName || 'Unassigned'));
  }, [tierFilteredItems, amFilter]);

  function toggleSort(column) {
    setSort((prev) => (prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' }));
  }

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filtered, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportTicketActivity(sorted, showAccountManager);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function toggleInSet(setter, value) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Open Tickets</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{counts.open}</p>
          <p className="text-xs text-neutral-400 mt-0.5">Client Submitted + In Progress — excludes Long-Term Projects</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500 uppercase tracking-wide">Average Age</p>
          <p className="text-2xl font-bold text-primary-900 mt-1">{avgAgeDays != null ? `${avgAgeDays}d` : '—'}</p>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold text-primary-900 text-sm mb-3">By Client Tier</h3>
        <TicketsByTierChart items={openItems} />
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-primary-900 text-sm">Tickets</h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tickets…"
            className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-64"
          />
          <button onClick={handleExport} disabled={exporting || sorted.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
        </div>
      </div>
      {exportError && <p className="text-xs text-error mb-2">{exportError}</p>}

      <div className="flex flex-wrap items-center gap-2 mb-2">
        {STATUS_PILLS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => toggleInSet(setStatusFilter, p.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter.has(p.key) ? 'bg-accent-500 text-white border-accent-500' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'}`}
          >
            {p.label} ({counts[p.key]})
          </button>
        ))}
        {statusFilter.size > 0 && (
          <button type="button" onClick={() => setStatusFilter(new Set())} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
            Clear filter
          </button>
        )}
      </div>

      {searchFilteredItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {TIER_ORDER.filter((t) => t !== 'Tier 5').map((t) => {
            const tCount = searchFilteredItems.filter((r) => tierLabel(r.tier) === t).length;
            if (tCount === 0) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleInSet(setTierFilter, t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  tierFilter.has(t)
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {t} ({tCount})
              </button>
            );
          })}
          {tierFilter.size > 0 && (
            <button type="button" onClick={() => setTierFilter(new Set())} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
              Clear filter
            </button>
          )}
        </div>
      )}

      {showAccountManager && searchFilteredItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {[...new Set(searchFilteredItems.map((r) => r.accountManagerName || 'Unassigned'))].sort().map((am) => {
            const amCount = searchFilteredItems.filter((r) => (r.accountManagerName || 'Unassigned') === am).length;
            return (
              <button
                key={am}
                type="button"
                onClick={() => toggleInSet(setAmFilter, am)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  amFilter.has(am)
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {am} ({amCount})
              </button>
            );
          })}
          {amFilter.size > 0 && (
            <button type="button" onClick={() => setAmFilter(new Set())} className="text-xs text-neutral-400 hover:text-neutral-600 underline">
              Clear filter
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No tickets match.</p>
      ) : (
        <div className="overflow-x-auto border border-neutral-100 rounded-lg" style={{ maxHeight: 1440, overflowY: 'auto' }}>
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50 sticky top-0">
              <tr className="text-left text-neutral-500">
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} />
                {showAccountManager && <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} />}
                <SortableHeader label="Subject" column="subject" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Category" column="category" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Status" column="pipelineStageLabel" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Created" column="createdAt" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Days Open" column="daysOpen" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Next Step" column="nextStep" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Tier" column="tier" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Size" column="totalCapacity" sort={sort} onSort={toggleSort} />
                <SortableHeader label="ARR" column="arrCents" sort={sort} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium">Company Tickets</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 500).map((t, i) => (
                <tr key={`${t.hubspotCompanyId}-${t.ticketId || i}`} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-3 py-2 text-neutral-700"><CompanyLink account={t}>{t.companyName || '—'}</CompanyLink></td>
                  {showAccountManager && <td className="px-3 py-2 text-neutral-500">{t.accountManagerName || '—'}</td>}
                  <td className="px-3 py-2 text-neutral-700">
                    {t.url
                      ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-cool-glacier hover:underline">{t.subject || '(no subject)'}</a>
                      : (t.subject || '(no subject)')}
                    <PinnedNoteButton noteId={t.pinnedNoteId} title={t.subject} />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{t.category || '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{t.isOpen ? (t.pipelineStageLabel || 'Open') : 'Closed'}</td>
                  <td className="px-3 py-2 text-neutral-500">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{t.daysOpen ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 max-w-xs truncate" title={t.nextStep || ''}>{t.nextStep || '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{tierStr(t.tier)}</td>
                  <td className="px-3 py-2 text-neutral-500">{t.totalCapacity ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{currencyStr(t.arrCents)}</td>
                  <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">{t.companyPosition || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <p className="text-[11px] text-neutral-400 px-3 py-2">Showing first 500 of {filtered.length} — narrow your search to see more.</p>
          )}
        </div>
      )}
    </div>
  );
}
