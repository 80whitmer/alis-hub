/**
 * Server-side mirror of client/src/utils/wellnessRows.js — same 25-row /
 * 13-category list and resolution logic, duplicated here (rather than
 * shared) because the client and server are separate packages with no
 * shared-code setup in this project. Used by the PDF export route
 * (server/api/wellness.js) — keep both files in sync if the row list ever
 * changes.
 */

const WELLNESS_ROWS = [
  { category: 'Assessment & Care Planning', label: 'Quarterly evaluations due / overdue', key: 'evaluationsOverdue', source: 'rows' },
  { category: 'Assessment & Care Planning', label: 'Move-in assessments incomplete or pending', key: 'moveInAssessments', source: 'rows' },
  { category: 'Assessment & Care Planning', label: 'Care plan / service plan changes needed', key: 'carePlanChanges', source: 'manual' },
  { category: 'Assessment & Care Planning', label: 'RN delegation expired, due, or needed', key: 'rnDelegation', source: 'manual' },

  { category: 'Acute Change / Hospital', label: 'Residents currently hospitalized / in ER', key: 'hospitalCurrent', source: 'rows', hasBenchmark: true },
  { category: 'Acute Change / Hospital', label: 'New significant change in condition', key: 'changeInCondition', source: 'rows' },

  { category: 'Incidents & Safety', label: 'Falls this week', key: 'falls', source: 'rows', hasBenchmark: true, hasDocCompletion: true },
  { category: 'Incidents & Safety', label: 'Falls with injury (head) / hospital transfer', key: 'fallsWithInjury', source: 'manual' },
  { category: 'Incidents & Safety', label: 'Other major incidents or safety concerns', key: 'otherIncidents', source: 'rows', hasDocCompletion: true },

  { category: 'Medication Management', label: 'Medication exceptions / late or missed medications', key: 'medicationExceptions', source: 'rows' },
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
  { category: 'Staffing & Training', label: 'Required clinical training / competency gaps', key: 'staffTrainingGaps', source: 'rows', staffScoped: true },

  { category: 'Systems & Documentation', label: 'Care tracking / charting incomplete or overdue', key: 'careTracking', source: 'manual' },
  { category: 'Systems & Documentation', label: 'Pull-cord response exceptions / delayed responses', key: 'pullCord', source: 'manual' },

  { category: 'Compliance', label: 'Regulatory, ALIS, licensing, or survey-readiness concern', key: 'complianceReadiness', source: 'manual' },
  { category: 'Compliance', label: 'Reportable incident / required notification pending', key: 'reportableIncident', source: 'manual' },
];

const NOT_TRACKED = '— not tracked in ALIS';

function resolveWellnessRow(row, snapshot, communityId) {
  if (row.source === 'manual') {
    return { al: NOT_TRACKED, mc: NOT_TRACKED, total: NOT_TRACKED, prior: '', trend: '' };
  }

  const data = snapshot.rows?.[row.key];
  if (!data) return { al: NOT_TRACKED, mc: NOT_TRACKED, total: NOT_TRACKED, prior: '', trend: '' };

  if (row.staffScoped) {
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    return { al: '—', mc: '—', total: bucket?.total ?? 0, prior: '', trend: '' };
  }

  if (row.noTrend) {
    const bucket = communityId ? data.byCommunity?.[communityId] : data.portfolio;
    return { al: '—', mc: '—', total: bucket?.pct != null ? `${Math.round(bucket.pct * 100)}% active` : '—', prior: '', trend: '' };
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
  };
}

module.exports = { WELLNESS_ROWS, resolveWellnessRow, NOT_TRACKED };
