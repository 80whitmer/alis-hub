import { useState } from 'react';

// Blank template matching the create-communities inputSchema
const BLANK_TEMPLATE = {
  companyUrl: 'https://admin.alisonline.com/Customers/Companies/...',
  communities: [
    {
      name: '',
      crm_id: '',
      licensed_capacity: '',
      physical_capacity: '',
      street: '',
      city: '',
      state: '',
      zip: '',
    },
  ],
};

const TEMPLATE_STRING = JSON.stringify(BLANK_TEMPLATE, null, 2);

export default function AdvancedJsonEditor({ value, onChange }) {
  const [copied,            setCopied]            = useState(false);
  const [validationError,   setValidationError]   = useState(null);
  const [validationSuccess, setValidationSuccess] = useState(false);

  function copyTemplate() {
    navigator.clipboard.writeText(TEMPLATE_STRING);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resetToTemplate() {
    onChange(TEMPLATE_STRING);
    setValidationError(null);
    setValidationSuccess(false);
  }

  function handleChange(text) {
    onChange(text);
    setValidationError(null);
    setValidationSuccess(false);
  }

  function validate() {
    if (!value.trim()) {
      setValidationError('Paste your populated JSON above before submitting.');
      return false;
    }
    try {
      JSON.parse(value);
      setValidationError(null);
      setValidationSuccess(true);
      setTimeout(() => setValidationSuccess(false), 2000);
      return true;
    } catch (e) {
      setValidationError(`Invalid JSON: ${e.message}`);
      return false;
    }
  }

  return (
    <div className="space-y-4">

      {/* Step 1 — Copy the template */}
      <div className="p-4 rounded-lg border border-accent-200 bg-accent-50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-primary-900">Step 1 — Copy the template</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Use this structure in your HubSpot skill to pull community details, then paste the result below.
            </p>
          </div>
          <button
            type="button"
            onClick={copyTemplate}
            className="btn btn-secondary btn-sm shrink-0 ml-4"
          >
            {copied ? '✓ Copied!' : 'Copy Template'}
          </button>
        </div>
        <pre className="text-xs font-mono bg-white border border-neutral-200 rounded-lg p-3 overflow-x-auto text-neutral-700 leading-relaxed">
          {TEMPLATE_STRING}
        </pre>
      </div>

      {/* Step 2 — Paste populated JSON */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <p className="text-sm font-semibold text-primary-900">Step 2 — Paste your populated JSON</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Replace the template values with real community data, then hit <strong>Run Job →</strong>
            </p>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            <button
              type="button"
              onClick={validate}
              className="btn btn-secondary btn-sm"
            >
              Validate
            </button>
            <button
              type="button"
              onClick={resetToTemplate}
              className="btn btn-secondary btn-sm"
            >
              Reset
            </button>
          </div>
        </div>

        <textarea
          value={value}
          onChange={e => handleChange(e.target.value)}
          placeholder={TEMPLATE_STRING}
          rows={18}
          className="font-mono text-sm w-full"
          style={{
            borderColor: validationError ? 'var(--color-error, #e22405)' : undefined,
          }}
          spellCheck={false}
        />

        {validationError && (
          <p className="mt-1 text-xs text-red-600">⚠ {validationError}</p>
        )}
        {validationSuccess && (
          <p className="mt-1 text-xs text-green-600">✓ Valid JSON — ready to submit</p>
        )}
      </div>

    </div>
  );
}
