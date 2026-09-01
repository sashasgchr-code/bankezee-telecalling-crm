import React from 'react';
import { Clock } from 'lucide-react';

const ActivityLog = ({ 
  activities = [], 
  note,
  onNoteChange,
  onAddNote,
  canEdit
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="activity-log-card">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Clock size={20} className="text-green-600" />
          Activity Log
        </h3>
      </div>
      <div className="p-6">
        {canEdit && (
          <div className="mb-4 space-y-2">
            <textarea 
              placeholder="Add a note..."
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              className="w-full min-h-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button 
              onClick={onAddNote} 
              disabled={!note?.trim()}
              className="w-full py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Add Note
            </button>
          </div>
        )}
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {(!activities || activities.length === 0) ? (
            <p className="text-center text-gray-500 py-4">No activity yet</p>
          ) : (
            activities.slice().reverse().map((activity, idx) => (
              <div key={idx} className="border-l-2 border-green-500 pl-3 py-2">
                <p className="text-sm font-medium text-gray-900">{activity.message}</p>
                <p className="text-xs text-gray-500">
                  {activity.by_name || 'System'} • {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : 'N/A'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityLog;
