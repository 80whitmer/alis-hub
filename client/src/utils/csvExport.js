/**
 * CSV export utilities for job details
 */

/**
 * Generate CSV content from GL sync details
 * @param {string} jobId - Job ID
 * @param {string} jobLabel - Job label/name
 * @param {Array} details - GL sync details array
 * @returns {string} CSV content
 */
export function generateGLSyncCSV(jobId, jobLabel, details) {
  const headers = [
    'Account Number',
    'Account Name',
    'Field Changed',
    'Old Value',
    'New Value',
    'Status',
    'Error',
    'Synced At'
  ];

  const rows = details.map(detail => [
    escapeCSVField(detail.account_number || ''),
    escapeCSVField(detail.account_name || ''),
    escapeCSVField(detail.field_changed || ''),
    escapeCSVField(detail.old_value || ''),
    escapeCSVField(detail.new_value || ''),
    escapeCSVField(detail.status || 'unknown'),
    escapeCSVField(detail.error || ''),
    escapeCSVField(formatTimestamp(detail.synced_at))
  ]);

  const headerRow = headers.map(h => escapeCSVField(h)).join(',');
  const dataRows = rows.map(row => row.join(',')).join('\n');

  return `GL Sync Details - ${jobLabel} (Job: ${jobId})\nExported: ${new Date().toLocaleString()}\n\n${headerRow}\n${dataRows}`;
}

/**
 * Escape special characters in CSV fields
 * @param {string} field - Field value to escape
 * @returns {string} Escaped field
 */
function escapeCSVField(field) {
  if (field === null || field === undefined) return '""';

  const stringField = String(field);

  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }

  return stringField;
}

/**
 * Format timestamp for CSV export
 */
function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * Trigger CSV download in browser
 * @param {string} csvContent - CSV content to download
 * @param {string} filename - Filename for download
 */
export function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generate filename with timestamp
 * @param {string} prefix - Prefix for filename (e.g., "gl-sync")
 * @returns {string} Filename with timestamp
 */
export function generateFilename(prefix = 'export') {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS
  return `${prefix}-${dateStr}-${timeStr}.csv`;
}
