import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateFormFields, renderFormField } from '../utils/schema-form-generator';
import BillingItemsInput from '../components/BillingItemsInput';
import AdvancedJsonEditor from '../components/AdvancedJsonEditor';
import CompanyLookup from '../components/CompanyLookup';
import EvaluationDetail from './EvaluationDetail';
import { getLastCompletedQuarter, formatQuarterLabel, getMostRecentSunday } from '../utils/quarter';

export default function NewJob() {
  const navigate = useNavigate();

  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateData, setTemplateData] = useState(null);
  const [formData, setFormData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');
  const [hostAutoFilled, setHostAutoFilled] = useState(false);
  const [healthImportText, setHealthImportText] = useState('');
  const [healthImportParsed, setHealthImportParsed] = useState(null);
  const [healthImportError, setHealthImportError] = useState('');
  const [healthImportWarning, setHealthImportWarning] = useState('');
  const [releaseImportText, setReleaseImportText] = useState('');
  const [releaseImportParsed, setReleaseImportParsed] = useState(null);
  const [releaseImportError, setReleaseImportError] = useState('');
  const [releaseImportWarning, setReleaseImportWarning] = useState('');
  // Which template's info popover is open (one at a time) — click-to-reveal
  // per Aaron's ask, not hover, so it also works fine on a trackpad tap.
  const [infoOpenId, setInfoOpenId] = useState(null);
  const infoPopoverRef = useRef(null);

  useEffect(() => {
    if (!infoOpenId) return;
    function handleClickOutside(e) {
      if (infoPopoverRef.current && !infoPopoverRef.current.contains(e.target)) {
        setInfoOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [infoOpenId]);

  // Load templates on mount
  useEffect(() => {
    fetch('/api/jobs/templates')
      .then(r => r.json())
      .then(data => {
        setTemplates(data);
        if (data.length > 0) {
          setSelectedTemplate(data[0].id);
        }
      })
      .catch(err => setError(`Failed to load templates: ${err.message}`));
  }, []);

  // Load template schema when selection changes
  useEffect(() => {
    // Evaluation Lookup isn't a real job template — see its tile below.
    if (!selectedTemplate || selectedTemplate === 'evaluation-lookup') return;

    fetch(`/api/jobs/templates/${selectedTemplate}`)
      .then(r => r.json())
      .then(data => {
        try {
          setTemplateData(data);
          // Initialize formData with required fields from schema
          const initialFormData = {};
          if (data?.inputSchema?.properties) {
            Object.entries(data.inputSchema.properties).forEach(([key, prop]) => {
              if (prop?.type === 'array') {
                initialFormData[key] = [];
              }
            });
          }

          // Pre-populate period dates for kpi-export
          if (selectedTemplate === 'kpi-export') {
            const quarter = getLastCompletedQuarter();
            initialFormData.periodStart = quarter.start;
            initialFormData.periodEnd = quarter.end;
          }

          // Default Week Ending to the most recent Sunday for wellness-scorecard
          if (selectedTemplate === 'wellness-scorecard') {
            initialFormData.weekEnding = getMostRecentSunday();
          }

          setFormData(initialFormData);
          setError('');
          setHealthImportText('');
          setHealthImportParsed(null);
          setHealthImportError('');
          setHealthImportWarning('');
          setReleaseImportText('');
          setReleaseImportParsed(null);
          setReleaseImportError('');
          setReleaseImportWarning('');

          // create-communities: always use Advanced JSON mode (dynamic form has wrong field names)
          if (selectedTemplate === 'create-communities') {
            setShowAdvanced(true);
            setAdvancedJson(''); // AdvancedJsonEditor handles its own pre-population
          } else {
            setShowAdvanced(false);
            setAdvancedJson('');
          }
        } catch (err) {
          setError(`Error processing template: ${err.message}`);
        }
      })
      .catch(err => setError(`Failed to load template: ${err.message}`));
  }, [selectedTemplate]);

  function handleFormChange(key, value) {
    setFormData(prev => ({
      ...prev,
      [key]: value,
    }));
    if (key === 'companyHost') setHostAutoFilled(false);
  }

  function handleHealthImportChange(text) {
    setHealthImportText(text);
    setHealthImportWarning('');

    if (!text.trim()) {
      setHealthImportParsed(null);
      setHealthImportError('');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setHealthImportParsed(null);
      setHealthImportError(`Invalid JSON: ${err.message}`);
      return;
    }

    if (typeof parsed !== 'object' || (!parsed.service_health && !parsed.financial_health)) {
      setHealthImportParsed(null);
      setHealthImportError('This does not look like an account-health-export JSON — expected top-level service_health and/or financial_health keys.');
      return;
    }

    setHealthImportError('');
    setHealthImportParsed(parsed);

    // Auto-fill company info from the export if the form doesn't have it yet
    // — the skill's JSON doesn't include the ALIS subdomain or period dates,
    // so the form is still required for those, but this saves retyping the
    // account name.
    const importedName = parsed.account?.name;
    const importedHubspotId = parsed.account?.hubspot_company_id;
    setFormData(prev => {
      const next = { ...prev };
      if (importedName && !prev.companyName) next.companyName = importedName;
      if (importedHubspotId && !prev.hubspotCompanyId) next.hubspotCompanyId = String(importedHubspotId);
      return next;
    });

    if (importedName && formData.companyName && importedName.trim().toLowerCase() !== formData.companyName.trim().toLowerCase()) {
      setHealthImportWarning(`Company name mismatch: this health export is for "${importedName}", but the form above is set to "${formData.companyName}" — double-check before running.`);
    }
  }

  function handleReleaseImportChange(text) {
    setReleaseImportText(text);
    setReleaseImportWarning('');

    if (!text.trim()) {
      setReleaseImportParsed(null);
      setReleaseImportError('');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setReleaseImportParsed(null);
      setReleaseImportError(`Invalid JSON: ${err.message}`);
      return;
    }

    if (typeof parsed !== 'object' || !Array.isArray(parsed.releases)) {
      setReleaseImportParsed(null);
      setReleaseImportError('This does not look like a release-recommendations JSON — expected a top-level "releases" array.');
      return;
    }

    setReleaseImportError('');
    setReleaseImportParsed(parsed);

    const importedName = parsed.account?.name;
    if (importedName && formData.companyName && importedName.trim().toLowerCase() !== formData.companyName.trim().toLowerCase()) {
      setReleaseImportWarning(`Company name mismatch: this release-recommendations export is for "${importedName}", but the form above is set to "${formData.companyName}" — double-check before running.`);
    }
  }

  function handleBillingItemsChange(items) {
    setFormData(prev => ({
      ...prev,
      items,
    }));
  }

  function validateAdvancedJson() {
    if (!advancedJson.trim()) {
      setError('JSON cannot be empty');
      return null;
    }

    try {
      const parsed = JSON.parse(advancedJson);
      return parsed;
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
      return null;
    }
  }

  async function handleSubmit() {
    setError('');

    let payload = showAdvanced ? validateAdvancedJson() : { ...formData };

    if (!payload) {
      return;
    }

    // The health-export JSON is additive to the form, never a replacement —
    // it doesn't carry the ALIS subdomain or period dates, so the form
    // fields above are validated normally on top of it.
    if (isKpiExport && !showAdvanced && healthImportText.trim()) {
      if (healthImportError) {
        setError(`Fix the Health Export JSON before running this job: ${healthImportError}`);
        return;
      }
      if (!healthImportParsed) {
        setError('Health Export JSON is present but has not finished validating — check it before running this job.');
        return;
      }
      payload.pendingHealthImport = healthImportParsed;
    }

    if (isKpiExport && !showAdvanced && releaseImportText.trim()) {
      if (releaseImportError) {
        setError(`Fix the Release Recommendations JSON before running this job: ${releaseImportError}`);
        return;
      }
      if (!releaseImportParsed) {
        setError('Release Recommendations JSON is present but has not finished validating — check it before running this job.');
        return;
      }
      payload.pendingReleaseImport = releaseImportParsed;
    }

    setLoading(true);
    const requestBody = {
      templateId: selectedTemplate,
      label: undefined, // Use template default
      payload,
    };

    console.log('📤 Submitting job with payload:', requestBody);

    try {
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('📥 Response status:', res.status, res.statusText);

      const data = await res.json();
      console.log('📥 Response body:', data);

      if (!res.ok) {
        const errorMsg = data.error || data.message || `Server error (${res.status})`;
        console.error('❌ API Error:', errorMsg);
        throw new Error(errorMsg);
      }

      console.log('✅ Job created successfully:', data.id);
      navigate(`/jobs/${data.id}`);
    } catch (err) {
      console.error('❌ Error submitting job:', err);
      setError(err.message || 'Failed to submit job');
      setLoading(false);
    }
  }

  if (!templateData) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading template...</p>
      </div>
    );
  }

  const fields = generateFormFields(templateData.inputSchema);
  const currentTemplate = templates.find(t => t.id === selectedTemplate);
  const isGLSync = selectedTemplate === 'sync-gl-accounts';
  const isKpiExport = selectedTemplate === 'kpi-export';
  const isWellnessScorecard = selectedTemplate === 'wellness-scorecard';
  const isAuditHistory = selectedTemplate === 'audit-history';
  // All three report templates share the same "look up the account,
  // auto-fill its known ALIS host" flow — only the QBR-specific
  // Health/Release Import JSON blocks further down stay gated to
  // isKpiExport alone.
  const usesCompanyLookup = isKpiExport || isWellnessScorecard || isAuditHistory;

  function handleCompanySelect({ name, hubspotId }) {
    setFormData(prev => ({ ...prev, companyName: name, hubspotCompanyId: hubspotId }));
    setHostAutoFilled(false);

    // A real dropdown pick (not free typing) — check whether we've already
    // seen a working companyHost for this account and save the user from
    // retyping the ALIS subdomain.
    if (!hubspotId) return;
    fetch(`/api/company-hosts/lookup?hubspotCompanyId=${encodeURIComponent(hubspotId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.companyHost) {
          setFormData(prev => ({ ...prev, companyHost: data.companyHost }));
          setHostAutoFilled(true);
        }
      })
      .catch(() => {}); // best-effort — a miss here just means manual entry
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-3 text-5xl font-bold text-primary-900">
          <img src="/butterfly-icon.png" alt="" className="h-11 w-auto" />
          Create Automation Job
        </h1>
        <p className="text-neutral-600 mt-2">Pick a job type, then fill in the details below</p>
        <p className="text-xs text-accent-600 font-medium mt-1">
          From one click to a completed run
        </p>
      </div>

      {/* Template selector — icon-first tiles, description on demand via the ⓘ
          button rather than always-on body text, so picking a job type is one
          glance and one click instead of reading five paragraphs first. */}
      <div className="mb-8">
        <label className="input-label">Job Type</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {templates.map(template => (
            <div key={template.id} className="relative">
              <button
                onClick={() => { setSelectedTemplate(template.id); setInfoOpenId(null); }}
                className={`w-full flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl border-2 text-center transition-all ${
                  selectedTemplate === template.id
                    ? 'border-accent-500 bg-accent-50'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <span className="text-2xl leading-none">{template.icon}</span>
                <span className="text-sm font-semibold text-primary-900 leading-tight">{template.name}</span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setInfoOpenId(infoOpenId === template.id ? null : template.id); }}
                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-accent-600 hover:border-accent-300 flex items-center justify-center text-[10px] font-bold leading-none"
                aria-label={`About ${template.name}`}
                title="What does this do?"
              >
                i
              </button>
              {infoOpenId === template.id && (
                <div
                  ref={infoPopoverRef}
                  className="absolute z-20 top-full mt-1.5 left-0 right-0 p-3 rounded-lg border border-neutral-200 bg-white shadow-lg text-xs text-neutral-600 text-left"
                >
                  {template.description}
                </div>
              )}
            </div>
          ))}

          {/* Evaluation Lookup isn't a job template (no backend registration,
              no batch/async run, no Job Board entry) — see EvaluationDetail.jsx's
              own doc comment: it's a live search tool. Kept in this grid anyway
              (Aaron, Sep 2026) so every automation-adjacent tool lives in one
              place; the dashed border is the only visual hint it behaves
              differently — selecting it swaps the Configuration section below
              for the live lookup tool instead of a job form (no schema fetch,
              no Run Job button — see the two render guards below that key off
              selectedTemplate === 'evaluation-lookup'). */}
          <div className="relative">
            <button
              onClick={() => { setSelectedTemplate('evaluation-lookup'); setInfoOpenId(null); }}
              className={`w-full flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl border-2 border-dashed text-center transition-all ${
                selectedTemplate === 'evaluation-lookup'
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-neutral-200 bg-white hover:border-accent-300'
              }`}
            >
              <span className="text-2xl leading-none">🔍</span>
              <span className="text-sm font-semibold text-primary-900 leading-tight">Evaluation Lookup</span>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setInfoOpenId(infoOpenId === 'evaluation-lookup' ? null : 'evaluation-lookup'); }}
              className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white border border-neutral-200 text-neutral-400 hover:text-accent-600 hover:border-accent-300 flex items-center justify-center text-[10px] font-bold leading-none"
              aria-label="About Evaluation Lookup"
              title="What does this do?"
            >
              i
            </button>
            {infoOpenId === 'evaluation-lookup' && (
              <div
                ref={infoPopoverRef}
                className="absolute z-20 top-full mt-1.5 left-0 right-0 p-3 rounded-lg border border-neutral-200 bg-white shadow-lg text-xs text-neutral-600 text-left"
              >
                Instant resident evaluation search — CarePoints, Care Level, and the question/answer breakdown where available. Not a job: replaces the Configuration section below with the live lookup tool instead of a job form.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Evaluation Lookup swaps in for the Configuration section entirely —
          no schema, no form, no Run Job button, just the live tool. */}
      {selectedTemplate === 'evaluation-lookup' && (
        <div className="mb-8">
          <EvaluationDetail />
        </div>
      )}

      {/* Form or advanced mode */}
      {selectedTemplate !== 'evaluation-lookup' && (
      <div className={`mb-8 ${isGLSync || (showAdvanced && selectedTemplate === 'create-communities') ? '' : 'max-w-3xl'}`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-primary-900">Configuration</h2>
          {!isGLSync && selectedTemplate !== 'create-communities' && (
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-accent-600 hover:text-accent-700 font-medium"
            >
              {showAdvanced ? '← Use Form' : 'Advanced JSON →'}
            </button>
          )}
        </div>

        {/* Error alert */}
        {error && (
          <div className="alert alert-error mb-6">
            <span>⚠️</span>
            <div>
              <p className="font-semibold">Error</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {isGLSync ? (
          // Specialized GL Sync form
          <div className="space-y-6">
            {/* Community name */}
            <div className="input-group">
              <label className="input-label">Community Name</label>
              <input
                type="text"
                placeholder="e.g. Steadman Hill"
                value={formData.communityName || ''}
                onChange={(e) => handleFormChange('communityName', e.target.value)}
              />
              <p className="input-help">Display name of the community</p>
            </div>

            {/* Billing settings URL */}
            <div className="input-group">
              <label className="input-label">Billing Settings URL</label>
              <input
                type="text"
                placeholder="https://surpass.alisonline.com/Settings/Billing/..."
                value={formData.billingSettingsUrl || ''}
                onChange={(e) => handleFormChange('billingSettingsUrl', e.target.value)}
              />
              <p className="input-help">Full URL to the billing settings page</p>
            </div>

            {/* Sync date */}
            <div className="input-group">
              <label className="input-label">Sync Date</label>
              <input
                type="text"
                placeholder="MM/DD/YYYY"
                pattern="\d{2}/\d{2}/\d{4}"
                value={formData.syncDate || ''}
                onChange={(e) => handleFormChange('syncDate', e.target.value)}
              />
              <p className="input-help">Date when changes take effect</p>
            </div>

            {/* Run Job button - above billing items */}
            <div className="flex gap-3 pt-4 pb-6 border-b border-neutral-200">
              <button
                onClick={handleSubmit}
                disabled={loading || !selectedTemplate}
                className="btn btn-primary btn-lg"
              >
                {loading ? 'Starting...' : 'Run Job →'}
              </button>
            </div>

            {/* Billing items */}
            <div className="pt-6">
              <h3 className="input-label mb-4">Billing Items & GL Accounts</h3>
              <BillingItemsInput
                items={formData.items || []}
                onChange={handleBillingItemsChange}
                error={error}
                setError={setError}
              />
            </div>
          </div>
        ) : showAdvanced ? (
          // Advanced JSON mode — use rich editor for create-communities, plain textarea otherwise
          <div className="mb-6">
            {selectedTemplate === 'create-communities' ? (
              <AdvancedJsonEditor
                value={advancedJson}
                onChange={setAdvancedJson}
              />
            ) : (
              <div className="input-group">
                <label className="input-label">Payload (JSON)</label>
                <textarea
                  value={advancedJson}
                  onChange={e => setAdvancedJson(e.target.value)}
                  placeholder={JSON.stringify(templateData.inputSchema.examples?.[0] || {}, null, 2)}
                  rows={20}
                  className="font-mono text-sm"
                  spellCheck={false}
                />
                <p className="input-help">Paste your JSON payload directly</p>
              </div>
            )}
          </div>
        ) : (
          // Dynamic form mode (for non-GL-sync templates)
          <div className="space-y-1">
            {usesCompanyLookup && (
              <CompanyLookup
                companyName={formData.companyName}
                hubspotCompanyId={formData.hubspotCompanyId}
                onSelect={handleCompanySelect}
              />
            )}
            {usesCompanyLookup && hostAutoFilled && (
              <p className="text-xs text-success -mt-4 mb-4">
                ✓ ALIS subdomain auto-filled from a previous job for this account — double-check it before running.
              </p>
            )}
            {fields
              .filter(field => !usesCompanyLookup || (field.key !== 'companyName' && field.key !== 'hubspotCompanyId'))
              .map(field => renderFormField(field, formData[field.key], handleFormChange))}
          </div>
        )}

        {/* Health Export JSON — additive to the form above, never a replacement.
            The skill's export has no ALIS subdomain or period dates, so the
            configuration fields are always still required alongside it. */}
        {isKpiExport && !showAdvanced && (
          <div className="mt-8 pt-6 border-t border-neutral-200">
            <h3 className="text-lg font-semibold text-primary-900 mb-1">
              Also attach Health Export JSON <span className="text-sm font-normal text-neutral-500">(optional)</span>
            </h3>
            <p className="text-sm text-neutral-600 mb-4">
              Paste the JSON output from the <span className="font-mono text-xs">qbr-export</span> Claude skill to include HubSpot Service &amp; Financial health data in this QBR from the start. This adds to the configuration above — it doesn't replace it, since the skill's export can't supply the ALIS subdomain or reporting period. You can also skip this and import it later from the QBR dashboard once the job finishes.
            </p>

            {healthImportWarning && (
              <div className="alert alert-warning mb-3">
                <span>⚠️</span>
                <p className="text-sm">{healthImportWarning}</p>
              </div>
            )}

            <div className="input-group">
              <textarea
                value={healthImportText}
                onChange={(e) => handleHealthImportChange(e.target.value)}
                placeholder='Paste account-health-export JSON here (e.g. { "service_health": {...}, "financial_health": {...} })'
                rows={8}
                className="font-mono text-xs"
                spellCheck={false}
              />
              {healthImportError && <p className="text-xs text-danger mt-2">{healthImportError}</p>}
              {healthImportParsed && !healthImportError && (
                <p className="text-xs text-success mt-2">
                  ✓ Parsed — health data for {healthImportParsed.account?.name || 'this account'} will be attached when the job completes.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Release Recommendations JSON — same "additive, optional, can also
            import later from the QBR dashboard" pattern as Health Export
            above. See server/services/RELEASE_RECOMMENDATIONS_SCHEMA.md. */}
        {isKpiExport && !showAdvanced && (
          <div className="mt-8 pt-6 border-t border-neutral-200">
            <h3 className="text-lg font-semibold text-primary-900 mb-1">
              Also attach Release Recommendations JSON <span className="text-sm font-normal text-neutral-500">(optional)</span>
            </h3>
            <p className="text-sm text-neutral-600 mb-4">
              Paste the JSON output from the release-recommendations Claude Project to include a "Recent ALIS Platform Releases" slide curated for this account. You can also skip this and import it later from the QBR dashboard once the job finishes.
            </p>

            {releaseImportWarning && (
              <div className="alert alert-warning mb-3">
                <span>⚠️</span>
                <p className="text-sm">{releaseImportWarning}</p>
              </div>
            )}

            <div className="input-group">
              <textarea
                value={releaseImportText}
                onChange={(e) => handleReleaseImportChange(e.target.value)}
                placeholder='Paste release-recommendations JSON here (e.g. { "releases": [{ "title": "...", "description": "..." }] })'
                rows={8}
                className="font-mono text-xs"
                spellCheck={false}
              />
              {releaseImportError && <p className="text-xs text-danger mt-2">{releaseImportError}</p>}
              {releaseImportParsed && !releaseImportError && (
                <p className="text-xs text-success mt-2">
                  ✓ Parsed — {releaseImportParsed.releases.length} release(s) will be attached when the job completes.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Submit - only for non-GL-sync templates (GL sync button is above the table), and not for Evaluation Lookup (not a job) */}
      {!isGLSync && selectedTemplate !== 'evaluation-lookup' && (
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={loading || !selectedTemplate}
            className="btn btn-primary btn-lg"
          >
            {loading ? 'Starting...' : 'Run Job →'}
          </button>
        </div>
      )}
    </div>
  );
}
