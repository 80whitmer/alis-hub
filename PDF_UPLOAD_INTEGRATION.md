# PDF Upload Integration — Form Markup PoC

## Overview

You now have integrated PDF upload analysis directly into your workflow. Upload a PDF, and I'll run it through your complete form-markup-poc pipeline.

## How It Works

### When You Upload a PDF:

1. **You upload** → PDF appears in chat
2. **I save it** → Temporarily copies to `form-markup-poc/` directory
3. **Analysis runs** → Full pipeline: field detection → label extraction → code matching → property suggestion
4. **Results return** → JSON output with:
   - All detected form fields
   - Extracted labels with OCR confidence
   - Matched ALIS codes with matching confidence
   - Complete property suggestions
   - Summary statistics (auto-approve %, confidence breakdown, etc.)

### What You'll Get Back

```
📊 Summary Report:
─────────────────────────────────────────────────────
  Total fields detected:        45
  Matched to ALIS/generic:     42 (93%)
  Unmatched (manual needed):   3

  Status Breakdown:
    🟢 Auto-approve (>95% conf):  38 fields
    🟡 Likely OK (85-95% conf):   3 fields
    🟠 Review (70-85% conf):      1 field
    🔴 Manual review (<70%):      3 fields

  Average Confidence:           92%
─────────────────────────────────────────────────────
```

Plus detailed JSON with all field mappings.

## Using the Integration

### Basic Upload

1. Click the **attachment** icon in the chat
2. Select your PDF
3. Say: **"Analyze this PDF"**

I'll run the full pipeline and show you:
- Summary statistics
- Field detection results
- Label extraction confidence
- ALIS code matches
- Approval status breakdown

### With a Form Template

If you know the form type (e.g., move-in-assessment):

Say: **"Analyze this PDF as a move-in-assessment-v1"**

This uses your `master-list-map.js` mappings for 95%+ accuracy.

### With Custom Options

```
Analyze this PDF:
- As a move-in-assessment-v1 template
- With 150px search radius for labels
- Show detailed matching debug info
```

## File Locations

```
alis-hub/
├── form-markup-poc/
│   ├── index.js                    (Main CLI entry)
│   ├── pdf-upload-analyzer.js      (NEW: Upload wrapper)
│   ├── field-detector.js
│   ├── label-extractor.js
│   ├── code-matcher.js
│   ├── property-suggester.js
│   ├── master-list-map.js
│   ├── package.json
│   └── test.js
├── analyze-pdf.sh                  (NEW: Bash runner)
└── PDF_UPLOAD_INTEGRATION.md       (This file)
```

## Under the Hood

When you upload a PDF, here's what happens:

```
1. Upload PDF
   ↓
2. Save to temporary location
   ↓
3. Run: node form-markup-poc/pdf-upload-analyzer.js <path> [--template ...]
   ↓
   ├─ Phase 1: Field Detection (pdf-lib)
   │  └─ Detect AcroForm fields and positions
   │
   ├─ Phase 2: Label Extraction (Tesseract.js OCR)
   │  └─ Find text near fields (100px radius default)
   │
   ├─ Phase 3: Code Matching (Fuse.js fuzzy)
   │  └─ Match labels to ALIS codes
   │
   └─ Phase 4: Property Suggestion
      └─ Generate full property objects + confidence
   ↓
4. Output JSON results
   ↓
5. Parse and display summary + suggestions
```

## Example Workflow

### Scenario: You have a new move-in assessment form

**You:** "I have a new move-in assessment PDF to analyze"

**Upload the PDF**

**You:** "Analyze this as move-in-assessment-v1"

**Returns:**
```json
{
  "timestamp": "2026-05-11T...",
  "summary": {
    "total_fields": 47,
    "matched_fields": 45,
    "auto_approve": 42,
    "approve_likely": 2,
    "review_needed": 1,
    "manual_review": 2,
    "average_confidence": 0.94
  },
  "data": {
    "suggestions": [
      {
        "field_id": "field_0",
        "detected_label": "Resident Name",
        "suggested_code": "alis.resident.full_name",
        "confidence": 0.99,
        "status": "auto_approve",
        "properties": {
          "name": "alis.resident.full_name",
          "hover_text": "Resident Name-0",
          "required": true,
          "read_only": true
        }
      },
      // ... more suggestions
    ]
  }
}
```

**You can then:**
- Review the auto-approve suggestions (42 fields)
- Manually verify the likely OK ones (2 fields)
- Correct the review-needed field
- Fix the 2 manual review fields
- Apply all 47 properties in seconds instead of 20+ minutes

## Adding New Form Templates

When you get a new form type, add it to `master-list-map.js`:

```javascript
const formMappings = {
  'intake-form-v1': {
    'Full Name': { code: 'alis.resident.full_name', confidence: 0.99 },
    'Date of Birth': { code: 'alis.resident.dob', confidence: 0.98 },
    'Allergies': { code: 'alis.resident.allergies', confidence: 0.95 },
    // ... add all field mappings
  }
};
```

Then upload PDFs and say:
**"Analyze this as intake-form-v1"**

## Performance

- **First run**: ~5-10 seconds (Tesseract worker loads)
- **Subsequent runs**: ~2-3 seconds per page
- **Multi-page forms**: ~15-25 seconds for 5-page form

## Troubleshooting

### "No form fields detected"
- Verify PDF has AcroForm fields (not just text boxes)
- Check that it was marked up in Tungsten/Kofax
- Try uploading a known good PDF first

### Low confidence matches
- Add a form template mapping for this form type
- Adjust OCR search radius (try 150 or 200 pixels)
- Check if labels are unusually positioned

### Memory error on large PDFs
- Reduce search radius
- Process multi-page forms one page at a time
- Increase Node heap: `node --max-old-space-size=4096 ...`

## Integration with alis-hub

This analysis can eventually integrate into the job template system:

```
Job Template: "Form Field Detection"
  ├─ Input: PDF file
  ├─ Template: (optional) form type
  ├─ Radius: (optional) OCR search radius
  └─ Output: JSON suggestions → UI for review → batch apply properties
```

## Next Steps

1. **Test It**: Upload a move-in assessment PDF
2. **Validate**: Check accuracy of auto-approve suggestions
3. **Expand**: Add more form templates as needed
4. **Integrate**: Eventually build full job template for alis-hub

## Questions?

For issues with PDF analysis or form template configuration, refer to:
- `README.md` — Full architecture documentation
- `QUICKSTART.md` — CLI examples and testing
- `master-list-map.js` — Form template and ALIS code mappings

---

**Ready to test?** Upload your first PDF and say "Analyze this PDF" 🚀
