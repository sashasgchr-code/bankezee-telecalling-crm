import React from 'react';

// The 22 File statuses, in the exact order agreed with the business. This is the single source
// for the File Details "Update Status" dropdown and the Files dashboard status filter.
const FILE_STATUS_OPTIONS = [
  { value: 'new', label: 'New', category: 'initial' },
  { value: 'contacted', label: 'Contacted', category: 'initial' },
  { value: 'documents_collected', label: 'Documents Collected', category: 'documents' },
  { value: 'documents_pending', label: 'Documents Pending', category: 'documents' },
  { value: 'sent_for_eligibility', label: 'Sent for Eligibility', category: 'processing' },
  { value: 'sent_for_login', label: 'Sent for Login', category: 'bank' },
  { value: 'login', label: 'Login Done', category: 'bank' },
  { value: 'sent_for_approval', label: 'Sent for Approval', category: 'approval' },
  { value: 'underwriting', label: 'Underwriting', category: 'underwriting' },
  { value: 'fi', label: 'FI (Field Investigation)', category: 'underwriting' },
  { value: 'fi_negative', label: 'FI Negative', category: 'underwriting' },
  { value: 'fi_reinitiated', label: 'FI Reinitiated', category: 'underwriting' },
  { value: 'query_hold', label: 'Query/Hold', category: 'processing' },
  { value: 'customer_not_interested', label: 'Customer Not Interested - Need Help from MIT & Manager', category: 'rejection' },
  { value: 'customer_not_supporting', label: 'Customer Not Supporting - Need Help from MIT & Manager', category: 'rejection' },
  { value: 'approved', label: 'Approved', category: 'approval' },
  { value: 'disbursed', label: 'Disbursed', category: 'disbursal' },
  { value: 'not_eligible', label: 'Not Eligible', category: 'rejection' },
  { value: 'not_login', label: 'Not Login', category: 'rejection' },
  { value: 'declined', label: 'Declined', category: 'rejection' },
  { value: 'not_disbursed', label: 'Not Disbursed', category: 'rejection' },
  { value: 'rejected', label: 'Rejected', category: 'rejection' }
];

// Historical values kept for DISPLAY only - never offered in the dropdown, never rewritten.
const LEGACY_STATUS_LABELS = {
  sent_to_bank: 'Sent to Bank',
  login_done: 'Login Done',
  sanctioned: 'Sanctioned',
  supporting: 'Supporting',
  on_hold: 'On Hold'
};

const getFileStatusLabel = (status) => {
  if (!status) return 'New';
  const opt = FILE_STATUS_OPTIONS.find(o => o.value === status);
  return opt?.label || LEGACY_STATUS_LABELS[status] || status;
};

export { FILE_STATUS_OPTIONS, LEGACY_STATUS_LABELS, getFileStatusLabel };

// Group statuses by category for better UX
const STATUS_CATEGORIES = {
  initial: { label: 'Initial', color: 'text-yellow-600' },
  documents: { label: 'Documents', color: 'text-purple-600' },
  processing: { label: 'Processing', color: 'text-blue-600' },
  bank: { label: 'Bank Submission', color: 'text-indigo-600' },
  underwriting: { label: 'Underwriting', color: 'text-cyan-600' },
  approval: { label: 'Approval', color: 'text-green-600' },
  disbursal: { label: 'Disbursal', color: 'text-emerald-600' },
  rejection: { label: 'Rejection', color: 'text-red-600' },
  other: { label: 'Other', color: 'text-gray-600' }
};

export { STATUS_CATEGORIES };

const FileStatusCard = ({ 
  currentStatus, 
  newStatus, 
  onStatusChange, 
  onUpdate 
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="status-update-card">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">Update File Status</h3>
        <p className="text-sm text-gray-500 mt-1">Current: <span className="font-medium">{getFileStatusLabel(currentStatus)}</span></p>
      </div>
      <div className="p-6">
        <div className="flex gap-4">
          <select 
            value={newStatus} 
            onChange={(e) => onStatusChange(e.target.value)}
            className="flex-1 h-12 px-4 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            data-testid="file-status-select"
          >
            {FILE_STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button 
            onClick={onUpdate} 
            disabled={newStatus === currentStatus} 
            className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
            data-testid="file-status-update-btn"
          >
            Update Status
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileStatusCard;
