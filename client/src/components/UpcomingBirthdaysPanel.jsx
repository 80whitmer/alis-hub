/**
 * Shared by KpiDashboard.jsx (SectionCard-wrapped) and WellnessScorecard.jsx
 * (plain card div) — both read the same `{ residents, staff, dobCoverage }`
 * shape produced by server/services/kpiNormalizer.js's
 * normalizeUpcomingBirthdays. Residents get a milestone badge (90/100/...);
 * staff don't — the "decade milestone" ask was resident-specific.
 */
import { useState } from 'react';
import Drawer from './Drawer';

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

function communityNameFor(communities, communityId) {
  if (communityId == null) return null;
  return communities?.find((c) => String(c.communityId) === String(communityId))?.name || null;
}

/**
 * Every decade-milestone resident (80/90/100...) in one place, not mixed
 * into the full Residents list below (Aaron, Sep 2026: "a KPI card that
 * lists anyone tagged with a milestone") — the tile above already counts
 * them, clicking it opens this to see exactly who. `communities` is
 * optional (WellnessScorecard.jsx has it, KpiDashboard.jsx's single-account
 * context doesn't need it) — falls back to omitting the community line.
 */
function MilestoneResidentsDrawer({ residents, communities, onClose }) {
  const milestones = residents.filter((r) => r.isDecadeMilestone);
  return (
    <Drawer
      title="Milestone-Tagged Residents"
      subtitle={`${milestones.length} resident${milestones.length === 1 ? '' : 's'} turning a decade milestone in the next 14 days`}
      onClose={onClose}
    >
      {milestones.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">None in this window.</p>
      ) : (
        <ul className="space-y-3">
          {milestones.map((r) => {
            const community = communityNameFor(communities, r.communityId);
            return (
              <li key={r.residentId} className="flex items-center justify-between gap-3 text-sm border-b border-neutral-100 pb-3 last:border-0">
                <div className="min-w-0">
                  <p className="text-neutral-800 font-medium truncate">{r.name}</p>
                  <p className="text-neutral-400 text-xs mt-0.5 truncate">{[community, r.productType].filter(Boolean).join(' — ')}</p>
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  <MilestoneBadge turningAge={r.turningAge} />
                  <span className="text-neutral-500 text-xs">{fmtDate(r.birthdayDate)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

/** Decade milestones (80, 90, 100...) — broader than isMajorMilestone (90+ only, used for the 🎉 badge below), since a Turning-80 count is still worth a Wellness Director's attention. Clickable — opens MilestoneResidentsDrawer to see who, not just how many. */
function MilestoneCountTile({ residents, communities }) {
  const [open, setOpen] = useState(false);
  const milestones = residents.filter((r) => r.isDecadeMilestone);
  const byAge = milestones.reduce((acc, r) => {
    acc[r.turningAge] = (acc[r.turningAge] || 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(byAge)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([age, count]) => `Turning ${age}: ${count}`)
    .join(' · ');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group card-sm inline-flex flex-col items-start text-left mb-4 hover:shadow-md transition-shadow"
      >
        <p className="text-xs text-neutral-500 uppercase tracking-wide">Decade Milestones (next 14 days)</p>
        <p className="text-2xl font-bold text-primary-900 mt-1">{milestones.length}</p>
        {breakdown && <p className="text-xs text-neutral-400 mt-1">{breakdown}</p>}
        <p className="text-xs font-medium text-cool-glacier mt-1 opacity-0 group-hover:opacity-100 transition-opacity">View list →</p>
      </button>
      {open && <MilestoneResidentsDrawer residents={residents} communities={communities} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Whether there's anything for a caller to render — lets each page decide whether to show its section wrapper (title/description) at all, rather than showing an empty card every week. */
export function hasUpcomingBirthdays(data) {
  return Boolean(data && ((data.residents?.length ?? 0) > 0 || (data.staff?.length ?? 0) > 0));
}

export default function UpcomingBirthdaysPanel({ data, communities }) {
  if (!hasUpcomingBirthdays(data)) return null;
  const { residents = [], staff = [], dobCoverage } = data;

  return (
    <div>
      <MilestoneCountTile residents={residents} communities={communities} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 className="font-semibold text-primary-900 text-sm mb-3">Residents</h3>
          {residents.length === 0 ? (
            <p className="text-sm text-neutral-500 italic">None in this window.</p>
          ) : (
            <ul className="space-y-2">
              {residents.map((r) => (
                <li key={r.residentId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-neutral-700 truncate">{r.name} <span className="text-neutral-400">— {r.productType ? `${r.productType}, ` : ''}turning {r.turningAge}</span></span>
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
