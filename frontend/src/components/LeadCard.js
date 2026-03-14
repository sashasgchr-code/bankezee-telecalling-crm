import React from 'react';
import { Phone, MapPin, PhoneOff } from 'lucide-react';
import { StatusColors, StatusLabels, OutcomeColors, OutcomeLabels } from '../constants/colors';

const LeadCard = ({ lead, onPress, onCall, showAssignment }) => {
  const statusColor = StatusColors[lead.status] || '#757575';
  const outcomeColor = lead.last_call_outcome ? (OutcomeColors[lead.last_call_outcome] || '#757575') : null;
  
  const handleCall = (e) => {
    e.stopPropagation();
    onCall && onCall();
  };

  return (
    <div 
      className="card flex items-stretch overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
      onClick={onPress}
      data-testid={`lead-card-${lead.id}`}
    >
      <div className="flex-1 p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center flex-1 min-w-0">
            <div 
              className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: statusColor }}
            >
              <span className="text-white font-bold text-lg">
                {lead.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="ml-3 flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate">{lead.name}</p>
              <p className="text-sm text-gray-500">{lead.phone}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
            <span 
              className="px-2 py-1 rounded text-xs font-semibold uppercase"
              style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
            >
              {StatusLabels[lead.status] || lead.status?.replace('_', ' ')}
            </span>
            {lead.last_call_outcome && (
              <span 
                className="px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1"
                style={{ backgroundColor: `${outcomeColor}15`, color: outcomeColor }}
              >
                <PhoneOff size={10} />
                {OutcomeLabels[lead.last_call_outcome] || lead.last_call_outcome?.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>
        
        {lead.city && (
          <div className="flex items-center mt-2 pl-14">
            <MapPin size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500 ml-1">{lead.city}</span>
          </div>
        )}
        
        {showAssignment && lead.telecaller_name && (
          <div className="mt-2 pt-2 border-t border-gray-100 pl-14">
            <span className="text-xs text-green-600 font-medium">
              Assigned to: {lead.telecaller_name}
            </span>
          </div>
        )}
      </div>
      
      <button
        onClick={handleCall}
        className="w-16 bg-green-600 hover:bg-green-700 flex items-center justify-center transition-colors"
        data-testid={`call-btn-${lead.id}`}
      >
        <Phone size={24} className="text-white" />
      </button>
    </div>
  );
};

export default LeadCard;
