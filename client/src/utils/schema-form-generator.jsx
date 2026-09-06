/**
 * schema-form-generator.js
 * Generate form fields from JSON Schema
 * Supports: string, number, boolean, array of objects
 *
 * `number` and `boolean` were silently unrenderable until now (the switch
 * below had no case for either, falling through to `default: return null`)
 * — confirmed live (Sep 2026) as the root cause of a real audit-history
 * job failure: its `includeCompany` boolean field never appeared on the
 * form at all, so there was no way to check it, and the job failed with
 * "At least one target... is required" despite the user's intent. The
 * pre-existing `lookbackDays` (company-usage-audit, type: "number") had
 * the same silent gap — it just happened to have a schema `default` that
 * masked it.
 */

export function generateFormFields(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return [];
  }

  const fields = [];

  for (const [key, property] of Object.entries(schema.properties)) {
    const isRequired = schema.required && schema.required.includes(key);

    fields.push({
      key,
      type: property.type,
      title: property.title || key,
      description: property.description,
      placeholder: property.examples?.[0] || '',
      required: isRequired,
      property, // Full property for advanced handling
    });
  }

  return fields;
}

export function renderFormField(field, value, onChange) {
  const { key, type, title, description, placeholder, required, property } = field;

  switch (type) {
    case 'string':
      if (property.pattern === '^\\d{2}/\\d{2}/\\d{4}$') {
        // Date field (MM/DD/YYYY)
        return (
          <div key={key} className="input-group mb-6">
            <label className="input-label">
              {title}
              {!required && <span className="text-neutral-400"> (optional)</span>}
            </label>
            <input
              type="text"
              placeholder={placeholder || 'MM/DD/YYYY'}
              value={value || ''}
              onChange={(e) => onChange(key, e.target.value)}
              pattern="\d{2}/\d{2}/\d{4}"
            />
            {description && <p className="input-help">{description}</p>}
          </div>
        );
      } else {
        // Regular text field
        return (
          <div key={key} className="input-group mb-6">
            <label className="input-label">
              {title}
              {!required && <span className="text-neutral-400"> (optional)</span>}
            </label>
            <input
              type="text"
              placeholder={placeholder}
              value={value || ''}
              onChange={(e) => onChange(key, e.target.value)}
            />
            {description && <p className="input-help">{description}</p>}
          </div>
        );
      }

    case 'number':
      return (
        <div key={key} className="input-group mb-6">
          <label className="input-label">
            {title}
            {!required && <span className="text-neutral-400"> (optional)</span>}
          </label>
          <input
            type="number"
            placeholder={placeholder}
            value={value ?? property.default ?? ''}
            onChange={(e) => onChange(key, e.target.value === '' ? undefined : Number(e.target.value))}
          />
          {description && <p className="input-help">{description}</p>}
        </div>
      );

    case 'boolean':
      return (
        <div key={key} className="input-group mb-6">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(key, e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-primary-600"
            />
            <span className="input-label mb-0">{title}</span>
          </label>
          {description && <p className="input-help">{description}</p>}
        </div>
      );

    case 'array':
      // Array of objects — render as expandable table/form
      return (
        <div key={key} className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="input-label">{title}</label>
            <button
              type="button"
              onClick={() => onChange(key, [...(value || []), {}])}
              className="btn btn-sm btn-secondary"
            >
              + Add {property.title || 'Item'}
            </button>
          </div>

          {description && <p className="input-help mb-3">{description}</p>}

          <div className="space-y-4">
            {(value || []).map((item, idx) => (
              <div key={idx} className="card-sm bg-neutral-50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-primary-900">
                    {property.title || 'Item'} {idx + 1}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      const newValue = value.filter((_, i) => i !== idx);
                      onChange(key, newValue);
                    }}
                    className="text-error hover:text-red-700 text-sm font-medium"
                  >
                    Remove
                  </button>
                </div>

                <div className="space-y-3">
                  {property.items?.properties &&
                    Object.entries(property.items.properties).map(
                      ([subKey, subProperty]) => {
                        const subRequired =
                          property.items.required &&
                          property.items.required.includes(subKey);

                        return (
                          <div key={subKey}>
                            <label className="input-label">
                              {subProperty.title || subKey}
                              {!subRequired && (
                                <span className="text-neutral-400"> (optional)</span>
                              )}
                            </label>
                            <input
                              type="text"
                              placeholder={subProperty.examples?.[0] || ''}
                              value={item[subKey] || ''}
                              onChange={(e) => {
                                const newArray = [...value];
                                newArray[idx] = {
                                  ...item,
                                  [subKey]: e.target.value,
                                };
                                onChange(key, newArray);
                              }}
                            />
                            {subProperty.description && (
                              <p className="input-help">{subProperty.description}</p>
                            )}
                          </div>
                        );
                      }
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return null;
  }
}
