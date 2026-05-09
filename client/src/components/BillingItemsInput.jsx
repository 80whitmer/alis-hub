/**
 * BillingItemsInput.jsx
 * Component for entering GL account billing items
 * Supports: Excel upload, JSON paste, manual entry
 */

import { useState } from 'react';
import {
  parseExcelFile,
  convertExcelToBillingItems,
  validateBillingItems,
} from '../utils/excel-parser';

export default function BillingItemsInput({ items, onChange, error, setError }) {
  const [activeTab, setActiveTab] = useState('table');
  const [jsonInput, setJsonInput] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);

  async function handleExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    try {
      const excelData = await parseExcelFile(file);
      const billingItems = convertExcelToBillingItems(excelData);
      validateBillingItems(billingItems);
      onChange(billingItems);
      setActiveTab('table');
    } catch (err) {
      setError(`Excel upload failed: ${err.message}`);
    }
  }

  function handleJsonPaste() {
    setError('');
    if (!jsonInput.trim()) {
      setError('JSON cannot be empty');
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed)) {
        throw new Error('JSON must be an array of items');
      }
      validateBillingItems(parsed);
      onChange(parsed);
      setJsonInput('');
      setActiveTab('table');
    } catch (err) {
      setError(`JSON parse failed: ${err.message}`);
    }
  }

  function handleAddItem() {
    onChange([
      ...items,
      { name: '', gl_old: '', gl_new: '', disc1_old: '', disc1_new: '' },
    ]);
  }

  function handleRemoveItem(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function handleUpdateItem(idx, field, value) {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('table')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            activeTab === 'table'
              ? 'border-b-2 border-accent-500 text-accent-600'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Items Table ({items.length})
        </button>
        <button
          onClick={() => setActiveTab('excel')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            activeTab === 'excel'
              ? 'border-b-2 border-accent-500 text-accent-600'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Excel Upload
        </button>
        <button
          onClick={() => setActiveTab('json')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            activeTab === 'json'
              ? 'border-b-2 border-accent-500 text-accent-600'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Paste JSON
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error">
          <span>⚠️</span>
          <div>
            <p className="font-semibold">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* TAB: Items Table */}
      {activeTab === 'table' && (
        <div className="space-y-3">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>GL Old</th>
                  <th>GL New</th>
                  <th>Disc1 Old</th>
                  <th>Disc1 New</th>
                  <th>Disc2 Old</th>
                  <th>Disc2 New</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center text-neutral-500 py-6">
                      No items yet. Upload Excel, paste JSON, or add manually.
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <input
                          type="text"
                          value={item.name || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'name', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Item name"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.gl_old || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'gl_old', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Current"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.gl_new || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'gl_new', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="New"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.disc1_old || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'disc1_old', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Disc1 Old"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.disc1_new || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'disc1_new', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Disc1 New"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.disc2_old || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'disc2_old', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Disc2 Old"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.disc2_new || ''}
                          onChange={(e) =>
                            handleUpdateItem(idx, 'disc2_new', e.target.value)
                          }
                          className="w-full px-2 py-1 border border-neutral-200 rounded text-sm"
                          placeholder="Disc2 New"
                        />
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => handleRemoveItem(idx)}
                          className="text-error hover:text-red-700 text-sm font-medium"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleAddItem}
            className="btn btn-sm btn-secondary w-full"
          >
            + Add Item Manually
          </button>
        </div>
      )}

      {/* TAB: Excel Upload */}
      {activeTab === 'excel' && (
        <div className="card bg-neutral-50">
          <h3 className="font-semibold text-primary-900 mb-4">Upload Excel File</h3>

          <div className="mb-4">
            <p className="text-sm text-neutral-600 mb-3">
              Expected columns: Name | GL Old | GL New | Disc1 Old | Disc1 New | Disc2 Old | Disc2 New
            </p>

            <label className="block">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="hidden"
              />
              <div className="btn btn-primary w-full text-center cursor-pointer">
                📄 Choose Excel File
              </div>
            </label>
          </div>

          <p className="text-xs text-neutral-500">
            Supported formats: .xlsx, .xls, .csv
          </p>
        </div>
      )}

      {/* TAB: JSON Paste */}
      {activeTab === 'json' && (
        <div className="space-y-3">
          <div className="input-group">
            <label className="input-label">Paste JSON Array</label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={`[
  {
    "name": "Assisted Living Apartment Rent",
    "gl_old": "40031",
    "gl_new": "400-10",
    "disc1_old": "41100",
    "disc1_new": "440-01"
  }
]`}
              rows={12}
              className="font-mono text-sm"
              spellCheck={false}
            />
            <p className="input-help">
              Paste a JSON array of billing items
            </p>
          </div>

          <button
            onClick={handleJsonPaste}
            className="btn btn-primary w-full"
          >
            Import JSON
          </button>
        </div>
      )}
    </div>
  );
}
