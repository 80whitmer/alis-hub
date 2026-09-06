require('dotenv').config();
const { getEvaluationConfigurations, getEvaluationXmlDocuments } = require('./services/alisApiClient');
const { buildConfigCatalog, computeCarePoints } = require('./services/evaluationScoring');

const HOST = 'imagineseniorliving';

(async () => {
  console.log('Pulling evaluation configurations...');
  const configs = await getEvaluationConfigurations(HOST);
  console.log(`Got ${configs.length} configs:`, configs.map((c) => `${c.evaluationConfigurationId}=${c.evaluationConfigurationName}`));

  const catalog = buildConfigCatalog(configs);
  for (const [id, questions] of Object.entries(catalog)) {
    const withPoints = Object.values(questions).filter((q) => q.includeInPoints);
    console.log(`  config ${id}: ${Object.keys(questions).length} questions parsed, ${withPoints.length} IncludeInPoints=true`);
  }

  console.log('\nPulling evaluation xmlDocuments (CurrentResident)...');
  const evals = await getEvaluationXmlDocuments(HOST, { status: 'CurrentResident' });
  console.log(`Got ${evals.length} evaluation rows.`);

  // Compute CarePoints for the first 10 non-training, most-current-looking evaluations with a real retXml.
  const sample = evals.filter((e) => e.retXml && e.communityName !== 'Training Community').slice(0, 10);
  console.log(`\nComputing CarePoints for ${sample.length} sample evaluations:\n`);
  for (const e of sample) {
    const result = computeCarePoints(e.retXml, catalog, e.retConfigurationId);
    console.log(
      `${e.residentName?.padEnd(25) || '(no name)'} | ret=${e.retName?.padEnd(28) || ''} | configId=${e.retConfigurationId} | ` +
      `answered=${result.answeredQuestions} matched=${result.matchedQuestions} | CarePoints total=${result.total}`
    );
    if (result.total > 0) {
      const scored = result.byQuestion.filter((q) => q.points > 0);
      for (const q of scored.slice(0, 3)) {
        console.log(`    Q"${(q.questionText||'').slice(0,60)}" -> A"${(q.answerText||'').slice(0,60)}" = ${q.points} pts`);
      }
    }
  }
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
