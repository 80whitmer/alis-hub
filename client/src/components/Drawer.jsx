/**
 * Generic right-side slide-over panel, extracted from Dashboard.jsx's
 * JobDrawer (the app's original drawer, job-list-specific) so KPI
 * drill-downs (starting with DSO's facility/resident breakdown) have a
 * reusable template instead of each rebuilding the same overlay/panel
 * markup. Any future KPI drill-down should use this rather than a new
 * one-off drawer.
 */
export default function Drawer({ title, subtitle, badge, onClose, footer, children }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-neutral-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-primary-900 leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge}
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 transition-colors p-1 rounded" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && <div className="px-6 py-4 border-t border-neutral-200 shrink-0">{footer}</div>}
      </div>
    </>
  );
}
