/**
 * Loader for the ALIS 500 benchmark dataset.
 *
 * Each quarter's figures (pulled from the "ALIS 500 Occupancy Report" and
 * "ALIS 500 Clinical Report" PDFs) live in their own dated JSON file under
 * automation/data/ — drop in a new alis500-benchmarks-<quarter>.json file
 * each quarter rather than overwriting this one, so historical QBRs stay
 * reproducible against the benchmark that was current at the time.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'automation', 'data');
const FILE_PATTERN = /^alis500-benchmarks-(\d{4}-Q[1-4])\.json$/i;

let cache = null;

function loadAll() {
  if (cache) return cache;

  const files = fs.readdirSync(DATA_DIR).filter((f) => FILE_PATTERN.test(f));
  if (files.length === 0) {
    throw new Error(`No ALIS 500 benchmark files found in ${DATA_DIR}`);
  }

  cache = files
    .map((file) => {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      return JSON.parse(raw);
    })
    .sort((a, b) => (a.quarter > b.quarter ? -1 : 1)); // newest first

  return cache;
}

function getLatestBenchmarks() {
  return loadAll()[0];
}

function getBenchmarksForQuarter(quarter) {
  const match = loadAll().find((b) => b.quarter === quarter);
  if (!match) throw new Error(`No ALIS 500 benchmark data for quarter ${quarter}`);
  return match;
}

function listAvailableQuarters() {
  return loadAll().map((b) => b.quarter);
}

module.exports = { getLatestBenchmarks, getBenchmarksForQuarter, listAvailableQuarters };
