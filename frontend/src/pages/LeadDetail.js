import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, Clock, Edit2, Save, X, Loader2, Trash2, Calendar, PhoneOff, MessageCircle, Wifi, WifiOff, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import api from '../services/api';
import { StatusColors, StatusLabels, OutcomeColors, OutcomeLabels } from '../constants/colors';
import { format, parseISO } from 'date-fns';
import useAuthStore from '../store/authStore';
import PostCallModal from '../components/PostCallModal';
import { getPendingCount, isOnline, addSyncListener, syncQueue } from '../services/offlineQueue';

const LeadDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const context = useOutletContext() || {};
  const { startCall } = context;
  
  const [lead, setLead] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  
  // Follow-up modal
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  
  // Post-call modal
  const [showPostCallModal, setShowPostCallModal] = useState(false);
  const [postCallType, setPostCallType] = useState('outgoing'); // 'outgoing' or 'incoming'
  const [detectedCallDuration, setDetectedCallDuration] = useState(0); // Auto-tracked duration
  
  // Offline queue state
  const [pendingQueueCount, setPendingQueueCount] = useState(getPendingCount());
  const [networkOnline, setNetworkOnline] = useState(isOnline());

  // Status options (without 'new' and 'presentation')
  // Flow: Connected → not_interested, follow_up, leads, file
  // Agent can later update status to leads or file
  const statuses = ['not_interested', 'follow_up', 'leads', 'file'];

  // WhatsApp message template
  const getWhatsAppLink = (phone, customerName) => {
    const agentName = user?.name || 'Team';
    const message = `Hi ${customerName || 'there'},

This is ${agentName} from BankEzee.

I'm calling about merging your multiple loans/credit card payments into one single EMI.

We'd like to understand your current EMIs and check whether we can help you reduce your monthly EMI burden and simplify your repayments.

I tried reaching you but couldn't connect. Please call me back or simply reply "CALL ME" here and I'll get in touch with you.

Regards,
${agentName}
BankEzee – Loan Consolidation Platform
www.BankEzee.com`;

    // Clean and normalize phone number for WhatsApp
    // Handle float numbers like "9705296810.0" by converting to string and removing decimal
    let cleanPhone = String(phone).split('.')[0].replace(/[^0-9]/g, '');
    // Remove leading zeros
    cleanPhone = cleanPhone.replace(/^0+/, '');
    // Add 91 country code if it's a 10-digit number
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    } else if (!cleanPhone.startsWith('91') && cleanPhone.length > 10) {
      cleanPhone = '91' + cleanPhone;
    }
    
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  const handleWhatsApp = () => {
    if (lead?.phone) {
      const whatsappLink = getWhatsAppLink(lead.phone, lead.name);
      window.open(whatsappLink, '_blank');
    }
  };

  const fetchData = async () => {
    try {
      const [leadRes, logsRes] = await Promise.all([
        api.get(`/leads/${id}`),
        api.get(`/leads/${id}/call-logs`),
      ]);
      setLead(leadRes.data);
      setCallLogs(logsRes.data);
      setEditData(leadRes.data);
    } catch (error) {
      console.error('Error fetching lead:', error);
      // Only navigate away for actual 404 errors, not network errors
      if (error.response?.status === 404) {
        alert('Lead not found');
        navigate(-1);
      } else if (!error.response) {
        // Network error (offline) - keep existing data, don't navigate away
        console.log('Network error while fetching lead - keeping cached data');
      } else {
        // Other server errors
        console.error('Server error:', error.response?.status);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Listen for offline queue changes
    const unsubscribe = addSyncListener((count) => {
      setPendingQueueCount(count);
    });
    
    // Listen for network status
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.put(`/leads/${id}`, {
        name: editData.name,
        phone: editData.phone,
        email: editData.email,
        city: editData.city,
        source: editData.source,
        status: editData.status,
        notes: editData.notes,
      });
      setLead(editData);
      setIsEditing(false);
      
      // If status changed to 'file', redirect to File Details page
      if (editData.status === 'file') {
        const basePath = user?.role === 'admin' ? '/admin' : '/agent';
        navigate(`${basePath}/files/${id}`);
      }
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this lead?')) {
      try {
        await api.delete(`/leads/${id}`);
        navigate(-1);
      } catch (error) {
        alert(error.response?.data?.detail || 'Failed to delete lead');
      }
    }
  };

  const handleCall = () => {
    if (startCall) {
      startCall(lead);
    } else {
      // Clean phone number
      let phone = String(lead.phone).split('.')[0].replace(/[^0-9+]/g, '');
      if (!phone.startsWith('+')) {
        phone = '+91' + phone;
      }
      
      // Track call start time
      const callStartTime = Date.now();
      
      // Initiate call
      window.location.href = `tel:${phone}`;
      
      // Listen for when user returns to the app (call ended)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          // Calculate call duration
          const duration = Math.round((Date.now() - callStartTime) / 1000);
          
          // Only show modal if user was away for at least 3 seconds (actually made a call)
          if (duration >= 3) {
            setDetectedCallDuration(duration);
            setPostCallType('outgoing');
            setShowPostCallModal(true);
          }
          
          // Clean up listener
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
      };
      
      // Add listener after a small delay (so it doesn't trigger immediately)
      setTimeout(() => {
        document.addEventListener('visibilitychange', handleVisibilityChange);
      }, 500);
    }
  };
  
  const handleLogIncomingCall = () => {
    setPostCallType('incoming');
    setShowPostCallModal(true);
  };
  
  const handleLogOutgoingCall = () => {
    setPostCallType('outgoing');
    setShowPostCallModal(true);
  };
  
  const handlePostCallLogged = () => {
    fetchData(); // Refresh lead data
  };
  
  const handleManualSync = async () => {
    if (pendingQueueCount > 0 && networkOnline) {
      const result = await syncQueue();
      if (result.synced > 0) {
        fetchData(); // Refresh data after sync
      }
    }
  };

  const handleCreateFollowUp = async () => {
    if (!followUpDate) {
      alert('Please select a date and time');
      return;
    }

    try {
      await api.post('/follow-ups', {
        lead_id: id,
        scheduled_at: new Date(followUpDate).toISOString(),
        notes: followUpNotes,
      });
      alert('Follow-up scheduled');
      setShowFollowUp(false);
      setFollowUpDate('');
      setFollowUpNotes('');
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to create follow-up');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
      </div>
    );
  }

  if (!lead) return null;

  // Determine primary display - call outcome takes priority
  const hasCallOutcome = lead.last_call_outcome;
  const primaryColor = hasCallOutcome 
    ? (OutcomeColors[lead.last_call_outcome] || '#757575')
    : (StatusColors[lead.status] || '#757575');
  const statusColor = StatusColors[lead.status] || '#757575';

  return (
    <div className="min-h-screen bg-gray-50" data-testid="lead-detail">
      {/* Offline/Pending Sync Banner */}
      {(!networkOnline || pendingQueueCount > 0) && (
        <div className={`px-4 py-2 flex items-center justify-between ${
          networkOnline ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
        }`}>
          <div className="flex items-center gap-2">
            {networkOnline ? (
              <Wifi size={16} />
            ) : (
              <WifiOff size={16} />
            )}
            <span className="text-sm font-medium">
              {!networkOnline 
                ? 'You are offline' 
                : `${pendingQueueCount} call${pendingQueueCount !== 1 ? 's' : ''} pending sync`}
            </span>
          </div>
          {networkOnline && pendingQueueCount > 0 && (
            <button
              onClick={handleManualSync}
              className="text-sm font-semibold underline hover:no-underline"
            >
              Sync Now
            </button>
          )}
        </div>
      )}
      
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => { setIsEditing(false); setEditData(lead); }}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X size={24} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                >
                  {isSaving ? <Loader2 size={24} className="animate-spin" /> : <Save size={24} />}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <Edit2 size={24} />
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={handleDelete}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={24} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Lead Info Card */}
        <div className="card p-6 mb-4">
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: primaryColor }}
            >
              <span className="text-2xl font-bold text-white">
                {lead.name?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <input
                  type="text"
                  value={editData.name || ''}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="input-field text-xl font-bold"
                />
              ) : (
                <h2 className="text-xl font-bold text-gray-900">{lead.name}</h2>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {/* Primary badge - show call outcome if available */}
                {hasCallOutcome ? (
                  <>
                    <span
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold"
                      style={{ 
                        backgroundColor: `${OutcomeColors[lead.last_call_outcome] || '#757575'}20`, 
                        color: OutcomeColors[lead.last_call_outcome] || '#757575' 
                      }}
                    >
                      <PhoneOff size={14} />
                      {OutcomeLabels[lead.last_call_outcome] || lead.last_call_outcome?.replace('_', ' ')}
                    </span>
                    {/* Show status as secondary */}
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: `${statusColor}15`, color: statusColor }}
                    >
                      {StatusLabels[lead.status] || lead.status?.replace('_', ' ')}
                    </span>
                  </>
                ) : (
                  <span
                    className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
                    style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
                  >
                    {StatusLabels[lead.status] || lead.status?.replace('_', ' ')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Phone size={18} className="text-gray-400" />
              {isEditing ? (
                <input
                  type="tel"
                  value={editData.phone || ''}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  className="input-field flex-1"
                />
              ) : (
                <>
                  <span className="text-gray-700 flex-1">{lead.phone}</span>
                  <button
                    onClick={handleWhatsApp}
                    className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
                    title="Message on WhatsApp"
                    data-testid="whatsapp-btn"
                  >
                    <MessageCircle size={18} />
                  </button>
                </>
              )}
            </div>

            {(isEditing || lead.email) && (
              <div className="flex items-center gap-3">
                <Mail size={18} className="text-gray-400" />
                {isEditing ? (
                  <input
                    type="email"
                    value={editData.email || ''}
                    onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                    className="input-field flex-1"
                    placeholder="Email"
                  />
                ) : (
                  <span className="text-gray-700">{lead.email}</span>
                )}
              </div>
            )}

            {(isEditing || lead.city) && (
              <div className="flex items-center gap-3">
                <MapPin size={18} className="text-gray-400" />
                {isEditing ? (
                  <input
                    type="text"
                    value={editData.city || ''}
                    onChange={(e) => setEditData({ ...editData, city: e.target.value })}
                    className="input-field flex-1"
                    placeholder="City"
                  />
                ) : (
                  <span className="text-gray-700">{lead.city}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status Update */}
        {isEditing && (
          <div className="card p-4 mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-3">Status</label>
            <div className="flex flex-wrap gap-2">
              {statuses.map((status) => (
                <button
                  key={status}
                  onClick={() => setEditData({ ...editData, status })}
                  className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                    editData.status === status
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={{
                    backgroundColor: editData.status === status ? StatusColors[status] : undefined
                  }}
                >
                  {StatusLabels[status] || status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="card p-4 mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
          {isEditing ? (
            <textarea
              value={editData.notes || ''}
              onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
              className="input-field min-h-[100px] resize-none"
              placeholder="Add notes..."
            />
          ) : (
            <p className="text-gray-700 whitespace-pre-wrap">
              {lead.notes || 'No notes'}
            </p>
          )}
        </div>

        {/* Assignment Info (Admin only) */}
        {user?.role === 'admin' && lead.telecaller_name && (
          <div className="card p-4 mb-4">
            <p className="text-sm text-gray-500">Assigned to</p>
            <p className="font-semibold text-green-600">{lead.telecaller_name}</p>
          </div>
        )}

        {/* Call Logs */}
        <div className="card p-4 mb-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Call History</h3>
          {callLogs.length > 0 ? (
            <div className="space-y-3">
              {callLogs.map((log) => {
                const isIncoming = log.call_type === 'incoming';
                return (
                  <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isIncoming ? 'bg-blue-100' : 'bg-green-100'
                    }`}>
                      {isIncoming ? (
                        <PhoneIncoming size={16} className="text-blue-600" />
                      ) : (
                        <PhoneOutgoing size={16} className="text-green-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 capitalize">
                            {log.outcome?.replace('_', ' ')}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            isIncoming ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {isIncoming ? 'In' : 'Out'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {log.duration ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s` : '-'}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="text-sm text-gray-600 mt-1">{log.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {format(parseISO(log.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No call history</p>
          )}
        </div>

        {/* Action Buttons */}
        {!isEditing && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <button
                onClick={handleCall}
                className="flex-1 btn-primary py-3 flex items-center justify-center gap-2"
                data-testid="call-lead-btn"
              >
                <Phone size={20} />
                Call Now
              </button>
              <button
                onClick={handleWhatsApp}
                className="flex-1 py-3 flex items-center justify-center gap-2 bg-green-500 text-white font-semibold rounded-xl hover:bg-green-600 transition-colors"
                data-testid="whatsapp-lead-btn"
              >
                <MessageCircle size={20} />
                WhatsApp
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleLogOutgoingCall}
                className="flex-1 py-3 flex items-center justify-center gap-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
                data-testid="log-outgoing-btn"
              >
                <PhoneOutgoing size={20} />
                Log Outgoing
              </button>
              <button
                onClick={handleLogIncomingCall}
                className="flex-1 py-3 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                data-testid="log-incoming-btn"
              >
                <PhoneIncoming size={20} />
                Log Incoming
              </button>
            </div>
            <button
              onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(10, 0, 0, 0);
                setFollowUpDate(tomorrow.toISOString().slice(0, 16));
                setShowFollowUp(true);
              }}
              className="w-full btn-secondary py-3 flex items-center justify-center gap-2"
              data-testid="schedule-followup-btn"
            >
              <Calendar size={20} />
              Schedule Follow-up
            </button>
          </div>
        )}
      </div>

      {/* Follow-up Modal */}
      {showFollowUp && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Schedule Follow-up</h3>
            <input
              type="datetime-local"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="input-field mb-4"
            />
            <textarea
              value={followUpNotes}
              onChange={(e) => setFollowUpNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="input-field min-h-[80px] resize-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowFollowUp(false)}
                className="flex-1 btn-secondary py-3"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFollowUp}
                className="flex-1 btn-primary py-3"
              >
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Post-Call Modal */}
      <PostCallModal
        isOpen={showPostCallModal}
        onClose={() => setShowPostCallModal(false)}
        lead={lead}
        onCallLogged={handlePostCallLogged}
        callType={postCallType}
        detectedDuration={detectedCallDuration}
      />
    </div>
  );
};

export default LeadDetail;
