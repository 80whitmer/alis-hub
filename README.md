# alis-hub

**ALIS Admin Control Panel** — a locally-hosted automation dashboard for managing settings configuration, standardization, and auditing across ALIS communities at scale.

Built on Playwright + Express + React.

---

## What it does

alis-hub replaces hours of manual click-work with template-driven automation projects. Common use cases:

- **Batch community setup** — provision multiple communities from a CSV in one run
- **Settings standardization** — apply a template (GL accounts, lockdown rules, status reasons) across N communities
- **Audit & diff** — snapshot current config for a client, compare after changes
- **Project tracking** — every batch run is logged with per-community status and timestamps

---

## Getting started

### Prerequisites
- Node.js 18+
- npm 9+

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/alis-hub.git
cd alis-hub

# 2. Install dependencies
npm install

# 3. Configure credentials
cp .env.example server/.env
# Edit server/.env with your ALIS admin credentials

# 4. Start (dev mode — backend + frontend hot reload)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Project structure

```
alis-hub/
├── server/                  # Express backend
│   ├── index.js             # Server entry point
│   ├── api/                 # REST route handlers
│   ├── automation/
│   │   ├── playwright/      # Page objects & browser setup
│   │   ├── templates/       # JSON automation templates
│   │   └── jobs.js          # Job queue & execution
│   └── db/                  # SQLite (projects, logs, templates)
└── client/                  # React frontend (Vite)
    └── src/
        ├── pages/           # Dashboard, Projects, Templates, Audit
        └── components/      # Shared UI components
```

---

## Security note

Your ALIS credentials live only in `server/.env`, which is git-ignored. Never commit credentials. The `.env.example` file shows the required shape without values.

---

## Roadmap

- [ ] Phase 1: Community creation batch runner
- [ ] Phase 2: GL account template system
- [ ] Phase 3: Settings audit & diff
- [ ] Phase 4: Lockdown toggle tool
- [ ] Phase 5: Electron packaging for colleague distribution
