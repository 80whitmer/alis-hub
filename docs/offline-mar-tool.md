# Offline MAR Setup + Audit Tool — Staging Notes

Captured 2026-09-26 (Aaron). Not built yet — this is a notes/spec staging doc for a
future job type. Aaron is walking through the real setup process by hand
tomorrow and will bring back concrete steps/screenshots to firm this up.

## What "Offline MAR" is

Support article: [Set up ALIS eMAR Offline Downloads](https://support.alisonline.com/hc/en-us/articles/4402758818445-Set-up-ALIS-eMAR-Offline-Downloads)

A downtime-preparedness feature (Citrix ShareFile-backed): once enabled for a
community, ALIS automatically generates a MAR document once a day and drops it
into a ShareFile folder tied to that community. If the community loses
internet, staff can still open the most recent MAR from a local ShareFile sync
(desktop app) or from the ShareFile website/mobile app, using per-community
credentials.

Key facts from the support doc:
- **Enablement is not self-service** — a community can't turn this on itself;
  it has to be activated on the ALIS side first ("contact your Account Manager
  or the ALIS Customer Success Team so they can activate Offline MAR
  Downloads for your community").
- Once enabled, `Settings > Community` in ALIS gets a new **"Offline File
  Download Information"** section, which surfaces:
  - A "Client portal" link, and/or a Windows/Apple ShareFile desktop-app
    download prompt.
  - A **Username** and **Password** for that community's ShareFile folder
    (these are the credentials that get handed to the client).
- Desktop setup flow: install ShareFile app → subdomain prompt (always
  `medtelligent`) → login with the community's Username/Password from
  Settings → short tutorial → local sync folder is live.
- Web access (no install): `https://medtelligent.sharefile.com`, same
  Username/Password.
- Timing: one test file generates immediately on setup; daily generation can
  take **up to 72 hours** to actually start, then runs **once/day, ~on the
  hour**. Files auto-delete after **10 days** (storage footprint capped
  ~500MB).
- If a community migrates to another company, or the feature gets disabled,
  ShareFile data is wiped and setup has to be redone from scratch.

## Example account (confirmed live, Sep 2026)

- **Saga Senior Living — Barton House**
  Settings page: https://sagaseniorliving.alisonline.com/Settings/Facility/122?tab=General
  (facility id `122`)

Aaron pulled up the real "Offline File Download Information" section on this
page (General tab) and it's already enabled here. Exact field labels shown
(values are real credentials — not repeated here; see the screenshot Aaron
shared in chat, not this file):

| Field | Format observed |
|---|---|
| (static description) | "Completed MARs for all residents will be generated and made available offline." |
| Next run date | a date, e.g. `MM/DD/YYYY` |
| Username | `sharefile+<code>-<state>-<facility-slug><facility-id>@alisonline.com` |
| Password | random string |
| Shared folder path | `ALIS Production/<Company Name>/<Community Name>` |
| Client portal | `https://medtelligent.sharefile.com` (fixed, same for every account) |
| Download offline files app | Windows / Apple icons (desktop app install links) |

Notes:
- **Username follows a pattern** (`sharefile+<batch/cohort code>-<state>-<community slug + facility id>@alisonline.com`)
  — worth confirming against a second live example whether it's
  deterministic enough to construct without scraping (probably not worth
  relying on either way — scrape it regardless, since Password never
  would be).
- **"Next run date" is the big find**: this field alone may be exactly the
  freshness signal Phase 2 (the audit tool) needs — if it's always one day
  in the future in normal operation, a stale/frozen "Next run date" (stuck
  in the past, or unchanged run over run) would mean the daily generation
  job broke for that community. **This could mean Phase 2 doesn't need
  ShareFile access at all** — just re-scrape this same ALIS Settings page
  per community and check whether "Next run date" is still advancing /
  still in the future. Much simpler than logging into ShareFile per
  community. Needs confirming against a second data point (e.g. check this
  same page again in a day or two and see whether the date moved).
- **Shared folder path** gives a clean, human-readable "Company/Community"
  breadcrumb — useful for the credentials package deliverable in Phase 1
  without needing to reformat anything.

⚠️ **Never commit real Username/Password values from this page into this
repo** — they're live production ShareFile credentials. Capture examples
in chat/notes outside git, or redact them here.

## The manual process today (as Aaron described it, to confirm tomorrow)

1. Turn the feature on in ALIS (this is the "contact ALIS Customer Success"
   step per the support doc — need to confirm whether Aaron's own ALIS admin
   access can flip this directly, or whether it genuinely requires a support
   ticket / different admin surface than the one alis-hub already automates
   against).
2. Activate/confirm the community's folder on the ShareFile side.
3. Once live, the Username/Password appear in `Settings > Community` →
   Offline File Download Information — capture those credentials.
4. Package the credentials (+ the client-portal link / app-download
   instructions) into something shareable with the client (today: presumably
   a manual email or doc Aaron puts together by hand).

**Open questions to resolve tomorrow's walkthrough:**
- Where exactly does "activate it on the share file site" happen — is that a
  ShareFile-side admin console Aaron has separate access to, or is it really
  the same ALIS Customer Success ticket as step 1 (i.e., two effects of one
  request, not two separate manual steps)?
- Is the ALIS-side toggle reachable from `admin.alisonline.com` (the surface
  alis-hub's existing Playwright automation already logs into — see
  `server/automation/playwright/companyDetailPage.js`,
  `communityPage.js`), or does it live somewhere alis-hub has no access to
  yet?
- What does the credential-sharing deliverable actually need to look like —
  a HubSpot note, a PDF, an email template? (Determines whether this is a
  pure ALIS-admin automation job or also needs a doc-generation step like
  the QBR/Wellness exports.)

## Proposed shape (once ready to build)

This app already has a job-template system for exactly this kind of
ALIS-admin browser automation — see `server/automation/templates.json`
(schema-driven input forms, e.g. the existing `create-communities` template)
plus per-page Playwright modules under `server/automation/playwright/`
(`companyDetailPage.js`, `communityPage.js`, etc.). The natural home for both
pieces below is as new entries in that same system, each backed by its own
Playwright page-object module — same pattern as the existing templates,
nothing new to invent architecturally.

**Phase 1 — Setup automation ("Set up Offline MAR")**
- Input: community (ALIS Admin Company ID + facility, same account-picker
  pattern already used elsewhere in this app), maybe a list of communities
  for a bulk run.
- Steps: flip whatever ALIS-side enablement toggle exists → confirm/activate
  the ShareFile folder → scrape the resulting Username/Password out of
  Settings > Community → assemble a shareable credentials package (format
  TBD, see open questions above).
- Output: the credentials themselves (surfaced in the job result, not just
  buried in a HubSpot note) plus whatever shareable artifact Aaron wants.

**Phase 2 — Audit tool ("Offline MAR Health Check")**
- Confirms, per community that has this enabled, that the feature is still
  actually working: folder still exists / feature not silently disabled
  (e.g. after a migration — see the support doc's migration caveat), and the
  most recent file in the ShareFile folder is fresh (within the last ~24-48h,
  given daily-on-the-hour generation and a 10-day retention window — a MAR
  older than a day or two, or a missing folder entirely, is the actual signal
  worth flagging).
- Could run against ShareFile directly (if there's an API/scriptable access
  path once real ShareFile credentials exist) rather than needing a full
  browser login per community.

**Phase 3 — Dashboard integration**
- Once Phase 2 exists, surface a per-account "Offline MAR: ✅ fresh / ⚠️
  stale / — not set up" indicator, in the same family as this app's other
  per-account health signals (Account Truth, Contract Truth, etc.) — likely
  another AccountHealthDashboard.jsx / TeamAmDashboard.jsx drawer section,
  fed by a portfolio-wide cross-reference table the way `alis_admin_ids` and
  `key_contacts` already work.

## Next step

Aaron clicks through the real process by hand (using the Saga/Barton House
example above, or a fresh test community) and comes back with the actual
concrete steps/screens, so Phase 1's scriptPath can be written against real
selectors instead of guesses.
