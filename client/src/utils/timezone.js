/**
 * Timezone utilities for converting UTC times to user's local timezone (Central Time)
 */

/**
 * Format a UTC ISO string to local timezone display
 * @param {string} isoString - ISO 8601 string (e.g., "2026-05-09T18:54:53.000Z")
 * @returns {string} Formatted time in user's local timezone
 */
export function formatLocalTime(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  } catch (err) {
    console.error('Error formatting time:', err);
    return isoString;
  }
}

/**
 * Format as date only (MM/DD/YYYY)
 */
export function formatLocalDate(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (err) {
    return isoString;
  }
}

/**
 * Format as time only (HH:MM:SS with timezone)
 */
export function formatLocalTimeOnly(isoString) {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  } catch (err) {
    return isoString;
  }
}

/**
 * Get user's timezone offset (e.g., "CST" or "CDT")
 */
export function getUserTimezone() {
  const date = new Date();
  const timeZoneString = date.toLocaleString('en-US', { timeZoneName: 'short' });
  const tz = timeZoneString.split(' ').pop();
  return tz;
}

/**
 * Get user's full timezone name (e.g., "Central Standard Time")
 */
export function getUserTimezoneFull() {
  const date = new Date();
  const timeZoneString = date.toLocaleString('en-US', { timeZoneName: 'long' });
  const parts = timeZoneString.split(' ');
  return parts.slice(parts.length - 3).join(' ');
}

/**
 * Calculate duration between two ISO strings
 * Returns human-readable format like "5 days, 2 hours, 30 minutes"
 */
export function formatDuration(startIsoString, endIsoString) {
  if (!startIsoString || !endIsoString) return 'N/A';
  try {
    const start = new Date(startIsoString);
    const end = new Date(endIsoString);
    const diffMs = Math.abs(end - start);
    const diffSecs = Math.floor(diffMs / 1000);

    const days = Math.floor(diffSecs / 86400);
    const hours = Math.floor((diffSecs % 86400) / 3600);
    const minutes = Math.floor((diffSecs % 3600) / 60);
    const seconds = diffSecs % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
  } catch (err) {
    console.error('Error calculating duration:', err);
    return 'N/A';
  }
}
