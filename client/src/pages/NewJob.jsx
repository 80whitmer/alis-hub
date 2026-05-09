import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateFormFields, renderFormField } from '../utils/schema-form-generator';
import BillingItemsInput from '../components/BillingItemsInput';

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
    if (!selectedTemplate) return;

    fetch(`/api/jobs/templates/${selectedTemplate}`)
      .then(r => r.json())
      .then(data => {
        setTemplateData(data);
        setFormData({});
        setAdvancedJson('');
        setError('');
      })
      .catch(err => setError(`Failed to load template: ${err.message}`));
  }, [selectedTemplate]);

  function handleFormChange(key, value) {
    setFormData(prev => ({
      ...prev,
      [key]: value,
    }));
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

    let payload = showAdvanced ? validateAdvancedJson() : formData;

    if (!payload) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate,
          label: undefined, // Use template default
          payload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      navigate(`/jobs/${data.id}`);
    } catch (err) {
      setError(err.message);
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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary-900 mb-2">Create Automation Job</h1>
        <p className="text-neutral-600">Select a template and fill in the required information</p>
      </div>

      {/* Template selector */}
      <div className="mb-8">
        <label className="input-label">Job Type</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map(template => (
            <button
              key={template.id}
              onClick={() => setSelectedTemplate(template.id)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedTemplate === template.id
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-neutral-200 bg-white hover:border-neutral-300'
              }`}
            >
              <div className="text-xl font-bold">{template.icon}</div>
              <h3 className="font-semibold text-primary-900 mt-2">{template.name}</h3>
              <p className="text-xs text-neutral-600 mt-1">{template.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Form or advanced mode */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-primary-900">Configuration</h2>
          {!isGLSync && (
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

            {/* Billing items */}
            <div>
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
          // Advanced JSON mode
          <div className="input-group mb-6">
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
        ) : (
          // Dynamic form mode (for non-GL-sync templates)
          <div className="space-y-1">
            {fields.map(field => renderFormField(field, formData[field.key], handleFormChange))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={loading || !selectedTemplate}
          className="btn btn-primary btn-lg"
        >
          {loading ? 'Starting...' : 'Run Job →'}
        </button>
      </div>
    </div>
  );
}
