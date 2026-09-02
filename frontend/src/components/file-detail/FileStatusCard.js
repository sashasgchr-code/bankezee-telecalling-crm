import React from 'react';

// Complete OLD CRM Status Workflow - All 22 statuses preserved
const FILE_STATUS_OPTIONS = [
  // Initial Stages
  { value: 'new', label: 'New', category: 'initial' },
  { value: 'contacted', label: 'Contacted', category: 'initial' },
  // Document Collection
  { value: 'documents_pending', label: 'Documents Pending', category: 'documents' },
  { value: 'documents_collected', label: 'Documents Collected', category: 'documents' },
  // Eligibility & Processing
  { value: 'sent_for_eligibility', label: 'Sent for Eligibility', category: 'processing' },
  { value: 'not_eligible', label: 'Not Eligible', category: 'rejection' },
  { value: 'query_hold', label: 'Query/Hold', category: 'processing' },
  // Bank Submission
  { value: 'sent_to_bank', label: 'Sent to Bank', category: 'bank' },
  { value: 'sent_for_login', label: 'Sent for Login', category: 'bank' },
  { value: 'login', label: 'Login', category: 'bank' },
  { value: 'not_login', label: 'Not Login', category: 'rejection' },
  // Underwriting & FI
  { value: 'underwriting', label: 'Underwriting', category: 'underwriting' },
  { value: 'fi', label: 'FI', category: 'underwriting' },
  { value: 'fi_reinitiated', label: 'FI Reinitiated', category: 'underwriting' },
  { value: 'fi_negative', label: 'FI Negative', category: 'rejection' },
  // Approval/Decline
  { value: 'approved', label: 'Approved', category: 'approval' },
  { value: 'sanctioned', label: 'Sanctioned', category: 'approval' },
  { value: 'declined', label: 'Declined', category: 'rejection' },
  // Disbursal
  { value: 'disbursed', label: 'Disbursed', category: 'disbursal' },
  { value: 'not_disbursed', label: 'Not Disbursed', category: 'rejection' },
  // Final States
  { value: 'rejected', label: 'Rejected', category: 'rejection' },
  { value: 'customer_not_interested', label: 'Customer Not Interested', category: 'rejection' },
  { value: 'customer_not_supporting', label: 'Customer Not Supporting', category: 'rejection' },
  { value: 'supporting', label: 'Supporting', category: 'other' }
];

export { FILE_STATUS_OPTIONS };

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
  // Group statuses by category
  const groupedStatuses = FILE_STATUS_OPTIONS.reduce((acc, opt) => {
    const cat = opt.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(opt);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="status-update-card">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">Update File Status</h3>
        <p className="text-sm text-gray-500 mt-1">Current: <span className="font-medium">{FILE_STATUS_OPTIONS.find(s => s.value === currentStatus)?.label || currentStatus}</span></p>
      </div>
      <div className="p-6">
        <div className="flex gap-4">
          <select 
            value={newStatus} 
            onChange={(e) => onStatusChange(e.target.value)}
            className="flex-1 h-12 px-4 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {Object.entries(groupedStatuses).map(([category, statuses]) => (
              <optgroup key={category} label={STATUS_CATEGORIES[category]?.label || category}>
                {statuses.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button 
            onClick={onUpdate} 
            disabled={newStatus === currentStatus} 
            className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Update Status
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileStatusCard;
