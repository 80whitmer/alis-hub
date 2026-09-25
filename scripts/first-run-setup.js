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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

async function main() {
  console.log('\n== ALIS Hub setup ==');
  console.log("Answering these once. They're saved to server/.env on this computer only — never shared or committed.\n");

  const alisUsername = await ask('Your ALIS login email/username: ');
  const alisPassword = await ask('Your ALIS password: ');

  console.log('\nALIS Export API username — if your ALIS login looks like "yourname@somecommunity",');
  const exportUsername = await ask('type just the part before the @ (leave blank to reuse the part before @ in your ALIS login): ');
  const exportUsernameFinal = exportUsername || alisUsername.split('@')[0];

  console.log('\nHubSpot Private App Token — get this from Aaron (Slack or in person, not email).');
  const hubspotToken = await ask('HubSpot Private App Token: ');

  const hubspotPortal = await ask('HubSpot Portal ID (ask Aaron, or press Enter to skip): ');

  console.log('\nYour HubSpot Owner ID — find it in HubSpot under Settings > Account Management >');
  console.log('Users & Teams, click your name; it\'s the number in the page URL.');
  const hubspotOwnerId = await ask('Your HubSpot Owner ID (press Enter to skip): ');

  const hubspotOwnerEmail = await ask('Your HubSpot login email (press Enter to skip): ');

  const template = fs.readFileSync(examplePath, 'utf8');
  const values = {
    ALIS_USERNAME: alisUsername,
    ALIS_PASSWORD: alisPassword,
    ALIS_EXPORT_API_USERNAME_BASE: exportUsernameFinal,
    HUBSPOT_PRIVATE_APP_TOKEN: hubspotToken,
    HUBSPOT_PORTAL_ID: hubspotPortal,
    HUBSPOT_OWNER_ID: hubspotOwnerId,
    HUBSPOT_OWNER_EMAIL: hubspotOwnerEmail,
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
