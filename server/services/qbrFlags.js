/**
 * Rule-based QBR discussion-point generator.
 *
 * Deliberately NOT an LLM narrative pass — alis-hub has no existing
 * LLM/Claude API wiring, and sending client operational data to an
 * external LLM vendor is a decision that hasn't been explicitly asked
 * for. These flags are deterministic and auditable: every one traces back
 * to a specific number vs. a specific ALIS 500 benchmark or ticket count.
 * They render in the dashboard and land as bullet drafts in the PPTX for
 * the account manager to edit — never auto-finalized prose.
 */

const SEVERITY = { OPPORTUNITY: 'opportunity', WATCH: 'watch', RISK: 'risk', INFO: 'info' };

function pct(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

/**
 * @param {object} normalized  Output of the kpiNormalizer functions, merged.
 * @param {object} diffs       Output of kpiNormalizer.computeBenchmarkDiffs.
 * @param {object|null} ticketSummary  Output of hubspotTickets.getTicketSummaryForCompany, or null if no HubSpot company was linked.
 */
function generateFlags(normalized, diffs, ticketSummary) {
  const flags = [];

  // ── Occupancy ────────────────────────────────────────────────────────
  if (diffs.occupancyPct && !diffs.occupancyPct.better) {
    flags.push({
      severity: SEVERITY.OPPORTUNITY,
      category: 'Occupancy',
      title: `Occupancy at ${pct(diffs.occupancyPct.actual)}, below the ALIS 500 reference split (${pct(diffs.occupancyPct.benchmark)})`,
      detail: `Vacancy loss is the highest-leverage lever here. ALIS 500 communities above this occupancy line also tend to run shorter onboarding cycles.`,
      talkingPoint: 'Discuss Move-in Module adoption and lead-to-move-in cycle time.',
    });
  }

  // ── Length of stay / retention ───────────────────────────────────────
  if (diffs.medianLosDays && !diffs.medianLosDays.better) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Retention',
      title: `Median length of stay is ${Math.round(diffs.medianLosDays.actual)} days, below the ALIS 500 median of ${diffs.medianLosDays.benchmark} days`,
      detail: 'Shorter stays mean higher onboarding cost per resident-year, independent of occupancy.',
      talkingPoint: 'Review move-out reasons for anything actionable (see Quality-of-Service share below); consider Move Out Predictor (MOP) for early-warning on at-risk residents.',
    });
  }

  if (diffs.qualityOfServiceMoveOutShare && !diffs.qualityOfServiceMoveOutShare.better) {
    flags.push({
      severity: SEVERITY.RISK,
      category: 'Retention',
      title: `Quality-of-service move-outs are ${pct(diffs.qualityOfServiceMoveOutShare.actual)} of all move-outs, above the ALIS 500 benchmark (${pct(diffs.qualityOfServiceMoveOutShare.benchmark)})`,
      detail: 'Unlike health-related move-outs, this category is largely within the community\'s control.',
      talkingPoint: 'Walk through the specific move-out records tagged financial/competition/dissatisfied — these are the actionable ones.',
    });
  }

  // ── Clinical / care ───────────────────────────────────────────────────
  if (diffs.fallsPer1000ResidentDays && !diffs.fallsPer1000ResidentDays.better) {
    flags.push({
      severity: SEVERITY.RISK,
      category: 'Clinical',
      title: `Falls at ${diffs.fallsPer1000ResidentDays.actual.toFixed(1)} per 1,000 resident-days, above the ALIS 500 benchmark (${diffs.fallsPer1000ResidentDays.benchmark})`,
      detail: 'ALIS 500 data shows Memory Care residents fall more often nationally — worth checking if the gap concentrates there.',
      talkingPoint: 'Review care staffing during peak fall-incidence hours; confirm risk-analysis dashboard is in active use.',
    });
  }

  if (diffs.hospitalVisitsPer1000ResidentDays && !diffs.hospitalVisitsPer1000ResidentDays.better) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Clinical',
      title: `Hospital/SNF visit rate at ${diffs.hospitalVisitsPer1000ResidentDays.actual.toFixed(1)} per 1,000 resident-days, above benchmark (${diffs.hospitalVisitsPer1000ResidentDays.benchmark})`,
      detail: 'Worth a quick look at whether this concentrates in a specific diagnosis group.',
      talkingPoint: 'Cross-reference with the diagnosis/comorbidity breakdown for this account.',
    });
  }

  if (diffs.sedativePrnPer1000ResidentDays && !diffs.sedativePrnPer1000ResidentDays.better) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Clinical',
      title: `Sedative/antipsychotic PRN administration at ${diffs.sedativePrnPer1000ResidentDays.actual.toFixed(1)} per 1,000 resident-days, above benchmark (${diffs.sedativePrnPer1000ResidentDays.benchmark})`,
      detail: 'Elevated sedative PRN use is often a clinical-review and compliance conversation, not just an operational one.',
      talkingPoint: 'Flag for the clinical team to review PRN administration patterns.',
    });
  }

  // Care task completion has no ALIS 500 benchmark to diff against (that
  // dataset doesn't cover it) — these are absolute thresholds, not a
  // vs.-benchmark comparison like the flags above.
  if (normalized.careCompletion?.pct != null) {
    const careCompletionPct = normalized.careCompletion.pct;
    if (careCompletionPct < 0.80) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Clinical',
        title: `Only ${pct(careCompletionPct)} of scheduled care tasks were recorded as completed this period`,
        detail: `Based on ${normalized.careCompletion.daysSampled} sampled day(s), ${normalized.careCompletion.completed} of ${normalized.careCompletion.totalRecorded} recorded tasks were marked Completed.`,
        talkingPoint: 'Review care task completion workflow with the care team — this is a meaningful gap versus a fully-staffed community.',
      });
    } else if (careCompletionPct < 0.90) {
      flags.push({
        severity: SEVERITY.WATCH,
        category: 'Clinical',
        title: `${pct(careCompletionPct)} of scheduled care tasks were recorded as completed this period`,
        detail: `Based on ${normalized.careCompletion.daysSampled} sampled day(s), ${normalized.careCompletion.completed} of ${normalized.careCompletion.totalRecorded} recorded tasks were marked Completed.`,
        talkingPoint: 'Worth a quick check on whether this concentrates on specific shifts or task types.',
      });
    }
  }

  // Staff activity is a login-recency snapshot as of the job run, not
  // scoped to the reporting period — see kpiNormalizer.js. No benchmark
  // exists for it either, so this is an absolute threshold too.
  if (normalized.staffActivity?.pct != null && normalized.staffActivity.pct < 0.60) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Adoption',
      title: `Only ${pct(normalized.staffActivity.pct)} of enabled staff have logged into ALIS in the last 30 days`,
      detail: `${normalized.staffActivity.activeInWindow} of ${normalized.staffActivity.totalEnabledStaff} enabled staff active in the last 30 days; ${normalized.staffActivity.neverLoggedIn} have never logged in at all.`,
      talkingPoint: 'Worth checking whether this is an onboarding gap, a role that doesn\'t need system access, or an adoption issue worth addressing.',
    });
  }

  // ── Support tickets ───────────────────────────────────────────────────
  if (ticketSummary) {
    if (ticketSummary.agingOpenTickets.length > 0) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Support',
        title: `${ticketSummary.agingOpenTickets.length} open ticket(s) aging past 90 days`,
        detail: ticketSummary.agingOpenTickets.map((t) => `#${t.id} — ${t.subject} (${t.daysOpen}d open)`).join('; '),
        talkingPoint: 'Review each aging ticket at the QBR and set a concrete next step or close date.',
      });
    }

    const salesOppTickets = (ticketSummary.tickets || []).filter((t) =>
      (t.category || '').toLowerCase().includes('sales') || (t.category || '').toLowerCase().includes('opportunity')
    );
    if (salesOppTickets.length > 0) {
      flags.push({
        severity: SEVERITY.OPPORTUNITY,
        category: 'Account growth',
        title: `${salesOppTickets.length} ticket(s) tagged as a sales opportunity`,
        detail: salesOppTickets.map((t) => `#${t.id} — ${t.subject}`).join('; '),
        talkingPoint: 'Surface directly in the QBR as a growth/upsell conversation.',
      });
    }

    const topCategory = Object.entries(ticketSummary.byCategory || {}).sort((a, b) => b[1].total - a[1].total)[0];
    if (topCategory && topCategory[1].total >= 3) {
      flags.push({
        severity: SEVERITY.INFO,
        category: 'Support',
        title: `"${topCategory[0]}" is the most common ticket category this period (${topCategory[1].total} tickets)`,
        detail: 'Recurring friction in one area is often a config-review or training opportunity rather than a series of one-off issues.',
        talkingPoint: `Ask whether a config review or a short training session on ${topCategory[0]} would reduce recurrence.`,
      });
    }
  }

  const severityOrder = { risk: 0, opportunity: 1, watch: 2, info: 3 };
  return flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

module.exports = { generateFlags, SEVERITY };
