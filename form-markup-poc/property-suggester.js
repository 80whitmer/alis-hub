/**
 * property-suggester.js
 *
 * Generates complete property suggestions for fields based on matched codes
 */

const { matchLabelToCode } = require('./code-matcher');
const masterListMap = require('./master-list-map');

/**
 * Generate full property suggestions for all fields
 *
 * @param {array} fieldLabels - Output from label-extractor.js
 * @param {string} formTemplate - Form template ID
 * @returns {array} Array of suggestion objects
 */
function generatePropertySuggestions(fieldLabels, formTemplate = null) {
  console.log(`\n💡 Generating property suggestions...`);

  const suggestions = [];

  for (const label of fieldLabels) {
    // Match label to code
    const codeMatch = matchLabelToCode(label.detected_label, formTemplate);

    const suggestion = {
      field_id: label.field_id,
      detected_label: label.detected_label,
      suggested_code: codeMatch.code,
      confidence: codeMatch.confidence,
      match_type: codeMatch.match_type,
      reason: codeMatch.reason,
      status: determineStatus(codeMatch.confidence),
      properties: null,
      warning: null
    };

    if (codeMatch.code) {
      suggestion.properties = generateProperties(
        label.field_id,
        codeMatch.code,
        label.detected_label,
        codeMatch
      );
    } else {
      suggestion.warning = 'No matching ALIS or generic code found - manual review required';
    }

    suggestions.push(suggestion);
  }

  console.log(`   Generated ${suggestions.length} suggestions`);

  // Summary stats
  const statsByStatus = {};
  for (const s of suggestions) {
    statsByStatus[s.status] = (statsByStatus[s.status] || 0) + 1;
  }

  console.log(`   Status breakdown: ${JSON.stringify(statsByStatus)}`);

  return suggestions;
}

/**
 * Determine recommendation status based on confidence
 */
function determineStatus(confidence) {
  if (confidence >= 0.95) return 'auto_approve';
  if (confidence >= 0.80) return 'approve_likely';
  if (confidence >= 0.70) return 'review_needed';
  return 'manual_review';
}

/**
 * Generate full property object for a field
 */
function generateProperties(fieldId, code, label, codeMatch) {
  // Base properties (always the same)
  const props = {
    name: code,
    hover_text: generateHoverText(label, fieldId),
    font_size: 10,
    font: 'Helvetica',
    text_color: '#000000'
  };

  // Determine read-only
  props.read_only = codeMatch.read_only || false;

  // Determine required
  props.required = codeMatch.required || isRequiredField(code);

  return props;
}

/**
 * Generate hover text from label and field ID
 */
function generateHoverText(label, fieldId) {
  if (!label) {
    return fieldId;
  }

  // Clean label: remove special chars, keep only alphanumeric and spaces
  const clean = label
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .substring(0, 30); // Limit length

  // Extract field number
  const match = fieldId.match(/\d+/);
  const fieldNum = match ? match[0] : '0';

  return `${clean}-${fieldNum}`;
}

/**
 * Determine if field should be required
 */
function isRequiredField(code) {
  const requiredCodes = [
    'alis.resident.full_name',
    'alis.resident.dob',
    'generic.date_assessment.1',
    'generic.date_assessment.1',
    'generic.text_allergies.1',
    'generic.signature_physician.1',
    'generic.signature_staff.1'
  ];

  return requiredCodes.includes(code);
}

/**
 * Generate summary report
 */
function generateSummary(suggestions) {
  const summary = {
    total_fields: suggestions.length,
    matched_fields: suggestions.filter((s) => s.suggested_code).length,
    unmatched_fields: suggestions.filter((s) => !s.suggested_code).length,
    auto_approve: suggestions.filter((s) => s.status === 'auto_approve').length,
    approve_likely: suggestions.filter((s) => s.status === 'approve_likely').length,
    review_needed: suggestions.filter((s) => s.status === 'review_needed').length,
    manual_review: suggestions.filter((s) => s.status === 'manual_review').length,
    average_confidence: suggestions.filter((s) => s.suggested_code)
      ? (suggestions
          .filter((s) => s.suggested_code)
          .reduce((sum, s) => sum + s.confidence, 0) /
          suggestions.filter((s) => s.suggested_code).length)
          .toFixed(2)
      : 0
  };

  return summary;
}

/**
 * Pretty print suggestions
 */
function printSuggestions(suggestions) {
  console.log('\n📋 Property Suggestions:');
  console.log('─'.repeat(160));
  console.log(
    `  ${'Field ID'.padEnd(12)} | ${'Detected Label'.padEnd(35)} | ${'Suggested Code'.padEnd(35)} | ${'Conf'.padEnd(5)} | ${'Status'.padEnd(15)} | ${'Action'}`
  );
  console.log('─'.repeat(160));

  for (const suggestion of suggestions) {
    const conf = (suggestion.confidence * 100).toFixed(0);
    const codeStr = suggestion.suggested_code || '(none)';
    const statusStr = suggestion.status.replace(/_/g, ' ');
    const labelStr = suggestion.detected_label || '(none)';

    let actionStr = '';
    if (suggestion.status === 'auto_approve') {
      actionStr = '✅ Auto-apply';
    } else if (suggestion.status === 'approve_likely') {
      actionStr = '👀 Review';
    } else if (suggestion.warning) {
      actionStr = '⚠️ ' + suggestion.warning;
    }

    console.log(
      `  ${suggestion.field_id.padEnd(12)} | ${labelStr.padEnd(35)} | ${codeStr.padEnd(35)} | ${conf.padStart(3)}% | ${statusStr.padEnd(15)} | ${actionStr}`
    );
  }
  console.log('─'.repeat(160));
}

/**
 * Print summary statistics
 */
function printSummary(summary) {
  console.log('\n📊 Summary Report:');
  console.log('─'.repeat(80));
  console.log(`  Total fields detected:        ${summary.total_fields}`);
  console.log(`  Matched to ALIS/generic:     ${summary.matched_fields} (${((summary.matched_fields / summary.total_fields) * 100).toFixed(0)}%)`);
  console.log(`  Unmatched (manual needed):   ${summary.unmatched_fields}`);
  console.log(`\n  Status Breakdown:`);
  console.log(`    🟢 Auto-approve (>95% conf):  ${summary.auto_approve} fields`);
  console.log(`    🟡 Likely OK (85-95% conf):  ${summary.approve_likely} fields`);
  console.log(`    🟠 Review (70-85% conf):     ${summary.review_needed} fields`);
  console.log(`    🔴 Manual review (<70%):     ${summary.manual_review} fields`);
  console.log(`\n  Average Confidence:           ${(summary.average_confidence * 100).toFixed(0)}%`);
  console.log('─'.repeat(80));
}

module.exports = {
  generatePropertySuggestions,
  generateSummary,
  printSuggestions,
  printSummary
};
