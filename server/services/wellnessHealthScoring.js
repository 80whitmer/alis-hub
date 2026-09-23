/**
 * Per-community Wellness Health score for the Weekly Wellness Scorecard
 * (Sep 2026, Aaron: "let's assign each community a health score... roll up
 * table of communities... bring in the concept of region"). Same 0-100,
 * weighted-deduction-then-band shape as accountHealthScoring.js (that one
 * scores CRM/financial signals for a client account; this scores the
 * clinical/operational wellness signals this report already computes for
 * one community in one week), and the same "a category only counts when it
 * actually has data" rule — a community with zero incidents this week
 * isn't silently penalized for an empty documentation-completion category.
 *
 * A single week of data is a noisy sample, especially for a small
 * community (one fall at a 20-bed community swings its rate far harder
 * than the same fall would at an 80-bed one) — this is a starting formula
 * to react to and retune once it's run against a few real weeks, not a
 * validated clinical model.
 */

const SCORE_BANDS = [
  { max: 40, color: 'red', label: 'Unhealthy' },
  { max: 60, color: 'orange', label: 'At Risk' },
  { max: 80, color: 'blue', label: 'Stable' },
  { max: 101, color: 'green', label: 'Healthy' },
];

function bandFor(score) {
  return SCORE_BANDS.find((b) => score < b.max) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

function clamp(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Falls + hospital/ER visits, per 1,000 resident-days against the same
 * ALIS 500 benchmark the Portfolio-level BenchmarkBadge already compares
 * against (see wellnessExport.js's `benchmarkDiffs`) — the one category
 * here with an external, not just relative, yardstick. Falls back to a
 * flat capped per-event deduction when `residentDays` can't be computed
 * (no census this week) rather than returning null outright, so a
 * community never scores a free 100 on safety just because occupancy data
 * happened to be missing that week.
 */
function scoreSafety({ fallsTotal, hospitalTotal, residentDays, fallsBenchmarkPer1000, hospitalBenchmarkPer1000 }) {
  if (fallsTotal == null && hospitalTotal == null) return null;
  let score = 100;

  const fallsPer1000 = residentDays ? (fallsTotal / residentDays) * 1000 : null;
  if (fallsPer1000 != null && fallsBenchmarkPer1000 > 0) {
    const ratio = fallsPer1000 / fallsBenchmarkPer1000;
    if (ratio > 2) score -= 30;
    else if (ratio > 1.5) score -= 20;
    else if (ratio > 1) score -= 10;
  } else {
    score -= Math.min(20, (fallsTotal || 0) * 4);
  }

  const hospitalPer1000 = residentDays ? (hospitalTotal / residentDays) * 1000 : null;
  if (hospitalPer1000 != null && hospitalBenchmarkPer1000 > 0) {
    const ratio = hospitalPer1000 / hospitalBenchmarkPer1000;
    if (ratio > 2) score -= 25;
    else if (ratio > 1.5) score -= 15;
    else if (ratio > 1) score -= 8;
  } else {
    score -= Math.min(15, (hospitalTotal || 0) * 5);
  }

  return clamp(score);
}

/**
 * Share of this week's falls/other-incidents/behavioral/elopement reports
 * (the rows this scorecard already flags `hasDocCompletion` — see
 * wellnessRowDefinitions.js) still missing a completed form or
 * intervention. Returns null (not 100) when there were no such incidents
 * this week — nothing to document isn't the same as documenting
 * everything.
 */
function scoreDocumentation({ openDocsTotal, incidentTotal }) {
  if (!incidentTotal) return null;
  const pctOpen = Math.min(1, openDocsTotal / incidentTotal);
  return clamp(100 - pctOpen * 100);
}

/** Medication exceptions as a rate of census, not a raw count, so a 20-bed and an 80-bed community are compared fairly. */
function scoreMedication({ medExceptionsTotal, census }) {
  if (!census) return null;
  const rate = medExceptionsTotal / census;
  let score = 100;
  if (rate > 0.5) score -= 40;
  else if (rate > 0.25) score -= 25;
  else if (rate > 0.1) score -= 10;
  return clamp(score);
}

/** Overdue quarterly evaluations as a share of census — same rate-not-raw-count reasoning as medication above. */
function scoreCarePlanning({ evaluationsOverdueTotal, census }) {
  if (!census) return null;
  const rate = evaluationsOverdueTotal / census;
  let score = 100;
  if (rate > 0.3) score -= 30;
  else if (rate > 0.15) score -= 15;
  else if (rate > 0.05) score -= 5;
  return clamp(score);
}

/**
 * Relative to this report's OWN portfolio average occupancy this week, not
 * an external benchmark — this scorecard has none for occupancy (unlike
 * falls/hospital visits). A community running meaningfully below the
 * portfolio's own average is a utilization/marketing signal worth an AM
 * conversation more than a clinical one, so it carries the smallest
 * weight of the five categories.
 */
function scoreOccupancy({ occupancyPct, portfolioAvgOccupancyPct }) {
  if (occupancyPct == null || portfolioAvgOccupancyPct == null) return null;
  const delta = occupancyPct - portfolioAvgOccupancyPct;
  let score = 100;
  if (delta < -0.15) score -= 30;
  else if (delta < -0.08) score -= 15;
  else if (delta < -0.03) score -= 5;
  return clamp(score);
}

// "Balanced clinical + operational mix" per Aaron (Sep 2026): safety
// carries the most weight, documentation/medication/care-planning next,
// occupancy least (it's a utilization signal, not a clinical one). Applied
// only across whichever categories actually have data this week — same
// present-only renormalization as accountHealthScoring.js's
// computeHealthScore, so a week with e.g. no incidents at all isn't scored
// as if "no incidents" meant a missing documentation category dragged the
// score down.
const WEIGHTS = { safety: 0.35, documentation: 0.20, medication: 0.15, carePlanning: 0.15, occupancy: 0.15 };

/** Composite 0-100 score for one community, one week. Returns `score: null` (not 0) when no category had data at all. */
function computeCommunityHealthScore(inputs) {
  const subScores = {
    safety: scoreSafety(inputs),
    documentation: scoreDocumentation(inputs),
    medication: scoreMedication(inputs),
    carePlanning: scoreCarePlanning(inputs),
    occupancy: scoreOccupancy(inputs),
  };

  const present = Object.entries(subScores).filter(([, v]) => v != null);
  if (present.length === 0) return { score: null, band: null, subScores };

  const totalWeight = present.reduce((sum, [k]) => sum + WEIGHTS[k], 0);
  const weighted = present.reduce((sum, [k, v]) => sum + v * WEIGHTS[k], 0) / totalWeight;

  const score = Math.round(weighted);
  return { score, band: bandFor(score), subScores };
}

/**
 * Portfolio-wide rollup once every community has a score — average,
 * best/worst performer, an "at risk" worklist (score < 60, the same
 * At-Risk/Unhealthy cutoff SCORE_BANDS uses), and the region comparison
 * Aaron asked for. `communities` is `[{communityId, name, region, score,
 * band, ...}]` (score/band already computed per community above).
 * Communities with no region on file (ALIS's own `region` field — see
 * wellnessExport.js) group under "Unassigned" rather than being dropped,
 * so a portfolio with incomplete region data still gets a usable rollup.
 */
function computeRollup(communities) {
  const scored = communities.filter((c) => c.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;

  const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
  const best = byScoreDesc[0] || null;
  const worst = byScoreDesc[byScoreDesc.length - 1] || null;
  const atRisk = byScoreDesc.filter((c) => c.score < 60).sort((a, b) => a.score - b.score);

  const byRegionMap = new Map();
  for (const c of communities) {
    const region = c.region || 'Unassigned';
    if (!byRegionMap.has(region)) byRegionMap.set(region, []);
    byRegionMap.get(region).push(c);
  }
  const byRegion = Array.from(byRegionMap.entries())
    .map(([region, list]) => {
      const scoredList = list.filter((c) => c.score != null);
      const regionAvg = scoredList.length ? Math.round(scoredList.reduce((s, c) => s + c.score, 0) / scoredList.length) : null;
      return { region, communityCount: list.length, avgScore: regionAvg };
    })
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));

  const regionsScored = byRegion.filter((r) => r.avgScore != null);
  const bestRegion = regionsScored[0] || null;
  const worstRegion = regionsScored.length ? [...regionsScored].sort((a, b) => a.avgScore - b.avgScore)[0] : null;

  return { avgScore, best, worst, atRiskCount: atRisk.length, atRisk, byRegion, bestRegion, worstRegion };
}

module.exports = { computeCommunityHealthScore, computeRollup, bandFor, SCORE_BANDS };
