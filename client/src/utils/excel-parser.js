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
