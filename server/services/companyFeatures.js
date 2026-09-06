/**
 * Per-company reporting toggles for features that only make sense for one
 * client's own configuration, not the platform generally — currently just
 * Sentinel-incident tracking (Leisure Care tags specific high-severity
 * incident-type variants with "(Sentinel)" in ALIS's own incident-type
 * config).
 *
 * Two independent signals, either one enables it:
 *   1. companyName substring match ("leisure care") — the original,
 *      always-on gate, no data dependency at all.
 *   2. Data-driven: confirmed live (Sep 2026) that the "(Sentinel)" tag is
 *      baked directly into the incident TYPE's display name in ALIS's own
 *      Settings > Incident Settings config (e.g. "Elopement (Sentinel)")
 *      — the exact same string every pulled incident record's
 *      `incidentType` field already carries. So rather than scraping that
 *      settings page separately, checking the incidents this job already
 *      pulls for ANY row with "sentinel" in incidentType is the same
 *      signal with no new API/page-scrape call — and it generalizes to
 *      any future client that adopts a similar tagging convention, not
 *      just Leisure Care by name. Known gap: a brand-new account with
 *      Sentinel types CONFIGURED but never yet used in a real incident
 *      wouldn't be caught by this signal alone — the name-match above is
 *      the fallback for exactly that case.
 */

function isSentinelIncidentTrackingEnabled(companyName) {
  return (companyName || '').toLowerCase().includes('leisure care');
}

function hasSentinelIncidentTypes(incidents = []) {
  return incidents.some((r) => (r.incidentType || '').toString().toLowerCase().includes('sentinel'));
}

function shouldTrackSentinelIncidents(companyName, incidents) {
  return isSentinelIncidentTrackingEnabled(companyName) || hasSentinelIncidentTypes(incidents);
}

module.exports = { isSentinelIncidentTrackingEnabled, hasSentinelIncidentTypes, shouldTrackSentinelIncidents };
