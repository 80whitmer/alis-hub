# HubSpot/CRM Bridge Schema — for the account-health skill project

This is the contract for a stopgap: a Claude Code skill that researches one
account's Service, Financial, and Relationship health (Sections 2–4 of the
"ALIS Account Manager Quarterly Dashboard" framework) via HubSpot/Jira/Gmail/
Calendar, and emits JSON in this shape. alis-hub's kpi-export pipeline
already covers Section 1 (Product Health) straight from the ALIS API — this
schema deliberately does **not** duplicate any of that (occupancy,
admissions, evaluations, falls, etc. stay owned by `kpiExport.js`).

**Why a formal contract matters here:** alis-hub's ingestion code only needs
to read this shape — it doesn't need to know whether a Claude skill produced
it today or a real HubSpot API integration produces it later. Keep this
schema stable and the producer is swappable.

## Hard counts vs. synthesized judgment calls

Most fields below are things a skill can look up and count. A few require
the skill to *classify*, not just query — those are marked
**(synthesized)** and won't be perfectly reproducible run-to-run. That's an
acceptable tradeoff for a bridge, but don't feed those specific fields into
anything leadership-facing without that caveat attached.

- **(synthesized)** `serviceHealth.repeatIssues` — requires grouping tickets by root cause, not just ticket category
- **(synthesized)** `relationshipHealth.daysSinceGrowthConversation` — requires classifying a meeting/thread's *purpose*, not just its existence
- **(synthesized)** `relationshipHealth.contactTurnover` — requires noticing a departure from notes/threads, not a structured field anywhere

Everything else is a direct count, sum, or date pulled from a specific
system of record.

## Design decisions worth calling out

- **No composite score in this payload.** Section 5 of the framework (the
  weighted health score) is a *reporting* decision — weights differ by
  account tier and leadership may want to retune them without re-running
  the skill. That belongs in alis-hub's display layer, computed from the
  raw signals here, not baked into the JSON by the skill.
- **`notes[]` is an escape valve.** When the skill can't cleanly fill a
  field (API limit, ambiguous data, nothing found), it should say so in
  plain text here rather than guessing or omitting silently.
- **Money in cents (integers).** Avoids floating-point drift on totals;
  divide by 100 to display.
- **Everything nullable except identity/metadata.** A field the skill
  genuinely couldn't determine should be `null`, not `0` or omitted — `0`
  must mean "checked, found zero," not "didn't check."

---

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AlisAccountHealthBridge",
  "description": "One account's Service/Financial/Relationship health snapshot for one reporting period, produced by a Claude skill as a stopgap until a native HubSpot integration exists.",
  "type": "object",
  "required": ["schemaVersion", "companyName", "periodStart", "periodEnd", "generatedAt", "serviceHealth", "financialHealth", "relationshipHealth"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "companyName": { "type": "string", "description": "Must match the companyName used in the corresponding alis-hub kpi-export job, so the two can be joined." },
    "hubspotCompanyId": { "type": ["string", "null"], "description": "HubSpot CRM object ID, if the account is linked there." },
    "periodStart": { "type": "string", "format": "date", "description": "YYYY-MM-DD — should match the kpi-export job's periodStart." },
    "periodEnd": { "type": "string", "format": "date" },
    "generatedAt": { "type": "string", "format": "date-time", "description": "When the skill produced this payload — not the same as periodEnd." },
    "notes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Free-text caveats the skill wants surfaced — API limits hit, ambiguous data, fields it couldn't confidently fill."
    },

    "serviceHealth": {
      "type": "object",
      "description": "Section 2 — Service & Support Health.",
      "required": ["openTicketsByStage", "avgTicketAgeDays", "agedTickets", "escalationCount", "ticketCategoryMix", "repeatIssues", "slaAdherencePct"],
      "properties": {
        "openTicketsByStage": {
          "type": "array",
          "description": "Every open ticket, bucketed by pipeline stage.",
          "items": {
            "type": "object",
            "required": ["stage", "count"],
            "properties": {
              "stage": { "type": "string", "examples": ["Client Submitted", "In Progress", "Waiting on Client"] },
              "count": { "type": "integer", "minimum": 0 }
            }
          }
        },
        "avgTicketAgeDays": { "type": ["number", "null"], "description": "Average age in days across all currently-open tickets." },
        "agedTickets": {
          "type": "array",
          "description": "Tickets open past the 30-45 day threshold — the ones that should visually scream on the dashboard.",
          "items": {
            "type": "object",
            "required": ["ticketId", "subject", "ageDays", "stage"],
            "properties": {
              "ticketId": { "type": "string" },
              "subject": { "type": "string" },
              "ageDays": { "type": "integer", "minimum": 0 },
              "stage": { "type": "string" },
              "url": { "type": ["string", "null"], "format": "uri" }
            }
          }
        },
        "escalationCount": { "type": "integer", "minimum": 0, "description": "Count of Jira ESC tickets tied to this account, this period." },
        "escalations": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["jiraKey", "summary"],
            "properties": {
              "jiraKey": { "type": "string", "examples": ["ESC-482"] },
              "summary": { "type": "string" },
              "status": { "type": "string" },
              "url": { "type": ["string", "null"], "format": "uri" }
            }
          }
        },
        "ticketCategoryMix": {
          "type": "object",
          "description": "Raw counts, not percentages — let the consumer compute share of total.",
          "required": ["bug", "enhancement", "billingOrAdmin", "other"],
          "properties": {
            "bug": { "type": "integer", "minimum": 0 },
            "enhancement": { "type": "integer", "minimum": 0 },
            "billingOrAdmin": { "type": "integer", "minimum": 0 },
            "other": { "type": "integer", "minimum": 0 }
          }
        },
        "repeatIssues": {
          "type": "array",
          "description": "(synthesized) Same root cause appearing across 2+ tickets this period.",
          "items": {
            "type": "object",
            "required": ["pattern", "occurrences", "ticketIds"],
            "properties": {
              "pattern": { "type": "string", "examples": ["Physician mislabeled as pharmacy contact on new admissions"] },
              "occurrences": { "type": "integer", "minimum": 2 },
              "ticketIds": { "type": "array", "items": { "type": "string" } }
            }
          }
        },
        "slaAdherencePct": { "type": ["number", "null"], "minimum": 0, "maximum": 1, "description": "Fraction of tickets closed within their committed due date, this period." }
      }
    },

    "financialHealth": {
      "type": "object",
      "description": "Section 3 — Financial & Contract Health. All money in cents.",
      "required": ["unbilledAddendumBacklog", "renewal", "rateDispute", "splitPayAddendumCompletion", "expansionPipeline"],
      "properties": {
        "unbilledAddendumBacklog": {
          "type": "object",
          "required": ["count", "totalValueCents"],
          "properties": {
            "count": { "type": "integer", "minimum": 0 },
            "totalValueCents": { "type": "integer", "minimum": 0 },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["description", "valueCents", "ageDays"],
                "properties": {
                  "description": { "type": "string" },
                  "valueCents": { "type": "integer", "minimum": 0 },
                  "ageDays": { "type": "integer", "minimum": 0 }
                }
              }
            }
          }
        },
        "renewal": {
          "type": "object",
          "required": ["contractEndDate", "daysToRenewal"],
          "properties": {
            "contractEndDate": { "type": ["string", "null"], "format": "date" },
            "daysToRenewal": { "type": ["integer", "null"] }
          }
        },
        "rateDispute": {
          "type": "object",
          "required": ["status"],
          "properties": {
            "status": { "type": "string", "enum": ["none", "open", "resolved"] },
            "description": { "type": ["string", "null"] },
            "openedDate": { "type": ["string", "null"], "format": "date" }
          }
        },
        "splitPayAddendumCompletion": {
          "type": "object",
          "required": ["completedCount", "totalCount"],
          "properties": {
            "completedCount": { "type": "integer", "minimum": 0 },
            "totalCount": { "type": "integer", "minimum": 0 }
          }
        },
        "expansionPipeline": {
          "type": "object",
          "required": ["openDealsCount", "totalPipelineValueCents"],
          "properties": {
            "openDealsCount": { "type": "integer", "minimum": 0 },
            "totalPipelineValueCents": { "type": "integer", "minimum": 0 },
            "deals": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["name", "stage", "valueCents"],
                "properties": {
                  "name": { "type": "string" },
                  "stage": { "type": "string" },
                  "valueCents": { "type": "integer", "minimum": 0 },
                  "expectedCloseDate": { "type": ["string", "null"], "format": "date" }
                }
              }
            }
          }
        }
      }
    },

    "relationshipHealth": {
      "type": "object",
      "description": "Section 4 — Relationship & Engagement Health.",
      "required": ["daysSinceGrowthConversation", "qbrCadence", "contactTurnover", "responseLatency"],
      "properties": {
        "daysSinceGrowthConversation": {
          "type": ["integer", "null"],
          "description": "(synthesized) Days since a meeting/thread classified as growth-focused rather than reactive/support."
        },
        "qbrCadence": {
          "type": "object",
          "required": ["lastQbrDate", "nextScheduledQbrDate", "adherence"],
          "properties": {
            "lastQbrDate": { "type": ["string", "null"], "format": "date" },
            "nextScheduledQbrDate": { "type": ["string", "null"], "format": "date" },
            "adherence": { "type": "string", "enum": ["onTrack", "overdue", "noneScheduled"] }
          }
        },
        "contactTurnover": {
          "type": "object",
          "description": "(synthesized)",
          "required": ["flagged"],
          "properties": {
            "flagged": { "type": "boolean" },
            "departedContact": { "type": ["string", "null"] },
            "departureDate": { "type": ["string", "null"], "format": "date" },
            "replacementContact": { "type": ["string", "null"] }
          }
        },
        "responseLatency": {
          "type": "object",
          "required": ["avgResponseHours", "sampledThreadCount"],
          "properties": {
            "avgResponseHours": { "type": ["number", "null"] },
            "sampledThreadCount": { "type": "integer", "minimum": 0, "description": "How many client-initiated threads this average is based on — small samples should be flagged in notes[], not hidden." }
          }
        }
      }
    }
  }
}
```

## Example instance

```json
{
  "schemaVersion": "1.0.0",
  "companyName": "Hearth and Truss",
  "hubspotCompanyId": "10519597951",
  "periodStart": "2026-04-01",
  "periodEnd": "2026-06-30",
  "generatedAt": "2026-08-22T20:15:00Z",
  "notes": [
    "responseLatency sampled from only 4 client-initiated threads this period — treat as low-confidence.",
    "No Jira ESC tickets found tagged to this account; escalationCount may undercount if tagging is inconsistent."
  ],
  "serviceHealth": {
    "openTicketsByStage": [
      { "stage": "Client Submitted", "count": 3 },
      { "stage": "In Progress", "count": 5 }
    ],
    "avgTicketAgeDays": 22.4,
    "agedTickets": [
      { "ticketId": "48213", "subject": "Med pass export missing PRN flag", "ageDays": 118, "stage": "In Progress", "url": null }
    ],
    "escalationCount": 0,
    "escalations": [],
    "ticketCategoryMix": { "bug": 4, "enhancement": 2, "billingOrAdmin": 1, "other": 1 },
    "repeatIssues": [
      { "pattern": "Physician mislabeled as pharmacy contact on new admissions", "occurrences": 3, "ticketIds": ["48090", "48155", "48213"] }
    ],
    "slaAdherencePct": 0.72
  },
  "financialHealth": {
    "unbilledAddendumBacklog": { "count": 2, "totalValueCents": 480000, "items": [
      { "description": "Split-pay addendum — Skylark", "valueCents": 240000, "ageDays": 61 },
      { "description": "Rate increase signature — Tabor Crest II", "valueCents": 240000, "ageDays": 34 }
    ]},
    "renewal": { "contractEndDate": "2027-01-15", "daysToRenewal": 168 },
    "rateDispute": { "status": "none", "description": null, "openedDate": null },
    "splitPayAddendumCompletion": { "completedCount": 6, "totalCount": 8 },
    "expansionPipeline": { "openDealsCount": 1, "totalPipelineValueCents": 1500000, "deals": [
      { "name": "New community — Hearth and Truss North", "stage": "Discovery", "valueCents": 1500000, "expectedCloseDate": "2026-11-01" }
    ]}
  },
  "relationshipHealth": {
    "daysSinceGrowthConversation": 94,
    "qbrCadence": { "lastQbrDate": "2026-05-12", "nextScheduledQbrDate": null, "adherence": "overdue" },
    "contactTurnover": { "flagged": false, "departedContact": null, "departureDate": null, "replacementContact": null },
    "responseLatency": { "avgResponseHours": 14.2, "sampledThreadCount": 4 }
  }
}
```

## Wins & Kudos (`wins_kudos`) — added Sept 2026

A new top-level array, sibling to `serviceHealth`/`financialHealth`/`relationshipHealth`: client/prospect
quotes and testimonial-style signal worth surfacing on the dashboard and in
the QBR deck (renewals, references, reminding the team why an account
matters) — not otherwise captured anywhere structured today.

**Naming note:** this field (and alis-hub's consumption of it) uses
snake_case — `wins_kudos`, `quote`, `attribution` — matching the skill's
*actual* current output shape (see `reproduce_payload.json`, which already
uses `meta`/`service_health`/etc., not this doc's original camelCase), not
the rest of this file's documented-but-stale camelCase convention. That
pre-existing drift is a separate cleanup worth reconciling with whoever
owns the skill; this addition just follows the real shape rather than
compounding the mismatch.

```json
"wins_kudos": [
  {
    "quote": "What sets us apart is your team's responsiveness and warmth.",
    "attribution": "Prospect, FWD 2026",
    "context": "Said during a hallway conversation after the Lights Over the Lake event",
    "date": "2026-08-14",
    "type": "prospect_quote",
    "source": "HubSpot note",
    "confidence": "high"
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `quote` | string | The actual words, verbatim where captured. Don't fabricate to fill the section. |
| `attribution` | string | Who said it (name/role), or an anonymized descriptor if a name isn't capturable (e.g. "Prospect at FWD 2026"). |
| `context` | string, nullable | What prompted it. If `quote` is a paraphrase rather than verbatim, say so here. |
| `date` | string (date) | `YYYY-MM-DD`. |
| `type` | enum | `client_quote` \| `prospect_quote` \| `reference_offer` \| `superfan_signal` \| `other`. |
| `source` | string, nullable | e.g. `"HubSpot note"`, `"Gmail"`, `"Calendar"`, `"manual"`. |
| `confidence` | enum | `high` \| `medium` \| `low` — `medium`/`low` when paraphrasing rather than quoting directly, same convention as this schema's other synthesized fields. |

Emit `wins_kudos: []` when nothing is found this period, rather than
omitting the field — same convention as every other section of this
schema.
