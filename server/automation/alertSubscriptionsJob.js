const fs = require('fs');
const path = require('path');
const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { resolveStaff, openAlertsTab, subscribeInCommunity } = require('./playwright/alertPrefsPage');
const { setJobStatus, setItemStatus, syncJobItems, getJob } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * Per-job results (contains staff names + contact flags, no PHI) live under a
 * git-ignored folder OUTSIDE server/ (nodemon restarts the server on any file write under it, which kills a running job): results.json always, so a partial run is never lost.
 */
const REPORTS_ROOT = path.join(__dirname, '..', '..', 'tmp', 'alert-subscription-reports');

const itemName = (person, community) => `${person} — ${community.name}`;

/**
 * alert-subscriptions: give each listed staff member one alert category
 * (default "Sentinel Event") by Real-time Email and/or Real-time Text, in each of
 * their listed communities, through the staff profile Alerts tab.
 *
 * Add-only: only ever ticks Real-time Email / Text on the target row; never
 * unticks, never touches other categories, never types into email/phone.
 * A missing profile email or cell downgrades that person to the available route
 * and is reported; with neither, the person is skipped and reported.
 *
 * payload: { companyName, companyHost, dryRun, alertLabel, strictLabel, sendEmail, sendText,
 *            assignments: [{ name, communities: [{ id, name }] }] }
 * Emits SSE: job_start | progress | item_start | item_done | item_fail | job_done | job_error
 */
async function runAlertSubscriptionsJob(jobId, payload) {
  const emit = (event, data) => broadcast(jobId, event, data);
  const {
    companyName, companyHost, assignments = [], dryRun = true,
    alertLabel = 'Sentinel Event', strictLabel = false,
    sendEmail = true, sendText = true,
  } = payload;

  const failJob = (error) => {
    setJobStatus(jobId, 'failed', error);
    emit('job_error', { error });
  };

  if (!companyHost) return failJob('companyHost is required.');
  if (!assignments.length) return failJob('At least one staff assignment is required.');
  if (!sendEmail && !sendText) return failJob('Pick at least one delivery route (email and/or text).');
  for (const a of assignments) {
    if (!a?.name || !Array.isArray(a.communities) || !a.communities.length) {
      return failJob(`Assignment for "${a?.name || '(unnamed)'}" has no communities.`);
    }
    for (const c of a.communities) {
      if (!c?.id || !c?.name) return failJob(`Community entry for "${a.name}" needs both id and name.`);
    }
  }

  const names = assignments.flatMap((a) => a.communities.map((c) => itemName(a.name, c)));
  if (new Set(names).size !== names.length) return failJob('Duplicate person/community pairs in the assignments.');
  syncJobItems(jobId, names);
  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: names.length, company: companyName, dryRun });
  emit('progress', {
    message: `${dryRun ? 'DRY RUN — nothing will be submitted. ' : ''}${assignments.length} people × ${names.length} person/community pairs, "${alertLabel}" via ${[sendEmail && 'Real-time Email', sendText && 'Real-time Text'].filter(Boolean).join(' + ')}.`,
  });

  const outDir = path.join(REPORTS_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  const flush = () => fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ jobId, dryRun, alertLabel, results }, null, 2));

  let page;
  try {
    page = await newPage();
    await ensureLoggedIn(page, `https://${companyHost}.alisonline.com/Staff`);
  } catch (err) {
    await page?.context().close().catch(() => {});
    return failJob(`Login failed: ${err.message}`);
  }

  const tally = { set: 0, 'already-set': 0, partial: 0, 'dry-run': 0, 'skipped-no-route': 0, failed: 0 };
  const wants = { email: !!sendEmail, text: !!sendText };

  // POST /api/jobs/:id/cancel only flips the DB status; honor it between pairs.
  const cancelled = () => {
    const j = getJob(jobId);
    return !j || j.status !== 'running';
  };

  for (const person of assignments) {
    if (cancelled()) { emit('progress', { message: 'Job cancelled — stopping.' }); break; }
    let staff;
    try {
      staff = await resolveStaff(page, companyHost, person.name, { fallbackFacilityId: person.communities[0].id });
      emit('progress', { message: `${person.name} → staff #${staff.id} (${staff.listedName})` });
    } catch (err) {
      for (const c of person.communities) {
        const n = itemName(person.name, c);
        tally.failed++;
        setItemStatus(jobId, n, 'failed', err.message);
        emit('item_fail', { name: n, error: err.message });
        results.push({ person: person.name, community: c.name, communityId: c.id, status: 'failed', detail: err.message });
      }
      flush();
      continue;
    }

    let tabOpen = false;
    for (const c of person.communities) {
      if (cancelled()) break;
      const n = itemName(person.name, c);
      setItemStatus(jobId, n, 'running');
      emit('item_start', { name: n });
      try {
        if (!tabOpen) { await openAlertsTab(page, companyHost, staff.id); tabOpen = true; }
        const shot = path.join(outDir, `dry_${staff.id}_${c.id}.png`);
        const r = await subscribeInCommunity(page, {
          facilityId: c.id, label: alertLabel, wants, dryRun, strictLabel,
          screenshotPath: dryRun ? shot : null,
        });
        tally[r.status] = (tally[r.status] || 0) + 1;
        // A flagged outcome (missing contact) is reported as success-with-detail so the run
        // continues, but the outcome column makes it filterable on the job page.
        setItemStatus(jobId, n, 'success', null, { outcome: r.status, detail: r.detail });
        emit('item_done', { name: n, status: r.status, detail: r.detail });
        results.push({ person: person.name, staffId: staff.id, community: c.name, communityId: c.id, ...r });
      } catch (err) {
        tally.failed++;
        tabOpen = false; // re-open the tab fresh after any failure
        await page.screenshot({ path: path.join(outDir, `error_${staff.id}_${c.id}.png`), fullPage: true }).catch(() => {});
        setItemStatus(jobId, n, 'failed', err.message);
        emit('item_fail', { name: n, error: err.message });
        results.push({ person: person.name, staffId: staff.id, community: c.name, communityId: c.id, status: 'failed', detail: err.message });
      }
      flush();
    }
  }

  await page.context().close().catch(() => {});
  flush();
  if (cancelled()) { emit('job_error', { error: 'Job cancelled.' }); return; }
  const flagged = results.filter((r) => r.flags?.some((f) => f.startsWith('MISSING')));
  emit('progress', { message: `Results file: ${path.join(outDir, 'results.json')}${flagged.length ? ` · ${flagged.length} pair(s) flagged for a missing email/cell.` : ''}` });
  setJobStatus(jobId, 'done');
  emit('job_done', { jobId, company: companyName, total: names.length, dryRun, ...tally });
}

module.exports = { runAlertSubscriptionsJob, REPORTS_ROOT };
