import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Phone, CheckCircle, XCircle, Clock, AlertCircle, Mic, Calendar, Loader2, PhoneOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { StatusColors, StatusLabels } from '../constants/colors';

const CallModal = ({ isOpen, onClose, lead, activeCall, onCallEnded, callDuration }) => {
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState('connected');
  const [notes, setNotes] = useState('');
  const [newStatus, setNewStatus] = useState(lead?.status || 'not_interested');
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formOpenTime, setFormOpenTime] = useState(null); // Track when form opened (call ended)
  const [customerAnsweredTime, setCustomerAnsweredTime] = useState(null); // Track when customer answered
  const [hasCustomerAnswered, setHasCustomerAnswered] = useState(false); // Whether customer picked up

  // Update Status options - only shown when call is connected
  const updateStatuses = ['not_interested', 'follow_up', 'leads', 'file'];
  
  // Call Outcomes
  const callOutcomes = [
    { id: 'connected', label: 'Connected', icon: CheckCircle, color: 'green' },
    { id: 'not_connecting', label: 'Not Connecting', icon: PhoneOff, color: 'gray' },
    { id: 'no_answer', label: 'No Answer', icon: XCircle, color: 'red' },
    { id: 'busy', label: 'Busy', icon: Clock, color: 'orange' },
    { id: 'wrong_number', label: 'Wrong Number', icon: AlertCircle, color: 'red' },
    { id: 'voicemail', label: 'Voicemail', icon: Mic, color: 'purple' },
  ];

  useEffect(() => {
    if (isOpen && lead) {
      setNewStatus(lead.status === 'new' || lead.status === 'contacted' ? 'not_interested' : lead.status);
      setOutcome('connected');
      setNotes('');
      setScheduleFollowUp(false);
      // Set default follow up date to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setFollowUpDate(tomorrow.toISOString().slice(0, 16));
      // Track when form opened (this is when the call ended and form filling starts)
      setFormOpenTime(Date.now());
    }
  }, [isOpen, lead]);

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSubmit = async () => {
    if (!activeCall) return;

    setIsSubmitting(true);
    try {
      // Calculate form filling time (time between call end and form submit)
      const formFillingSeconds = formOpenTime ? Math.round((Date.now() - formOpenTime) / 1000) : 0;
      
      // End call session with duration and form filling time
      await api.post('/call-sessions/end', {
        session_id: activeCall.id,
        outcome: outcome,
        notes: notes,
        duration: callDuration, // Talk time (dialing to call end)
        form_filling_seconds: formFillingSeconds // Time spent filling the form
      });

      // Update lead status based on call outcome
      if (lead) {
        let statusToUpdate = null;
        let fileConversionResponse = null;
        
        if (outcome === 'connected') {
          // For connected calls, use the selected status
          if (newStatus !== lead.status) {
            statusToUpdate = newStatus;
          }
          
          // ============ FILE CONVERSION - USE CANONICAL ENDPOINT ============
          // If status is 'file', call the canonical conversion endpoint
          if (newStatus === 'file') {
            try {
              fileConversionResponse = await api.post(`/leads/${lead.id}/convert-to-file`);
            } catch (convErr) {
              console.error('File conversion failed:', convErr);
              // If conversion fails, still continue with regular update
            }
          }
        } else {
          // For non-connected outcomes, update status to 'contacted' if currently 'new'
          // This ensures the lead is no longer shown as "new" after a call attempt
          if (lead.status === 'new') {
            statusToUpdate = 'contacted';
          }
        }
        
        // Always update last_call_outcome so it shows on the card
        // Skip status update if we just did file conversion (it already set status='file')
        if (!fileConversionResponse?.data?.is_new || statusToUpdate !== 'file') {
          await api.put(`/leads/${lead.id}`, {
            ...(statusToUpdate && statusToUpdate !== 'file' && { status: statusToUpdate }),
            last_call_outcome: outcome,
            notes: notes || lead.notes,
          });
        }
        
        // Create follow-up if scheduled (only for connected calls)
        if (outcome === 'connected' && scheduleFollowUp && lead && followUpDate) {
          await api.post('/follow-ups', {
            lead_id: lead.id,
            scheduled_at: new Date(followUpDate).toISOString(),
            notes: notes,
          });
        }

        onCallEnded && onCallEnded();
        onClose();
        
        // ============ FILE REDIRECT ============
        // If file was converted, navigate to File Detail page
        if (fileConversionResponse?.data?.file_id) {
          // Get the user's role-appropriate base route
          const user = JSON.parse(localStorage.getItem('user') || '{}');
          const baseRoute = user.role === 'admin' ? '/admin' : '/agent';
          navigate(`${baseRoute}/files/${fileConversionResponse.data.file_id}`);
        }
        return;
      }

      onCallEnded && onCallEnded();
      onClose();
    } catch (error) {
      console.error('Error ending call:', error);
      alert(error.response?.data?.detail || 'Failed to log call');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" data-testid="call-modal">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-900">Log Call</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-full">
              <Clock size={16} className="text-green-600" />
              <span className="text-green-600 font-semibold font-mono">
                {formatDuration(callDuration)}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Lead Info */}
          {lead && (
            <div className="text-center pb-4 border-b border-gray-100">
              <p className="text-lg font-semibold text-gray-900">{lead.name}</p>
              <p className="text-gray-500">{lead.phone}</p>
            </div>
          )}

          {/* Call Outcome */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Call Outcome</label>
            <div className="flex flex-wrap gap-2">
              {callOutcomes.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOutcome(o.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    outcome === o.id
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <o.icon size={16} />
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status Update - Only shown when call is Connected */}
          {outcome === 'connected' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Update Status</label>
              <div className="flex flex-wrap gap-2">
                {updateStatuses.map((status) => (
                  <button
                    key={status}
                    onClick={() => setNewStatus(status)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                      newStatus === status
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    style={{
                      backgroundColor: newStatus === status ? StatusColors[status] : undefined
                    }}
                  >
                    {StatusLabels[status] || status.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add call notes..."
              className="input-field min-h-[80px] resize-none"
              data-testid="call-notes-input"
            />
          </div>

          {/* Follow Up - Only shown when call is Connected */}
          {outcome === 'connected' && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleFollowUp}
                  onChange={(e) => setScheduleFollowUp(e.target.checked)}
                  className="w-5 h-5 text-green-600 rounded border-gray-300 focus:ring-green-500"
                />
                <span className="text-gray-700 font-medium">Schedule Follow-up</span>
              </label>
              
              {scheduleFollowUp && (
                <div className="mt-3">
                  <input
                    type="datetime-local"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="input-field"
                    data-testid="follow-up-date"
                  />
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            data-testid="submit-call-btn"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              'Save & End Call'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallModal;
