import { useState, useEffect } from 'react';

export default function FormAnalyzer() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [radius, setRadius] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    // Load available templates
    fetch('/api/form-analysis/templates')
      .then(r => r.json())
      .then(data => setTemplates(data))
      .catch(err => console.error('Failed to load templates:', err));
  }, []);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
    }
  }

  async function handleAnalyze() {
    if (!selectedFile) {
      setError('Please select a PDF file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create FormData for multipart file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (selectedTemplate) {
        formData.append('template', selectedTemplate);
      }
      formData.append('radius', radius);

      const response = await fetch('/api/form-analysis/analyze', {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header — browser will set it with boundary
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary-900 mb-2">Form Field Analyzer</h1>
        <p className="text-neutral-600">Upload a PDF form to detect fields, extract labels, and get ALIS code suggestions</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Upload Panel */}
        <div className="lg:col-span-1">
          <div className="card sticky top-4">
            <h2 className="text-xl font-semibold text-primary-900 mb-6">Upload & Configure</h2>

            {/* File Upload */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-primary-900 mb-2">PDF File</label>
              <label className="block border-2 border-dashed border-primary-200 rounded-lg p-6 text-center cursor-pointer hover:border-primary-400 transition-colors">
                <svg className="mx-auto mb-2 text-primary-400" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <p className="text-sm text-neutral-600">
                  {selectedFile ? selectedFile.name : 'Click to select PDF'}
                </p>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>

            {/* Template Selection */}
            <div className="mb-6">
              <label className="input-label">Form Template (Optional)</label>
              <select
                value={selectedTemplate || ''}
                onChange={(e) => setSelectedTemplate(e.target.value || null)}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {templates.map(t => (
                  <option key={t.id || 'auto'} value={t.id || ''}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-xs text-neutral-600 mt-1">
                  {templates.find(t => t.id === selectedTemplate)?.description}
                </p>
              )}
            </div>

            {/* Search Radius */}
            <div className="mb-6">
              <label className="input-label">
                OCR Search Radius: {radius}px
              </label>
              <input
                type="range"
                min="50"
                max="300"
                step="10"
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-neutral-600 mt-1">
                Distance to search for labels near form fields
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="alert alert-error mb-6">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <div>
                  <p className="font-semibold">Error</p>
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            )}

            {/* Analyze Button */}
            <button
              onClick={handleAnalyze}
              disabled={loading || !selectedFile}
              className="btn btn-primary w-full"
            >
              {loading ? 'Analyzing...' : 'Analyze PDF'}
            </button>
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="card text-center py-12">
              <svg className="mx-auto mb-4 text-primary-400 animate-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <p className="text-lg font-semibold text-primary-900">Analyzing PDF...</p>
              <p className="text-sm text-neutral-600 mt-2">This may take a few seconds</p>
            </div>
          ) : results ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="card">
                <h3 className="text-lg font-semibold text-primary-900 mb-4">Summary</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-3 bg-primary-50 rounded-lg">
                    <div className="text-2xl font-bold text-primary-900">
                      {results.summary.total_fields}
                    </div>
                    <div className="text-xs text-neutral-600">Total Fields</div>
                  </div>
                  <div className="p-3 bg-accent-50 rounded-lg">
                    <div className="text-2xl font-bold text-accent-600">
                      {results.summary.matched_fields}
                    </div>
                    <div className="text-xs text-neutral-600">Matched</div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {Math.round(results.summary.average_confidence * 100)}%
                    </div>
                    <div className="text-xs text-neutral-600">Avg Confidence</div>
                  </div>
                  <div className="p-3 bg-neutral-100 rounded-lg">
                    <div className="text-2xl font-bold text-neutral-700">
                      {Math.round(results.summary.matched_fields / results.summary.total_fields * 100)}%
                    </div>
                    <div className="text-xs text-neutral-600">Match Rate</div>
                  </div>
                </div>

                {/* Status Breakdown */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-sm">
                      <span className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"></span>
                      Auto-approve (≥95%)
                    </span>
                    <span className="font-semibold text-green-600">{results.summary.auto_approve}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-sm">
                      <span className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                      Likely OK (85-95%)
                    </span>
                    <span className="font-semibold text-blue-600">{results.summary.approve_likely}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-sm">
                      <span className="inline-block w-3 h-3 rounded-full bg-amber-500 mr-2"></span>
                      Review (70-85%)
                    </span>
                    <span className="font-semibold text-amber-600">{results.summary.review_needed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-sm">
                      <span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-2"></span>
                      Manual Review (&lt;70%)
                    </span>
                    <span className="font-semibold text-red-600">{results.summary.manual_review}</span>
                  </div>
                </div>
              </div>

              {/* Field Suggestions */}
              <div className="card">
                <h3 className="text-lg font-semibold text-primary-900 mb-4">Field Suggestions</h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200">
                        <th className="text-left py-2 px-3 font-semibold text-primary-900">Label</th>
                        <th className="text-left py-2 px-3 font-semibold text-primary-900">ALIS Code</th>
                        <th className="text-center py-2 px-3 font-semibold text-primary-900">Confidence</th>
                        <th className="text-center py-2 px-3 font-semibold text-primary-900">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.data.suggestions.slice(0, 20).map((suggestion, idx) => (
                        <tr key={idx} className="border-b border-neutral-100 hover:bg-neutral-50">
                          <td className="py-3 px-3">
                            <div className="font-medium text-primary-900">
                              {suggestion.detected_label}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <code className="text-xs bg-neutral-100 px-2 py-1 rounded">
                              {suggestion.suggested_code || '—'}
                            </code>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="font-semibold">
                              {Math.round(suggestion.confidence * 100)}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {suggestion.status === 'auto_approve' && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Auto
                              </span>
                            )}
                            {suggestion.status === 'approve_likely' && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
                                Likely
                              </span>
                            )}
                            {suggestion.status === 'review_needed' && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-semibold">
                                Review
                              </span>
                            )}
                            {suggestion.status === 'manual_review' && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
                                Manual
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {results.data.suggestions.length > 20 && (
                    <p className="text-center text-sm text-neutral-600 mt-4">
                      Showing 20 of {results.data.suggestions.length} suggestions
                    </p>
                  )}
                </div>
              </div>

              {/* Export Button */}
              <button
                onClick={() => {
                  const json = JSON.stringify(results, null, 2);
                  const blob = new Blob([json], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `form-analysis-${Date.now()}.json`;
                  a.click();
                }}
                className="btn btn-secondary w-full"
              >
                Download Results (JSON)
              </button>
            </div>
          ) : (
            <div className="card text-center py-12 text-neutral-600">
              <svg className="mx-auto mb-4 text-neutral-300" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <p className="text-lg font-semibold text-neutral-700 mb-2">No Results Yet</p>
              <p className="text-sm">Select a PDF and click "Analyze" to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
