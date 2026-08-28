import React, { useState, useEffect } from 'react';
import { X, Phone, CheckCircle, XCircle, Clock, AlertCircle, Mic, Calendar, Loader2, PhoneOff } from 'lucide-react';
import api from '../services/api';
import { StatusColors, StatusLabels, OutcomeColors } from '../constants/colors';
import { queueCallLog, isOnline } from '../services/offlineQueue';

/**
 * PostCallModal - Triggered after a call from LeadDetail page
 * Similar to mobile app's post-call modal for feature parity
 */
const PostCallModal = ({ isOpen, onClose, lead, onCallLogged }) => {
  const [outcome, setOutcome] = useState(null);
  const [notes, setNotes] = useState('');
  const [newStatus, setNewStatus] = useState(null);
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isOffline, setIsOffline] = useState(!isOnline());

  // Status options
  const statuses = [
    { id: 'new', label: 'New', color: '#3b82f6' },
    { id: 'follow_up', label: 'Follow Up', color: '#8b5cf6' },
    { id: 'not_interested', label: 'Not Interested', color: '#6b7280' },
    { id: 'leads', label: 'Lead', color: '#22c55e' },
    { id: 'file', label: 'File', color: '#ef4444' },
  ];

  // Call outcomes
  const callOutcomes = [
    { id: 'connected', label: 'Connected', icon: CheckCircle, color: '#4CAF50' },
    { id: 'no_answer', label: 'No Answer', icon: XCircle, color: '#F44336' },
    { id: 'not_connecting', label: 'Not Connecting', icon: PhoneOff, color: '#9E9E9E' },
    { id: 'busy', label: 'Busy', icon: Clock, color: '#FF9800' },
    { id: 'wrong_number', label: 'Wrong Number', icon: AlertCircle, color: '#E91E63' },
    { id: 'voicemail', label: 'Voicemail', icon: Mic, color: '#9C27B0' },
  ];

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
      setOutcome(null);
      setNotes('');
      setNewStatus(null);
      setScheduleFollowUp(false);
      setCallDuration(0);
      
      // Set default follow up date to tomorrow at 10 AM
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setFollowUpDate(tomorrow.toISOString().slice(0, 16));
    }
  }, [isOpen, lead]);

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
      duration: callDuration, // Backend expects 'duration' not 'duration_seconds'
      call_type: 'outgoing',
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
          <h2 className="text-xl font-semibold text-gray-900">Log Call Outcome</h2>
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
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
              <Phone size={24} className="text-green-600" />
            </div>
            <p className="text-lg font-semibold text-gray-900">{lead.name}</p>
            <p className="text-gray-500">{lead.phone}</p>
          </div>

          {/* Call Duration Input (manual entry for web) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Call Duration (approximate)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={Math.floor(callDuration / 60)}
                onChange={(e) => {
                  const mins = parseInt(e.target.value, 10) || 0;
                  setCallDuration(mins * 60 + (callDuration % 60));
                }}
                className="input-field w-20 text-center"
                placeholder="0"
              />
              <span className="text-gray-500">min</span>
              <input
                type="number"
                min="0"
                max="59"
                value={callDuration % 60}
                onChange={(e) => {
                  const secs = parseInt(e.target.value, 10) || 0;
                  setCallDuration(Math.floor(callDuration / 60) * 60 + Math.min(secs, 59));
                }}
                className="input-field w-20 text-center"
                placeholder="0"
              />
              <span className="text-gray-500">sec</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Total: {formatDuration(callDuration)}
            </p>
          </div>

          {/* Call Outcome */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Call Outcome <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {callOutcomes.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOutcome(o.id)}
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
