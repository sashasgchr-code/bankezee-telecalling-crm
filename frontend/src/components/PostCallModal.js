import React, { useState, useEffect } from 'react';
import { X, Phone, CheckCircle, XCircle, Clock, AlertCircle, Mic, Calendar, Loader2, PhoneOff, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import api from '../services/api';
import { StatusColors, StatusLabels, OutcomeColors } from '../constants/colors';
import { queueCallLog, isOnline } from '../services/offlineQueue';

/**
 * PostCallModal - Triggered after a call from LeadDetail page
 * Supports both outgoing and incoming calls for feature parity with mobile
 * Now with auto-detected call duration and auto-connected detection
 */
const PostCallModal = ({ isOpen, onClose, lead, onCallLogged, callType = 'outgoing', detectedDuration = 0 }) => {
  const [outcome, setOutcome] = useState(null);
  const [notes, setNotes] = useState('');
  const [newStatus, setNewStatus] = useState(null);
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isOffline, setIsOffline] = useState(!isOnline());
  const [showManualOutcomeSelection, setShowManualOutcomeSelection] = useState(false);

  const isIncoming = callType === 'incoming';

  // Status options
  const statuses = [
    { id: 'new', label: 'New', color: '#3b82f6' },
    { id: 'follow_up', label: 'Follow Up', color: '#8b5cf6' },
    { id: 'not_interested', label: 'Not Interested', color: '#6b7280' },
    { id: 'leads', label: 'Lead', color: '#22c55e' },
    { id: 'file', label: 'File', color: '#ef4444' },
  ];

  // Call outcomes - different for incoming vs outgoing
  const outgoingOutcomes = [
    { id: 'connected', label: 'Connected', icon: CheckCircle, color: '#4CAF50' },
    { id: 'no_answer', label: 'No Answer', icon: XCircle, color: '#F44336' },
    { id: 'not_connecting', label: 'Not Connecting', icon: PhoneOff, color: '#9E9E9E' },
    { id: 'busy', label: 'Busy', icon: Clock, color: '#FF9800' },
    { id: 'wrong_number', label: 'Wrong Number', icon: AlertCircle, color: '#E91E63' },
    { id: 'voicemail', label: 'Voicemail', icon: Mic, color: '#9C27B0' },
  ];

  const incomingOutcomes = [
    { id: 'connected', label: 'Answered', icon: CheckCircle, color: '#4CAF50' },
    { id: 'missed', label: 'Missed', icon: XCircle, color: '#F44336' },
    { id: 'callback_request', label: 'Callback Request', icon: Phone, color: '#2196F3' },
  ];

  const callOutcomes = isIncoming ? incomingOutcomes : outgoingOutcomes;

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOpen && lead) {
      // Reset form state
      setNotes('');
      setNewStatus(null);
      setScheduleFollowUp(false);
      setShowManualOutcomeSelection(false);
      
      // Use detected duration from parent component
      const duration = detectedDuration || 0;
      setCallDuration(duration);
      
      // Auto-detect outcome based on duration
      // If call lasted more than 5 seconds, customer likely answered
      if (duration >= 5) {
        setOutcome('connected');
      } else if (duration > 0 && duration < 5) {
        // Very short call - might be rejected/busy, let agent decide
        setOutcome(null);
        setShowManualOutcomeSelection(true);
      } else {
        // Zero duration - definitely not answered
        setOutcome(null);
        setShowManualOutcomeSelection(true);
      }
      
      // Set default follow up date to tomorrow at 10 AM
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setFollowUpDate(tomorrow.toISOString().slice(0, 16));
    }
  }, [isOpen, lead, detectedDuration]);

  // No longer need auto-detect effect since we do it on open

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const handleSubmit = async () => {
    if (!outcome) {
      alert('Please select a call outcome');
      return;
    }

    setIsSubmitting(true);
    
    const callLogData = {
      lead_id: lead.id,
      outcome: outcome,
      notes: notes,
      duration: callDuration,
      call_type: callType, // 'outgoing' or 'incoming'
    };
    
    const statusUpdateData = newStatus && newStatus !== lead.status 
      ? { status: newStatus, last_call_outcome: outcome, notes: notes || lead.notes }
      : { last_call_outcome: outcome };

    try {
      if (isOffline) {
        // Queue for later sync
        await queueCallLog(callLogData, statusUpdateData, lead.id);
        alert('Call logged offline. Will sync when connection is restored.');
      } else {
        // Log the call outcome
        await api.post('/call-logs', callLogData);

        // Update lead status if changed
        await api.put(`/leads/${lead.id}`, statusUpdateData);

        // Create follow-up if scheduled
        if (scheduleFollowUp && followUpDate && outcome === 'connected') {
          await api.post('/follow-ups', {
            lead_id: lead.id,
            scheduled_at: new Date(followUpDate).toISOString(),
            notes: notes,
          });
        }
      }

      onCallLogged && onCallLogged();
      onClose();
    } catch (error) {
      console.error('Error logging call:', error);
      
      // If network error, queue offline
      if (!error.response) {
        await queueCallLog(callLogData, statusUpdateData, lead.id);
        alert('Network error. Call logged offline. Will sync when connection is restored.');
        onCallLogged && onCallLogged();
        onClose();
      } else {
        alert(error.response?.data?.detail || 'Failed to log call outcome');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  if (!isOpen || !lead) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" data-testid="post-call-modal">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            {isIncoming ? (
              <PhoneIncoming size={20} className="text-blue-600" />
            ) : (
              <PhoneOutgoing size={20} className="text-green-600" />
            )}
            <h2 className="text-xl font-semibold text-gray-900">
              Log {isIncoming ? 'Incoming' : 'Outgoing'} Call
            </h2>
          </div>
          <button
            onClick={handleSkip}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Offline Banner */}
          {isOffline && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700">
                You're offline. Call will be queued and synced when connection is restored.
              </p>
            </div>
          )}

          {/* Lead Info */}
          <div className="text-center pb-4 border-b border-gray-100">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2 ${
              isIncoming ? 'bg-blue-100' : 'bg-green-100'
            }`}>
              {isIncoming ? (
                <PhoneIncoming size={24} className="text-blue-600" />
              ) : (
                <PhoneOutgoing size={24} className="text-green-600" />
              )}
            </div>
            <p className="text-lg font-semibold text-gray-900">{lead.name}</p>
            <p className="text-gray-500">{lead.phone}</p>
            <p className={`text-xs mt-1 font-medium ${isIncoming ? 'text-blue-600' : 'text-green-600'}`}>
              {isIncoming ? 'Incoming Call' : 'Outgoing Call'}
            </p>
          </div>

          {/* Auto-Detected Call Duration Display */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Call Duration</p>
                <p className="text-2xl font-bold text-gray-900">{formatDuration(callDuration)}</p>
              </div>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                callDuration >= 5 ? 'bg-green-100' : 'bg-gray-200'
              }`}>
                <Clock size={24} className={callDuration >= 5 ? 'text-green-600' : 'text-gray-500'} />
              </div>
            </div>
            {callDuration >= 5 && (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                <CheckCircle size={14} />
                Customer answered the call
              </p>
            )}
            {callDuration > 0 && callDuration < 5 && (
              <p className="text-xs text-amber-600 mt-2">
                Short call - please select outcome below
              </p>
            )}
            {callDuration === 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Call not connected - please select outcome below
              </p>
            )}
          </div>

          {/* Call Outcome */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Call Outcome <span className="text-red-500">*</span>
            </label>
            
            {/* Auto-detected connected message */}
            {callDuration >= 5 && outcome === 'connected' && !showManualOutcomeSelection && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 flex items-center gap-2">
                <CheckCircle size={18} className="text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700">
                  <strong>Auto-detected as Connected</strong> - Call duration indicates customer answered.
                  <button 
                    onClick={() => setShowManualOutcomeSelection(true)} 
                    className="ml-2 text-green-600 underline hover:text-green-800"
                  >
                    Change
                  </button>
                </p>
              </div>
            )}
            
            {/* Show outcome buttons if: call not connected or user wants to change */}
            {(showManualOutcomeSelection || callDuration < 5 || outcome !== 'connected') && (
              <div className="grid grid-cols-2 gap-2">
                {callOutcomes.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setOutcome(o.id);
                      if (o.id === 'connected') {
                        setShowManualOutcomeSelection(false);
                      }
                    }}
                    data-testid={`outcome-${o.id}`}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      outcome === o.id
                        ? 'text-white border-transparent'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    style={{
                      backgroundColor: outcome === o.id ? o.color : undefined
                    }}
                  >
                    <o.icon size={16} />
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status Update (optional) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Update Status (Optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {statuses.map((status) => (
                <button
                  key={status.id}
                  onClick={() => setNewStatus(newStatus === status.id ? null : status.id)}
                  data-testid={`status-${status.id}`}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    newStatus === status.id
                      ? 'text-white'
                      : lead.status === status.id
                      ? 'bg-gray-100 text-gray-700 ring-2 ring-green-500'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={{
                    backgroundColor: newStatus === status.id ? status.color : undefined
                  }}
                >
                  {status.label}
                  {lead.status === status.id && ' ✓'}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add call notes..."
              className="input-field min-h-[80px] resize-none"
              data-testid="post-call-notes"
            />
          </div>

          {/* Follow Up - Only shown when call is Connected */}
          {outcome === 'connected' && (
            <div className="bg-gray-50 rounded-lg p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleFollowUp}
                  onChange={(e) => setScheduleFollowUp(e.target.checked)}
                  className="w-5 h-5 text-green-600 rounded border-gray-300 focus:ring-green-500"
                />
                <span className="text-gray-700 font-medium flex items-center gap-2">
                  <Calendar size={16} />
                  Schedule Follow-up
                </span>
              </label>
              
              {scheduleFollowUp && (
                <div className="mt-3">
                  <input
                    type="datetime-local"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="input-field"
                    data-testid="post-call-followup-date"
                  />
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSkip}
              className="flex-1 btn-secondary py-3"
              data-testid="skip-call-log-btn"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !outcome}
              className="flex-1 btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="save-call-log-btn"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostCallModal;
