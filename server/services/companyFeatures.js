/**
 * Per-company reporting toggles for features that only make sense for one
 * client's own configuration, not the platform generally — currently just
 * Sentinel-incident tracking (Leisure Care tags specific high-severity
 * incident-type variants with "(Sentinel)" in ALIS's own incident-type
 * config; no other client's incident-type list uses this convention, per
 * Aaron, Sep 2026).
 *
 * Matched by companyName substring (case-insensitive) rather than a
 * HubSpot company ID — every job (kpi-export, wellness-scorecard) already
 * carries companyName in its payload, so this needs no extra lookup. If a
 * second per-company flag shows up, revisit whether a name match is still
 * sturdy enough or whether this should key off company_hosts/hubspotCompanyId
 * instead.
 */

function isSentinelIncidentTrackingEnabled(companyName) {
  return (companyName || '').toLowerCase().includes('leisure care');
}

module.exports = { isSentinelIncidentTrackingEnabled };
