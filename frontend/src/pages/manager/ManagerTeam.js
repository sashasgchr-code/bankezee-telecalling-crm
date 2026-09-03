import React, { useState, useEffect } from 'react';
import { Users, Phone, FileText, Database, Search, Loader2, ChevronRight, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const ManagerTeam = () => {
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamLeads, setTeamLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTL, setFilterTL] = useState('all');

  useEffect(() => {
    const fetchTeam = async () => {
      try {
        setIsLoading(true);
        const response = await api.get('/users/manager-team-members');
        
        // Separate TLs and regular GPs
        const members = response.data.members || [];
        const tls = members.filter(m => m.is_tl);
        const gps = members.filter(m => !m.is_tl);
        
        setTeamLeads(tls);
        setTeamMembers(gps);
      } catch (error) {
        console.error('Failed to fetch team:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTeam();
  }, []);

  const filteredMembers = teamMembers.filter(member => {
    const matchesSearch = !searchQuery || 
      member.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTL = filterTL === 'all' || member.tl_id === filterTL;
    return matchesSearch && matchesTL;
  });

  const filteredTLs = teamLeads.filter(tl => {
    return !searchQuery || 
      tl.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tl.email?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="manager-team-page">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">My Team</h2>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="search-input"
        />
      </div>

      {/* TL Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterTL('all')}
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${
            filterTL === 'all' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All Members
        </button>
        {teamLeads.map(tl => (
          <button
            key={tl.id}
            onClick={() => setFilterTL(tl.id)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${
              filterTL === tl.id 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tl.name?.split(' ')[0] || 'TL'}'s Team
          </button>
        ))}
      </div>

      {/* Team Leads Section */}
      {filterTL === 'all' && filteredTLs.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-2">
            <Users size={16} />
            Team Leads ({filteredTLs.length})
          </h3>
          <div className="space-y-2">
            {filteredTLs.map(tl => (
              <div 
                key={tl.id}
                className="bg-blue-50 border border-blue-100 rounded-xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                      <span className="text-white font-bold">
                        {tl.name?.charAt(0).toUpperCase() || 'T'}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-2">
                        {tl.name}
                        <span className="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full">TL</span>
                      </div>
                      <div className="text-xs text-gray-500">{tl.email}</div>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-gray-600">
                      <span className="font-semibold text-blue-600">{tl.team_count || 0}</span> members
                    </div>
                  </div>
                </div>
                
                {/* TL Stats */}
                <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-blue-100">
                  <div className="text-center">
                    <Phone size={14} className="mx-auto text-blue-500 mb-1" />
                    <div className="text-sm font-semibold">{tl.calls || 0}</div>
                    <div className="text-[10px] text-gray-500">Calls</div>
                  </div>
                  <div className="text-center">
                    <Database size={14} className="mx-auto text-purple-500 mb-1" />
                    <div className="text-sm font-semibold">{tl.leads || 0}</div>
                    <div className="text-[10px] text-gray-500">Leads</div>
                  </div>
                  <div className="text-center">
                    <FileText size={14} className="mx-auto text-orange-500 mb-1" />
                    <div className="text-sm font-semibold">{tl.files || 0}</div>
                    <div className="text-[10px] text-gray-500">Files</div>
                  </div>
                  <div className="text-center">
                    <span className="text-green-500 text-xs">₹</span>
                    <div className="text-sm font-semibold">{tl.disbursed_amount ? `${(tl.disbursed_amount/100000).toFixed(1)}L` : '0'}</div>
                    <div className="text-[10px] text-gray-500">Disbursed</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth Partners Section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-2">
          <User size={16} />
          Growth Partners ({filteredMembers.length})
        </h3>
        <div className="space-y-2">
          {filteredMembers.map(member => (
            <div 
              key={member.id}
              className="bg-white border border-gray-200 rounded-xl p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-gray-600 font-bold">
                      {member.name?.charAt(0).toUpperCase() || 'G'}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{member.name}</div>
                    <div className="text-xs text-gray-500">{member.email}</div>
                    {member.tl_name && (
                      <div className="text-xs text-blue-600">TL: {member.tl_name}</div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* GP Stats */}
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-gray-100">
                <div className="text-center">
                  <div className="text-sm font-semibold text-blue-600">{member.calls || 0}</div>
                  <div className="text-[10px] text-gray-500">Calls</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-purple-600">{member.leads || 0}</div>
                  <div className="text-[10px] text-gray-500">Leads</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-orange-600">{member.files || 0}</div>
                  <div className="text-[10px] text-gray-500">Files</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-green-600">
                    {member.disbursed_amount ? `${(member.disbursed_amount/100000).toFixed(1)}L` : '0'}
                  </div>
                  <div className="text-[10px] text-gray-500">Disbursed</div>
                </div>
              </div>
            </div>
          ))}
          
          {filteredMembers.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <Users size={40} className="mx-auto mb-2 opacity-50" />
              <p>No team members found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagerTeam;
