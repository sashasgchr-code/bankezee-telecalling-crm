import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, Check, Trash2, Loader2, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import { format, isToday, isTomorrow, isPast, parseISO } from 'date-fns';

const TelecallerFollowUps = () => {
  const navigate = useNavigate();
  const [followUps, setFollowUps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  const fetchFollowUps = async () => {
    try {
      const params = { completed: filter === 'completed' };
      const response = await api.get('/follow-ups', { params });
      setFollowUps(response.data);
    } catch (error) {
      console.error('Error fetching follow-ups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFollowUps();
  }, [filter]);

  const handleComplete = async (followUpId) => {
    try {
      await api.put(`/follow-ups/${followUpId}`, { is_completed: true });
      fetchFollowUps();
    } catch (error) {
      console.error('Error completing follow-up:', error);
    }
  };

  const handleDelete = async (followUpId) => {
    if (window.confirm('Are you sure you want to delete this follow-up?')) {
      try {
        await api.delete(`/follow-ups/${followUpId}`);
        fetchFollowUps();
      } catch (error) {
        console.error('Error deleting follow-up:', error);
      }
    }
  };

  const getDateLabel = (dateStr) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    if (isPast(date)) return 'Overdue';
    return format(date, 'MMM d, yyyy');
  };

  const getDateColor = (dateStr) => {
    const date = parseISO(dateStr);
    if (isPast(date) && !isToday(date)) return 'text-red-600';
    if (isToday(date)) return 'text-green-600';
    if (isTomorrow(date)) return 'text-orange-600';
    return 'text-gray-600';
  };

  return (
    <div className="p-4" data-testid="telecaller-followups">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Follow-ups</h2>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('pending')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
            filter === 'pending'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
            filter === 'completed'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Completed
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      ) : followUps.length === 0 ? (
        <div className="text-center py-12">
          <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No {filter} follow-ups</p>
        </div>
      ) : (
        <div className="space-y-3">
          {followUps.map((followUp) => (
            <div
              key={followUp.id}
              className="card p-4"
              data-testid={`followup-card-${followUp.id}`}
            >
              <div className="flex items-start justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => navigate(`/agent/leads/${followUp.lead_id}`)}
                >
                  <p className="font-semibold text-gray-900">{followUp.lead_name}</p>
                  <p className="text-sm text-gray-500">{followUp.lead_phone}</p>
                  
                  <div className="flex items-center gap-1 mt-2">
                    <Clock size={14} className={getDateColor(followUp.scheduled_at)} />
                    <span className={`text-sm font-medium ${getDateColor(followUp.scheduled_at)}`}>
                      {getDateLabel(followUp.scheduled_at)}
                    </span>
                    <span className="text-sm text-gray-500">
                      {format(parseISO(followUp.scheduled_at), 'h:mm a')}
                    </span>
                  </div>
                  
                  {followUp.notes && (
                    <p className="text-sm text-gray-600 mt-2">{followUp.notes}</p>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  {!followUp.is_completed && (
                    <button
                      onClick={() => handleComplete(followUp.id)}
                      className="p-2 bg-green-100 hover:bg-green-200 rounded-lg text-green-600 transition-colors"
                      data-testid={`complete-btn-${followUp.id}`}
                    >
                      <Check size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(followUp.id)}
                    className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-600 transition-colors"
                    data-testid={`delete-btn-${followUp.id}`}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TelecallerFollowUps;
