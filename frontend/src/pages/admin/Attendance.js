import React, { useState, useEffect } from 'react';
import { GrowthPartnerFilter, EmployeeSearch, matchesGpFilters, useActiveGrowthPartners } from '../../components/GrowthPartnerFilter';
import { PrintReportButton } from '../../components/PrintReportButton';
import { 
  Users, Clock, MapPin, Calendar, Building2, Home, Palmtree, 
  AlertCircle, CheckCircle, XCircle, ChevronLeft, ChevronRight,
  Filter, Download, Edit2, History, Settings, Loader2, Search,
  UserCheck, UserX, Coffee, Grid3X3
} from 'lucide-react';
import api from '../../services/api';
import { format, parseISO } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * AdminAttendanceDashboard - Full attendance management for admins
 */
const AdminAttendanceDashboard = () => {
  const [activeTab, setActiveTab] = useState('today');
  const [showMatrixView, setShowMatrixView] = useState(false);
  const [matrixMonth, setMatrixMonth] = useState(new Date().getMonth() + 1);
  const [matrixYear, setMatrixYear] = useState(new Date().getFullYear());
  const [matrixData, setMatrixData] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filters, setFilters] = useState({ workMode: '', status: '', search: '' });
  const [offices, setOffices] = useState([]);
  const [settings, setSettings] = useState(null);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [gpSelection, setGpSelection] = useState([]);
  const [gpSearch, setGpSearch] = useState('');
  const { mobileById } = useActiveGrowthPartners();
  
  // Modal states
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showWFHAssignModal, setShowWFHAssignModal] = useState(false);
  const [showLeaveAssignModal, setShowLeaveAssignModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  
  // Form states
  const [officeForm, setOfficeForm] = useState({ office_name: '', latitude: '', longitude: '', allowed_radius_meters: 150 });
  const [correctionForm, setCorrectionForm] = useState({ check_in_time: '', check_out_time: '', work_mode: '', attendance_status: '', reason: '' });
  const [wfhAssignForm, setWfhAssignForm] = useState({ user_id: '', date: '', admin_notes: '' });
  const [leaveAssignForm, setLeaveAssignForm] = useState({ user_id: '', start_date: '', end_date: '', leave_type: 'GENERAL', reason: '' });

  const workModeConfig = {
    OFFICE: { icon: Building2, label: 'Office', color: 'text-blue-600', bgColor: 'bg-blue-100' },
    WORK_FROM_HOME: { icon: Home, label: 'WFH', color: 'text-purple-600', bgColor: 'bg-purple-100' },
    LEAVE: { icon: Palmtree, label: 'Leave', color: 'text-green-600', bgColor: 'bg-green-100' },
  };

  const statusColors = {
    PRESENT: 'bg-green-100 text-green-700',
    LATE: 'bg-amber-100 text-amber-700',
    HALF_DAY: 'bg-blue-100 text-blue-700',
    ABSENT: 'bg-red-100 text-red-700',
    ON_LEAVE: 'bg-green-100 text-green-700',
    MANUALLY_ADJUSTED: 'bg-purple-100 text-purple-700',
  };

  useEffect(() => {
    fetchData();
    fetchOffices();
    fetchSettings();
    fetchWFHRequests();
    fetchUsers();
  }, [selectedDate]);

  // Fetch monthly matrix when matrix view is enabled
  useEffect(() => {
    if (showMatrixView) {
      fetchMonthlyMatrix();
    }
  }, [showMatrixView, matrixMonth, matrixYear]);

  const fetchMonthlyMatrix = async () => {
    try {
      setMatrixLoading(true);
      const response = await api.get('/attendance/admin/monthly-matrix', {
        params: { month: matrixMonth, year: matrixYear }
      });
      setMatrixData(response.data);
    } catch (error) {
      console.error('Error fetching monthly matrix:', error);
    } finally {
      setMatrixLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [summaryRes, recordsRes] = await Promise.all([
        api.get('/attendance/admin/summary', { params: { date: selectedDate } }),
        api.get('/attendance/admin/today', { params: { date: selectedDate } })
      ]);
      setSummary(summaryRes.data);
      setRecords(recordsRes.data);
    } catch (error) {
      console.error('Error fetching attendance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOffices = async () => {
    try {
      const response = await api.get('/attendance/admin/offices');
      setOffices(response.data);
    } catch (error) {
      console.error('Error fetching offices:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await api.get('/attendance/admin/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const fetchWFHRequests = async () => {
    try {
      const response = await api.get('/attendance/admin/wfh-requests', { params: { status: 'PENDING' } });
      setWfhRequests(response.data);
    } catch (error) {
      console.error('Error fetching WFH requests:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data.filter(u => u.role !== 'admin' && u.is_active));
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleCreateOffice = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance/admin/offices', {
        ...officeForm,
        latitude: parseFloat(officeForm.latitude),
        longitude: parseFloat(officeForm.longitude),
        allowed_radius_meters: parseInt(officeForm.allowed_radius_meters)
      });
      setShowOfficeModal(false);
      setOfficeForm({ office_name: '', latitude: '', longitude: '', allowed_radius_meters: 150 });
      fetchOffices();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to create office');
    }
  };

  const handleCorrection = async (e) => {
    e.preventDefault();
    if (!correctionForm.reason) {
      alert('Reason is required for corrections');
      return;
    }
    try {
      await api.patch(`/attendance/admin/record/${selectedRecord.id}`, correctionForm);
      setShowCorrectionModal(false);
      setCorrectionForm({ check_in_time: '', check_out_time: '', work_mode: '', attendance_status: '', reason: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to update attendance');
    }
  };

  const handleWFHApproval = async (requestId, status) => {
    try {
      await api.patch(`/attendance/admin/wfh-requests/${requestId}`, { status });
      fetchWFHRequests();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to process WFH request');
    }
  };

  const handleAssignWFH = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance/admin/wfh-assign', wfhAssignForm);
      setShowWFHAssignModal(false);
      setWfhAssignForm({ user_id: '', date: '', admin_notes: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to assign WFH');
    }
  };

  const handleAssignLeave = async (e) => {
    e.preventDefault();
    try {
      await api.post('/attendance/admin/leave-assign', leaveAssignForm);
      setShowLeaveAssignModal(false);
      setLeaveAssignForm({ user_id: '', start_date: '', end_date: '', leave_type: 'GENERAL', reason: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to assign leave');
    }
  };

  const handleExport = async () => {
    try {
      const endDate = new Date(selectedDate);
      endDate.setMonth(endDate.getMonth() + 1);
      
      const response = await api.get('/attendance/admin/export', {
        params: {
          start_date: selectedDate,
          end_date: endDate.toISOString().split('T')[0]
        }
      });
      
      // Convert to CSV
      if (response.data.length === 0) {
        alert('No data to export');
        return;
      }
      
      const headers = Object.keys(response.data[0]);
      const csvContent = [
        headers.join(','),
        ...response.data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${selectedDate}.csv`;
      a.click();
    } catch (error) {
      alert('Failed to export data');
    }
  };

  const handleExportPDF = () => {
    if (!filteredRecords || filteredRecords.length === 0) {
      alert('No data to export');
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    doc.setFontSize(18);
    doc.setTextColor(22, 163, 74);
    doc.text('BankEzee Connect', 40, 40);
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    doc.text('Attendance Report', 40, 60);
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text(`Date: ${selectedDate}`, 40, 78);
    doc.text(`Generated: ${generatedAt} IST`, 40, 92);
    doc.text(`Total Records: ${filteredRecords.length}`, 40, 106);

    const rows = filteredRecords.map((r) => [
      r.user_name || '-',
      r.role || 'Growth Partner',
      (workModeConfig[r.work_mode]?.label) || r.work_mode || 'Office',
      getDisplayTime(r, 'check_in_time'),
      getDisplayTime(r, 'check_out_time'),
      r.working_minutes ? `${Math.floor(r.working_minutes / 60)}h ${r.working_minutes % 60}m` : '-',
      (r.attendance_status || '-').replace(/_/g, ' '),
    ]);

    autoTable(doc, {
      startY: 120,
      head: [['Employee', 'Role', 'Work Mode', 'Check In', 'Check Out', 'Working', 'Status']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [22, 163, 74], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 253, 244] },
      margin: { left: 40, right: 40 },
    });

    doc.save(`BankEzee_Attendance_${selectedDate}.pdf`);
  };

  const formatTime = (isoString) => {
    if (!isoString) return '--:--';
    // Use Intl.DateTimeFormat with Asia/Kolkata timezone for consistent IST display
    try {
      const date = parseISO(isoString);
      return new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      }).format(date);
    } catch (e) {
      return format(parseISO(isoString), 'hh:mm a');
    }
  };

  // Format time using pre-formatted IST string from API (preferred)
  const getDisplayTime = (record, field) => {
    // Prefer the pre-formatted IST time from API
    const istField = `${field}_ist`;
    if (record[istField]) {
      return record[istField];
    }
    // Fallback to formatting UTC time with IST timezone
    return formatTime(record[field]);
  };

  const filteredRecords = records.filter(record => {
    if (filters.workMode && record.work_mode !== filters.workMode) return false;
    if (filters.status && record.attendance_status !== filters.status) return false;
    if (filters.search && !record.user_name?.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return matchesGpFilters(record, { selectedIds: gpSelection, search: gpSearch, mobileById });
  });

  const filteredMatrix = (matrixData?.matrix || []).filter(row =>
    matchesGpFilters(row, { selectedIds: gpSelection, search: gpSearch, mobileById })
  );

  return (
    <div className="space-y-6" data-testid="admin-attendance-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance Management</h1>
          <p className="text-gray-500">Monitor and manage employee attendance</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Settings size={18} />
            Settings
          </button>
          <button
            onClick={handleExport}
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={18} />
            Export
          </button>
          <button
            onClick={handleExportPDF}
            className="btn-secondary flex items-center gap-2"
            data-testid="attendance-export-pdf"
          >
            <Download size={18} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Date Selector */}
      <div className="card p-4 flex items-center justify-between">
        <button
          onClick={() => {
            const d = new Date(selectedDate);
            d.setDate(d.getDate() - 1);
            setSelectedDate(d.toISOString().split('T')[0]);
          }}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <Calendar size={20} className="text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input-field w-auto"
          />
        </div>
        <button
          onClick={() => {
            const d = new Date(selectedDate);
            d.setDate(d.getDate() + 1);
            setSelectedDate(d.toISOString().split('T')[0]);
          }}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="card p-4 text-center">
            <Users size={24} className="mx-auto text-gray-400 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.total_employees}</p>
            <p className="text-sm text-gray-500">Total</p>
          </div>
          <div className="card p-4 text-center bg-green-50">
            <UserCheck size={24} className="mx-auto text-green-500 mb-2" />
            <p className="text-2xl font-bold text-green-600">{summary.present}</p>
            <p className="text-sm text-green-700">Present</p>
          </div>
          <div className="card p-4 text-center bg-amber-50">
            <Clock size={24} className="mx-auto text-amber-500 mb-2" />
            <p className="text-2xl font-bold text-amber-600">{summary.late}</p>
            <p className="text-sm text-amber-700">Late</p>
          </div>
          <div className="card p-4 text-center bg-red-50">
            <UserX size={24} className="mx-auto text-red-500 mb-2" />
            <p className="text-2xl font-bold text-red-600">{summary.absent}</p>
            <p className="text-sm text-red-700">Absent</p>
          </div>
          <div className="card p-4 text-center bg-purple-50">
            <Home size={24} className="mx-auto text-purple-500 mb-2" />
            <p className="text-2xl font-bold text-purple-600">{summary.wfh}</p>
            <p className="text-sm text-purple-700">WFH</p>
          </div>
          <div className="card p-4 text-center bg-green-50">
            <Palmtree size={24} className="mx-auto text-green-500 mb-2" />
            <p className="text-2xl font-bold text-green-600">{summary.on_leave}</p>
            <p className="text-sm text-green-700">On Leave</p>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setShowOfficeModal(true)}
          className="btn-secondary flex items-center gap-2"
        >
          <Building2 size={18} />
          Add Office
        </button>
        <button
          onClick={() => setShowWFHAssignModal(true)}
          className="btn-secondary flex items-center gap-2"
        >
          <Home size={18} />
          Assign WFH
        </button>
        <button
          onClick={() => setShowLeaveAssignModal(true)}
          className="btn-secondary flex items-center gap-2"
        >
          <Palmtree size={18} />
          Assign Leave
        </button>
        <GrowthPartnerFilter selected={gpSelection} onChange={setGpSelection} testId="attendance-gp-filter" />
        <EmployeeSearch value={gpSearch} onChange={setGpSearch} testId="attendance-gp-search" />
        <button
          onClick={() => setShowMatrixView(!showMatrixView)}
          className={`btn-secondary flex items-center gap-2 ${showMatrixView ? 'bg-green-100 text-green-700' : ''}`}
          data-testid="toggle-matrix-view"
        >
          <Grid3X3 size={18} />
          {showMatrixView ? 'Hide' : 'Show'} Monthly Matrix
        </button>
      </div>

      {/* Monthly Matrix View */}
      {showMatrixView && (
        <div className="card p-4 print-root" data-testid="monthly-matrix-view" id="attendance-matrix-report">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 print-hide">
              <Grid3X3 size={18} className="text-green-600" />
              Monthly Attendance Matrix
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <PrintReportButton
                title="Monthly Attendance Matrix"
                subtitle={`${new Date(matrixYear, matrixMonth - 1).toLocaleString('en-IN', { month: 'long' })} ${matrixYear} \u00b7 ${filteredMatrix.length} Growth Partner(s)${gpSearch ? ` \u00b7 search: "${gpSearch}"` : ''}${gpSelection.length ? ' \u00b7 filtered selection' : ' \u00b7 all active Growth Partners'}`}
                targetId="attendance-matrix-report"
                testId="print-attendance-matrix-btn"
              />
              <button 
                onClick={() => {
                  if (matrixMonth === 1) {
                    setMatrixMonth(12);
                    setMatrixYear(matrixYear - 1);
                  } else {
                    setMatrixMonth(matrixMonth - 1);
                  }
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
                data-testid="prev-month-btn"
              >
                <ChevronLeft size={18} />
              </button>
              
              {/* Month Dropdown */}
              <select
                value={matrixMonth}
                onChange={(e) => setMatrixMonth(parseInt(e.target.value))}
                className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                data-testid="month-select"
              >
                {['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              
              {/* Year Dropdown */}
              <select
                value={matrixYear}
                onChange={(e) => setMatrixYear(parseInt(e.target.value))}
                className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                data-testid="year-select"
              >
                {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              
              <button 
                onClick={() => {
                  const now = new Date();
                  if (matrixYear < now.getFullYear() || (matrixYear === now.getFullYear() && matrixMonth < now.getMonth() + 1)) {
                    if (matrixMonth === 12) {
                      setMatrixMonth(1);
                      setMatrixYear(matrixYear + 1);
                    } else {
                      setMatrixMonth(matrixMonth + 1);
                    }
                  }
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
                data-testid="next-month-btn"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {matrixLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
          ) : matrixData ? (
            <div className="overflow-x-auto max-h-[60vh] border border-gray-200 rounded-lg">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-20 bg-gray-50">
                  <tr>
                    <th className="sticky left-0 z-30 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[140px] sm:min-w-[180px]">
                      Growth Partner
                    </th>
                    {Array.from({ length: matrixData.days_in_month }, (_, i) => {
                      const day = i + 1;
                      const date = new Date(matrixYear, matrixMonth - 1, day);
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                      return (
                        <th key={day} className={`px-1 py-2 text-center font-medium border-b border-gray-200 min-w-[32px] ${isWeekend ? 'bg-gray-100 text-gray-500' : 'text-gray-600'}`}>
                          {day}
                        </th>
                      );
                    })}
                    <th className="px-2 py-2 text-center font-semibold text-green-700 bg-green-50 border-b border-l border-gray-200 min-w-[36px]" title="Present">P</th>
                    <th className="px-2 py-2 text-center font-semibold text-orange-700 bg-orange-50 border-b border-gray-200 min-w-[36px]" title="Late">L</th>
                    <th className="px-2 py-2 text-center font-semibold text-blue-700 bg-blue-50 border-b border-gray-200 min-w-[36px]" title="Work From Home">W</th>
                    <th className="px-2 py-2 text-center font-semibold text-amber-700 bg-amber-50 border-b border-gray-200 min-w-[36px]" title="Approved Leave">A</th>
                    <th className="px-2 py-2 text-center font-semibold text-red-700 bg-red-50 border-b border-gray-200 min-w-[36px]" title="Uninformed Absence">U</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-700 bg-gray-100 border-b border-gray-200 min-w-[44px]" title="Working Days">WD</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 bg-gray-100 border-b border-gray-200 min-w-[44px]" title="Attendance Percentage">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredMatrix.map((row, idx) => (
                    <tr key={row.user_id || idx} className="hover:bg-gray-50/50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-800 border-r border-gray-200 whitespace-nowrap">
                        {row.user_name}
                      </td>
                      {Array.from({ length: matrixData.days_in_month }, (_, i) => {
                        const day = i + 1;
                        const dayData = row.days?.[day];
                        const code = dayData?.code || '';
                        const displayCode = code.startsWith('L ') ? 'L' : code;
                        const date = new Date(matrixYear, matrixMonth - 1, day);
                        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                        
                        const bgColor = {
                          'P': 'bg-green-100 text-green-700 font-medium',
                          'W': 'bg-blue-100 text-blue-700 font-medium',
                          'L': 'bg-orange-100 text-orange-700 font-medium',
                          'A': 'bg-amber-100 text-amber-700 font-medium',
                          'U': 'bg-red-100 text-red-700 font-medium',
                          '-': 'bg-gray-100 text-gray-400',
                          '': 'bg-gray-50 text-gray-300'
                        }[displayCode] || 'text-gray-400';
                        
                        return (
                          <td 
                            key={day} 
                            className={`px-1 py-2 text-center cursor-pointer transition-colors ${bgColor} ${isWeekend && code === '-' ? 'bg-gray-50' : ''}`} 
                            title={dayData?.detail || (code.startsWith('L ') ? `Late - Check-in: ${code.replace('L ', '')}` : '')}
                          >
                            {displayCode}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center font-semibold bg-green-50 text-green-700 border-l border-gray-200">{row.summary?.present || 0}</td>
                      <td className="px-2 py-2 text-center font-semibold bg-orange-50 text-orange-700">{row.summary?.late || 0}</td>
                      <td className="px-2 py-2 text-center font-semibold bg-blue-50 text-blue-700">{row.summary?.wfh || 0}</td>
                      <td className="px-2 py-2 text-center font-semibold bg-amber-50 text-amber-700">{row.summary?.leave || 0}</td>
                      <td className="px-2 py-2 text-center font-semibold bg-red-50 text-red-700">{row.summary?.absent || 0}</td>
                      <td className="px-2 py-2 text-center font-semibold bg-gray-100 text-gray-700">{row.summary?.working_days || 0}</td>
                      <td className="px-2 py-2 text-center font-bold bg-gray-100 text-gray-900">{row.summary?.attendance_percentage || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No matrix data available</p>
          )}
          
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100 text-xs">
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-100 border border-green-200"></span> P = Present</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-orange-100 border border-orange-200"></span> L = Late</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-blue-100 border border-blue-200"></span> W = WFH</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-100 border border-amber-200"></span> A = Approved Leave</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-100 border border-red-200"></span> U = Uninformed Absence</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-gray-100 border border-gray-200"></span> - = Weekend</span>
          </div>
        </div>
      )}

      {/* WFH Requests */}
      {wfhRequests.length > 0 && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertCircle size={18} className="text-amber-500" />
            Pending WFH Requests ({wfhRequests.length})
          </h3>
          <div className="space-y-2">
            {wfhRequests.map(request => (
              <div key={request.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <div>
                  <p className="font-medium">{request.user_name}</p>
                  <p className="text-sm text-gray-500">
                    {format(parseISO(request.date), 'MMM d, yyyy')} - {request.reason || 'No reason provided'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleWFHApproval(request.id, 'APPROVED')}
                    className="px-3 py-1 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleWFHApproval(request.id, 'REJECTED')}
                    className="px-3 py-1 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-gray-400" />
          <input
            type="text"
            placeholder="Search employee..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="input-field w-48"
          />
        </div>
        <select
          value={filters.workMode}
          onChange={(e) => setFilters({ ...filters, workMode: e.target.value })}
          className="input-field w-40"
        >
          <option value="">All Modes</option>
          <option value="OFFICE">Office</option>
          <option value="WORK_FROM_HOME">WFH</option>
          <option value="LEAVE">Leave</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="input-field w-40"
        >
          <option value="">All Status</option>
          <option value="PRESENT">Present</option>
          <option value="LATE">Late</option>
          <option value="HALF_DAY">Half Day</option>
          <option value="ON_LEAVE">On Leave</option>
        </select>
      </div>

      {/* Records Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Employee</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Mode</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Check In</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Check Out</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Hours</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Distance</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-green-600" />
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No attendance records found
                  </td>
                </tr>
              ) : (
                filteredRecords.map(record => {
                  const modeConfig = workModeConfig[record.work_mode] || workModeConfig.OFFICE;
                  const ModeIcon = modeConfig.icon;
                  
                  return (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{record.user_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ModeIcon size={16} className={modeConfig.color} />
                          <span className="text-sm">{modeConfig.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">{getDisplayTime(record, 'check_in_time')}</td>
                      <td className="px-4 py-3 text-sm">{getDisplayTime(record, 'check_out_time')}</td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {record.working_minutes ? `${Math.floor(record.working_minutes / 60)}h ${record.working_minutes % 60}m` : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {record.check_in_distance_from_office ? `${record.check_in_distance_from_office}m` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[record.attendance_status] || 'bg-gray-100 text-gray-700'}`}>
                          {record.attendance_status?.replace('_', ' ') || '-'}
                        </span>
                        {record.manually_adjusted && (
                          <span className="ml-1 text-xs text-purple-600">(Adjusted)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            setSelectedRecord(record);
                            setCorrectionForm({
                              check_in_time: record.check_in_time || '',
                              check_out_time: record.check_out_time || '',
                              work_mode: record.work_mode || '',
                              attendance_status: record.attendance_status || '',
                              reason: ''
                            });
                            setShowCorrectionModal(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg"
                          title="Edit"
                        >
                          <Edit2 size={16} className="text-gray-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Office Configuration */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Building2 size={18} className="text-blue-500" />
          Office Locations
        </h3>
        {offices.length === 0 ? (
          <p className="text-gray-500 text-sm">No offices configured. Add an office to enable geofence check-in.</p>
        ) : (
          <div className="space-y-2">
            {offices.map(office => (
              <div key={office.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium">{office.office_name}</p>
                  <p className="text-sm text-gray-500">
                    {office.latitude.toFixed(6)}, {office.longitude.toFixed(6)} | Radius: {office.allowed_radius_meters}m
                  </p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs ${office.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {office.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Office Modal */}
      {showOfficeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Office Location</h3>
            <form onSubmit={handleCreateOffice} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Office Name</label>
                <input
                  type="text"
                  value={officeForm.office_name}
                  onChange={(e) => setOfficeForm({ ...officeForm, office_name: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={officeForm.latitude}
                    onChange={(e) => setOfficeForm({ ...officeForm, latitude: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={officeForm.longitude}
                    onChange={(e) => setOfficeForm({ ...officeForm, longitude: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Allowed Radius (meters)</label>
                <input
                  type="number"
                  value={officeForm.allowed_radius_meters}
                  onChange={(e) => setOfficeForm({ ...officeForm, allowed_radius_meters: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowOfficeModal(false)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Add Office
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Correction Modal */}
      {showCorrectionModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Attendance - {selectedRecord.user_name}</h3>
            <form onSubmit={handleCorrection} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check In Time</label>
                <input
                  type="datetime-local"
                  value={correctionForm.check_in_time ? correctionForm.check_in_time.slice(0, 16) : ''}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, check_in_time: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check Out Time</label>
                <input
                  type="datetime-local"
                  value={correctionForm.check_out_time ? correctionForm.check_out_time.slice(0, 16) : ''}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, check_out_time: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Work Mode</label>
                <select
                  value={correctionForm.work_mode}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, work_mode: e.target.value })}
                  className="input-field"
                >
                  <option value="">No change</option>
                  <option value="OFFICE">Office</option>
                  <option value="WORK_FROM_HOME">Work From Home</option>
                  <option value="LEAVE">Leave</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={correctionForm.attendance_status}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, attendance_status: e.target.value })}
                  className="input-field"
                >
                  <option value="">No change</option>
                  <option value="PRESENT">Present</option>
                  <option value="LATE">Late</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="ON_LEAVE">On Leave</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason (Required)</label>
                <textarea
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  className="input-field min-h-[80px]"
                  required
                  placeholder="Explain why this correction is needed..."
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowCorrectionModal(false)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WFH Assign Modal */}
      {showWFHAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Assign Work From Home</h3>
            <form onSubmit={handleAssignWFH} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select
                  value={wfhAssignForm.user_id}
                  onChange={(e) => setWfhAssignForm({ ...wfhAssignForm, user_id: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="">Select employee</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={wfhAssignForm.date}
                  onChange={(e) => setWfhAssignForm({ ...wfhAssignForm, date: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={wfhAssignForm.admin_notes}
                  onChange={(e) => setWfhAssignForm({ ...wfhAssignForm, admin_notes: e.target.value })}
                  className="input-field min-h-[60px]"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowWFHAssignModal(false)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Assign WFH
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leave Assign Modal */}
      {showLeaveAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Assign Leave</h3>
            <form onSubmit={handleAssignLeave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select
                  value={leaveAssignForm.user_id}
                  onChange={(e) => setLeaveAssignForm({ ...leaveAssignForm, user_id: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="">Select employee</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={leaveAssignForm.start_date}
                    onChange={(e) => setLeaveAssignForm({ ...leaveAssignForm, start_date: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={leaveAssignForm.end_date}
                    onChange={(e) => setLeaveAssignForm({ ...leaveAssignForm, end_date: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
                <select
                  value={leaveAssignForm.leave_type}
                  onChange={(e) => setLeaveAssignForm({ ...leaveAssignForm, leave_type: e.target.value })}
                  className="input-field"
                >
                  <option value="GENERAL">General</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="CASUAL">Casual Leave</option>
                  <option value="PAID">Paid Leave</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea
                  value={leaveAssignForm.reason}
                  onChange={(e) => setLeaveAssignForm({ ...leaveAssignForm, reason: e.target.value })}
                  className="input-field min-h-[60px]"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowLeaveAssignModal(false)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Assign Leave
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && settings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Attendance Settings</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.patch('/attendance/admin/settings', {
                  office_start_time: settings.office_start_time,
                  late_after_time: settings.late_after_time,
                  full_day_minutes: parseInt(settings.full_day_minutes),
                  half_day_minutes: parseInt(settings.half_day_minutes),
                  allowed_office_radius_meters: parseInt(settings.allowed_office_radius_meters)
                });
                setShowSettingsModal(false);
                fetchSettings();
                alert('Settings saved successfully');
              } catch (error) {
                alert(error.response?.data?.detail || 'Failed to save settings');
              }
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Office Start</label>
                  <input
                    type="time"
                    value={settings.office_start_time}
                    onChange={(e) => setSettings({ ...settings, office_start_time: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Late After</label>
                  <input
                    type="time"
                    value={settings.late_after_time}
                    onChange={(e) => setSettings({ ...settings, late_after_time: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Day (mins)</label>
                  <input
                    type="number"
                    value={settings.full_day_minutes}
                    onChange={(e) => setSettings({ ...settings, full_day_minutes: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Half Day (mins)</label>
                  <input
                    type="number"
                    value={settings.half_day_minutes}
                    onChange={(e) => setSettings({ ...settings, half_day_minutes: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Office Radius (m)</label>
                <input
                  type="number"
                  value={settings.allowed_office_radius_meters}
                  onChange={(e) => setSettings({ ...settings, allowed_office_radius_meters: e.target.value })}
                  className="input-field"
                />
              </div>
              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => setShowSettingsModal(false)} className="flex-1 btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="flex-1 btn-primary">
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAttendanceDashboard;
