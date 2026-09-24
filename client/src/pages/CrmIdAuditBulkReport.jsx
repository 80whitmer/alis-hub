import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackToTopButton from '../components/BackToTopButton';

const STATUS_BADGE = {
  MATCH: 'bg-success/20 text-success',
  MISMATCH: 'bg-error/20 text-error',
  MISSING_ON_ALIS_SIDE: 'bg-error/20 text-error',
  MISSING_ON_HUBSPOT_SIDE: 'bg-error/20 text-error',
  NO_ALIS_ADMIN_MATCH: 'bg-warning/20 text-warning',
  BOTH_BLANK: 'bg-neutral-100 text-neutral-400',
};

const MATCH_METHOD_LABEL = { id: 'CRM ID', host: 'ALIS Host', name: 'Name only', null: 'Unmatched' };
const MATCH_METHOD_STYLE = {
  id: 'text-success',
  host: 'text-primary-600',
  name: 'text-warning',
  null: 'text-error font-semibold',
};

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_BADGE[status] || 'bg-neutral-100 text-neutral-500'}`}>
      {status || 'UNKNOWN'}
    </span>
  );
}

function MatchMethod({ method }) {
  const key = method || 'null';
  return <span className={`text-xs ${MATCH_METHOD_STYLE[key]}`}>{MATCH_METHOD_LABEL[key]}</span>;
}

export default function CrmIdAuditBulkReport() {
  const { jobId } = useParams();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/crm-id-audit-bulk/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'This job has no CRM ID audit report yet — has it finished running?' : `Server error (${r.status})`);
        return r.json();
      })
      .then(setSummary)
      .catch((err) => setError(err.message));
  }, [jobId]);

  if (error) {
    return <div className="max-w-3xl mx-auto py-12"><div className="alert alert-error"><span>⚠️</span><p>{error}</p></div></div>;
  }
  if (!summary) {
    return <div className="text-center py-12"><p className="text-neutral-500">Loading portfolio-wide CRM ID audit...</p></div>;
  }

  const problemCompanies = summary.companies.filter((c) => c.companyStatus !== 'MATCH' || c.communityProblems > 0);
  const unmatched = summary.companies.filter((c) => c.matchMethod === null);
  const nameOnly = summary.companies.filter((c) => c.matchMethod === 'name');

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary-900">CRM ID Audit — Portfolio-Wide</h1>
          <p className="text-neutral-600 mt-1">
            {summary.companiesAudited} companies audited · {summary.companiesMatched} matched to an ALIS record ({summary.companiesUnmatched} unmatched) · generated {new Date(summary.generatedAt).toLocaleString()}
          </p>
          <p className="text-neutral-500 text-sm mt-1">
            Matched by CRM ID: {summary.matchMethodCounts.id} · by ALIS host: {summary.matchMethodCounts.host} · by name only: {summary.matchMethodCounts.name} · unmatched: {summary.matchMethodCounts.none}
          </p>
        </div>
        <a className="btn btn-primary shrink-0" href={`/api/crm-id-audit-bulk/${jobId}/download`}>
          Download Excel
        </a>
      </div>

      {unmatched.length > 0 && (
        <div className="alert alert-error mb-4">
          <span>⚠️</span>
          <p className="text-sm">{unmatched.length} compan{unmatched.length === 1 ? 'y has' : 'ies have'} no ALIS Admin record found by CRM ID, host, or name — these have no confirmed link between the two systems at all.</p>
        </div>
      )}
      {nameOnly.length > 0 && (
        <div className="alert alert-warning mb-6">
          <span>⚠️</span>
          <p className="text-sm">{nameOnly.length} compan{nameOnly.length === 1 ? 'y was' : 'ies were'} matched by name only (no CRM ID or ALIS host confirmed the link) — verify these manually.</p>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-primary-900 mb-4">Companies ({summary.companies.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500 text-xs uppercase tracking-wide border-b border-neutral-200">
                <th className="py-2 pr-4">HubSpot Name</th>
                <th className="py-2 px-3">ALIS Name</th>
                <th className="py-2 px-3">Matched By</th>
                <th className="py-2 px-3">Company CRM ID Status</th>
                <th className="py-2 px-3">Communities</th>
                <th className="py-2 px-3">Community Problems</th>
                <th className="py-2 px-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {summary.companies.map((c) => (
                <tr key={c.companyName} className="border-b border-neutral-100">
                  <td className="py-2 pr-4 font-medium">{c.companyName}</td>
                  <td className="py-2 px-3 text-neutral-600">{c.alisCompanyName || <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 px-3"><MatchMethod method={c.matchMethod} /></td>
                  <td className="py-2 px-3"><StatusBadge status={c.companyStatus} /></td>
                  <td className="py-2 px-3">{c.communityCount ?? <span className="text-neutral-400">—</span>}</td>
                  <td className="py-2 px-3">
                    {c.communityProblems > 0
                      ? <span className="text-error font-semibold">{c.communityProblems}</span>
                      : c.communityProblems === 0
                        ? <span className="text-success">0</span>
                        : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="py-2 px-3 text-neutral-500">{c.nameNote || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-sm text-neutral-500 mt-4">Full company- and community-level detail (matched HubSpot names, IDs on both sides) is in the downloaded Excel workbook.</p>

      <BackToTopButton />
    </div>
  );
}
