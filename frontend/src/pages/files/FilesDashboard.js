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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

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

// Loan Type Options for multi-select
const LOAN_TYPE_OPTIONS = [
  { value: 'new_personal_loan', label: 'New Personal Loan' },
  { value: 'balance_transfer_topup_pl', label: 'Balance Transfer+Top Up PL' },
  { value: 'used_vehicle_loan_bt', label: 'Used Vehicle Loan BT' },
  { value: 'used_vehicle_loan_fresh', label: 'Used Vehicle Loan Fresh' },
  { value: 'new_vehicle_loan', label: 'New Vehicle Loan' },
  { value: 'merge_multiple_loans', label: 'Merge Multiple Loans' },
  { value: 'balance_transfer_pl', label: 'Balance Transfer PL' },
  { value: 'top_up_pl', label: 'Top Up PL' },
  { value: 'bt_topup_hl', label: 'BT Topup HL' },
  { value: 'reduce_home_loan_emi', label: 'Reduce Home Loan EMI' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'new_home_loan', label: 'New Home Loan' },
];

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
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  
  // Reports State
  const [bankPerformance, setBankPerformance] = useState(null);
  const [tatMetrics, setTatMetrics] = useState(null);
  const [growthPartner, setGrowthPartner] = useState(null);
  const [showBankTable, setShowBankTable] = useState(false);
  const [showTatMetrics, setShowTatMetrics] = useState(false);
  const [showGrowthPartner, setShowGrowthPartner] = useState(false);
  
  // Additional Reports State
  const [showDailyReport, setShowDailyReport] = useState(false);
  const [showRejectedReport, setShowRejectedReport] = useState(false);
  const [showQualityReport, setShowQualityReport] = useState(false);
  const [dailyReportData, setDailyReportData] = useState(null);
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const [rejectedBankSummary, setRejectedBankSummary] = useState([]);
  const [rejectedTotals, setRejectedTotals] = useState({});
  const [qualityData, setQualityData] = useState(null);
  const [showCommissionReport, setShowCommissionReport] = useState(false);
  const [commissionData, setCommissionData] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState([]); // Changed to array for multi-select
  const [managerFilter, setManagerFilter] = useState('');
  const [gpFilter, setGpFilter] = useState(''); // New: Growth Partner filter
  const [tlFilter, setTlFilter] = useState(''); // New: Team Lead filter
  const [starFilter, setStarFilter] = useState('');
  const [createdDateFilter, setCreatedDateFilter] = useState('all');
  const [activityDateFilter, setActivityDateFilter] = useState('all');
  const [showLoanTypeDropdown, setShowLoanTypeDropdown] = useState(false);
  
  // Filter data
  const [opsTeam, setOpsTeam] = useState([]);
  const [managers, setManagers] = useState([]); // Only actual managers
  const [growthPartners, setGrowthPartners] = useState([]); // GPs for filter
  const [teamLeads, setTeamLeads] = useState([]); // TLs for filter
  const [allUsers, setAllUsers] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [pendingUsers, setPendingUsers] = useState([]);
  
  // Connect ID Mapping Modal State
  const [showMapModal, setShowMapModal] = useState(false);
  const [mappingUser, setMappingUser] = useState(null);
  const [connectIdInput, setConnectIdInput] = useState('');
  const [isMapping, setIsMapping] = useState(false);
  
  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  
  // Delete file handler
  const handleDeleteFile = async () => {
    if (!fileToDelete) return;
    
    setIsDeleting(true);
    try {
      await api.delete(`/files/${fileToDelete.id}`);
      toast.success(`File "${fileToDelete.name}" deleted successfully`);
      setDeleteConfirmOpen(false);
      setFileToDelete(null);
      // Refresh the files list
      fetchFiles();
      fetchStats();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error(error.response?.data?.detail || 'Failed to delete file');
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsDeleting(true);
    try {
      const response = await api.post('/files/bulk-delete', {
        file_ids: selectedFiles
      });
      toast.success(`${response.data.deleted_count} files deleted successfully`);
      setBulkDeleteConfirmOpen(false);
      setSelectedFiles([]);
      // Refresh the files list
      fetchFiles();
      fetchStats();
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error(error.response?.data?.detail || 'Failed to delete files');
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Open delete confirmation
  const openDeleteConfirm = (file) => {
    setFileToDelete(file);
    setDeleteConfirmOpen(true);
  };
  
  // Calculate date range based on filter
  const getDateRange = (filterValue = 'all') => {
    const now = new Date();
    let startDate = null;
    let endDate = null;
    
    switch(filterValue) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        endDate = now.toISOString();
        break;
      case 'yesterday':
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();
        endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59).toISOString();
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        startDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).toISOString();
        endDate = now.toISOString();
        break;
      case 'last_week':
        const lastWeekEnd = new Date(now);
        lastWeekEnd.setDate(now.getDate() - now.getDay() - 1);
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
        startDate = new Date(lastWeekStart.getFullYear(), lastWeekStart.getMonth(), lastWeekStart.getDate()).toISOString();
        endDate = new Date(lastWeekEnd.getFullYear(), lastWeekEnd.getMonth(), lastWeekEnd.getDate(), 23, 59, 59).toISOString();
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        endDate = now.toISOString();
        break;
      case 'last_month':
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
        startDate = lastMonth.toISOString();
        endDate = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59).toISOString();
        break;
      case 'quarter':
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        startDate = quarterStart.toISOString();
        endDate = now.toISOString();
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1).toISOString();
        endDate = now.toISOString();
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
  }, [page, statusFilter, managerFilter, gpFilter, tlFilter, createdDateFilter, activityDateFilter, customStartDate, customEndDate, loanTypeFilter]);

  // Debounced search effect
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm !== undefined) {
        fetchFiles();
        fetchStats();
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

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
        fetchPendingUsers(),
        fetchManagers(),
        fetchGrowthPartners(),
        fetchTeamLeads()
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
      if (managerFilter) params.append('manager_id', managerFilter);
      if (gpFilter) params.append('gp_id', gpFilter);
      if (tlFilter) params.append('tl_id', tlFilter);
      if (searchTerm) params.append('search', searchTerm);
      
      // Loan type filter (can be multiple)
      if (loanTypeFilter.length > 0) {
        params.append('loan_types', loanTypeFilter.join(','));
      }
      
      // Add date range filters based on created date
      const { startDate, endDate } = getDateRange(createdDateFilter);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      
      // Activity date filter
      const activityDates = getDateRange(activityDateFilter);
      if (activityDates.startDate) params.append('activity_start_date', activityDates.startDate);
      if (activityDates.endDate) params.append('activity_end_date', activityDates.endDate);

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
      const params = new URLSearchParams();
      
      // Created date filter for: Total Files, New, In Progress, Amt in Pipeline
      const { startDate, endDate } = getDateRange(createdDateFilter);
      if (startDate) params.append('created_start_date', startDate);
      if (endDate) params.append('created_end_date', endDate);
      
      // Activity date filter for: Login, Approved, Disbursed, Rejections, etc.
      const activityDates = getDateRange(activityDateFilter);
      if (activityDates.startDate) params.append('activity_start_date', activityDates.startDate);
      if (activityDates.endDate) params.append('activity_end_date', activityDates.endDate);
      
      if (searchTerm) params.append('search', searchTerm);
      if (managerFilter) params.append('manager_id', managerFilter);
      if (gpFilter) params.append('gp_id', gpFilter);
      if (tlFilter) params.append('tl_id', tlFilter);
      
      // Loan type filter
      if (loanTypeFilter.length > 0) {
        params.append('loan_types', loanTypeFilter.join(','));
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

  // Fetch Daily Report - Summary of today's/selected date's activities
  const fetchDailyReport = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      // Daily report uses the dashboard stats + file activities for the day
      const [statsRes, filesRes] = await Promise.all([
        api.get(`/files/dashboard/stats?${params.toString()}`),
        api.get(`/files?limit=1000`)
      ]);
      
      const stats = statsRes.data;
      const allFiles = filesRes.data?.files || [];
      
      // Calculate daily metrics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const dailyFiles = allFiles.filter(f => {
        const updated = f.updated_at ? new Date(f.updated_at) : null;
        return updated && updated >= today;
      });
      
      setDailyReportData({
        total_files: stats.total_files || 0,
        new_files_today: dailyFiles.filter(f => f.file_status === 'new').length,
        logins_today: dailyFiles.filter(f => f.file_status === 'login').length,
        approvals_today: dailyFiles.filter(f => f.file_status === 'approved').length,
        disbursals_today: dailyFiles.filter(f => f.file_status === 'disbursed').length,
        rejections_today: dailyFiles.filter(f => ['rejected', 'declined', 'not_eligible'].includes(f.file_status)).length,
        by_status: stats.by_status || {},
        total_approved_amount: stats.total_approved_amount || 0,
        total_disbursed_amount: stats.total_disbursed_amount || 0,
        files_updated_today: dailyFiles.length
      });
    } catch (error) {
      console.error('Failed to fetch daily report:', error);
    }
  };

  // Fetch Rejected Files
  const fetchRejectedFiles = async () => {
    try {
      // Use the enhanced rejected report endpoint with bank-level data
      const response = await api.get('/files/reports/rejected');
      setRejectedFiles(response.data?.files || []);
      // Store bank summary for display
      setRejectedBankSummary(response.data?.bank_summary || []);
      setRejectedTotals(response.data?.totals || {});
    } catch (error) {
      console.error('Failed to fetch rejected files:', error);
      // Fallback to basic files query
      try {
        const rejectedStatuses = 'rejected,declined,not_eligible,fi_negative,customer_not_interested,customer_not_supporting,not_disbursed,not_login';
        const fallbackResponse = await api.get(`/files?file_status=${rejectedStatuses}&limit=500`);
        setRejectedFiles(fallbackResponse.data?.files || []);
      } catch (e) {
        console.error('Fallback also failed:', e);
      }
    }
  };

  // Fetch Quality Report - File quality metrics
  const fetchQualityReport = async () => {
    try {
      const filesRes = await api.get('/files?limit=1000');
      const allFiles = filesRes.data?.files || [];
      
      // Calculate quality metrics
      const withDocuments = allFiles.filter(f => (f.documents?.length || 0) > 0).length;
      const withEligibilities = allFiles.filter(f => (f.eligibilities?.length || 0) > 0).length;
      const withActivities = allFiles.filter(f => (f.activities?.length || 0) > 0).length;
      const completeProfiles = allFiles.filter(f => f.name && f.phone && f.requirement).length;
      
      // Star ratings distribution
      const starCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      allFiles.forEach(f => {
        const stars = f.stars || 0;
        starCounts[stars] = (starCounts[stars] || 0) + 1;
      });
      
      // Conversion funnel
      const total = allFiles.length;
      const logins = allFiles.filter(f => ['login', 'approved', 'declined', 'disbursed', 'not_disbursed'].includes(f.file_status)).length;
      const approvals = allFiles.filter(f => ['approved', 'disbursed', 'not_disbursed'].includes(f.file_status)).length;
      const disbursals = allFiles.filter(f => f.file_status === 'disbursed').length;
      
      setQualityData({
        total_files: total,
        with_documents: withDocuments,
        with_eligibilities: withEligibilities,
        with_activities: withActivities,
        complete_profiles: completeProfiles,
        star_distribution: starCounts,
        conversion_funnel: {
          total,
          logins,
          approvals,
          disbursals,
          login_rate: total > 0 ? ((logins / total) * 100).toFixed(1) : 0,
          approval_rate: logins > 0 ? ((approvals / logins) * 100).toFixed(1) : 0,
          disbursal_rate: approvals > 0 ? ((disbursals / approvals) * 100).toFixed(1) : 0
        },
        data_quality_score: total > 0 ? (((completeProfiles + withDocuments) / (total * 2)) * 100).toFixed(1) : 0
      });
    } catch (error) {
      console.error('Failed to fetch quality report:', error);
    }
  };

  // Fetch Commission Report
  const fetchCommissionReport = async () => {
    try {
      const response = await api.get('/files/commissions');
      setCommissionData(response.data);
    } catch (error) {
      console.error('Failed to fetch commission report:', error);
      toast.error('Failed to load commission report');
    }
  };

  // Export handlers
  const handleExportDashboard = async () => {
    try {
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/files/export/dashboard`, '_blank');
      toast.success('Dashboard export started');
    } catch (error) {
      toast.error('Export failed');
    }
  };

  const handleExportRejected = async () => {
    try {
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/files/export/rejected`, '_blank');
      toast.success('Rejected cases export started');
    } catch (error) {
      toast.error('Export failed');
    }
  };

  const handleExportGrowthPartner = async () => {
    try {
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/files/export/growth-partner`, '_blank');
      toast.success('Growth Partner export started');
    } catch (error) {
      toast.error('Export failed');
    }
  };

  const handleExportCommissions = async () => {
    try {
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/files/export/commissions`, '_blank');
      toast.success('Commission export started');
    } catch (error) {
      toast.error('Export failed');
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
  
  const fetchPendingUsers = async () => {
    try {
      const response = await api.get('/users/pending-approval');
      setPendingUsers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch pending users:', error);
    }
  };

  const handleApproveUser = async (userId) => {
    try {
      await api.post(`/users/${userId}/approve`);
      toast.success('User approved successfully');
      fetchPendingUsers();
      fetchAllUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve user');
    }
  };

  const handleRejectUser = async (userId) => {
    if (!window.confirm('Are you sure you want to reject this user?')) return;
    try {
      await api.post(`/users/${userId}/reject`);
      toast.success('User rejected');
      fetchPendingUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject user');
    }
  };

  const openMapModal = (userToMap) => {
    setMappingUser(userToMap);
    setConnectIdInput('');
    setShowMapModal(true);
  };

  const handleMapConnectId = async () => {
    if (!connectIdInput.trim()) {
      toast.error('Please enter a Connect ID');
      return;
    }
    
    setIsMapping(true);
    try {
      await api.put(`/users/${mappingUser.id}/map-connect?connect_id=${connectIdInput.trim()}`);
      toast.success(`${mappingUser.name} mapped to Connect ID successfully`);
      setShowMapModal(false);
      setMappingUser(null);
      setConnectIdInput('');
      fetchAllUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to map Connect ID');
    } finally {
      setIsMapping(false);
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

  // Fetch managers only (role=manager)
  const fetchManagers = async () => {
    try {
      const response = await api.get('/users/managers');
      setManagers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch managers:', error);
    }
  };

  // Fetch Growth Partners
  const fetchGrowthPartners = async () => {
    try {
      const response = await api.get('/users/growth-partners');
      setGrowthPartners(response.data || []);
    } catch (error) {
      console.error('Failed to fetch growth partners:', error);
    }
  };

  // Fetch Team Leads
  const fetchTeamLeads = async () => {
    try {
      const response = await api.get('/users/team-leads');
      setTeamLeads(response.data || []);
    } catch (error) {
      console.error('Failed to fetch team leads:', error);
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
              {/* GP sees "My Files", Admin sees "Admin Dashboard" */}
              <h1 className="text-xl font-bold text-gray-900">{isAdmin ? 'Admin' : 'My Files'}</h1>
              <h2 className="text-2xl font-bold text-gray-900">{isAdmin ? 'Dashboard' : 'Dashboard'}</h2>
            </div>
            <span className="text-sm text-gray-500 hidden md:inline">Welcome, {user.full_name || user.name || 'User'}</span>
            {!isAdmin && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Growth Partner</span>
            )}
          </div>
          
          {/* Report Buttons - Navigate to separate report pages */}
          <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2 lg:pb-0">
            {isAdmin && (
              <>
                <button 
                  onClick={() => navigate('/admin/files/reports/sales-ops')}
                  className="px-2 md:px-3 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap"
                  data-testid="report-sales-ops"
                >
                  <BarChart3 size={14} />
                  <span className="hidden sm:inline">Sales & Ops</span>
                  <span className="sm:hidden">S&O</span>
                </button>
                <button 
                  onClick={() => navigate('/admin/files/reports/rejected')}
                  className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-1 whitespace-nowrap"
                  data-testid="report-rejected"
                >
                  <XCircle size={14} />
                  <span className="hidden sm:inline">Rejected Cases</span>
                  <span className="sm:hidden">Rejected</span>
                </button>
                <button 
                  onClick={() => navigate('/admin/files/reports/growth-partner')}
                  className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center gap-1 whitespace-nowrap"
                  data-testid="report-gp"
                >
                  <Users size={14} />
                  <span className="hidden sm:inline">GP Performance</span>
                  <span className="sm:hidden">GP</span>
                </button>
                <button 
                  onClick={() => navigate('/admin/files/reports/quality')}
                  className="px-2 md:px-3 py-1.5 text-xs md:text-sm bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1 whitespace-nowrap"
                  data-testid="report-quality"
                >
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
                <button 
                  onClick={() => setShowCommissionReport(!showCommissionReport)}
                  className={`px-2 md:px-3 py-1.5 text-xs md:text-sm border rounded-lg flex items-center gap-1 whitespace-nowrap ${showCommissionReport ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'}`}
                >
                  <DollarSign size={14} />
                  <span className="hidden sm:inline">Commission</span>
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="px-2 md:px-3 py-1.5 text-xs md:text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Download size={14} />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown size={12} />
                  </button>
                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                      <button onClick={() => { handleExportCSV(); setShowExportMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                        <FileText size={14} /> All Files (CSV)
                      </button>
                      <button onClick={() => { handleExportDashboard(); setShowExportMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                        <BarChart3 size={14} /> Dashboard Export
                      </button>
                      <button onClick={() => { handleExportRejected(); setShowExportMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                        <XCircle size={14} /> Rejected Cases
                      </button>
                      <button onClick={() => { handleExportGrowthPartner(); setShowExportMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                        <Users size={14} /> Growth Partner
                      </button>
                      <button onClick={() => { handleExportCommissions(); setShowExportMenu(false); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                        <DollarSign size={14} /> Commissions
                      </button>
                    </div>
                  )}
                </div>
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

      {/* Tabs - Approvals only visible for Admin */}
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex gap-1">
          {['Dashboard', ...(isAdmin ? ['Approvals', 'Users'] : [])].map(tab => (
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
              {/* Row 1: Search + Date Filters */}
              <div className="flex flex-wrap items-center gap-3 mb-3">
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
                
                {/* Lead Created Date Filter - For Total, New, In Progress, Pipeline */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Lead Created:</span>
                  <select
                    value={createdDateFilter}
                    onChange={(e) => setCreatedDateFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white font-medium"
                    data-testid="created-date-filter"
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="week">This Week</option>
                    <option value="last_week">Last Week</option>
                    <option value="month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
                
                {/* Activity Date Filter - For Login, Approved, Disbursed, etc. */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Activity Date:</span>
                  <select
                    value={activityDateFilter}
                    onChange={(e) => setActivityDateFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white font-medium"
                    data-testid="activity-date-filter"
                  >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="week">This Week</option>
                    <option value="last_week">Last Week</option>
                    <option value="month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                  </select>
                </div>
              </div>
              
              {/* Custom date range if selected */}
              {(createdDateFilter === 'custom' || activityDateFilter === 'custom') && (
                <div className="flex items-center gap-2 mb-3 pl-0">
                  <span className="text-xs text-gray-500">Custom Range:</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    data-testid="custom-start-date"
                  />
                  <span className="text-gray-400">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                    data-testid="custom-end-date"
                  />
                </div>
              )}
              
              {/* Row 2: Other Filters */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Loan Type - Multi-select with dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowLoanTypeDropdown(!showLoanTypeDropdown)}
                    className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white flex items-center gap-2 min-w-[160px]"
                    data-testid="loan-type-dropdown"
                  >
                    <span className={loanTypeFilter.length > 0 ? 'text-green-600 font-medium' : 'text-gray-600'}>
                      {loanTypeFilter.length === 0 
                        ? 'All Loan Types' 
                        : `${loanTypeFilter.length} Selected`}
                    </span>
                    <ChevronDown size={16} className="text-gray-400 ml-auto" />
                  </button>
                  
                  {showLoanTypeDropdown && (
                    <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                      <div className="p-2 border-b border-gray-100 flex gap-2">
                        <button
                          onClick={() => setLoanTypeFilter(LOAN_TYPE_OPTIONS.map(o => o.value))}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => setLoanTypeFilter([])}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          Clear All
                        </button>
                      </div>
                      <div className="p-2">
                        {LOAN_TYPE_OPTIONS.map(opt => (
                          <label key={opt.value} className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={loanTypeFilter.includes(opt.value)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setLoanTypeFilter([...loanTypeFilter, opt.value]);
                                } else {
                                  setLoanTypeFilter(loanTypeFilter.filter(v => v !== opt.value));
                                }
                              }}
                              className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-700">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
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
                
                {/* Managers - Only actual managers */}
                <select
                  value={managerFilter}
                  onChange={(e) => { setManagerFilter(e.target.value); setPage(1); }}
                  className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                  data-testid="manager-filter"
                >
                  <option value="">All Managers</option>
                  {managers.map(mgr => (
                    <option key={mgr.id} value={mgr.id}>{mgr.full_name || mgr.name}</option>
                  ))}
                </select>
                
                {/* Team Leads */}
                <select
                  value={tlFilter}
                  onChange={(e) => { setTlFilter(e.target.value); setPage(1); }}
                  className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                  data-testid="tl-filter"
                >
                  <option value="">All Team Leads</option>
                  {teamLeads.map(tl => (
                    <option key={tl.id} value={tl.id}>{tl.full_name || tl.name}</option>
                  ))}
                </select>
                
                {/* Growth Partners */}
                <select
                  value={gpFilter}
                  onChange={(e) => { setGpFilter(e.target.value); setPage(1); }}
                  className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                  data-testid="gp-filter"
                >
                  <option value="">All Growth Partners</option>
                  {growthPartners.map(gp => (
                    <option key={gp.id} value={gp.id}>{gp.full_name || gp.name}</option>
                  ))}
                </select>
                
                {/* Stars */}
                <select
                  value={starFilter}
                  onChange={(e) => setStarFilter(e.target.value)}
                  className="h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
                  data-testid="star-filter"
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

          {/* Monthly Performance (Line Chart) - Real Data */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Monthly Performance</h3>
            {reports?.monthly_stats ? (
              <div className="h-48 flex items-end justify-around gap-2">
                {reports.monthly_stats.map((month, idx) => (
                  <div key={`month-${idx}`} className="flex-1 flex flex-col items-center">
                    <div 
                      className="w-full bg-green-500 rounded-t"
                      style={{ height: `${Math.min(month.percentage || 0, 100)}%` }}
                      title={`Files: ${month.count || 0}`}
                    ></div>
                    <span className="text-xs text-gray-500 mt-1">{month.month || idx + 1}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-400 py-8">No monthly data available</p>
            )}
          </div>

          {/* Loans by Type (Bar Chart) - Real Data */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Loans by Type</h3>
            {reports?.loan_type_stats && reports.loan_type_stats.length > 0 ? (
              <div className="space-y-3">
                {reports.loan_type_stats.map((item) => (
                  <div key={item.type || item._id} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">{item.type || item._id || 'Unknown'}</span>
                        <span className="text-gray-500">{item.count}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${Math.min((item.count / (reports.loan_type_stats[0]?.count || 1)) * 100, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-400 py-8">No loan type data available</p>
            )}
          </div>
        </div>

        {/* Daily Report Panel */}
        {showDailyReport && dailyReportData && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="daily-report-panel">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="text-gray-700" />
                  <h3 className="font-semibold text-gray-900">Daily Report</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const headers = ['Metric', 'Count'];
                      const rows = [
                        ['Total Files', dailyReportData.total_files],
                        ['Files Updated Today', dailyReportData.files_updated_today],
                        ['New Files Today', dailyReportData.new_files_today],
                        ['Logins Today', dailyReportData.logins_today],
                        ['Approvals Today', dailyReportData.approvals_today],
                        ['Disbursals Today', dailyReportData.disbursals_today],
                        ['Rejections Today', dailyReportData.rejections_today]
                      ];
                      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `daily_report_${new Date().toISOString().split('T')[0]}.csv`;
                      a.click();
                      toast.success('Daily Report exported');
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowDailyReport(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{dailyReportData.total_files}</p>
                  <p className="text-sm text-gray-600">Total Files</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{dailyReportData.files_updated_today}</p>
                  <p className="text-sm text-gray-600">Updated Today</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-purple-600">{dailyReportData.logins_today}</p>
                  <p className="text-sm text-gray-600">Logins Today</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{dailyReportData.disbursals_today}</p>
                  <p className="text-sm text-gray-600">Disbursals Today</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-100 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-700">{dailyReportData.new_files_today}</p>
                  <p className="text-xs text-gray-600">New Files</p>
                </div>
                <div className="bg-blue-100 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-blue-700">{dailyReportData.approvals_today}</p>
                  <p className="text-xs text-gray-600">Approvals</p>
                </div>
                <div className="bg-red-100 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-700">{dailyReportData.rejections_today}</p>
                  <p className="text-xs text-gray-600">Rejections</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rejected Files Report */}
        {showRejectedReport && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="rejected-report-panel">
            <div className="px-4 py-3 border-b border-gray-200 bg-red-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <XCircle size={18} className="text-red-600" />
                  <h3 className="font-semibold text-gray-900">Rejected Cases Report ({rejectedFiles.length})</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const headers = ['Name', 'Phone', 'Status', 'Bank', 'Reason', 'Updated'];
                      const rows = rejectedFiles.map(f => [
                        f.name || '',
                        f.phone || '',
                        f.file_status || '',
                        f.bank_name || '',
                        f.rejection_reason || f.remarks || '',
                        f.updated_at ? new Date(f.updated_at).toLocaleDateString() : ''
                      ]);
                      const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `rejected_files_${new Date().toISOString().split('T')[0]}.csv`;
                      a.click();
                      toast.success('Rejected Files exported');
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowRejectedReport(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Bank-Level Summary - OLD CRM Feature */}
            {rejectedBankSummary && rejectedBankSummary.length > 0 && (
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <Building2 size={16} className="text-gray-500" />
                  Bank-Level Rejection Summary
                </h4>
                
                {/* Summary Stats */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
                  <div className="bg-white rounded-lg p-2 text-center border border-gray-200">
                    <p className="text-lg font-bold text-gray-700">{rejectedTotals.total_cases || 0}</p>
                    <p className="text-xs text-gray-500">Total Cases</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-red-200">
                    <p className="text-lg font-bold text-red-600">{rejectedTotals.not_eligible || 0}</p>
                    <p className="text-xs text-gray-500">Not Eligible</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-orange-200">
                    <p className="text-lg font-bold text-orange-600">{rejectedTotals.not_login || 0}</p>
                    <p className="text-xs text-gray-500">Not Login</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-yellow-200">
                    <p className="text-lg font-bold text-yellow-600">{rejectedTotals.fi_negative || 0}</p>
                    <p className="text-xs text-gray-500">FI Negative</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
                    <p className="text-lg font-bold text-purple-600">{rejectedTotals.declined || 0}</p>
                    <p className="text-xs text-gray-500">Declined</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-pink-200">
                    <p className="text-lg font-bold text-pink-600">{rejectedTotals.not_disbursed || 0}</p>
                    <p className="text-xs text-gray-500">Not Disbursed</p>
                  </div>
                </div>
                
                {/* Bank Table */}
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">Bank</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Cases</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Eligible</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Not Elig</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Login</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Approved</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Declined</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Disbursed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rejectedBankSummary.slice(0, 10).map((bank, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 font-medium text-gray-900">{bank.bank_name}</td>
                          <td className="px-2 py-1.5 text-right">{bank.total_cases}</td>
                          <td className="px-2 py-1.5 text-right text-green-600">{bank.eligible}</td>
                          <td className="px-2 py-1.5 text-right text-red-600">{bank.not_eligible}</td>
                          <td className="px-2 py-1.5 text-right text-blue-600">{bank.login}</td>
                          <td className="px-2 py-1.5 text-right text-green-600">{bank.approved}</td>
                          <td className="px-2 py-1.5 text-right text-red-600">{bank.declined}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-600">{bank.disbursed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Files Table */}
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Name</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Phone</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Bank</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Reason</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rejectedFiles.length === 0 ? (
                    <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">No rejected files found</td></tr>
                  ) : rejectedFiles.slice(0, 100).map((file) => (
                    <tr key={file.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(isAdmin ? `/admin/files/${file.id}` : `/agent/files/${file.id}`)}>
                      <td className="px-4 py-2 font-medium text-gray-900">{file.name || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{file.phone || '-'}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                          {file.file_status?.replace('_', ' ') || 'rejected'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{file.bank_name || '-'}</td>
                      <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{file.rejection_reason || file.remarks || '-'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {file.updated_at ? new Date(file.updated_at).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quality Report */}
        {showQualityReport && qualityData && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="quality-report-panel">
            <div className="px-4 py-3 border-b border-gray-200 bg-amber-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star size={18} className="text-amber-600" />
                  <h3 className="font-semibold text-gray-900">Quality Report</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const headers = ['Metric', 'Value'];
                      const rows = [
                        ['Total Files', qualityData.total_files],
                        ['Complete Profiles', qualityData.complete_profiles],
                        ['With Documents', qualityData.with_documents],
                        ['With Eligibilities', qualityData.with_eligibilities],
                        ['Data Quality Score', qualityData.data_quality_score + '%'],
                        ['Login Rate', qualityData.conversion_funnel.login_rate + '%'],
                        ['Approval Rate', qualityData.conversion_funnel.approval_rate + '%'],
                        ['Disbursal Rate', qualityData.conversion_funnel.disbursal_rate + '%']
                      ];
                      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `quality_report_${new Date().toISOString().split('T')[0]}.csv`;
                      a.click();
                      toast.success('Quality Report exported');
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowQualityReport(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{qualityData.data_quality_score}%</p>
                  <p className="text-sm text-gray-600">Quality Score</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{qualityData.complete_profiles}</p>
                  <p className="text-sm text-gray-600">Complete Profiles</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{qualityData.with_documents}</p>
                  <p className="text-sm text-gray-600">With Documents</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-purple-600">{qualityData.with_eligibilities}</p>
                  <p className="text-sm text-gray-600">With Eligibilities</p>
                </div>
              </div>
              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-700 mb-3">Conversion Funnel</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total → Login</span>
                    <span className="font-medium text-green-600">{qualityData.conversion_funnel.login_rate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{width: `${qualityData.conversion_funnel.login_rate}%`}}></div>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-gray-600">Login → Approval</span>
                    <span className="font-medium text-blue-600">{qualityData.conversion_funnel.approval_rate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{width: `${qualityData.conversion_funnel.approval_rate}%`}}></div>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm text-gray-600">Approval → Disbursal</span>
                    <span className="font-medium text-purple-600">{qualityData.conversion_funnel.disbursal_rate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full" style={{width: `${qualityData.conversion_funnel.disbursal_rate}%`}}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Commission Report Panel */}
        {showCommissionReport && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="commission-report-panel">
            <div className="px-4 py-3 border-b border-gray-200 bg-emerald-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={18} className="text-emerald-600" />
                  <h3 className="font-semibold text-gray-900">Commission Report</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportCommissions}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 bg-white"
                  >
                    <Download size={14} />
                    Export
                  </button>
                  <button onClick={() => setShowCommissionReport(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
            </div>
            
            {!commissionData ? (
              <div className="p-8 flex items-center justify-center">
                <button 
                  onClick={fetchCommissionReport}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  Load Commission Data
                </button>
              </div>
            ) : (
              <div className="p-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-600">₹{(commissionData.total_amount / 100000).toFixed(1)}L</p>
                    <p className="text-sm text-gray-600">Total Commission</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{commissionData.total}</p>
                    <p className="text-sm text-gray-600">Records</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-purple-600">{commissionData.by_growth_partner?.length || 0}</p>
                    <p className="text-sm text-gray-600">Growth Partners</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{commissionData.by_bank?.length || 0}</p>
                    <p className="text-sm text-gray-600">Banks</p>
                  </div>
                </div>

                {/* By Growth Partner Table */}
                <div className="mb-6">
                  <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Users size={16} /> Commission by Growth Partner
                  </h4>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Growth Partner</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-700">Amount</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-700">Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(commissionData.by_growth_partner || []).slice(0, 10).map((gp, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-900">{gp.source_name}</td>
                            <td className="px-4 py-2 text-right text-emerald-600 font-medium">₹{gp.total_amount.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{gp.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* By Bank Table */}
                <div>
                  <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Building2 size={16} /> Commission by Bank
                  </h4>
                  <div className="overflow-x-auto max-h-48">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Bank</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-700">Amount</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-700">Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(commissionData.by_bank || []).slice(0, 10).map((bank, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-900">{bank.bank_name}</td>
                            <td className="px-4 py-2 text-right text-emerald-600 font-medium">₹{bank.total_amount.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{bank.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

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
              <h3 className="font-semibold text-gray-900">{isAdmin ? 'Files' : 'My Files'} ({totalFiles})</h3>
              <span className="text-sm text-gray-500">
                {isAdmin ? 'All files in the system' : 'Files assigned to you'}
              </span>
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
                    onClick={() => navigate(isAdmin ? `/admin/files/${file.id}` : `/agent/files/${file.id}`)}
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
                          onClick={(e) => { e.stopPropagation(); navigate(isAdmin ? `/admin/files/${file.id}` : `/agent/files/${file.id}`); }}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                          title="View Details"
                        >
                          <Eye size={18} />
                        </button>
                        {isAdmin && (
                          <button 
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            onClick={(e) => { e.stopPropagation(); openDeleteConfirm(file); }}
                            title="Delete File"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
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
        
        {/* Approvals Tab Content - User Signup Approvals */}
        {activeTab === 'approvals' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-orange-50">
              <h3 className="font-semibold text-gray-900">Pending User Approvals</h3>
              <p className="text-sm text-gray-500">New user signups waiting for admin approval</p>
            </div>
            {pendingUsers.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <CheckCircle size={48} className="mx-auto mb-4 text-gray-300" />
                <p>No pending user approvals</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {pendingUsers.map((pendingUser) => (
                  <div
                    key={pendingUser.id}
                    className="px-4 py-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">{pendingUser.name}</h4>
                        <p className="text-sm text-gray-500">{pendingUser.email}</p>
                        <p className="text-xs text-gray-400">
                          Registered: {pendingUser.created_at ? new Date(pendingUser.created_at).toLocaleDateString() : '-'}
                        </p>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                          pendingUser.role === 'telecaller' ? 'bg-blue-100 text-blue-700' :
                          pendingUser.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {pendingUser.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApproveUser(pendingUser.id)}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectUser(pendingUser.id)}
                          className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100"
                        >
                          Reject
                        </button>
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
                <p className="text-sm text-gray-500">CRM users - map to Connect ID for unified login</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-orange-600 bg-orange-50 px-2 py-1 rounded">
                  {allUsers.filter(u => !u.connect_id).length} unmapped
                </span>
                <button 
                  onClick={() => navigate('/admin/users')}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                >
                  Manage Users
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">Role</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">Connect ID</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allUsers.map((mapUser) => (
                    <tr key={mapUser.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{mapUser.full_name || mapUser.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{mapUser.email || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          mapUser.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          mapUser.role === 'caller' || mapUser.role === 'telecaller' ? 'bg-blue-100 text-blue-700' :
                          mapUser.role === 'agent' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {mapUser.role || 'user'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {mapUser.connect_id ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                            ✓ Mapped
                          </span>
                        ) : (
                          <button
                            onClick={() => openMapModal(mapUser)}
                            className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 cursor-pointer transition-colors"
                          >
                            Not Mapped ➔
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          mapUser.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {mapUser.is_active !== false ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => navigate(`/admin/users/${mapUser.id}`)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                          title="View/Edit User"
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

      {/* Connect ID Mapping Modal */}
      {showMapModal && mappingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Map Connect ID</h3>
                <button 
                  onClick={() => setShowMapModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle size={24} />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">User:</span> {mappingUser.name}
                </p>
                <p className="text-sm text-blue-700">{mappingUser.email}</p>
                <p className="text-xs text-blue-600 mt-1">Role: {mappingUser.role}</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Connect ID (UUID)
                </label>
                <input
                  type="text"
                  value={connectIdInput}
                  onChange={(e) => setConnectIdInput(e.target.value)}
                  placeholder="e.g., 698c182cb2efa8083454f81f"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter the Connect app user ID to link accounts
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowMapModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMapConnectId}
                  disabled={isMapping || !connectIdInput.trim()}
                  className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMapping ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Mapping...
                    </>
                  ) : (
                    'Map Connect ID'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{fileToDelete?.name}"? 
              This action cannot be undone. All related records (activities, documents, commissions) will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteFile}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedFiles.length} Files?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedFiles.length} selected files? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : `Delete ${selectedFiles.length} Files`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FilesDashboard;
