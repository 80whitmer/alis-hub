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

/**
 * Parses a bulk-paste block (comma AND/OR newline separated) into an array
 * of partial item objects for an array-of-objects field — e.g. "952, 965,
 * 1049" or one "Name:ID" / "ID:Name" pair per line. Guesses which sub-field
 * is the "ID" one (name matching /id$/i — communityId, residentId, etc.)
 * and which is the display-name one (matching /name$/i, else just the
 * first declared property) rather than hardcoding either, so this works
 * for any array field's sub-shape without per-template special-casing.
 * A bare numeric token with no delimiter fills the ID field and defaults
 * the name field to the same value, so a purely-IDs paste still produces
 * usable (if unlabeled) rows instead of failing schema's `required: ["name"]`.
 */
function parseBulkEntries(text, itemProperties) {
  const propKeys = Object.keys(itemProperties || {});
  const idKey = propKeys.find((k) => /id$/i.test(k));
  const nameKey = propKeys.find((k) => /name$/i.test(k)) || propKeys[0];

  return text
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const parts = token.split(/[:|]/).map((p) => p.trim()).filter(Boolean);
      const item = {};
      if (parts.length >= 2) {
        const numericPart = parts.find((p) => /^\d+$/.test(p));
        const otherPart = parts.find((p) => p !== numericPart);
        if (idKey && numericPart) item[idKey] = numericPart;
        if (nameKey && otherPart) item[nameKey] = otherPart;
      } else if (parts.length === 1) {
        const [only] = parts;
        if (idKey && /^\d+$/.test(only)) {
          item[idKey] = only;
          if (nameKey) item[nameKey] = only;
        } else if (nameKey) {
          item[nameKey] = only;
        }
      }
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

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

          {property.items?.properties && (
            <div className="mb-4 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <label className="input-label text-xs">Bulk add (optional)</label>
              <textarea
                id={`bulk-add-${key}`}
                rows={2}
                className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 mb-2"
                placeholder="Paste IDs, comma or newline separated (e.g. 952, 965, 1049) — or Name:ID / ID:Name pairs, one per line"
              />
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  const el = document.getElementById(`bulk-add-${key}`);
                  const entries = parseBulkEntries(el.value, property.items.properties);
                  if (entries.length === 0) return;
                  onChange(key, [...(value || []), ...entries]);
                  el.value = '';
                }}
              >
                + Add all from list
              </button>
            </div>
          )}

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
