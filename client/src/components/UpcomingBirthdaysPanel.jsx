/**
 * Shared by KpiDashboard.jsx (SectionCard-wrapped) and WellnessScorecard.jsx
 * (plain card div) — both read the same `{ residents, staff, dobCoverage }`
 * shape produced by server/services/kpiNormalizer.js's
 * normalizeUpcomingBirthdays. Residents get a milestone badge (90/100/...);
 * staff don't — the "decade milestone" ask was resident-specific.
 */

function fmtDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function MilestoneBadge({ turningAge }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap">
      🎉 Turning {turningAge}
    </span>
  );
}

/** Whether there's anything for a caller to render — lets each page decide whether to show its section wrapper (title/description) at all, rather than showing an empty card every week. */
export function hasUpcomingBirthdays(data) {
  return Boolean(data && ((data.residents?.length ?? 0) > 0 || (data.staff?.length ?? 0) > 0));
}

export default function UpcomingBirthdaysPanel({ data }) {
  if (!hasUpcomingBirthdays(data)) return null;
  const { residents = [], staff = [], dobCoverage } = data;

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Residents</h3>
          {residents.length === 0 ? (
            <p className="text-sm text-neutral-500 italic">None in this window.</p>
          ) : (
            <ul className="space-y-2">
              {residents.map((r) => (
                <li key={r.residentId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-neutral-700 truncate">{r.name} <span className="text-neutral-400">— turning {r.turningAge}</span></span>
                  <span className="flex items-center gap-2 shrink-0">
                    {r.isMajorMilestone && <MilestoneBadge turningAge={r.turningAge} />}
                    <span className="text-neutral-500">{fmtDate(r.birthdayDate)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Staff</h3>
          {staff.length === 0 ? (
            <p className="text-sm text-neutral-500 italic">None in this window.</p>
          ) : (
            <ul className="space-y-2">
              {staff.map((s) => (
                <li key={s.staffId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-neutral-700 truncate">{s.name} <span className="text-neutral-400">— {s.jobRole || 'Staff'}</span></span>
                  <span className="text-neutral-500 shrink-0">{fmtDate(s.birthdayDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {dobCoverage && (
        <p className="text-xs text-neutral-400 italic mt-4">
          Birthdate on file for {dobCoverage.residents.withDob} of {dobCoverage.residents.total} active residents and {dobCoverage.staff.withDob} of {dobCoverage.staff.total} active staff — coverage varies by account, especially for staff.
        </p>
      )}
    </div>
  );
}
