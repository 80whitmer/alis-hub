# alis-hub Development Workflow Guide

Welcome! This guide will help you set up an efficient development flow for building and deploying automation to HubSpot.

---

## Quick Start

### 1. Initial Setup (One-Time)

```bash
# Install dependencies and configure environment
npm run setup

# This does:
# ✅ npm install
# ✅ Creates server/.env from .env.example
# ✅ Sets up Git hooks for automated deployment
```

**Then edit `server/.env` with your credentials:**

```env
ALIS_USERNAME=your_username
ALIS_PASSWORD=your_password
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-xxxxx
HUBSPOT_PORTAL_ID=123456789
```

> ⚠️ **Security**: Never commit `.env` to git. It's in `.gitignore`.

---

## Development Workflow

### 2. Start Local Development

```bash
npm run dev
```

This starts:
- **Server** (Express) at `http://localhost:3000`
- **Client** (React/Vite) at `http://localhost:5173`

Both auto-reload on file changes.

### 3. Build Automation Templates

Create your automation templates in `server/automation/templates/` as JSON files:

```
server/automation/templates/
├── community-setup.json
├── settings-standardize.json
└── audit-snapshot.json
```

Example template structure:

```json
{
  "name": "Batch Community Setup",
  "version": "1.0.0",
  "description": "Provision multiple communities from CSV",
  "steps": [
    {
      "type": "navigate",
      "url": "https://alis.co/admin/communities"
    },
    {
      "type": "fill_form",
      "selectors": {
        "name": "#community-name",
        "code": "#community-code"
      }
    }
  ]
}
```

### 4. Update Code & Test Locally

Edit files in:
- `server/` — Express routes, automation logic, database
- `client/src/` — React components, pages, styling

The dev server auto-reloads both sides.

### 5. Commit & Deploy

```bash
# Commit your changes
git add .
git commit -m "feat: add community setup automation"

# Push to remote
git push origin your-branch

# On main/develop: Automatic HubSpot deployment triggered!
```

**What happens on `git push`:**
1. Code is pushed to your remote (GitHub, GitLab, etc.)
2. Post-push hook automatically runs
3. `npm run deploy` syncs templates to HubSpot
4. Deployment is logged in HubSpot audit trail

---

## Command Reference

### Development

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (backend + frontend) |
| `npm run start` | Start production server |
| `npm run build` | Build for production |
| `npm run test` | Run test suite |
| `npm run lint` | Run linters |

### Setup & Configuration

| Command | Purpose |
|---------|---------|
| `npm run setup` | One-time: install deps, create .env, set up git hooks |
| `npm run setup:env` | Create `server/.env` from template |
| `npm run setup:hooks` | Install git hooks for auto-deployment |

### Deployment

| Command | Purpose |
|---------|---------|
| `npm run deploy` | Deploy to HubSpot (auto-detected env) |
| `npm run deploy:dev` | Deploy to development environment |
| `npm run deploy:prod` | Deploy to production environment |

---

## Git Hooks (Automated Deployment)

The setup installs two git hooks:

### `post-push` Hook

**Triggers:** After successful `git push`

**Behavior:**
- Detects branch name
- If on `main` or `develop`: auto-deploys to HubSpot
- If on feature branch: skips auto-deploy

**What it does:**
```bash
npm run deploy  # Syncs templates to HubSpot
```

**To skip auto-deployment:**
```bash
git push --no-verify
```

### `pre-commit` Hook

**Triggers:** Before `git commit`

**Behavior:**
- Prevents committing `.env` file
- Can be extended with linting/testing

**Example override:**
```bash
git commit --no-verify
```

---

## Deployment Pipeline

### Manual Deployment (Anytime)

```bash
# Deploy to HubSpot immediately
npm run deploy

# Or specify environment
npm run deploy:dev
npm run deploy:prod
```

### Automatic Deployment (On Push)

```bash
git push  # Triggers post-push hook → npm run deploy
```

### What Gets Deployed?

The deploy script syncs:
1. **Automation Templates** — JSON files from `server/automation/templates/`
2. **Metadata** — Template names, versions, sync timestamps
3. **Audit Log** — Git branch, commit SHA, deployment status

**To HubSpot:**
- Custom objects or properties (depends on your integration)
- Logs deployment events for audit trail

---

## Environment Variables

Your `server/.env` file contains:

```env
# ALIS Credentials (local browser automation)
ALIS_USERNAME=admin@alis.co
ALIS_PASSWORD=***

# HubSpot API (for syncing templates & logs)
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-xxxxx
HUBSPOT_PORTAL_ID=123456789

# Server
PORT=3000
NODE_ENV=development

# Playwright (show browser during automation)
PLAYWRIGHT_HEADED=false

# Deployment
DEPLOYMENT_ENV=development
GITHUB_TOKEN=ghp_xxxxx (optional)
```

**How to get HubSpot token:**
1. Go to HubSpot → Settings → Integrations → Private apps
2. Create a new private app with scopes: `crm.objects.contacts.read`, `crm.objects.custom.write`
3. Copy the token and paste into `.env`

---

## Troubleshooting

### "Deployment failed: Invalid HubSpot token"

**Fix:**
1. Check `HUBSPOT_PRIVATE_APP_TOKEN` in `server/.env`
2. Regenerate the token in HubSpot if it's expired
3. Verify token has correct scopes

### "Post-push hook failed but push succeeded"

**This is OK.** The push completes, but deployment had an error.

**To retry:**
```bash
npm run deploy
```

### "Cannot find templates directory"

**Fix:**
```bash
mkdir -p server/automation/templates
# Add your .json templates here
npm run deploy
```

### "Deployment works locally but not on CI/CD"

**Check:**
1. Environment variables are set in CI/CD system
2. HubSpot token is in secrets (not printed in logs)
3. Node.js version is 18+

---

## Workflow Examples

### Scenario 1: Add a New Template

```bash
# 1. Create template file
cat > server/automation/templates/gl-accounts.json << EOF
{
  "name": "GL Account Setup",
  "version": "1.0.0",
  "steps": [...]
}
EOF

# 2. Test locally
npm run dev
# Open http://localhost:5173 and test

# 3. Commit & deploy
git add server/automation/templates/gl-accounts.json
git commit -m "feat: add GL account automation template"
git push
# ✅ Auto-deployed to HubSpot!
```

### Scenario 2: Update Client UI

```bash
# 1. Edit React component
vim client/src/pages/Dashboard.jsx

# 2. See changes live (auto-reload)
# No restart needed!

# 3. Commit & push
git add client/src/pages/Dashboard.jsx
git commit -m "refactor: improve dashboard layout"
git push
# ✅ Pushed to remote, no deployment triggered (no templates changed)
```

### Scenario 3: Fix Automation Logic

```bash
# 1. Edit server automation
vim server/automation/jobs.js

# 2. Restart dev server
# Changes auto-reload

# 3. Test in UI
npm run dev  # Already running, check http://localhost:3000

# 4. When ready
git add server/automation/jobs.js
git commit -m "fix: handle missing GL accounts in standardization"
git push origin develop
# ✅ Auto-deployed to HubSpot!
```

---

## Tips & Best Practices

### ✅ Do

- **Commit often** — Small, focused commits are easier to debug
- **Use feature branches** — `git checkout -b feature/gl-accounts`
- **Test locally first** — Always run `npm run dev` before committing
- **Use descriptive commit messages** — Helps track what changed
- **Keep templates versioned** — Include `"version": "1.0.0"` in JSON

### ❌ Don't

- **Don't commit `.env`** — It's in `.gitignore` for a reason
- **Don't skip pre-commit hooks** — They prevent accidents (`git commit --no-verify` bypasses)
- **Don't hardcode credentials** — Use environment variables
- **Don't deploy from feature branches** — Only `main` and `develop` auto-deploy
- **Don't modify `.gitignore`** — It protects your credentials

---

## Next Steps

1. **Configure HubSpot integration** → Update `server/.env` with your credentials
2. **Create your first template** → Add a JSON file to `server/automation/templates/`
3. **Start developing** → Run `npm run dev` and build!
4. **Deploy** → When ready, push to `main` or `develop` branch

---

## Support

- Check `README.md` for project overview
- Review `server/index.js` for API structure
- Check `.env.example` for all available config options
- Review git hook output: Look in `.git/hooks/` files

**Questions?** Open an issue or reach out to the team.

---

Happy automating! 🚀
