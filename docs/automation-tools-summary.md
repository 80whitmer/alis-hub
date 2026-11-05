# alis-hub: Automation Tools Summary

Compiled 2026-10-17 from the repo (templates, services, changelog, git history of 148 commits, May to Oct 2026).

**Scale:** about 19.7k lines of server code and 19.7k lines of React UI. 16 job templates, 8 dashboards/tools, and an Express + SQLite + Playwright + React stack.

---

## Part 1: Inventory (internal view)

### A. Bulk settings and data changes (Playwright browser automation)
| Tool | What it automates |
|---|---|
| Create Communities | Provisions many communities from a CSV (capacity, address) |
| Sync ALIS Settings | Copies Resident, Care, Medication, Billing, CRM settings (checkboxes, dropdowns, compliance items) from one community to many |
| Sync GL Accounts | Updates GL and discount accounts for ownership transitions, with historical sync and an exportable audit log |
| Bulk Care Item Updates (2 jobs) | Sets Assistance Level and Reporting Label on named care items across communities |
| Bulk Resident Move-Out | Drives the Move Out pane for lists of residents the importer can't handle |
| Organic Add to Jira form helper | Validates and pre-fills the onboarding request form for review and manual submit (never auto-submits) |

### B. Reporting and analytics pipelines (API-driven)
| Tool | What it produces |
|---|---|
| KPI Export / QBR Pipeline | Quarterly business review: KPIs vs. industry benchmark, DSO, revenue per occupied day, occupancy, staffing, support tickets, auto-generated discussion flags. Dashboard, drill-downs, PPTX and Excel export |
| Weekly Wellness Scorecard | 25 clinical-risk indicators with week-over-week trend, benchmark comparison, community health score, regional rollup. Excel and PDF export |
| Community Revenue & Occupancy Snapshot | Monthly per-community revenue, census, move-ins/outs, PPD |
| Resident Acuity History | Per-resident monthly care level/points/fee, reconciled against invoiced care charges |
| Moved-Out Residents With Open Billing | Flags residents with lingering charges, balances, or post-move-out billing |
| Community Med Cart Report | Ties med-cart assignments to actual medication-pass activity |
| ALIS Audit History | Unified, filterable "who changed what, when" feed across company, communities, residents |
| Evaluation Lookup | Resident evaluation question-by-question breakdown |

### C. Audit and data-integrity tools
| Tool | What it does |
|---|---|
| Usage Audit (contracted vs. enabled vs. used) | Feature-by-feature RAG grid replacing a hand-maintained roadmap spreadsheet, with portfolio roll-up |
| CRM ID Audit (single and portfolio-wide) | Verifies the key mapping ID between the clinical platform and the CRM across every company and community; one Excel workbook |
| Entitlement checks | Portfolio-wide feature entitlement scan with cancel support |

### D. Account management dashboards (CRM roll-ups)
| Tool | What it does |
|---|---|
| Account Health Dashboard | Portfolio-wide CRM roll-up: weighted 0-100 health score, ARR, deals, tickets by category/tier, aging receivables import, DSO, occupancy, cost to serve, Excel/PDF export |
| Team AM Dashboard | Same roll-up by account manager, with PPT export, at-risk drawer, tier KPIs, ARR closed |
| Pinned-note and quick-link generation | Auto-built links to every ticket, deal, and parent record |

### E. Platform and developer-experience work
- Job queue with live progress, pause/resume/cancel, per-item logging, retry, timezone-correct audit trail
- Reusable drill-down Drawer, section-nav, and card components applied across dashboards
- First-run setup wizard and double-click launchers (Mac and Windows)
- Config-driven destination registries (a new settings page or audit target is a one-line addition)

---

## Part 2: Resume-ready workflows (generic, no client or system names)

> **Read before using.** The only hard numbers below come from the repo (counts, observed run times, scope). Items marked **[FILL IN]** need your real before/after figures (hours saved per run, runs per month, error rate). I did not invent any. If you can't measure it, use the scope-based wording, which is defensible as is.

### 1. Bulk configuration and settings automation
- **Problem:** Standardizing settings, accounting codes, and care-item configuration across dozens of sites meant repetitive manual clicking in an admin UI. It was slow and error-prone.
- **What I did:** Built template-driven browser-automation jobs that copy settings, sync accounting codes, update care-item attributes, and provision new sites from spreadsheets. Added a job queue with live progress, pause/resume/cancel, per-site status, retries, and an exportable change log.
- **Tools:** Node.js, Playwright, Express, React, SQLite, Excel/CSV ingestion.
- **Result:** One run configures an entire portfolio (40+ sites in a single run). Every change is logged and auditable. **[FILL IN: manual minutes per site x sites, vs. run time.]**

### 2. Quarterly business review (QBR) pipeline
- **Problem:** QBR prep was hand-assembled from multiple systems: operational KPIs, financials, support history, and deal data. It took hours per account and varied in quality.
- **What I did:** Built an end-to-end pipeline that pulls operational and billing data via API, benchmarks it against published industry figures, merges CRM tickets and deals, generates discussion-point flags, and exports an interactive dashboard plus a branded slide deck and Excel workbook. Added DSO and revenue-per-occupied-day metrics with month-over-month trend history.
- **Tools:** REST APIs, Node.js, SQL (SQLite), React, charting libraries, PPTX/Excel generation, CRM API.
- **Result:** Cut a 46-site account pull from 2+ hours to a fraction by adding bounded concurrency. Produces a complete deck from one form. **[FILL IN: prep hours per QBR before/after; QBRs per quarter.]**

### 3. Weekly clinical-risk scorecard
- **Problem:** Clients sent a hand-filled weekly spreadsheet of 25 clinical-risk indicators, compiled by staff from several reports.
- **What I did:** Automated indicators such as falls, elopement, incidents, medication exceptions, overdue evaluations, and staff training gaps, with week-over-week trend, benchmark comparison, a weighted community health score, and regional rollups. Deliberately left unreliable indicators blank instead of guessing, and documented why.
- **Tools:** REST APIs, Node.js, SQL, React, Excel and PDF generation, data-quality checks.
- **Result:** About 10 of 25 indicators computed automatically; the remainder are documented as not available from the source data. **[FILL IN: staff hours/week saved per client.]**

### 4. Portfolio account-health and account-manager dashboards
- **Problem:** Leadership had no single view of account risk, revenue, ticket volume, or aging receivables across the book of business.
- **What I did:** Built CRM-integrated dashboards covering a few hundred accounts with a weighted 0-100 health score, ARR and deal tracking, ticket analysis by category and tier, cost-to-serve, receivables aging (parsed from PDF reports), and occupancy. Added drill-down drawers, search, tiering, and one-click Excel/PDF/PPT exports.
- **Tools:** CRM API, React, Node.js, PDF parsing, Excel/PPT/PDF generation.
- **Result:** Replaced manual spreadsheet roll-ups with a live, exportable view over 100-370 accounts. **[FILL IN: report-prep hours/month saved; any retention or risk-flagged wins.]**

### 5. Cross-system data integrity audits
- **Problem:** Two core systems (clinical platform and CRM) depend on matching record IDs, and mismatches silently broke reporting. Feature usage vs. contracted entitlements was tracked in a manually maintained spreadsheet.
- **What I did:** Built portfolio-wide audits comparing IDs across systems, plus a contracted vs. enabled vs. used RAG grid per feature. Output is one Excel workbook of discrepancies and a visual dashboard.
- **Tools:** Playwright, REST APIs, CRM API, Excel generation.
- **Result:** Audited every active company and community in a single run; replaced a manual roadmap spreadsheet. **[FILL IN: number of mismatches found and fixed.]**

### 6. Ad-hoc data investigations and financial exception reporting
- **Problem:** Clients and internal teams regularly asked for custom reports (billing exceptions, charge-code consistency, resident acuity and fee reconciliation, medication-cart activity).
- **What I did:** Turned repeated one-off pulls into reusable jobs: moved-out residents with open billing, care-level and fee history reconciled against invoiced charges, accounting-code consistency checks across sites, med-cart-to-activity matching. Scoped each honestly, flagging what source data could and couldn't support.
- **Tools:** REST APIs, Node.js, Excel generation, data validation.
- **Result:** One-off requests became self-serve jobs that run for a whole company at once. **[FILL IN: requests handled per month; turnaround before/after.]**

### 7. Audit-trail and change-tracking tooling
- **Problem:** Answering "who changed what, and when" required visiting many pages manually.
- **What I did:** Built a unified audit-history pull across company, site, and resident levels with filters, a combined timeline, and Excel/PDF export. Added staff attribution to open incidents to show who to follow up with.
- **Tools:** Playwright, REST APIs, React, PDF/Excel generation.
- **Result:** One filterable feed replaces visiting each record by hand. **[FILL IN: time per investigation before/after.]**

### 8. Request-intake and workflow helpers
- **Problem:** Onboarding and support requests required retyping the same data into ticketing forms, causing inconsistent submissions.
- **What I did:** Built validators and one-click form pre-fill helpers with a human review step (never auto-submit), plus generated deep links and pinned notes on tickets, deals, and accounts. Added a first-run setup wizard so non-engineers could run the tools.
- **Tools:** React, Node.js, Jira and CRM APIs, JSON schema validation.
- **Result:** Consistent, reviewed submissions; tools usable by non-technical teammates. **[FILL IN: submissions per month; minutes saved each.]**

---

## Part 3: Ready-to-paste resume bullets

Use these as starting points and swap in your real numbers.

- Designed and built an internal automation platform (Node.js, React, Playwright, SQLite) with 16 reusable job templates that replaced manual admin work across 40+ sites per run.
- Automated end-to-end quarterly business review production (API ingestion, benchmarking, flag generation, dashboard, PPTX/Excel export); added bounded concurrency to cut large-account data pulls from 2+ hours to a fraction of that.
- Built a weekly clinical-risk scorecard automating about 10 of 25 indicators with trend analysis and a weighted health score, replacing a hand-compiled client spreadsheet.
- Created portfolio account-health and account-manager dashboards over 100-370 accounts (health scoring, ARR, ticket analytics, receivables aging), with one-click PDF, Excel, and PPT exports for leadership.
- Implemented cross-system data-integrity and entitlement audits that reconcile record IDs and feature usage across the full customer base in a single run.
- Converted recurring ad-hoc data requests into self-serve reporting jobs (billing exceptions, acuity-to-fee reconciliation, audit trails).
- Shipped with human-in-the-loop safeguards: never auto-submitting external forms, documenting unreliable data instead of guessing, and keeping an audit log of every automated change.

**Skills demonstrated:** workflow automation, API integration, ETL and data normalization, dashboard and report design, SQL, browser automation, stakeholder-driven scoping, data-quality governance.

---

## Part 4: Numbers worth collecting for the resume

1. Manual minutes per site or report for each workflow, multiplied by how often it runs.
2. Number of sites, accounts, and users each tool serves.
3. Mismatches or errors the audits caught and fixed.
4. Revenue or retention tied to accounts flagged at risk (only if you can attribute it).
5. Turnaround time for ad-hoc requests, before vs. after.

---

# Addendum: API toolkit, Product Hub, and the ticketing system

Sources: `alis-api-toolkit/` (README, client, git log, Sep 2026), `alis-product-ops/` (README, docs/CONTEXT.md, 40+ commits, Sep 2026), and `alis-hub/server/services/ALIS_EXPORT_API_REFERENCE.md`. The ticketing system itself is not a codebase I could inspect (it lives in the CRM), so its description rests on how the tools above consume it. **Check section 3 against what you actually built.**

## 1. ALIS API Toolkit (custom client reports)

**What it is:** A small, no-build folder (an API client, an env loader, a sanity-check script, and a README) that lets anyone on the team open it in Claude Code and ask in plain English for a custom data pull. Claude reads the client file as a "menu" of available data, queries the live export API, sanity-checks row counts, and returns a spreadsheet. Credentials stay in each user's own git-ignored `.env`. The repo was scrubbed of client names before being shared.

**Underneath it (in alis-hub):**
- A typed client with retry, per-company Basic Auth, pagination handling, and concurrency limits.
- A 2,600-line API reference generated from the live OpenAPI specs (v1 and v2), marking each endpoint wired or not wired, with gotchas: which endpoints are account-wide, which filter dates server-side, which return misleadingly empty data.
- About 20 export endpoints wired out of roughly 40 (communities, floor plan and occupancy, residents, move-ins/outs, billing, incidents, evaluations, care, orders, staff, compliance).

**What it's used for:**
- Insurance and underwriting asks (room-level census, private vs. semi-private mix, vacancy-to-reoccupancy time).
- Billing reconciliations and charge-code consistency audits.
- Incident breakdowns for QBRs.
- Any "can ALIS show us X?" question. The first step is to find out whether the data exists and where its limits are.

**Why it matters:** It turns a request that needs an engineer or BI ticket into a minutes-long self-serve task for account managers, with the data's limits documented rather than guessed.

## 2. ALIS Product Hub (for the product team)

**Problem:** Product, BI, clinical, integrations, and finance teams were making prioritization calls from scattered Slack threads, a spreadsheet backlog, and ticket hygiene. They had no HubSpot seats, and no one place showed which clients asked for what, how much revenue sat behind it, or what a client had bought vs. turned on vs. actually used.

**What I built:** A web app (React, Express, SQLite, HubSpot API, Playwright), forked from alis-hub and rebranded. Starting from a research pass of the team's own stated needs, I scoped v1 to a refreshable data view rather than a six-view platform.
- **Portfolio dashboard:** accounts, ARR, communities, capacity, tier and priority filters, search, key contacts, onboarding projects, KPI trends by tier.
- **Escalations and enhancements:** Top 3 and long-term enhancement requests, escalations, and tickets by category and module (the module is inferred from ticket text when blank), with trend charts and one shared table component.
- **Account Truth:** contracted vs. enabled vs. used, per account and portfolio-wide, with a live admin check streamed to the browser.
- **Quick links** into each client's admin pages, so product doesn't need CRM access.
- **Exports:** Excel and one-page branded PDF that match the screen exactly.
- **Caching:** a server-side cache turns a 15–25 second live pull into an instant load. A one-click launcher and setup guide let non-technical colleagues run it.
- A decision log was built but shelved until teams ask for it.

**Result:** One source of evidence for product prioritization, usable by non-CRM users. **[FILL IN: teams or users on it, meetings or sheets it replaced, requests triaged.]**

## 3. Ticketing system (escalations and enhancements) — verify

What the tools above reveal about it:
- A CRM-based ticketing structure with categories, module, tier, and staging labels (Top 3, Long-Term Projects), plus pipeline stages and pinned notes.
- Escalations and enhancement requests are captured in a consistent form that feeds a Slack channel and the dashboards, and your intake helpers (escalation, enhancement-request, and ticket-creation workflows) prefill it.
- Tickets associate to companies, deals, and contacts, which is what lets the dashboards compute per-account and per-tier volumes.

**Things only you can fill in:** the date it launched, how many people adopted it (you said the whole team did), what it replaced, ticket volume per month, and any change in response or resolution time.

## Resume wording (generic)

**Self-serve data tooling**
- Built a lightweight toolkit that lets non-engineers get custom client reports from a platform API by describing the request in plain English; reports that previously needed an engineering or BI ticket are now produced in minutes. Documented the API's coverage and limits (about 40 endpoints), so answers are accurate about what data exists.
- Maintained a generated, versioned API reference and a typed client with retry, pagination, and concurrency handling.

**Product intelligence hub**
- Designed and shipped a product-team portal that unifies CRM account data, revenue, enhancement requests, escalations, and contracted-vs-enabled-vs-used feature usage, giving product, BI, integrations, and finance one evidence base for prioritization without needing CRM licenses.
- Added a caching layer (15–25 second pull to instant load), Excel and PDF exports, and a one-click launcher for non-technical users.

**Ticketing system**
- Designed a CRM-based escalation and enhancement ticketing workflow (categories, tiers, staging, pinned context notes) that was adopted by the full account-management team, and that feeds leadership dashboards and the product team's priorities. **[FILL IN: adoption date, ticket volume, outcome.]**
