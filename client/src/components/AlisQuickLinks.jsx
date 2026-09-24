import { useEffect, useRef, useState } from 'react';

/**
 * "Word in links to a few key sites" on the company tables (Sep 2026,
 * Aaron) — a small dropdown per account resolving straight to the ALIS
 * subdomain pages and admin.alisonline.com pages he's tabbing to by hand
 * today, keyed off the account's company_host (server/api/companyHosts.js,
 * set via AlisHostEditor) and alis_admin_company_id (server/api/
 * accountTruth.js's Account Truth model, set via AlisAdminIdDiscovery or
 * manual entry) — both already threaded onto every account object by
 * accountHealth.js/teamAm.js's getEnriched*Accounts(). Either or both can
 * be missing for a given account (host mapping and admin ID coverage are
 * both partial today), so each link group is only rendered when its
 * required id is actually on file; the whole button disappears rather than
 * showing a menu of dead links when neither is set.
 *
 * company_host can hold a comma-separated list (a handful of accounts run
 * more than one ALIS subdomain) — one full set of host links per host,
 * labeled with the host when there's more than one so it's clear which
 * community's ALIS instance a link opens.
 */
const HOST_LINKS = [
  { label: 'Company Settings', path: (host) => `https://${host}.alisonline.com/Settings/Company` },
  { label: 'App Store', path: (host) => `https://${host}.alisonline.com/AppStore/Apps` },
  { label: 'Reports', path: (host) => `https://${host}.alisonline.com/Reports?tab=ALISReports` },
  { label: 'Imports', path: (host) => `https://${host}.alisonline.com/Imports` },
  { label: 'Print Center', path: (host) => `https://${host}.alisonline.com/Documents/Print/Index?tab=Print` },
  { label: 'All Communities', path: (host) => `https://${host}.alisonline.com/Communities?tab=Communities` },
];

const ADMIN_ID_LINKS = [
  { label: 'Admin: Company Page', path: (id) => `https://admin.alisonline.com/Customers/Companies/${id}` },
  { label: 'Admin: Security Roles', path: (id) => `https://admin.alisonline.com/Customers/Roles/${id}` },
  { label: 'Admin: API Access', path: (id) => `https://admin.alisonline.com/Customers/ApiUsers/${id}` },
];

function parseHosts(companyHost) {
  return String(companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
}

export default function AlisQuickLinks({ companyHost, alisAdminCompanyId, hubspotUrl, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const hosts = parseHosts(companyHost);
  const showHostLabel = hosts.length > 1;
  const groups = [];

  if (hubspotUrl) {
    groups.push({ heading: null, links: [{ label: 'HubSpot', url: hubspotUrl }] });
  }
  for (const host of hosts) {
    groups.push({
      heading: showHostLabel ? host : 'ALIS',
      links: HOST_LINKS.map((l) => ({ label: l.label, url: l.path(host) })),
    });
  }
  if (alisAdminCompanyId) {
    groups.push({ heading: 'ALIS Admin', links: ADMIN_ID_LINKS.map((l) => ({ label: l.label, url: l.path(alisAdminCompanyId) })) });
  }

  if (groups.length === 0) return null;

  return (
    <div className={`relative inline-block ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-cool-glacier hover:underline shrink-0"
        title="Quick links — ALIS, ALIS Admin, HubSpot"
      >
        🔗
      </button>
      {open && (
        <div className="absolute z-20 left-0 mt-1 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto">
          {groups.map((g, i) => (
            <div key={i} className={i > 0 ? 'border-t border-neutral-100 mt-1 pt-1' : ''}>
              {g.heading && <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.heading}</p>}
              {g.links.map((l) => (
                <a
                  key={l.label}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {l.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
