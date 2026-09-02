import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Users, Filter, FileText, Loader2, Printer } from 'lucide-react';
import api from '../../../services/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const GrowthPartnerReport = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportData, setReportData] = useState(null);
  
  // Filters
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // First day of current month
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedManager, setSelectedManager] = useState('');
  const [managers, setManagers] = useState([]);

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

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('start_date', fromDate);
      if (toDate) params.append('end_date', toDate);
      if (selectedManager) params.append('assigned_to', selectedManager);
      
      const response = await api.get(`/files/reports/growth-partner?${params.toString()}`);
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
    
    const doc = new jsPDF('landscape');
    doc.setFontSize(16);
    doc.text('BANKEZEE - GROWTH PARTNER PERFORMANCE', 14, 15);
    doc.setFontSize(10);
    doc.text(`${fromDate} to ${toDate} | ${reportData.gps?.length || 0} Growth Partners`, 14, 22);
    
    // Summary
    const summaryData = [
      [reportData.summary?.total_gps || 0, reportData.summary?.files_generated || 0, reportData.summary?.login || 0, reportData.summary?.approved || 0, reportData.summary?.disbursed || 0, formatCurrency(reportData.summary?.total_disbursed_amount || 0)]
    ];
    
    autoTable(doc, {
      startY: 28,
      head: [['Growth Partners', 'Files Gen.', 'Logged In', 'Approved', 'Disbursed', 'Total Disbursed']],
      body: summaryData,
      theme: 'grid',
      headStyles: { fillColor: [34, 197, 94] },
    });
    
    // GP Details Table
    const gpData = reportData.gps?.map(gp => [
      gp.name,
      gp.files_generated || 0,
      gp.in_progress || 0,
      `${gp.login_current || 0} / ${gp.login_spillover || 0}`,
      gp.approved || 0,
      `${gp.disbursed_current || 0} / ${gp.disbursed_spillover || 0}`,
      `${gp.interim_current || 0} / ${gp.interim_spillover || 0}`,
      `${gp.final_current || 0} / ${gp.final_spillover || 0}`,
      formatCurrency(gp.disbursed_amount || 0)
    ]) || [];
    
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      head: [['Growth Partner', 'Files Gen.', 'In Progress', 'Login (C/S)', 'Approved', 'Disbursed (C/S)', 'Interim Rej (C/S)', 'Final Rej (C/S)', 'Disb. ₹']],
      body: gpData,
      theme: 'grid',
      styles: { fontSize: 8 },
    });
    
    // Legend
    doc.setFontSize(8);
    doc.text('C = Current (created in period)  |  S = Spillover (created before, activity in period)  |  Files Gen. = Leads created in date range', 14, doc.lastAutoTable.finalY + 8);
    
    doc.save('growth_partner_performance.pdf');
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

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white" data-testid="growth-partner-report">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10 print:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-lg font-bold text-gray-900">Growth Partner Performance Report</h1>
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                data-testid="from-date"
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-sm text-gray-600 mb-1">To</label>
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                data-testid="to-date"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm text-gray-600 mb-1">Manager</label>
              <select 
                value={selectedManager} 
                onChange={(e) => setSelectedManager(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
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
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 font-medium"
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
            <Users size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600 font-medium">Select date range and click "Generate Report"</p>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Loader2 size={48} className="mx-auto text-green-600 animate-spin mb-4" />
            <p className="text-gray-600">Generating report...</p>
          </div>
        ) : reportData ? (
          <>
            {/* Report Header for Print */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-0 print:shadow-none">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">BANKEZEE - GROWTH PARTNER PERFORMANCE</h2>
                <p className="text-gray-500">{fromDate} to {toDate} | {reportData.gps?.length || 0} Growth Partners</p>
              </div>
              
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{reportData.summary?.total_gps || 0}</p>
                  <p className="text-xs text-gray-500">Growth Partners</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-700">{reportData.summary?.files_generated || 0}</p>
                  <p className="text-xs text-gray-500">Files Generated</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{reportData.summary?.login || 0}</p>
                  <p className="text-xs text-gray-500">Logged In</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{reportData.summary?.approved || 0}</p>
                  <p className="text-xs text-gray-500">Approved</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{reportData.summary?.disbursed || 0}</p>
                  <p className="text-xs text-gray-500">Disbursed</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(reportData.summary?.total_disbursed_amount)}</p>
                  <p className="text-xs text-gray-500">Total Disbursed</p>
                </div>
              </div>

              {/* GP Performance Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-y border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700" rowSpan={2}>Growth Partner</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700" rowSpan={2}>Files<br/>Gen.</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-amber-50" colSpan={1}>In Progress (Created Date)</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-blue-50" colSpan={2}>Login</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-green-50" colSpan={1}>Approved</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-emerald-50" colSpan={2}>Disbursed</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-orange-50" colSpan={2}>Interim Rej.</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-700 bg-red-50" colSpan={2}>Final Rej.</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700" rowSpan={2}>Disb. ₹</th>
                    </tr>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-2 py-1 text-center text-xs text-gray-500 bg-amber-50">S.Elg</th>
                      <th className="px-2 py-1 text-center text-xs text-blue-600 bg-blue-50">C</th>
                      <th className="px-2 py-1 text-center text-xs text-blue-400 bg-blue-50">S</th>
                      <th className="px-2 py-1 text-center text-xs text-green-600 bg-green-50">C</th>
                      <th className="px-2 py-1 text-center text-xs text-emerald-600 bg-emerald-50">C</th>
                      <th className="px-2 py-1 text-center text-xs text-emerald-400 bg-emerald-50">S</th>
                      <th className="px-2 py-1 text-center text-xs text-orange-600 bg-orange-50">C</th>
                      <th className="px-2 py-1 text-center text-xs text-orange-400 bg-orange-50">S</th>
                      <th className="px-2 py-1 text-center text-xs text-red-600 bg-red-50">C</th>
                      <th className="px-2 py-1 text-center text-xs text-red-400 bg-red-50">S</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reportData.gps?.map((gp, idx) => (
                      <tr key={gp.id || idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{gp.name}</p>
                          <p className="text-xs text-gray-400">{gp.agent_id || ''}</p>
                        </td>
                        <td className="px-3 py-2 text-center">{gp.files_generated || '-'}</td>
                        <td className="px-3 py-2 text-center bg-amber-50/50">{gp.in_progress || '-'}</td>
                        <td className="px-3 py-2 text-center text-blue-600 bg-blue-50/50">{gp.login_current || '-'}</td>
                        <td className="px-3 py-2 text-center text-blue-400 bg-blue-50/50">{gp.login_spillover || '-'}</td>
                        <td className="px-3 py-2 text-center text-green-600 bg-green-50/50">{gp.approved || '-'}</td>
                        <td className="px-3 py-2 text-center text-emerald-600 bg-emerald-50/50">{gp.disbursed_current || '-'}</td>
                        <td className="px-3 py-2 text-center text-emerald-400 bg-emerald-50/50">{gp.disbursed_spillover || '-'}</td>
                        <td className="px-3 py-2 text-center text-orange-600 bg-orange-50/50">{gp.interim_current || '-'}</td>
                        <td className="px-3 py-2 text-center text-orange-400 bg-orange-50/50">{gp.interim_spillover || '-'}</td>
                        <td className="px-3 py-2 text-center text-red-600 bg-red-50/50">{gp.final_current || '-'}</td>
                        <td className="px-3 py-2 text-center text-red-400 bg-red-50/50">{gp.final_spillover || '-'}</td>
                        <td className="px-3 py-2 text-right font-medium text-green-600">{gp.disbursed_amount ? formatCurrency(gp.disbursed_amount) : '-'}</td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr className="bg-gray-100 font-semibold">
                      <td className="px-3 py-2">TOTAL</td>
                      <td className="px-3 py-2 text-center">{reportData.summary?.files_generated || 0}</td>
                      <td className="px-3 py-2 text-center">{reportData.summary?.in_progress || 0}</td>
                      <td className="px-3 py-2 text-center text-blue-600">{reportData.summary?.login_current || 0}</td>
                      <td className="px-3 py-2 text-center text-blue-400">{reportData.summary?.login_spillover || 0}</td>
                      <td className="px-3 py-2 text-center text-green-600">{reportData.summary?.approved || 0}</td>
                      <td className="px-3 py-2 text-center text-emerald-600">{reportData.summary?.disbursed_current || 0}</td>
                      <td className="px-3 py-2 text-center text-emerald-400">{reportData.summary?.disbursed_spillover || 0}</td>
                      <td className="px-3 py-2 text-center text-orange-600">{reportData.summary?.interim_current || 0}</td>
                      <td className="px-3 py-2 text-center text-orange-400">{reportData.summary?.interim_spillover || 0}</td>
                      <td className="px-3 py-2 text-center text-red-600">{reportData.summary?.final_current || 0}</td>
                      <td className="px-3 py-2 text-center text-red-400">{reportData.summary?.final_spillover || 0}</td>
                      <td className="px-3 py-2 text-right text-green-600">{formatCurrency(reportData.summary?.total_disbursed_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500 space-y-1">
                <p><span className="font-medium text-blue-600">C</span> = Current (created in period) &nbsp;&nbsp; <span className="font-medium text-blue-400">S</span> = Spillover (created before, activity in period) &nbsp;&nbsp; <span className="font-medium">Files Gen.</span> = Leads created in date range</p>
                <p><span className="font-medium text-orange-600">Interim Rej:</span> FI Negative + Declined + Cust. Not Interested/Supporting &nbsp;&nbsp; <span className="font-medium text-red-600">Final Rej:</span> Rejected + Not Eligible + Not Login + Not Disbursed</p>
                <p><span className="font-medium">In Progress:</span> Contacted to Query/Hold (created date) &nbsp;&nbsp; <span className="font-medium">Login:</span> Login + Approved + Declined + Not Disbursed + Rejected-after-login</p>
                <p><span className="font-medium">Pipeline ₹:</span> Eligible Amt where Login=Yes & App ID filled, excl. disbursed/declined/rejected</p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default GrowthPartnerReport;
