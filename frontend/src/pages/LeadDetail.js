import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, Clock, Edit2, Save, X, Loader2, Trash2, Calendar } from 'lucide-react';
import api from '../services/api';
import { StatusColors, StatusLabels } from '../constants/colors';
import { format, parseISO } from 'date-fns';
import useAuthStore from '../store/authStore';

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

  const statuses = ['new', 'contacted', 'interested', 'not_interested', 'follow_up', 'leads', 'not_answering', 'wrong_number', 'presentation'];

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
      alert('Lead not found');
      navigate(-1);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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
      let phone = lead.phone.replace(/[^0-9+]/g, '');
      if (!phone.startsWith('+')) {
        phone = '+91' + phone;
      }
      window.location.href = `tel:${phone}`;
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

  const statusColor = StatusColors[lead.status] || '#757575';

  return (
    <div className="min-h-screen bg-gray-50" data-testid="lead-detail">
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
              style={{ backgroundColor: statusColor }}
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
              <span
                className="inline-block px-3 py-1 rounded-full text-sm font-semibold mt-2"
                style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
              >
                {StatusLabels[lead.status] || lead.status?.replace('_', ' ')}
              </span>
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
                <span className="text-gray-700">{lead.phone}</span>
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
              {callLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Phone size={16} className="text-green-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900 capitalize">
                        {log.outcome?.replace('_', ' ')}
                      </span>
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
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No call history</p>
          )}
        </div>

        {/* Action Buttons */}
        {!isEditing && (
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
              onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(10, 0, 0, 0);
                setFollowUpDate(tomorrow.toISOString().slice(0, 16));
                setShowFollowUp(true);
              }}
              className="flex-1 btn-secondary py-3 flex items-center justify-center gap-2"
              data-testid="schedule-followup-btn"
            >
              <Calendar size={20} />
              Follow-up
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
    </div>
  );
};

export default LeadDetail;
