import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle, XCircle, Loader2, Home, FileText, RefreshCw } from 'lucide-react';
import api from '../../services/api';

const LeaveManagement = () => {
  const [activeTab, setActiveTab] = useState('my-requests');
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [pendingWfh, setPendingWfh] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showWfhModal, setShowWfhModal] = useState(false);
  const [user, setUser] = useState(null);

  // Form states
  const [leaveForm, setLeaveForm] = useState({
    start_date: '',
    end_date: '',
    leave_type: 'CASUAL',
    reason: '',
    half_day: false,
    half_day_type: ''
  });
  const [wfhForm, setWfhForm] = useState({
    date: '',
    reason: ''
  });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [balanceRes, myLeavesRes, myWfhRes] = await Promise.all([
        api.get('/leave/balance'),
        api.get('/leave/requests/my'),
        api.get('/leave/wfh/requests/my')
      ]);
      
      setLeaveBalance(balanceRes.data);
      setLeaveRequests(myLeavesRes.data);
      setWfhRequests(myWfhRes.data);

      // Check if user is admin/hr - fetch pending requests
      const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (storedUser.role === 'admin' || storedUser.role === 'hr') {
        const [pendingLeavesRes, pendingWfhRes] = await Promise.all([
          api.get('/leave/requests/pending'),
          api.get('/leave/wfh/requests/pending')
        ]);
        setPendingLeaves(pendingLeavesRes.data);
        setPendingWfh(pendingWfhRes.data);
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
      setLeaveForm({ start_date: '', end_date: '', leave_type: 'CASUAL', reason: '', half_day: false, half_day_type: '' });
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
    <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-600 text-sm">Manage leave and WFH requests</p>
        </div>
        <div className="flex gap-2">
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

      {/* Leave Balance Cards */}
      {leaveBalance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Object.entries(leaveBalance).filter(([key]) => key !== 'year').map(([type, data]) => (
            <div key={type} className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-medium text-gray-600 capitalize">{type} Leave</h3>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {typeof data.total === 'number' ? (data.total - data.used).toFixed(1) : data.total}
                </span>
                <span className="text-sm text-gray-500">
                  / {data.total} days
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Used: {data.used} days
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveTab('my-requests')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'my-requests'
              ? 'border-green-500 text-green-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Requests
        </button>
        {isAdminOrHr && (
          <button
            onClick={() => setActiveTab('pending-approval')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
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
                <div className="p-8 text-center text-gray-500">
                  No leave requests yet
                </div>
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
                        <td className="px-4 py-3 text-sm">{req.leave_type}</td>
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
                <div className="p-8 text-center text-gray-500">
                  No WFH requests yet
                </div>
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

      {/* Pending Approval Tab (Admin/HR only) */}
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
                          {req.leave_type} Leave • {formatDate(req.start_date)} to {formatDate(req.end_date)} ({req.leave_days} days)
                        </p>
                        <p className="text-sm text-gray-500 mt-1">Reason: {req.reason}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproval(req.id, 'leave', 'APPROVED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm"
                          data-testid={`approve-leave-${req.id}`}
                        >
                          <CheckCircle size={16} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleApproval(req.id, 'leave', 'REJECTED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
                          data-testid={`reject-leave-${req.id}`}
                        >
                          <XCircle size={16} />
                          Reject
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
                          <CheckCircle size={16} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleApproval(req.id, 'wfh', 'REJECTED')}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
                        >
                          <XCircle size={16} />
                          Reject
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
                  <option value="CASUAL">Casual Leave</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="EARNED">Earned Leave</option>
                  <option value="UNPAID">Unpaid Leave</option>
                  <option value="EMERGENCY">Emergency Leave</option>
                </select>
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
    </div>
  );
};

export default LeaveManagement;
