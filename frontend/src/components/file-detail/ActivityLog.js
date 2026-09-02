import React from 'react';
import { Clock, Check, X, Building2, FileText, AlertTriangle, DollarSign, User, ArrowRight } from 'lucide-react';

// Activity type colors and icons
const ACTIVITY_STYLES = {
  // Status changes
  status_change: { color: 'border-blue-500', bgColor: 'bg-blue-50', icon: ArrowRight },
  file_created: { color: 'border-green-500', bgColor: 'bg-green-50', icon: Check },
  
  // Bank activities
  eligibility_check: { color: 'border-purple-500', bgColor: 'bg-purple-50', icon: Building2 },
  bank_eligible: { color: 'border-green-500', bgColor: 'bg-green-50', icon: Check },
  bank_not_eligible: { color: 'border-red-500', bgColor: 'bg-red-50', icon: X },
  bank_login: { color: 'border-blue-500', bgColor: 'bg-blue-50', icon: FileText },
  bank_login_rejected: { color: 'border-orange-500', bgColor: 'bg-orange-50', icon: X },
  bank_approved: { color: 'border-green-500', bgColor: 'bg-green-50', icon: Check },
  bank_declined: { color: 'border-red-500', bgColor: 'bg-red-50', icon: X },
  bank_disbursed: { color: 'border-emerald-500', bgColor: 'bg-emerald-50', icon: DollarSign },
  bank_not_disbursed: { color: 'border-red-500', bgColor: 'bg-red-50', icon: X },
  
  // Documents
  document_uploaded: { color: 'border-indigo-500', bgColor: 'bg-indigo-50', icon: FileText },
  
  // Notes
  note: { color: 'border-gray-400', bgColor: 'bg-gray-50', icon: User },
  
  // Default
  default: { color: 'border-green-500', bgColor: 'bg-white', icon: Clock }
};

const formatTimestamp = (ts) => {
  if (!ts) return 'N/A';
  try {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'N/A';
  }
};

const ActivityLog = ({ 
  activities = [], 
  note,
  onNoteChange,
  onAddNote,
  canEdit,
  compact = false  // When true, don't render outer card (used inside CollapsibleSection)
}) => {
  const getActivityStyle = (type) => {
    return ACTIVITY_STYLES[type] || ACTIVITY_STYLES.default;
  };

  const content = (
    <>
      {canEdit && (
        <div className="mb-4 space-y-2">
          <textarea 
            placeholder="Add a note..."
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            className="w-full min-h-16 sm:min-h-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            data-testid="activity-note-input"
          />
          <button 
            onClick={onAddNote} 
            disabled={!note?.trim()}
            className="w-full py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm"
            data-testid="add-note-btn"
          >
            Add Note
          </button>
        </div>
      )}
      
      <div className="space-y-2 sm:space-y-3 max-h-80 sm:max-h-96 overflow-y-auto">
        {(!activities || activities.length === 0) ? (
          <p className="text-center text-gray-500 py-6 text-sm">No activity yet</p>
        ) : (
          activities.slice().reverse().map((activity, idx) => {
            const style = getActivityStyle(activity.type);
            const Icon = style.icon;
            
            return (
              <div 
                key={idx} 
                className={`border-l-3 ${style.color} pl-2 sm:pl-3 py-1.5 sm:py-2 ${style.bgColor} rounded-r-lg`}
                style={{ borderLeftWidth: '3px' }}
              >
                <div className="flex items-start gap-2">
                  <Icon size={14} className={`mt-0.5 flex-shrink-0 ${style.color.replace('border-', 'text-')}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-gray-900 break-words">{activity.message}</p>
                    
                    {/* Show bank-specific details if available */}
                    {activity.details && (
                      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-1">
                        {activity.details.bank_name && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-200 rounded">
                            <Building2 size={10} />
                            {activity.details.bank_name}
                          </span>
                        )}
                        {activity.details.amount && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                            <DollarSign size={10} />
                            ₹{activity.details.amount.toLocaleString()}
                          </span>
                        )}
                        {activity.details.reason && (
                          <span className="text-red-600">• {activity.details.reason}</span>
                        )}
                      </div>
                    )}
                    
                    <p className="text-xs text-gray-500 mt-0.5 sm:mt-1">
                      {activity.by_name || 'System'} • {formatTimestamp(activity.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  // If compact mode, return just the content (for use inside CollapsibleSection)
  if (compact) {
    return content;
  }

  // Otherwise, wrap in card
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="activity-log-card">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Clock size={20} className="text-green-600" />
          Activity Log
        </h3>
        <span className="text-xs text-gray-500">{activities?.length || 0} events</span>
      </div>
      <div className="p-6">
        {content}
      </div>
    </div>
  );
};

export default ActivityLog;
