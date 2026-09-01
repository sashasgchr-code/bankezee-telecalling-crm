import React from 'react';
import { UserCheck } from 'lucide-react';

const FileAssignmentCard = ({ 
  opsTeam, 
  selectedAssignee, 
  currentAssignee,
  onAssigneeChange, 
  onAssign 
}) => {
  const assignedUser = opsTeam.find(o => o.id === currentAssignee);
  
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="assign-file-card">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <UserCheck size={20} className="text-green-600" />
          Assign File
        </h3>
      </div>
      <div className="p-6">
        <div className="flex gap-4">
          <select 
            value={selectedAssignee || ''} 
            onChange={(e) => onAssigneeChange(e.target.value)}
            className="flex-1 h-12 px-4 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">Select team member</option>
            {opsTeam.map((member) => (
              <option key={member.id} value={member.id}>{member.full_name || member.name}</option>
            ))}
          </select>
          <button 
            onClick={onAssign} 
            disabled={!selectedAssignee || selectedAssignee === currentAssignee}
            className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
        {assignedUser && (
          <p className="text-sm text-gray-600 mt-2">
            Currently assigned to: <span className="font-medium text-green-600">{assignedUser.full_name || assignedUser.name}</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default FileAssignmentCard;
