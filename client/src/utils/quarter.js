/**
 * Calculate the last completed quarter dates
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: 'YYYY-QX' }
 */
export function getLastCompletedQuarter(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-based (0 = Jan, 11 = Dec)

  let quarterStart, quarterEnd, quarterLabel;

  // Determine which quarter we're in and return the last COMPLETED quarter
  if (month < 3) {
    // Jan-Mar (Q1) — last completed is previous year Q4
    quarterStart = new Date(year - 1, 9, 1); // Oct 1
    quarterEnd = new Date(year - 1, 11, 31); // Dec 31
    quarterLabel = `${year - 1}-Q4`;
  } else if (month < 6) {
    // Apr-Jun (Q2) — last completed is Q1
    quarterStart = new Date(year, 0, 1); // Jan 1
    quarterEnd = new Date(year, 2, 31); // Mar 31
    quarterLabel = `${year}-Q1`;
  } else if (month < 9) {
    // Jul-Sep (Q3) — last completed is Q2
    quarterStart = new Date(year, 3, 1); // Apr 1
    quarterEnd = new Date(year, 5, 30); // Jun 30
    quarterLabel = `${year}-Q2`;
  } else {
    // Oct-Dec (Q4) — last completed is Q3
    quarterStart = new Date(year, 6, 1); // Jul 1
    quarterEnd = new Date(year, 8, 30); // Sep 30
    quarterLabel = `${year}-Q3`;
  }

  return {
    start: quarterStart.toISOString().split('T')[0],
    end: quarterEnd.toISOString().split('T')[0],
    label: quarterLabel,
  };
}

/**
 * Format quarter label for display (e.g., "Q2 2026")
 */
export function formatQuarterLabel(label) {
  const [year, quarter] = label.split('-');
  return `${quarter} ${year}`;
}

/**
 * Most recent Sunday on/before referenceDate, as 'YYYY-MM-DD' — the default
 * "Week Ending" value for a new Weekly Wellness Scorecard job. If
 * referenceDate is itself a Sunday, returns that same date.
 *
 * Formats from local Y/M/D directly rather than `.toISOString()` — that
 * converts to UTC first, which silently rolls the date forward or back a
 * day for anyone west/east of UTC (e.g. 8pm Sunday in US Central is already
 * after midnight Monday in UTC), the same class of bug
 * server/automation/kpiExport.js's monthsInRange/daysInRange comments warn
 * about on the server side.
 */
export function getMostRecentSunday(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  d.setDate(d.getDate() - d.getDay());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
