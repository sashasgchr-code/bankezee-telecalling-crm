import React, { useState, useEffect } from 'react';
import { 
  Calendar, Clock, CheckCircle, XCircle, Loader2, Home, FileText, RefreshCw,
  Trophy, AlertTriangle, DollarSign, Upload, Users, TrendingUp, Award,
  Heart, AlertCircle, ChevronDown, ChevronUp, Eye
} from 'lucide-react';
import api from '../../services/api';
import { GrowthPartnerFilter, EmployeeSearch, matchesGpFilters, useActiveGrowthPartners } from '../../components/GrowthPartnerFilter';
import { PrintReportButton } from '../../components/PrintReportButton';

const LeaveManagement = () => {
  const [activeTab, setActiveTab] = useState('my-requests');
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [pendingWfh, setPendingWfh] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [palmePolicy, setPalmePolicy] = useState(null);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [allEmployeesSummary, setAllEmployeesSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showWfhModal, setShowWfhModal] = useState(false);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [showPenaltyModal, setShowPenaltyModal] = useState(false);
  const [user, setUser] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [expandedEmployee, setExpandedEmployee] = useState(null);
  const [gpSelection, setGpSelection] = useState([]);
  const [gpSearch, setGpSearch] = useState('');
  const { mobileById } = useActiveGrowthPartners();
  const gpArgs = { selectedIds: gpSelection, search: gpSearch, mobileById };
  const monthlyEmployees = (monthlySummary?.employees || []).filter(e => matchesGpFilters(e, gpArgs));
  const allEmployees = (allEmployeesSummary?.employees || []).filter(e => matchesGpFilters(e, gpArgs));

  // Generate year options
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
  const monthOptions = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
    { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
    { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];

  // Form states
  const [leaveForm, setLeaveForm] = useState({
    start_date: '',
    end_date: '',
    leave_type: 'ALLOWED',
    reason: '',
    half_day: false,
    half_day_type: ''
  });
  const [wfhForm, setWfhForm] = useState({ date: '', reason: '' });
  const [rewardForm, setRewardForm] = useState({
    user_id: '',
    reward_type: 'weekly_on_time',
    amount: 200,
    description: ''
  });
  const [penaltyForm, setPenaltyForm] = useState({
    user_id: '',
    penalty_type: 'uninformed_leave',
    amount: 100,
    description: ''
  });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    fetchData();
  }, [selectedYear, selectedMonth]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [balanceRes, myLeavesRes, myWfhRes, policyRes] = await Promise.all([
        api.get(`/leave/balance?year=${selectedYear}`),
        api.get('/leave/requests/my'),
        api.get('/leave/wfh/requests/my'),
        api.get('/leave/palme/policy').catch(() => ({ data: null }))
      ]);
      
      setLeaveBalance(balanceRes.data);
      setLeaveRequests(myLeavesRes.data);
      setWfhRequests(myWfhRes.data);
      setPalmePolicy(policyRes.data);

      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (storedUser.role === 'admin' || storedUser.role === 'hr') {
        const [pendingLeavesRes, pendingWfhRes, monthlyRes, allEmpRes] = await Promise.all([
          api.get('/leave/requests/pending'),
          api.get('/leave/wfh/requests/pending'),
          api.get(`/leave/palme/monthly-summary?year=${selectedYear}&month=${selectedMonth}`).catch(() => ({ data: null })),
          api.get(`/leave/palme/all-employees?year=${selectedYear}`).catch(() => ({ data: null }))
        ]);
        setPendingLeaves(pendingLeavesRes.data);
        setPendingWfh(pendingWfhRes.data);
        setMonthlySummary(monthlyRes.data);
        setAllEmployeesSummary(allEmpRes.data);
      }
    } catch (error) {
      console.error('Error fetching leave data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/leave/requests', leaveForm);
      setShowLeaveModal(false);
      setLeaveForm({ start_date: '', end_date: '', leave_type: 'ALLOWED', reason: '', half_day: false, half_day_type: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to submit leave request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWfhSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/leave/wfh/requests', wfhForm);
      setShowWfhModal(false);
      setWfhForm({ date: '', reason: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to submit WFH request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproval = async (requestId, type, status) => {
    try {
      const endpoint = type === 'leave' 
        ? `/leave/requests/${requestId}`
        : `/leave/wfh/requests/${requestId}`;
      
      await api.patch(endpoint, { status });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to update request');
    }
  };

  const markAsUninformed = async (requestId) => {
    if (!window.confirm('Mark this leave as uninformed? A ₹100 penalty will be applied.')) return;
    try {
      await api.patch(`/leave/requests/${requestId}/mark-uninformed`);
      fetchData();
      alert('Leave marked as uninformed. Penalty applied.');
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to mark as uninformed');
    }
  };

  const handleRewardSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('user_id', rewardForm.user_id);
      formData.append('reward_type', rewardForm.reward_type);
      formData.append('amount', rewardForm.amount);
      formData.append('description', rewardForm.description);
      formData.append('month', selectedMonth);
      
      await api.post('/leave/palme/rewards', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setShowRewardModal(false);
      setRewardForm({ user_id: '', reward_type: 'weekly_on_time', amount: 200, description: '' });
      fetchData();
      alert('Reward added successfully!');
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to add reward');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePenaltySubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('user_id', penaltyForm.user_id);
      formData.append('penalty_type', penaltyForm.penalty_type);
      formData.append('amount', penaltyForm.amount);
      formData.append('description', penaltyForm.description);
      
      await api.post('/leave/palme/penalty', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setShowPenaltyModal(false);
      setPenaltyForm({ user_id: '', penalty_type: 'uninformed_leave', amount: 100, description: '' });
      fetchData();
      alert('Penalty applied successfully!');
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to apply penalty');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelRequest = async (requestId) => {
    if (!window.confirm('Cancel this leave request?')) return;
    try {
      await api.delete(`/leave/requests/${requestId}`);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to cancel request');
    }
  };

  const isAdminOrHr = user?.role === 'admin' || user?.role === 'hr';

  const getStatusBadge = (status) => {
    const styles = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      CANCELLED: 'bg-gray-100 text-gray-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.PENDING}`}>
        {status}
      </span>
    );
  };

  const getLeaveTypeBadge = (type) => {
    const styles = {
      ALLOWED: 'bg-blue-100 text-blue-800',
      SICK: 'bg-orange-100 text-orange-800',
      MEDICAL: 'bg-purple-100 text-purple-800',
      EMERGENCY: 'bg-red-100 text-red-800',
      UNINFORMED: 'bg-red-200 text-red-900',
      UNPAID: 'bg-gray-100 text-gray-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[type] || styles.ALLOWED}`}>
        {type}
      </span>
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Header with P.A.L.M.E Branding */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="bg-green-600 text-white px-2 py-1 rounded text-sm">P.A.L.M.E</span>
            Leave Management
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Present • Absent • Leave • Medical • Emergency
            {selectedYear === 2026 && <span className="ml-2 text-orange-600 font-medium">(Accrual from September)</span>}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Year Selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
            data-testid="year-selector"
          >
            {yearOptions.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          {/* Month Selector for Admin */}
          {isAdminOrHr && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
              data-testid="month-selector"
            >
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowLeaveModal(true)}
            className="btn-primary flex items-center gap-2"
            data-testid="apply-leave-btn"
          >
            <Calendar size={18} />
            Apply Leave
          </button>
          <button
            onClick={() => setShowWfhModal(true)}
            className="btn-secondary flex items-center gap-2"
            data-testid="apply-wfh-btn"
          >
            <Home size={18} />
            Apply WFH
          </button>
          <button onClick={fetchData} className="btn-secondary p-2">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Leave Balance Cards with P.A.L.M.E Metrics */}
      {leaveBalance && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {/* Leave Accrued */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-600 flex items-center gap-1">
              <TrendingUp size={14} className="text-green-600" />
              Accrued
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-600">{leaveBalance.accrued ?? 0}</span>
              <span className="text-sm text-gray-500">days</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {leaveBalance.accrual_start_month_name ? `From ${leaveBalance.accrual_start_month_name}` : 'Through now'}
            </p>
          </div>
          
          {/* Leave Used */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-600 flex items-center gap-1">
              <Calendar size={14} className="text-orange-600" />
              Used
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-orange-600">{leaveBalance.used ?? 0}</span>
              <span className="text-sm text-gray-500">days</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Approved leaves</p>
          </div>
          
          {/* Leave Available */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-600 flex items-center gap-1">
              <CheckCircle size={14} className="text-blue-600" />
              Available
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-600">{leaveBalance.available ?? 0}</span>
              <span className="text-sm text-gray-500">days</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Can use now</p>
          </div>

          {/* Rewards Earned */}
          <div className="bg-white rounded-xl border border-green-200 p-4 bg-green-50">
            <h3 className="text-sm font-medium text-green-700 flex items-center gap-1">
              <Trophy size={14} />
              Rewards
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-700">₹{leaveBalance.total_rewards ?? 0}</span>
            </div>
            <p className="text-xs text-green-600 mt-1">Earned this year</p>
          </div>

          {/* Penalties */}
          <div className="bg-white rounded-xl border border-red-200 p-4 bg-red-50">
            <h3 className="text-sm font-medium text-red-700 flex items-center gap-1">
              <AlertTriangle size={14} />
              Penalties
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-700">₹{leaveBalance.total_penalties ?? 0}</span>
            </div>
            <p className="text-xs text-red-600 mt-1">{leaveBalance.uninformed_leaves ?? 0} uninformed</p>
          </div>

          {/* Net Amount */}
          <div className={`bg-white rounded-xl border p-4 ${(leaveBalance.net_amount ?? 0) >= 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1">
              <DollarSign size={14} />
              Net
            </h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${(leaveBalance.net_amount ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                ₹{leaveBalance.net_amount ?? 0}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Rewards - Penalties</p>
          </div>
        </div>
      )}

      {/* Pending Medical Certificates Alert */}
      {leaveBalance?.pending_medical_certificates > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <Heart className="text-yellow-600" size={24} />
          <div>
            <h4 className="font-semibold text-yellow-800">Medical Certificate Required</h4>
            <p className="text-sm text-yellow-700">
              You have {leaveBalance.pending_medical_certificates} sick leave(s) exceeding 3 days that require medical certificate submission.
            </p>
          </div>
          <button className="ml-auto px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm">
            Upload Certificate
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('my-requests')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'my-requests'
              ? 'border-green-500 text-green-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Requests
        </button>
        {isAdminOrHr && (
          <>
            <button
              onClick={() => setActiveTab('pending-approval')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'pending-approval'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Pending Approval
              {(pendingLeaves.length + pendingWfh.length) > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {pendingLeaves.length + pendingWfh.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('monthly-summary')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'monthly-summary'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Monthly Summary
            </button>
            <button
              onClick={() => setActiveTab('all-employees')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'all-employees'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users size={16} className="inline mr-1" />
              All Employees
            </button>
            <button
              onClick={() => setActiveTab('rewards-penalties')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'rewards-penalties'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Award size={16} className="inline mr-1" />
              Rewards & Penalties
            </button>
          </>
        )}
      </div>

      {/* My Requests Tab */}
      {activeTab === 'my-requests' && (
        <div className="space-y-6">
          {/* Leave Requests */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <FileText size={20} />
              Leave Requests
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {leaveRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No leave requests yet</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Days</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {leaveRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">{getLeaveTypeBadge(req.leave_type)}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(req.start_date)}</td>
                        <td className="px-4 py-3 text-sm">{formatDate(req.end_date)}</td>
                        <td className="px-4 py-3 text-sm">{req.leave_days}</td>
                        <td className="px-4 py-3">{getStatusBadge(req.status)}</td>
                        <td className="px-4 py-3">
                          {req.status === 'PENDING' && (
                            <button
                              onClick={() => cancelRequest(req.id)}
                              className="text-red-600 text-sm hover:underline"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* WFH Requests */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Home size={20} />
              WFH Requests
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {wfhRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No WFH requests yet</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {wfhRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">{formatDate(req.date)}</td>
                        <td className="px-4 py-3 text-sm">{req.reason}</td>
                        <td className="px-4 py-3">{getStatusBadge(req.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending Approval Tab */}
      {activeTab === 'pending-approval' && isAdminOrHr && (
        <div className="space-y-6">
          {/* Pending Leave Requests */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Pending Leave Requests ({pendingLeaves.length})</h3>
            <div className="space-y-3">
              {pendingLeaves.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
                  No pending leave requests
                </div>
              ) : (
                pendingLeaves.map((req) => (
                  <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{req.user_name}</h4>
                        <p className="text-sm text-gray-600">
                          {getLeaveTypeBadge(req.leave_type)} • {formatDate(req.start_date)} to {formatDate(req.end_date)} ({req.leave_days} days)
                        </p>
                        <p className="text-sm text-gray-500 mt-1">Reason: {req.reason}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => handleApproval(req.id, 'leave', 'APPROVED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm"
                        >
                          <CheckCircle size={16} /> Approve
                        </button>
                        <button
                          onClick={() => handleApproval(req.id, 'leave', 'REJECTED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
                        >
                          <XCircle size={16} /> Reject
                        </button>
                        <button
                          onClick={() => markAsUninformed(req.id)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm"
                          title="Mark as uninformed leave (applies ₹100 penalty)"
                        >
                          <AlertTriangle size={16} /> Uninformed
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Pending WFH Requests */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Pending WFH Requests ({pendingWfh.length})</h3>
            <div className="space-y-3">
              {pendingWfh.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
                  No pending WFH requests
                </div>
              ) : (
                pendingWfh.map((req) => (
                  <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{req.user_name}</h4>
                        <p className="text-sm text-gray-600">WFH on {formatDate(req.date)}</p>
                        <p className="text-sm text-gray-500 mt-1">Reason: {req.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproval(req.id, 'wfh', 'APPROVED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm"
                        >
                          <CheckCircle size={16} /> Approve
                        </button>
                        <button
                          onClick={() => handleApproval(req.id, 'wfh', 'REJECTED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
                        >
                          <XCircle size={16} /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Summary Tab */}
      {activeTab === 'monthly-summary' && isAdminOrHr && monthlySummary && (
        <div className="space-y-6 print-root" id="leave-monthly-summary-report">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-semibold print-hide">{monthlySummary.month_name} - Team Summary</h3>
              <div className="flex flex-wrap items-center gap-2">
                <GrowthPartnerFilter selected={gpSelection} onChange={setGpSelection} testId="leave-monthly-gp-filter" />
                <EmployeeSearch value={gpSearch} onChange={setGpSearch} testId="leave-monthly-gp-search" />
                <PrintReportButton
                  title="Leave Monthly Summary"
                  subtitle={`${monthlySummary.month_name} \u00b7 ${monthlyEmployees.length} Growth Partner(s)${gpSearch ? ` \u00b7 search: "${gpSearch}"` : ''}${gpSelection.length ? ' \u00b7 filtered selection' : ' \u00b7 all active Growth Partners'}`}
                  targetId="leave-monthly-summary-report"
                  testId="print-leave-monthly-btn"
                />
              </div>
            </div>
            
            {/* Team Totals */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-600" data-testid="leave-monthly-employee-count">{monthlyEmployees.length}</div>
                <div className="text-xs text-blue-700">Employees</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{monthlySummary.team_totals?.avg_attendance ?? 0}%</div>
                <div className="text-xs text-green-700">Avg Attendance</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-orange-600">{monthlySummary.team_totals?.total_late_days ?? 0}</div>
                <div className="text-xs text-orange-700">Late Days</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{monthlySummary.team_totals?.total_uninformed_leaves ?? 0}</div>
                <div className="text-xs text-red-700">Uninformed</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">₹{monthlySummary.team_totals?.total_rewards_paid ?? 0}</div>
                <div className="text-xs text-green-700">Rewards Paid</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">₹{monthlySummary.team_totals?.total_penalties ?? 0}</div>
                <div className="text-xs text-red-700">Penalties</div>
              </div>
            </div>

            {/* Employee Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Present</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Late</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Leave</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Absent</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Att %</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Uninformed</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Rewards</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Penalties</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {monthlyEmployees.map((emp) => (
                    <tr key={emp.user_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm font-medium">{emp.user_name}</td>
                      <td className="px-3 py-2 text-sm text-center text-green-600">{emp.present_days}</td>
                      <td className="px-3 py-2 text-sm text-center text-orange-600">{emp.late_days}</td>
                      <td className="px-3 py-2 text-sm text-center text-blue-600">{emp.leave_days}</td>
                      <td className="px-3 py-2 text-sm text-center text-red-600">{emp.absent_days}</td>
                      <td className="px-3 py-2 text-sm text-center">
                        <span className={`font-semibold ${emp.attendance_percentage >= 90 ? 'text-green-600' : emp.attendance_percentage >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {emp.attendance_percentage}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-center text-red-600">{emp.leave_breakdown?.uninformed ?? 0}</td>
                      <td className="px-3 py-2 text-sm text-center text-green-600">₹{emp.rewards}</td>
                      <td className="px-3 py-2 text-sm text-center text-red-600">₹{emp.penalties}</td>
                      <td className={`px-3 py-2 text-sm text-center font-semibold ${emp.net_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₹{emp.net_amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* All Employees Tab */}
      {activeTab === 'all-employees' && isAdminOrHr && allEmployeesSummary && (
        <div className="space-y-4 print-root" id="leave-all-employees-report">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-4 print-hide">
              <GrowthPartnerFilter selected={gpSelection} onChange={setGpSelection} testId="leave-all-gp-filter" />
              <EmployeeSearch value={gpSearch} onChange={setGpSearch} testId="leave-all-gp-search" />
              <PrintReportButton
                title="P.A.L.M.E Employee Summary"
                subtitle={`${selectedYear} \u00b7 ${allEmployees.length} Growth Partner(s)${gpSearch ? ` \u00b7 search: "${gpSearch}"` : ''}${gpSelection.length ? ' \u00b7 filtered selection' : ' \u00b7 all active Growth Partners'}`}
                targetId="leave-all-employees-report"
                testId="print-leave-all-btn"
              />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {selectedYear} P.A.L.M.E Summary
                {allEmployeesSummary.accrual_starts_from && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    (Accrual from {allEmployeesSummary.accrual_starts_from})
                  </span>
                )}
              </h3>
              <div className="text-sm text-gray-500">
                <span data-testid="leave-all-employee-count">{allEmployees.length}</span> employees
              </div>
            </div>

            {/* Employee Cards */}
            <div className="space-y-3">
              {allEmployees.map((emp) => (
                <div key={emp.user_id} className="border rounded-lg overflow-hidden">
                  <div 
                    className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => setExpandedEmployee(expandedEmployee === emp.user_id ? null : emp.user_id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold">
                        {emp.user_name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <h4 className="font-semibold">{emp.user_name}</h4>
                        <p className="text-xs text-gray-500">{emp.user_email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">{emp.leave_available}</div>
                        <div className="text-xs text-gray-500">Available</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-orange-600">{emp.leave_used}</div>
                        <div className="text-xs text-gray-500">Used</div>
                      </div>
                      <div className={`text-center px-3 py-1 rounded ${emp.net_amount >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                        <div className={`text-lg font-bold ${emp.net_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{emp.net_amount}
                        </div>
                        <div className="text-xs text-gray-500">Net</div>
                      </div>
                      {expandedEmployee === emp.user_id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                  
                  {expandedEmployee === emp.user_id && (
                    <div className="p-4 border-t bg-white">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-blue-50 rounded p-3">
                          <div className="text-sm text-blue-700">Accrued</div>
                          <div className="text-xl font-bold text-blue-600">{emp.leave_accrued} days</div>
                        </div>
                        <div className="bg-red-50 rounded p-3">
                          <div className="text-sm text-red-700">Uninformed Leaves</div>
                          <div className="text-xl font-bold text-red-600">{emp.uninformed_leaves}</div>
                        </div>
                        <div className="bg-orange-50 rounded p-3">
                          <div className="text-sm text-orange-700">Sick Leaves</div>
                          <div className="text-xl font-bold text-orange-600">{emp.sick_leaves} days</div>
                        </div>
                        <div className="bg-purple-50 rounded p-3">
                          <div className="text-sm text-purple-700">Emergency Leaves</div>
                          <div className="text-xl font-bold text-purple-600">{emp.emergency_leaves} days</div>
                        </div>
                        <div className="bg-green-50 rounded p-3">
                          <div className="text-sm text-green-700">Total Rewards</div>
                          <div className="text-xl font-bold text-green-600">₹{emp.total_rewards}</div>
                        </div>
                        <div className="bg-red-50 rounded p-3">
                          <div className="text-sm text-red-700">Total Penalties</div>
                          <div className="text-xl font-bold text-red-600">₹{emp.total_penalties}</div>
                        </div>
                        {emp.pending_medical_certs > 0 && (
                          <div className="bg-yellow-50 rounded p-3 col-span-2">
                            <div className="text-sm text-yellow-700 flex items-center gap-1">
                              <AlertCircle size={14} /> Pending Medical Certificates
                            </div>
                            <div className="text-xl font-bold text-yellow-600">{emp.pending_medical_certs}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rewards & Penalties Tab */}
      {activeTab === 'rewards-penalties' && isAdminOrHr && (
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowRewardModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg"
            >
              <Trophy size={18} /> Add Reward
            </button>
            <button
              onClick={() => setShowPenaltyModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg"
            >
              <AlertTriangle size={18} /> Add Penalty
            </button>
          </div>

          {/* Policy Overview */}
          {palmePolicy && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Award className="text-green-600" size={24} />
                P.A.L.M.E Rewards & Accountability
              </h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                {/* Rewards */}
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                    <Trophy size={18} /> REWARDS
                  </h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-2 bg-white rounded">
                      <div>
                        <div className="font-medium">On Time All Week</div>
                        <div className="text-xs text-gray-500">Present on time for 5/6 working days</div>
                      </div>
                      <div className="text-lg font-bold text-green-600">₹200</div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white rounded">
                      <div>
                        <div className="font-medium">Perfect Punctuality</div>
                        <div className="text-xs text-gray-500">Present on time for entire month</div>
                      </div>
                      <div className="text-lg font-bold text-green-600">₹500</div>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white rounded">
                      <div>
                        <div className="font-medium">Outstanding Attendance</div>
                        <div className="text-xs text-gray-500">3 consecutive months + Certificate</div>
                      </div>
                      <div className="text-lg font-bold text-green-600">₹2,000</div>
                    </div>
                  </div>
                </div>

                {/* Accountability */}
                <div className="bg-red-50 rounded-lg p-4">
                  <h4 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                    <AlertTriangle size={18} /> ACCOUNTABILITY
                  </h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-2 bg-white rounded">
                      <div>
                        <div className="font-medium">Uninformed Leave</div>
                        <div className="text-xs text-gray-500">Leave without prior approval</div>
                      </div>
                      <div className="text-lg font-bold text-red-600">₹100 / each</div>
                    </div>
                    <div className="p-2 bg-white rounded">
                      <div className="font-medium text-orange-700">Medical Certificate Required</div>
                      <div className="text-xs text-gray-500">
                        Sick leave exceeding 3 consecutive days requires medical certificate submission
                      </div>
                    </div>
                    <div className="p-2 bg-white rounded">
                      <div className="font-medium text-yellow-700">Leave Application Rule</div>
                      <div className="text-xs text-gray-500">
                        All leave requests must be applied 3+ days in advance
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leave Application Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Apply for Leave</h2>
            <form onSubmit={handleLeaveSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="ALLOWED">Planned Leave (3+ days advance)</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="MEDICAL">Medical Leave (with certificate)</option>
                  <option value="EMERGENCY">Emergency Leave</option>
                  <option value="UNPAID">Unpaid Leave</option>
                </select>
                {leaveForm.leave_type === 'SICK' && (
                  <p className="text-xs text-orange-600 mt-1">Note: Sick leave &gt;3 days requires medical certificate</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                  <input
                    type="date"
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                  <input
                    type="date"
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    required
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="half_day"
                  checked={leaveForm.half_day}
                  onChange={(e) => setLeaveForm({ ...leaveForm, half_day: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <label htmlFor="half_day" className="text-sm text-gray-700">Half Day</label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  rows={3}
                  required
                  placeholder="Please specify reason for leave"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WFH Application Modal */}
      {showWfhModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Apply for Work From Home</h2>
            <form onSubmit={handleWfhSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={wfhForm.date}
                  onChange={(e) => setWfhForm({ ...wfhForm, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea
                  value={wfhForm.reason}
                  onChange={(e) => setWfhForm({ ...wfhForm, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  rows={3}
                  required
                  placeholder="Please specify reason for WFH"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowWfhModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Reward Modal */}
      {showRewardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Trophy className="text-green-600" /> Add Reward
            </h2>
            <form onSubmit={handleRewardSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select
                  value={rewardForm.user_id}
                  onChange={(e) => setRewardForm({ ...rewardForm, user_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">Select Employee</option>
                  {allEmployeesSummary?.employees?.map(emp => (
                    <option key={emp.user_id} value={emp.user_id}>{emp.user_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reward Type</label>
                <select
                  value={rewardForm.reward_type}
                  onChange={(e) => {
                    const type = e.target.value;
                    let amount = 200;
                    if (type === 'monthly_perfect') amount = 500;
                    if (type === 'quarterly_outstanding') amount = 2000;
                    setRewardForm({ ...rewardForm, reward_type: type, amount });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="weekly_on_time">Weekly - On Time All Week (₹200)</option>
                  <option value="monthly_perfect">Monthly - Perfect Punctuality (₹500)</option>
                  <option value="quarterly_outstanding">Quarterly - Outstanding (₹2,000)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={rewardForm.amount}
                  onChange={(e) => setRewardForm({ ...rewardForm, amount: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={rewardForm.description}
                  onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="e.g., Week 1 December"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowRewardModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add Reward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Penalty Modal */}
      {showPenaltyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="text-red-600" /> Add Penalty
            </h2>
            <form onSubmit={handlePenaltySubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select
                  value={penaltyForm.user_id}
                  onChange={(e) => setPenaltyForm({ ...penaltyForm, user_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="">Select Employee</option>
                  {allEmployeesSummary?.employees?.map(emp => (
                    <option key={emp.user_id} value={emp.user_id}>{emp.user_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Penalty Type</label>
                <select
                  value={penaltyForm.penalty_type}
                  onChange={(e) => setPenaltyForm({ ...penaltyForm, penalty_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                >
                  <option value="uninformed_leave">Uninformed Leave (₹100)</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={penaltyForm.amount}
                  onChange={(e) => setPenaltyForm({ ...penaltyForm, amount: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={penaltyForm.description}
                  onChange={(e) => setPenaltyForm({ ...penaltyForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  placeholder="Reason for penalty"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPenaltyModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Applying...' : 'Apply Penalty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManagement;
