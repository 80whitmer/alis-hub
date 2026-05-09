#!/usr/bin/env node

/**
 * Deploy automation templates & configs to HubSpot
 *
 * Usage:
 *   npm run deploy -- --env=development
 *   npm run deploy -- --env=production
 */

require('dotenv').config({ path: './server/.env' });

const https = require('https');
const fs = require('fs');
const path = require('path');

const HUBSPOT_API_URL = 'https://api.hubapi.com';
const PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID;

if (!PRIVATE_APP_TOKEN || !PORTAL_ID) {
  console.error('❌ Missing HUBSPOT_PRIVATE_APP_TOKEN or HUBSPOT_PORTAL_ID in .env');
  process.exit(1);
}

/**
 * Make authenticated request to HubSpot API
 */
function hubspotRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(HUBSPOT_API_URL + endpoint);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${PRIVATE_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null,
            headers: res.headers,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Read automation templates from local directory
 */
function readLocalTemplates() {
  const templatesDir = path.join(__dirname, '../server/automation/templates');
  if (!fs.existsSync(templatesDir)) {
    console.warn('⚠️  No templates directory found at:', templatesDir);
    return [];
  }

  return fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(templatesDir, f);
      return {
        filename: f,
        content: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
      };
    });
}

/**
 * Sync templates to HubSpot via custom objects
 */
async function syncTemplates() {
  console.log('\n📦 Reading local automation templates...');
  const templates = readLocalTemplates();

  if (templates.length === 0) {
    console.log('ℹ️  No templates to sync.');
    return { synced: 0, failed: 0 };
  }

  console.log(`Found ${templates.length} template(s)\n`);

  let synced = 0;
  let failed = 0;

  for (const template of templates) {
    try {
      console.log(`  📤 Syncing: ${template.filename}...`);

      // Example: POST to a custom object or CRM property to store template metadata
      // Adjust the endpoint based on your HubSpot integration design
      const response = await hubspotRequest(
        'POST',
        '/crm/v3/objects/custom_template',
        {
          properties: {
            template_name: template.content.name || template.filename,
            template_content: JSON.stringify(template.content),
            synced_at: new Date().toISOString(),
            portal_id: PORTAL_ID,
          },
        }
      );

      if (response.status >= 200 && response.status < 300) {
        console.log(`    ✅ Synced`);
        synced++;
      } else {
        console.log(`    ❌ Failed (status: ${response.status})`);
        if (response.data?.message) console.log(`       ${response.data.message}`);
        failed++;
      }
    } catch (err) {
      console.error(`    ❌ Error: ${err.message}`);
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Log deployment event to HubSpot for audit trail
 */
async function logDeploymentEvent(templateCount, success) {
  try {
    const gitBranch = require('child_process')
      .execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' })
      .trim();

    const gitCommit = require('child_process')
      .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
      .trim();

    console.log(`\n📝 Logging deployment event...`);

    // Create an activity/note in HubSpot or log to custom object
    await hubspotRequest(
      'POST',
      `/crm/v3/objects/contacts`,
      {
        properties: {
          // Adjust based on your actual logging strategy
          notes: `[ALIS-HUB DEPLOY] Branch: ${gitBranch}, Commit: ${gitCommit}, Templates: ${templateCount}, Status: ${success ? 'SUCCESS' : 'PARTIAL'}`,
        },
      }
    );

    console.log(`✅ Deployment logged`);
  } catch (err) {
    console.warn(`⚠️  Could not log deployment event: ${err.message}`);
  }
}

/**
 * Main deployment flow
 */
async function main() {
  console.log(`
╔════════════════════════════════════════╗
║   ALIS-HUB → HubSpot Deployment Flow   ║
╚════════════════════════════════════════╝
`);

  console.log(`🔐 Authenticating with HubSpot...`);
  console.log(`   Portal ID: ${PORTAL_ID}`);
  console.log(`   Token: ${PRIVATE_APP_TOKEN.slice(0, 10)}...`);

  try {
    // Test API connectivity
    const healthCheck = await hubspotRequest('GET', '/crm/v3/objects/contacts?limit=1');
    if (healthCheck.status === 401) {
      throw new Error('Invalid HubSpot token');
    }
    console.log(`✅ Connected\n`);

    // Sync templates
    const { synced, failed } = await syncTemplates();

    // Log deployment
    await logDeploymentEvent(synced, failed === 0);

    // Summary
    console.log(`
╔════════════════════════════════════════╗
║           Deployment Summary           ║
╠════════════════════════════════════════╣
║ Synced:  ${synced} template(s)
║ Failed:  ${failed} template(s)
║ Status:  ${failed === 0 ? '✅ SUCCESS' : '⚠️  PARTIAL'}
╚════════════════════════════════════════╝
`);

    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Deployment failed: ${err.message}\n`);
    process.exit(1);
  }
}

main();
