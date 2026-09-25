/**
 * Interactive first-run wizard — asks for this person's own credentials
 * and writes server/.env. Run automatically by start.command (Mac) /
 * start.bat (Windows) the first time, when server/.env doesn't exist yet.
 * Safe to re-run manually (`node scripts/first-run-setup.js`) to redo it.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', 'server', '.env');
const examplePath = path.join(__dirname, '..', '.env.example');

// Same portal for everyone at ALIS — never asked.
const HUBSPOT_PORTAL_ID = '5340932';

// Snapshot of server/services/hubspotAccounts.js's ACCOUNT_MANAGER_NAMES —
// no live sync, update both places when someone joins/leaves (same caveat
// as that file's own comment).
const OWNERS = [
  { name: 'Aaron Whitmer', id: '280699315' },
  { name: 'Taylor King', id: '474571664' },
  { name: 'Patrick Noack', id: '2558500' },
  { name: 'Owen Phoenix', id: '49052011' },
  { name: 'Jeffery Brown', id: '77259229' },
  { name: 'Jessica Crouse', id: '90345669' },
  { name: 'Evan Kuo', id: '212010676' },
  { name: 'Gary Jones', id: '1152655184' },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

async function askOwnerId() {
  console.log('\nWhich of these is you? (scopes your dashboards to your own book of accounts)');
  OWNERS.forEach((o, i) => console.log(`  ${i + 1}. ${o.name}`));
  console.log(`  ${OWNERS.length + 1}. Not listed — I'll enter my HubSpot Owner ID myself`);

  const choice = await ask('Enter a number: ');
  const index = Number(choice) - 1;
  if (index >= 0 && index < OWNERS.length) return OWNERS[index].id;

  console.log('Find it in HubSpot under Settings > Account Management > Users & Teams — click your name, it\'s the number in the URL.');
  return ask('Your HubSpot Owner ID: ');
}

async function main() {
  console.log('\n== ALIS Hub setup ==');
  console.log("Answering these once. They're saved to server/.env on this computer only — never shared or committed.\n");

  const alisUsername = await ask('Your ALIS login email/username: ');
  const alisPassword = await ask('Your ALIS password: ');

  console.log('\nHubSpot Private App Token — get this from Aaron (Slack or in person, not email).');
  const hubspotToken = await ask('HubSpot Private App Token: ');

  const hubspotOwnerId = await askOwnerId();

  const template = fs.readFileSync(examplePath, 'utf8');
  const values = {
    ALIS_USERNAME: alisUsername,
    ALIS_PASSWORD: alisPassword,
    // ALIS Export API's Basic Auth username is always the same local part
    // as the ALIS login itself (firstName.lastName) — no separate prompt.
    ALIS_EXPORT_API_USERNAME_BASE: alisUsername.split('@')[0],
    HUBSPOT_PRIVATE_APP_TOKEN: hubspotToken,
    HUBSPOT_PORTAL_ID: HUBSPOT_PORTAL_ID,
    HUBSPOT_OWNER_ID: hubspotOwnerId,
  };

  const filled = template.split('\n').map((line) => {
    const match = line.match(/^([A-Z_]+)=/);
    if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
      return `${match[1]}=${values[match[1]]}`;
    }
    return line;
  }).join('\n');

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, filled);

  console.log('\nSaved server/.env — starting the app now.\n');
  rl.close();
}

main();
