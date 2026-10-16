import { useState, useMemo } from 'react';

/**
 * Organic Add -> Jira ODM form helper. Paste the JSON from the "/organic-add"
 * skill, validate it, review every field as it should be entered on the form,
 * then open the form and copy values across. The hub never submits the form
 * (or calls Jira) — a person always clicks Submit on the real form.
 */

const TBD_RE = /\bTBD\b/i;

function audit(crmId, event, detail) {
  fetch('/api/organic-add/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ crmId, event, detail }),
  }).catch(() => {});
}

function copyText(text) {
  return navigator.clipboard.writeText(text ?? '');
}

function CopyButton({ text, label, crmId }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary text-xs px-2 py-1"
      onClick={async () => {
        try {
          await copyText(text);
          setDone(true);
          audit(crmId, 'copied_field', label);
          setTimeout(() => setDone(false), 1500);
        } catch { /* clipboard blocked — user can select the text manually */ }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function OrganicAdd() {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState(null); // payload object, with picks merged in
  const [result, setResult] = useState(null); // { ok, errors, review }
  const [ack, setAck] = useState({}); // unresolved index -> bool
  const [dupChecked, setDupChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dateError, setDateError] = useState('');
  const [urlError, setUrlError] = useState('');

  async function validate(payloadOrText) {
    setBusy(true);
    try {
      const res = await fetch('/api/organic-add/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: payloadOrText }),
      });
      const data = await res.json();
      if (data.error) setResult({ ok: false, errors: [data.error], review: null });
      else setResult(data);
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function onValidate() {
    setAck({});
    setDupChecked(false);
    let obj = null;
    try { obj = JSON.parse(raw); } catch { /* server reports the parse error */ }
    setParsed(obj);
    await validate(obj ?? raw);
  }

  // A human picked an option for a null dropdown — merge into the payload and
  // re-run server validation so the review reflects what would be entered.
  async function pick(key, values) {
    const next = { ...parsed, fields: { ...parsed.fields, [key]: { ...parsed.fields[key], value: values.length ? values : null } } };
    setParsed(next);
    await validate(next);
  }

  // Human-supplied Requested Completion Date (the payload's was null). Must
  // not be later than the go-live date; checked here so a bad pick doesn't
  // blank the review the way a server-side rejection would.
  async function pickDate(value, maxDate) {
    if (value && maxDate && value > maxDate) {
      setDateError(`Must be on or before the go-live date (${maxDate})`);
      return;
    }
    setDateError('');
    const next = { ...parsed, fields: { ...parsed.fields, requested_completion_date: value || null } };
    setParsed(next);
    await validate(next);
  }

  // Human-supplied ALIS company URL (payload's was missing/[ID NEEDED]).
  // Format-checked here, same rule as the server, so a half-typed value
  // doesn't blank the review.
  async function pickUrl(value) {
    if (!value) { setUrlError(''); return; }
    if (!/^(https:\/\/)?(?!(admin|api|www)\.)[a-z0-9][a-z0-9-]*\.alisonline\.com\/?$/i.test(value)) {
      setUrlError('Expected the client ALIS domain, e.g. viva.alisonline.com');
      return;
    }
    setUrlError('');
    const next = { ...parsed, companyUrl: value };
    setParsed(next);
    await validate(next);
  }

  const review = result?.ok ? result.review : null;
  const crmId = review?.community?.crm_id;

  const pendingPicks = review ? Object.values(review.dropdowns).filter((d) => d.needsPick).length : 0;
  const pendingUnresolved = review ? review.unresolved.filter((_, i) => !ack[i]).length : 0;
  const pendingDate = review ? review.formFields.some((f) => f.needsDate || f.needsUrl) : false;
  const canOpen = review && pendingPicks === 0 && !pendingDate && pendingUnresolved === 0 && dupChecked;

  const dupUrl = useMemo(() => {
    if (!review) return '#';
    const jql = `project = ODM AND statusCategory != Done AND (summary ~ "${review.community.name.replace(/"/g, '')}" OR text ~ "${review.community.crm_id}")`;
    return `https://medtelligent.atlassian.net/issues/?jql=${encodeURIComponent(jql)}`;
  }, [review]);

  function renderValue(f) {
    if (f.needsDate) {
      return (
        <span>
          <input type="date" className="border border-neutral-300 rounded px-2 py-1" max={f.maxDate} onChange={(e) => pickDate(e.target.value, f.maxDate)} />
          <em className="text-red-600 ml-2">Choose a date (on or before {f.maxDate})</em>
          {dateError && <div className="text-red-600 text-xs mt-1">{dateError}</div>}
        </span>
      );
    }
    if (f.needsUrl) {
      return (
        <span>
          <input
            type="text"
            className="border border-neutral-300 rounded px-2 py-1 w-full"
            placeholder="client.alisonline.com"
            onChange={(e) => pickUrl(e.target.value.trim())}
          />
          <em className="text-red-600 text-xs">Required — enter the client&apos;s ALIS domain</em>
          {urlError && <div className="text-red-600 text-xs mt-1">{urlError}</div>}
        </span>
      );
    }
    if (f.dropdownKey) {
      const d = review.dropdowns[f.dropdownKey];
      return d.needsPick ? <em className="text-red-600">Not chosen yet</em> : d.value.join(', ');
    }
    return f.value;
  }

  function copyValue(f) {
    if (f.dropdownKey) return (review.dropdowns[f.dropdownKey].value || []).join(', ');
    return f.value;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Organic Add &rarr; Jira ODM</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Paste the JSON from <code>/organic-add</code>, review it, then copy the values onto the ODM form.
          Nothing is sent to Jira from here — you submit the form yourself.
        </p>
      </div>

      <div className="space-y-2">
        <textarea
          className="w-full h-40 border border-neutral-300 rounded p-2 font-mono text-xs"
          placeholder='{"schema_version": 1, ...}'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <button type="button" className="btn-primary" disabled={busy || !raw.trim()} onClick={onValidate}>
          Validate
        </button>
      </div>

      {result && !result.ok && (
        <div className="border border-red-300 bg-red-50 rounded p-3 text-sm text-red-800">
          <div className="font-semibold mb-1">Payload rejected</div>
          <ul className="list-disc ml-5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {review && (
        <>
          {review.flags.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Flags (won&apos;t block)</div>
              <ul className="list-disc ml-5">{review.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}

          {review.unresolved.length > 0 && (
            <div className="border border-red-300 bg-red-50 rounded p-3 text-sm">
              <div className="font-semibold text-red-800 mb-1">Unresolved — acknowledge each to continue</div>
              {review.unresolved.map((u, i) => (
                <label key={i} className="flex items-start gap-2 py-0.5">
                  <input type="checkbox" checked={!!ack[i]} onChange={(e) => setAck({ ...ack, [i]: e.target.checked })} />
                  <span>{u}</span>
                </label>
              ))}
            </div>
          )}

          {Object.entries(review.dropdowns).filter(([, d]) => d.needsPick).map(([key, d]) => (
            <div key={key} className="border border-red-300 bg-red-50 rounded p-3 text-sm">
              <div className="font-semibold text-red-800 mb-1">Choose a value: {key.replace(/_/g, ' ')}</div>
              <div className="text-neutral-700 mb-2">Intent: {d.intent}</div>
              <div className="flex flex-wrap gap-3">
                {d.options.map((o) => (
                  <label key={o} className="flex items-center gap-1">
                    <input
                      type={d.multiSelect === false ? 'radio' : 'checkbox'}
                      name={key}
                      onChange={(e) => pick(key, d.multiSelect === false ? [o] : (e.target.checked ? [o] : []))}
                    />
                    {o}
                  </label>
                ))}
              </div>
              {d.multiSelect !== false && <div className="text-xs text-neutral-500 mt-1">This dropdown may allow multiple picks on the form.</div>}
            </div>
          ))}

          <div className="border border-neutral-200 rounded divide-y bg-white">
            {review.formFields.map((f) => {
              const text = copyValue(f);
              const tbd = typeof text === 'string' && TBD_RE.test(text);
              return (
                <div key={f.label} className="p-3 flex gap-3 items-start">
                  <div className="w-56 shrink-0 text-xs font-semibold text-neutral-600">{f.label}</div>
                  <div className={`flex-1 text-sm whitespace-pre-wrap break-words ${tbd ? 'bg-yellow-100 px-1 rounded' : ''}`}>
                    {renderValue(f)}
                    {f.kind === 'markdown' && <div className="text-xs text-neutral-400 mt-1">markdown — paste into the editor</div>}
                  </div>
                  {f.kind !== 'note' && text ? <CopyButton text={text} label={f.label} crmId={crmId} /> : null}
                </div>
              );
            })}
          </div>

          <div className="border border-neutral-200 rounded p-3 text-sm space-y-2 bg-white">
            <div>
              Check ODM for an open request for <strong>{review.community.name}</strong> (HubSpot ID {review.community.crm_id}) first:{' '}
              <a className="text-primary-600 underline" href={dupUrl} target="_blank" rel="noreferrer">search ODM</a>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={dupChecked} onChange={(e) => setDupChecked(e.target.checked)} />
              I checked ODM and there&apos;s no existing open request (or I&apos;m continuing anyway).
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!canOpen}
              title={canOpen ? '' : 'Resolve picks and the completion date, acknowledge unresolved items, and confirm the duplicate check'}
              onClick={() => { audit(crmId, 'opened_form'); window.open(review.formUrl, '_blank', 'noopener'); }}
            >
              Open the ODM form
            </button>
            <div className="text-xs text-neutral-500">Leave Assignee as Unassigned — the PM team assigns.</div>
          </div>
        </>
      )}
    </div>
  );
}
