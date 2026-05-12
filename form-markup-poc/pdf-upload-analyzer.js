#!/usr/bin/env node

/**
 * pdf-upload-analyzer.js
 *
 * Wrapper to process uploaded PDFs through the form-markup-poc pipeline.
 * Accepts a PDF file path, runs the full analysis, and outputs results.
 *
 * Usage:
 *   node pdf-upload-analyzer.js <pdf_path> [--output results.json] [--template form-type]
 */

const fs = require('fs');
const path = require('path');
const fieldDetector = require('./field-detector');
const labelExtractor = require('./label-extractor');
const codeMatcher = require('./code-matcher');
const propertySuggester = require('./property-suggester');

async function analyzeUploadedPdf(pdfPath, options = {}) {
  try {
    // Validate file exists
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const fileName = path.basename(pdfPath);
    const timestamp = new Date().toISOString();

    console.log(`\n📄 Analyzing: ${fileName}`);
    console.log(`⏱️  Started: ${timestamp}\n`);

    // Phase 1: Field Detection
    console.log('🔍 Phase 1: Detecting form fields...');
    const detectedFields = await fieldDetector.detectFields(pdfPath);
    console.log(`   ✓ Found ${detectedFields.length} form fields\n`);

    if (detectedFields.length === 0) {
      console.log('⚠️  No form fields detected in this PDF.');
      console.log('   The PDF may not be marked up with AcroForm fields.');
      return {
        success: false,
        error: 'No form fields detected',
        fileName,
        timestamp,
      };
    }

    // Phase 2: Label Extraction
    console.log('📝 Phase 2: Extracting labels via OCR...');
    const fieldLabels = await labelExtractor.extractLabels(pdfPath, detectedFields, options.radius || 100);
    console.log(`   ✓ Extracted labels for ${fieldLabels.length} fields\n`);

    // Phase 3: Code Matching
    console.log('🎯 Phase 3: Matching to ALIS codes...');
    const suggestions = codeMatcher.matchCodes(
      fieldLabels,
      options.template || null
    );
    console.log(`   ✓ Matched ${suggestions.filter(s => s.suggested_code).length} fields to codes\n`);

    // Phase 4: Property Suggestion
    console.log('⚙️  Phase 4: Generating property suggestions...');
    const properties = propertySuggester.generateProperties(suggestions);
    const summary = propertySuggester.generateSummary(properties);
    console.log(`   ✓ Generated properties for all fields\n`);

    // Prepare output
    const result = {
      success: true,
      timestamp,
      input: {
        pdf: fileName,
        fullPath: pdfPath,
        formTemplate: options.template || null,
        searchRadius: options.radius || 100,
      },
      summary,
      data: {
        detectedFields,
        fieldLabels,
        suggestions: properties,
      },
    };

    // Print summary
    printSummary(summary);

    // Save JSON if requested
    if (options.output) {
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n💾 Results saved to: ${outputPath}\n`);
    }

    return result;

  } catch (err) {
    console.error(`\n❌ Error analyzing PDF: ${err.message}\n`);
    return {
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

function printSummary(summary) {
  console.log('📊 Summary Report:');
  console.log('─'.repeat(60));
  console.log(`  Total fields detected:        ${summary.total_fields}`);
  console.log(`  Matched to ALIS/generic:     ${summary.matched_fields} (${Math.round(summary.matched_fields / summary.total_fields * 100)}%)`);
  console.log(`  Unmatched (manual needed):   ${summary.total_fields - summary.matched_fields}`);
  console.log();
  console.log('  Status Breakdown:');
  console.log(`    🟢 Auto-approve (>95% conf):  ${summary.auto_approve} fields`);
  console.log(`    🟡 Likely OK (85-95% conf):   ${summary.approve_likely} fields`);
  console.log(`    🟠 Review (70-85% conf):      ${summary.review_needed} fields`);
  console.log(`    🔴 Manual review (<70%):      ${summary.manual_review} fields`);
  console.log();
  console.log(`  Average Confidence:           ${summary.average_confidence.toFixed(0)}%`);
  console.log('─'.repeat(60));
  console.log();
}

// CLI Support
if (require.main === module) {
  const args = require('yargs')
    .usage('Usage: $0 <pdf_path> [options]')
    .positional('pdf_path', {
      describe: 'Path to the PDF file to analyze',
      type: 'string',
    })
    .option('output', {
      alias: 'o',
      describe: 'Save results to JSON file',
      type: 'string',
    })
    .option('template', {
      alias: 't',
      describe: 'Form template name (e.g., move-in-assessment-v1)',
      type: 'string',
    })
    .option('radius', {
      alias: 'r',
      describe: 'OCR search radius in pixels (default: 100)',
      type: 'number',
      default: 100,
    })
    .option('verbose', {
      alias: 'v',
      describe: 'Enable verbose output',
      type: 'boolean',
    })
    .demandCommand(1, 'Please provide a PDF file path')
    .argv;

  const pdfPath = args.pdf_path;
  const options = {
    output: args.output,
    template: args.template,
    radius: args.radius,
    verbose: args.verbose,
  };

  analyzeUploadedPdf(pdfPath, options).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = {
  analyzeUploadedPdf,
};
