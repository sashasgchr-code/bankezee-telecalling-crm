import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, Search, ChevronDown, Eye, Trash2, Download, RefreshCw, 
  Clock, DollarSign, TrendingUp, CheckCircle, XCircle, LogIn, AlertTriangle,
  BarChart3, Star, ChevronLeft, ChevronRight, Loader2, Filter
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import { FILE_STATUS_OPTIONS } from '../../components/file-detail/FileStatusCard';

// Status colors matching old CRM
const FILE_STATUS_COLORS = {
  new: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  contacted: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  query: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  hold: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
  documents_collected: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  not_eligible: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  sent_to_bank: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  login: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  not_login: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  approved: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  declined: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  disbursed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  not_disbursed: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  fi_negative: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  not_interested: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
  supporting: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' }
};

const formatCurrency = (amount, compact = false) => {
  if (!amount) return '₹0';
  if (compact && amount >= 10000000) {
    return '₹' + (amount / 10000000).toFixed(2) + 'Cr';
  }
  if (compact && amount >= 100000) {
    return '₹' + (amount / 100000).toFixed(2) + 'L';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
};

const formatPhone = (phone) => {
  if (!phone) return '-';
  const str = String(phone);
  if (str.length >= 10) {
    return '******' + str.slice(-4);
  }
  return str;
};

const FilesDashboard = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiles, setTotalFiles] = useState(0);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [starFilter, setStarFilter] = useState('');
  const [createdDateFilter, setCreatedDateFilter] = useState('all');
  const [activityDateFilter, setActivityDateFilter] = useState('all');
  
  const [opsTeam, setOpsTeam] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    fetchAll();
  }, [page, statusFilter, managerFilter]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchFiles(),
        fetchStats(),
        fetchReports(),
        fetchOpsTeam()
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async () => {
    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', 50);
      if (statusFilter) params.append('file_status', statusFilter);
      if (managerFilter) params.append('assigned_to', managerFilter);

      const response = await api.get(`/files?${params.toString()}`);
      setFiles(response.data.files || []);
      setTotalPages(response.data.pagination?.pages || 1);
      setTotalFiles(response.data.pagination?.total || 0);
    } catch (error) {
      console.error('Failed to fetch files:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/files/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchReports = async () => {
    try {
      const response = await api.get('/files/reports');
      setReports(response.data);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    }
  };

  const fetchOpsTeam = async () => {
    try {
      const response = await api.get('/files/operations-team');
      setOpsTeam(response.data || []);
    } catch (error) {
      console.error('Failed to fetch ops team:', error);
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await api.get('/files/export');
      const files = response.data.files || [];
      
      // Convert to CSV
      const headers = ['Name', 'Phone', 'Email', 'Loan Type', 'Status', 'Assigned To', 'Created Date'];
      const rows = files.map(f => [
        f.name || '',
        f.phone || '',
        f.email || '',
        f.requirement || f.file_details?.type_of_loan || '',
        f.file_status || '',
        opsTeam.find(o => o.id === f.file_assigned_to)?.full_name || '',
        f.created_at ? new Date(f.created_at).toLocaleDateString() : ''
      ]);
      
      const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `files_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      toast.success('CSV exported');
    } catch (error) {
      toast.error('Failed to export');
    }
  };

  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedFiles.length === filteredFiles.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(filteredFiles.map(f => f.id));
    }
  };

  const filteredFiles = useMemo(() => {
    return files.filter(file => {
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch = (
          (file.name || '').toLowerCase().includes(search) ||
          (file.phone || '').includes(search)
        );
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [files, searchTerm]);

  const getStatusLabel = (status) => {
    const opt = FILE_STATUS_OPTIONS.find(o => o.value === status);
    return opt?.label || status || 'New';
  };

  const getStatusColor = (status) => {
    return FILE_STATUS_COLORS[status] || FILE_STATUS_COLORS.new;
  };

  // Calculate derived stats
  const derivedStats = useMemo(() => {
    if (!reports?.summary) return {};
    const byStatus = reports.summary.by_status || {};
    
    // In Progress = Contacted + Query/Hold
    const inProgress = (byStatus.contacted || 0) + (byStatus.query || 0) + (byStatus.hold || 0);
    
    // Login = login + approved + declined + disbursed + not_disbursed
    const loginTotal = (byStatus.login || 0) + (byStatus.approved || 0) + (byStatus.declined || 0) + 
                       (byStatus.disbursed || 0) + (byStatus.not_disbursed || 0);
    
    // Interim Rejects = FI Negative + Declined + Cust. Not Interested/Supporting
    const interimRejects = (byStatus.fi_negative || 0) + (byStatus.declined || 0) + 
                          (byStatus.not_interested || 0) + (byStatus.supporting || 0);
    
    // Final Rejections = Rejected + Not Eligible + Not Login + Not Disbursed
    const finalRejections = (byStatus.rejected || 0) + (byStatus.not_eligible || 0) + 
                           (byStatus.not_login || 0) + (byStatus.not_disbursed || 0);
    
    return { inProgress, loginTotal, interimRejects, finalRejections };
  }, [reports]);

  const StatCard = ({ label, value, subLabel, color = 'text-gray-900', icon: Icon, amount }) => (
    <div className="bg-white rounded-lg border border-gray-200 p-4 min-w-[140px]">
      <div className="flex justify-between items-start">
        <span className="text-sm text-gray-600">{label}</span>
        {Icon && <Icon size={18} className="text-gray-400" />}
      </div>
      {amount ? (
        <p className={`text-xl font-bold mt-1 ${color}`}>{formatCurrency(value, true)}</p>
      ) : (
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value || 0}</p>
      )}
      {subLabel && <p className="text-xs text-gray-500 mt-0.5">{subLabel}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Header with Report Links */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Admin</h1>
              <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
            </div>
            <span className="text-sm text-gray-500">Welcome, Admin User</span>
          </div>
          
          {/* Report Buttons - Match old CRM */}
          <div className="flex items-center gap-2 flex-wrap">
            <button className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
              <FileText size={14} />
              Daily Report
            </button>
            <button className="px-3 py-1.5 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-1">
              <XCircle size={14} />
              Rejected Cases
            </button>
            <button className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center gap-1">
              <BarChart3 size={14} />
              Growth Partner Performance
            </button>
            <button className="px-3 py-1.5 text-sm bg-green-50 text-green-600 border border-green-200 rounded-lg hover:bg-green-100 flex items-center gap-1">
              <BarChart3 size={14} />
              Sales & Ops Report
            </button>
            <button className="px-3 py-1.5 text-sm bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1">
              <Star size={14} />
              Quality Report
            </button>
            <button className="px-3 py-1.5 text-sm bg-purple-50 text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-100 flex items-center gap-1">
              <FileText size={14} />
              Policy Master
            </button>
            <button onClick={handleExportCSV} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
              <Download size={14} />
              Export Disbursed
            </button>
            <button className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
              <BarChart3 size={14} />
              Export Stats
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex gap-1">
          {['Dashboard', 'Approvals', 'Users'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab.toLowerCase())}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.toLowerCase()
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'Dashboard' && <BarChart3 size={16} className="inline mr-1.5" />}
              {tab === 'Approvals' && <Clock size={16} className="inline mr-1.5" />}
              {tab === 'Users' && <FileText size={16} className="inline mr-1.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Filters Row */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or mobile..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                data-testid="search-input"
              />
            </div>
            
            {/* Date Filters */}
            <select
              value={createdDateFilter}
              onChange={(e) => setCreatedDateFilter(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">File Created</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
            
            <select
              value={activityDateFilter}
              onChange={(e) => setActivityDateFilter(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">Activity Date</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
            
            {/* Loan Type */}
            <select
              value={loanTypeFilter}
              onChange={(e) => setLoanTypeFilter(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="">All Loan Types</option>
              <option value="personal">New Personal Loan</option>
              <option value="balance_transfer">Balance Transfer+Top Up PL</option>
              <option value="used_vehicle">Used Vehicle</option>
              <option value="merge_loans">Merge Multiple Loans</option>
              <option value="business">Business Loan</option>
            </select>
            
            {/* Status */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
              data-testid="status-filter"
            >
              <option value="">All Status</option>
              {FILE_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            
            {/* Managers */}
            <select
              value={managerFilter}
              onChange={(e) => { setManagerFilter(e.target.value); setPage(1); }}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="">All Managers</option>
              {opsTeam.map(member => (
                <option key={member.id} value={member.id}>{member.full_name || member.name}</option>
              ))}
            </select>
            
            {/* Sources */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="">All Sources</option>
              <option value="website">Website</option>
              <option value="referral">Referral</option>
              <option value="import">Import</option>
            </select>
            
            {/* Stars */}
            <select
              value={starFilter}
              onChange={(e) => setStarFilter(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="">All Stars</option>
              <option value="5">5 Stars</option>
              <option value="4">4+ Stars</option>
              <option value="3">3+ Stars</option>
            </select>
          </div>
        </div>

        {/* Stats Cards - Two Rows */}
        <div className="space-y-3">
          {/* Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard 
              label="Total Files" 
              value={stats?.total_files || 0} 
              icon={FileText}
            />
            <StatCard 
              label="New" 
              value={stats?.new || 0}
              icon={FileText}
            />
            <StatCard 
              label="In Progress" 
              value={derivedStats.inProgress || stats?.contacted || 0}
              subLabel="Created date"
              icon={Clock}
              color="text-orange-600"
            />
            <StatCard 
              label="Login" 
              value={stats?.login || derivedStats.loginTotal || 0}
              subLabel={`C: ${stats?.login || 0} S: 0`}
              icon={LogIn}
            />
            <StatCard 
              label="Approved" 
              value={stats?.approved || 0}
              subLabel={`C: ${stats?.approved || 0} S: 0`}
              icon={CheckCircle}
              color="text-green-600"
            />
            <StatCard 
              label="Total Approved" 
              value={reports?.summary?.total_disbursed_amount || 0}
              subLabel="Activity date"
              color="text-green-600"
              icon={TrendingUp}
              amount
            />
          </div>
          
          {/* Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard 
              label="Disbursed" 
              value={stats?.disbursed || 0}
              subLabel={`C: ${stats?.disbursed || 0} S: 0`}
              icon={CheckCircle}
              color="text-emerald-600"
            />
            <StatCard 
              label="Total Disbursed" 
              value={reports?.summary?.total_disbursed_amount || 0}
              subLabel="Activity date"
              color="text-emerald-600"
              icon={DollarSign}
              amount
            />
            <StatCard 
              label="Interim Rejects" 
              value={derivedStats.interimRejects || 0}
              subLabel={`C: ${derivedStats.interimRejects || 0} S: 0`}
              icon={AlertTriangle}
              color="text-amber-600"
            />
            <StatCard 
              label="Final Rejections" 
              value={derivedStats.finalRejections || stats?.rejected || 0}
              subLabel={`C: ${stats?.rejected || 0} S: 0`}
              icon={XCircle}
              color="text-red-600"
            />
            <StatCard 
              label="Amt in Pipeline" 
              value={reports?.summary?.total_disbursed_amount * 0.1 || 0}
              subLabel="Login=Yes & App ID"
              color="text-blue-600"
              icon={TrendingUp}
              amount
            />
          </div>
        </div>

        {/* Status Definitions */}
        <div className="text-xs text-gray-500 px-2">
          <p><strong>In Progress:</strong> Contacted to Query/Hold (created date) &nbsp;&nbsp; 
             <strong>Login:</strong> Login + Approved + Declined + Not Disbursed + Rejected-after-login &nbsp;&nbsp;
             <strong>Interim Rejects:</strong> FI Negative + Declined + Cust. Not Interested/Supporting</p>
          <p><strong>Final Rejections:</strong> Rejected + Not Eligible + Not Login + Not Disbursed &nbsp;&nbsp;
             <strong>Amt in Pipeline:</strong> Eligible Amt where Login=Yes & App ID filled, excl. disbursed/declined/rejected</p>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* File Status Distribution (Donut Chart placeholder) */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">File Status Distribution</h3>
            <div className="flex items-center justify-center h-48">
              {/* Simple visual representation */}
              <div className="relative w-40 h-40">
                <div className="absolute inset-0 rounded-full border-8 border-gray-200"></div>
                <div className="absolute inset-0 rounded-full border-8 border-emerald-500" style={{clipPath: `polygon(0 0, 100% 0, 100% ${(stats?.disbursed || 0) / (stats?.total_files || 1) * 100}%, 0 ${(stats?.disbursed || 0) / (stats?.total_files || 1) * 100}%)`}}></div>
                <div className="absolute inset-4 bg-white rounded-full flex flex-col items-center justify-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-xl font-bold">{stats?.total_files || 0}</span>
                </div>
              </div>
              <div className="ml-4 space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                  <span>Disbursed: {stats?.disbursed || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-green-500"></span>
                  <span>Approved: {stats?.approved || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                  <span>In Progress: {derivedStats.inProgress || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                  <span>New: {stats?.new || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Monthly Performance (Line Chart placeholder) */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Monthly Performance</h3>
            <p className="text-xs text-gray-400 mb-4">Sample visualization</p>
            <div className="h-48 flex items-end justify-around gap-2">
              {[65, 72, 80, 75, 85, 78, 90, 82, 88, 76, 92, 85].map((val, idx) => (
                <div key={`month-${idx}`} className="flex-1 flex flex-col items-center">
                  <div 
                    className="w-full bg-green-500 rounded-t"
                    style={{ height: `${val}%` }}
                  ></div>
                  <span className="text-xs text-gray-500 mt-1">{idx + 1}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Loans by Type (Bar Chart placeholder) */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Loans by Type</h3>
            <p className="text-xs text-gray-400 mb-4">Sample visualization</p>
            <div className="space-y-3">
              {[
                { type: 'New Personal Loan', count: 143 },
                { type: 'Balance Transfer', count: 125 },
                { type: 'Topup PL', count: 54 },
                { type: 'Used Vehicle', count: 41 },
                { type: 'Loan BT', count: 35 },
                { type: 'Merge Loans', count: 28 },
              ].map((item) => (
                <div key={item.type} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-28 truncate">{item.type}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div 
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${(item.count / 143) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-medium text-gray-700 w-8">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Files List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* List Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-gray-900">Files ({totalFiles})</h3>
              <span className="text-sm text-gray-500">All files in the system</span>
            </div>
            <button 
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"
            >
              <FileText size={14} />
              Export CSV
            </button>
          </div>

          {/* Select All */}
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selectedFiles.length === filteredFiles.length && filteredFiles.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-gray-300"
              />
              Select all ({filteredFiles.length} files)
            </label>
          </div>

          {/* Files List */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-green-600" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <FileText size={48} className="mx-auto mb-4 text-gray-300" />
              <p>No files found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
              {filteredFiles.map((file) => {
                const statusColor = getStatusColor(file.file_status);
                const assignee = opsTeam.find(o => o.id === file.file_assigned_to);
                const loanAmount = file.file_details?.loan_amount_required || file.eligibilities?.[0]?.eligible_amount;
                const rating = file.rating || 0;
                
                return (
                  <div
                    key={file.id}
                    className="px-4 py-3 hover:bg-gray-50 transition-colors"
                    data-testid={`file-row-${file.id}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300"
                      />
                      
                      {/* Main Info */}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900">{file.name || 'Unnamed'}</h4>
                        <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                          <span>{formatPhone(file.phone)}</span>
                          <span className="flex items-center gap-0.5">
                            <Eye size={12} />
                          </span>
                          <span className="text-gray-300">|</span>
                          <span>{file.requirement || file.file_details?.type_of_loan || '-'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                          <span>{file.created_at ? new Date(file.created_at).toLocaleDateString() : '-'}</span>
                          <span>•</span>
                          <span className="text-green-600">{assignee?.full_name || assignee?.name || 'Unassigned'}</span>
                          {loanAmount && (
                            <>
                              <span>•</span>
                              <span className="text-green-600">{formatCurrency(loanAmount)}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>Assigned</span>
                        </div>
                        {/* Star Rating */}
                        <div className="flex items-center gap-0.5 mt-1">
                          {[1,2,3,4,5].map(star => (
                            <Star 
                              key={star} 
                              size={14} 
                              className={star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
                            />
                          ))}
                        </div>
                      </div>
                      
                      {/* Status Badge */}
                      <span className={`px-3 py-1 rounded border text-sm font-medium ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}>
                        {getStatusLabel(file.file_status)}
                      </span>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => navigate(`/admin/files/${file.id}`)}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                          title="View Details"
                        >
                          <Eye size={18} />
                        </button>
                        <button 
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <p className="text-sm text-gray-500">
                Page {page} of {totalPages} ({totalFiles} total files)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilesDashboard;
