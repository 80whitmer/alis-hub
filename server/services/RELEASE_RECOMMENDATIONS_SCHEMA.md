# Release Recommendations Bridge Schema — for the release-recommendations Claude Project

This is the contract for a second bridge, alongside [HUBSPOT_BRIDGE_SCHEMA.md](HUBSPOT_BRIDGE_SCHEMA.md): a Claude Project that curates recent ALIS platform release notes down to the handful most relevant to one specific account, and emits JSON in this shape for alis-hub's `kpi-export` pipeline to render as a "Recent ALIS Platform Releases" slide. See [RELEASE_RECOMMENDATIONS_PROJECT_BRIEF.md](RELEASE_RECOMMENDATIONS_PROJECT_BRIEF.md) for the brief meant to go directly into that Project's instructions.

alis-hub owns nothing about release notes itself — it only knows how to render this shape. Keep the schema stable and the producer (this Project today, maybe a direct support.alisonline.com feed later) stays swappable.

## Design decisions worth calling out

- **Same import mechanics as the HubSpot health bridge** — paste-at-job-creation-time (`pendingReleaseImport` on the `kpi-export` payload) or import-after-the-fact from the QBR dashboard (`POST /api/qbr/:jobId/release-import`). See `kpiExport.js` and `server/api/qbr.js`.
- **`account.name` is a soft match, not a hard block.** Same rationale as the health bridge — display names drift between systems, so a mismatch surfaces as a warning banner, not a rejected import.
- **The slide caps at 6 releases** (`qbrExport.js`'s `addReleaseRecommendationsSlide`) — matches the real Leisure Care QBR deck's row layout. The JSON can hold more; only the first 6 render. Put the most relevant ones first.
- **`description` is where the account-specific relevance lives, in prose, not a separate field.** The real deck's pattern is one flowing sentence: what changed, then an em-dash, then why it matters to *this* account specifically (a named contact, an open ticket, a raised pain point). Don't split "what changed" and "why it matters" into separate fields — the slide renders `description` as a single block of body text.
- **No severity/priority field.** Order in the array IS the priority — most relevant first. A separate ranking field would just be redundant with array order and could drift out of sync with it.

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AlisReleaseRecommendationsBridge",
  "description": "A curated subset of recent ALIS platform releases, ranked and annotated for relevance to one specific account, produced by the release-recommendations Claude Project.",
  "type": "object",
  "required": ["meta", "releases"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["schema_version", "generated_at", "release_range"],
      "properties": {
        "schema_version": { "type": "string", "const": "1.0" },
        "generated_by": { "type": "string", "examples": ["release-recommendations Claude Project"] },
        "generated_at": { "type": "string", "format": "date-time", "description": "When this curation was produced — not the same as the release dates it covers." },
        "release_range": { "type": "string", "description": "Version range covered, as shown on the slide subtitle.", "examples": ["26.7.5.0 – 26.8.3.0"] },
        "period_label": { "type": ["string", "null"], "description": "Human cadence/date-range label for the slide subtitle.", "examples": ["Weekly releases, July 29 – Aug 19, 2026"] },
        "release_notes_url": { "type": ["string", "null"], "format": "uri", "description": "Link to the full release notes, shown as a footer line on the slide." }
      }
    },
    "account": {
      "type": ["object", "null"],
      "description": "Optional — used only for the soft company-name-mismatch check on import. Omit if the Project doesn't know the alis-hub company name.",
      "properties": {
        "name": { "type": "string", "description": "Must match the companyName used in the corresponding alis-hub kpi-export job for the mismatch check to have anything to compare against." }
      }
    },
    "releases": {
      "type": "array",
      "description": "Ordered most-relevant-first. Only the first 6 render on the slide — put anything that must appear within that range.",
      "items": {
        "type": "object",
        "required": ["title", "description"],
        "properties": {
          "title": { "type": "string", "description": "Short feature/release name — renders bold, in the brand accent color, on the left of its row.", "examples": ["Resident Monitoring Center pre-filter"] },
          "description": { "type": "string", "description": "One flowing sentence: what changed, then why it matters to this specific account (a named contact, an open ticket, a pain point raised in a call) — see the design note above. Renders as body text on the right of its row." }
        }
      }
    }
  }
}
```

## Example instance

```json
{
  "meta": {
    "schema_version": "1.0",
    "generated_by": "release-recommendations Claude Project",
    "generated_at": "2026-08-22T20:00:00Z",
    "release_range": "26.7.5.0 – 26.8.3.0",
    "period_label": "Weekly releases, July 29 – Aug 19, 2026",
    "release_notes_url": "https://support.alisonline.com/release-26.7.5.0-26.8.3.0"
  },
  "account": { "name": "Leisure Care" },
  "releases": [
    {
      "title": "Resident Monitoring Center pre-filter",
      "description": "The \"view all active monitoring events\" link now opens pre-filtered to that resident instead of the whole community — directly addresses the monitoring-task workflow friction Katie Smith raised on the Aug 19 incident sync."
    },
    {
      "title": "Custom Resident Tags",
      "description": "Company-defined resident identifiers (e.g. fall risk, elopement risk) now configurable and visible across Resident Roster, Med Pass, Evaluation Center, and Care Tracking — relevant to the open elopement/pressure-ulcer reporting questions."
    },
    {
      "title": "Schedule Leave: Multiple Leave Destinations",
      "description": "Now default-enabled for all communities — captures a full leave journey (e.g. hospital → rehab → return) as connected events. Pairs with the Hospital & SNF Leaves dashboard."
    }
  ]
}
```
