import React, { useEffect, useState } from 'react';
import { Users, Phone, Mail, Calendar, FileText, PhoneCall, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import useAuthStore from '../../../store/authStore';

const TeamMembers = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, active_today: 0 });

  useEffect(() => {
    if (!user?.is_tl) {
      navigate('/agent');
      return;
    }
    fetchTeamMembers();
  }, [user, navigate]);

  const fetchTeamMembers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/users/my-team');
      setTeamMembers(response.data.members || []);
      setStats(response.data.stats || { total: 0, active_today: 0 });
    } catch (error) {
      console.error('Failed to fetch team members:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24" data-testid="team-members-page">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Team</h1>
        <p className="text-sm text-gray-500 mt-1">Growth Partners assigned to you</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Users size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              <p className="text-xs text-gray-500">Team Members</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Calendar size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.active_today}</p>
              <p className="text-xs text-gray-500">Active Today</p>
            </div>
          </div>
        </div>
      </div>

      {/* Team Members List */}
      {teamMembers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
          <Users size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Team Members</h3>
          <p className="text-sm text-gray-500">
            No Growth Partners have been assigned to you yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              data-testid={`team-member-${member.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                    <span className="text-white font-bold text-lg">
                      {member.name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{member.name || member.full_name}</h3>
                    <p className="text-sm text-gray-500">{member.email}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  member.is_active !== false 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {member.is_active !== false ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Member Stats */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-gray-100">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                    <FileText size={14} />
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{member.stats?.total_data || 0}</p>
                  <p className="text-xs text-gray-500">Data</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                    <FileText size={14} />
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{member.stats?.total_files || 0}</p>
                  <p className="text-xs text-gray-500">Files</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                    <PhoneCall size={14} />
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{member.stats?.total_calls || 0}</p>
                  <p className="text-xs text-gray-500">Calls</p>
                </div>
              </div>

              {/* Contact Info */}
              {member.phone && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 text-sm text-gray-500">
                  <Phone size={14} />
                  <span>{member.phone}</span>
                </div>
              )}

              <p className="text-xs text-gray-400 mt-2">
                Last active: {formatDate(member.last_activity || member.last_login)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TeamMembers;
