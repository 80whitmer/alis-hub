const express = require('express');
const router = express.Router();

const { getResidents, getEvaluations, getEvaluationConfigurations, getEvaluationXmlDocuments } = require('../services/alisApiClient');
const { buildConfigCatalog, computeCarePoints } = require('../services/evaluationScoring');
const { upsertEvaluationConfigVersion, getEvaluationConfigVersions } = require('../db/database');

// GET /api/evaluations/search-residents?host=X&q=name — live lookup (not a job), backing a resident search box.
router.get('/search-residents', async (req, res) => {
  try {
    const { host, q } = req.query;
    if (!host) return res.status(400).json({ error: 'host is required' });
    const residents = await getResidents(host);
    const query = (q || '').toLowerCase().trim();
    const matches = residents
      .filter((r) => !query || (r.fullName || '').toLowerCase().includes(query))
      .slice(0, 25)
      .map((r) => ({
        residentId: r.residentId,
        name: r.fullName,
        communityId: r.communityId,
      }));
    res.json({ residents: matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/evaluations/:host/:residentId — current evaluation + question/answer breakdown where available.
router.get('/:host/:residentId', async (req, res) => {
  try {
    const { host, residentId } = req.params;

    const evaluations = await getEvaluations(host);
    const current = evaluations.find((e) => String(e.residentId) === String(residentId) && e.isMostCurrent === true);
    if (!current) return res.status(404).json({ error: 'No current evaluation found for this resident.' });

    // Refresh the historical config cache with whatever's live right now
    // (INSERT OR IGNORE — never overwrites an already-captured version, see
    // database.js's evaluation_config_versions table), then build the
    // catalog from live + every previously-cached version combined.
    const liveConfigs = await getEvaluationConfigurations(host);
    for (const c of liveConfigs) {
      upsertEvaluationConfigVersion(host, c.evaluationConfigurationId, {
        version: c.evaluationConfigurationVersion,
        name: c.evaluationConfigurationName,
        xml: c.evaluationConfigurationXml,
      });
    }
    const catalog = buildConfigCatalog([...liveConfigs, ...getEvaluationConfigVersions(host)]);

    // Best-effort join to retXml — xmlDocuments' `retId` matches
    // getEvaluations' `residentEvaluationID` for roughly half of
    // most-current evaluations at one real account (confirmed live, Sep
    // 2026: 212 of 392) — question-level detail isn't guaranteed for every
    // resident, only the summary fields (carePoints/careLevel) are.
    const xmlDocs = await getEvaluationXmlDocuments(host, { status: 'CurrentResident' });
    const matchingDoc = xmlDocs.find((d) => String(d.retId) === String(current.residentEvaluationID));

    const breakdown = matchingDoc ? computeCarePoints(matchingDoc.retXml, catalog, matchingDoc.retConfigurationId) : null;

    res.json({
      residentId: current.residentId,
      residentName: current.residentName,
      communityId: current.communityId,
      communityName: current.communityName,
      evaluationDate: current.evaluationDate,
      reason: current.reason,
      careLevel: current.careLevel,
      carePoints: current.carePoints,
      fee: current.fee,
      questionBreakdown: breakdown?.byQuestion || [],
      breakdownNote: breakdown
        ? (breakdown.matchedQuestions < breakdown.answeredQuestions
          ? `${breakdown.answeredQuestions - breakdown.matchedQuestions} of ${breakdown.answeredQuestions} answered question(s) reference a config version not in our cache yet — those show as unmatched below.`
          : null)
        : 'This evaluation\'s raw answers (retId) don\'t match a current xmlDocuments row — question-level detail isn\'t available, only the summary fields above. This resolves itself over time as more evaluations get re-answered under the currently-cached config.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
