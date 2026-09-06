require('dotenv').config();
const crypto = require('crypto');
const { initDb, createJob, getUsageAuditSnapshot } = require('./db/database');
const { runCompanyUsageAuditJob } = require('./automation/usageAudit');

// End-to-end smoke test of the new company-usage-audit job against real
// Imagine Senior Living data: HubSpot company 28652046383, ALIS host
// "imagineseniorliving", ALIS admin company 353 (Entitlements page).
(async () => {
  await initDb();

  const jobId = crypto.randomUUID();
  const payload = {
    companyName: 'Imagine Senior Living',
    companyHost: 'imagineseniorliving',
    alisAdminCompanyIds: '353',
    hubspotCompanyId: '28652046383',
    lookbackDays: 90,
  };

  createJob({ id: jobId, type: 'company-usage-audit', label: payload.companyName, payload, total: 0, items: [] });

  console.log(`Running job ${jobId}...`);
  await runCompanyUsageAuditJob(jobId, payload);

  const snapshot = getUsageAuditSnapshot(jobId);
  if (!snapshot) {
    console.log('No snapshot was written — job likely failed early. Check job status:');
    return;
  }

  const s = snapshot.summary;
  console.log('\n=== SUMMARY ===');
  console.log('companyName:', s.companyName);
  console.log('hosts:', s.hosts);
  console.log('communities:', s.communities.map((c) => `${c.name} (${c.communityId})`));
  console.log('dataWarnings:', s.dataWarnings);
  console.log('unmatchedDeals:', s.unmatchedDeals.map((d) => d.dealName));

  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', '..', 'scratchpad-audit-recon', 'usage_audit_smoke_test.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nFull snapshot written to ${outPath}`);

  // Print one community's feature rows as a compact table for a quick eyeball check.
  const firstCommunity = s.communities[0];
  if (firstCommunity) {
    const key = `${firstCommunity.host}::${firstCommunity.communityId}`;
    console.log(`\n=== ${firstCommunity.name} ===`);
    for (const f of s.features) {
      const cell = f.byCommunity[key];
      console.log(`${f.category.padEnd(12)} ${f.label.padEnd(35)} contracted=${String(cell.contracted).padEnd(6)} enabled=${String(cell.enabled).padEnd(6)} used=${String(cell.used).padEnd(6)} usageCount=${cell.usageCount}`);
    }
  }
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
