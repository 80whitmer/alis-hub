import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
// Alphabetized within each group (Sep 2026, Aaron) — the menu itself
// doesn't sort at render time, so keep these arrays in the order they
// should display.
const HOST_LINKS = [
  { label: 'All Communities', path: (host) => `https://${host}.alisonline.com/Communities?tab=Communities` },
  { label: 'App Store', path: (host) => `https://${host}.alisonline.com/AppStore/Apps` },
  { label: 'Company Settings', path: (host) => `https://${host}.alisonline.com/Settings/Company` },
  { label: 'Imports', path: (host) => `https://${host}.alisonline.com/Imports` },
  { label: 'Print Center', path: (host) => `https://${host}.alisonline.com/Documents/Print/Index?tab=Print` },
  { label: 'Reports', path: (host) => `https://${host}.alisonline.com/Reports?tab=ALISReports` },
];

const ADMIN_ID_LINKS = [
  { label: 'Admin: API Access', path: (id) => `https://admin.alisonline.com/Customers/ApiUsers/${id}` },
  { label: 'Admin: Company Page', path: (id) => `https://admin.alisonline.com/Customers/Companies/${id}` },
  { label: 'Admin: Security Roles', path: (id) => `https://admin.alisonline.com/Customers/Roles/${id}` },
];

function parseHosts(companyHost) {
  return String(companyHost || '').split(',').map((h) => h.trim()).filter(Boolean);
}

export default function AlisQuickLinks({ companyHost, alisAdminCompanyId, hubspotUrl, className = '' }) {
  const [open, setOpen] = useState(false);
  // Menu position in viewport coordinates, computed from the button's own
  // rect right before opening — the menu is portaled to document.body (see
  // below) so this is the only thing tying it back to the button's location.
  const [menuPos, setMenuPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-alis-quick-links-menu]')) setOpen(false);
    }
    // Reposition on scroll/resize so the menu tracks its button instead of
    // drifting once it's no longer parented under it in the DOM.
    function reposition() {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setMenuPos({ top: r.bottom + 4, left: r.left });
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setMenuPos({ top: r.bottom + 4, left: r.left });
      }
      return next;
    });
  }

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
    // inline-FLEX (not inline-block) on the wrapper itself — an inline-block
    // wrapper sizes to its button child's normal line box, which (being
    // taller than the button's own h-4) baseline-aligns the button off
    // center inside it, a 1-2px sub-pixel offset from NOTE's own pill right
    // next to it (Sep 2026, Aaron: "should not be slightly lower"). Making
    // the wrapper itself a flex container centers the button exactly.
    <div className={`relative inline-flex items-center ${className}`} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        ref={btnRef}
        onClick={toggleOpen}
        // Sized to match PinnedNote.jsx's "NOTE" pill — same fixed h-4
        // (rather than relying on padding+line-height to happen to agree
        // with NOTE's own box model) so the two badges that commonly sit
        // side by side on a company row are pixel-identical in height, not
        // just close (Sep 2026, Aaron). Colored off the cool-glacier token
        // (ALIS_BrandGuide_2025.pdf's cool secondary accent, see
        // tailwind.config.js) rather than plain neutral gray, so the badge
        // itself reads as an ALIS-branded control.
        className="inline-flex items-center justify-center h-4 text-[11px] font-semibold px-[5px] rounded border border-cool-glacier/40 text-cool-glacier bg-cool-glacier/5 hover:bg-cool-glacier/15 hover:border-cool-glacier shrink-0"
        title="Quick links — ALIS, ALIS Admin, HubSpot"
      >
        回
      </button>
      {open && menuPos && createPortal(
        // Portaled to document.body and positioned in viewport coordinates
        // (fixed, not absolute) — a table row's ancestor is almost always an
        // `overflow-x-auto` scroll container (see AccountHealthDashboard.jsx/
        // TeamAmDashboard.jsx's Accounts tables), and per the CSS overflow
        // spec setting overflow-x without overflow-y still makes the y-axis
        // clip too. That silently truncated this menu whenever a search had
        // narrowed the table to just a few rows, since the container itself
        // was then too short to hold the menu's own height. Portaling out of
        // that container sidesteps the clipping instead of trying to grow
        // the container to fit.
        <div
          data-alis-quick-links-menu
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          className="z-50 w-56 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto"
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}
