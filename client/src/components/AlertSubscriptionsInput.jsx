/**
 * AlertSubscriptionsInput.jsx
 * Upload block for the alert-subscriptions job: the ALIS Communities export plus
 * the mapping workbook -> `assignments` (person -> communities). Shows a preview
 * so the run can be checked before it starts. Nothing is sent until Run Job.
 */
import { useEffect, useState } from 'react';
import { parseCommunityExport, parseMappingWorkbook, buildAssignments } from '../utils/alertSubscriptionsImport';

export default function AlertSubscriptionsInput({ onChange }) {
  const [communities, setCommunities] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [excludedText, setExcludedText] = useState('Training Community');
  const [error, setError] = useState('');
  const [files, setFiles] = useState({ communities: '', mapping: '' });

  const built = communities
    ? buildAssignments({ communities, mapping, excluded: excludedText.split('\n') })
    : null;

  useEffect(() => {
    onChange(built ? built.assignments.map(({ name, communities: c }) => ({ name, communities: c })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communities, mapping, excludedText]);

  async function handle(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      if (kind === 'communities') {
        setCommunities(await parseCommunityExport(file));
      } else {
        setMapping(await parseMappingWorkbook(file));
      }
      setFiles((f) => ({ ...f, [kind]: file.name }));
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-neutral-200">
      <h3 className="text-lg font-semibold text-primary-900 mb-1">Who gets the alert</h3>
      <p className="text-sm text-neutral-600 mb-4">
        Upload the ALIS Communities export (its Region column decides each regional director's communities) and the mapping workbook (rows marked ALL are company admins who get every community). Both must be .xlsx — Save As .xlsx if ALIS gave you .xls.
      </p>

      {error && <div className="alert alert-error mb-3"><span>⚠️</span><p className="text-sm">{error}</p></div>}

      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <label className="btn btn-secondary cursor-pointer text-center">
          {files.communities ? `✓ ${files.communities}` : 'Upload ALIS Communities export'}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => handle('communities', e)} />
        </label>
        <label className="btn btn-secondary cursor-pointer text-center">
          {files.mapping ? `✓ ${files.mapping}` : 'Upload mapping workbook (ALL rows)'}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => handle('mapping', e)} />
        </label>
      </div>

      <div className="input-group">
        <label className="input-label">Communities to exclude (one per line)</label>
        <textarea rows={2} value={excludedText} onChange={(e) => setExcludedText(e.target.value)} className="text-sm" />
        <p className="input-help">Communities with no Region in the export are always skipped as well.</p>
      </div>

      {built && (
        <div className="mt-4">
          {built.warnings.map((w) => (
            <div key={w} className="alert alert-warning mb-2"><span>⚠️</span><p className="text-sm">{w}</p></div>
          ))}
          <p className="text-sm text-neutral-700 mb-2">
            {built.assignments.length} people ·{' '}
            {built.assignments.reduce((n, a) => n + a.communities.length, 0)} person/community pairs
            {built.skipped.length ? ` · skipping ${built.skipped.map((c) => c.name).join(', ')}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-neutral-500"><th className="pr-4">Person</th><th className="pr-4">Type</th><th>Communities</th></tr></thead>
              <tbody>
                {built.assignments.map((a) => (
                  <tr key={a.name} className="border-t border-neutral-100">
                    <td className="pr-4 py-1">{a.name}</td>
                    <td className="pr-4">{a.kind}</td>
                    <td>{a.communities.length}{a.kind === 'Regional' ? ` — ${a.communities.map((c) => c.name).join(', ')}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
