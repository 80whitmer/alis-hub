/**
 * Oregon ABST per-resident crosswalk report (OAR 411-054-0037(3)).
 *
 * For every current resident of a community, shows all 22 ODHS care elements:
 * the answer on the resident's latest COMPLETED RET (evaluation), the published
 * ABST care plan items tied to that element, minutes, and a status. Read-only —
 * nothing is written to ALIS. Supplements the Oregon ABST report in ALIS HQ.
 *
 * Inputs (all pulled live from the ALIS export API unless noted):
 *   - residents, care plan items, evaluations, evaluation XML (answers), RET config
 *   - Care Settings catalog (category / identifier / reporting label) — NOT in the
 *     export API, so it comes from config/abstCrosswalk/care-items/<communityId>.json
 *     or from the job payload (an import of ALIS's "Care Categories and Items" export)
 *   - element map + answer-type table: config/abstCrosswalk/*.json (editable, no code)
 *
 * Hard rules (from the report brief):
 *   - Independent / Nurse / Outside / N/A status only ever comes from a real
 *     evaluation answer, never from a missing care plan item.
 *   - Minutes are only what ALIS returns; nothing is defaulted or invented.
 *   - Care items are identified by name + category + label from the catalog (names
 *     are duplicated across categories), and only ABST-labeled items are counted.
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const api = require('./alisApiClient');

const CONFIG_DIR = path.join(__dirname, '..', 'config', 'abstCrosswalk');
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const STATUS = {
  STAFF_TIME: 'staff_time',
  INDEPENDENT: 'independent',
  NURSE: 'nurse',
  OUTSIDE: 'outside',
  NOT_APPLICABLE: 'not_applicable',
  GAP: 'assessed_no_minutes',
  NOT_ASSESSED: 'not_assessed',
};

const STATUS_LABEL = {
  [STATUS.STAFF_TIME]: 'Staff time',
  [STATUS.INDEPENDENT]: 'Independent, 0 minutes',
  [STATUS.NURSE]: 'Nurse task, 0 caregiver minutes',
  [STATUS.OUTSIDE]: 'Outside provider, 0 minutes',
  [STATUS.NOT_APPLICABLE]: 'Does not apply, 0 minutes',
  [STATUS.GAP]: 'Assistance assessed, minutes not yet configured',
  [STATUS.NOT_ASSESSED]: 'Not assessed',
};

const asArray = (n) => (n == null ? [] : Array.isArray(n) ? n : [n]);
const text = (x) => (typeof x === 'string' ? x : (x?.['#text'] ?? ''));

/** lowercase, strip leading question numbering ("9.", "11a.", "11a-11g."), collapse whitespace/trailing periods. */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?(-\d+[a-z]?)?\.\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
}

// ── Config loading ───────────────────────────────────────────────────────────

function loadElementConfig(file = 'oregon-elements.json') {
  return readJson(file);
}

function loadAnswerTypes(file = 'oregon-answer-types.json') {
  const map = new Map();
  for (const e of readJson(file).entries) {
    map.set(`${e.domain}|${e.question}|${e.answer}`, e);
  }
  return map;
}

/** careItems rows: { category, name, identifier, label, minutes } — blank category carries down from the row above (as in the ALIS export). */
function normalizeCatalogRows(rows) {
  let category = null;
  const out = [];
  for (const r of rows) {
    const cat = r.category ?? r.careCategory;
    if (cat && String(cat).trim()) category = String(cat).trim();
    const name = String(r.name ?? r.careItem ?? '').trim();
    if (!name) continue;
    const mins = r.minutes ?? r.estimatedTime;
    out.push({
      category,
      name,
      identifier: String(r.identifier ?? r.assessmentCareIdentifier ?? '').trim(),
      label: String(r.label ?? r.reportingLabel ?? '').trim() || null,
      minutes: mins === '' || mins == null ? null : Number(mins),
    });
  }
  return out;
}

function loadCareCatalog(communityId, payloadRows) {
  if (Array.isArray(payloadRows) && payloadRows.length) return normalizeCatalogRows(payloadRows);
  const file = path.join(CONFIG_DIR, 'care-items', `${communityId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No Care Settings catalog for community ${communityId}. Export "Care Categories and Items" from ALIS Care Settings ` +
      `and import it into the job's Care Items field (or save it as server/config/abstCrosswalk/care-items/${communityId}.json). ` +
      'The ALIS export API does not expose Care Settings, so the ABST labels cannot be read any other way.'
    );
  }
  return normalizeCatalogRows(JSON.parse(fs.readFileSync(file, 'utf8')).items);
}

/** name → { entries, abst (the ABST-labeled entry or null), duplicate } */
function indexCatalog(catalog) {
  const byName = new Map();
  for (const c of catalog) {
    const k = norm(c.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
  const resolve = (name) => {
    const entries = byName.get(norm(name));
    if (!entries) return null;
    const abst = entries.find((e) => (e.label || '').toUpperCase() === 'ABST') || null;
    return { entries, abst, duplicate: entries.length > 1 };
  };
  return { resolve };
}

// ── RET config / answers ─────────────────────────────────────────────────────

/** { [questionId]: { domain, text, norm, answers: { [answerId]: text } } } — Question/Answer ids are stable across RET versions. */
function parseRetConfig(configXml) {
  const questions = {};
  const doc = xml.parse(configXml);
  for (const d of asArray(doc?.Instrument?.Domains?.Domain)) {
    const qs = [
      ...asArray(d.Questions?.Enabled?.Question),
      ...asArray(d.Questions?.Disabled?.Question),
      ...asArray(d.Questions?.Question),
    ];
    for (const q of qs) {
      const id = q['@_Id'];
      if (!id) continue;
      questions[id] = {
        domain: d['@_Name'],
        text: text(q.Text),
        norm: norm(text(q.Text)),
        answers: Object.fromEntries(asArray(q.Answers?.Answer).map((a) => [a['@_Id'], text(a.Text)])),
      };
    }
  }
  return questions;
}

/** retXml → { [questionId]: { answerIds: [], notes } }  (multi-select questions carry several <Answer>) */
function parseResidentAnswers(retXml) {
  const out = {};
  if (!retXml) return out;
  let doc;
  try { doc = xml.parse(retXml); } catch { return out; }
  for (const dm of asArray(doc?.Evaluation?.Domain)) {
    for (const q of asArray(dm.Question)) {
      const id = q['@_Id'];
      if (!id) continue;
      out[id] = {
        answerIds: asArray(q.Answer).map((a) => a['@_Id']).filter(Boolean),
        notes: text(q.Notes) || null,
      };
    }
  }
  return out;
}

/** Wording-based fallback for any answer not in the answer-type table. Always flagged in the output. */
function fallbackType(answerText) {
  const a = answerText.toLowerCase();
  if (/outside provider|third party|outside agency/.test(a)) return 'outside';
  if (/\bnurse\b/.test(a)) return 'nurse';
  if (/^(n\/a|no|none)\b|does not have|does not require|does not use|takes no medications/.test(a)) return 'notApplicable';
  if (/requires|assist|cue|cueing|remind|setup|standby|escort|prompt|prn|uap|unable/.test(a)) return 'staff';
  if (/independent/.test(a)) return 'independent';
  return null;
}

const TYPE_RANK = { staff: 5, nurse: 4, outside: 3, independent: 2, notApplicable: 1 };
const TYPE_TO_STATUS = {
  nurse: STATUS.NURSE,
  outside: STATUS.OUTSIDE,
  independent: STATUS.INDEPENDENT,
  notApplicable: STATUS.NOT_APPLICABLE,
};

// ── Care plan scheduling / minutes ───────────────────────────────────────────

const DAY_ABBR = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

function dayList(v) {
  if (v == null) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
}

/**
 * Weekly minutes = care item minutes (treated as the minutes for the DAY) × scheduled days per week.
 * A "times per day" quantity (x2, x3 …) is NOT multiplied in: daily -> 7 days, weekdays -> number of days,
 * every-N-days -> 7/N. (HQ multiplies the quantity in too, which overstates minutes — decision with Aaron, Nov 2026.)
 * PRN is NOT multiplied (shown per occurrence).
 * days_of_month (the API doesn't return which days) is shown per occurrence only.
 */
function scheduleInfo(p) {
  const perDay = Math.max(Number(p.intervalsHours) || 1, 1);
  const f = p.schedulingFrequency;
  if (f === 'prn') return { label: 'PRN', prn: true, perWeek: null };
  if (f === 'daily') return { label: perDay > 1 ? `Daily (x${perDay}, minutes are per day)` : 'Daily', perWeek: 7 };
  if (f === 'weekdays') {
    const days = dayList(p.daysOfWeek);
    return { label: days.map((d) => DAY_ABBR[d.toLowerCase()] || d).join(', ') + (perDay > 1 ? ` (x${perDay}, minutes are per day)` : ''), perWeek: days.length };
  }
  if (f === 'ndays' && p.nDaysInterval > 0) {
    return { label: `Every ${p.nDaysInterval} days`, perWeek: 7 / p.nDaysInterval, averaged: true };
  }
  if (f === 'days_of_month') return { label: 'Monthly (specific days)', perWeek: null, periodic: true };
  return { label: f || 'Unknown schedule', perWeek: null, unknown: true };
}

const round1 = (n) => Math.round(n * 10) / 10;

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * @param {string} host        ALIS company host (e.g. "leisurecare")
 * @param {object} opts        { communityId, retName?, careItems?, elementConfigFile?, answerTypesFile?, footnote?, onProgress? }
 */
async function buildAbstCrosswalk(host, opts = {}) {
  const { communityId, careItems, footnote = '', onProgress = () => {} } = opts;
  if (!communityId) throw new Error('communityId is required.');
  const cid = Number(communityId);

  const elementCfg = loadElementConfig(opts.elementConfigFile);
  const retName = opts.retName || elementCfg.retName;
  const answerTypes = loadAnswerTypes(opts.answerTypesFile);
  const catalog = indexCatalog(loadCareCatalog(cid, careItems));

  onProgress('Pulling residents, care plan items, evaluations, and answers from ALIS…');
  const [residentsAll, planAll, evalsAll, xmlAll, cfgAll] = await Promise.all([
    api.getResidents(host),
    api.alisApiGet(host, '/v1/export/care/planItems', { residentStatus: 'CurrentResident' }),
    api.getEvaluations(host),
    // No status filter on purpose: status=CurrentResident omitted the newest evaluations (confirmed live Nov 2026).
    api.getEvaluationXmlDocuments(host),
    api.getEvaluationConfigurations(host),
  ]);

  const residents = residentsAll.filter((r) => Number(r.communityId) === cid);
  const plan = planAll.filter((r) => Number(r.communityId) === cid);
  const evals = evalsAll.filter((r) => Number(r.communityId) === cid);
  const xmlDocs = xmlAll.filter((r) => Number(r.communityId) === cid);
  if (!residents.length) throw new Error(`No current residents found for community ${cid} on host "${host}".`);

  // RET question catalog: newest live version of the named RET. Ids are stable across versions, so older
  // evaluations decode against it; answers whose ids aren't in it are reported as undecodable, never guessed.
  const cfgRows = cfgAll
    .filter((c) => norm(c.evaluationConfigurationName) === norm(retName))
    .sort((a, b) => Number(b.evaluationConfigurationVersion) - Number(a.evaluationConfigurationVersion));
  if (!cfgRows.length) throw new Error(`RET "${retName}" was not found in the ALIS evaluation configurations for this company.`);
  const ret = parseRetConfig(cfgRows[0].evaluationConfigurationXml);
  const retVersion = cfgRows[0].evaluationConfigurationVersion;

  // Resolve each element's question matchers to RET question ids once.
  for (const el of elementCfg.elements) {
    el._questions = el.questions.map((m) => {
      const t = norm(m.text);
      const ids = Object.entries(ret)
        .filter(([, q]) => q.domain === m.domain && (m.match === 'startsWith' ? q.norm.startsWith(t) : q.norm === t))
        .map(([id]) => id);
      return { ...m, ids };
    });
  }

  const xmlByRetId = new Map(xmlDocs.map((d) => [String(d.retId), d]));
  const planByResident = new Map();
  for (const p of plan) {
    if (!planByResident.has(p.residentId)) planByResident.set(p.residentId, []);
    planByResident.get(p.residentId).push(p);
  }

  const outResidents = [];
  const unresolvedQuestionMatchers = new Set();

  for (const res of residents) {
    // latest COMPLETED evaluation
    const completed = evals
      .filter((e) => e.residentId === res.residentId && e.isCompleted)
      .sort((a, b) => String(b.evaluationDate).localeCompare(String(a.evaluationDate)) || b.residentEvaluationID - a.residentEvaluationID);
    const latest = completed[0] || null;
    const doc = latest ? xmlByRetId.get(String(latest.residentEvaluationID)) : null;
    const answers = doc ? parseResidentAnswers(doc.retXml) : {};
    let undecodable = 0;
    for (const [qid, a] of Object.entries(answers)) {
      if (!ret[qid] || a.answerIds.some((id) => ret[qid].answers[id] === undefined)) undecodable++;
    }

    // latest published care plan
    const rows = planByResident.get(res.residentId) || [];
    const latestPublish = rows.reduce((m, r) => (String(r.publishDate) > m ? String(r.publishDate) : m), '');
    const planRows = rows.filter((r) => String(r.publishDate) === latestPublish);

    // classify plan rows against the catalog
    const planItems = planRows.map((p) => {
      const hit = catalog.resolve(p.careItemName);
      const sch = scheduleInfo(p);
      const minutes = p.estimatedTime == null ? null : Number(p.estimatedTime);
      const weekly = !sch.prn && sch.perWeek != null && minutes != null ? round1(minutes * sch.perWeek) : null;
      // The plan export carries only the item NAME. When a name exists in two categories (ABST copy with minutes,
      // older copy at 0) and the plan row has 0 minutes, it is the older non-ABST copy — HQ leaves these out too
      // (reconciled against the HQ roster, Nov 2026). With minutes > 0 it can only be the ABST copy.
      const ambiguousZero = !!hit?.abst && hit.duplicate && !(minutes > 0);
      return {
        carePlanItemId: p.carePlanItemId,
        name: p.careItemName,
        inCatalog: !!hit,
        isAbst: !!hit?.abst && !ambiguousZero,
        ambiguousZero,
        category: hit?.abst?.category ?? hit?.entries[0]?.category ?? null,
        label: hit?.abst?.label ?? hit?.entries[0]?.label ?? null,
        identifier: hit?.abst?.identifier ?? hit?.entries[0]?.identifier ?? null,
        duplicateName: !!hit?.duplicate,
        schedule: sch.label,
        prn: !!sch.prn,
        periodic: !!sch.periodic,
        minutesPerOccurrence: minutes,
        weeklyMinutes: weekly,
        assigned: false,
      };
    });

    const elements = elementCfg.elements.map((el) => {
      // answers per question
      const questions = el._questions.map((m) => {
        if (!m.ids.length) unresolvedQuestionMatchers.add(`${el.id}: ${m.domain} / ${m.text}`);
        const lines = [];
        for (const qid of m.ids) {
          const given = answers[qid];
          if (!given || !given.answerIds.length) continue;
          const q = ret[qid];
          for (const aid of given.answerIds) {
            const aText = q.answers[aid];
            if (aText === undefined) continue;
            const row = answerTypes.get(`${q.domain}|${q.norm}|${norm(aText)}`);
            const type = row?.type ?? fallbackType(aText);
            lines.push({
              question: q.text,
              answer: aText,
              type,
              informational: !!row?.informational,
              expectedCareItem: row?.careItem || null,
              rowName: row?.careItem || row?.careIdentifier || row?.need || null,
              fromTable: !!row || ['n/a', 'none'].includes(norm(aText)),
              notes: given.notes || undefined,
            });
          }
        }
        return { domain: m.domain, text: m.text, answered: lines.length > 0, answers: lines };
      });
      const allAnswers = questions.flatMap((q) => q.answers);

      // care plan items belonging to this element (ABST-labeled + name prefix)
      const prefixes = el.subTypes ? el.subTypes.flatMap((s) => s.prefixes) : el.careItemPrefixes || [];
      const mine = planItems.filter((it) => it.isAbst && prefixes.some((pf) => norm(it.name).startsWith(norm(pf))));
      mine.forEach((it) => { it.assigned = true; });

      // items only triggered by nurse / outside answers are not caregiver time
      const staffItems = new Set(allAnswers.filter((a) => a.type === 'staff' && a.expectedCareItem).map((a) => norm(a.expectedCareItem)));
      const nonCaregiver = new Set(
        allAnswers
          .filter((a) => (a.type === 'nurse' || a.type === 'outside') && a.expectedCareItem)
          .map((a) => norm(a.expectedCareItem))
          .filter((n) => !staffItems.has(n))
      );
      const items = mine.map((it) => {
        const nurseLabel = (it.label || '') === 'Nurse Tasks';
        const excluded = nonCaregiver.has(norm(it.name)) || nurseLabel;
        return { ...it, countsAsCaregiver: !excluded, excludedReason: excluded ? 'Tied to a nurse / outside-provider answer, not caregiver time' : undefined };
      });

      const withMinutes = items.filter((it) => it.countsAsCaregiver && it.minutesPerOccurrence > 0);
      const topType = allAnswers.filter((a) => a.type).sort((a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type])[0]?.type || null;
      const notes = [];
      let status;
      if (withMinutes.length) {
        status = STATUS.STAFF_TIME;
        if (topType && topType !== 'staff') notes.push(`Care plan carries minutes, but the assessment answer is "${STATUS_LABEL[TYPE_TO_STATUS[topType]]}". Check the assessment or the care plan.`);
      } else if (!allAnswers.length) {
        status = STATUS.NOT_ASSESSED;
        notes.push(!latest ? 'No completed evaluation on file.' : !doc ? 'Latest completed evaluation has no answer data in ALIS export.' : 'No answer recorded for this element on the latest completed evaluation.');
      } else if (topType === 'staff') {
        status = STATUS.GAP;
        notes.push(items.length ? 'Care plan item exists at 0 minutes.' : 'No ABST care plan item on the published care plan.');
      } else if (topType) {
        status = TYPE_TO_STATUS[topType];
      } else {
        status = STATUS.NOT_ASSESSED;
        notes.push('Answer could not be classified.');
      }
      if (allAnswers.some((a) => !a.fromTable)) notes.push('Answer type inferred from wording (not in the answer-type table).');

      const weeklyMinutes = round1(items.filter((it) => it.countsAsCaregiver && !it.prn && it.weeklyMinutes != null).reduce((s, it) => s + it.weeklyMinutes, 0));

      // Roster-style rows (the layout of the HQ "Resident Roster with Care Plan Items"): the element's care plan
      // items, plus one 0-minute row per assessment answer that resolves to Independent / Outside provider / Nurse /
      // Does not apply. Those rows come from the resident's real answer (never inferred from a missing item) and
      // are marked source 'assessment'. Staff answers with no matching care item show as "not yet configured".
      const careRows = items.map((it) => ({
        source: 'care_plan',
        name: it.name,
        label: it.label,
        schedule: it.schedule,
        prn: it.prn,
        minutesPerOccurrence: it.minutesPerOccurrence,
        weeklyMinutes: it.prn || !it.countsAsCaregiver ? null : it.weeklyMinutes,
        countsAsCaregiver: it.countsAsCaregiver,
        periodic: it.periodic,
      }));
      const haveNames = new Set(items.map((it) => norm(it.name)));
      for (const a of allAnswers) {
        if (!a.type || a.informational) continue;
        const TYPE_WORD = { independent: 'Independent', outside: 'Outside provider', nurse: 'Nurse', notApplicable: 'Does not apply', staff: 'Staff assistance' };
        const rowName = a.rowName || `${a.question} - ${TYPE_WORD[a.type]}`;
        if (haveNames.has(norm(rowName))) continue;
        haveNames.add(norm(rowName));
        careRows.push({
          source: 'assessment',
          name: rowName,
          label: null,
          schedule: '—',
          prn: false,
          minutesPerOccurrence: a.type === 'staff' ? null : 0,
          weeklyMinutes: a.type === 'staff' ? null : 0,
          countsAsCaregiver: false,
          answerType: a.type,
        });
      }
      if (!careRows.length) careRows.push({ source: 'none', name: 'No assessment answer on file', schedule: '—', prn: false, minutesPerOccurrence: null, weeklyMinutes: null, countsAsCaregiver: false });

      const out = {
        careRows,
        id: el.id,
        name: el.name,
        status,
        statusLabel: STATUS_LABEL[status],
        questions,
        careItems: items,
        weeklyMinutes,
        notes,
      };
      if (el.subTypes) {
        out.subTypes = el.subTypes.map((s, i) => {
          const qi = { answers: (s.questionIndexes || [i]).flatMap((k) => questions[k]?.answers || []) };
          const subItems = items.filter((it) => s.prefixes.some((pf) => norm(it.name).startsWith(norm(pf))));
          const typed = (qi?.answers || []).filter((a) => a.type).sort((a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type]);
          const sub = subItems.some((it) => it.countsAsCaregiver && it.minutesPerOccurrence > 0)
            ? STATUS.STAFF_TIME
            : !typed.length ? STATUS.NOT_ASSESSED
              : typed[0].type === 'staff' ? STATUS.GAP : TYPE_TO_STATUS[typed[0].type];
          return { name: s.name, status: sub, statusLabel: STATUS_LABEL[sub], answers: (qi?.answers || []).map((a) => a.answer), careItems: subItems };
        });
      }
      return out;
    });

    const unassigned = planItems.filter((it) => it.isAbst && !it.assigned);
    const notInCatalog = planItems.filter((it) => !it.inCatalog);
    const ambiguous = planItems.filter((it) => it.ambiguousZero);

    outResidents.push({
      residentId: res.residentId,
      name: res.lastName && res.firstName ? `${res.lastName}, ${res.firstName}` : res.fullName,
      unit: asArray(res.rooms).join(', ') || null,
      productType: res.productType,
      evaluation: latest
        ? { date: String(latest.evaluationDate).slice(0, 10), reason: latest.reason || null, retVersion: doc?.retVersion ?? null, hasAnswers: !!doc }
        : null,
      carePlanPublishDate: latestPublish ? latestPublish.slice(0, 10) : null,
      undecodableAnswers: undecodable,
      elements,
      weeklyCaregiverMinutes: round1(elements.reduce((s, e) => s + e.weeklyMinutes, 0)),
      averageDailyMinutes: round1(elements.reduce((s, e) => s + e.weeklyMinutes, 0) / 7),
      totalCareItems: elements.reduce((s, e) => s + e.careRows.length, 0),
      prnItems: elements.reduce((s, e) => s + e.careRows.filter((r) => r.prn).length, 0),
      unassignedAbstItems: unassigned.map((it) => ({ name: it.name, schedule: it.schedule, minutesPerOccurrence: it.minutesPerOccurrence })),
      ambiguousDuplicateItems: ambiguous.map((it) => ({ name: it.name, schedule: it.schedule, minutesPerOccurrence: it.minutesPerOccurrence })),
      itemsNotInCatalog: notInCatalog.map((it) => ({ name: it.name, schedule: it.schedule, minutesPerOccurrence: it.minutesPerOccurrence })),
    });
  }

  outResidents.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // community summary: per element, count of residents in each status
  const summary = elementCfg.elements.map((el) => {
    const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
    for (const r of outResidents) counts[r.elements.find((e) => e.id === el.id).status]++;
    return { id: el.id, name: el.name, counts, total: outResidents.length };
  });

  const communityName = plan[0]?.communityName || evals[0]?.communityName || xmlDocs[0]?.communityName || `Community ${cid}`;
  const generatedAt = new Date().toISOString();

  return {
    meta: {
      host,
      communityId: cid,
      communityName,
      retName,
      retVersionUsedForDecoding: retVersion,
      generatedAt,
      dataAsOf: `ALIS export API, pulled ${generatedAt}`,
      footnote,
      headerLine: 'Generated from ALIS evaluation and care plan data. Supplements the Oregon ABST report in ALIS HQ.',
      statusLabels: STATUS_LABEL,
      residentCount: outResidents.length,
      unresolvedQuestionMatchers: [...unresolvedQuestionMatchers],
    },
    summary,
    residents: outResidents,
  };
}

module.exports = { buildAbstCrosswalk, STATUS, STATUS_LABEL, scheduleInfo, norm };
