import React, { useState, useEffect } from 'react';
import { Phone, PhoneIncoming, Users, FileText, TrendingUp, Loader2, RefreshCw, Calendar, ChevronRight, CheckCircle, Clock, IndianRupee, ArrowUp, ArrowDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [filesPerformance, setFilesPerformance] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [period, setPeriod] = useState('today');
  const [activeMetric, setActiveMetric] = useState('calls'); // calls, connected, leads, files

  const fetchData = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      const [statsRes, teamRes, filesRes] = await Promise.all([
        api.get(`/reports/manager-team-stats?period=${period}`),
        api.get('/users/manager-team-members'),
        api.get(`/files/reports?period=${period}`)
      ]);
      
      setStats(statsRes.data);
      setTeamMembers(teamRes.data.members || []);
      setFilesPerformance(filesRes.data.team_stats || []);
    } catch (error) {
      console.error('Error fetching manager stats:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  const handleRefresh = () => {
    fetchData(true);
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
  ];

  const metrics = [
    { id: 'calls', label: 'Calls', icon: Phone, color: 'blue', bgColor: 'bg-blue-50', textColor: 'text-blue-600' },
    { id: 'connected', label: 'Connected', icon: PhoneIncoming, color: 'green', bgColor: 'bg-green-50', textColor: 'text-green-600' },
    { id: 'leads', label: 'Leads', icon: Users, color: 'purple', bgColor: 'bg-purple-50', textColor: 'text-purple-600' },
    { id: 'files', label: 'Files', icon: FileText, color: 'orange', bgColor: 'bg-orange-50', textColor: 'text-orange-600' },
  ];

  const formatCurrency = (amount) => {
    if (!amount) return '₹0';
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  return (
    <div className="p-4" data-testid="manager-dashboard">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Team Dashboard</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          data-testid="refresh-btn"
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Period Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              period === p.id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
            data-testid={`period-${p.id}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Metric Tiles */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {metrics.map((metric) => {
              const value = stats?.[metric.id] || 0;
              const isActive = activeMetric === metric.id;
              return (
                <button
                  key={metric.id}
                  onClick={() => setActiveMetric(metric.id)}
                  className={`p-3 rounded-xl transition-all ${
                    isActive 
                      ? `${metric.bgColor} ring-2 ring-${metric.color}-400` 
                      : 'bg-white border border-gray-200 hover:border-gray-300'
                  }`}
                  data-testid={`metric-${metric.id}`}
                >
                  <metric.icon 
                    size={20} 
                    className={isActive ? metric.textColor : 'text-gray-400'} 
                  />
                  <div className={`text-xl font-bold mt-1 ${isActive ? metric.textColor : 'text-gray-900'}`}>
                    {value}
                  </div>
                  <div className="text-xs text-gray-500">{metric.label}</div>
                </button>
              );
            })}
          </div>

          {/* Team Overview */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Users size={18} className="text-blue-600" />
                Team Overview
              </h3>
              <button 
                onClick={() => navigate('/manager/team')}
                className="text-blue-600 text-sm flex items-center gap-1 hover:underline"
              >
                View All <ChevronRight size={16} />
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-900">{stats?.total_team || 0}</div>
                <div className="text-xs text-gray-500">Team Members</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-600">{stats?.tls_count || 0}</div>
                <div className="text-xs text-gray-500">Team Leads</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{stats?.active_today || 0}</div>
                <div className="text-xs text-gray-500">Active Today</div>
              </div>
            </div>
          </div>

          {/* Files Performance Table */}
          <div className="bg-white rounded-xl border border-gray-200 mb-4">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={18} className="text-orange-600" />
                Files Performance
              </h3>
            </div>
            
            {/* Summary Row */}
            <div className="grid grid-cols-5 gap-2 p-3 bg-blue-50 text-center">
              <div>
                <div className="text-lg font-bold text-gray-900">{stats?.total_files || 0}</div>
                <div className="text-[10px] text-gray-500 font-medium">Total Files</div>
              </div>
              <div>
                <div className="text-lg font-bold text-yellow-600">{stats?.files_login || 0}</div>
                <div className="text-[10px] text-gray-500 font-medium">Login</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">{stats?.files_approved || 0}</div>
                <div className="text-[10px] text-gray-500 font-medium">Approved</div>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-600">{stats?.files_disbursed || 0}</div>
                <div className="text-[10px] text-gray-500 font-medium">Disbursed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-purple-600">{formatCurrency(stats?.disbursed_amount)}</div>
                <div className="text-[10px] text-gray-500 font-medium">Amount</div>
              </div>
            </div>

            {/* GP Breakdown Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-xs">
                    <th className="text-left py-2 px-3 font-medium">GP Name</th>
                    <th className="text-center py-2 px-2 font-medium">Files</th>
                    <th className="text-center py-2 px-2 font-medium">Login</th>
                    <th className="text-center py-2 px-2 font-medium">Appr.</th>
                    <th className="text-center py-2 px-2 font-medium">Disb.</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.gp_performance || []).slice(0, 10).map((gp, idx) => (
                    <tr key={gp.id || idx} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-900 truncate max-w-[120px]">
                        {gp.name}
                        {gp.is_tl && <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1 rounded">TL</span>}
                      </td>
                      <td className="py-2 px-2 text-center">{gp.total_files || 0}</td>
                      <td className="py-2 px-2 text-center text-yellow-600">{gp.login || 0}</td>
                      <td className="py-2 px-2 text-center text-green-600">{gp.approved || 0}</td>
                      <td className="py-2 px-2 text-center text-blue-600">{gp.disbursed || 0}</td>
                      <td className="py-2 px-3 text-right text-purple-600">{formatCurrency(gp.disbursed_amount)}</td>
                    </tr>
                  ))}
                  {(!stats?.gp_performance || stats.gp_performance.length === 0) && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-gray-400">
                        No data available for this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Call Stats by GP */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Phone size={18} className="text-blue-600" />
                Call Activity by GP
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-xs">
                    <th className="text-left py-2 px-3 font-medium">GP Name</th>
                    <th className="text-center py-2 px-2 font-medium">Calls</th>
                    <th className="text-center py-2 px-2 font-medium">Connected</th>
                    <th className="text-center py-2 px-2 font-medium">Leads</th>
                    <th className="text-center py-2 px-2 font-medium">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.gp_call_stats || []).slice(0, 10).map((gp, idx) => (
                    <tr key={gp.id || idx} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-900 truncate max-w-[120px]">
                        {gp.name}
                        {gp.is_tl && <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1 rounded">TL</span>}
                      </td>
                      <td className="py-2 px-2 text-center text-blue-600">{gp.calls || 0}</td>
                      <td className="py-2 px-2 text-center text-green-600">{gp.connected || 0}</td>
                      <td className="py-2 px-2 text-center text-purple-600">{gp.leads || 0}</td>
                      <td className="py-2 px-2 text-center text-orange-600">{gp.files || 0}</td>
                    </tr>
                  ))}
                  {(!stats?.gp_call_stats || stats.gp_call_stats.length === 0) && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-gray-400">
                        No call activity for this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ManagerDashboard;
