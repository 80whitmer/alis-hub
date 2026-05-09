# alis-hub Development Workflow — Setup Summary

## 🎯 What's Been Set Up

Your alis-hub project now has a complete, professional development workflow that automates:
- **File updates** — Easy development with hot-reload
- **Git management** — Hooks for safe commits
- **HubSpot sync** — Automatic deployment on push to main/develop

---

## 📁 New Files Created

### 📖 Documentation

| File | Purpose |
|------|---------|
| **DEVELOPMENT.md** | Complete development guide with examples and troubleshooting |
| **WORKFLOW.md** | Quick reference card for daily tasks |
| **DEPLOY_CHECKLIST.md** | Pre/post deployment verification steps |
| **SETUP_SUMMARY.md** | This file — overview of changes |

### 🚀 Automation & Scripts

| File | Purpose |
|------|---------|
| **scripts/deploy-to-hubspot.js** | Main deployment script — syncs templates to HubSpot via API |
| **scripts/setup-git-hooks.sh** | Installs git hooks for auto-deployment |
| **.github/workflows/deploy.yml** | CI/CD workflow for GitHub Actions (optional) |

### ⚙️ Configuration

| File | Purpose |
|------|---------|
| **.env.example** | Updated with HubSpot API credentials (template) |
| **package.json** | Enhanced with new npm scripts |

---

## 🔧 New npm Scripts

```bash
npm run setup              # One-time setup: install, configure, install hooks
npm run setup:env         # Create server/.env from template
npm run setup:hooks       # Install git hooks for auto-deployment

npm run dev               # Start dev server (backend + frontend)
npm run start             # Start production server
npm run build             # Build for production
npm run test              # Run tests
npm run lint              # Run linters

npm run deploy            # Deploy to HubSpot (manual)
npm run deploy:dev        # Deploy to development environment
npm run deploy:prod       # Deploy to production environment
```

---

## 🚀 Quick Start

### 1. Configure Environment (First Time Only)

```bash
npm run setup
```

This:
- ✅ Installs all dependencies
- ✅ Creates `server/.env` from template
- ✅ Installs git hooks for auto-deployment

**Then edit `server/.env`:**
```env
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-xxxxx
HUBSPOT_PORTAL_ID=123456789
ALIS_USERNAME=your_email
ALIS_PASSWORD=your_password
```

### 2. Start Developing

```bash
npm run dev
```

Open:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### 3. Commit & Deploy

```bash
git add .
git commit -m "feat: add new automation"
git push
# ✅ Auto-deployed to HubSpot!
```

---

## 🔄 How It Works

### Development Loop

```
Edit Files → Save → Auto-reload (live)
    ↓
Test Locally
    ↓
Commit Changes (git commit)
    ↓
Push to Remote (git push)
    ↓
Post-Push Hook Triggers
    ↓
Auto-Deploy to HubSpot
    ↓
✅ Done!
```

### Git Hooks

Two hooks are installed:

1. **post-push** — After `git push`
   - Detects branch (main/develop only)
   - Runs `npm run deploy`
   - Syncs templates to HubSpot
   
2. **pre-commit** — Before `git commit`
   - Prevents committing `.env` file
   - Can be extended with tests/linting

### Deployment Flow

```
Templates in: server/automation/templates/*.json
    ↓
npm run deploy
    ↓
✅ Read templates
✅ Authenticate with HubSpot
✅ Sync to HubSpot via API
✅ Log deployment event
✅ Done!
```

---

## 📋 Key Features

### ✅ Automatic Deployment
- Push to `main` or `develop` → Auto-deploys
- No manual deployment commands needed
- Failed deployments don't block git push

### ✅ Safe Commits
- `.env` cannot be committed (protected by hook)
- Git hooks can be extended with tests/linting

### ✅ HubSpot Integration
- Direct API sync via private app token
- Audit trail of all deployments
- Environment-specific deployment (dev/prod)

### ✅ Easy Updates
- Live reload during development
- Simple template format (JSON)
- Clear error messages on failure

---

## 📚 Documentation Files

### For Daily Development
👉 Start here: **[WORKFLOW.md](./WORKFLOW.md)** (1 page quick reference)

### For Detailed Setup
👉 Complete guide: **[DEVELOPMENT.md](./DEVELOPMENT.md)** (detailed with examples)

### Before Deploying
👉 Verification: **[DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md)** (pre/post checks)

---

## 🛠️ Configuration Files Explained

### `.env.example`
Template showing all required environment variables:
- ALIS credentials (for local automation)
- HubSpot API token (for syncing)
- Server config (port, environment)

**Keep updated** if you add new env variables.

### `package.json`
Enhanced with scripts for the complete workflow:
- `dev` — Local development
- `deploy` — Sync to HubSpot
- `setup` — One-time initialization

### `scripts/deploy-to-hubspot.js`
Main deployment automation:
- Reads templates from `server/automation/templates/`
- Authenticates with HubSpot API
- Syncs templates as custom objects
- Logs deployment for audit trail

### `.github/workflows/deploy.yml`
Optional CI/CD for GitHub Actions:
- Lints code
- Runs tests
- Deploys to HubSpot on push to main/develop

**To enable:** Push `.github/workflows/deploy.yml` to GitHub

---

## 🎓 Learning Path

**Day 1: Get Started**
1. Run `npm run setup`
2. Edit `server/.env`
3. Run `npm run dev`
4. Open http://localhost:5173

**Day 2: Create First Template**
1. Create `server/automation/templates/my-template.json`
2. Test locally in the UI
3. Commit & push
4. Watch auto-deploy happen

**Day 3: Full Workflow**
1. Edit templates
2. Update client UI
3. Commit & push
4. Verify sync in HubSpot

---

## ❓ FAQ

### Q: How do I deploy without pushing?
```bash
npm run deploy
```

### Q: Can I skip auto-deploy on push?
```bash
git push --no-verify
```

### Q: Where's my HubSpot token?
HubSpot → Settings → Integrations → Private apps → Copy token

### Q: What if `.env` is already committed?
```bash
git rm --cached server/.env
git commit -m "Remove .env from git"
```

### Q: Do I need GitHub Actions?
No, it's optional. Git hooks alone provide auto-deployment.

### Q: Can I deploy to dev and prod separately?
Yes: `npm run deploy:dev` or `npm run deploy:prod`

---

## 🔐 Security Reminders

- 🚫 **Never** commit `.env` to git
- 🚫 **Never** paste credentials in commits/comments
- 🚫 **Never** share `.env` via Slack/email
- ✅ **Do** use environment variables
- ✅ **Do** rotate tokens quarterly
- ✅ **Do** use `.gitignore` properly

---

## 📞 Next Steps

1. **Configure HubSpot**
   - Create private app: HubSpot → Settings → Integrations
   - Copy token and portal ID to `server/.env`

2. **Create First Template**
   - Add JSON file to `server/automation/templates/`
   - Test locally with `npm run dev`

3. **Test Deployment**
   - Commit template file
   - Push to `main` or `develop`
   - Watch auto-deploy happen

4. **Start Building**
   - Add more templates
   - Update the client UI
   - Deploy frequently

---

**You're all set! 🚀**

For detailed help, see [DEVELOPMENT.md](./DEVELOPMENT.md) or [WORKFLOW.md](./WORKFLOW.md).
