/**
 * label-extractor.js
 *
 * Extracts text labels from PDF using OCR
 * Tesseract.js is used for client-side OCR without requiring system binaries
 */

const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

/**
 * Extract text labels near detected fields using OCR
 *
 * @param {string} pdfPath - Path to PDF file
 * @param {array} detectedFields - Fields detected by field-detector.js
 * @param {number} searchRadius - Distance in pixels to search for labels (default: 100)
 * @returns {array} Array of {field_id, detected_label, confidence, text_position}
 */
async function extractTextNearFields(pdfPath, detectedFields, searchRadius = 100) {
  console.log(`\n🔤 Extracting text labels from PDF (search radius: ${searchRadius}px)...`);

  try {
    // OCR the entire PDF
    console.log('   Running Tesseract.js OCR...');
    const ocrResult = await Tesseract.recognize(pdfPath, 'eng', {
      logger: (m) => {
        // Log progress
        if (m.status === 'recognizing text') {
          const progress = Math.round(m.progress * 100);
          if (progress % 25 === 0) {
            process.stdout.write(`   OCR progress: ${progress}%\r`);
          }
        }
      }
    });

    console.log('   OCR progress: 100%                 ');

    // Extract words from OCR result
    const words = ocrResult.data.words || [];
    console.log(`   Found ${words.length} words via OCR`);

    if (words.length === 0) {
      console.warn('   ⚠️ OCR returned no words. PDF may be scanned image or OCR failed.');
      return detectedFields.map((f, i) => ({
        field_id: f.id,
        detected_label: null,
        confidence: 0,
        reason: 'OCR failed'
      }));
    }

    // For each field, find nearest text labels
    const fieldLabels = [];

    for (const field of detectedFields) {
      if (!field.position) {
        fieldLabels.push({
          field_id: field.id,
          detected_label: null,
          confidence: 0,
          reason: 'No position data'
        });
        continue;
      }

      // Find all words within search radius
      const fieldCenter = {
        x: field.position.x + field.position.width / 2,
        y: field.position.y + field.position.height / 2
      };

      const nearbyWords = words.filter((word) => {
        const wordCenter = {
          x: (word.bbox.x0 + word.bbox.x1) / 2,
          y: (word.bbox.y0 + word.bbox.y1) / 2
        };
        const distance = getDistance(fieldCenter, wordCenter);
        return distance < searchRadius;
      });

      if (nearbyWords.length === 0) {
        fieldLabels.push({
          field_id: field.id,
          detected_label: null,
          confidence: 0,
          reason: 'No text found nearby'
        });
        continue;
      }

      // Sort by distance and take closest word or nearby label
      const sorted = nearbyWords.sort((a, b) => {
        const aDist = getDistance(fieldCenter, {
          x: (a.bbox.x0 + a.bbox.x1) / 2,
          y: (a.bbox.y0 + a.bbox.y1) / 2
        });
        const bDist = getDistance(fieldCenter, {
          x: (b.bbox.x0 + b.bbox.x1) / 2,
          y: (b.bbox.y0 + b.bbox.y1) / 2
        });
        return aDist - bDist;
      });

      // Try to combine nearby words into a meaningful label
      const label = extractMeaningfulLabel(sorted, fieldCenter);

      fieldLabels.push({
        field_id: field.id,
        detected_label: label.text,
        confidence: label.confidence,
        text_position: label.position,
        nearbyWords: sorted.slice(0, 3).map((w) => w.text) // Debug: show nearby words
      });
    }

    return fieldLabels;

  } catch (err) {
    console.error('❌ Error extracting text:', err.message);
    throw err;
  }
}

/**
 * Extract meaningful label from nearby words
 *
 * Strategy:
 * 1. Look for words directly above/left of field (labels are usually positioned this way)
 * 2. Combine adjacent words if they're close together
 * 3. Return the most relevant label
 */
function extractMeaningfulLabel(sortedWords, fieldCenter) {
  if (!sortedWords || sortedWords.length === 0) {
    return { text: null, confidence: 0 };
  }

  // Prefer words above or to the left of field
  const beforeField = sortedWords.filter((word) => {
    return word.bbox.y1 < fieldCenter.y; // Above field
  });

  const candidates = beforeField.length > 0 ? beforeField : sortedWords;

  // Take the closest one
  const best = candidates[0];

  // Try to combine with adjacent words to get full label
  const label = combineAdjacentWords(candidates, best);

  return {
    text: label,
    confidence: best.confidence / 100, // Tesseract confidence is 0-100
    position: { x: Math.round(best.bbox.x0), y: Math.round(best.bbox.y0) }
  };
}

/**
 * Combine adjacent words into a meaningful label
 * E.g., "Community" + "Name" -> "Community Name"
 */
function combineAdjacentWords(candidates, startWord) {
  if (!startWord) return null;

  const words = [startWord.text];
  const threshold = 50; // pixels - words closer than this are considered adjacent

  let lastWord = startWord;

  for (const word of candidates) {
    if (word === startWord) continue;

    const distance = Math.abs(word.bbox.x0 - lastWord.bbox.x1);

    if (distance < threshold && words.length < 4) {
      // Adjacent word, add it
      words.push(word.text);
      lastWord = word;
    }
  }

  return words.join(' ');
}

/**
 * Calculate Euclidean distance between two points
 */
function getDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pretty print extracted labels
 */
function printLabels(fieldLabels) {
  console.log('\n📝 Extracted Labels:');
  console.log('─'.repeat(120));

  for (const label of fieldLabels) {
    const labelText = label.detected_label || '(none)';
    const conf = (label.confidence * 100).toFixed(0);
    const nearbyStr = label.nearbyWords ? ` [nearby: ${label.nearbyWords.join(', ')}]` : '';

    console.log(
      `  ${label.field_id.padEnd(12)} | ${labelText.padEnd(40)} | ${conf.padStart(3)}%${nearbyStr}`
    );
  }
  console.log('─'.repeat(120));
}

module.exports = {
  extractTextNearFields,
  printLabels
};
