# Bulk Update Care Item Settings — Implementation Notes

## What this is

Template `care-item-assistance-level` (`jobs.js` → `runCareItemAssistanceLevelJob`,
`playwright/carePage.js`) bulk-edits a Care Item's **Assistance Level** field across
communities — the "Two Staff" items example (`Ambulation - Two Staff Assistance`,
`Bathing - Two Staff Assistance 1x Per Week`, etc.) → **Total 2x Staff**.

## Why it reuses residentSettingsPage.js

Care Items (`Settings/Care/{communityId}?tab=Care`) are rendered by the same
`data-sort-item-identifier` row + `#paneWrap` AJAX edit-pane component already
confirmed live for Resident Settings' compliance items — same row lookup, same
`.js-dropdown-trigger` → "Edit" click, same `#paneWrap #Name` load wait, same
`.mt-pane-close` to dismiss. `carePage.js` imports `complianceItemRowByName`,
`openComplianceItemPane`, and `closeComplianceItemPane` from
`residentSettingsPage.js` rather than re-deriving them.

## What's NOT yet confirmed live

The exact `id` of the **Assistance Level** `<select>` inside the pane.
`readAssistanceLevelField()` in `carePage.js` locates it by its visible label
text (`/assistance\s*level/i`) rather than a hardcoded id, matching the same
label-resolution approach `residentSettingsPage.js` already uses elsewhere on
this page family. It should work as-is, but **test on one item on one
community first**:

1. Run the job with a single `items` entry and a single `communities` entry.
2. If it fails with `"...no Assistance Level field"`, the label-match regex
   didn't find the select — inspect the pane's DOM (`#paneWrap`) via DevTools
   and adjust `labelFor()` / the regex in `readAssistanceLevelField()`.
3. If it fails with `"Target Assistance Level ... not found among this item's
   options"`, the error message lists the real option labels — use the exact
   wording from that list as `assistanceLevel` in the job payload.

## Speed / concurrency

Communities run **concurrently** (default 4 at once, override with the `concurrency`
payload field, 1–8). A first sequential version took ~5 minutes per community —
mostly real ALIS server round-trips per item, not anything this code controls —
which would put a 48-community portfolio run around 4 hours; concurrency is the
only lever that meaningfully helps, since each item's own per-request latency is
fixed. Confirmed live (Sep 2026) that multiple simultaneous independent logins on
the same ALIS account stay authenticated side by side (no concurrent-session
kickout), and that two workers racing on the very same item resolve safely — the
second one just sees `already-set` instead of double-submitting. Raise
`concurrency` if a run shows no errors/timeouts at the current level; there's no
measured safe ceiling, 4 is just a conservative starting point (same reasoning
kpiExport.js's `COMMUNITY_CONCURRENCY` uses).

## Behavior

- One job item per **(community, care item)** pair, so a failure on one item
  never blocks the rest of that community or portfolio run.
- Already-correct items are reported as `already-set`, not re-submitted.
- Items not found on a given community's Care Settings page are flagged
  `not-found` rather than failing the run — useful since not every community
  necessarily has every item configured.
- `communities` left empty auto-pulls every non-Training community on the
  given host(s) (same convention as the Usage Audit / Wellness Scorecard
  templates).

## Example payload (matches the "Two Staff" ask, Sep 2026)

```json
{
  "companyName": "Leisure Care LLC",
  "companyHost": "leisurecare",
  "communities": [{ "name": "Ackerly at Redd's Crossing", "communityId": "489" }],
  "items": [
    { "name": "Ambulation - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 1x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 2x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 3x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 4x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 5x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 6x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bathing - Two Staff Assistance 7x Per Week", "assistanceLevel": "Total 2x Staff" },
    { "name": "Bed Mobility - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Dressing - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Evacuation - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Toileting/Continence Care - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" },
    { "name": "Transfers - Two Staff Assistance", "assistanceLevel": "Total 2x Staff" }
  ]
}
```

These 14 item names are the full, exact set of "two staff"-style titles found
across all 49 communities in the `care_items` export Aaron provided
(9,896 rows total, 691 matching rows) — leave `communities` empty and set
`companyHost` to run all 49 in one job.

---

# Sibling job: Bulk Update Care Items — Reporting Label (Oct 2026)

Template `care-item-reporting-label` (`jobs.js` → `runCareItemReportingLabelJob`,
`carePage.js` → `setCareItemReportingLabel`). Same engine as Assistance Level
(both now run through the shared `runCareItemFieldJob`); the field is
`select#ReportingLabelId` (confirmed live Oct 2026), and "Two Person Assist" is
a real option in its list.

Differences from the Assistance Level job:

- **Communities by name.** `communities` entries only need `name`; the
  `communityId` is looked up on the host by exact (case/whitespace-insensitive)
  name. Unmatched names show up as failed rows instead of being dropped. All 41
  Leisure Care names in the Oct 2026 ask were confirmed to resolve uniquely.
- **`fromLabel` guard per item** ("Only change if currently"). If set and the
  item's current Reporting Label differs, it is left alone and reported as
  `skipped` (counted as success, with a note).

Oct 2026 ask — "Two Staff" items, ABST → Two Person Assist, 41 communities
(`care_items` export analysis, 574 Two Staff rows in those communities):

| Items | Current label | Rows |
|---|---|---|
| `Bathing - Two Staff Assistance {1..7}x Per Week` | ABST | 287 |
| `Bathing - Two Staff Assistance` | Shower | 41 |
| Ambulation / Bed Mobility / Dressing / Evacuation / Toileting-Continence / Transfers `- Two Staff Assistance` | blank | 245 |
| Training Community Ambulation (already done) | Two Person Assist | 1 |

**Decision (Oct 2026):** change the ABST items AND the blank ones; leave
"Shower" alone. So the job covers 13 items (7 Bathing x/week + Ambulation, Bed
Mobility, Dressing, Evacuation, Toileting/Continence Care, Transfers), each with
guard `ABST|(blank)` ("(blank)" = unset, shown by ALIS as "Choose One"), and
`Bathing - Two Staff Assistance` (Shower) is left out entirely. Import file
(Care Items + Communities sheets): `templates/leisure-care-two-staff-reporting-label.xlsx`.
Expected: 287 ABST + 244 blank rows changed across the 41 communities (the
Training Community Ambulation row is already set).
