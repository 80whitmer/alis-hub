import { useMemo, useState } from 'react';
import Drawer from './Drawer';
import { exportAlisPayTickets } from '../utils/alisPayTicketsExport';

/**
 * Rolls up every OPEN ticket categorized `category_2_0 = "ALIS Pay"`
 * across whatever `accounts` array it's given (each account's
 * `serviceHealth.alisPayOpenItems`, computed server-side — see
 * accountHealth.js's/teamAm.js's mapLiveServiceHealth) into one stat tile
 * that opens a drawer listing every one, linked back to its real HubSpot
 * ticket, exportable to Excel. Same shape as TopThreeEnhancementsCard.jsx,
 * shared between AccountHealthDashboard.jsx and TeamAmDashboard.jsx.
 *
 * Deliberately sourced from the live `category_2_0` category, not the old
 * dedicated "ALIS Pay" HubSpot pipeline — that pipeline had zero new
 * tickets across every stage since 2025-12-01 (confirmed live, Sep 2026),
 * i.e. it's a frozen historical backlog from an abandoned integration, not
 * something that could ever move as an ongoing indicator.
 */
function flattenAlisPayTickets(accounts, includeAccountManager) {
  const items = [];
  for (const a of accounts) {
    const openItems = a.serviceHealth?.alisPayOpenItems || [];
    for (const t of openItems) {
      items.push({
        ...t,
        companyName: a.company_name,
        hubspotUrl: a.hubspotUrl,
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

function AlisPayDrawer({ items, includeAccountManager, onClose }) {
  const [sort, setSort] = useState({ column: 'daysOpen', direction: 'desc' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  function toggleSort(column) {
    setSort((prev) => prev.column === column
      ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' });
  }

  const sorted = useMemo(() => {
    const { column, direction } = sort;
    const dir = direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [items, sort]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await exportAlisPayTickets(items, includeAccountManager);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Drawer
      title="Open ALIS Pay Tickets"
      subtitle={`${items.length} ticket${items.length === 1 ? '' : 's'} across every account`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExport} disabled={exporting} className="btn btn-secondary btn-sm">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
          {exportError && <p className="text-xs text-error">{exportError}</p>}
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No open ALIS Pay tickets found — click Refresh to pull the latest.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide">
                <SortableHeader label="Company" column="companyName" sort={sort} onSort={toggleSort} className="pr-4" />
                {includeAccountManager && (
                  <SortableHeader label="Account Manager" column="accountManagerName" sort={sort} onSort={toggleSort} className="pr-4" />
                )}
                <SortableHeader label="Ticket" column="subject" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Stage" column="stage" sort={sort} onSort={toggleSort} className="pr-4" />
                <SortableHeader label="Days Open" column="daysOpen" sort={sort} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.ticketId} className="border-t border-neutral-100">
                  <td className="py-2 pr-4">{t.companyName}</td>
                  {includeAccountManager && <td className="py-2 pr-4 text-neutral-500">{t.accountManagerName}</td>}
                  <td className="py-2 pr-4">
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{t.subject}</a>
                    ) : t.subject}
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">{t.stage || '—'}</td>
                  <td className="py-2 text-neutral-500">{t.daysOpen ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

export default function AlisPayTicketsCard({ accounts, includeAccountManager = false }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => flattenAlisPayTickets(accounts, includeAccountManager), [accounts, includeAccountManager]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="card text-left w-full hover:border-accent-300 border border-transparent transition-colors"
      >
        <p className="text-xs text-neutral-500 uppercase tracking-wide">Open ALIS Pay Tickets</p>
        <p className="text-2xl font-bold text-primary-900 mt-1">{items.length}</p>
        <p className="text-xs text-accent-600 mt-0.5">View all →</p>
      </button>
      {open && <AlisPayDrawer items={items} includeAccountManager={includeAccountManager} onClose={() => setOpen(false)} />}
    </>
  );
}
