/**
 * Click-to-expand Key Contacts row, ported from alis-product-ops's
 * Dashboard.jsx AccountRow pattern (Sep 2026, Aaron: "add the contact
 * drawer pattern ala the Product hub accounts table") — there it fetched
 * contacts from HubSpot on first expand; here `account.keyContacts` is
 * already attached by both accountHealth.js's and teamAm.js's
 * getEnriched*Accounts() (the shared key_contacts table, read once per
 * portfolio refresh), so this is a pure client-side toggle with no fetch
 * of its own.
 *
 * A separate button rather than reusing the row's own click handler
 * (Sep 2026, Aaron: "if we have overlapping touches, feel free to add a
 * button") — both dashboards' Accounts table rows already open a full
 * detail drawer on click, so a second, competing click target on the same
 * row would mean one click always wins and the other becomes unreachable.
 */
export function KeyContactsToggle({ account, expanded, onToggle, className = '' }) {
  const count = account.keyContacts?.length || 0;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={`${expanded ? 'Hide' : 'Show'} Key Contacts${count > 0 ? ` (${count})` : ''}`}
      // Same accent-300/accent-700/accent-50 treatment as NOTE and the
      // quick-links icon (Sep 2026, Aaron: "make the shade fill of the
      // buttons consistent per account line") — was bg-white/text-neutral-600,
      // a visibly different fill from its two row-mates.
      className={`inline-flex items-center justify-center h-4 text-[11px] font-semibold px-[5px] rounded border border-accent-300 text-accent-700 bg-accent-50 hover:bg-accent-100 shrink-0 ${className}`}
    >
      👥{count > 0 ? ` ${count}` : ''}
    </button>
  );
}

/** The expanded row itself — a <tr><td colSpan={colSpan}> wrapping this is the caller's job, since column count differs per table. */
export function KeyContactsExpandPanel({ account }) {
  const contacts = account.keyContacts || [];
  return (
    <div className="py-3 px-2 text-sm">
      {contacts.length === 0 && (
        <p className="text-neutral-500">No contacts tagged with a key role (Account Owner, Decision Maker, Billing/Clinical/Sales Admin, etc.) for this company in HubSpot.</p>
      )}
      {contacts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contacts.map((c) => (
            <div key={c.contactId} className="border border-neutral-200 rounded-lg p-3 bg-white">
              <div className="font-medium text-primary-900">
                {c.hubspotUrl ? <a href={c.hubspotUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline">{c.name || 'Unnamed contact'}</a> : (c.name || 'Unnamed contact')}
              </div>
              {c.labels?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.labels.map((label) => (
                    <span key={label} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-50 text-accent-700 border border-accent-200">{label}</span>
                  ))}
                </div>
              )}
              {c.title && <div className="text-xs text-neutral-500 mt-1">{c.title}</div>}
              {c.email && <div className="text-xs text-neutral-600 mt-1">{c.email}</div>}
              {c.phone && <div className="text-xs text-neutral-600">{c.phone}</div>}
              {c.funFacts && <div className="text-xs text-neutral-400 italic mt-1">{c.funFacts}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
