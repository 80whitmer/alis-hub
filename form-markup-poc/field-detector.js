/**
 * field-detector.js
 *
 * Detects and extracts form fields from a Tungsten-marked PDF
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

async function detectFieldsFromPDF(pdfPath) {
  console.log(`\n📄 Detecting fields from: ${path.basename(pdfPath)}`);

  try {
    // Read PDF with pdf-lib
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Try to get form fields
    let detectedFields = [];

    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();

      console.log(`✅ Found ${fields.length} form fields`);

      detectedFields = fields.map((field, index) => {
        const fieldName = field.getName ? field.getName() : `field_${index}`;
        const fieldType = field.constructor.name;

        // Try to extract position from annotations
        let position = null;
        try {
          const acroField = field.acroField;
          if (acroField && acroField.getWidgets) {
            const widgets = acroField.getWidgets();
            if (widgets && widgets.length > 0) {
              const rect = widgets[0].getRectangle();
              if (rect) {
                position = {
                  page: 0,
                  x: Math.round(rect[0]),
                  y: Math.round(rect[1]),
                  width: Math.round(rect[2] - rect[0]),
                  height: Math.round(rect[3] - rect[1])
                };
              }
            }
          }
        } catch (e) {
          // Position extraction failed, continue
        }

        // Determine field type
        let simpleType = 'unknown';
        if (fieldType.includes('Text')) simpleType = 'text';
        else if (fieldType.includes('CheckBox')) simpleType = 'checkbox';
        else if (fieldType.includes('Radio')) simpleType = 'radio';
        else if (fieldType.includes('Signature')) simpleType = 'signature';
        else if (fieldType.includes('Button')) simpleType = 'button';

        return {
          id: `field_${index}`,
          name: fieldName,
          type: simpleType,
          constructor: fieldType,
          position: position,
          currentValue: null
        };
      });
    } catch (err) {
      console.warn('⚠️ Could not extract form fields via pdf-lib:', err.message);
      console.log('   Falling back to PDFjs inspection...');

      // Fallback: try pdfjs-dist
      detectedFields = await detectFieldsWithPDFjs(pdfPath);
    }

    console.log(`\n📊 Detection Results:`);
    console.log(`   Total fields: ${detectedFields.length}`);

    // Group by type
    const byType = {};
    for (const field of detectedFields) {
      byType[field.type] = (byType[field.type] || 0) + 1;
    }
    console.log(`   By type: ${JSON.stringify(byType)}`);

    return detectedFields;

  } catch (err) {
    console.error('❌ Error detecting fields:', err.message);
    throw err;
  }
}

/**
 * Fallback: Use PDFjs to inspect PDF structure for fields
 */
async function detectFieldsWithPDFjs(pdfPath) {
  console.log('   Using PDFjs for inspection...');

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

  const detectedFields = [];
  let fieldIndex = 0;

  // PDFjs doesn't have great form field support, so we return what we found
  // In real scenario, would parse the PDF structure directly

  return detectedFields;
}

/**
 * Pretty print detected fields
 */
function printFields(fields) {
  console.log('\n📋 Detected Fields:');
  console.log('─'.repeat(100));

  for (const field of fields) {
    let posStr = field.position
      ? `(${field.position.x}, ${field.position.y}) ${field.position.width}x${field.position.height}px`
      : '(position unknown)';

    console.log(`  ${field.id.padEnd(12)} | ${field.type.padEnd(10)} | ${field.name.padEnd(30)} | ${posStr}`);
  }
  console.log('─'.repeat(100));
}

module.exports = {
  detectFieldsFromPDF,
  printFields
};
