#!/usr/bin/env node
/**
 * Writes client/src/version.json from the repo's own commit count (Aaron,
 * Sep 2026: "update the Version [badge] based on the number of total
 * commits... and increment this version number each time we commit").
 * Computed fresh here rather than hand-maintained in package.json or
 * bumped by a git hook — a hook only fires on machines that ran
 * `npm run setup:hooks`, and a hook that rewrites+commits a version file on
 * every commit invites its own loop/merge-conflict problems. Regenerating
 * at the start of every `npm run dev`/`build` (see client/package.json's
 * predev/prebuild) is simpler and always correct, with no separate
 * installation step and nothing to keep in sync by hand.
 *
 * client/src/version.json IS committed (not gitignored) — a fresh clone,
 * or a build that bypasses npm's predev/prebuild hooks (e.g. running `vite`
 * directly), still has a working value to import rather than a broken
 * build. Real `npm run dev`/`build` invocations overwrite it with the
 * current count before every start; if that overwrite ever shows up as an
 * unrelated diff in an unrelated commit, that's just this file doing its
 * job, not something to chase down.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outPath = path.join(__dirname, '..', 'client', 'src', 'version.json');

let count;
try {
  count = execSync('git rev-list --count HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
} catch (err) {
  console.warn(`[generate-version] Could not read git history (${err.message}) — leaving version.json as-is.`);
  process.exit(0);
}

fs.writeFileSync(outPath, `${JSON.stringify({ version: count }, null, 2)}\n`);
console.log(`[generate-version] version.json -> ${count} (commit count)`);
