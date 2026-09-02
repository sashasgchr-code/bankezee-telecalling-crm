import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, BarChart3, Filter, FileText, Loader2, Printer, TrendingUp, Building2, Users, AlertCircle } from 'lucide-react';
import api from '../../../services/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const SalesOpsReport = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportData, setReportData] = useState(null);
  
  // Filters
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('start_date', fromDate);
      if (toDate) params.append('end_date', toDate);
      
      const response = await api.get(`/files/reports/sales-ops?${params.toString()}`);
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
    doc.text('BANKEZEE - Sales & Operations Report', 14, 15);
    doc.setFontSize(10);
    doc.text(`${fromDate} to ${toDate}`, 14, 22);
    
    // Business Volume Metrics
    doc.setFontSize(12);
    doc.text('1. Business Volume Metrics', 14, 34);
    
    const volumeData = [
      ['Total Files Generated', reportData.volume?.total_files || 0],
      ['In Progress', reportData.volume?.in_progress || 0],
      ['Files Logged (Login)', `${reportData.volume?.login || 0} (C: ${reportData.volume?.login_current || 0}, S: ${reportData.volume?.login_spillover || 0})`],
      ['Total Approvals', `${reportData.volume?.approved || 0} (C: ${reportData.volume?.approved_current || 0}, S: ${reportData.volume?.approved_spillover || 0})`],
      ['Total Disbursals', `${reportData.volume?.disbursed || 0} (C: ${reportData.volume?.disbursed_current || 0}, S: ${reportData.volume?.disbursed_spillover || 0})`],
      ['Disbursal Value', formatCurrency(reportData.volume?.disbursed_amount || 0)],
      ['Amt in Pipeline', formatCurrency(reportData.volume?.pipeline_amount || 0)],
    ];
    
    autoTable(doc, {
      startY: 38,
      head: [['Metric', 'Value']],
      body: volumeData,
      theme: 'grid',
    });
    
    doc.save('sales_ops_report.pdf');
    toast.success('PDF exported');
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (amount) => {
    if (!amount) return '₹0';
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  const formatPercentage = (num, denom) => {
    if (!denom || denom === 0) return '0%';
    return `${((num / denom) * 100).toFixed(1)}%`;
  };

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white" data-testid="sales-ops-report">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10 print:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <BarChart3 size={24} className="text-blue-600" />
              <h1 className="text-lg font-bold text-gray-900">Sales & Operations Report</h1>
            </div>
          </div>
          {reportGenerated && (
            <div className="flex gap-2">
              <button onClick={exportPDF} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                <FileText size={14} /> Export PDF
              </button>
              <button onClick={handlePrint} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1">
                <Printer size={14} /> Print
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Filters Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 print:hidden">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[140px]">
              <label className="block text-sm text-gray-600 mb-1">From</label>
              <input 
                type="date" 
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-sm text-gray-600 mb-1">To</label>
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button 
              onClick={generateReport}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
              data-testid="generate-report-btn"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              Generate Report
            </button>
          </div>
        </div>

        {/* Report Content */}
        {!reportGenerated ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center print:hidden">
            <BarChart3 size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600 font-medium">Select date range and click "Generate Report"</p>
            <p className="text-gray-400 text-sm mt-1">Comprehensive sales and operations metrics</p>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Loader2 size={48} className="mx-auto text-blue-600 animate-spin mb-4" />
            <p className="text-gray-600">Generating report...</p>
          </div>
        ) : reportData ? (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center print:border-0">
              <h2 className="text-xl font-bold text-gray-900">BANKEZEE - Sales & Operations Report</h2>
              <p className="text-gray-500">{fromDate} to {toDate}</p>
              {reportData.spillover_count > 0 && (
                <p className="text-amber-600 text-sm mt-1">Includes {reportData.spillover_count} spillover cases from previous period</p>
              )}
            </div>

            {/* 1. Business Volume Metrics */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp size={18} className="text-blue-600" />
                1. Business Volume Metrics
              </h3>
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{reportData.volume?.total_files || 0}</p>
                  <p className="text-xs text-gray-500">Total Files Generated</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{reportData.volume?.in_progress || 0}</p>
                  <p className="text-xs text-gray-500">In Progress</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{reportData.volume?.login || 0}</p>
                  <p className="text-xs text-gray-400">C: {reportData.volume?.login_current || 0} | S: {reportData.volume?.login_spillover || 0}</p>
                  <p className="text-xs text-gray-500">Files Logged (Login)</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{reportData.volume?.approved || 0}</p>
                  <p className="text-xs text-gray-400">C: {reportData.volume?.approved_current || 0} | S: {reportData.volume?.approved_spillover || 0}</p>
                  <p className="text-xs text-gray-500">Total Approvals</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{reportData.volume?.disbursed || 0}</p>
                  <p className="text-xs text-gray-400">C: {reportData.volume?.disbursed_current || 0} | S: {reportData.volume?.disbursed_spillover || 0}</p>
                  <p className="text-xs text-gray-500">Total Disbursals</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{formatCurrency(reportData.volume?.disbursed_amount)}</p>
                  <p className="text-xs text-gray-400">C: {formatCurrency(reportData.volume?.disbursed_amount_current)} | S: {formatCurrency(reportData.volume?.disbursed_amount_spillover)}</p>
                  <p className="text-xs text-gray-500">Disbursal Value</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{formatCurrency(reportData.volume?.avg_loan_value)}</p>
                  <p className="text-xs text-gray-500">Avg Loan Value</p>
                </div>
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{reportData.volume?.final_rejections || 0}</p>
                  <p className="text-xs text-gray-400">C: {reportData.volume?.final_rejections_current || 0} | S: {reportData.volume?.final_rejections_spillover || 0}</p>
                  <p className="text-xs text-gray-500">Final Rejections</p>
                </div>
                <div className="border border-orange-200 bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-600">{reportData.volume?.interim_rejects || 0}</p>
                  <p className="text-xs text-gray-400">C: {reportData.volume?.interim_rejects_current || 0} | S: {reportData.volume?.interim_rejects_spillover || 0}</p>
                  <p className="text-xs text-gray-500">Interim Rejects</p>
                </div>
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{formatCurrency(reportData.volume?.pipeline_amount)}</p>
                  <p className="text-xs text-gray-500">Amt in Pipeline</p>
                </div>
              </div>

              {/* Conversion Metrics */}
              <div className="grid grid-cols-5 gap-2 text-center text-sm">
                <div className="bg-gray-50 rounded p-2">
                  <p className="font-semibold text-gray-700">{formatPercentage(reportData.volume?.login, reportData.volume?.total_files)}</p>
                  <p className="text-xs text-gray-500">Lead → Login</p>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <p className="font-semibold text-gray-700">{formatPercentage(reportData.volume?.approved, reportData.volume?.login)}</p>
                  <p className="text-xs text-gray-500">Login → Approval</p>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <p className="font-semibold text-gray-700">{formatPercentage(reportData.volume?.disbursed, reportData.volume?.approved)}</p>
                  <p className="text-xs text-gray-500">Approval → Disbursal</p>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <p className="font-semibold text-gray-700">{formatPercentage(reportData.volume?.disbursed, reportData.volume?.login)}</p>
                  <p className="text-xs text-gray-500">Logged → Disbursal</p>
                </div>
                <div className="bg-green-50 rounded p-2">
                  <p className="font-semibold text-green-700">{formatPercentage(reportData.volume?.disbursed, reportData.volume?.total_files)}</p>
                  <p className="text-xs text-gray-500">Lead → Disbursal (E2E)</p>
                </div>
              </div>

              {/* Definitions */}
              <div className="mt-4 text-xs text-gray-500 border-t border-gray-100 pt-3">
                <p><b>In Progress:</b> Contacted to Query/Hold | <b>Login:</b> Login + Approved + Declined + Not Disbursed | <b>Interim Rej:</b> FI Negative + Declined + Not Interested</p>
                <p><b>Final Rej:</b> Rejected + Not Eligible + Not Login + Not Disbursed | <b>Pipeline:</b> Eligible Amt where Login=Yes, excl. disbursed/rejected</p>
              </div>
            </div>

            {/* 2. Team Productivity */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Users size={18} className="text-blue-600" />
                2. Team Productivity Metrics
              </h3>
              
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{reportData.team?.active_gps || 0}</p>
                  <p className="text-xs text-gray-500">Active Growth Partners</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{reportData.team?.files_per_gp?.toFixed(1) || 0}</p>
                  <p className="text-xs text-gray-500">Files per GP</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{reportData.team?.disbursals_per_gp?.toFixed(1) || 0}</p>
                  <p className="text-xs text-gray-500">Disbursals per GP</p>
                </div>
              </div>

              {/* GP Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-y border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Growth Partner</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Files</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Logins</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Approvals</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Disbursals</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Conversion %</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Disbursal Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reportData.team?.gps?.map((gp, idx) => (
                      <tr key={gp.id || idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{gp.name}</td>
                        <td className="px-3 py-2 text-center">{gp.files || 0}</td>
                        <td className="px-3 py-2 text-center text-blue-600">{gp.logins || 0}</td>
                        <td className="px-3 py-2 text-center text-green-600">{gp.approvals || 0}</td>
                        <td className="px-3 py-2 text-center text-emerald-600">{gp.disbursals || 0}</td>
                        <td className="px-3 py-2 text-center">{gp.conversion?.toFixed(1) || 0}%</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">{formatCurrency(gp.disbursed_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Bank Performance */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 size={18} className="text-blue-600" />
                3. Bank / Lender Performance
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-y border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Bank</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Logins</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Approvals</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">Disbursals</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Disbursal Amt</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">TAT: Lead-Login</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">TAT: Login-Approval</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700">TAT: Approval-Disbursal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reportData.banks?.map((bank, idx) => (
                      <tr key={bank.name || idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{bank.name}</td>
                        <td className="px-3 py-2 text-center text-blue-600">{bank.logins || 0}</td>
                        <td className="px-3 py-2 text-center text-green-600">{bank.approvals || 0}</td>
                        <td className="px-3 py-2 text-center text-emerald-600">{bank.disbursals || 0}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">{bank.disbursed_amount ? formatCurrency(bank.disbursed_amount) : '-'}</td>
                        <td className="px-3 py-2 text-center text-xs">
                          {bank.tat_lead_login ? `${bank.tat_lead_login.mode}d | ${bank.tat_lead_login.low}d-${bank.tat_lead_login.high}d` : '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {bank.tat_login_approval ? `${bank.tat_login_approval.mode}d | ${bank.tat_login_approval.low}d-${bank.tat_login_approval.high}d` : '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {bank.tat_approval_disbursal ? `${bank.tat_approval_disbursal.mode}d | ${bank.tat_approval_disbursal.low}d-${bank.tat_approval_disbursal.high}d` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Rejection Analysis */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <AlertCircle size={18} className="text-red-600" />
                4. Rejection & Drop Analysis
              </h3>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{reportData.rejection?.total || 0}</p>
                  <p className="text-xs text-gray-500">Total Rejections</p>
                </div>
                <div className="border border-orange-200 bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-600">{reportData.rejection?.login_approval_rate?.toFixed(1) || 0}%</p>
                  <p className="text-xs text-gray-500">Login-Approval Rejection %</p>
                </div>
              </div>

              {reportData.rejection?.top_reasons?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-y border-gray-200">
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Reason</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-700">Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {reportData.rejection?.top_reasons?.map((reason, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-900">{reason.reason || 'Unknown'}</td>
                          <td className="px-3 py-2 text-center text-red-600 font-medium">{reason.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SalesOpsReport;
