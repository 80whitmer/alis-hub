#!/bin/bash
# Double-click to start ALIS Hub. First run installs dependencies and asks
# a few setup questions (saved to server/.env); every run after that just
# starts the app. Close this window to stop the app.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet."
  echo "Go to https://nodejs.org, download the LTS installer, run it, then double-click this file again."
  echo ""
  read -r -p "Press Enter to close this window..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First-time setup — installing dependencies (a few minutes, text scrolling by is normal)..."
  npm install
fi

if [ ! -f server/.env ]; then
  node scripts/first-run-setup.js
fi

(
  sleep 4
  open http://localhost:5173 2>/dev/null
) &

echo "Starting ALIS Hub — leave this window open. Close it to stop the app."
npm run dev
