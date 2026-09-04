import React, { useState, useEffect } from 'react';
import { Phone, PhoneIncoming, Users, FileText, TrendingUp, Loader2, RefreshCw, Calendar, ChevronRight, CheckCircle, Clock, IndianRupee, ArrowUp, ArrowDown, Trophy } from 'lucide-react';
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
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [dateError, setDateError] = useState('');
  const [activeMetric, setActiveMetric] = useState('calls'); // calls, connected, leads, files

  // Mirrors the backend get_date_range() so every dashboard section is driven by one range
  const resolveRange = () => {
    if (period === 'custom') {
      return { start: customFrom, end: customTo };
    }
    const iso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    if (period === 'this_week') {
      const monday = new Date(today);
      const weekday = (today.getDay() + 6) % 7; // Monday = 0, same as Python weekday()
      monday.setDate(today.getDate() - weekday);
      return { start: iso(monday), end: iso(today) };
    }
    if (period === 'this_month') {
      return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end: iso(today) };
    }
    return { start: iso(today), end: iso(today) };
  };

  const fetchData = async (showRefresh = false) => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      const { start, end } = resolveRange();
      const statsQuery = period === 'custom'
        ? `period=custom&from_date=${start}&to_date=${end}`
        : `period=${period}`;
      
      const [statsRes, teamRes, filesRes] = await Promise.all([
        api.get(`/reports/manager-team-stats?${statsQuery}`),
        api.get('/users/manager-team-members'),
        api.get(`/files/reports?start_date=${start}&end_date=${end}`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  const handleRefresh = () => {
    fetchData(true);
  };

  const applyCustomRange = (from, to) => {
    if (from && to && from > to) {
      setDateError('From date cannot be after To date');
      return;
    }
    setDateError('');
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to) setPeriod('custom');
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
  ];

  // Leaderboard reuses the per-GP figures the dashboard already returns - no separate source
  const leaderboard = React.useMemo(() => {
    const calls = {};
    (stats?.gp_call_stats || []).forEach((g) => { calls[g.id] = g; });
    return (stats?.gp_performance || [])
      .map((g) => ({
        id: g.id,
        name: g.name,
        is_tl: g.is_tl,
        files: g.total_files || 0,
        disbursed: g.disbursed || 0,
        calls: calls[g.id]?.calls || 0,
        connected: calls[g.id]?.connected || 0,
      }))
      .filter((g) => g.files > 0 || g.calls > 0)
      .sort((a, b) => b.files - a.files || b.disbursed - a.disbursed || b.calls - a.calls);
  }, [stats]);

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
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => { setPeriod(p.id); setDateError(''); }}
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

      {/* Custom date range */}
      <div className="mb-4" data-testid="custom-date-range">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => applyCustomRange(e.target.value, customTo)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700"
              data-testid="from-date-input"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => applyCustomRange(customFrom, e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700"
              data-testid="to-date-input"
            />
          </div>
          {period === 'custom' && (
            <button
              onClick={() => { setCustomFrom(''); setCustomTo(''); setDateError(''); setPeriod('today'); }}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
              data-testid="clear-date-range"
            >
              Clear
            </button>
          )}
        </div>
        {dateError && (
          <p className="text-xs text-red-600 mt-1" data-testid="date-range-error">{dateError}</p>
        )}
        {period === 'custom' && !dateError && (
          <p className="text-xs text-gray-500 mt-1" data-testid="active-date-range">
            Showing {customFrom} to {customTo}
          </p>
        )}
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

          {/* Team Leaderboard - ranked by files converted in the selected period */}
          <div className="bg-white rounded-xl border border-gray-200 mb-4" data-testid="team-leaderboard">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Trophy size={18} className="text-amber-500" />
                Team Leaderboard
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Ranked by files converted this period</p>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm" data-testid="leaderboard-empty">
                No team activity in this period
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {leaderboard.map((m, i) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 px-4 py-3"
                    data-testid={`leaderboard-row-${i + 1}`}
                  >
                    <span
                      className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-xs font-bold ${
                        i === 0 ? 'bg-amber-100 text-amber-700'
                        : i === 1 ? 'bg-gray-200 text-gray-700'
                        : i === 2 ? 'bg-orange-100 text-orange-700'
                        : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {m.name}
                        {m.is_tl && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold align-middle">TL</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        {m.calls} calls · {m.connected} connected · {m.disbursed} disbursed
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-gray-900" data-testid={`leaderboard-files-${i + 1}`}>{m.files}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">files</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
