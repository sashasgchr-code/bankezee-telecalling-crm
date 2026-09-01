import React from 'react';

const FILE_STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'documents_collected', label: 'Documents Collected' },
  { value: 'not_eligible', label: 'Not Eligible' },
  { value: 'sent_to_bank', label: 'Sent to Bank' },
  { value: 'login', label: 'Login' },
  { value: 'not_login', label: 'Not Login' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'disbursed', label: 'Disbursed' },
  { value: 'not_disbursed', label: 'Not Disbursed' },
  { value: 'rejected', label: 'Rejected' }
];

export { FILE_STATUS_OPTIONS };

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
      </div>
      <div className="p-6">
        <div className="flex gap-4">
          <select 
            value={newStatus} 
            onChange={(e) => onStatusChange(e.target.value)}
            className="flex-1 h-12 px-4 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {FILE_STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
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
