import { useMemo, useState } from 'react';
import Drawer from './Drawer';
import PinnedNoteButton from './PinnedNote';
import { exportTopThreeEnhancements } from '../utils/topThreeEnhancementsExport';

/**
 * Rolls up every ticket tagged/staged as a client's Top 3 enhancement ask
 * across whatever `accounts` array it's given (each account's
 * `serviceHealth.enhancementTopItems`, already computed server-side —
 * see accountHealth.js's/teamAm.js's mapLiveServiceHealth) into one stat
 * tile that opens a drawer listing every one, linked back to its real
 * HubSpot ticket, exportable to Excel. Shared between
 * AccountHealthDashboard.jsx and TeamAmDashboard.jsx (Aaron, Sep 2026) —
 * pass `includeAccountManager` on the team dashboard to add that column;
 * the personal dashboard's accounts don't carry an account_manager_name
 * field at all, so it's simply omitted there.
 */
function flattenTopThree(accounts, includeAccountManager) {
  const items = [];
  for (const a of accounts) {
    const topItems = a.serviceHealth?.enhancementTopItems || [];
    for (const t of topItems) {
      items.push({
        ...t,
        companyName: a.company_name,
        ...(includeAccountManager ? { accountManagerName: a.account_manager_name || 'Unassigned' } : {}),
      });
    }
  }
  return items;
}

function SortableHeader({ label, column, sort, onSort, className = '' }) {
  const active = sort.column === column;
  return (
    <th className={`pb-2 cursor-pointer select-none hover:text-neutral-700 ${className}`} onClick={() => onSort(column)}>
      {label}{active && <span className="ml-1">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function TopThreeDrawer({ items, includeAccountManager, onClose }) {
  const [sort, setSort] = useState({ column: 'companyName', direction: 'asc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  // Company search (Sep 2026, Aaron: "put a company search in all the
  // sections with 'Company' tables") — no tier pills here, this drawer's
  // rows have no tier column at all.
  const [search, setSearch] = useState('');

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) =>
      t.companyName?.toLowerCase().includes(q) ||
      t.accountManagerName?.toLowerCase().includes(q) ||
      t.subject?.toLowerCase().includes(q)
    );
  }, [items, search]);

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [filteredItems, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportTopThreeEnhancements(filteredItems);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title="Enhancement Requests: Top 3"
      subtitle={`${items.length} ticket${items.length === 1 ? '' : 's'} across every account`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExport} disabled={exporting || filteredItems.length === 0} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      }
    >
      {items.length > 0 && (
        <input
          type="text"
          placeholder="Search company, AM, or ticket…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 w-full mb-4"
        />
      )}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No Top 3 enhancement tickets found — click Refresh to pull the latest.</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No tickets match that search.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                {includeAccountManager && (
                  <SortableHeader label="AM" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                )}
                <SortableHeader label="Ticket" column="subject" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Rank" column="rank" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Created" column="createdAt" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.ticketId} className="border-t border-neutral-100">
                  <td className="py-2 pr-4">{t.companyName}</td>
                  {includeAccountManager && <td className="py-2 pr-4 text-neutral-500">{t.accountManagerName}</td>}
                  <td className="py-2 pr-4">
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-medium text-cool-glacier hover:underline">{t.subject}</a>
                    ) : t.subject}
                    <PinnedNoteButton noteId={t.pinnedNoteId} title={t.subject} />
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{t.rank || '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.stage || '—'}</td>
                  <td className="py-2 text-neutral-500 whitespace-nowrap">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

export default function TopThreeEnhancementsCard({ accounts, includeAccountManager = false }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => flattenTopThree(accounts, includeAccountManager), [accounts, includeAccountManager]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group card relative text-left w-full transition-all duration-200 hover:scale-105 hover:z-10 hover:shadow-xl flex flex-col items-start"
      >
        {/* min-h-8 + flex flex-col items-start both match StatCard's own fix (AccountHealthDashboard.jsx) — min-h-8 reserves room for a 2-line title, and the top-anchored flex column overrides a real <button> quirk where a grid-stretched button vertically centers its children instead of leaving the extra height below them. */}
        <p className="text-xs group-hover:text-sm text-neutral-500 uppercase tracking-wide transition-[font-size] min-h-8">Enhancement Requests: Top 3</p>
        <p className="text-2xl group-hover:text-3xl font-bold text-primary-900 mt-1 transition-[font-size]">{items.length}</p>
        <p className="text-xs group-hover:text-sm font-medium text-cool-glacier mt-0.5 transition-[font-size]">View all →</p>
      </button>
      {open && <TopThreeDrawer items={items} includeAccountManager={includeAccountManager} onClose={() => setOpen(false)} />}
    </>
  );
}
