# ALIS Quick-Pull Reports — Claude Code Setup

**What this is:** a way to get a custom ALIS data pull — a one-off census, a billing
reconciliation, an incident breakdown, whatever a client or internal team asks for —
in minutes instead of building a dashboard for it. You describe what you need in plain
English to Claude Code, it queries the live ALIS export API directly, and hands you
back a spreadsheet or summary. No coding required on your end.

This is different from the alis-hub dashboard (the automation/reporting tools that run
on their own, no AI involved). Use *this* for the "someone just asked a weird one-off
question" case — the ask-once, answer-once report. If the same ask comes up two or
three times, tell Aaron — that's a sign it should graduate into a real alis-hub report
instead of a fresh Claude Code pull every time.

---

## One-time setup

1. **Install Claude Code** (the desktop app). If you don't have it yet, ask Aaron for
   the install link.
2. **Get access to the `alis-hub` repo** and clone it, or ask Aaron to add you as a
   collaborator / share a copy of the folder. Open that folder in Claude Code — this
   gives Claude the context it needs (see below).
3. **Install Node.js** (18 or newer) if you don't have it — Claude Code needs it
   installed on your machine to run the small scripts it writes to pull data.
4. **Set up your own ALIS credentials:**
   ```bash
   cp .env.example server/.env
   ```
   Then open `server/.env` and fill in:
   - `ALIS_USERNAME` / `ALIS_PASSWORD` — **your own** ALIS admin login (not Aaron's).
   - `ALIS_EXPORT_API_USERNAME_BASE` — the local part of your ALIS login email, e.g.
     if you log into ALIS as `jane.doe@viva.alisonline.com`, this is `jane.doe`.

   `server/.env` is git-ignored — it never gets committed or shared. Never paste your
   password into the chat with Claude; it only ever needs to live in that file.
5. Sanity check: ask Claude Code "which companies/communities can you see in ALIS?" —
   if it comes back with a real list, you're wired up correctly.

---

## Where the "menu" of available data lives

You don't need to memorize ALIS's API. The file
[`server/services/alisApiClient.js`](server/services/alisApiClient.js) is the living,
up-to-date reference — every function in it is a data pull Claude can already make,
with comments explaining what each one actually returns (including the gotchas: which
endpoints are paginated, which ones only cover a fixed date range, which ones return
misleadingly empty results at some clients, etc.). When you ask for something new,
Claude reads this file first to see what's already available before reaching for the
raw API.

Roughly, what's in there today:

| Area | Examples |
|---|---|
| Communities & rooms | community list, historical floor plan (room/bed inventory) |
| Occupancy / census | daily room-assignment snapshots, by community and month |
| Residents | current residents, move-ins/move-outs (current + historical), leaves of absence |
| Billing | recurring charges (rent, care fees), invoice line items, outstanding invoices |
| Clinical / care | evaluations, diagnoses & allergies, recorded care, order administration |
| Staff | staff list, compliance/certification details |
| Incidents | incident log (with staff attribution), per-incident form detail |
| Prospects | inquiry/prospect pipeline |

If what you need isn't in the list, say so anyway — there may be an ALIS endpoint
that just hasn't been wired up yet, and Claude can check the live ALIS OpenAPI spec
(`https://api.alisonline.com/specs/v1/openapi.json`) to see if one exists.

---

## How to actually ask for a report

Just describe the ask like you would to a coworker. Good prompts name the **client/
community**, the **time range**, and what the output needs to show. For example:

> "Colliers needs the room census for Greenacres from Jan 2025 through July 2026,
> broken out by room number and whether it's private or semi-private. Can you pull
> that from ALIS and give me a spreadsheet?"

> "Pull incidents for [community] in Q2 2026 and break them down by type — I need it
> for the QBR."

> "Can you check whether we can show how long a room sits vacant before it's
> reoccupied, for [community]? An insurance carrier is asking."

Claude will:
1. Figure out which ALIS endpoint(s) actually have that data (from
   `alisApiClient.js`, or the live spec if it's not wired up yet).
2. Write a small one-off script that calls the API and joins/filters what's needed.
3. Sanity-check the output (row counts, spot totals) before handing it back.
4. Build the deliverable — usually an Excel file — and save it where you can grab it.

You don't need to write or read any code, but it's fine to ask Claude to explain its
approach or show its work if a client is going to ask "how was this calculated."

---

## Worked example: the Greenacres occupancy/census ask

A client's insurance carrier needed two things ahead of an underwriting review:

1. A room-level census for Greenacres (Jan 2025–Jul 2026) — because dividing average
   daily census by the room count was producing >100% occupancy, they needed to know
   how many rooms are private vs. semi-private, or see the census with room numbers
   attached.
2. For rooms that were vacant before a specific loss event, how long it took each one
   to be reoccupied (vacate date → reoccupy date).

**How this maps to ALIS data:**
- Room inventory (private/semi-private, capacity) → `historicalFloorPlan` (one row per
  physical room/bed ever configured; filter `!isDisabled` for currently active rooms).
- Room-by-room daily census → `getOccupancy` (`hqOccupancies`), which gives daily
  room-assignment snapshots per resident, joinable back to room number/unit.
- Vacancy → reoccupancy duration → `historicalMoveInMoveOuts` (or occupancy gaps per
  room), finding the move-out date for one resident and the next move-in date into
  the same room.

The output was a spreadsheet: one tab with room-by-room monthly census (room number,
type, private/semi-private, occupied days), and one tab listing each vacancy window
with days-to-reoccupy. That's the shape of deliverable to expect from this kind of
ask — this isn't a template to fill in, just an example of the pattern.

---

## Guardrails

- **Never share ALIS credentials** — not in chat with Claude, not in Slack, not in a
  committed file. Each person uses their own login in their own `server/.env`.
- **Verify before sending externally.** These are one-off pulls, not audited reports —
  spot-check totals against what you'd expect (or against ALIS's own admin UI) before
  a number goes to a client, an insurance carrier, or anyone outside the company.
- One-off scripts get saved in the repo as `server/_oneoff_<description>.js` — that's
  intentional (see `server/_oneoff_rentroll_recon_ridgewood.js` for an example). It
  keeps a record of exactly how a number was produced, in case anyone asks later.
- If a request touches something sensitive (PHI/clinical detail, anything going to a
  regulator or insurer), loop in Aaron before it goes out.

---

Questions or something not working? Ask Aaron (aaron@go-alis.com).
