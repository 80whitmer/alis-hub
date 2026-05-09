# alis-hub Development Workflow — Quick Reference

## 🚀 One-Time Setup

```bash
npm run setup
# Edit server/.env with your credentials
```

---

## 📝 Daily Development

### Start working
```bash
npm run dev
```
→ Opens `http://localhost:5173` (client) + `http://localhost:3000` (server)

### Make changes
- Edit files in `server/` or `client/src/`
- Auto-reload on save ✨

### Commit & Deploy
```bash
git add .
git commit -m "your message"
git push
# ✅ Auto-deployed to HubSpot (if on main/develop)
```

---

## 📦 Common Tasks

| Task | Command |
|------|---------|
| **Add automation template** | Create `.json` in `server/automation/templates/` |
| **Update React UI** | Edit files in `client/src/` |
| **Run tests** | `npm run test` |
| **Check code quality** | `npm run lint` |
| **Deploy manually** | `npm run deploy` |
| **Deploy to prod** | `npm run deploy:prod` |

---

## 🔄 Git Workflow

```bash
# Feature branch (no auto-deploy)
git checkout -b feature/my-feature
git add .
git commit -m "feat: add feature"
git push

# Merge to main (auto-deploys)
git checkout main
git merge feature/my-feature
git push
# ✅ Auto-deployed!
```

---

## 🛑 Skip Auto-Deploy (If Needed)

```bash
git push --no-verify
```

---

## 📋 Template Format

```json
{
  "name": "Template Name",
  "version": "1.0.0",
  "description": "What this does",
  "steps": [
    { "type": "navigate", "url": "..." },
    { "type": "fill_form", "selectors": {...} },
    { "type": "click", "selector": "..." }
  ]
}
```

---

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| Dev server won't start | Check port 3000/5173 not in use |
| HubSpot deploy fails | Verify `HUBSPOT_PRIVATE_APP_TOKEN` in `.env` |
| Auto-deploy didn't trigger | Only main/develop auto-deploy; use `npm run deploy` on others |
| Changes not appearing | Hard refresh browser (Ctrl+Shift+R) |

---

## 📚 Full Docs

See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for detailed guide.

---

**Keep it simple. Ship often. 🎯**
