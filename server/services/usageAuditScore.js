/**
 * Rolls one company's usage-audit grid (usageAuditNormalizer.js's
 * buildAuditGrid output) into the single combined score the portfolio
 * roll-up sorts and colors by (Aaron, Sep 2026: "combined score, plus keep
 * the two raw percentages visible for drill-down").
 *
 * enabledPct/usedPct are each computed over every (feature, community) cell
 * that actually has a determinate reading — a cell left null (not scraped,
 * or no usage signal exists for that feature) is excluded from both its
 * numerator and denominator rather than counted as a red mark, since null
 * means "unknown," not "off."
 */

const RED_MAX = 40;
const YELLOW_MAX = 70;

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** @param {object} summary - one company's buildAuditGrid() result */
function computeUsageAuditScore(summary) {
  let enabledYes = 0, enabledTotal = 0, usedYes = 0, usedTotal = 0;

  for (const feature of summary.features || []) {
    for (const cell of Object.values(feature.byCommunity || {})) {
      if (cell.enabled !== null) {
        enabledTotal += 1;
        if (cell.enabled) enabledYes += 1;
      }
      if (cell.used !== null) {
        usedTotal += 1;
        if (cell.used) usedYes += 1;
      }
    }
  }

  const enabledPct = enabledTotal > 0 ? round1((enabledYes / enabledTotal) * 100) : null;
  const usedPct = usedTotal > 0 ? round1((usedYes / usedTotal) * 100) : null;
  const combinedScore = enabledPct != null && usedPct != null
    ? round1((enabledPct + usedPct) / 2)
    : (enabledPct ?? usedPct);

  return { enabledPct, usedPct, combinedScore };
}

/** Red/yellow/green banding for a combined score, matching the "no usage / some usage / active-and-robust" language of Aaron's original manual RAG spreadsheets. null score (nothing scraped at all) has no band. */
function getScoreBand(combinedScore) {
  if (combinedScore == null) return null;
  if (combinedScore < RED_MAX) return 'red';
  if (combinedScore < YELLOW_MAX) return 'yellow';
  return 'green';
}

/**
 * Same rollup as computeUsageAuditScore, but broken out per community
 * (keyed the same way as buildAuditGrid's byCommunity, "host::communityId")
 * instead of collapsed to one company-wide number — the roll-up table's
 * expand-to-communities detail.
 */
function computeCommunityScores(summary) {
  const totals = {};
  for (const c of summary.communities || []) {
    const key = `${c.host}::${c.communityId}`;
    totals[key] = { name: c.name, communityId: c.communityId, host: c.host, enabledYes: 0, enabledTotal: 0, usedYes: 0, usedTotal: 0 };
  }
  for (const feature of summary.features || []) {
    for (const [key, cell] of Object.entries(feature.byCommunity || {})) {
      const t = totals[key];
      if (!t) continue;
      if (cell.enabled !== null) {
        t.enabledTotal += 1;
        if (cell.enabled) t.enabledYes += 1;
      }
      if (cell.used !== null) {
        t.usedTotal += 1;
        if (cell.used) t.usedYes += 1;
      }
    }
  }
  return Object.values(totals).map((t) => {
    const enabledPct = t.enabledTotal > 0 ? round1((t.enabledYes / t.enabledTotal) * 100) : null;
    const usedPct = t.usedTotal > 0 ? round1((t.usedYes / t.usedTotal) * 100) : null;
    const combinedScore = enabledPct != null && usedPct != null ? round1((enabledPct + usedPct) / 2) : (enabledPct ?? usedPct);
    return { name: t.name, communityId: t.communityId, host: t.host, enabledPct, usedPct, combinedScore, band: getScoreBand(combinedScore) };
  });
}

module.exports = { computeUsageAuditScore, getScoreBand, computeCommunityScores };
