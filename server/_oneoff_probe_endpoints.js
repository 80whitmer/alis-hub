require('dotenv').config();
const https = require('https');
const { alisApiGet, getIncidents, getCommunities } = require('./services/alisApiClient');

const HOST = 'imagineseniorliving';

function authHeader() {
  const usernameBase = process.env.ALIS_EXPORT_API_USERNAME_BASE;
  const pass = process.env.ALIS_PASSWORD;
  const user = `${usernameBase}@${HOST}`;
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// Raw GET against an arbitrary path with the export Basic-Auth creds — used
// to probe endpoints alisApiClient.js doesn't wrap yet (Integration API,
// formData). Same shape as alisApiClient's internal helper, duplicated here
// since it's not exported.
function rawGet(path, params = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const fullPath = query ? `${path}?${query}` : path;
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.alisonline.com',
      path: fullPath,
      method: 'GET',
      headers: { Authorization: authHeader(), Accept: 'application/json' },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '' }); });
    req.on('error', (err) => resolve({ status: 'ERROR', body: err.message }));
    req.end();
  });
}

(async () => {
  console.log(`\n=== Probing against host "${HOST}" ===\n`);

  // 1. xmlDocuments — what's inside retXml?
  console.log('--- GET /v1/export/residents/evaluations/xmlDocuments?status=CurrentResident ---');
  try {
    const rows = await alisApiGet(HOST, '/v1/export/residents/evaluations/xmlDocuments', { status: 'CurrentResident' });
    console.log(`Got ${Array.isArray(rows) ? rows.length : '?'} rows.`);
    const sample = Array.isArray(rows) ? rows.find((r) => r.retXml) : null;
    if (sample) {
      console.log('Sample row (retXml truncated to 3000 chars):');
      console.log(JSON.stringify({ ...sample, retXml: (sample.retXml || '').slice(0, 3000) }, null, 2));
    } else {
      console.log('No row with a populated retXml found in the sample.');
      console.log('First row (if any):', JSON.stringify(rows?.[0], null, 2));
    }
  } catch (err) {
    console.log('FAILED:', err.message);
  }

  // Grab a real, non-training communityId to use in the probes below.
  let realCommunityId = null;
  try {
    const communities = await getCommunities(HOST);
    const real = communities.find((c) => !(c.communityName || '').toLowerCase().includes('training'));
    realCommunityId = real?.communityId;
    console.log(`\nUsing real communityId=${realCommunityId} ("${real?.communityName}") for scoped probes below.`);
  } catch (err) {
    console.log('Could not pull communities:', err.message);
  }

  // 2. v2/integration/incidents — does our export Basic Auth work at all against Integration paths?
  console.log('\n--- GET /v2/integration/incidents (export creds, real communityId + date range) ---');
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const incidentsProbe = await rawGet('/v2/integration/incidents', { CommunityId: realCommunityId, StartDate: ninetyAgo, EndDate: today });
  console.log(`Status: ${incidentsProbe.status}`);
  console.log('Body (first 2000 chars):', incidentsProbe.body.slice(0, 2000));

  // 3. formData — try several incidents, including ones with completedForms > 0
  console.log('\n--- GET /v1/export/residents/incidents/{id}/formData ---');
  try {
    const incidents = await getIncidents(HOST);
    const candidates = [
      incidents.find((i) => (i.completedForms || 0) > 0),
      incidents.find((i) => (i.incompleteForms || 0) > 0 && (i.completedForms || 0) === 0),
    ].filter(Boolean);
    if (candidates.length === 0) {
      console.log('No incidents with any forms (complete or incomplete) found — cannot test formData meaningfully.');
    }
    for (const inc of candidates) {
      console.log(`\nTesting formData for incidentId=${inc.incidentId} (type="${inc.incidentType}", completedForms=${inc.completedForms}, incompleteForms=${inc.incompleteForms})`);
      const formDataProbe = await rawGet(`/v1/export/residents/incidents/${inc.incidentId}/formData`);
      console.log(`Status: ${formDataProbe.status}`);
      console.log('Body (first 3000 chars):', formDataProbe.body.slice(0, 3000));
    }
  } catch (err) {
    console.log('FAILED to pull incidents for formData test:', err.message);
  }

  console.log('\n=== Done ===');
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
