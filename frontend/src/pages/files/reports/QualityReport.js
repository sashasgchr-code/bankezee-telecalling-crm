import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Star, Filter, FileText, Loader2, Printer } from 'lucide-react';
import api from '../../../services/api';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const QualityReport = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [reportData, setReportData] = useState(null);
  
  // Filters
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedManager, setSelectedManager] = useState('');
  const [selectedLoanType, setSelectedLoanType] = useState('');
  const [managers, setManagers] = useState([]);
  const [loanTypes, setLoanTypes] = useState([]);

  useEffect(() => {
    fetchManagers();
    fetchLoanTypes();
  }, []);

  const fetchManagers = async () => {
    try {
      const response = await api.get('/users?role=telecaller');
      setManagers(response.data.users || response.data || []);
    } catch (error) {
      console.error('Failed to fetch managers:', error);
    }
  };

  const fetchLoanTypes = async () => {
    // Get unique loan types from files
    try {
      const response = await api.get('/files/dashboard/stats');
      // loans_by_type is an object like {loan_type: count}, get the keys
      const loansData = response.data?.loans_by_type || {};
      const types = Array.isArray(loansData) 
        ? loansData.map(l => l.type) 
        : Object.keys(loansData);
      setLoanTypes([...new Set(types)]);
    } catch (error) {
      console.error('Failed to fetch loan types:', error);
    }
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('start_date', fromDate);
      if (toDate) params.append('end_date', toDate);
      if (selectedManager) params.append('assigned_to', selectedManager);
      if (selectedLoanType) params.append('loan_type', selectedLoanType);
      
      const response = await api.get(`/files/reports/quality?${params.toString()}`);
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
    doc.setFontSize(16);
    doc.text('BANKEZEE - QUALITY REPORT', 14, 15);
    doc.setFontSize(10);
    doc.text(`${fromDate} to ${toDate} | ${reportData.total_files || 0} total leads`, 14, 22);
    
    // Star Distribution
    doc.setFontSize(12);
    doc.text('Overall Star Distribution', 14, 34);
    
    const starData = [
      ['5 Star', reportData.star_distribution?.['5'] || 0, `${((reportData.star_distribution?.['5'] || 0) / (reportData.total_files || 1) * 100).toFixed(1)}%`],
      ['4 Star', reportData.star_distribution?.['4'] || 0, `${((reportData.star_distribution?.['4'] || 0) / (reportData.total_files || 1) * 100).toFixed(1)}%`],
      ['3 Star', reportData.star_distribution?.['3'] || 0, `${((reportData.star_distribution?.['3'] || 0) / (reportData.total_files || 1) * 100).toFixed(1)}%`],
      ['2 Star', reportData.star_distribution?.['2'] || 0, `${((reportData.star_distribution?.['2'] || 0) / (reportData.total_files || 1) * 100).toFixed(1)}%`],
      ['1 Star', reportData.star_distribution?.['1'] || 0, `${((reportData.star_distribution?.['1'] || 0) / (reportData.total_files || 1) * 100).toFixed(1)}%`],
    ];
    
    autoTable(doc, {
      startY: 38,
      head: [['Rating', 'Count', 'Percentage']],
      body: starData,
      theme: 'grid',
    });
    
    // GP Quality Breakdown
    doc.setFontSize(12);
    doc.text('Growth Partner Quality Breakdown', 14, doc.lastAutoTable.finalY + 12);
    
    const gpData = reportData.by_growth_partner?.map((gp, idx) => [
      idx + 1,
      gp.name,
      gp.total_files || 0,
      gp.star_5 || '-',
      gp.star_4 || '-',
      gp.star_3 || '-',
      gp.star_2 || '-',
      gp.star_1 || '-',
      gp.avg_score?.toFixed(0) || '-'
    ]) || [];
    
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      head: [['#', 'Growth Partner', 'Total Files', '5 Star', '4 Star', '3 Star', '2 Star', '1 Star', 'Avg Score']],
      body: gpData,
      theme: 'grid',
      styles: { fontSize: 8 },
    });
    
    // Legend
    doc.setFontSize(8);
    doc.text('5 Star: Score 90-100 | 4 Star: Score 75-89 | 3 Star: Score 60-74 | 2 Star: Score 45-59 | 1 Star: Score <45', 14, doc.lastAutoTable.finalY + 8);
    doc.text('Score: Income (25) + CIBIL (25) + CIBIL Issues (15) + FOIR (15) + Company Type (20)', 14, doc.lastAutoTable.finalY + 13);
    
    doc.save('quality_report.pdf');
    toast.success('PDF exported');
  };

  const handlePrint = () => {
    window.print();
  };

  const renderStars = (count, filled = true) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star 
        key={i} 
        size={16} 
        className={i < count ? (filled ? 'text-amber-400 fill-amber-400' : 'text-amber-300 fill-amber-300') : 'text-gray-200'}
      />
    ));
  };

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white" data-testid="quality-report">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10 print:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-lg font-bold text-gray-900">Quality Report</h1>
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
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-sm text-gray-600 mb-1">To</label>
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
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
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm text-gray-600 mb-1">Loan Type</label>
              <select 
                value={selectedLoanType} 
                onChange={(e) => setSelectedLoanType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">All Loan Types</option>
                {loanTypes.map(lt => (
                  <option key={lt} value={lt}>{lt}</option>
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
            <Star size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600 font-medium">Select filters and click "Generate Report"</p>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Loader2 size={48} className="mx-auto text-green-600 animate-spin mb-4" />
            <p className="text-gray-600">Generating report...</p>
          </div>
        ) : reportData ? (
          <>
            {/* Report Content */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 print:border-0 print:shadow-none">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">BANKEZEE - QUALITY REPORT</h2>
                <p className="text-gray-500">{fromDate} to {toDate}</p>
                <p className="text-gray-400 text-sm">{reportData.total_files || 0} total leads</p>
              </div>

              {/* Star Distribution */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-4">Overall Star Distribution</h3>
                <div className="grid grid-cols-5 gap-3">
                  {[5, 4, 3, 2, 1].map(star => {
                    const count = reportData.star_distribution?.[star] || 0;
                    const percentage = reportData.total_files ? ((count / reportData.total_files) * 100).toFixed(1) : 0;
                    return (
                      <div key={star} className="bg-gray-50 rounded-lg p-3 text-center border border-gray-100">
                        <div className="flex justify-center mb-1">{renderStars(star)}</div>
                        <p className="text-2xl font-bold text-gray-900">{count}</p>
                        <p className="text-xs text-gray-500">{percentage}%</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* GP Quality Breakdown Table */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">Growth Partner Quality Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-y border-gray-200">
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">#</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Growth Partner</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-700">Total Files</th>
                        <th className="px-3 py-2 text-center font-semibold text-amber-600 bg-amber-50">
                          <div className="flex justify-center">{renderStars(5)}</div>
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-amber-500 bg-amber-50/70">
                          <div className="flex justify-center">{renderStars(4)}</div>
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-amber-400 bg-amber-50/50">
                          <div className="flex justify-center">{renderStars(3)}</div>
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-amber-300 bg-amber-50/30">
                          <div className="flex justify-center">{renderStars(2, false)}</div>
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-red-400 bg-red-50/50">
                          <div className="flex justify-center">{renderStars(1, false)}</div>
                        </th>
                        <th className="px-3 py-2 text-center font-semibold text-green-600">Avg Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {reportData.by_growth_partner?.map((gp, idx) => (
                        <tr key={gp.id || idx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{gp.name}</td>
                          <td className="px-3 py-2 text-center">{gp.total_files || 0}</td>
                          <td className="px-3 py-2 text-center text-amber-600 bg-amber-50/30">{gp.star_5 || '-'}</td>
                          <td className="px-3 py-2 text-center text-amber-500 bg-amber-50/20">{gp.star_4 || '-'}</td>
                          <td className="px-3 py-2 text-center text-amber-400">{gp.star_3 || '-'}</td>
                          <td className="px-3 py-2 text-center text-amber-300">{gp.star_2 || '-'}</td>
                          <td className="px-3 py-2 text-center text-red-400">{gp.star_1 || '-'}</td>
                          <td className="px-3 py-2 text-center font-semibold text-green-600">{gp.avg_score?.toFixed(0) || '-'}</td>
                        </tr>
                      ))}
                      {/* Total Row */}
                      <tr className="bg-gray-100 font-semibold">
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2">TOTAL</td>
                        <td className="px-3 py-2 text-center">{reportData.total_files || 0}</td>
                        <td className="px-3 py-2 text-center text-amber-600">{reportData.star_distribution?.['5'] || 0}</td>
                        <td className="px-3 py-2 text-center text-amber-500">{reportData.star_distribution?.['4'] || 0}</td>
                        <td className="px-3 py-2 text-center text-amber-400">{reportData.star_distribution?.['3'] || 0}</td>
                        <td className="px-3 py-2 text-center text-amber-300">{reportData.star_distribution?.['2'] || 0}</td>
                        <td className="px-3 py-2 text-center text-red-400">{reportData.star_distribution?.['1'] || 0}</td>
                        <td className="px-3 py-2 text-center text-green-600">{reportData.avg_score?.toFixed(0) || '-'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Legend */}
              <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500 space-y-1">
                <p><span className="font-medium text-amber-600">5 Star:</span> Score 90-100 &nbsp;&nbsp; <span className="font-medium text-amber-500">4 Star:</span> Score 75-89 &nbsp;&nbsp; <span className="font-medium text-amber-400">3 Star:</span> Score 60-74 &nbsp;&nbsp; <span className="font-medium text-amber-300">2 Star:</span> Score 45-59 &nbsp;&nbsp; <span className="font-medium text-red-400">1 Star:</span> Score &lt;45</p>
                <p><span className="font-medium">Score:</span> Income (25) + CIBIL (25) + CIBIL Issues (15) + FOIR (15) + Company Type (20)</p>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default QualityReport;
