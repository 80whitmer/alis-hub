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

function usd(n) {
  return n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * @param {object} normalized  Output of the kpiNormalizer functions, merged.
 * @param {object} diffs       Output of kpiNormalizer.computeBenchmarkDiffs.
 * @param {object|null} ticketSummary  Output of hubspotTickets.getTicketSummaryForCompany, or null if no HubSpot company was linked.
 * @param {object|null} dealSummary  Output of hubspotTickets.getDealSummaryForCompany, or null if no HubSpot company was linked.
 * @param {object|null} hubspotHealth  Output of the qbr-export skill import (see server/services/HUBSPOT_BRIDGE_SCHEMA.md), or null if nothing's been imported yet. Not available at job-run time — regenerated with this included when a health export is imported (see server/api/qbr.js).
 */
function generateFlags(normalized, diffs, ticketSummary, dealSummary, hubspotHealth = null) {
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

  if (diffs.prnAdministrationPer1000ResidentDays && !diffs.prnAdministrationPer1000ResidentDays.better) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Clinical',
      title: `PRN medication administration at ${diffs.prnAdministrationPer1000ResidentDays.actual.toFixed(1)} per 1,000 resident-days, above benchmark (${diffs.prnAdministrationPer1000ResidentDays.benchmark})`,
      detail: 'Elevated PRN use is often a clinical-review and compliance conversation, not just an operational one — this is an overall rate, not broken down by drug class.',
      talkingPoint: 'Flag for the clinical team to review PRN administration patterns.',
    });
  }

  // Incident completion has no ALIS 500 benchmark either — an absolute
  // threshold, same reasoning as careCompletion/staffActivity below. Per
  // client feedback (Gallaher, 2026-09-01), fall-related incidents are
  // called out by name in the flag itself since a completed post-fall
  // intervention is a specific compliance requirement, not just tidiness.
  if (normalized.incidentCompletion?.hasData && normalized.incidentCompletion.overall.openItemCount > 0) {
    const { overall, falls: fallCompletion, byCommunity } = normalized.incidentCompletion;
    const fallNote = fallCompletion.openItemCount > 0
      ? ` — includes ${fallCompletion.openItemCount} fall-related incident(s) with an incomplete form or intervention`
      : '';
    flags.push({
      severity: overall.pctComplete < 0.80 || fallCompletion.openItemCount > 0 ? SEVERITY.RISK : SEVERITY.WATCH,
      category: 'Clinical',
      title: `${overall.openItemCount} of ${overall.total} incident report(s) this period still have open documentation${fallNote}`,
      detail: `${overall.totalIncompleteForms} incomplete form(s) and ${overall.totalIncompleteTasks} incomplete task(s)/intervention(s) outstanding across ${byCommunity.length} ${byCommunity.length === 1 ? 'community' : 'communities'}.`,
      talkingPoint: 'Review the open incident list by community — closing out documentation and interventions (required after every fall) is a compliance item, not just tidiness.',
    });
  }

  // Sentinel incidents — Leisure Care only (see companyFeatures.js);
  // `normalized.sentinelIncidents` is undefined for every other client, so
  // this simply never fires elsewhere. No benchmark to diff against (this
  // is Leisure Care's own incident-type tagging, not an ALIS 500 metric) —
  // any count above zero is worth a flag, these are by definition the
  // highest-severity incident types in their configuration.
  if (normalized.sentinelIncidents?.hasData && normalized.sentinelIncidents.total > 0) {
    const { total, byCommunity } = normalized.sentinelIncidents;
    flags.push({
      severity: SEVERITY.RISK,
      category: 'Clinical',
      title: `${total} Sentinel-tagged incident(s) this period across ${byCommunity.length} ${byCommunity.length === 1 ? 'community' : 'communities'}`,
      detail: byCommunity.slice(0, 5).map((c) => `${c.name}: ${c.total}`).join(', '),
      talkingPoint: 'Walk through each Sentinel-tagged incident individually — these are flagged by Leisure Care\'s own incident-type configuration as the highest-severity category.',
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

  // ── HubSpot deals (live pull, independent of any health-export import) ──
  if (dealSummary && dealSummary.openDeals.length > 0) {
    flags.push({
      severity: SEVERITY.OPPORTUNITY,
      category: 'Account growth',
      title: `${dealSummary.openDeals.length} open deal(s) in HubSpot worth ${usd(dealSummary.totalOpenValue)}`,
      detail: dealSummary.openDeals.map((d) => `${d.name} — ${d.stage}${d.amount ? ` (${usd(d.amount)})` : ''}`).join('; '),
      talkingPoint: 'Surface directly in the QBR as a growth/expansion conversation.',
    });
  }

  // ── Care-level evaluation compliance (summary-level; per-resident detail
  // lives in the Levels of Care section) ──────────────────────────────────
  if (normalized.careLevelEvaluations?.hasEvaluationData && normalized.careLevelEvaluations.pctNeedsAttention != null && normalized.careLevelEvaluations.pctNeedsAttention >= 0.15) {
    flags.push({
      severity: SEVERITY.WATCH,
      category: 'Clinical',
      title: `${pct(normalized.careLevelEvaluations.pctNeedsAttention)} of care-level evaluations need attention (expired, incomplete, or 12+ months overdue)`,
      detail: `${normalized.careLevelEvaluations.needsAttention} of ${normalized.careLevelEvaluations.totalResidents} non-IL residents affected.`,
      talkingPoint: 'Review the flagged residents in the Levels of Care section — a backlog here often mirrors a staffing or workflow gap, not one-off oversights.',
    });
  }

  // ── Care-level evaluation compliance — worst individual communities ──────
  // Separate from the portfolio-wide flag above: a community can be hiding
  // behind a healthy portfolio average. `totalResidents >= 5` guards against
  // a tiny community flagging red off a single missed evaluation (1 of 2 =
  // 50%), the same false-precision concern this codebase already avoids
  // elsewhere (see companyFeatures.js / the "high-risk resident" note).
  if (normalized.careLevelEvaluations?.hasEvaluationData && normalized.careLevelEvaluations.byCommunity?.length) {
    const worst = normalized.careLevelEvaluations.byCommunity.filter(
      (c) => c.pctNeedsAttention != null && c.pctNeedsAttention >= 0.25 && c.totalResidents >= 5
    );
    if (worst.length > 0) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Clinical',
        title: `${worst.length} ${worst.length === 1 ? 'community is' : 'communities are'} well behind on resident evaluations`,
        detail: worst.slice(0, 5).map((c) => `${c.name}: ${pct(c.pctNeedsAttention)} (${c.needsAttention} of ${c.totalResidents})`).join('; '),
        talkingPoint: 'Evaluations drive level of care, which drives staffing and pricing — a community falling behind here is worth a direct follow-up, not just a portfolio-average footnote.',
      });
    }
  }

  // ── Revenue leakage (fee billed below the evaluation's own recommendation) ─
  if (normalized.careLevelEvaluations?.revenueLeakage?.affectedResidents > 0) {
    const { affectedResidents, totalMonthlyGap } = normalized.careLevelEvaluations.revenueLeakage;
    flags.push({
      severity: SEVERITY.OPPORTUNITY,
      category: 'Financial',
      // Marks this as ALIS-native billing data specifically (not the
      // separate HubSpot financial_health signals below) — lets the PPTX
      // export's billing toggle exclude precisely this, not every
      // "Financial"-category flag regardless of source.
      billingRelated: true,
      title: `${affectedResidents} resident(s) billed below their evaluation-recommended fee — ~${usd(totalMonthlyGap)}/mo potential`,
      detail: 'ALIS-computed: preOverrideFee (what the evaluation recommended) exceeds the fee actually being charged. May be a legitimate exception (family agreement, promo rate) — not automatically a mistake.',
      talkingPoint: 'Walk through the specific residents flagged in Levels of Care and confirm each override was intentional.',
    });
  }

  // ── Accounts receivable aging ────────────────────────────────────────────
  if (normalized.outstandingInvoiceSummary?.total > 0) {
    const { total, aging } = normalized.outstandingInvoiceSummary;
    const seriouslyPastDue = (aging.days61to90 || 0) + (aging.days90plus || 0);
    if (seriouslyPastDue > 0) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Financial',
        billingRelated: true,
        title: `${usd(seriouslyPastDue)} in invoices 60+ days past due (${usd(total)} total outstanding)`,
        detail: `Aging: current ${usd(aging.current)} · 1-30d ${usd(aging.days1to30)} · 31-60d ${usd(aging.days31to60)} · 61-90d ${usd(aging.days61to90)} · 90d+ ${usd(aging.days90plus)}`,
        talkingPoint: 'Confirm collection status on the oldest balances before presenting — a growing 90+ bucket is worth a billing-team check-in regardless of QBR timing.',
      });
    }
  }

  // ── HubSpot import (service/financial/relationship health) ─────────────
  // Only present once a qbr-export skill JSON has been imported for this
  // job (see server/api/qbr.js's /health-import route, which regenerates
  // flags with this included) — absent at initial job-run time.
  if (hubspotHealth) {
    const svc = hubspotHealth.service_health;
    const fin = hubspotHealth.financial_health;
    const rel = hubspotHealth.relationship_health;

    if (svc?.tickets_over_45_days?.value > 0) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Service',
        title: `${svc.tickets_over_45_days.value} HubSpot ticket(s) open past 45 days (avg open ticket age: ${svc.avg_open_ticket_age_days?.value ?? '—'} days)`,
        detail: 'From the imported account health export, not the live ALIS ticket pull above — may reflect a different point in time.',
        talkingPoint: 'Review each aged ticket and set a concrete next step or close date.',
      });
    }

    if (svc?.escalation_count_this_quarter?.value > 0) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Service',
        title: `${svc.escalation_count_this_quarter.value} escalation(s) logged this quarter`,
        detail: svc.escalation_count_this_quarter.method || '',
        talkingPoint: 'Confirm current status on each before the QBR — an open escalation shouldn\'t be a surprise in the room.',
      });
    }

    const repeatIssues = svc?.repeat_issue_flags?.value || [];
    if (repeatIssues.length > 0) {
      const top = [...repeatIssues].sort((a, b) => (b.count ?? b.occurrences ?? 0) - (a.count ?? a.occurrences ?? 0))[0];
      const label = top.category || top.pattern;
      const count = top.count ?? top.occurrences;
      flags.push({
        severity: SEVERITY.WATCH,
        category: 'Service',
        title: `"${label}" is the largest repeat-issue cluster this period (${count} tickets)`,
        detail: 'Estimated from ticket-category grouping, not confirmed root cause — a cluster can be one multi-community rollout rather than a recurring bug. Verify before presenting as a pattern.',
        talkingPoint: `Confirm whether "${label}" tickets share a root cause or are separate one-off requests that happen to share a category.`,
      });
    }

    if (fin?.rate_dispute_active?.value === true) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Financial',
        title: 'Active rate dispute flagged in HubSpot',
        detail: fin.rate_dispute_active.method || '',
        talkingPoint: 'Get current status before the QBR — a live pricing dispute needs alignment before it comes up in the room.',
      });
    }

    if (fin?.open_deals?.value?.length > 0) {
      flags.push({
        severity: SEVERITY.OPPORTUNITY,
        category: 'Account growth',
        title: `${fin.open_deals.value.length} open deal(s) in HubSpot`,
        detail: fin.open_deals.value.map((d) => d.dealname || d.name).join('; '),
        talkingPoint: 'Surface directly in the QBR as a growth/expansion conversation.',
      });
    }

    // Speculative — the qbr-export skill currently only emits a placeholder
    // note for relationship_health (no Calendar/Gmail source wired up
    // yet). These checks are no-ops today but activate automatically the
    // moment that skill starts populating real fields, per
    // HUBSPOT_BRIDGE_SCHEMA.md's proposed shape.
    if (rel?.daysSinceGrowthConversation != null && rel.daysSinceGrowthConversation >= 90) {
      flags.push({
        severity: SEVERITY.WATCH,
        category: 'Relationship',
        title: `${rel.daysSinceGrowthConversation} days since the last growth-focused conversation`,
        detail: 'Reactive/support contact doesn\'t count — this tracks purely strategic touchpoints.',
        talkingPoint: 'Worth booking a non-support-driven check-in regardless of what else is on the QBR agenda.',
      });
    }
    if (rel?.contactTurnover?.flagged) {
      flags.push({
        severity: SEVERITY.RISK,
        category: 'Relationship',
        title: `Primary contact turnover: ${rel.contactTurnover.departedContact || 'a known contact'} has departed`,
        detail: rel.contactTurnover.replacementContact ? `Replacement: ${rel.contactTurnover.replacementContact}` : 'No replacement contact identified yet.',
        talkingPoint: 'Confirm the new relationship owner on the client side before the next touchpoint.',
      });
    }
  }

  const severityOrder = { risk: 0, opportunity: 1, watch: 2, info: 3 };
  return flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

module.exports = { generateFlags, SEVERITY };
