import { useEffect, useState } from 'react';
import { exportCompanyAlignmentTemplate, parseCompanyAlignmentTemplate } from '../utils/accountHealthExport';

/**
 * Company Alignment — the combined ALIS admin ↔ HubSpot linking model (Aaron,
 * Sep 2026: "combine these templates and update/discovery patterns... the
 * goal here is to ensure alignment of company records between alis admin
 * and hubspot"). One surface for everything this app tracks about that
 * link per company: HubSpot's own name/ID, the name ALIS admin's own
 * directory uses for the same company, whether a human has actually
 * confirmed the two records line up (vs. just an unreviewed auto-match),
 * the confirmed ALIS subdomain(s), and the ALIS Admin Company ID that
 * anchors the company's admin.alisonline.com URL.
 *
 * Three ways in, one shared write path (POST /company-alignment/import,
 * which updates company_hosts / alis_admin_ids / company_alignment
 * independently per field so a template row touching only one of them
 * doesn't blank out the others):
 *  - Discover: scrapes ALIS admin's own company directory and proposes
 *    matches by name (confident matches pre-checked, ambiguous rows need a
 *    human pick) — server/services/alisCompanyDiscovery.js.
 *  - Download/Upload Template: the bulk, type-it-in-yourself alternative
 *    for accounts a name-match scrape can't confidently resolve.
 *  - Check for Alignment Drift: re-scrapes the same directory and flags
 *    any account whose stored subdomain or ALIS-side name no longer
 *    matches what ALIS admin currently reports for its admin ID — catching
 *    a mismatch before it surfaces downstream in a report instead of after.
 */
/**
 * Freeform fallback for an ambiguous row (Sep 2026, Aaron: "what are we
 * matching here???" — the row's own top-3 candidates can all be wrong when
 * the actual correct company got excluded from the whole candidate pool for
 * an unrelated reason, e.g. alisCompanyDiscovery.js's "already mapped
 * elsewhere" exclusion). Plain substring search over every account already
 * loaded on this page — no separate API call — since the portfolio here
 * (dozens to a few hundred) is small enough to filter client-side.
 */
function CustomCompanyPicker({ accounts, onPick }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q.length >= 2
    ? accounts.filter((a) => a.company_name?.toLowerCase().includes(q)).slice(0, 8)
    : [];
  return (
    <div className="inline-flex flex-col gap-0.5">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search company name…"
        className="text-xs border border-neutral-200 rounded px-1 py-0.5 w-48"
      />
      {matches.length > 0 && (
        <div className="border border-neutral-200 rounded bg-white shadow-sm max-h-32 overflow-y-auto w-48">
          {matches.map((a) => (
            <button
              key={a.hubspot_company_id}
              type="button"
              onClick={() => { onPick(a); setQuery(''); }}
              className="block w-full text-left text-xs px-1.5 py-1 hover:bg-neutral-50"
            >
              {a.company_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AlisAdminIdDiscovery({ accounts, companyHosts, onImported }) {
  const [discovering, setDiscovering] = useState(false);
  const [discoverMessage, setDiscoverMessage] = useState(null);
  const [discoverResult, setDiscoverResult] = useState(null);
  const [discoverError, setDiscoverError] = useState(null);
  const [selections, setSelections] = useState({});
  const [customRows, setCustomRows] = useState({});
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [templateImporting, setTemplateImporting] = useState(false);
  const [templateError, setTemplateError] = useState(null);
  const [templateResult, setTemplateResult] = useState(null);
  const [alignment, setAlignment] = useState([]);
  const [checkingDrift, setCheckingDrift] = useState(false);
  const [driftError, setDriftError] = useState(null);
  const [driftResult, setDriftResult] = useState(null);
  // Which of Discover / Check Last Audit Report produced the current
  // discoverResult/selections — so Apply logs the right source (see
  // handleApply below).
  const [discoverSource, setDiscoverSource] = useState('discover');
  const [checkingAudit, setCheckingAudit] = useState(false);
  const [activityLog, setActivityLog] = useState([]);

  async function loadAlignment() {
    try {
      const res = await fetch('/api/account-truth/company-alignment');
      const body = await res.json();
      if (res.ok) setAlignment(body.rows || []);
    } catch {
      // Non-critical — the template still works without pre-filled ALIS
      // names/confirmed flags, just blank until the next successful load.
    }
  }

  async function loadActivityLog() {
    try {
      const res = await fetch('/api/account-truth/company-alignment/activity-log');
      const body = await res.json();
      if (res.ok) setActivityLog(body.rows || []);
    } catch {
      // Non-critical — the log is a nice-to-have audit trail, not load-bearing.
    }
  }

  async function handleDeleteLogEntry(id) {
    setActivityLog((prev) => prev.filter((r) => r.id !== id)); // optimistic
    try {
      await fetch(`/api/account-truth/company-alignment/activity-log/${id}`, { method: 'DELETE' });
    } catch {
      await loadActivityLog(); // put it back if the delete didn't actually happen
    }
  }

  useEffect(() => { loadAlignment(); loadActivityLog(); }, []);

  function applyDiscoveryJob(job) {
    if (job.status === 'running') {
      setDiscovering(true);
      setDiscoverMessage(job.message);
      return;
    }
    setDiscovering(false);
    if (job.status === 'error') {
      setDiscoverError(job.error || 'Discovery failed.');
      return;
    }
    if (job.result) {
      setDiscoverResult(job.result);
      const initial = {};
      job.result.autoMatched.forEach((m, i) => { initial[`auto:${i}`] = m; });
      setSelections(initial);
    }
  }

  // Resumes polling a Discover & Align run already in progress (e.g. this
  // page was reloaded mid-run) — same "check once on mount, don't leave the
  // user staring at a stale idle button" convention as the portfolio jobs.
  useEffect(() => {
    fetch('/api/account-truth/alis-admin-ids/discover/status')
      .then((res) => res.json())
      .then((job) => { if (job.status === 'running') applyDiscoveryJob(job); })
      .catch(() => {});
  }, []);

  // Polls every 2s while a discovery run is in flight (Sep 2026, Aaron: hit
  // a 502 when this was a single blocking POST — the dev proxy's own
  // connection timeout killed the request before a slow CRM ID rescue pass
  // finished, even though the backend was still working). Simple poll
  // rather than the SSE stream the server also exposes — this dialog only
  // needs the latest status line, not a scrolling log.
  useEffect(() => {
    if (!discovering) return undefined;
    const interval = setInterval(() => {
      fetch('/api/account-truth/alis-admin-ids/discover/status')
        .then((res) => res.json())
        .then(applyDiscoveryJob)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [discovering]);

  const alignmentByCompany = new Map(alignment.map((r) => [r.hubspot_company_id, r]));

  async function handleDownloadTemplate() {
    await exportCompanyAlignmentTemplate(accounts, companyHosts, alignmentByCompany);
  }

  async function importRows(rows, source) {
    const res = await fetch('/api/account-truth/company-alignment/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, source }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Import failed (${res.status})`);
    await loadActivityLog();
    return body;
  }

  async function handleUploadTemplate(e) {
    const file = e.target.files[0];
    if (!file) return;
    setTemplateImporting(true);
    setTemplateError(null);
    setTemplateResult(null);
    try {
      const rows = await parseCompanyAlignmentTemplate(file);
      if (rows.length === 0) throw new Error('No rows with anything filled in were found in this file.');
      const body = await importRows(rows, 'template');
      setTemplateResult(`${body.hostsImported} subdomain(s), ${body.adminIdsImported} admin ID(s), ${body.alignmentImported} alignment note(s) imported.`);
      await Promise.all([onImported?.(), loadAlignment()]);
    } catch (err) {
      setTemplateError(err.message);
    } finally {
      setTemplateImporting(false);
      e.target.value = '';
    }
  }

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoverMessage('Starting…');
    setDiscoverError(null);
    setDiscoverResult(null);
    setDiscoverSource('discover');
    setSelections({});
    setCustomRows({});
    setApplyResult(null);
    try {
      const slim = accounts.map((a) => ({ id: a.hubspot_company_id, name: a.company_name, alisAdminCompanyId: a.alis_admin_company_id }));
      const res = await fetch('/api/account-truth/alis-admin-ids/discover/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: slim }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      // Polling picks up from here (see the `discovering` effect above).
    } catch (err) {
      setDiscoverError(err.message);
      setDiscovering(false);
    }
  }

  async function handleCancelDiscover() {
    try {
      await fetch('/api/account-truth/alis-admin-ids/discover/cancel', { method: 'POST' });
    } catch {
      // Non-critical — the next poll will just show whatever state the job settles into.
    }
  }

  // Cross-references currently-unmapped accounts against the most recent
  // CRM ID Audit (bulk) report already on disk (Aaron, Sep 2026: "check
  // against last audit... zero new scraping, instant") — a local file
  // read, so unlike Discover & Align it's just as fast on Team AM's 460
  // accounts as it is here. Feeds the exact same review UI/selections as
  // Discover, just from a different source and with no scraping wait.
  async function handleCheckLastAudit() {
    setCheckingAudit(true);
    setDiscoverError(null);
    setDiscoverResult(null);
    setDiscoverSource('audit-report');
    setSelections({});
    setCustomRows({});
    setApplyResult(null);
    try {
      const slim = accounts.map((a) => ({ id: a.hubspot_company_id, name: a.company_name, alisAdminCompanyId: a.alis_admin_company_id }));
      const res = await fetch('/api/account-truth/alis-admin-ids/check-last-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: slim }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      if (!body.available) throw new Error('No CRM ID Audit (bulk) report has been run yet — nothing to check against.');
      setDiscoverResult(body);
      const initial = {};
      body.autoMatched.forEach((m, i) => { initial[`auto:${i}`] = m; });
      setSelections(initial);
    } catch (err) {
      setDiscoverError(err.message);
    } finally {
      setCheckingAudit(false);
    }
  }

  function toggleAutoMatch(key, match, checked) {
    setSelections((prev) => {
      const next = { ...prev };
      if (checked) next[key] = match; else delete next[key];
      return next;
    });
  }

  function setAmbiguousSelection(key, candidate) {
    setSelections((prev) => {
      const next = { ...prev };
      if (candidate) next[key] = candidate; else delete next[key];
      return next;
    });
  }

  async function handleApply() {
    const rows = Object.values(selections).map((m) => ({
      hubspotCompanyId: m.hubspotCompanyId, companyName: m.companyName,
      alisAdminCompanyId: m.alisAdminCompanyId, companyHost: m.companyHost || undefined,
      alisCompanyName: m.alisCompanyName || undefined,
    }));
    if (rows.length === 0) return;
    setApplying(true);
    setDiscoverError(null);
    try {
      const body = await importRows(rows, discoverSource || 'discover');
      setApplyResult(`Imported ${body.adminIdsImported} admin ID(s), ${body.hostsImported} subdomain(s).`);
      setDiscoverResult(null);
      setSelections({});
      await Promise.all([onImported?.(), loadAlignment()]);
    } catch (err) {
      setDiscoverError(err.message);
    } finally {
      setApplying(false);
    }
  }

  async function handleCheckDrift() {
    setCheckingDrift(true);
    setDriftError(null);
    setDriftResult(null);
    try {
      const res = await fetch('/api/account-truth/company-alignment/check-drift', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setDriftResult(body);
      await loadAlignment();
    } catch (err) {
      setDriftError(err.message);
    } finally {
      setCheckingDrift(false);
    }
  }

  const selectedCount = Object.keys(selections).length;
  const mappedIdCount = accounts.filter((a) => a.alis_admin_company_id).length;
  const mappedHostCount = accounts.filter((a) => a.company_host).length;
  const confirmedCount = alignment.filter((r) => r.crm_id_confirmed).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleDiscover} className="btn btn-sm btn-secondary" disabled={discovering} title="Scrape ALIS admin's own company directory and propose subdomain + ALIS Admin Company ID matches — by CRM ID first (ALIS admin's own field for the HubSpot Record ID), falling back to name similarity only when CRM ID is blank or unreadable">
          {discovering ? '🔍 Scraping ALIS admin…' : '🔍 Discover & Align'}
        </button>
        {discovering && (
          <button onClick={handleCancelDiscover} className="btn btn-sm btn-secondary" title="Stop after the current company finishes">
            ✕ Cancel
          </button>
        )}
        <button onClick={handleDownloadTemplate} className="btn btn-sm btn-secondary" title="Every account's HubSpot name/ID, ALIS-side name, confirmed status, subdomain(s), and ALIS Admin Company ID, for manually filling in what the name-match scrape can't resolve">📋 Download Alignment Template</button>
        <label className="btn btn-sm btn-secondary cursor-pointer" title="Reads back a completed Alignment Template — each row updates its subdomain, admin ID, and/or confirmed status independently, so a partially-filled row is safe to upload.">
          {templateImporting ? 'Importing…' : '📤 Upload Completed Template'}
          <input type="file" accept=".xlsx" onChange={handleUploadTemplate} disabled={templateImporting} className="hidden" />
        </label>
        <button onClick={handleCheckDrift} className="btn btn-sm btn-secondary" disabled={checkingDrift} title="Re-scrapes ALIS admin's directory and flags any account whose stored subdomain or ALIS-side name no longer matches what ALIS admin currently reports for its admin ID">
          {checkingDrift ? '🔎 Checking…' : '🔎 Check for Alignment Drift'}
        </button>
        <button onClick={handleCheckLastAudit} className="btn btn-sm btn-secondary" disabled={checkingAudit || discovering} title="Cross-references still-unmapped accounts against the most recent CRM ID Audit (bulk) report already on disk — zero new scraping, so it's instant on any portfolio size">
          {checkingAudit ? '🗂️ Checking…' : '🗂️ Check Last Audit Report'}
        </button>
        {applyResult && <span className="text-xs text-neutral-500">{applyResult}</span>}
      </div>
      <p className="text-[11px] text-neutral-400">
        {mappedIdCount} of {accounts.length} accounts have a known ALIS Admin Company ID · {confirmedCount} confirmed aligned
      </p>
      <p className="text-[11px] text-neutral-400">
        {mappedHostCount} of {accounts.length} accounts have a known ALIS subdomain
      </p>
      {templateError && <p className="text-xs text-error max-w-md">{templateError}</p>}
      {templateResult && <p className="text-xs text-neutral-500 max-w-md">{templateResult}</p>}
      {discovering && discoverMessage && <p className="text-xs text-neutral-500 max-w-md">{discoverMessage}</p>}
      {driftError && <p className="text-xs text-error max-w-md">{driftError}</p>}
      {driftResult && (
        <div className="border border-neutral-200 rounded-lg p-3 bg-white max-w-2xl">
          <p className="text-xs mb-2">
            Checked {driftResult.checkedCount} account{driftResult.checkedCount === 1 ? '' : 's'} with a known admin ID —{' '}
            {driftResult.driftCount === 0 ? 'no drift found.' : `${driftResult.driftCount} flagged below.`}
          </p>
          {driftResult.results.map((r) => (
            <div key={r.hubspotCompanyId} className="text-xs py-1 border-t border-neutral-100 first:border-t-0">
              <strong>{r.companyName}</strong> (admin id {r.alisAdminCompanyId})
              <ul className="list-disc list-inside text-neutral-500 ml-2">
                {r.issues.map((issue, i) => <li key={i}>{issue.detail}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {discoverError && <p className="text-xs text-error max-w-md">{discoverError}</p>}
      {discoverResult && (
        <div className="border border-neutral-200 rounded-lg p-3 bg-white max-w-2xl">
          <p className="text-xs mb-2">
            {discoverResult.sourceReport ? (
              <>
                Checked against the CRM ID Audit (bulk) report from {new Date(discoverResult.sourceReport.generatedAt).toLocaleDateString()} —{' '}
                {discoverResult.autoMatched.length} match{discoverResult.autoMatched.length === 1 ? '' : 'es'} found for still-unmapped accounts.
              </>
            ) : (
              <>
                {discoverResult.directoryCount} companies found in ALIS admin —{' '}
                {discoverResult.autoMatched.length} confident match{discoverResult.autoMatched.length === 1 ? '' : 'es'}
                {discoverResult.crmIdMatchCount > 0 && <> ({discoverResult.crmIdMatchCount} by CRM ID)</>},{' '}
                {discoverResult.ambiguous.length} need review,{' '}
                {discoverResult.noCandidate.length} no name match found
                {discoverResult.alreadyMapped?.length > 0 && <>, {discoverResult.alreadyMapped.length} already mapped</>}
                {discoverResult.noAlisId.length > 0 && <>, {discoverResult.noAlisId.length} row(s) had no id in the link</>}
                {discoverResult.crmIdReadFailures > 0 && <>, {discoverResult.crmIdReadFailures} CRM ID read failure{discoverResult.crmIdReadFailures === 1 ? '' : 's'} (fell back to name matching)</>}.
              </>
            )}
          </p>
          {discoverResult.autoMatched.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-1">Confident matches (checked = will import subdomain + admin ID)</p>
              <div className="max-h-40 overflow-y-auto mb-2">
                {discoverResult.autoMatched.map((m, i) => {
                  const key = `auto:${i}`;
                  return (
                    <label key={key} className="flex items-center gap-2 text-xs py-0.5">
                      <input type="checkbox" checked={Boolean(selections[key])} onChange={(e) => toggleAutoMatch(key, m, e.target.checked)} />
                      <span><strong>{m.alisCompanyName}</strong> (id {m.alisAdminCompanyId}{m.companyHost ? `, ${m.companyHost}` : ''}) → {m.companyName}</span>
                      {m.matchMethod === 'crmId' ? (
                        <span className="text-accent-600 font-medium">CRM ID match</span>
                      ) : (
                        <span className="text-neutral-400">name match {Math.round(m.score * 100)}%</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {discoverResult.ambiguous.length > 0 && (
            <>
              <p className="text-xs font-semibold mb-1">Needs review — pick the right company, or leave as Skip</p>
              <div className="max-h-40 overflow-y-auto mb-2">
                {discoverResult.ambiguous.map((row, i) => {
                  const key = `amb:${i}`;
                  const chosen = selections[key];
                  const isCustom = customRows[key];
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs py-0.5 flex-wrap">
                      <span><strong>{row.alisCompanyName}</strong> (id {row.alisAdminCompanyId}{row.companyHost ? `, ${row.companyHost}` : ''})</span>
                      <span>→</span>
                      {isCustom ? (
                        <>
                          {chosen ? (
                            <span className="font-medium">{chosen.companyName}</span>
                          ) : (
                            <CustomCompanyPicker
                              accounts={accounts}
                              onPick={(a) => setAmbiguousSelection(key, {
                                hubspotCompanyId: a.hubspot_company_id, companyName: a.company_name,
                                alisAdminCompanyId: row.alisAdminCompanyId, companyHost: row.companyHost, alisCompanyName: row.alisCompanyName,
                              })}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => { setCustomRows((prev) => ({ ...prev, [key]: false })); setAmbiguousSelection(key, null); }}
                            className="text-neutral-400 hover:text-neutral-600 underline"
                          >
                            back to suggestions
                          </button>
                        </>
                      ) : (
                        <select
                          value={chosen ? chosen.hubspotCompanyId : ''}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setCustomRows((prev) => ({ ...prev, [key]: true }));
                              setAmbiguousSelection(key, null);
                              return;
                            }
                            const candidate = row.candidates.find((c) => c.hubspotCompanyId === e.target.value);
                            setAmbiguousSelection(key, candidate
                              ? { hubspotCompanyId: candidate.hubspotCompanyId, companyName: candidate.companyName, alisAdminCompanyId: row.alisAdminCompanyId, companyHost: row.companyHost, alisCompanyName: row.alisCompanyName }
                              : null);
                          }}
                          className="text-xs border border-neutral-200 rounded px-1 py-0.5"
                        >
                          <option value="">Skip</option>
                          {row.candidates.map((c) => (
                            <option key={c.hubspotCompanyId} value={c.hubspotCompanyId}>{c.companyName} ({Math.round(c.score * 100)}%)</option>
                          ))}
                          {/* Escape hatch for exactly this bug (Sep 2026, Aaron: "what
                              are we matching here???") — the top-3 suggested candidates
                              can all be wrong (e.g. the actual right company got excluded
                              from the whole candidate pool for an unrelated reason), so
                              this lets a human search the full portfolio instead of being
                              limited to what the fuzzy matcher surfaced. */}
                          <option value="__custom__">Other company… (search)</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <button onClick={handleApply} className="btn btn-sm btn-accent" disabled={applying || selectedCount === 0}>
            {applying ? 'Importing…' : `Import Selected (${selectedCount})`}
          </button>
        </div>
      )}

      {/* Audit log (Sep 2026, Aaron: "an audit log in the negative space of
          the utility side panel to keep track of actioned updates and
          imports... a mini jobs board with the option to delete the
          records if they are cluttering things up") — every import through
          any of the three flows above (Discover & Align, the template, the
          new Check Last Audit Report) lands one row here, newest first,
          independent of any one flow's own in-memory state. */}
      <div className="mt-2 pt-3 border-t border-neutral-100">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">Activity Log</p>
        {activityLog.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No imports yet.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {activityLog.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 text-xs py-1 border-b border-neutral-50 last:border-b-0">
                <div className="min-w-0">
                  <span className="text-neutral-400 mr-1.5">{new Date(r.created_at).toLocaleString()}</span>
                  <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-100 text-neutral-500 mr-1.5 align-middle">{r.source}</span>
                  <span className="text-neutral-700">{r.summary}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteLogEntry(r.id)}
                  title="Remove this log entry"
                  className="text-neutral-300 hover:text-neutral-500 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
