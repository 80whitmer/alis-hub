# HubSpot Deployment Checklist

Use this checklist before each deployment to ensure everything is configured correctly.

## ✅ Pre-Deployment Setup (One-Time)

- [ ] HubSpot private app token created and copied
- [ ] Portal ID verified in HubSpot settings
- [ ] `.env` file created in `server/` directory
- [ ] `HUBSPOT_PRIVATE_APP_TOKEN` added to `.env`
- [ ] `HUBSPOT_PORTAL_ID` added to `.env`
- [ ] ALIS credentials added to `.env`
- [ ] Git hooks installed (`npm run setup:hooks`)
- [ ] `.env` is in `.gitignore` (verified not committed)

## ✅ Before Each Deployment

### Local Testing
- [ ] Code changes tested locally (`npm run dev`)
- [ ] No console errors in browser or terminal
- [ ] Templates are valid JSON (use jsonlint if unsure)
- [ ] `.env` file has valid HubSpot credentials

### Git Status
- [ ] All changes committed to a feature branch
- [ ] Branch name follows convention: `feature/*`, `fix/*`, `docs/*`
- [ ] Commit messages are descriptive
- [ ] `.env` is NOT staged for commit

### Code Quality
- [ ] Run `npm run lint` (pass or warnings only)
- [ ] Run `npm run test` (if tests exist)
- [ ] No hardcoded credentials in code or templates

## ✅ Deployment Steps

### Option A: Automatic (Post-Push)
```bash
# 1. Verify you're on main or develop
git branch

# 2. Push to remote
git push

# 3. Post-push hook automatically:
#    - Detects branch
#    - Runs npm run deploy
#    - Syncs templates to HubSpot
#    - Logs deployment event
```

### Option B: Manual
```bash
# 1. Deploy immediately
npm run deploy

# 2. Check output for:
#    ✅ Authentication successful
#    ✅ Templates synced (count)
#    ✅ Deployment logged
```

## ✅ Post-Deployment Verification

- [ ] Deployment output shows "SUCCESS"
- [ ] Template count matches expected
- [ ] No error messages in deploy logs
- [ ] Check HubSpot for updated custom objects/properties
- [ ] Verify audit log entry exists in HubSpot
- [ ] Test automated workflow in HubSpot if applicable

## 🚨 If Deployment Fails

### Step 1: Identify the issue
```bash
npm run deploy  # Run again with verbose output
```

### Step 2: Check common issues

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid HubSpot token` | Bad/expired token | Regenerate in HubSpot settings |
| `No templates to sync` | Templates dir missing | Create `server/automation/templates/` |
| `Status: 401` | Authentication failed | Verify `.env` has correct token |
| `ENOENT` | File not found | Check template file paths |

### Step 3: If unresolved
- [ ] Verify `.env` values in HubSpot (copy fresh token)
- [ ] Check HubSpot API status page
- [ ] Verify network connectivity
- [ ] Review template JSON syntax (use online validator)
- [ ] Check git logs: `git log --oneline -5`

## 📊 Monitoring Deployments

### View deployment history
```bash
# See recent commits
git log --oneline --decorate main develop

# Check git hooks output (if push failed)
cat .git/hooks/post-push
```

### Check HubSpot sync status
1. HubSpot → Settings → Integrations → Activity Log
2. Look for "ALIS-HUB DEPLOY" entries
3. Verify timestamp and commit info

## 🔐 Security Checklist

- [ ] `.env` file is in `.gitignore`
- [ ] Never paste token in commit messages
- [ ] Don't screenshot `.env` or share with team chat
- [ ] Rotate token quarterly
- [ ] Remove token immediately if accidentally committed
- [ ] Use different tokens for dev/prod environments

## 📝 Deployment Log Template

When you deploy, log the details:

```
Date: 2026-05-09
Branch: main
Commit: abc1234
Templates Synced: 3
Status: ✅ SUCCESS
Notes: Added GL account automation template
```

---

**Need help?** See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed guide.
