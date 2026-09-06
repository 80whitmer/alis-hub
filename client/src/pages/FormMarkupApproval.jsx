import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Form Markup Approval Interface
 *
 * Displays suggestions from form field analysis and allows users to:
 * - Review detected field names (Current Field Name column)
 * - Adjust ALIS code suggestions
 * - Modify signer assignments
 * - Set required/read-only flags
 * - Approve or reject suggestions
 * - Apply approved changes to PDF
 */
export default function FormMarkupApproval() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [editingSuggestion, setEditingSuggestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch job and suggestions
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        // Get job details
        const jobRes = await fetch(`/api/jobs/${jobId}`);
        if (!jobRes.ok) throw new Error('Failed to load job');
        const jobData = await jobRes.json();
        setJob(jobData);

        // Get suggestions
        const suggestionsRes = await fetch(`/api/jobs/${jobId}/suggestions`);
        if (!suggestionsRes.ok) throw new Error('Failed to load suggestions');
        const suggestionsData = await suggestionsRes.json();

        // Initialize suggestions with default values for required flag
        const initSuggestions = suggestionsData.suggestions.map(s => ({
          ...s,
          required: s.required !== false, // Default to true if not explicitly set
          read_only: s.read_only !== false
        }));

        setSuggestions(initSuggestions);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (jobId) fetchData();
  }, [jobId]);

  // Handle suggestion property changes
  const handleSuggestionChange = (id, field, value) => {
    setSuggestions(suggestions.map(s =>
      s.id === id ? { ...s, [field]: value } : s
    ));
  };

  // Handle approval status toggle
  const toggleApproval = (id) => {
    handleSuggestionChange(
      id,
      'approval_status',
      suggestions.find(s => s.id === id)?.approval_status === 'approved' ? 'review_needed' : 'approved'
    );
  };

  // Apply approved suggestions to PDF
  const handleApply = async () => {
    try {
      setApplying(true);
      setError('');
      setSuccess('');

      // Filter for approved suggestions
      const approveds = suggestions.filter(s => s.approval_status === 'approved');

      if (approveds.length === 0) {
        setError('No suggestions approved. Please approve at least one suggestion.');
        setApplying(false);
        return;
      }

      const res = await fetch(`/api/jobs/${jobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: approveds })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to apply changes');
      }

      const result = await res.json();
      setSuccess(`✓ Applied ${approveds.length} suggestion(s) to PDF`);

      // Update job status
      setJob(prev => ({ ...prev, status: 'applied' }));

      // Optionally: Trigger download or redirect to results
      // Could add download button here for the result PDF

    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">⟳</div>
          <p className="text-neutral-600">Loading suggestions...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="card p-6 bg-red-50 border border-red-200">
        <p className="text-red-700 font-semibold">Job not found</p>
        <p className="text-sm text-red-600 mt-1">{error || 'Unable to load job details'}</p>
      </div>
    );
  }

  const approved = suggestions.filter(s => s.approval_status === 'approved').length;
  const total = suggestions.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-primary-900">{job.document_title}</h1>
            <p className="text-sm text-neutral-600 mt-1">
              {job.company_name} • Form Markup Approval
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-primary-600">{approved}/{total}</div>
            <div className="text-xs text-neutral-600">Approved</div>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-800 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-green-800 text-sm">
            {success}
          </div>
        )}

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary-600 h-full transition-all"
              style={{ width: `${total > 0 ? (approved / total) * 100 : 0}%` }}
            />
          </div>
          <div className="text-xs text-neutral-600">
            {approved} of {total} suggestions approved
          </div>
        </div>
      </div>

      {/* Suggestions Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th className="text-left py-3 px-4 font-semibold text-primary-900 w-[140px]">Current Field Name</th>
              <th className="text-left py-3 px-4 font-semibold text-primary-900 w-[100px]">Type</th>
              <th className="text-left py-3 px-4 font-semibold text-primary-900 w-[140px]">Suggested Code</th>
              <th className="text-left py-3 px-4 font-semibold text-primary-900 w-[100px]">Signer</th>
              <th className="text-center py-3 px-4 font-semibold text-primary-900 w-[70px]">Required</th>
              <th className="text-center py-3 px-4 font-semibold text-primary-900 w-[70px]">Read-Only</th>
              <th className="text-center py-3 px-4 font-semibold text-primary-900 w-[90px]">Confidence</th>
              <th className="text-center py-3 px-4 font-semibold text-primary-900 w-[80px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion) => {
              const isApproved = suggestion.approval_status === 'approved';

              return (
                <tr
                  key={suggestion.id}
                  className={`border-b border-neutral-100 hover:bg-neutral-50 transition-colors ${
                    isApproved ? 'bg-green-50' : ''
                  }`}
                >
                  {/* Current Field Name (from PDF) */}
                  <td className="py-3 px-4">
                    <code className="text-xs bg-neutral-100 px-2 py-1 rounded font-mono">
                      {suggestion.field_name || '—'}
                    </code>
                  </td>

                  {/* Field Type */}
                  <td className="py-3 px-4">
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-medium">
                      {suggestion.field_type || 'text'}
                    </span>
                  </td>

                  {/* Suggested ALIS Code */}
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={suggestion.suggested_code || ''}
                      onChange={(e) => handleSuggestionChange(suggestion.id, 'suggested_code', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-neutral-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-primary-500"
                      placeholder="e.g., FAC.RES.SIG.1"
                    />
                  </td>

                  {/* Signer */}
                  <td className="py-3 px-4">
                    <input
                      type="text"
                      value={suggestion.signer || ''}
                      onChange={(e) => handleSuggestionChange(suggestion.id, 'signer', e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                      placeholder="e.g., admin"
                    />
                  </td>

                  {/* Required Flag */}
                  <td className="py-3 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={suggestion.required === true}
                      onChange={(e) => handleSuggestionChange(suggestion.id, 'required', e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-primary-600 cursor-pointer focus:ring-primary-500"
                    />
                  </td>

                  {/* Read-Only Flag */}
                  <td className="py-3 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={suggestion.read_only === true}
                      onChange={(e) => handleSuggestionChange(suggestion.id, 'read_only', e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-primary-600 cursor-pointer focus:ring-primary-500"
                    />
                  </td>

                  {/* Confidence Score */}
                  <td className="py-3 px-4 text-center">
                    <div className="text-sm font-semibold text-primary-900">
                      {Math.round((suggestion.confidence || 0) * 100)}%
                    </div>
                  </td>

                  {/* Approve/Reject Button */}
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => toggleApproval(suggestion.id)}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        isApproved
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-700'
                      }`}
                    >
                      {isApproved ? '✓ OK' : 'Review'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {suggestions.length === 0 && (
          <div className="text-center py-8 text-neutral-600">
            <p>No suggestions found</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="card flex gap-3">
        <button
          onClick={handleApply}
          disabled={applying || approved === 0 || job.status === 'applied'}
          className={`flex-1 px-6 py-3 rounded font-semibold transition-colors ${
            approved === 0 || job.status === 'applied'
              ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
              : 'bg-primary-600 hover:bg-primary-700 text-white'
          }`}
        >
          {applying ? '⏳ Applying...' : `✓ Apply ${approved} Suggestion${approved !== 1 ? 's' : ''}`}
        </button>

        {job.status === 'applied' && (
          <div className="flex-1 px-6 py-3 rounded bg-green-100 border border-green-300 text-green-800 flex items-center justify-center font-semibold">
            ✓ Applied Successfully
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="text-xs text-neutral-600 space-y-1">
        <p>💡 <strong>Required</strong> checkbox is now <strong>checked by default</strong> for all new suggestions</p>
        <p>💡 <strong>Current Field Name</strong> column shows the original PDF field name (e.g., "Signature1", "Text2")</p>
        <p>💡 Edit ALIS codes and signers directly in the table, then click Apply</p>
      </div>
    </div>
  );
}
