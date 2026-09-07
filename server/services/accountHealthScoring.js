/**
 * Portfolio Account Health scoring — Section 5 of the "ALIS Account Manager
 * Quarterly Dashboard" framework (see HUBSPOT_BRIDGE_SCHEMA.md), which that
 * schema deliberately left out of its JSON: "that belongs in alis-hub's
 * display layer, computed from the raw signals here, not baked into the
 * JSON by the skill." This module is that display-layer computation, shared
 * by the Account Health Dashboard API now and by exports later.
 *
 * A category's weight is only applied when that category actually has
 * data — a category with none is never silently scored as 0, matching the
 * bridge schema's own "0 must mean checked-and-found-zero, not
 * didn't-check" philosophy. Weights and thresholds below are a starting
 * default (documented inline), not a tuned model — expect to retune once
 * this runs against real portfolios.
 */

// Applied when only Service + Financial have data (the live-refresh
// guarantee — see accountHealth.js).
const DEFAULT_WEIGHTS = { service: 0.55, financial: 0.45, relationship: 0, product: 0 };

// Applied when Relationship and/or Product health are ALSO present
// (opportunistic — read from an existing manual bridge import or prior
// kpi-export job, never computed fresh here) — redistributes weight
// toward the fuller picture rather than just adding categories on top of
// the same per-category weight, which would over-total 1.0.
const FULL_WEIGHTS = { service: 0.40, financial: 0.30, relationship: 0.15, product: 0.15 };

const SCORE_BANDS = [
  { max: 40, color: 'red', label: 'Unhealthy' },
  { max: 60, color: 'orange', label: 'At Risk' },
  { max: 80, color: 'blue', label: 'Stable' },
  { max: 101, color: 'green', label: 'Healthy' },
];

function bandFor(score) {
  return SCORE_BANDS.find((b) => score < b.max) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

/**
 * Ticket-aging thresholds (30/45/90 days) match the ones already
 * established elsewhere in this app — qbrFlags.js flags a ticket aging
 * past 90 days as a RISK; HUBSPOT_BRIDGE_SCHEMA.md's example uses a 30-45
 * day band for what "should visually scream." Reused here as score cliffs
 * rather than invented fresh, so "aging" means the same thing everywhere
 * in alis-hub.
 */
function scoreServiceHealth(serviceHealth) {
  if (!serviceHealth) return null;
  let score = 100;

  const avgAge = serviceHealth.avgTicketAgeDays;
  if (avgAge != null) {
    if (avgAge > 90) score -= 40;
    else if (avgAge > 45) score -= 25;
    else if (avgAge > 30) score -= 10;
  }

  const agedCount = serviceHealth.agedTickets?.length || 0;
  score -= Math.min(30, agedCount * 5);

  const escalations = serviceHealth.escalationCount || 0;
  score -= Math.min(20, escalations * 10);

  const repeatIssues = serviceHealth.repeatIssues?.length || 0;
  score -= Math.min(15, repeatIssues * 5);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * `aging` is the weekly Customer Aging Report import (server/api/
 * accountHealth.js's /import-aging-report, matched via
 * agingReportMatcher.js) — genuinely new information the live HubSpot
 * refresh has no equivalent for (this portal has no AR-aging property on
 * either deals or companies), so it's scored independently of whether
 * bridgeOnlyFieldsAbsent's weaker fallback signal below applies. Scaled
 * by the FRACTION of the outstanding balance that's 61+ days past due,
 * not an absolute dollar amount — that stays meaningful across a $500
 * account and a $50,000 one without needing an ARR baseline to divide
 * by. A 121+ day balance is treated as a distinct, worse signal (an
 * amount that old often means something's actually stuck, not just
 * slow-paying) — a flat additional deduction on top of the scaled one.
 */
function scoreAging(aging) {
  if (!aging || !aging.totalCents || aging.totalCents <= 0) return 0;
  const pastDueFraction = (aging.pastDue61PlusCents || 0) / aging.totalCents;
  let deduction = Math.round(pastDueFraction * 25);
  if ((aging.d121PlusCents || 0) > 0) deduction += 10;
  return Math.min(35, deduction);
}

function scoreFinancialHealth(financialHealth, aging) {
  if (!financialHealth && !aging) return null;
  let score = 100;

  score -= scoreAging(aging);

  if (!financialHealth) return Math.max(0, Math.min(100, Math.round(score)));

  if (financialHealth.rateDispute?.status === 'open') score -= 25;

  const daysToRenewal = financialHealth.renewal?.daysToRenewal;
  if (daysToRenewal != null) {
    if (daysToRenewal < 0) score -= 30; // past due / lapsed
    else if (daysToRenewal < 30) score -= 15;
    else if (daysToRenewal < 90) score -= 5;
  }

  const backlogCount = financialHealth.unbilledAddendumBacklog?.count || 0;
  score -= Math.min(20, backlogCount * 5);

  const splitPay = financialHealth.splitPayAddendumCompletion;
  if (splitPay && splitPay.totalCount > 0) {
    const pctIncomplete = 1 - splitPay.completedCount / splitPay.totalCount;
    score -= Math.round(pctIncomplete * 15);
  }

  // Live-only signal: renewal/dispute/backlog/split-pay all come from the
  // manual bridge only (no renewal-date or dispute-status property exists
  // in this HubSpot portal outside that specialized research) — when
  // they're ALL absent, we're scoring from live deal data alone, which can
  // only really speak to "expansion, contraction, or flat" (the user's own
  // framing), not contract risk. A portfolio with zero open pipeline reads
  // as flat/stagnant, not a crisis — a modest deduction only, and this is
  // the weakest-evidence signal in this whole module: revisit once real
  // portfolios show whether it's actually predictive.
  const bridgeOnlyFieldsAbsent = financialHealth.renewal == null
    && financialHealth.rateDispute == null
    && financialHealth.unbilledAddendumBacklog == null
    && financialHealth.splitPayAddendumCompletion == null;
  if (bridgeOnlyFieldsAbsent && (financialHealth.expansionPipeline?.openDealsCount || 0) === 0) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreRelationshipHealth(relationshipHealth) {
  if (!relationshipHealth) return null;
  let score = 100;

  if (relationshipHealth.qbrCadence?.adherence === 'overdue') score -= 20;
  if (relationshipHealth.qbrCadence?.adherence === 'noneScheduled') score -= 10;
  if (relationshipHealth.contactTurnover?.flagged) score -= 20;

  const days = relationshipHealth.daysSinceGrowthConversation;
  if (days != null && days > 120) score -= 15;

  const avgResponse = relationshipHealth.responseLatency?.avgResponseHours;
  if (avgResponse != null && avgResponse > 24) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Product/Usage health (Section 1 of the framework) has no raw shape to
 * score from here — it only ever arrives as an already-computed 0-100
 * figure derived elsewhere (a prior kpi-export job's own benchmark
 * comparisons), or not at all. This just clamps/validates that input
 * rather than computing anything itself.
 */
function scoreProductHealth(productHealthScore) {
  return typeof productHealthScore === 'number' && !Number.isNaN(productHealthScore)
    ? Math.max(0, Math.min(100, Math.round(productHealthScore)))
    : null;
}

/**
 * Composite 0-100 score for one account. Returns `score: null` (not 0)
 * when NO category has any data, so the UI can show "no data" instead of a
 * false "0% healthy."
 */
function computeHealthScore({ serviceHealth, financialHealth, relationshipHealth, productHealthScore, aging } = {}) {
  const subScores = {
    service: scoreServiceHealth(serviceHealth),
    financial: scoreFinancialHealth(financialHealth, aging),
    relationship: scoreRelationshipHealth(relationshipHealth),
    product: scoreProductHealth(productHealthScore),
  };

  const present = Object.entries(subScores).filter(([, v]) => v != null);
  if (present.length === 0) return { score: null, band: null, subScores };

  const hasExtras = subScores.relationship != null || subScores.product != null;
  const weights = hasExtras ? FULL_WEIGHTS : DEFAULT_WEIGHTS;

  const totalWeight = present.reduce((sum, [k]) => sum + (weights[k] || 0), 0);
  const weighted = totalWeight > 0
    ? present.reduce((sum, [k, v]) => sum + v * (weights[k] || 0), 0) / totalWeight
    : present.reduce((sum, [, v]) => sum + v, 0) / present.length; // guard: shouldn't normally hit 0 total weight

  const score = Math.round(weighted);
  return { score, band: bandFor(score), subScores };
}

module.exports = { computeHealthScore, bandFor, SCORE_BANDS };
