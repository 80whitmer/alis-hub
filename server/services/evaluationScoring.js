/**
 * Turns ALIS's RET (Resident Evaluation Tool) question/answer catalog +
 * a resident's actual evaluation answers into a per-evaluation CarePoints
 * total — the acuity-scoring weight ALIS itself attaches to each answer
 * choice (confirmed live, Sep 2026, against imagineseniorliving).
 *
 * Two inputs, from two different (previously unwired) export endpoints:
 *   - getEvaluationConfigurations() → the catalog: for each
 *     evaluationConfigurationId, every Question (with an IncludeInPoints
 *     flag) and its Answers (each optionally carrying a CarePoints value —
 *     an Answer with no CarePoints attribute is worth 0, not an error; most
 *     answer choices per question are, since only some answer tiers along a
 *     severity scale carry weight).
 *   - getEvaluationXmlDocuments() → retXml: the resident's actual answers,
 *     just Question Id → Answer Id pairs (+ free-text Notes) with no point
 *     values of its own.
 *
 * `total` here sums CarePoints only across questions whose catalog entry has
 * IncludeInPoints="true" — confirmed live that most questions are
 * IncludeInPoints="false" (informational/demographic), so summing
 * indiscriminately would inflate the score with non-scored answers. This is
 * ALIS's own care/acuity weighting, not an invented risk score — deliberately
 * exposed as a number + breakdown rather than a "high/medium/low" label,
 * since where the label threshold should sit is a product decision (same
 * caution wellnessExport.js already applies to highRiskResidents/
 * continuousCareResidents — see MANUAL_ROW_KEYS there).
 */

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Always returns an array, whether the XML node parsed to one object, many, or nothing (fast-xml-parser collapses a single child to a bare object, not a 1-length array). */
function asArray(node) {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/**
 * Parses one evaluationConfigurationXml into
 * { [questionId]: { includeInPoints, text, answers: { [answerId]: { carePoints, text } } } }.
 * Tolerant of the Enabled/Disabled question grouping and any nesting depth
 * under Domains — walks every Domain looking for Questions/Enabled|Disabled
 * rather than assuming a fixed structure, since a retired (Disabled)
 * question's answer can still appear on an old resident's retXml.
 */
function parseEvaluationConfigXml(xml) {
  const questions = {};
  if (!xml) return questions;

  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return questions;
  }

  const domains = asArray(doc?.Instrument?.Domains?.Domain);
  for (const domain of domains) {
    const questionGroups = domain?.Questions;
    if (!questionGroups) continue;
    const allQuestions = [
      ...asArray(questionGroups.Enabled?.Question),
      ...asArray(questionGroups.Disabled?.Question),
      // Some configs may not use the Enabled/Disabled wrapper at all.
      ...asArray(questionGroups.Question),
    ];
    for (const q of allQuestions) {
      const questionId = q['@_Id'];
      if (!questionId) continue;
      const answers = {};
      for (const a of asArray(q.Answers?.Answer)) {
        const answerId = a['@_Id'];
        if (!answerId) continue;
        answers[answerId] = {
          carePoints: Number(a['@_CarePoints']) || 0,
          text: typeof a.Text === 'string' ? a.Text : (a.Text?.['#text'] ?? ''),
        };
      }
      questions[questionId] = {
        includeInPoints: q['@_IncludeInPoints'] === 'true',
        text: typeof q.Text === 'string' ? q.Text : (q.Text?.['#text'] ?? ''),
        answers,
      };
    }
  }
  return questions;
}

/**
 * Builds { [evaluationConfigurationId]: parsedQuestionCatalog } from every
 * row returned by getEvaluationConfigurations(). One entry can appear more
 * than once across communities with the same config — later rows win, same
 * config content either way (the catalog itself isn't community-specific
 * data, just replicated per-community in the export response).
 */
function buildConfigCatalog(evaluationConfigurations = []) {
  const catalog = {};
  for (const row of evaluationConfigurations) {
    const id = row.evaluationConfigurationId;
    if (id == null) continue;
    catalog[id] = parseEvaluationConfigXml(row.evaluationConfigurationXml);
  }
  return catalog;
}

/** Parses one resident's retXml into a flat list of { questionId, answerId, notes }. */
function parseRetXml(xml) {
  if (!xml) return [];
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const answers = [];
  for (const domain of asArray(doc?.Evaluation?.Domain)) {
    for (const q of asArray(domain?.Question)) {
      const questionId = q['@_Id'];
      const answerId = q.Answer?.['@_Id'];
      if (!questionId || !answerId) continue;
      answers.push({
        questionId,
        answerId,
        notes: typeof q.Notes === 'string' ? q.Notes : (q.Notes?.['#text'] ?? null),
      });
    }
  }
  return answers;
}

/**
 * Computes one evaluation's CarePoints total by joining its retXml answers
 * against the matching config's question/answer catalog.
 * @returns {{ total: number, answeredQuestions: number, matchedQuestions: number, byQuestion: Array }}
 *   `matchedQuestions` vs `answeredQuestions` lets a caller tell "this
 *   resident's evaluation predates/postdates the config we have on file" (a
 *   config version mismatch) apart from "this question just isn't scored" —
 *   both look like 0 extra points otherwise.
 */
function computeCarePoints(retXml, configCatalog, evaluationConfigurationId) {
  const answers = parseRetXml(retXml);
  const questionCatalog = configCatalog[evaluationConfigurationId] || {};

  let total = 0;
  let matchedQuestions = 0;
  const byQuestion = [];

  for (const { questionId, answerId, notes } of answers) {
    const question = questionCatalog[questionId];
    if (!question) {
      byQuestion.push({ questionId, answerId, matched: false, points: 0, notes });
      continue;
    }
    matchedQuestions++;
    const answer = question.answers[answerId];
    const points = question.includeInPoints ? (answer?.carePoints || 0) : 0;
    total += points;
    byQuestion.push({
      questionId, answerId, matched: true, points, notes,
      questionText: question.text, answerText: answer?.text,
      includeInPoints: question.includeInPoints,
    });
  }

  return { total, answeredQuestions: answers.length, matchedQuestions, byQuestion };
}

module.exports = { parseEvaluationConfigXml, buildConfigCatalog, parseRetXml, computeCarePoints };
