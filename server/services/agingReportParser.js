const { PDFParse } = require('pdf-parse');

/**
 * Parses Dave Johnson's weekly "Customer Aging Report" PDF (Intacct,
 * subject line contains "Aging") into structured rows — one per customer,
 * with the six standard aging buckets (current/1-30/31-60/61-90/91-120/
 * 121+) plus a total. See HUBSPOT_BRIDGE_SCHEMA.md's design philosophy for
 * why this is a manual-upload bridge rather than automatic Gmail
 * ingestion (per Aaron, Sep 2026): matching client accounts correctly
 * matters more than saving him a weekly download+upload.
 *
 * getTable() (this library's structured-table extractor) finds nothing —
 * confirmed live against a real report: this PDF has no visible grid
 * lines, just positioned text columns, so getTable()'s border-detection
 * heuristic has nothing to latch onto. Falls back to getText() plus a
 * hand-rolled line parser instead.
 *
 * A row is 1-3 physical lines depending on where the customer name
 * happens to wrap (confirmed live, both shapes occur in the same real
 * report):
 *   "22933154600 Metta Country Village 0.00 520.80 0.00 0.00 0.00 0.00 520.80"
 *   "22972552570 Titan The Willows Assisted Living & Memory\nCare\n0.00 881.25 0.00 0.00 0.00 0.00 881.25"
 * Rather than special-case 2 vs. 3 lines, this accumulates lines into a
 * buffer until the buffer's trailing tokens are exactly 7 money-shaped
 * values — true for every wrap shape actually observed, and for the
 * ordinary single-line case too (which just satisfies it immediately).
 */

const MONEY_RE = /^\(?-?[\d,]+\.\d{2}\)?$/;
const BOILERPLATE_RE = /^(Location:|Department:|Medtelligent Inc$|Customer Aging Report$|Based on:|Customer ID\s+Customer name|Report date|Created on:|--\s*\d+\s*of\s*\d+\s*--$)/;
const GRAND_TOTALS_RE = /^Grand totals\s+(.+)$/;
const AS_OF_DATE_RE = /As of date:\s*(\d{2}\/\d{2}\/\d{4})/;

function parseMoney(token) {
  const negative = token.startsWith('(') && token.endsWith(')');
  const digits = token.replace(/[(),]/g, '');
  const value = Number(digits);
  return negative ? -value : value;
}

/**
 * @param {string} text - raw text from pdf-parse's getText()
 * @returns {{ asOfDate: string|null, rows: Array, grandTotal: object|null, warnings: string[] }}
 */
function parseAgingReportLines(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const warnings = [];
  let asOfDate = null;
  let grandTotal = null;
  let buffer = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    warnings.push(`Unresolved line(s) before giving up on this row: "${buffer.join(' ')}"`);
    buffer = [];
  };

  for (const line of lines) {
    if (!asOfDate) {
      const m = line.match(AS_OF_DATE_RE);
      if (m) asOfDate = m[1];
    }

    const grandMatch = line.match(GRAND_TOTALS_RE);
    if (grandMatch) {
      flushBuffer();
      const tokens = grandMatch[1].trim().split(/\s+/);
      if (tokens.length === 7 && tokens.every((t) => MONEY_RE.test(t))) {
        const [current, d1_30, d31_60, d61_90, d91_120, d121Plus, total] = tokens.map(parseMoney);
        grandTotal = { current, d1_30, d31_60, d61_90, d91_120, d121Plus, total };
      } else {
        warnings.push(`"Grand totals" line didn't parse as 7 money values: "${line}"`);
      }
      continue;
    }

    if (BOILERPLATE_RE.test(line)) {
      flushBuffer(); // a boilerplate line breaking up an in-progress buffer means that buffer never resolved
      continue;
    }

    buffer.push(line);
    const tokens = buffer.join(' ').split(/\s+/);
    const trailing = tokens.slice(-7);
    if (trailing.length === 7 && trailing.every((t) => MONEY_RE.test(t))) {
      const nameTokens = tokens.slice(1, tokens.length - 7);
      const customerId = tokens[0];
      const customerName = nameTokens.join(' ');
      const [current, d1_30, d31_60, d61_90, d91_120, d121Plus, total] = trailing.map(parseMoney);
      if (customerName) {
        rows.push({ customerId, customerName, current, d1_30, d31_60, d61_90, d91_120, d121Plus, total });
      } else {
        warnings.push(`Row parsed with no customer name — skipped: "${buffer.join(' ')}"`);
      }
      buffer = [];
    }
  }
  flushBuffer();

  return { asOfDate, rows, grandTotal, warnings };
}

/** Parses a Buffer (the raw uploaded PDF bytes) end to end. */
async function parseAgingReportPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return parseAgingReportLines(result.text);
  } finally {
    await parser.destroy();
  }
}

module.exports = { parseAgingReportPdf, parseAgingReportLines };
