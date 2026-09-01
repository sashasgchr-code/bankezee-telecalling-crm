import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, Search, ChevronDown, Eye, Trash2, Download, RefreshCw, 
  Clock, DollarSign, TrendingUp, CheckCircle, XCircle, LogIn, AlertTriangle,
  BarChart3, Star, ChevronLeft, ChevronRight, Loader2, Filter, Database,
  Calendar, Users, Building2, Timer
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
  
  // Date Range State
  const [dateFilter, setDateFilter] = useState('all'); // 'all', 'today', 'week', 'month', 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  
  // Reports State
  const [bankPerformance, setBankPerformance] = useState(null);
  const [tatMetrics, setTatMetrics] = useState(null);
  const [growthPartner, setGrowthPartner] = useState(null);
  const [showBankTable, setShowBankTable] = useState(false);
  const [showTatMetrics, setShowTatMetrics] = useState(false);
  const [showGrowthPartner, setShowGrowthPartner] = useState(false);
  
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
  const [allUsers, setAllUsers] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [approvalFiles, setApprovalFiles] = useState([]);

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  
  // Calculate date range based on filter
  const getDateRange = () => {
    const now = new Date();
    let startDate = null;
    let endDate = null;
    
    switch(dateFilter) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        endDate = now.toISOString();
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        startDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).toISOString();
        endDate = now.toISOString();
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        endDate = now.toISOString();
        break;
      case 'last_month':
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate = lastMonth.toISOString();
        endDate = lastDay.toISOString();
        break;
      case 'custom':
        if (customStartDate) startDate = new Date(customStartDate).toISOString();
        if (customEndDate) endDate = new Date(customEndDate + 'T23:59:59').toISOString();
        break;
      default:
        // all time - no dates
        break;
    }
    return { startDate, endDate };
  };

  useEffect(() => {
    fetchAll();
  }, [page, statusFilter, managerFilter, dateFilter, customStartDate, customEndDate]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchFiles(),
        fetchStats(),
        fetchReports(),
        fetchOpsTeam(),
        fetchBankPerformance(),
        fetchTatMetrics(),
        fetchGrowthPartner(),
        fetchAllUsers(),
        fetchApprovalFiles()
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
      
      // Telecaller sees only their assigned files
      if (!isAdmin && user?.id) {
        params.append('assigned_to', user.id);
      }

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
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      
      // Telecaller sees stats for their files only
      if (!isAdmin && user?.id) {
        params.append('assigned_to', user.id);
      }
      
      const response = await api.get(`/files/dashboard/stats?${params.toString()}`);
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
  
  const fetchBankPerformance = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const response = await api.get(`/files/reports/bank-performance?${params.toString()}`);
      setBankPerformance(response.data);
    } catch (error) {
      console.error('Failed to fetch bank performance:', error);
    }
  };
  
  const fetchTatMetrics = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const response = await api.get(`/files/reports/tat-metrics?${params.toString()}`);
      setTatMetrics(response.data);
    } catch (error) {
      console.error('Failed to fetch TAT metrics:', error);
    }
  };
  
  const fetchGrowthPartner = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const response = await api.get(`/files/reports/growth-partner?${params.toString()}`);
      setGrowthPartner(response.data);
    } catch (error) {
      console.error('Failed to fetch growth partner:', error);
    }
  };
  
  const fetchAllUsers = async () => {
    try {
      const response = await api.get('/users');
      setAllUsers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };
  
  const fetchApprovalFiles = async () => {
    try {
      const response = await api.get('/files?file_status=approved&limit=100');
      setApprovalFiles(response.data.files || []);
    } catch (error) {
      console.error('Failed to fetch approval files:', error);
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

  // Export Bank Performance Report to CSV
  const handleExportBankPerformance = () => {
    if (!bankPerformance?.banks?.length) {
      toast.error('No data to export');
      return;
    }
    const headers = ['Bank Name', 'Logins', 'Approvals', 'Approved Amount', 'Disbursals', 'Disbursed Amount'];
    const rows = bankPerformance.banks.map(b => [
      b.bank_name || '',
      b.logins || 0,
      b.approvals || 0,
      b.approved_amount || 0,
      b.disbursals || 0,
      b.disbursed_amount || 0
    ]);
    // Add totals row
    rows.push([
      'TOTAL',
      bankPerformance.banks.reduce((a, b) => a + b.logins, 0),
      bankPerformance.banks.reduce((a, b) => a + b.approvals, 0),
      bankPerformance.banks.reduce((a, b) => a + b.approved_amount, 0),
      bankPerformance.banks.reduce((a, b) => a + b.disbursals, 0),
      bankPerformance.banks.reduce((a, b) => a + b.disbursed_amount, 0)
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bank_performance_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Bank Performance report exported');
  };

  // Export TAT Metrics Report to CSV
  const handleExportTatMetrics = () => {
    if (!tatMetrics) {
      toast.error('No data to export');
      return;
    }
    const headers = ['Metric', 'Average (days)', 'Mode Bucket', 'Sample Count'];
    const rows = [
      ['Lead to Login', tatMetrics.lead_to_login?.average || 'N/A', tatMetrics.lead_to_login?.mode_bucket || 'N/A', tatMetrics.lead_to_login?.count || 0],
      ['Login to Approval', tatMetrics.login_to_approval?.average || 'N/A', tatMetrics.login_to_approval?.mode_bucket || 'N/A', tatMetrics.login_to_approval?.count || 0],
      ['Approval to Disbursal', tatMetrics.approval_to_disbursal?.average || 'N/A', tatMetrics.approval_to_disbursal?.mode_bucket || 'N/A', tatMetrics.approval_to_disbursal?.count || 0],
      ['Lead to Disbursal', tatMetrics.lead_to_disbursal?.average || 'N/A', tatMetrics.lead_to_disbursal?.mode_bucket || 'N/A', tatMetrics.lead_to_disbursal?.count || 0]
    ];
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tat_metrics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('TAT Metrics report exported');
  };

  // Export Growth Partner Report to CSV
  const handleExportGrowthPartner = () => {
    if (!growthPartner?.agents?.length) {
      toast.error('No data to export');
      return;
    }
    const headers = ['Partner Name', 'Files Generated', 'Logins', 'Approvals', 'Approved Amount', 'Disbursals', 'Disbursed Amount'];
    const rows = growthPartner.agents.map(a => [
      a.agent_name || '',
      a.files_generated || 0,
      a.logins || 0,
      a.approvals || 0,
      a.approved_amount || 0,
      a.disbursals || 0,
      a.disbursed_amount || 0
    ]);
    // Add totals row
    if (growthPartner.totals) {
      rows.push([
        'TOTAL',
        growthPartner.totals.files_generated || 0,
        growthPartner.totals.logins || 0,
        growthPartner.totals.approvals || 0,
        growthPartner.totals.approved_amount || 0,
        growthPartner.totals.disbursals || 0,
        growthPartner.totals.disbursed_amount || 0
      ]);
    }
    
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `growth_partner_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Growth Partner report exported');
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
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{isAdmin ? 'Admin' : 'Files'}</h1>
              <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
            </div>
            <span className="text-sm text-gray-500 hidden md:inline">Welcome, {user.full_name || user.name || 'User'}</span>
          </div>
          
          {/* Report Buttons - Responsive wrap */}
          <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2 lg:pb-0">
            {isAdmin && (
              <>
                <button className="px-2 md:px-3 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap">
                  <FileText size={14} />
                  <span className="hidden sm:inline">Daily Report</span>
                  <span className="sm:hidden">Daily</span>
                </button>
                <button className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-1 whitespace-nowrap">
                  <XCircle size={14} />
                  <span className="hidden sm:inline">Rejected</span>
                </button>
                <button 
                  onClick={() => setShowGrowthPartner(!showGrowthPartner)}
                  className={`px-2 md:px-3 py-1.5 text-xs md:text-sm border rounded-lg flex items-center gap-1 whitespace-nowrap ${showGrowthPartner ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                >
                  <Users size={14} />
                  <span className="hidden sm:inline">Growth Partner</span>
                  <span className="sm:hidden">Partners</span>
                </button>
                <button 
                  onClick={() => setShowBankTable(!showBankTable)}
                  className={`px-2 md:px-3 py-1.5 text-xs md:text-sm border rounded-lg flex items-center gap-1 whitespace-nowrap ${showBankTable ? 'bg-green-600 text-white border-green-600' : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'}`}
                >
                  <Building2 size={14} />
                  <span className="hidden sm:inline">Bank Perf.</span>
                  <span className="sm:hidden">Banks</span>
                </button>
                <button 
                  onClick={() => setShowTatMetrics(!showTatMetrics)}
                  className={`px-2 md:px-3 py-1.5 text-xs md:text-sm border rounded-lg flex items-center gap-1 whitespace-nowrap ${showTatMetrics ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'}`}
                >
                  <Timer size={14} />
                  <span className="hidden sm:inline">TAT</span>
                </button>
                <button className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1 whitespace-nowrap">
                  <Star size={14} />
                  <span className="hidden sm:inline">Quality</span>
                </button>
              </>
            )}
            <button 
              onClick={() => navigate(isAdmin ? '/admin/files/policies' : '/agent/files/policies')}
              className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-purple-50 text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-100 flex items-center gap-1 whitespace-nowrap"
            >
              <FileText size={14} />
              <span className="hidden sm:inline">Policy</span>
            </button>
            {isAdmin && (
              <>
                <button onClick={handleExportCSV} className="px-2 md:px-3 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap">
                  <Download size={14} />
                  <span className="hidden sm:inline">Export</span>
                </button>
                <button 
                  onClick={() => navigate('/admin/files/migrate')}
                  className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-orange-50 text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-100 flex items-center gap-1 whitespace-nowrap"
                >
                  <Database size={14} />
                  <span className="hidden sm:inline">Import</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex gap-1">
          {['Dashboard', 'Approvals', ...(isAdmin ? ['Users'] : [])].map(tab => (
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
        {/* Dashboard Tab Content */}
        {activeTab === 'dashboard' && (
          <>
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
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white font-medium"
                    data-testid="date-filter"
                  >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
              {dateFilter === 'custom' && (
                <>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    data-testid="custom-start-date"
                  />
                  <span className="text-gray-400">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    data-testid="custom-end-date"
                  />
                </>
              )}
            </div>
            
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
              value={stats?.in_progress || 0}
              subLabel="Created date"
              icon={Clock}
              color="text-orange-600"
            />
            <StatCard 
              label="Login" 
              value={stats?.login || 0}
              subLabel={`C: ${stats?.login_current || 0} S: ${stats?.login_spillover || 0}`}
              icon={LogIn}
            />
            <StatCard 
              label="Approved" 
              value={stats?.approved || 0}
              subLabel={`C: ${stats?.approved_current || 0} S: ${stats?.approved_spillover || 0}`}
              icon={CheckCircle}
              color="text-green-600"
            />
            <StatCard 
              label="Total Approved" 
              value={stats?.total_approved_amount || 0}
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
              subLabel={`C: ${stats?.disbursed_current || 0} S: ${stats?.disbursed_spillover || 0}`}
              icon={CheckCircle}
              color="text-emerald-600"
            />
            <StatCard 
              label="Total Disbursed" 
              value={stats?.total_disbursed_amount || 0}
              subLabel="Activity date"
              color="text-emerald-600"
              icon={DollarSign}
              amount
            />
            <StatCard 
              label="Interim Rejects" 
              value={stats?.interim_rejects || 0}
              subLabel={`C: ${stats?.interim_rejects_current || 0} S: ${stats?.interim_rejects_spillover || 0}`}
              icon={AlertTriangle}
              color="text-amber-600"
            />
            <StatCard 
              label="Final Rejections" 
              value={stats?.final_rejections || 0}
              subLabel={`C: ${stats?.final_rejections_current || 0} S: ${stats?.final_rejections_spillover || 0}`}
              icon={XCircle}
              color="text-red-600"
            />
            <StatCard 
              label="Amt in Pipeline" 
              value={stats?.amt_in_pipeline || 0}
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

        {/* Bank Performance Table */}
        {showBankTable && bankPerformance && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="bank-performance-table">
            <div className="px-4 py-3 border-b border-gray-200 bg-green-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 size={18} className="text-green-600" />
                  <h3 className="font-semibold text-gray-900">Bank Performance</h3>
                  <span className="text-sm text-gray-500">({bankPerformance.total_banks} banks)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportBankPerformance}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowBankTable(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Bank Name</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Logins</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Approvals</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Approved Amt</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Disbursals</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Disbursed Amt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bankPerformance.banks?.map((bank, idx) => (
                    <tr key={bank.bank_name || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{bank.bank_name}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{bank.logins}</td>
                      <td className="px-4 py-3 text-right text-green-600">{bank.approvals}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(bank.approved_amount, true)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{bank.disbursals}</td>
                      <td className="px-4 py-3 text-right text-emerald-600 font-medium">{formatCurrency(bank.disbursed_amount, true)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-medium">
                  <tr>
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{bankPerformance.banks?.reduce((a, b) => a + b.logins, 0)}</td>
                    <td className="px-4 py-3 text-right">{bankPerformance.banks?.reduce((a, b) => a + b.approvals, 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(bankPerformance.banks?.reduce((a, b) => a + b.approved_amount, 0), true)}</td>
                    <td className="px-4 py-3 text-right">{bankPerformance.banks?.reduce((a, b) => a + b.disbursals, 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(bankPerformance.banks?.reduce((a, b) => a + b.disbursed_amount, 0), true)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* TAT Metrics */}
        {showTatMetrics && tatMetrics && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="tat-metrics-panel">
            <div className="px-4 py-3 border-b border-gray-200 bg-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Timer size={18} className="text-purple-600" />
                  <h3 className="font-semibold text-gray-900">Turnaround Time (TAT) Metrics</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportTatMetrics}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowTatMetrics(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Lead to Login */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">Lead to Login</h4>
                <div className="text-3xl font-bold text-blue-600">
                  {tatMetrics.lead_to_login?.average ? `${tatMetrics.lead_to_login.average} days` : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Mode: {tatMetrics.lead_to_login?.mode_bucket || 'N/A'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {tatMetrics.lead_to_login?.count || 0} samples
                </p>
                {tatMetrics.lead_to_login?.distribution && Object.keys(tatMetrics.lead_to_login.distribution).length > 0 && (
                  <div className="mt-3 space-y-1">
                    {Object.entries(tatMetrics.lead_to_login.distribution).slice(0, 4).map(([bucket, count]) => (
                      <div key={bucket} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-gray-600">{bucket}</span>
                        <div className="flex-1 bg-gray-100 rounded h-2">
                          <div className="bg-blue-500 h-2 rounded" style={{width: `${(count / tatMetrics.lead_to_login.count) * 100}%`}}></div>
                        </div>
                        <span className="w-8 text-right text-gray-500">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Login to Approval */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">Login to Approval</h4>
                <div className="text-3xl font-bold text-green-600">
                  {tatMetrics.login_to_approval?.average ? `${tatMetrics.login_to_approval.average} days` : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Mode: {tatMetrics.login_to_approval?.mode_bucket || 'N/A'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {tatMetrics.login_to_approval?.count || 0} samples
                </p>
              </div>
              
              {/* Approval to Disbursal */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">Approval to Disbursal</h4>
                <div className="text-3xl font-bold text-emerald-600">
                  {tatMetrics.approval_to_disbursal?.average ? `${tatMetrics.approval_to_disbursal.average} days` : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Mode: {tatMetrics.approval_to_disbursal?.mode_bucket || 'N/A'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {tatMetrics.approval_to_disbursal?.count || 0} samples
                </p>
              </div>
              
              {/* Lead to Disbursal */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">Lead to Disbursal</h4>
                <div className="text-3xl font-bold text-purple-600">
                  {tatMetrics.lead_to_disbursal?.average ? `${tatMetrics.lead_to_disbursal.average} days` : 'N/A'}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Mode: {tatMetrics.lead_to_disbursal?.mode_bucket || 'N/A'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {tatMetrics.lead_to_disbursal?.count || 0} samples
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Growth Partner Report */}
        {showGrowthPartner && growthPartner && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="growth-partner-table">
            <div className="px-4 py-3 border-b border-gray-200 bg-blue-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-blue-600" />
                  <h3 className="font-semibold text-gray-900">Growth Partner Performance</h3>
                  <span className="text-sm text-gray-500">({growthPartner.total_agents} partners)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportGrowthPartner}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowGrowthPartner(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Partner</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Files Generated</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Logins</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Approvals</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Approved Amt</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Disbursals</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-700">Disbursed Amt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {growthPartner.agents?.map((agent, idx) => (
                    <tr key={agent.agent_id || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{agent.agent_name}</td>
                      <td className="px-4 py-3 text-right">{agent.files_generated}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{agent.logins}</td>
                      <td className="px-4 py-3 text-right text-green-600">{agent.approvals}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(agent.approved_amount, true)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{agent.disbursals}</td>
                      <td className="px-4 py-3 text-right text-emerald-600 font-medium">{formatCurrency(agent.disbursed_amount, true)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-medium">
                  <tr>
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{growthPartner.totals?.files_generated}</td>
                    <td className="px-4 py-3 text-right">{growthPartner.totals?.logins}</td>
                    <td className="px-4 py-3 text-right">{growthPartner.totals?.approvals}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(growthPartner.totals?.approved_amount, true)}</td>
                    <td className="px-4 py-3 text-right">{growthPartner.totals?.disbursals}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(growthPartner.totals?.disbursed_amount, true)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

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
                    className="px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                    data-testid={`file-row-${file.id}`}
                    onClick={() => navigate(`/admin/files/${file.id}`)}
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
        </>
        )}
        
        {/* Approvals Tab Content */}
        {activeTab === 'approvals' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-green-50">
              <h3 className="font-semibold text-gray-900">Files Pending Approval</h3>
              <p className="text-sm text-gray-500">Files with approved status awaiting disbursal</p>
            </div>
            {approvalFiles.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <CheckCircle size={48} className="mx-auto mb-4 text-gray-300" />
                <p>No files pending approval</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {approvalFiles.map((file) => (
                  <div
                    key={file.id}
                    className="px-4 py-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/admin/files/${file.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{file.name || 'Unnamed'}</h4>
                        <p className="text-sm text-gray-500">{file.phone}</p>
                        <p className="text-xs text-gray-400">{file.requirement || '-'}</p>
                      </div>
                      <div className="text-right">
                        <span className="px-3 py-1 rounded bg-green-50 text-green-700 text-sm font-medium">
                          Approved
                        </span>
                        <p className="text-sm text-green-600 mt-1">
                          {file.eligibilities?.find(e => e.approval_status === 'approved')?.approved_amount 
                            ? formatCurrency(file.eligibilities.find(e => e.approval_status === 'approved').approved_amount, true)
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Users Tab Content */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-blue-50 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">All Users ({allUsers.length})</h3>
                <p className="text-sm text-gray-500">CRM users including mapped and unmapped users</p>
              </div>
              <button 
                onClick={() => navigate('/admin/users/new')}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
              >
                + Add User
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Phone</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{user.full_name || user.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{user.email || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          user.role === 'caller' || user.role === 'telecaller' ? 'bg-blue-100 text-blue-700' :
                          user.role === 'agent' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {user.role || 'user'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{user.phone || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {user.status || 'active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilesDashboard;
