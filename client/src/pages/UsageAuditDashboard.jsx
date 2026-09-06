import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { exportUsageAudit } from '../utils/usageAuditExport';

// Tri-state dot: true (green, "on"), false (red for Enabled since an
// explicitly-off entitlement is a real finding; amber for Used since "no"
// there just means "no activity in the window," a softer signal), null
// (light gray — not scraped/pulled for this cell at all).
// Contracted is intentionally not rendered here for now (2026-09-03) — the
// HubSpot private app is missing the line-item read scopes it needs; the
// data/normalizer plumbing for it is still intact in usageAuditNormalizer.js.
const DOT_COLOR = {
  enabled: { true: 'bg-success', false: 'bg-error', null: 'bg-neutral-100' },
  used:    { true: 'bg-success', false: 'bg-warning', null: 'bg-neutral-100' },
};

function stateKey(v) {
  return v === true ? 'true' : v === false ? 'false' : 'null';
}

function Dot({ kind, value, title }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${DOT_COLOR[kind][stateKey(value)]}`}
      title={title}
    />
  );
}

const CONFIDENCE_BADGE = {
  confident: null, // no badge needed — this is the expected/default state
  ambiguous: <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning/20 text-warning ml-1.5" title="Multiple candidate entitlement flags — mapping unconfirmed">?</span>,
  ungated: <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-400 ml-1.5" title="No entitlement flag found — presumed always-on">core</span>,
};

function CommunityCell({ cell }) {
  const enabledTitle = cell.enabled === null
    ? 'Enabled: not scraped for this host'
    : cell.used === true && cell.enabled === true && cell.usageCount != null
      ? `Enabled: on (inferred from ${cell.usageCount} real usage record(s) — see Used)`
      : cell.pageConfirmedRowCount != null && cell.pageConfirmedRowCount > 0
        ? `Enabled: on (confirmed live — ${cell.pageConfirmedRowCount} task(s) configured on the actual Care Tracking page)`
        : `Enabled: ${cell.enabled ? 'on' : 'off'}`;
  const usedTitle = cell.usageCount === null ? 'Used: no usage signal defined for this feature yet' : `Used: ${cell.usageCount} record(s) in the lookback window`;

  return (
    <td className="py-2 px-3 border-l border-neutral-100">
      <div className="flex items-center justify-center gap-1.5">
        <Dot kind="enabled" value={cell.enabled} title={enabledTitle} />
        <Dot kind="used" value={cell.used} title={usedTitle} />
      </div>
    </td>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-neutral-500 mb-6">
      <span className="font-medium text-neutral-600">Per community, left to right:</span>
      <span className="flex items-center gap-1.5"><Dot kind="enabled" value={true} /> Enabled</span>
      <span className="flex items-center gap-1.5"><Dot kind="used" value={true} /> Used</span>
      <span className="text-neutral-300">|</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-neutral-100" /> No data / not scraped</span>
    </div>
  );
}

export default function UsageAuditDashboard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch(`/api/usage-audit/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no usage-audit snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data.summary))
      .catch((err) => setError(err.message));
  }, [jobId]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportUsageAudit(snapshot);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }
  if (!snapshot) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading usage audit...</p></div>;
  }

  const communityKeys = snapshot.communities.map((c) => `${c.host}::${c.communityId}`);
  let currentCategory = null;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">{snapshot.companyName}</h1>
          <p className="text-neutral-600 mt-1">
            Enabled vs. Used across {snapshot.communities.length} communit{snapshot.communities.length === 1 ? 'y' : 'ies'}
            {snapshot.hosts.length > 1 ? ` on ${snapshot.hosts.length} ALIS hosts (${snapshot.hosts.join(', ')})` : ` on "${snapshot.hosts[0]}"`}
            {' · '}usage window: last {snapshot.lookbackDays} days
          </p>
        </div>
        <button className="btn btn-secondary shrink-0" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export to Excel'}
        </button>
      </div>

      {snapshot.dataWarnings?.length > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <div>
            {snapshot.dataWarnings.map((w, i) => <p key={i} className="text-sm">{w}</p>)}
          </div>
        </div>
      )}

      <Legend />

      <div className="card mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
                <th className="py-2 pr-4 sticky left-0 bg-white">Feature</th>
                {snapshot.communities.map((c) => (
                  <th key={`${c.host}::${c.communityId}`} className="py-2 px-3 text-center border-l border-neutral-100 font-medium normal-case">
                    {c.name}
                    {snapshot.hosts.length > 1 && <div className="text-[10px] text-neutral-400 normal-case">{c.host}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.features.map((feature) => {
                const showCategory = feature.category !== currentCategory;
                currentCategory = feature.category;
                return (
                  <Fragment key={feature.id}>
                    {showCategory && (
                      <tr key={`cat-${feature.category}`} className="bg-neutral-50">
                        <td colSpan={communityKeys.length + 1} className="py-1.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 sticky left-0">
                          {feature.category}
                        </td>
                      </tr>
                    )}
                    <tr key={feature.id} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 pr-4 text-neutral-800 sticky left-0 bg-white whitespace-nowrap">
                        {feature.label}
                        {CONFIDENCE_BADGE[feature.mappingConfidence]}
                      </td>
                      {communityKeys.map((key) => (
                        <CommunityCell key={key} cell={feature.byCommunity[key]} />
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
