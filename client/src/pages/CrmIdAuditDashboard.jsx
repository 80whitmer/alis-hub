import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackToTopButton from '../components/BackToTopButton';

const STATUS_BADGE = {
  MATCH:                       'bg-success/20 text-success',
  MISMATCH:                    'bg-error/20 text-error',
  MISSING_ON_ALIS_SIDE:        'bg-error/20 text-error',
  MISSING_ON_HUBSPOT_SIDE:     'bg-error/20 text-error',
  NO_HUBSPOT_MATCH:            'bg-warning/20 text-warning',
  HUBSPOT_LOOKUP_UNAVAILABLE:  'bg-neutral-100 text-neutral-500',
  SKIPPED_NOT_LIVE:            'bg-neutral-100 text-neutral-400',
  BOTH_BLANK:                  'bg-neutral-100 text-neutral-400',
};

const STATUS_LABEL = {
  MATCH: 'Match',
  MISMATCH: 'Mismatch',
  MISSING_ON_ALIS_SIDE: 'Missing on ALIS side',
  MISSING_ON_HUBSPOT_SIDE: 'Missing on HubSpot side',
  NO_HUBSPOT_MATCH: 'No HubSpot match (ID or name)',
  HUBSPOT_LOOKUP_UNAVAILABLE: 'HubSpot lookup unavailable',
  SKIPPED_NOT_LIVE: 'Not Live (skipped)',
  BOTH_BLANK: 'Both blank',
};

const MATCH_METHOD_LABEL = { id: 'Matched by CRM ID', host: 'Matched by ALIS host', name: 'Matched by name only' };

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_BADGE[status] || 'bg-neutral-100 text-neutral-500'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export default function CrmIdAuditDashboard() {
  const { jobId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/crm-id-audit/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no CRM ID audit snapshot yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then((data) => setSnapshot(data.report))
      .catch((err) => setError(err.message));
  }, [jobId]);

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }
  if (!snapshot) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading CRM ID audit...</p></div>;
  }

  const { company, communities, hubspotLookupError } = snapshot;
  const problemCommunities = communities.filter((c) => c.status === 'MISMATCH' || c.status.startsWith('MISSING'));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary-900">CRM ID Audit — {company.companyName}</h1>
        <p className="text-neutral-600 mt-1">
          ALIS Admin company {company.alisAdminCompanyId} vs. HubSpot Record ID — checked {new Date(snapshot.capturedAt).toLocaleString()}
        </p>
      </div>

      {hubspotLookupError && (
        <div className="alert alert-warning mb-6"><span>⚠️</span><p className="text-sm">{hubspotLookupError}</p></div>
      )}

      <div className="card mb-8">
        <h2 className="text-lg font-semibold text-primary-900 mb-4">Company</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
              <th className="py-2 pr-4">Company Name</th>
              <th className="py-2 px-3">ALIS Admin Company ID</th>
              <th className="py-2 px-3">ALIS CRM ID</th>
              <th className="py-2 px-3">HubSpot Record ID</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Note</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-100">
              <td className="py-2 pr-4 font-medium">
                {company.companyName}
                {company.matchMethod && <div className="text-[10px] text-neutral-400 font-normal">{MATCH_METHOD_LABEL[company.matchMethod]}</div>}
              </td>
              <td className="py-2 px-3">{company.alisAdminCompanyId || <span className="text-neutral-400">—</span>}</td>
              <td className="py-2 px-3">{company.alisCrmId || <span className="text-neutral-400">—</span>}</td>
              <td className="py-2 px-3">{company.hubspotRecordId || <span className="text-neutral-400">—</span>}</td>
              <td className="py-2 px-3"><StatusBadge status={company.status} /></td>
              <td className="py-2 px-3 text-neutral-500 text-xs">{company.nameNote || ''}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {problemCommunities.length > 0 && (
        <div className="alert alert-error mb-6">
          <span>⚠️</span>
          <p className="text-sm">{problemCommunities.length} Live communit{problemCommunities.length === 1 ? 'y has' : 'ies have'} a CRM ID mismatch or is missing on one side.</p>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-primary-900 mb-4">Communities ({communities.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
                <th className="py-2 pr-4">Community Name</th>
                <th className="py-2 px-3">ALIS Community ID</th>
                <th className="py-2 px-3">ALIS CRM ID</th>
                <th className="py-2 px-3">HubSpot Record ID</th>
                <th className="py-2 px-3">HubSpot Matched Name</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {communities.map((c) => (
                <tr key={c.alisCommunityId || c.communityName} className="border-b border-neutral-100">
                  <td className="py-2 pr-4 font-medium">
                    {c.communityName}
                    {c.statusBadges.map((b) => (
                      <span key={b} className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">{b}</span>
                    ))}
                  </td>
                  <td className="py-2 px-3">{c.alisCommunityId || <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 px-3">{c.alisCrmId || <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 px-3">{c.hubspotRecordId || <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 px-3 text-neutral-500">
                    {c.hubspotMatchedName || <span className="text-neutral-400">—</span>}
                    {c.matchMethod && <div className="text-[10px] text-neutral-400">{MATCH_METHOD_LABEL[c.matchMethod]}</div>}
                  </td>
                  <td className="py-2 px-3"><StatusBadge status={c.status} /></td>
                  <td className="py-2 px-3 text-neutral-500 text-xs">{c.nameNote || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BackToTopButton />
    </div>
  );
}
