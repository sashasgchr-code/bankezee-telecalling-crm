import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, XCircle, Filter, Download, FileText, Loader2, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import api from '../../../services/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const RejectedCasesReport = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [expandedFiles, setExpandedFiles] = useState({});
  
  // Filters
  const [timePeriod, setTimePeriod] = useState('this_month');
  const [selectedManager, setSelectedManager] = useState('');
  const [managers, setManagers] = useState([]);
  
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    fetchManagers();
  }, []);

  const fetchManagers = async () => {
    try {
      const response = await api.get('/users?role=telecaller');
      setManagers(response.data.users || response.data || []);
    } catch (error) {
      console.error('Failed to fetch managers:', error);
    }
  };

  const getDateRange = () => {
    const now = new Date();
    let start, end;
    
    switch (timePeriod) {
      case 'today':
        start = end = now.toISOString().split('T')[0];
        break;
      case 'this_week':
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek);
        start = startOfWeek.toISOString().split('T')[0];
        end = now.toISOString().split('T')[0];
        break;
      case 'this_month':
        start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        end = now.toISOString().split('T')[0];
        break;
      case 'last_month':
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        start = lastMonth.toISOString().split('T')[0];
        end = lastMonthEnd.toISOString().split('T')[0];
        break;
      case 'all_time':
      default:
        start = '';
        end = '';
    }
    return { start, end };
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const params = new URLSearchParams();
      if (start) params.append('start_date', start);
      if (end) params.append('end_date', end);
      if (selectedManager) params.append('assigned_to', selectedManager);
      
      const response = await api.get(`/files/reports/rejected?${params.toString()}`);
      setReportData(response.data);
      setReportGenerated(true);
    } catch (error) {
      console.error('Failed to generate report:', error);
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = () => {
    if (!reportData) return;
    
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('BANKEZEE - Rejected Cases Report', 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);
    
    // Summary
    doc.setFontSize(12);
    doc.text('Summary', 14, 42);
    
    const summaryData = [
      ['Total Cases', reportData.summary?.total || 0],
      ['Not Eligible', reportData.summary?.not_eligible || 0],
      ['Not Login', reportData.summary?.not_login || 0],
      ['FI Negative', reportData.summary?.fi_negative || 0],
      ['Declined', reportData.summary?.declined || 0],
      ['Not Disbursed', reportData.summary?.not_disbursed || 0],
    ];
    
    autoTable(doc, {
      startY: 46,
      head: [['Metric', 'Count']],
      body: summaryData,
      theme: 'grid',
    });
    
    doc.save('rejected_cases_report.pdf');
    toast.success('PDF exported');
  };

  const exportCSV = () => {
    if (!reportData?.cases) return;
    
    const headers = ['Name', 'Mobile', 'Status', 'City', 'Employment', 'Source', 'Agent'];
    const rows = reportData.cases.map(c => [
      c.name || c.full_name,
      c.mobile,
      c.file_status,
      c.city,
      c.employment_type,
      c.source,
      c.agent_name
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rejected_cases.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const toggleExpand = (fileId) => {
    setExpandedFiles(prev => ({ ...prev, [fileId]: !prev[fileId] }));
  };

  const getStatusColor = (status) => {
    const colors = {
      'not_eligible': 'bg-orange-100 text-orange-700',
      'not_login': 'bg-amber-100 text-amber-700',
      'fi_negative': 'bg-red-100 text-red-700',
      'declined': 'bg-red-100 text-red-700',
      'not_disbursed': 'bg-pink-100 text-pink-700',
      'rejected': 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const formatCurrency = (amount) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gray-50" data-testid="rejected-cases-report">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <XCircle size={24} className="text-red-600" />
              <h1 className="text-lg font-bold text-gray-900">Rejected Cases Report</h1>
            </div>
          </div>
          {reportGenerated && (
            <div className="flex gap-2">
              <button onClick={exportPDF} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                <FileText size={14} /> Export PDF
              </button>
              <button onClick={exportCSV} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                <Download size={14} /> Export CSV
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Filters Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter size={18} className="text-gray-500" />
            <h2 className="font-semibold text-gray-900">Report Filters</h2>
          </div>
          
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm text-gray-600 mb-1">Time Period</label>
              <select 
                value={timePeriod} 
                onChange={(e) => setTimePeriod(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                data-testid="time-period-filter"
              >
                <option value="today">Today</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="all_time">All Time</option>
              </select>
            </div>
            
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm text-gray-600 mb-1">Manager</label>
              <select 
                value={selectedManager} 
                onChange={(e) => setSelectedManager(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                data-testid="manager-filter"
              >
                <option value="">All Managers</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name || m.name}</option>
                ))}
              </select>
            </div>
            
            <button 
              onClick={generateReport}
              disabled={loading}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 font-medium"
              data-testid="generate-report-btn"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              Generate Report
            </button>
          </div>
        </div>

        {/* Report Content */}
        {!reportGenerated ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileText size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600 font-medium">Select filters and click "Generate Report"</p>
            <p className="text-gray-400 text-sm mt-1">This report shows all cases with rejection reasons at any stage</p>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Loader2 size={48} className="mx-auto text-green-600 animate-spin mb-4" />
            <p className="text-gray-600">Generating report...</p>
          </div>
        ) : reportData ? (
          <>
            {/* Summary Cards */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-2xl font-bold text-blue-600">{reportData.summary?.total || 0}</p>
                  <p className="text-xs text-gray-500">Total Cases</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center border border-orange-100">
                  <p className="text-2xl font-bold text-orange-600">{reportData.summary?.not_eligible || 0}</p>
                  <p className="text-xs text-gray-500">Not Eligible</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center border border-amber-100">
                  <p className="text-2xl font-bold text-amber-600">{reportData.summary?.not_login || 0}</p>
                  <p className="text-xs text-gray-500">Not Login</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center border border-red-100">
                  <p className="text-2xl font-bold text-red-600">{reportData.summary?.fi_negative || 0}</p>
                  <p className="text-xs text-gray-500">FI Negative</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
                  <p className="text-2xl font-bold text-gray-700">{reportData.summary?.declined || 0}</p>
                  <p className="text-xs text-gray-500">Declined</p>
                </div>
                <div className="bg-pink-50 rounded-lg p-3 text-center border border-pink-100">
                  <p className="text-2xl font-bold text-pink-600">{reportData.summary?.not_disbursed || 0}</p>
                  <p className="text-xs text-gray-500">Not Disbursed</p>
                </div>
              </div>
            </div>

            {/* Rejected Cases List */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Rejected/Declined Cases ({reportData.cases?.length || 0})</h3>
              </div>
              
              <div className="divide-y divide-gray-100">
                {reportData.cases?.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    No rejected cases found for the selected filters
                  </div>
                ) : (
                  reportData.cases?.map((file) => (
                    <div key={file.id} className="p-4">
                      {/* File Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <XCircle size={16} className="text-red-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900">{file.name || file.full_name}</p>
                              <span className="text-gray-400">-</span>
                              <span className="text-gray-500">******{file.mobile?.slice(-4)}</span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${getStatusColor(file.file_status)}`}>
                                {file.file_status?.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              City: {file.city || '-'} &nbsp;|&nbsp; Employment: {file.employment_type || '-'} &nbsp;|&nbsp; Source: {file.source || '-'} &nbsp;|&nbsp; Agent/Partner: {file.agent_name || '-'}
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => toggleExpand(file.id)}
                          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                        >
                          {file.eligibilities?.length || 0} bank(s)
                          {expandedFiles[file.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>

                      {/* Expanded Bank Details */}
                      {expandedFiles[file.id] && file.eligibilities?.length > 0 && (
                        <div className="mt-4 ml-11 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 text-gray-600">
                                <th className="px-3 py-2 text-left font-medium">Bank</th>
                                <th className="px-3 py-2 text-center font-medium">Eligible?</th>
                                <th className="px-3 py-2 text-right font-medium">Elig. Amount</th>
                                <th className="px-3 py-2 text-center font-medium">Login?</th>
                                <th className="px-3 py-2 text-center font-medium">Approval</th>
                                <th className="px-3 py-2 text-right font-medium">Appr. Amount</th>
                                <th className="px-3 py-2 text-center font-medium">Disbursed?</th>
                                <th className="px-3 py-2 text-right font-medium">Disb. Amount</th>
                                <th className="px-3 py-2 text-left font-medium">Reason</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {file.eligibilities.map((elig, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-medium">{elig.bank_name}</td>
                                  <td className="px-3 py-2 text-center">
                                    {elig.is_eligible === 'yes' ? (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">yes</span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(elig.eligible_amount)}</td>
                                  <td className="px-3 py-2 text-center">
                                    {elig.login_done === 'yes' || elig.login_done === true ? (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">yes</span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {elig.approval_status === 'approved' ? (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">approved</span>
                                    ) : elig.approval_status === 'declined' ? (
                                      <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">declined</span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(elig.approved_amount)}</td>
                                  <td className="px-3 py-2 text-center">
                                    {elig.disbursed === 'yes' || elig.disbursed === true ? (
                                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">yes</span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">{formatCurrency(elig.disbursed_amount)}</td>
                                  <td className="px-3 py-2 text-left">
                                    {(elig.approval_status === 'declined' || elig.rejection_reason) && (
                                      <span className="text-red-600 text-xs">
                                        {elig.approval_status === 'declined' && 'Declined: '}
                                        {elig.rejection_reason || elig.remarks || '-'}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default RejectedCasesReport;
