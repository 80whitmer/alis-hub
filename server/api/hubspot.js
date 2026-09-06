const express = require('express');
const https   = require('https');
const router  = express.Router();

/**
 * POST to HubSpot API with Bearer auth.
 * Uses HUBSPOT_PRIVATE_APP_TOKEN from .env
 */
function hubspotPost(path, body) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return Promise.reject(
      new Error('HUBSPOT_PRIVATE_APP_TOKEN is not set in server/.env')
    );
  }

  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          reject(new Error('Non-JSON response from HubSpot'));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * GET /api/hubspot/search?q=<company name>
 *
 * Searches HubSpot companies by name and returns fields
 * mapped to the Create Communities template:
 *   hubspotId  → crm_id
 *   name       → name
 *   address    → street
 *   city, state, zip
 *   total_capacity → licensed_capacity & physical_capacity
 *
 * NOTE: companyUrl (ALIS admin URL) is NOT a HubSpot property
 *       and must be entered manually.
 */
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
      return res.status(503).json({
        error:
          'HubSpot not configured — add HUBSPOT_PRIVATE_APP_TOKEN to server/.env',
      });
    }

    const { status, body } = await hubspotPost(
      '/crm/v3/objects/companies/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'name',
                operator: 'CONTAINS_TOKEN',
                value: q.trim(),
              },
            ],
          },
        ],
        properties: [
          'name',
          'address',
          'city',
          'state',
          'zip',
          'total_capacity',
        ],
        sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
        limit: 8,
      }
    );

    if (status !== 200) {
      console.error('[HubSpot] Search returned', status, body);
      return res
        .status(status)
        .json({ error: body.message || `HubSpot error ${status}` });
    }

    const companies = (body.results || []).map((record) => {
      const p = record.properties || {};
      const cap = p.total_capacity || '';
      return {
        hubspotId:          record.id,
        name:               p.name               || '',
        street:             p.address            || '',
        city:               p.city               || '',
        state:              p.state              || '',
        zip:                p.zip                || '',
        licensed_capacity:  cap,
        physical_capacity:  cap,
      };
    });

    res.json({ companies, total: body.total ?? companies.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
