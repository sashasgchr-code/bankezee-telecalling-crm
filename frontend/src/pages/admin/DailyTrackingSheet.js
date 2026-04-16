import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, Download, Calendar, User, Award, 
  Phone, PhoneForwarded, Users, Clock, Loader2,
  ChevronLeft, ChevronRight, Printer, DownloadCloud
} from 'lucide-react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const DailyTrackingSheet = () => {
  const [data, setData] = useState([]);
  const [telecallers, setTelecallers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);

  // Fetch telecallers list
  useEffect(() => {
    const fetchTelecallers = async () => {
      try {
        const response = await api.get('/users');
        const tcs = response.data.filter(u => u.role === 'telecaller');
        setTelecallers(tcs);
        if (tcs.length > 0 && !selectedUser) {
          setSelectedUser(tcs[0].id);
        }
      } catch (error) {
        console.error('Error fetching telecallers:', error);
      }
    };
    fetchTelecallers();
  }, []);

  // Fetch tracking data for selected user
  const fetchData = useCallback(async () => {
    if (!selectedUser) return;
    
    setIsLoading(true);
    try {
      let url = `/reports/daily-tracking-sheet?user_id=${selectedUser}`;
      
      if (useCustomRange && startDate && endDate) {
        url += `&start_date=${startDate}&end_date=${endDate}`;
      } else {
        url += `&month=${selectedMonth}&year=${selectedYear}`;
      }
      
      const response = await api.get(url);
      setData(response.data);
    } catch (error) {
      console.error('Error fetching tracking data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedUser, selectedMonth, selectedYear, startDate, endDate, useCustomRange]);

  // Fetch ALL agents data for bulk download
  const fetchAllAgentsData = async () => {
    setIsDownloadingAll(true);
    try {
      let url = `/reports/daily-tracking-sheet`;
      
      if (useCustomRange && startDate && endDate) {
        url += `?start_date=${startDate}&end_date=${endDate}`;
      } else {
        url += `?month=${selectedMonth}&year=${selectedYear}`;
      }
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching all agents data:', error);
      return [];
    } finally {
      setIsDownloadingAll(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Navigate months
  const prevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const nextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  // Format talk time
  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  // Get month name
  const getMonthName = (month, year) => {
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  // Export single agent to CSV
  const downloadCSV = (userData) => {
    const headers = ['Date', 'Day', 'Start', 'End', 'Calls', 'Connected', 'Leads', 'Files', 'Talk Time'];
    
    const rows = userData.daily_data.map(d => [
      d.date,
      d.day,
      d.start_time,
      d.end_time,
      d.calls,
      d.connected,
      d.leads,
      d.files,
      d.talk_time_formatted
    ]);

    // Add totals row
    rows.push([
      'TOTAL', '', '', '',
      userData.totals.calls,
      userData.totals.connected,
      userData.totals.leads,
      userData.totals.files,
      userData.totals.talk_time_formatted
    ]);

    const csvContent = [
      `MIT: ${userData.user_name}`,
      `Month: ${userData.month}`,
      `File Goal: ___________`,
      `Achieved: ${userData.achieved_files}`,
      '',
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily_tracking_${userData.user_name}_${userData.month.replace(' ', '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Export ALL agents to single CSV
  const downloadAllAgentsCSV = async () => {
    const allData = await fetchAllAgentsData();
    if (!allData || allData.length === 0) return;

    const monthName = getMonthName(selectedMonth, selectedYear);
    let csvContent = `ALL AGENTS DAILY TRACKING SHEET - ${monthName}\n\n`;

    for (const userData of allData) {
      csvContent += `\n${'='.repeat(80)}\n`;
      csvContent += `MIT: ${userData.user_name}\n`;
      csvContent += `Month: ${userData.month}\n`;
      csvContent += `File Goal: ___________  |  Achieved: ${userData.achieved_files}\n\n`;

      const headers = ['Date', 'Day', 'Start', 'End', 'Calls', 'Connected', 'Leads', 'Files', 'Talk Time'];
      csvContent += headers.join(',') + '\n';

      for (const d of userData.daily_data) {
        csvContent += [
          d.date, d.day, d.start_time, d.end_time, d.calls, d.connected,
          d.leads, d.files, d.talk_time_formatted
        ].join(',') + '\n';
      }

      csvContent += [
        'TOTAL', '', '', '',
        userData.totals.calls, userData.totals.connected,
        userData.totals.leads, userData.totals.files, userData.totals.talk_time_formatted
      ].join(',') + '\n';
    }

    // Add summary section
    csvContent += `\n${'='.repeat(80)}\n`;
    csvContent += `SUMMARY - ALL AGENTS\n`;
    csvContent += 'Agent,Calls,Connected,Leads,Files,Talk Time\n';
    
    let grandTotals = { calls: 0, connected: 0, leads: 0, files: 0, talk_time: 0 };
    for (const userData of allData) {
      csvContent += [
        userData.user_name,
        userData.totals.calls,
        userData.totals.connected,
        userData.totals.leads,
        userData.totals.files,
        userData.totals.talk_time_formatted
      ].join(',') + '\n';
      
      grandTotals.calls += userData.totals.calls;
      grandTotals.connected += userData.totals.connected;
      grandTotals.leads += userData.totals.leads;
      grandTotals.files += userData.totals.files;
      grandTotals.talk_time += userData.totals.talk_time_seconds || 0;
    }
    
    csvContent += [
      'GRAND TOTAL',
      grandTotals.calls,
      grandTotals.connected,
      grandTotals.leads,
      grandTotals.files,
      formatTime(grandTotals.talk_time)
    ].join(',') + '\n';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_agents_tracking_${monthName.replace(' ', '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Export single agent to PDF
  const downloadPDF = (userData) => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('MIT DAILY TRACKING SHEET', doc.internal.pageSize.width / 2, 15, { align: 'center' });

    // Header info
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    
    const headerY = 25;
    doc.text(`MIT: ${userData.user_name}`, 14, headerY);
    doc.text(`MONTH: ${userData.month}`, 100, headerY);
    doc.text(`FILE GOAL: __________`, 14, headerY + 7);
    doc.text(`ACHIEVED: ${userData.achieved_files}`, 100, headerY + 7);

    // Table
    const tableData = userData.daily_data.map(d => [
      d.date,
      d.day,
      d.start_time,
      d.end_time,
      d.calls.toString(),
      d.connected.toString(),
      d.leads.toString(),
      d.files.toString(),
      d.talk_time_formatted
    ]);

    // Add totals row
    tableData.push([
      'TOTAL', '', '', '',
      userData.totals.calls.toString(),
      userData.totals.connected.toString(),
      userData.totals.leads.toString(),
      userData.totals.files.toString(),
      userData.totals.talk_time_formatted
    ]);

    doc.autoTable({
      head: [['DATE', 'DAY', 'START', 'END', 'CALLS', 'CONNECTED', 'LEADS', 'FILES', 'TALK TIME']],
      body: tableData,
      startY: 38,
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 3,
        halign: 'center'
      },
      headStyles: {
        fillColor: [200, 220, 255],
        textColor: [0, 0, 0],
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 25 },
        1: { cellWidth: 18 },
        2: { cellWidth: 20 },
        3: { cellWidth: 20 },
        4: { cellWidth: 20 },
        5: { cellWidth: 28 },
        6: { cellWidth: 20 },
        7: { cellWidth: 20 },
        8: { cellWidth: 25 }
      },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      }
    });

    doc.save(`daily_tracking_${userData.user_name}_${userData.month.replace(' ', '_')}.pdf`);
  };

  // Export ALL agents to single PDF
  const downloadAllAgentsPDF = async () => {
    const allData = await fetchAllAgentsData();
    if (!allData || allData.length === 0) return;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const monthName = getMonthName(selectedMonth, selectedYear);
    let isFirstPage = true;

    for (const userData of allData) {
      if (!isFirstPage) {
        doc.addPage();
      }
      isFirstPage = false;

      // Title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('MIT DAILY TRACKING SHEET', doc.internal.pageSize.width / 2, 15, { align: 'center' });

      // Header info
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      
      const headerY = 23;
      doc.text(`MIT: ${userData.user_name}`, 14, headerY);
      doc.text(`MONTH: ${userData.month}`, 100, headerY);
      doc.text(`FILE GOAL: __________`, 14, headerY + 6);
      doc.text(`ACHIEVED: ${userData.achieved_files}`, 100, headerY + 6);

      // Table
      const tableData = userData.daily_data.map(d => [
        d.date,
        d.day,
        d.start_time,
        d.end_time,
        d.calls.toString(),
        d.connected.toString(),
        d.leads.toString(),
        d.files.toString(),
        d.talk_time_formatted
      ]);

      tableData.push([
        'TOTAL', '', '', '',
        userData.totals.calls.toString(),
        userData.totals.connected.toString(),
        userData.totals.leads.toString(),
        userData.totals.files.toString(),
        userData.totals.talk_time_formatted
      ]);

      doc.autoTable({
        head: [['DATE', 'DAY', 'START', 'END', 'CALLS', 'CONN.', 'LEADS', 'FILES', 'TALK TIME']],
        body: tableData,
        startY: 35,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 2,
          halign: 'center'
        },
        headStyles: {
          fillColor: [200, 220, 255],
          textColor: [0, 0, 0],
          fontStyle: 'bold'
        },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [240, 240, 240];
          }
        }
      });
    }

    // Add summary page
    doc.addPage();
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`ALL AGENTS SUMMARY - ${monthName}`, doc.internal.pageSize.width / 2, 20, { align: 'center' });

    const summaryData = allData.map(u => [
      u.user_name,
      u.totals.calls.toString(),
      u.totals.connected.toString(),
      u.totals.leads.toString(),
      u.totals.files.toString(),
      u.totals.talk_time_formatted
    ]);

    // Calculate grand totals
    const grandTotals = allData.reduce((acc, u) => ({
      calls: acc.calls + u.totals.calls,
      connected: acc.connected + u.totals.connected,
      leads: acc.leads + u.totals.leads,
      files: acc.files + u.totals.files,
      talk_time: acc.talk_time + (u.totals.talk_time_seconds || 0)
    }), { calls: 0, connected: 0, leads: 0, files: 0, talk_time: 0 });

    summaryData.push([
      'GRAND TOTAL',
      grandTotals.calls.toString(),
      grandTotals.connected.toString(),
      grandTotals.leads.toString(),
      grandTotals.files.toString(),
      formatTime(grandTotals.talk_time)
    ]);

    doc.autoTable({
      head: [['AGENT', 'CALLS', 'CONNECTED', 'LEADS', 'FILES', 'TALK TIME']],
      body: summaryData,
      startY: 30,
      theme: 'grid',
      styles: {
        fontSize: 10,
        cellPadding: 4,
        halign: 'center'
      },
      headStyles: {
        fillColor: [100, 150, 200],
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 50 }
      },
      didParseCell: (data) => {
        if (data.row.index === summaryData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 220, 220];
        }
      }
    });

    doc.save(`all_agents_tracking_${monthName.replace(' ', '_')}.pdf`);
  };

  // Current user data
  const currentUserData = data.find(d => d.user_id === selectedUser) || null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText size={24} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Tracking Sheet</h1>
            <p className="text-sm text-gray-500">MIT Performance Tracking</p>
          </div>
        </div>
        
        {/* Download All Buttons */}
        <div className="flex gap-2">
          <button
            onClick={downloadAllAgentsCSV}
            disabled={isDownloadingAll}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            {isDownloadingAll ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
            All Agents CSV
          </button>
          <button
            onClick={downloadAllAgentsPDF}
            disabled={isDownloadingAll}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium disabled:opacity-50"
          >
            {isDownloadingAll ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
            All Agents PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Agent Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User size={14} className="inline mr-1" />
              Select Agent
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="input-field w-full"
            >
              <option value="">All Agents</option>
              {telecallers.map(tc => (
                <option key={tc.id} value={tc.id}>{tc.name}</option>
              ))}
            </select>
          </div>

          {/* Date Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar size={14} className="inline mr-1" />
              Date Range Type
            </label>
            <select
              value={useCustomRange ? 'custom' : 'month'}
              onChange={(e) => setUseCustomRange(e.target.value === 'custom')}
              className="input-field w-full"
            >
              <option value="month">By Month</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {/* Month/Year or Custom Dates */}
          {!useCustomRange ? (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={prevMonth}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex-1 text-center font-medium text-gray-800 py-2 bg-gray-50 rounded-lg">
                  {getMonthName(selectedMonth, selectedYear)}
                </div>
                <button
                  onClick={nextMonth}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-field w-full"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : currentUserData ? (
        <div className="card overflow-hidden">
          {/* Sheet Header */}
          <div className="bg-gradient-to-r from-gray-100 to-gray-200 p-4">
            <h2 className="text-xl font-bold text-center text-gray-800 mb-4">
              MIT DAILY TRACKING SHEET
            </h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="text-xs text-gray-500 font-medium">MIT:</div>
                <div className="text-lg font-bold text-gray-800">{currentUserData.user_name}</div>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="text-xs text-gray-500 font-medium">MONTH:</div>
                <div className="text-lg font-bold text-gray-800">{currentUserData.month}</div>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="text-xs text-gray-500 font-medium">FILE GOAL:</div>
                <div className="text-lg font-bold text-gray-400 border-b-2 border-dashed border-gray-300 min-w-[60px]">&nbsp;</div>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="text-xs text-gray-500 font-medium">ACHIEVED:</div>
                <div className="flex items-center gap-2">
                  <Award size={18} className="text-green-500" />
                  <span className="text-lg font-bold text-green-600">{currentUserData.achieved_files}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Export Buttons for single agent */}
          <div className="flex justify-end gap-2 p-3 bg-gray-50 border-b">
            <button
              onClick={() => downloadCSV(currentUserData)}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium"
            >
              <Download size={16} />
              CSV
            </button>
            <button
              onClick={() => downloadPDF(currentUserData)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
            >
              <Printer size={16} />
              PDF
            </button>
          </div>

          {/* Data Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-100">
                  <th className="py-3 px-4 text-left font-bold text-gray-700 border-b-2 border-blue-200">DATE</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">DAY</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">START</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">END</th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">
                    <div className="flex items-center justify-center gap-1">
                      <Phone size={14} />
                      CALLS
                    </div>
                  </th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">
                    <div className="flex items-center justify-center gap-1">
                      <PhoneForwarded size={14} />
                      CONNECTED
                    </div>
                  </th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">
                    <div className="flex items-center justify-center gap-1">
                      <Users size={14} />
                      LEADS
                    </div>
                  </th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">
                    <div className="flex items-center justify-center gap-1">
                      <FileText size={14} />
                      FILES
                    </div>
                  </th>
                  <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200">
                    <div className="flex items-center justify-center gap-1">
                      <Clock size={14} />
                      TALK TIME
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentUserData.daily_data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      No activity data for this period
                    </td>
                  </tr>
                ) : (
                  <>
                    {currentUserData.daily_data.map((row, idx) => (
                      <tr 
                        key={row.date} 
                        className={`border-b border-gray-100 hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      >
                        <td className="py-2.5 px-4 font-medium text-gray-800">{row.date}</td>
                        <td className="py-2.5 px-3 text-center text-gray-600">{row.day}</td>
                        <td className="py-2.5 px-3 text-center text-gray-600">{row.start_time}</td>
                        <td className="py-2.5 px-3 text-center text-gray-600">{row.end_time}</td>
                        <td className="py-2.5 px-3 text-center font-medium text-gray-800">{row.calls}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-medium ${row.connected > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {row.connected}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-medium ${row.leads > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                            {row.leads}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`font-bold ${row.files > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {row.files}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-gray-600">{row.talk_time_formatted}</td>
                      </tr>
                    ))}
                    
                    {/* Totals Row */}
                    <tr className="bg-gray-200 font-bold border-t-2 border-gray-300">
                      <td className="py-3 px-4 text-gray-800">TOTAL</td>
                      <td className="py-3 px-3 text-center">-</td>
                      <td className="py-3 px-3 text-center">-</td>
                      <td className="py-3 px-3 text-center">-</td>
                      <td className="py-3 px-3 text-center text-gray-800">{currentUserData.totals.calls}</td>
                      <td className="py-3 px-3 text-center text-green-700">{currentUserData.totals.connected}</td>
                      <td className="py-3 px-3 text-center text-blue-700">{currentUserData.totals.leads}</td>
                      <td className="py-3 px-3 text-center text-green-700">{currentUserData.totals.files}</td>
                      <td className="py-3 px-3 text-center text-gray-800">{currentUserData.totals.talk_time_formatted}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-gray-50">
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-gray-800">{currentUserData.totals.calls}</div>
              <div className="text-xs text-gray-500">Total Calls</div>
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-green-600">{currentUserData.totals.connected}</div>
              <div className="text-xs text-gray-500">Connected</div>
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-blue-600">{currentUserData.totals.leads}</div>
              <div className="text-xs text-gray-500">Leads</div>
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-green-600">{currentUserData.totals.files}</div>
              <div className="text-xs text-gray-500">Files</div>
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-purple-600">{currentUserData.totals.talk_time_formatted}</div>
              <div className="text-xs text-gray-500">Talk Time</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-gray-500">
          Select an agent to view their tracking sheet
        </div>
      )}
    </div>
  );
};

export default DailyTrackingSheet;
