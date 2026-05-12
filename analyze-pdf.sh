#!/bin/bash

# analyze-pdf.sh
#
# Analyze an uploaded PDF through the form-markup-poc pipeline
# Usage: bash analyze-pdf.sh <pdf_path> [template_name]
#
# Example:
#   bash analyze-pdf.sh "/path/to/uploaded_form.pdf" move-in-assessment-v1
#

set -e

PDF_PATH="${1:-.}"
TEMPLATE="${2:}"
OUTPUT_FILE=""

# Check if file exists
if [ ! -f "$PDF_PATH" ]; then
  echo "❌ Error: PDF file not found at: $PDF_PATH"
  exit 1
fi

# Navigate to form-markup-poc directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POC_DIR="$SCRIPT_DIR/form-markup-poc"

if [ ! -d "$POC_DIR" ]; then
  echo "❌ Error: form-markup-poc directory not found at: $POC_DIR"
  exit 1
fi

# Check if node_modules exists, if not install dependencies
if [ ! -d "$POC_DIR/node_modules" ]; then
  echo "📦 Installing dependencies..."
  cd "$POC_DIR"
  npm install
  cd - > /dev/null
fi

# Generate output filename
OUTPUT_FILE="/tmp/form-analysis-$(date +%s).json"

# Run the analyzer
cd "$POC_DIR"
echo "🔍 Analyzing PDF: $(basename "$PDF_PATH")"

if [ -n "$TEMPLATE" ]; then
  echo "📋 Using template: $TEMPLATE"
  node pdf-upload-analyzer.js "$PDF_PATH" --template "$TEMPLATE" --output "$OUTPUT_FILE"
else
  node pdf-upload-analyzer.js "$PDF_PATH" --output "$OUTPUT_FILE"
fi

# Output the results
echo ""
echo "✅ Analysis complete!"
echo "📁 Results saved to: $OUTPUT_FILE"
echo ""
echo "To view results:"
echo "  cat $OUTPUT_FILE"
echo ""

# Show file size
FILE_SIZE=$(wc -c < "$OUTPUT_FILE")
echo "📊 Output file size: $((FILE_SIZE / 1024)) KB"
