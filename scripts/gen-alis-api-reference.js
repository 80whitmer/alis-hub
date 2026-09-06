/**
 * Regenerates server/services/ALIS_EXPORT_API_REFERENCE.md from the live
 * ALIS OpenAPI specs (v1 and v2 — alis-hub uses endpoints from both, e.g.
 * getInvoiceCharges is v2 while getRecurringCharges is v1). Run this
 * whenever the export API might have changed rather than hand-editing.
 *
 * Usage:
 *   curl -s https://api.alisonline.com/specs/v1/openapi.json -o /tmp/alis_openapi_v1.json
 *   curl -s https://api.alisonline.com/specs/v2/openapi.json -o /tmp/alis_openapi_v2.json
 *   node scripts/gen-alis-api-reference.js /tmp/alis_openapi_v1.json /tmp/alis_openapi_v2.json server/services/ALIS_EXPORT_API_REFERENCE.md
 */
const fs = require('fs');

const v1Path = process.argv[2];
const v2Path = process.argv[3];
const outPath = process.argv[4];
if (!v1Path || !v2Path || !outPath) {
  console.error('Usage: node gen-alis-api-reference.js <v1 openapi.json> <v2 openapi.json> <output .md path>');
  process.exit(1);
}
const v1Spec = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
const v2Spec = JSON.parse(fs.readFileSync(v2Path, 'utf8'));

function makeHelpers(spec) {
  function resolveRef(ref) {
    const parts = ref.replace('#/', '').split('/');
    return parts.reduce((acc, p) => acc[p], spec);
  }
  function schemaTypeLabel(schema) {
    if (!schema) return 'unknown';
    if (schema.$ref) return schemaTypeLabel(resolveRef(schema.$ref));
    if (schema.type === 'array') return `${schemaTypeLabel(schema.items)}[]`;
    let t = schema.type || 'object';
    if (schema.format) t += ` (${schema.format})`;
    if (schema.nullable) t += ', nullable';
    return t;
  }
  function flattenSchemaProps(schema) {
    if (!schema) return [];
    if (schema.$ref) return flattenSchemaProps(resolveRef(schema.$ref));
    if (schema.type === 'array') return flattenSchemaProps(schema.items);
    // Paginated wrappers ({ items: [...], pageNumber, ... }) — flatten the
    // item shape, not the wrapper's own fields.
    if (schema.properties && schema.properties.items) return flattenSchemaProps(schema.properties.items);
    const props = schema.properties || {};
    return Object.entries(props).map(([name, propSchema]) => ({
      name,
      type: schemaTypeLabel(propSchema),
      enum: propSchema.enum ? propSchema.enum.join(' | ') : null,
    }));
  }
  return { resolveRef, schemaTypeLabel, flattenSchemaProps };
}

// Keep in sync with server/services/alisApiClient.js — which export paths
// already have a wrapper function there, regardless of API version.
const WIRED = {
  '/v2/export/communities/floorPlan/hqOccupancies': 'getOccupancy',
  '/v1/export/communities': 'getCommunities',
  '/v1/export/staff': 'getStaff',
  '/v1/export/residents': 'getResidents',
  '/v1/export/residents/moveInsAndOuts': 'getMoveInsAndOuts',
  '/v1/export/residents/historicalMoveInMoveOuts': 'getHistoricalMoveInMoveOuts',
  '/v1/export/residents/incidents': 'getIncidents',
  '/v1/export/residents/leaves': 'getLeaves',
  '/v1/export/clinical/diagnosesAndAllergies': 'getDiagnosesAndAllergies',
  '/v1/export/residents/evaluations': 'getEvaluations',
  '/v1/export/care/recordedCare': 'getRecordedCare',
  '/v1/export/billing/recurringCharges': 'getRecurringCharges',
  '/v1/export/billing/outstandingInvoices': 'getOutstandingInvoices',
  '/v1/export/clinical/orderAdministration': 'getOrderAdministration',
  '/v2/export/billing/invoiceCharges': 'getInvoiceCharges',
};

function renderEndpointSection(spec, helpers, path) {
  const { schemaTypeLabel, flattenSchemaProps } = helpers;
  const get = spec.paths[path].get;
  if (!get) return '';
  const wired = WIRED[path];

  let md = `## ${wired ? '✅' : '⬜'} \`GET ${path}\`\n\n`;
  if (wired) md += `**Wired up as:** \`${wired}()\` in \`server/services/alisApiClient.js\`\n\n`;
  if (get.summary) md += `${get.summary}\n\n`;
  if (get.description) md += `${get.description.replace(/<[^>]+>/g, '').trim()}\n\n`;

  const params = get.parameters || [];
  if (params.length > 0) {
    md += `**Query parameters:**\n\n`;
    md += `| Name | Type | Required | Description |\n|---|---|---|---|\n`;
    params.forEach((param) => {
      const t = schemaTypeLabel(param.schema);
      const desc = (param.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      md += `| \`${param.name}\` | ${t} | ${param.required ? 'yes' : 'no'} | ${desc.replace(/\|/g, '\\|')} |\n`;
    });
    md += `\n`;
  } else {
    md += `**Query parameters:** none — account-wide pull, returns full history\n\n`;
  }

  const responses = get.responses || {};
  const okResponse = responses['200'];
  let responseSchema = null;
  if (okResponse && okResponse.content) {
    const content = okResponse.content['application/json'] || okResponse.content['text/json'] || Object.values(okResponse.content)[0];
    responseSchema = content && content.schema;
  }

  if (responseSchema) {
    const fields = flattenSchemaProps(responseSchema);
    if (fields.length > 0) {
      md += `**Response fields** (array of objects):\n\n`;
      md += `| Field | Type | Enum values |\n|---|---|---|\n`;
      fields.forEach((f) => {
        md += `| \`${f.name}\` | ${f.type} | ${f.enum || ''} |\n`;
      });
      md += `\n`;

      const dateFields = fields.filter((f) => /date|time/i.test(f.name));
      if (dateFields.length > 0) {
        md += `**Likely date fields for period filtering:** ${dateFields.map((f) => `\`${f.name}\``).join(', ')}\n\n`;
      }
    }
  }

  md += `[↑ back to index](#index)\n\n---\n\n`;
  return md;
}

function renderVersionSection(spec, version, anchorPrefix) {
  const helpers = makeHelpers(spec);
  const exportPaths = Object.keys(spec.paths).filter((p) => p.startsWith(`/${version}/export/`)).sort();

  let md = `## ${version.toUpperCase()} Index\n\n`;
  exportPaths.forEach((p) => {
    const wired = WIRED[p];
    md += `- ${wired ? '✅' : '⬜'} [\`${p}\`](#${anchorPrefix}${p.replace(/[/{}]/g, '').toLowerCase()})${wired ? ` — \`${wired}()\`` : ''}\n`;
  });
  md += `\n---\n\n`;

  for (const p of exportPaths) {
    md += renderEndpointSection(spec, helpers, p);
  }
  return md;
}

let md = `# ALIS Export API Reference\n\n`;
md += `Auto-generated from the live specs at https://api.alisonline.com/specs/v1/openapi.json and .../specs/v2/openapi.json — regenerate this file rather than hand-editing it if the API changes (see the script note at the bottom). Export endpoints only; \`/v1/integration/*\` and \`/v2/integration/*\` aren't covered here.\n\n`;
md += `alis-hub deliberately mixes versions — most endpoints are v1, but a few (like invoice charges) are v2-only or have a meaningfully better v2 schema (real date-range filtering, for instance). Check both index sections below before assuming an endpoint doesn't exist.\n\n`;
md += `All export endpoints are account-wide GETs (Basic Auth per \`server/services/alisApiClient.js\`); most take no date-range query param, so period-based reporting has to filter client-side (see \`filterByDateRange\` in \`server/services/kpiNormalizer.js\`) — check each endpoint's "date fields" note, and its query parameters table, to know whether server-side filtering is available.\n\n`;
md += `**Legend:** ✅ = already wired up in \`alisApiClient.js\` · ⬜ = not yet used by alis-hub\n\n`;
md += `## Index\n\n- [V1 Index](#v1-index)\n- [V2 Index](#v2-index)\n\n---\n\n`;

md += renderVersionSection(v1Spec, 'v1', 'v1');
md += renderVersionSection(v2Spec, 'v2', 'v2');

md += `\n## Regenerating this file\n\n`;
md += `\`\`\`bash\ncurl -s https://api.alisonline.com/specs/v1/openapi.json -o /tmp/alis_openapi_v1.json\ncurl -s https://api.alisonline.com/specs/v2/openapi.json -o /tmp/alis_openapi_v2.json\nnode scripts/gen-alis-api-reference.js /tmp/alis_openapi_v1.json /tmp/alis_openapi_v2.json server/services/ALIS_EXPORT_API_REFERENCE.md\n\`\`\`\n`;
md += `\nGenerated ${new Date().toISOString().slice(0, 10)}.\n`;

fs.writeFileSync(outPath, md);
console.log('Wrote', outPath, '(', fs.statSync(outPath).size, 'bytes )');
