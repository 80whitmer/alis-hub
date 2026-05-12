/**
 * code-matcher.js
 *
 * Matches extracted labels to ALIS/generic field codes
 * Uses fuzzy matching and form templates
 */

const Fuse = require('fuse.js');
const masterListMap = require('./master-list-map');

/**
 * Match a detected label to an ALIS or generic field code
 *
 * @param {string} label - Extracted label text
 * @param {string} formTemplate - Form template ID (e.g., 'move-in-assessment-v1')
 * @returns {object} {code, confidence, match_type, reason}
 */
function matchLabelToCode(label, formTemplate = null) {
  if (!label || label.trim() === '') {
    return { code: null, confidence: 0, reason: 'Empty label' };
  }

  const cleanLabel = label.trim();

  // 1. Try form template mapping first (highest priority)
  if (formTemplate) {
    const templateMatch = matchUsingFormTemplate(cleanLabel, formTemplate);
    if (templateMatch.code) {
      return { ...templateMatch, match_type: 'form_template' };
    }
  }

  // 2. Try exact match against ALIS fields
  const exactMatch = matchExact(cleanLabel);
  if (exactMatch) {
    return { ...exactMatch, match_type: 'exact' };
  }

  // 3. Try fuzzy match against ALIS fields
  const fuzzyMatch = matchFuzzy(cleanLabel);
  if (fuzzyMatch && fuzzyMatch.confidence > 0.70) {
    return { ...fuzzyMatch, match_type: 'fuzzy_alis' };
  }

  // 4. Try generic pattern matching
  const patternMatch = matchGenericPatterns(cleanLabel);
  if (patternMatch) {
    return { ...patternMatch, match_type: 'generic_pattern' };
  }

  // 5. No match found
  return {
    code: null,
    confidence: 0,
    reason: 'No match found'
  };
}

/**
 * Match using form template mappings
 */
function matchUsingFormTemplate(label, formTemplateId) {
  const templates = masterListMap.formMappings;
  const templateMap = templates[formTemplateId];

  if (!templateMap) {
    return { code: null };
  }

  // Direct match first
  if (templateMap[label]) {
    return {
      code: templateMap[label].code,
      confidence: templateMap[label].confidence || 0.95,
      required: templateMap[label].required || false,
      read_only: templateMap[label].read_only || false
    };
  }

  // Fuzzy match within template
  const fuzzyOptions = Object.keys(templateMap).map((key) => ({
    label: key,
    ...templateMap[key]
  }));

  const fuse = new Fuse(fuzzyOptions, {
    keys: ['label'],
    threshold: 0.35, // 65% match threshold
    minMatchCharLength: 3
  });

  const matches = fuse.search(label);

  if (matches.length > 0) {
    const best = matches[0];
    return {
      code: best.item.code,
      confidence: Math.min(0.95, Math.max(0.70, 1 - best.score)),
      required: best.item.required || false,
      read_only: best.item.read_only || false
    };
  }

  return { code: null };
}

/**
 * Exact match against ALIS field labels
 */
function matchExact(label) {
  const alisFields = masterListMap.alisFields;

  for (const [code, config] of Object.entries(alisFields)) {
    if (config.label.toLowerCase() === label.toLowerCase()) {
      return {
        code: code,
        confidence: 0.99,
        read_only: config.read_only || false,
        required: false
      };
    }
  }

  return null;
}

/**
 * Fuzzy match against ALIS field labels
 */
function matchFuzzy(label) {
  const alisFields = masterListMap.alisFields;
  const options = Object.entries(alisFields).map(([code, config]) => ({
    code,
    label: config.label,
    read_only: config.read_only || false
  }));

  const fuse = new Fuse(options, {
    keys: ['label'],
    threshold: 0.40, // 60% match threshold
    minMatchCharLength: 3
  });

  const matches = fuse.search(label);

  if (matches.length > 0) {
    const best = matches[0];
    return {
      code: best.item.code,
      confidence: Math.max(0.65, 1 - best.score),
      read_only: best.item.read_only
    };
  }

  return null;
}

/**
 * Match against generic pattern definitions
 */
function matchGenericPatterns(label) {
  const patterns = masterListMap.genericPatterns;
  const lower = label.toLowerCase();

  // Find best pattern match
  let bestMatch = null;
  let bestScore = 0;

  for (const [code, config] of Object.entries(patterns)) {
    for (const pattern of config.patterns || []) {
      if (lower.includes(pattern.toLowerCase())) {
        const score = config.confidence || 0.8;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            code: code,
            confidence: score,
            required: config.required || false,
            read_only: config.read_only || false
          };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Confidence-based suggestions with reasons
 */
function getConfidenceExplanation(confidence) {
  if (confidence >= 0.95) return '🟢 Excellent - auto-apply recommended';
  if (confidence >= 0.85) return '🟡 Good - review recommended';
  if (confidence >= 0.70) return '🟠 Fair - manual review needed';
  return '🔴 Low - likely needs manual correction';
}

/**
 * Pretty print match results
 */
function printMatches(matches, formTemplate = null) {
  console.log('\n🎯 Field Code Matches:');
  console.log('─'.repeat(140));
  if (formTemplate) {
    console.log(`   Using form template: ${formTemplate}`);
    console.log('─'.repeat(140));
  }

  for (const match of matches) {
    const confidence = (match.confidence * 100).toFixed(0);
    const code = match.code || '(none)';
    const explanation = getConfidenceExplanation(match.confidence);
    const reasonStr = match.reason ? ` [${match.reason}]` : '';

    console.log(
      `  ${match.field_id.padEnd(12)} | ${match.detected_label.padEnd(40)} | ${code.padEnd(35)} | ${confidence.padStart(3)}% | ${explanation}${reasonStr}`
    );
  }
  console.log('─'.repeat(140));
}

module.exports = {
  matchLabelToCode,
  getConfidenceExplanation,
  printMatches
};
