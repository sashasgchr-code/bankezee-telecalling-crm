import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  FileText, Download, Calendar, User, Award, 
  Phone, PhoneForwarded, Users, Clock, Loader2,
  ChevronLeft, ChevronRight, Printer, DownloadCloud,
  TrendingUp, TrendingDown, BarChart3, Target
} from 'lucide-react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis
} from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const [showAnalytics, setShowAnalytics] = useState(true);

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

  // Fetch tracking data
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

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getMonthName = (month, year) => {
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  // Current user data
  const currentUserData = data.find(d => d.user_id === selectedUser) || null;

  // Analytics calculations
  const analytics = useMemo(() => {
    if (!currentUserData || currentUserData.daily_data.length === 0) return null;

    const dailyData = currentUserData.daily_data;

    // Group by day of week
    const byDayOfWeek = DAY_ORDER.map(day => {
      const dayData = dailyData.filter(d => d.day === day);
      const totalCalls = dayData.reduce((sum, d) => sum + d.calls, 0);
      const totalConnected = dayData.reduce((sum, d) => sum + d.connected, 0);
      const totalTalkTime = dayData.reduce((sum, d) => sum + d.talk_time_seconds, 0);
      const totalFiles = dayData.reduce((sum, d) => sum + d.files, 0);
      const totalLeads = dayData.reduce((sum, d) => sum + d.leads, 0);
      const count = dayData.length;
      
      return {
        day,
        calls: totalCalls,
        connected: totalConnected,
        talkTime: totalTalkTime,
        talkTimeFormatted: formatTime(totalTalkTime),
        files: totalFiles,
        leads: totalLeads,
        avgCalls: count > 0 ? Math.round(totalCalls / count) : 0,
        avgConnected: count > 0 ? Math.round(totalConnected / count) : 0,
        avgTalkTime: count > 0 ? Math.round(totalTalkTime / count) : 0,
        daysWorked: count
      };
    }).filter(d => d.daysWorked > 0);

    // Find highest/lowest
    const sortedByCalls = [...byDayOfWeek].sort((a, b) => b.calls - a.calls);
    const sortedByConnected = [...byDayOfWeek].sort((a, b) => b.connected - a.connected);
    const sortedByTalkTime = [...byDayOfWeek].sort((a, b) => b.talkTime - a.talkTime);

    // Overall stats
    const totalCalls = dailyData.reduce((sum, d) => sum + d.calls, 0);
    const totalConnected = dailyData.reduce((sum, d) => sum + d.connected, 0);
    const totalTalkTime = dailyData.reduce((sum, d) => sum + d.talk_time_seconds, 0);
    const totalFiles = dailyData.reduce((sum, d) => sum + d.files, 0);
    const totalLeads = dailyData.reduce((sum, d) => sum + d.leads, 0);
    const daysWorked = dailyData.length;

    // Average per day
    const avgCallsPerDay = daysWorked > 0 ? Math.round(totalCalls / daysWorked) : 0;
    const avgConnectedPerDay = daysWorked > 0 ? Math.round(totalConnected / daysWorked) : 0;
    const avgTalkTimePerDay = daysWorked > 0 ? Math.round(totalTalkTime / daysWorked) : 0;

    // Talk time to files ratio
    const talkTimePerFile = totalFiles > 0 ? Math.round(totalTalkTime / totalFiles) : 0;
    const callsPerFile = totalFiles > 0 ? Math.round(totalCalls / totalFiles) : 0;
    const connectedPerFile = totalFiles > 0 ? Math.round(totalConnected / totalFiles) : 0;

    // Scatter data for correlation
    const scatterData = dailyData.map(d => ({
      talkTime: Math.round(d.talk_time_seconds / 60), // in minutes
      files: d.files,
      date: d.date
    }));

    // Trend data
    const trendData = dailyData.map(d => ({
      date: d.date.slice(5), // MM-DD format
      calls: d.calls,
      connected: d.connected,
      talkTime: Math.round(d.talk_time_seconds / 60),
      files: d.files
    }));

    return {
      byDayOfWeek,
      highest: {
        calls: sortedByCalls[0],
        connected: sortedByConnected[0],
        talkTime: sortedByTalkTime[0]
      },
      lowest: {
        calls: sortedByCalls[sortedByCalls.length - 1],
        connected: sortedByConnected[sortedByConnected.length - 1],
        talkTime: sortedByTalkTime[sortedByTalkTime.length - 1]
      },
      averages: {
        callsPerDay: avgCallsPerDay,
        connectedPerDay: avgConnectedPerDay,
        talkTimePerDay: avgTalkTimePerDay
      },
      totals: {
        calls: totalCalls,
        connected: totalConnected,
        talkTime: totalTalkTime,
        files: totalFiles,
        leads: totalLeads,
        daysWorked
      },
      fileConversion: {
        talkTimePerFile,
        callsPerFile,
        connectedPerFile,
        estimatedFilesPerHour: talkTimePerFile > 0 ? Math.round(3600 / talkTimePerFile * 10) / 10 : 0
      },
      scatterData,
      trendData
    };
  }, [currentUserData]);

  // CSV Export
  const downloadCSV = (userData) => {
    const headers = ['Date', 'Day', 'Start', 'End', 'Calls', 'Connected', 'Leads', 'Files', 'Talk Time'];
    const rows = userData.daily_data.map(d => [
      d.date, d.day, d.start_time, d.end_time, d.calls, d.connected, d.leads, d.files, d.talk_time_formatted
    ]);
    rows.push(['TOTAL', '', '', '', userData.totals.calls, userData.totals.connected, userData.totals.leads, userData.totals.files, userData.totals.talk_time_formatted]);

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
        csvContent += [d.date, d.day, d.start_time, d.end_time, d.calls, d.connected, d.leads, d.files, d.talk_time_formatted].join(',') + '\n';
      }
      csvContent += ['TOTAL', '', '', '', userData.totals.calls, userData.totals.connected, userData.totals.leads, userData.totals.files, userData.totals.talk_time_formatted].join(',') + '\n';
    }

    csvContent += `\n${'='.repeat(80)}\nSUMMARY - ALL AGENTS\n`;
    csvContent += 'Agent,Calls,Connected,Leads,Files,Talk Time\n';
    let grandTotals = { calls: 0, connected: 0, leads: 0, files: 0, talk_time: 0 };
    for (const userData of allData) {
      csvContent += [userData.user_name, userData.totals.calls, userData.totals.connected, userData.totals.leads, userData.totals.files, userData.totals.talk_time_formatted].join(',') + '\n';
      grandTotals.calls += userData.totals.calls;
      grandTotals.connected += userData.totals.connected;
      grandTotals.leads += userData.totals.leads;
      grandTotals.files += userData.totals.files;
      grandTotals.talk_time += userData.totals.talk_time_seconds || 0;
    }
    csvContent += ['GRAND TOTAL', grandTotals.calls, grandTotals.connected, grandTotals.leads, grandTotals.files, formatTime(grandTotals.talk_time)].join(',') + '\n';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_agents_tracking_${monthName.replace(' ', '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // PDF Export
  const downloadPDF = (userData) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('MIT DAILY TRACKING SHEET', doc.internal.pageSize.width / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`MIT: ${userData.user_name}`, 14, 25);
    doc.text(`MONTH: ${userData.month}`, 100, 25);
    doc.text(`FILE GOAL: __________`, 14, 32);
    doc.text(`ACHIEVED: ${userData.achieved_files}`, 100, 32);

    const tableData = userData.daily_data.map(d => [d.date, d.day, d.start_time, d.end_time, d.calls.toString(), d.connected.toString(), d.leads.toString(), d.files.toString(), d.talk_time_formatted]);
    tableData.push(['TOTAL', '', '', '', userData.totals.calls.toString(), userData.totals.connected.toString(), userData.totals.leads.toString(), userData.totals.files.toString(), userData.totals.talk_time_formatted]);

    doc.autoTable({
      head: [['DATE', 'DAY', 'START', 'END', 'CALLS', 'CONNECTED', 'LEADS', 'FILES', 'TALK TIME']],
      body: tableData,
      startY: 38,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3, halign: 'center' },
      headStyles: { fillColor: [200, 220, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [240, 240, 240];
        }
      }
    });

    doc.save(`daily_tracking_${userData.user_name}_${userData.month.replace(' ', '_')}.pdf`);
  };

  const downloadAllAgentsPDF = async () => {
    const allData = await fetchAllAgentsData();
    if (!allData || allData.length === 0) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const monthName = getMonthName(selectedMonth, selectedYear);
    let isFirstPage = true;

    for (const userData of allData) {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('MIT DAILY TRACKING SHEET', doc.internal.pageSize.width / 2, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`MIT: ${userData.user_name}`, 14, 23);
      doc.text(`MONTH: ${userData.month}`, 100, 23);
      doc.text(`FILE GOAL: __________`, 14, 29);
      doc.text(`ACHIEVED: ${userData.achieved_files}`, 100, 29);

      const tableData = userData.daily_data.map(d => [d.date, d.day, d.start_time, d.end_time, d.calls.toString(), d.connected.toString(), d.leads.toString(), d.files.toString(), d.talk_time_formatted]);
      tableData.push(['TOTAL', '', '', '', userData.totals.calls.toString(), userData.totals.connected.toString(), userData.totals.leads.toString(), userData.totals.files.toString(), userData.totals.talk_time_formatted]);

      doc.autoTable({
        head: [['DATE', 'DAY', 'START', 'END', 'CALLS', 'CONN.', 'LEADS', 'FILES', 'TALK TIME']],
        body: tableData,
        startY: 35,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, halign: 'center' },
        headStyles: { fillColor: [200, 220, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [240, 240, 240];
          }
        }
      });
    }

    doc.addPage();
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`ALL AGENTS SUMMARY - ${monthName}`, doc.internal.pageSize.width / 2, 20, { align: 'center' });

    const summaryData = allData.map(u => [u.user_name, u.totals.calls.toString(), u.totals.connected.toString(), u.totals.leads.toString(), u.totals.files.toString(), u.totals.talk_time_formatted]);
    const grandTotals = allData.reduce((acc, u) => ({
      calls: acc.calls + u.totals.calls,
      connected: acc.connected + u.totals.connected,
      leads: acc.leads + u.totals.leads,
      files: acc.files + u.totals.files,
      talk_time: acc.talk_time + (u.totals.talk_time_seconds || 0)
    }), { calls: 0, connected: 0, leads: 0, files: 0, talk_time: 0 });
    summaryData.push(['GRAND TOTAL', grandTotals.calls.toString(), grandTotals.connected.toString(), grandTotals.leads.toString(), grandTotals.files.toString(), formatTime(grandTotals.talk_time)]);

    doc.autoTable({
      head: [['AGENT', 'CALLS', 'CONNECTED', 'LEADS', 'FILES', 'TALK TIME']],
      body: summaryData,
      startY: 30,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 4, halign: 'center' },
      headStyles: { fillColor: [100, 150, 200], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', cellWidth: 50 } },
      didParseCell: (data) => {
        if (data.row.index === summaryData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [220, 220, 220];
        }
      }
    });

    doc.save(`all_agents_tracking_${monthName.replace(' ', '_')}.pdf`);
  };

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
        
        <div className="flex gap-2">
          <button onClick={downloadAllAgentsCSV} disabled={isDownloadingAll} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
            {isDownloadingAll ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
            All Agents CSV
          </button>
          <button onClick={downloadAllAgentsPDF} disabled={isDownloadingAll} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium disabled:opacity-50">
            {isDownloadingAll ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
            All Agents PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <User size={14} className="inline mr-1" />Select Agent
            </label>
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="input-field w-full">
              <option value="">All Agents</option>
              {telecallers.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar size={14} className="inline mr-1" />Date Range Type
            </label>
            <select value={useCustomRange ? 'custom' : 'month'} onChange={(e) => setUseCustomRange(e.target.value === 'custom')} className="input-field w-full">
              <option value="month">By Month</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {!useCustomRange ? (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <div className="flex items-center gap-2">
                <button onClick={prevMonth} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft size={18} /></button>
                <div className="flex-1 text-center font-medium text-gray-800 py-2 bg-gray-50 rounded-lg">{getMonthName(selectedMonth, selectedYear)}</div>
                <button onClick={nextMonth} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight size={18} /></button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field w-full" />
              </div>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
      ) : currentUserData ? (
        <>
          <div className="card overflow-hidden mb-6">
            {/* Sheet Header */}
            <div className="bg-gradient-to-r from-gray-100 to-gray-200 p-4">
              <h2 className="text-xl font-bold text-center text-gray-800 mb-4">MIT DAILY TRACKING SHEET</h2>
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

            {/* Export Buttons */}
            <div className="flex justify-end gap-2 p-3 bg-gray-50 border-b">
              <button onClick={() => downloadCSV(currentUserData)} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm font-medium">
                <Download size={16} />CSV
              </button>
              <button onClick={() => downloadPDF(currentUserData)} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium">
                <Printer size={16} />PDF
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
                    <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200"><Phone size={14} className="inline" /> CALLS</th>
                    <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200"><PhoneForwarded size={14} className="inline" /> CONNECTED</th>
                    <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200"><Users size={14} className="inline" /> LEADS</th>
                    <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200"><FileText size={14} className="inline" /> FILES</th>
                    <th className="py-3 px-3 text-center font-bold text-gray-700 border-b-2 border-blue-200"><Clock size={14} className="inline" /> TALK TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {currentUserData.daily_data.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-gray-500">No activity data for this period</td></tr>
                  ) : (
                    <>
                      {currentUserData.daily_data.map((row, idx) => (
                        <tr key={row.date} className={`border-b border-gray-100 hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <td className="py-2.5 px-4 font-medium text-gray-800">{row.date}</td>
                          <td className="py-2.5 px-3 text-center text-gray-600">{row.day}</td>
                          <td className="py-2.5 px-3 text-center text-gray-600">{row.start_time}</td>
                          <td className="py-2.5 px-3 text-center text-gray-600">{row.end_time}</td>
                          <td className="py-2.5 px-3 text-center font-medium text-gray-800">{row.calls}</td>
                          <td className="py-2.5 px-3 text-center"><span className={`font-medium ${row.connected > 0 ? 'text-green-600' : 'text-gray-400'}`}>{row.connected}</span></td>
                          <td className="py-2.5 px-3 text-center"><span className={`font-medium ${row.leads > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{row.leads}</span></td>
                          <td className="py-2.5 px-3 text-center"><span className={`font-bold ${row.files > 0 ? 'text-green-600' : 'text-gray-400'}`}>{row.files}</span></td>
                          <td className="py-2.5 px-3 text-center text-gray-600">{row.talk_time_formatted}</td>
                        </tr>
                      ))}
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

          {/* Analytics Section */}
          {analytics && analytics.byDayOfWeek.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 size={24} className="text-purple-600" />
                  <h2 className="text-xl font-bold text-gray-900">Performance Analytics</h2>
                </div>
                <button 
                  onClick={() => setShowAnalytics(!showAnalytics)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
                </button>
              </div>

              {showAnalytics && (
                <>
                  {/* Key Insights */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Highest Performance */}
                    <div className="card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp size={20} className="text-green-600" />
                        <h3 className="font-semibold text-gray-800">Best Day Performance</h3>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Highest Calls:</span>
                          <span className="font-bold text-green-600">{analytics.highest.calls?.day} ({analytics.highest.calls?.calls})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Highest Connected:</span>
                          <span className="font-bold text-green-600">{analytics.highest.connected?.day} ({analytics.highest.connected?.connected})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Highest Talk Time:</span>
                          <span className="font-bold text-green-600">{analytics.highest.talkTime?.day} ({analytics.highest.talkTime?.talkTimeFormatted})</span>
                        </div>
                      </div>
                    </div>

                    {/* Lowest Performance */}
                    <div className="card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingDown size={20} className="text-red-500" />
                        <h3 className="font-semibold text-gray-800">Needs Improvement</h3>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Lowest Calls:</span>
                          <span className="font-bold text-red-500">{analytics.lowest.calls?.day} ({analytics.lowest.calls?.calls})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Lowest Connected:</span>
                          <span className="font-bold text-red-500">{analytics.lowest.connected?.day} ({analytics.lowest.connected?.connected})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Lowest Talk Time:</span>
                          <span className="font-bold text-red-500">{analytics.lowest.talkTime?.day} ({analytics.lowest.talkTime?.talkTimeFormatted})</span>
                        </div>
                      </div>
                    </div>

                    {/* Averages */}
                    <div className="card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Target size={20} className="text-blue-600" />
                        <h3 className="font-semibold text-gray-800">Daily Averages</h3>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Avg Calls/Day:</span>
                          <span className="font-bold text-blue-600">{analytics.averages.callsPerDay}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Avg Connected/Day:</span>
                          <span className="font-bold text-blue-600">{analytics.averages.connectedPerDay}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Avg Talk Time/Day:</span>
                          <span className="font-bold text-blue-600">{formatTime(analytics.averages.talkTimePerDay)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* File Conversion Analysis */}
                  <div className="card p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <FileText size={20} className="text-green-600" />
                      <h3 className="font-semibold text-gray-800">Talk Time to Files Conversion Analysis</h3>
                    </div>
                    
                    {analytics.totals.files > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-green-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-green-600">{formatTime(analytics.fileConversion.talkTimePerFile)}</div>
                          <div className="text-sm text-gray-600 mt-1">Talk Time per File</div>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-blue-600">{analytics.fileConversion.callsPerFile}</div>
                          <div className="text-sm text-gray-600 mt-1">Calls per File</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-purple-600">{analytics.fileConversion.connectedPerFile}</div>
                          <div className="text-sm text-gray-600 mt-1">Connected per File</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-amber-600">{analytics.fileConversion.estimatedFilesPerHour}</div>
                          <div className="text-sm text-gray-600 mt-1">Est. Files per Hour</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        No files achieved yet. Complete some files to see conversion metrics.
                      </div>
                    )}
                    
                    {analytics.totals.files > 0 && (
                      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>Insight:</strong> Based on current performance, {currentUserData.user_name} needs approximately{' '}
                          <strong>{formatTime(analytics.fileConversion.talkTimePerFile)}</strong> of talk time and{' '}
                          <strong>{analytics.fileConversion.connectedPerFile} connected calls</strong> to close 1 file.
                          To achieve more files, aim for at least <strong>{formatTime(analytics.fileConversion.talkTimePerFile * 2)}</strong> talk time daily.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Charts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Calls by Day of Week */}
                    <div className="card p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Calls & Connected by Day of Week</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.byDayOfWeek}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="day" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="calls" fill="#3B82F6" name="Calls" />
                          <Bar dataKey="connected" fill="#10B981" name="Connected" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Talk Time by Day of Week */}
                    <div className="card p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Talk Time by Day of Week (minutes)</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={analytics.byDayOfWeek.map(d => ({ ...d, talkTimeMin: Math.round(d.talkTime / 60) }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="day" />
                          <YAxis />
                          <Tooltip formatter={(value) => `${value} min`} />
                          <Bar dataKey="talkTimeMin" fill="#8B5CF6" name="Talk Time (min)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Daily Trend */}
                    <div className="card p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Daily Performance Trend</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={analytics.trendData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="calls" stroke="#3B82F6" name="Calls" />
                          <Line type="monotone" dataKey="connected" stroke="#10B981" name="Connected" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Talk Time vs Files Correlation */}
                    <div className="card p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Talk Time vs Files (Correlation)</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <ScatterChart>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="talkTime" name="Talk Time" unit=" min" />
                          <YAxis dataKey="files" name="Files" />
                          <ZAxis range={[100, 100]} />
                          <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(value, name) => [value, name === 'talkTime' ? 'Talk Time (min)' : 'Files']} />
                          <Scatter name="Daily Data" data={analytics.scatterData} fill="#8B5CF6" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="card p-8 text-center text-gray-500">Select an agent to view their tracking sheet</div>
      )}
    </div>
  );
};

export default DailyTrackingSheet;
