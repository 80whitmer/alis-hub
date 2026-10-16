/**
 * excel-parser.js
 * Parse Excel files into JSON structures using exceljs
 */

import ExcelJS from 'exceljs';

export async function parseExcelFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Get first sheet
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('No worksheets found in Excel file');
    }

    // Convert to JSON with headers from first row
    const json = [];
    const headers = [];
    let isFirstRow = true;

    worksheet.eachRow((row) => {
      if (isFirstRow) {
        // Extract headers from first row
        row.eachCell((cell) => {
          headers.push(cell.value);
        });
        isFirstRow = false;
      } else {
        // Create object for each data row
        const obj = {};
        row.eachCell((cell, colNumber) => {
          obj[headers[colNumber - 1]] = cell.value;
        });
        json.push(obj);
      }
    });

    return json;
  } catch (err) {
    throw new Error(`Failed to parse Excel: ${err.message}`);
  }
}

/** Splits one CSV line into cells, respecting double-quoted fields that contain commas. */
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Parses a .csv/.xlsx/.xls file into an array of row objects keyed by its
 * header row — generic tabular import, not tied to any one job's column
 * shape (see mapRowsToSchemaItems for turning these into a specific job
 * field's item shape).
 *
 * For a multi-sheet workbook, picks the first sheet whose name
 * case-insensitively matches one of `preferredSheetNames`, falling back to
 * the first sheet — lets one uploaded workbook feed several different job
 * fields (e.g. a "Communities" sheet and a "Care Items" sheet), one sheet
 * per field's own Import control.
 */
export async function parseTabularFile(file, { preferredSheetNames = [] } = {}) {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = parseCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
      return obj;
    });
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const wanted = preferredSheetNames.filter(Boolean).map((s) => s.toLowerCase());
  const worksheet =
    workbook.worksheets.find((ws) => wanted.includes(ws.name.toLowerCase())) || workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheets found in file');

  const rows = [];
  const headers = [];
  let isFirstRow = true;
  worksheet.eachRow((row) => {
    if (isFirstRow) {
      row.eachCell((cell) => headers.push(String(cell.value ?? '').trim()));
      isFirstRow = false;
    } else {
      const obj = {};
      row.eachCell((cell, colNumber) => { obj[headers[colNumber - 1]] = cell.value; });
      rows.push(obj);
    }
  });
  return rows;
}

function triggerDownload(workbook, filename) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

/**
 * Generates and downloads a blank starter .xlsx for an array-of-objects job
 * field — one sheet, headers taken from each sub-property's title (the
 * same titles mapRowsToSchemaItems matches on, so a file built from this
 * template always re-imports cleanly), and one example row filled from the
 * schema's own `examples` where given. Generic — works for any array
 * field's sub-schema, not just Care Items.
 */
export async function downloadArrayFieldTemplate(fieldLabel, itemProperties) {
  const workbook = new ExcelJS.Workbook();
  const sheetName = (fieldLabel || 'Items').replace(/[[\]*?/\\:]/g, '').slice(0, 31) || 'Items';
  const sheet = workbook.addWorksheet(sheetName);
  const propEntries = Object.entries(itemProperties || {});

  sheet.columns = propEntries.map(([key, prop]) => ({
    header: prop.title || key,
    key,
    width: Math.max(18, (prop.title || key).length + 4),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(Object.fromEntries(propEntries.map(([key, prop]) => [key, prop.examples?.[0] ?? ''])));

  await triggerDownload(workbook, `${sheetName.replace(/[^a-z0-9]/gi, '-')}-Template.xlsx`);
}

/**
 * Maps parsed row objects onto an array field's own sub-schema shape by
 * matching each column header against a sub-property's key or title,
 * ignoring case/spaces/punctuation (so "Care Item Name", "care_item_name",
 * and "careItemName" all match a `name` property titled "Care Item Name").
 * Generic replacement for a per-template converter like
 * convertExcelToBillingItems below — works for any array-of-objects job
 * field's sub-schema without a bespoke mapping function.
 */
export function mapRowsToSchemaItems(rows, itemProperties) {
  const propEntries = Object.entries(itemProperties || {});
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  return rows
    .map((row) => {
      const item = {};
      for (const [propKey, propSchema] of propEntries) {
        const candidates = [propKey, propSchema.title].filter(Boolean).map(normalize);
        const matchHeader = Object.keys(row).find((h) => candidates.includes(normalize(h)));
        if (matchHeader !== undefined) {
          const raw = row[matchHeader];
          if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
            item[propKey] = String(raw).trim();
          }
        }
      }
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

/**
 * Convert Excel row structure to GL sync items
 * Handles various column naming conventions
 */
export function convertExcelToBillingItems(excelData) {
  if (!Array.isArray(excelData) || excelData.length === 0) {
    throw new Error('No data found in Excel file');
  }

  const items = excelData.map((row, idx) => {
    // Try to find name column (various naming conventions)
    const name =
      row['name'] ||
      row['Name'] ||
      row['Item Name'] ||
      row['item_name'] ||
      row['Billing Item'];

    if (!name) {
      throw new Error(`Row ${idx + 1}: Missing item name column`);
    }

    // Find GL columns (various conventions)
    const gl_old =
      row['GL Old'] ||
      row['gl_old'] ||
      row['Current GL'] ||
      row['current_gl'] ||
      row['GL_Old'];

    const gl_new =
      row['GL New'] ||
      row['gl_new'] ||
      row['New GL'] ||
      row['new_gl'] ||
      row['GL_New'];

    if (!gl_old || !gl_new) {
      throw new Error(
        `Row ${idx + 1} (${name}): Missing GL Old or GL New column`
      );
    }

    const item = {
      name: String(name).trim(),
      gl_old: String(gl_old).trim(),
      gl_new: String(gl_new).trim(),
    };

    // Add optional discount GL accounts
    const disc1_old =
      row['Disc1 Old'] ||
      row['disc1_old'] ||
      row['Discount 1 Old'] ||
      row['disc1_old'];
    const disc1_new =
      row['Disc1 New'] ||
      row['disc1_new'] ||
      row['Discount 1 New'] ||
      row['disc1_new'];

    if (disc1_old && disc1_new) {
      item.disc1_old = String(disc1_old).trim();
      item.disc1_new = String(disc1_new).trim();
    }

    const disc2_old =
      row['Disc2 Old'] ||
      row['disc2_old'] ||
      row['Discount 2 Old'] ||
      row['disc2_old'];
    const disc2_new =
      row['Disc2 New'] ||
      row['disc2_new'] ||
      row['Discount 2 New'] ||
      row['disc2_new'];

    if (disc2_old && disc2_new) {
      item.disc2_old = String(disc2_old).trim();
      item.disc2_new = String(disc2_new).trim();
    }

    return item;
  });

  return items;
}

/**
 * Validate GL account mapping items
 */
export function validateBillingItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array cannot be empty');
  }

  const errors = [];

  items.forEach((item, idx) => {
    if (!item.name) errors.push(`Item ${idx + 1}: Missing name`);
    if (!item.gl_old) errors.push(`Item ${idx + 1}: Missing gl_old`);
    if (!item.gl_new) errors.push(`Item ${idx + 1}: Missing gl_new`);

    if (item.disc1_old && !item.disc1_new) {
      errors.push(`Item ${idx + 1}: Has disc1_old but missing disc1_new`);
    }
    if (!item.disc1_old && item.disc1_new) {
      errors.push(`Item ${idx + 1}: Has disc1_new but missing disc1_old`);
    }

    if (item.disc2_old && !item.disc2_new) {
      errors.push(`Item ${idx + 1}: Has disc2_old but missing disc2_new`);
    }
    if (!item.disc2_old && item.disc2_new) {
      errors.push(`Item ${idx + 1}: Has disc2_new but missing disc2_old`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`);
  }

  return true;
}
