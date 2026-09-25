/**
 * The 26-row / 13-category structure of the Weekly Wellness Scorecard —
 * mirrors Imagine Senior Living's own "Weekly Wellness Report" sheet
 * exactly (same category/row order) so the exported workbook and on-screen
 * table both look like a digitized version of the document they already
 * work with, not a redesign.
 *
 * `source: 'rows'` means the value comes from the snapshot's computed
 * `rows[key]` (see server/services/wellnessNormalizer.js) and gets a real
 * count + trend arrow. `source: 'manual'` means it comes from
 * `manualRows[key]`, which is always `null` today — ALIS doesn't expose
 * (or we haven't verified) a reliable source for it, so it renders as
 * "— not tracked in ALIS" rather than a fabricated zero.
 */
export const WELLNESS_ROWS = [
  { category: 'Assessment & Care Planning', label: 'Average CarePoints (acuity) per current evaluation', key: 'carePointsAvg', source: 'rows', isAcuityScore: true },
  { category: 'Assessment & Care Planning', label: 'Quarterly evaluations due / overdue', key: 'evaluationsOverdue', source: 'rows' },
  { category: 'Assessment & Care Planning', label: 'Move-in assessments incomplete or pending', key: 'moveInAssessments', source: 'rows', note: 'Residents who moved in within the last 30 days whose initial assessment is either missing or still in progress (not yet completed/signed). Excludes residents who moved in longer ago, and excludes stays with no move-in date on record.' },
  { category: 'Assessment & Care Planning', label: 'Residents with evaluations needing attention', key: 'evaluationsNeedingAttention', source: 'rows', note: 'Non-Independent-Living residents whose current evaluation is expired, still in progress, more than a year old, or doesn’t exist at all — same "needs attention" definition as the QBR Levels of Care section.' },
  { category: 'Assessment & Care Planning', label: 'Care plan / service plan changes needed', key: 'carePlanChanges', source: 'manual' },
  { category: 'Assessment & Care Planning', label: 'RN delegation expired, due, or needed', key: 'rnDelegation', source: 'manual' },

  { category: 'Acute Change / Hospital', label: 'Residents currently hospitalized / in ER', key: 'hospitalCurrent', source: 'rows', hasBenchmark: true, hasResidentDrawer: true },
  { category: 'Acute Change / Hospital', label: 'New significant change in condition', key: 'changeInCondition', source: 'rows', hasResidentDrawer: true },

  { category: 'Incidents & Safety', label: 'Falls this week', key: 'falls', source: 'rows', hasBenchmark: true, hasDocCompletion: true },
  { category: 'Incidents & Safety', label: 'Falls with injury (head) / hospital transfer', key: 'fallsWithInjury', source: 'rows', note: 'Hospital-transfer half only — read from the completed Incident Report Form; no separate "head injury" field exists to compute the other half.' },
  { category: 'Incidents & Safety', label: 'Other major incidents or safety concerns', key: 'otherIncidents', source: 'rows', hasDocCompletion: true },
  { category: 'Incidents & Safety', label: 'Sentinel-tagged incidents', key: 'sentinelIncidents', source: 'rows', hasDocCompletion: true, requiresFlag: 'sentinelIncidentTracking', note: 'Leisure Care only — matches ALIS incident types tagged "Sentinel" in their own incident-type configuration.' },

  { category: 'Medication Management', label: 'Medication exceptions / late or missed medications', key: 'medicationExceptions', source: 'rows' },
  { category: 'Medication Management', label: 'MAR compliance (scheduled, non-PRN doses recorded)', key: 'marCompliance', source: 'rows', hasCompliancePct: true, note: 'Scheduled (non-PRN) medication administration records from ALIS’s MAR export. Compliance % = (scheduled − not recorded) ÷ scheduled. PRN orders are excluded — an un-recorded PRN just means it wasn’t needed, not a missed dose.' },
  { category: 'Medication Management', label: 'Pharmacy, MAR, narcotic, or reconciliation concerns', key: 'pharmacyNarcotic', source: 'manual' },

  { category: 'Skin / Nutrition', label: 'Skin, wound, pressure injury concerns', key: 'skinWound', source: 'manual' },
  { category: 'Skin / Nutrition', label: 'Weight loss, dehydration, or poor intake concerns', key: 'weightLoss', source: 'manual' },

  { category: 'Infection Control', label: 'New infections / outbreaks / isolation concerns', key: 'infectionControl', source: 'manual' },

  { category: 'Behavioral Health', label: 'Behavior escalation / psychiatric concerns', key: 'behavioral', source: 'rows', hasDocCompletion: true },
  { category: 'Behavioral Health', label: 'Elopement, aggression, or high supervision risk', key: 'elopement', source: 'rows', hasDocCompletion: true },

  { category: 'High-Risk Monitoring', label: 'Residents currently classified high risk', key: 'highRiskResidents', source: 'manual' },
  { category: 'High-Risk Monitoring', label: 'Residents requiring continuous / 1:1 care', key: 'continuousCareResidents', source: 'manual' },

  { category: 'Family / Resident Experience', label: 'Open family complaints or unresolved concerns', key: 'familyComplaints', source: 'manual' },

  { category: 'Staffing & Training', label: 'Staffing indicators affecting resident care', key: 'staffing', source: 'rows', noTrend: true },
  { category: 'Staffing & Training', label: 'Medication security roles active', key: 'medicationStaffing', source: 'rows', noTrend: true, note: 'Staff with a "Medication"- or "Pharmacy"-named ALIS security role (e.g. Medication Tech, Pharmacy Administrator, Pharmacy Tech), plus Nurse and Health & Wellness Director roles, who logged into ALIS in the last 7 days — as a % of all enabled staff holding one of those roles.' },
  { category: 'Staffing & Training', label: 'Caregiver security roles active', key: 'caregiverStaffing', source: 'rows', noTrend: true, note: 'Staff with a "Caregiver"-named ALIS security role (e.g. Caregiver, Caregiver - plus eval), plus Nurse and Health & Wellness Director roles, who logged into ALIS in the last 7 days — as a % of all enabled staff holding one of those roles.' },
  { category: 'Staffing & Training', label: 'Required clinical training / competency gaps', key: 'staffTrainingGaps', source: 'rows', staffScoped: true, note: 'Incomplete or expired required staff compliance items (trainings, certifications, etc.) from ALIS’s staff compliance module. Counts each outstanding item, not each staff member — one person with 3 overdue items counts as 3. Reflects the current state of all records, not just new gaps from this week.' },

  { category: 'Systems & Documentation', label: 'Care tracking / charting incomplete or overdue', key: 'careTracking', source: 'manual' },
  { category: 'Systems & Documentation', label: 'Pull-cord response exceptions / delayed responses', key: 'pullCord', source: 'manual' },

  { category: 'Compliance', label: 'Regulatory, ALIS, licensing, or survey-readiness concern', key: 'complianceReadiness', source: 'manual' },
  { category: 'Compliance', label: 'Reportable incident / required notification pending', key: 'reportableIncident', source: 'manual' },

  { category: 'Predictive Risk Indicators', label: 'Residents with declining activity engagement (early risk flag)', key: 'activityPatternRisk', source: 'rows', hasResidentDrawer: true, note: "Inferred from a drop in Activities-category care logging vs. each resident's own recent baseline — a prompt for a wellness check, not a diagnosis. Residents without enough logging history aren't counted either way. Needs several weeks of history to build a baseline after this feature is first enabled." },
];

// Neutral framing (Sep 2026, Aaron: "'not tracked in ALIS' feels like a
// shortcoming of ALIS, I just want to emphasize that there is no data") —
// this scorecard is still in development, so a blank row just means that
// signal hasn't been built/populated yet, not that ALIS itself is lacking.
const NOT_TRACKED = '— No data available';

/**
 * Resolves one row's display values for a given scope (the snapshot's
 * portfolio totals, or one community's `byCommunity`/`byCommunityTrend`
 * entry) — same shape for both, so the table/export can call this once per
 * row per scope without knowing which.
 */
export function resolveWellnessRow(row, snapshot, communityId) {
  if (row.source === 'manual') {
    return { al: NOT_TRACKED, mc: NOT_TRACKED, total: NOT_TRACKED, prior: '', trend: '' };
  }

  const data = snapshot.rows?.[row.key];
  if (!data) return { al: NOT_TRACKED, mc: NOT_TRACKED, total: NOT_TRACKED, prior: '', trend: '' };

  // Staff training gaps has no AL/MC split (staff aren't AL or MC) and no
  // trend in this MVP (see wellnessNormalizer.js's groupStaffByCommunity).
  if (row.staffScoped) {
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    return { al: '—', mc: '—', total: bucket?.total ?? 0, prior: '', trend: '' };
  }

  // CarePoints average — real ALIS acuity-scoring data (see
  // wellnessNormalizer.js's normalizeCarePointsAverage), reported as a
  // number + sample size rather than a count, and deliberately not
  // translated into a "high/medium/low risk" label (see the manual
  // highRiskResidents row above for why that threshold call is left to the
  // Wellness Director).
  if (row.isAcuityScore) {
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    const trendBucket = communityId ? data.byCommunityTrend?.[communityId] : data.portfolioTrend;
    const fmt = (b) => (b?.avg != null ? `${b.avg.toFixed(1)} (n=${b.count})` : '—');
    return {
      al: fmt(bucket?.AL),
      mc: fmt(bucket?.MC),
      total: fmt(bucket?.total),
      prior: trendBucket?.prior != null ? trendBucket.prior.toFixed(1) : '—',
      trend: trendBucket?.trend ?? '—',
    };
  }

  if (row.noTrend) {
    // Staffing: report the activity % for this scope, no trend arrow.
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    return {
      al: '—',
      mc: '—',
      total: bucket?.pct != null ? `${Math.round(bucket.pct * 100)}% active` : '—',
      prior: '',
      trend: '',
    };
  }

  // MAR compliance — a % (not a raw count like the rest of these rows),
  // trended on compliancePct rather than the underlying not-recorded count.
  // See server/services/wellnessNormalizer.js's normalizeMarCompliance /
  // withMarComplianceTrend for where scheduledTotal/compliancePct and the
  // pct trend buckets come from.
  if (row.hasCompliancePct) {
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    const pctTrendBucket = communityId ? data.byCommunityCompliancePctTrend?.[communityId] : data.portfolioCompliancePctTrend;
    const fmt = (b) => (b?.scheduledTotal ? `${Math.round(b.compliancePct * 100)}% (${b.total} not recorded / ${b.scheduledTotal} scheduled)` : '— No scheduled doses this week');
    return {
      al: '—',
      mc: '—',
      total: fmt(bucket),
      prior: pctTrendBucket?.prior != null ? `${Math.round(pctTrendBucket.prior * 100)}%` : '—',
      trend: pctTrendBucket?.trend ?? '—',
    };
  }

  const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
  const trendBucket = communityId ? data.byCommunityTrend?.[communityId] : data.portfolioTrend;
  // openDocs has no trend of its own (a "this week" catch-up count, not
  // tracked week-over-week) — see wellnessNormalizer.js's withOpenDocs.
  const openDocsBucket = row.hasDocCompletion
    ? (communityId ? data.openDocs?.byCommunity?.[communityId] : data.openDocs?.portfolio)
    : null;
  return {
    al: bucket?.AL ?? 0,
    mc: bucket?.MC ?? 0,
    total: bucket?.total ?? 0,
    prior: trendBucket?.prior ?? '—',
    trend: trendBucket?.trend ?? '—',
    openDocsTotal: openDocsBucket?.total ?? 0,
    openDocsReporters: openDocsBucket?.reporters ?? [],
    items: row.hasResidentDrawer ? (bucket?.items ?? []) : undefined,
  };
}

/**
 * WELLNESS_ROWS filtered to what this snapshot's company should actually
 * see — a row carrying `requiresFlag` (e.g. Sentinel Incidents, Leisure
 * Care-only per companyFeatures.js server-side) only shows when
 * `snapshot.featureFlags[requiresFlag]` is true; every other row is
 * unaffected. Shared by both WellnessScorecard.jsx's on-screen table and
 * wellnessScorecardExport.js's Excel export so the two can never drift.
 */
function getVisibleWellnessRows(snapshot) {
  return WELLNESS_ROWS.filter((row) => !row.requiresFlag || snapshot?.featureFlags?.[row.requiresFlag]);
}

export { NOT_TRACKED, getVisibleWellnessRows };
