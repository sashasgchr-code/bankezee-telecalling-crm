import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Phone, TrendingUp, Loader2, ChevronDown, ChevronUp, Download, RefreshCw, Calendar, BarChart3, Activity, LogIn, LogOut, Coffee, FileText } from 'lucide-react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const AdminReports = () => {
  const [reports, setReports] = useState(null);
  const [hourlyReports, setHourlyReports] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeTab, setActiveTab] = useState('summary'); // 'summary', 'hourly', or 'activity'
  const [hourlyDate, setHourlyDate] = useState(new Date().toISOString().split('T')[0]);
  const [activityDate, setActivityDate] = useState(new Date().toISOString().split('T')[0]);
  const [expandedHourlyCards, setExpandedHourlyCards] = useState({});

  const fetchReports = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      let url = `/reports/telecallers?period=${period}`;
      if (showDateRange && fromDate && toDate) {
        url = `/reports/telecallers?from_date=${fromDate}&to_date=${toDate}`;
      }
      
      const response = await api.get(url);
      setReports(response.data);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [period, showDateRange, fromDate, toDate]);

  const fetchHourlyReports = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      const response = await api.get(`/reports/hourly?date=${hourlyDate}`);
      setHourlyReports(response.data);
    } catch (error) {
      console.error('Error fetching hourly reports:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [hourlyDate]);

  const fetchActivityLogs = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      const response = await api.get(`/activity/logs?date=${activityDate}`);
      setActivityLogs(response.data);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activityDate]);

  useEffect(() => {
    if (activeTab === 'summary') {
      fetchReports();
    } else if (activeTab === 'hourly') {
      fetchHourlyReports();
    } else if (activeTab === 'activity') {
      fetchActivityLogs();
    }
  }, [activeTab, fetchReports, fetchHourlyReports, fetchActivityLogs]);

  const handleRefresh = () => {
    if (activeTab === 'summary') {
      fetchReports(true);
    } else if (activeTab === 'hourly') {
      fetchHourlyReports(true);
    } else if (activeTab === 'activity') {
      fetchActivityLogs(true);
    }
  };

  const handlePeriodChange = (newPeriod) => {
    setShowDateRange(false);
    setPeriod(newPeriod);
  };

  const getActionIcon = (action) => {
    switch (action) {
      case 'login': return <LogIn size={14} className="text-green-600" />;
      case 'logout': return <LogOut size={14} className="text-red-600" />;
      case 'break_start': return <Coffee size={14} className="text-orange-600" />;
      case 'break_end': return <Coffee size={14} className="text-blue-600" />;
      default: return <Activity size={14} className="text-gray-600" />;
    }
  };

  const getActionLabel = (action) => {
    switch (action) {
      case 'login': return 'Logged In';
      case 'logout': return 'Logged Out';
      case 'break_start': return 'Break Started';
      case 'break_end': return 'Break Ended';
      default: return action;
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const handleDateRangeToggle = () => {
    setShowDateRange(!showDateRange);
    if (!showDateRange) {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setFromDate(weekAgo);
      setToDate(today);
    }
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const formatTimeForExcel = (seconds) => {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleCard = (userId) => {
    setExpandedCards(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  const downloadExcel = () => {
    if (!reports || !reports.telecallers) return;

    let periodLabel = periods.find(p => p.id === period)?.label || period;
    if (showDateRange && fromDate && toDate) {
      periodLabel = `${fromDate} to ${toDate}`;
    }
    
    // Create CSV content
    const headers = ['Name', 'Email', 'Status', 'Data Assigned', 'Calls', 'Leads', 'File', 'Talk Time', 'Conversion Rate'];
    const rows = reports.telecallers.map(tc => [
      tc.user_name || '',
      tc.user_email || '',
      tc.is_active ? 'Active' : 'Inactive',
      tc.total_leads || 0,
      tc.total_calls || 0,
      tc.leads_generated || 0,
      tc.file || 0,
      formatTimeForExcel(tc.total_call_seconds),
      `${(tc.calls_to_lead_rate || 0).toFixed(1)}%`
    ]);

    // Build CSV string
    let csvContent = `Telecaller Performance Report - ${periodLabel}\n\n`;
    csvContent += headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    // Add summary
    csvContent += '\n';
    csvContent += 'OVERALL SUMMARY\n';
    csvContent += `Total Calls,${reports.overall?.total_calls || 0}\n`;
    csvContent += `Leads Generated,${reports.overall?.total_leads_generated || 0}\n`;
    csvContent += `Total Talk Time,${formatTimeForExcel(reports.overall?.total_call_seconds)}\n`;
    csvContent += `Overall Conversion Rate,${(reports.overall?.calls_to_lead_rate || 0).toFixed(1)}%\n`;

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const filename = showDateRange && fromDate && toDate 
      ? `telecaller_report_${fromDate}_to_${toDate}.csv`
      : `telecaller_report_${period}_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadPDF = async () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    let yPos = 15;

    // Color definitions
    const colors = {
      primary: [76, 175, 80],      // Green
      secondary: [33, 150, 243],   // Blue
      orange: [255, 152, 0],       // Orange
      purple: [156, 39, 176],      // Purple
      teal: [0, 150, 136],         // Teal
      gray: [158, 158, 158],       // Gray
      red: [244, 67, 54],          // Red
      indigo: [103, 58, 183],      // Indigo
    };

    let periodLabel = periods.find(p => p.id === period)?.label || period;
    if (showDateRange && fromDate && toDate) {
      periodLabel = `${fromDate} to ${toDate}`;
    }

    // Header
    doc.setFillColor(...colors.primary);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('BANKEZEE Connect - Performance Report', pageWidth / 2, 12, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${periodLabel} | Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 20, { align: 'center' });
    yPos = 35;

    // SUMMARY TAB
    if (reports) {
      // Overall Performance Section
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Overall Performance', 14, yPos);
      yPos += 8;

      // Performance metrics boxes
      const metrics = [
        { label: 'Total Calls', value: reports.overall?.total_calls || 0, color: colors.primary },
        { label: 'Leads', value: reports.overall?.total_leads_generated || 0, color: colors.secondary },
        { label: 'File', value: reports.overall?.total_file || 0, color: colors.orange },
        { label: 'Presentations', value: reports.overall?.total_presentations || 0, color: colors.indigo },
        { label: 'Talk Time', value: formatTime(reports.overall?.total_call_seconds), color: colors.purple },
        { label: 'Conversion', value: `${(reports.overall?.calls_to_lead_rate || 0).toFixed(1)}%`, color: colors.teal },
      ];

      const boxWidth = 28;
      const boxHeight = 18;
      const startX = 14;
      metrics.forEach((metric, i) => {
        const x = startX + (i * (boxWidth + 4));
        doc.setFillColor(...metric.color);
        doc.roundedRect(x, yPos, boxWidth, boxHeight, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(String(metric.value), x + boxWidth / 2, yPos + 8, { align: 'center' });
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text(metric.label, x + boxWidth / 2, yPos + 14, { align: 'center' });
      });
      yPos += boxHeight + 10;

      // Telecaller Performance Table
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Telecaller Performance', 14, yPos);
      yPos += 6;

      const tableData = reports.telecallers.map(tc => [
        tc.user_name || '',
        tc.is_active ? 'Active' : 'Inactive',
        tc.total_calls || 0,
        tc.leads_generated || 0,
        tc.file || 0,
        tc.presentations || 0,
        formatTime(tc.total_call_seconds),
        `${(tc.calls_to_lead_rate || 0).toFixed(1)}%`
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [['Name', 'Status', 'Calls', 'Leads', 'File', 'Pres', 'Talk Time', 'Conv %']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: colors.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 18 },
          2: { cellWidth: 15, halign: 'center' },
          3: { cellWidth: 15, halign: 'center' },
          4: { cellWidth: 15, halign: 'center' },
          5: { cellWidth: 15, halign: 'center' },
          6: { cellWidth: 22, halign: 'center' },
          7: { cellWidth: 18, halign: 'center' },
        },
        didParseCell: function(data) {
          if (data.section === 'body') {
            if (data.column.index === 1) {
              data.cell.styles.textColor = data.cell.raw === 'Active' ? colors.primary : colors.gray;
              data.cell.styles.fontStyle = 'bold';
            }
            if (data.column.index === 2) data.cell.styles.textColor = colors.primary;
            if (data.column.index === 3) data.cell.styles.textColor = colors.secondary;
            if (data.column.index === 4) data.cell.styles.textColor = colors.orange;
            if (data.column.index === 5) data.cell.styles.textColor = colors.indigo;
            if (data.column.index === 6) data.cell.styles.textColor = colors.purple;
            if (data.column.index === 7) data.cell.styles.textColor = colors.teal;
          }
        }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // HOURLY REPORT (new page)
    if (hourlyReports) {
      doc.addPage();
      yPos = 15;

      // Header for hourly report
      doc.setFillColor(...colors.primary);
      doc.rect(0, 0, pageWidth, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`Caller-wise Hourly Report - ${hourlyDate}`, pageWidth / 2, 13, { align: 'center' });
      yPos = 28;

      // Legend
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('C = Calls, P = Presentations, L = Leads, F = File', 14, yPos);
      yPos += 8;

      // Get all unique hours
      const allHours = new Set();
      hourlyReports.telecallers?.forEach(tc => {
        tc.hourly_breakdown?.forEach(hb => allHours.add(hb.hour));
      });
      const sortedHours = Array.from(allHours).sort((a, b) => a - b);

      const getHourData = (tc, hour) => {
        const hb = tc.hourly_breakdown?.find(h => h.hour === hour);
        return hb || { calls: 0, presentations: 0, leads: 0, file: 0 };
      };

      if (sortedHours.length > 0 && hourlyReports.telecallers?.length > 0) {
        // Build header row with hours
        const headerRow1 = ['Telecaller'];
        sortedHours.forEach(hour => {
          headerRow1.push(`${hour.toString().padStart(2, '0')}:00`);
        });
        headerRow1.push('TOTAL');

        // Build sub-header row with C P L F
        const headerRow2 = [''];
        sortedHours.forEach(() => {
          headerRow2.push('C  P  L  F');
        });
        headerRow2.push('C  P  L  F');

        // Build data rows
        const bodyData = [];
        
        hourlyReports.telecallers.forEach(tc => {
          const row = [tc.user_name];
          sortedHours.forEach(hour => {
            const data = getHourData(tc, hour);
            const c = data.calls || '-';
            const p = data.presentations || '-';
            const l = data.leads || '-';
            const f = data.file || '-';
            row.push(`${c}  ${p}  ${l}  ${f}`);
          });
          // Add totals
          const totalC = tc.total_calls || 0;
          const totalP = tc.total_presentations || 0;
          const totalL = tc.total_leads || 0;
          const totalF = tc.total_file || 0;
          row.push(`${totalC}  ${totalP}  ${totalL}  ${totalF}`);
          bodyData.push(row);
        });

        // Add TOTAL row
        const totalRow = ['TOTAL'];
        sortedHours.forEach(hour => {
          const totals = hourlyReports.telecallers.reduce((acc, tc) => {
            const data = getHourData(tc, hour);
            return {
              calls: acc.calls + (data.calls || 0),
              presentations: acc.presentations + (data.presentations || 0),
              leads: acc.leads + (data.leads || 0),
              file: acc.file + (data.file || 0)
            };
          }, { calls: 0, presentations: 0, leads: 0, file: 0 });
          const c = totals.calls || '-';
          const p = totals.presentations || '-';
          const l = totals.leads || '-';
          const f = totals.file || '-';
          totalRow.push(`${c}  ${p}  ${l}  ${f}`);
        });
        // Grand totals
        const grandC = hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_calls || 0), 0);
        const grandP = hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_presentations || 0), 0);
        const grandL = hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_leads || 0), 0);
        const grandF = hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_file || 0), 0);
        totalRow.push(`${grandC}  ${grandP}  ${grandL}  ${grandF}`);
        bodyData.push(totalRow);

        // Calculate column widths
        const telecallerColWidth = 40;
        const hourColWidth = Math.min(22, (pageWidth - telecallerColWidth - 30) / (sortedHours.length + 1));
        
        const columnStyles = { 0: { cellWidth: telecallerColWidth, halign: 'left' } };
        for (let i = 1; i <= sortedHours.length + 1; i++) {
          columnStyles[i] = { cellWidth: hourColWidth, halign: 'center', fontSize: 7 };
        }

        autoTable(doc, {
          startY: yPos,
          head: [headerRow1, headerRow2],
          body: bodyData,
          theme: 'grid',
          headStyles: { 
            fillColor: colors.primary, 
            textColor: [255, 255, 255], 
            fontStyle: 'bold', 
            fontSize: 7,
            halign: 'center'
          },
          bodyStyles: { fontSize: 7, halign: 'center' },
          columnStyles: columnStyles,
          margin: { left: 10, right: 10 },
          didParseCell: function(data) {
            // Style the TOTAL row
            if (data.section === 'body' && data.row.index === bodyData.length - 1) {
              data.cell.styles.fillColor = colors.primary;
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = 'bold';
            }
            // Style the TOTAL column
            if (data.section === 'body' && data.column.index === sortedHours.length + 1) {
              if (data.row.index !== bodyData.length - 1) {
                data.cell.styles.fillColor = [240, 240, 240];
                data.cell.styles.fontStyle = 'bold';
              }
            }
            // Style telecaller name column
            if (data.section === 'body' && data.column.index === 0) {
              data.cell.styles.halign = 'left';
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });
        yPos = doc.lastAutoTable.finalY + 10;
      } else {
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(10);
        doc.text('No hourly data available', pageWidth / 2, yPos + 20, { align: 'center' });
      }
    }

    // ACTIVITY LOG (new page)
    if (activityLogs && activityLogs.length > 0) {
      doc.addPage();
      yPos = 15;

      // Header for activity log
      doc.setFillColor(...colors.purple);
      doc.rect(0, 0, pageWidth, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`Activity Log - ${activityDate}`, pageWidth / 2, 13, { align: 'center' });
      yPos = 30;

      activityLogs.forEach(group => {
        if (yPos > 260) {
          doc.addPage();
          yPos = 15;
        }

        // User header
        doc.setFillColor(240, 240, 240);
        doc.rect(14, yPos - 4, pageWidth - 28, 8, 'F');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`${group.user_name} - ${group.activities?.length || 0} activities`, 16, yPos);
        yPos += 8;

        if (group.activities) {
          const activityData = group.activities.map(log => {
            let action = log.action;
            if (action === 'login') action = 'Logged In';
            else if (action === 'logout') action = 'Logged Out';
            else if (action === 'break_start') action = 'Break Started';
            else if (action === 'break_end') action = 'Break Ended';
            
            const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
            return [action, log.reason || '-', time];
          });

          autoTable(doc, {
            startY: yPos,
            head: [['Action', 'Reason', 'Time']],
            body: activityData,
            theme: 'grid',
            headStyles: { fillColor: colors.purple, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
            bodyStyles: { fontSize: 9 },
            columnStyles: {
              0: { cellWidth: 40 },
              1: { cellWidth: 80 },
              2: { cellWidth: 30, halign: 'center' }
            },
            margin: { left: 14, right: 14 },
            didParseCell: function(data) {
              if (data.section === 'body' && data.column.index === 0) {
                if (data.cell.raw === 'Logged In') data.cell.styles.textColor = colors.primary;
                else if (data.cell.raw === 'Logged Out') data.cell.styles.textColor = colors.red;
                else if (data.cell.raw.includes('Break')) data.cell.styles.textColor = colors.orange;
              }
            }
          });
          yPos = doc.lastAutoTable.finalY + 10;
        }
      });
    }

    // Footer on all pages
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      doc.text('BANKEZEE Connect CRM', 14, doc.internal.pageSize.getHeight() - 10);
    }

    // Download
    const filename = `bankezee_report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'three_months', label: 'Last 3 Months' },
    { id: 'lifetime', label: 'Lifetime' },
  ];

  return (
    <div className="p-4" data-testid="admin-reports">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            data-testid="refresh-report-btn"
          >
            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={downloadExcel}
            disabled={!reports || isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="download-csv-btn"
            title="Export to CSV"
          >
            <Download size={16} />
            CSV
          </button>
          <button
            onClick={downloadPDF}
            disabled={!reports || isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="download-pdf-btn"
            title="Export to PDF"
          >
            <FileText size={16} />
            PDF
          </button>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'summary'
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <TrendingUp size={16} />
          Summary
        </button>
        <button
          onClick={() => setActiveTab('hourly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'hourly'
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <BarChart3 size={16} />
          Hourly
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'activity'
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Activity size={16} />
          Activity
        </button>
      </div>

      {/* Summary Tab Content */}
      {activeTab === 'summary' && (
        <>
          {/* Period Filter */}
          <div className="flex flex-wrap gap-2 mb-3">
            {periods.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePeriodChange(p.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  period === p.id && !showDateRange
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={handleDateRangeToggle}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
                showDateRange
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Calendar size={14} />
              Custom
            </button>
          </div>

          {/* Date Range Picker */}
          {showDateRange && (
            <div className="flex gap-2 mb-4 items-center flex-wrap">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="input-field text-sm py-1.5"
                data-testid="from-date"
              />
              <span className="text-gray-500 text-sm">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="input-field text-sm py-1.5"
                data-testid="to-date"
              />
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
          ) : reports ? (
            <>
              {/* Overall Stats */}
              <div className="card p-4 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Overall Performance</h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-600">{reports.overall.total_calls}</p>
                    <p className="text-xs text-gray-500">Total Calls</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-600">{reports.overall.total_leads_generated}</p>
                    <p className="text-xs text-gray-500">Leads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-orange-600">{reports.overall.total_file || 0}</p>
                    <p className="text-xs text-gray-500">File</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-indigo-600">{reports.overall.total_presentations || 0}</p>
                    <p className="text-xs text-gray-500">Presentations</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-purple-600">
                      {formatTime(reports.overall.total_call_seconds)}
                    </p>
                    <p className="text-xs text-gray-500">Talk Time</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-teal-600">
                      {(reports.overall.calls_to_lead_rate || 0).toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">Conversion</p>
                  </div>
                </div>
          </div>

          {/* Telecaller Performance */}
          <div className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Telecaller Performance</h3>
            <div className="space-y-2">
              {reports.telecallers.map((tc) => (
                <div
                  key={tc.user_id}
                  className={`bg-gray-50 rounded-lg overflow-hidden ${!tc.is_active ? 'opacity-60' : ''}`}
                  data-testid={`report-card-${tc.user_id}`}
                >
                  {/* Header - Always visible */}
                  <button
                    onClick={() => toggleCard(tc.user_id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tc.is_active ? 'bg-green-600' : 'bg-gray-400'
                      }`}>
                        <span className="text-white font-bold">
                          {tc.user_name?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-gray-900">{tc.user_name}</p>
                        <p className="text-xs text-gray-500">{tc.total_leads} data • {tc.total_calls} calls</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {!tc.is_active && (
                        <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs">
                          Inactive
                        </span>
                      )}
                      {expandedCards[tc.user_id] ? (
                        <ChevronUp size={20} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {expandedCards[tc.user_id] && (
                    <div className="px-4 pb-4 pt-0">
                      {/* Main Performance Stats - Matching Overall Stats Layout */}
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4 p-3 bg-white rounded-lg">
                        <div className="text-center">
                          <p className="text-lg font-bold text-green-600">{tc.total_calls}</p>
                          <p className="text-xs text-gray-500">Calls</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-blue-600">{tc.leads_generated}</p>
                          <p className="text-xs text-gray-500">Leads</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-orange-600">{tc.file || 0}</p>
                          <p className="text-xs text-gray-500">File</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-indigo-600">{tc.presentations || 0}</p>
                          <p className="text-xs text-gray-500">Presentations</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-purple-600">{formatTime(tc.total_call_seconds)}</p>
                          <p className="text-xs text-gray-500">Talk Time</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-teal-600">{(tc.calls_to_lead_rate || 0).toFixed(1)}%</p>
                          <p className="text-xs text-gray-500">Conversion</p>
                        </div>
                      </div>

                      {/* Status Breakdown */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">STATUS BREAKDOWN</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'new', label: 'New', color: '#4CAF50' },
                            { key: 'contacted', label: 'Contacted', color: '#2196F3' },
                            { key: 'file', label: 'File', color: '#FF9800' },
                            { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
                            { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
                            { key: 'leads', label: 'Leads', color: '#00C853' },
                            { key: 'not_answering', label: 'Not Answering', color: '#FF5722' },
                            { key: 'wrong_number', label: 'Wrong Number', color: '#F44336' },
                            { key: 'presentation', label: 'Presentation', color: '#673AB7' },
                          ].map((status) => (
                            <div 
                              key={status.key}
                              className="flex items-center justify-between p-2 rounded"
                              style={{ backgroundColor: `${status.color}15` }}
                            >
                              <span className="text-xs text-gray-600">{status.label}</span>
                              <span className="font-bold text-sm" style={{ color: status.color }}>
                                {tc.status_counts?.[status.key] || 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Call Outcomes */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">CALL OUTCOMES</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'calls_connected', label: 'Connected', color: '#4CAF50' },
                            { key: 'calls_no_answer', label: 'No Answer', color: '#FF9800' },
                            { key: 'calls_wrong_number', label: 'Wrong Number', color: '#F44336' },
                            { key: 'calls_busy', label: 'Busy', color: '#9E9E9E' },
                            { key: 'calls_voicemail', label: 'Voicemail', color: '#2196F3' },
                          ].map((outcome) => (
                            <div 
                              key={outcome.key}
                              className="flex items-center justify-between p-2 rounded"
                              style={{ backgroundColor: `${outcome.color}15` }}
                            >
                              <span className="text-xs text-gray-600">{outcome.label}</span>
                              <span className="font-bold text-sm" style={{ color: outcome.color }}>
                                {tc[outcome.key] || 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Follow-ups & Rate */}
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Follow-ups Pending</span>
                          <span className="font-semibold text-gray-900">{tc.follow_ups_pending}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Follow-ups Completed</span>
                          <span className="font-semibold text-gray-900">{tc.follow_ups_completed}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-gray-200">
                          <span className="text-gray-500">Call to Lead Rate</span>
                          <span className="font-semibold text-green-600">
                            {(tc.calls_to_lead_rate || 0).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {reports.telecallers.length === 0 && (
                <p className="text-center text-gray-500 py-4">No telecaller data available</p>
              )}
            </div>
          </div>
        </>
      ) : null}
        </>
      )}

      {/* Hourly Tab Content */}
      {activeTab === 'hourly' && (
        <>
          {/* Date Picker for Hourly */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-600">Select Date:</span>
            <input
              type="date"
              value={hourlyDate}
              onChange={(e) => setHourlyDate(e.target.value)}
              className="input-field text-sm py-1.5"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
          ) : hourlyReports ? (
            <div className="space-y-6">
              {(() => {
                const allHours = new Set();
                hourlyReports.telecallers?.forEach(tc => {
                  tc.hourly_breakdown?.forEach(hb => allHours.add(hb.hour));
                });
                const sortedHours = Array.from(allHours).sort((a, b) => a - b);
                
                const getHourData = (tc, hour) => {
                  const hb = tc.hourly_breakdown?.find(h => h.hour === hour);
                  return hb || { calls: 0, connected: 0, presentations: 0, leads: 0, file: 0 };
                };

                if (sortedHours.length === 0) {
                  return <p className="text-center text-gray-500 py-4">No hourly data available</p>;
                }

                return (
                  <div className="card overflow-hidden">
                    <div className="bg-gradient-to-r from-green-600 to-green-700 px-4 py-3">
                      <h3 className="text-lg font-semibold text-white">Caller-wise Hourly Report</h3>
                      <p className="text-green-100 text-xs mt-1">C = Calls, P = Presentations, L = Leads, F = File</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          {/* Hour Headers Row */}
                          <tr className="bg-gray-100">
                            <th rowSpan={2} className="text-left py-3 px-4 font-bold text-gray-800 border-b-2 border-gray-300 sticky left-0 bg-gray-100 min-w-[120px] z-10">
                              Telecaller
                            </th>
                            {sortedHours.map(hour => (
                              <th 
                                key={hour} 
                                colSpan={4} 
                                className="text-center py-2 px-1 font-bold text-gray-800 border-b border-l border-gray-300 bg-gray-50"
                              >
                                {`${hour.toString().padStart(2, '0')}:00`}
                              </th>
                            ))}
                            <th colSpan={4} className="text-center py-2 px-1 font-bold text-white bg-gray-700 border-l border-gray-300">
                              TOTAL
                            </th>
                          </tr>
                          {/* Metric Sub-Headers Row */}
                          <tr className="bg-gray-50">
                            {sortedHours.map(hour => (
                              <React.Fragment key={`sub-${hour}`}>
                                <th className="py-2 px-1 text-xs font-semibold text-blue-600 border-l border-gray-200 w-10">C</th>
                                <th className="py-2 px-1 text-xs font-semibold text-indigo-600 w-10">P</th>
                                <th className="py-2 px-1 text-xs font-semibold text-teal-600 w-10">L</th>
                                <th className="py-2 px-1 text-xs font-semibold text-orange-600 w-10">F</th>
                              </React.Fragment>
                            ))}
                            <th className="py-2 px-1 text-xs font-semibold text-blue-200 bg-gray-700 border-l border-gray-500 w-10">C</th>
                            <th className="py-2 px-1 text-xs font-semibold text-indigo-200 bg-gray-700 w-10">P</th>
                            <th className="py-2 px-1 text-xs font-semibold text-teal-200 bg-gray-700 w-10">L</th>
                            <th className="py-2 px-1 text-xs font-semibold text-orange-200 bg-gray-700 w-10">F</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hourlyReports.telecallers?.map((tc, idx) => (
                            <tr key={tc.user_id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-green-50 transition-colors`}>
                              <td className={`py-3 px-4 font-semibold text-gray-900 sticky left-0 z-10 border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                                {tc.user_name}
                              </td>
                              {sortedHours.map(hour => {
                                const data = getHourData(tc, hour);
                                return (
                                  <React.Fragment key={`${tc.user_id}-${hour}`}>
                                    <td className="py-2 px-1 text-center border-l border-gray-100">
                                      {data.calls > 0 ? (
                                        <span className="inline-block w-7 h-7 leading-7 rounded bg-blue-100 text-blue-700 font-bold text-xs">{data.calls}</span>
                                      ) : <span className="text-gray-300">-</span>}
                                    </td>
                                    <td className="py-2 px-1 text-center">
                                      {data.presentations > 0 ? (
                                        <span className="inline-block w-7 h-7 leading-7 rounded bg-indigo-100 text-indigo-700 font-bold text-xs">{data.presentations}</span>
                                      ) : <span className="text-gray-300">-</span>}
                                    </td>
                                    <td className="py-2 px-1 text-center">
                                      {data.leads > 0 ? (
                                        <span className="inline-block w-7 h-7 leading-7 rounded bg-teal-100 text-teal-700 font-bold text-xs">{data.leads}</span>
                                      ) : <span className="text-gray-300">-</span>}
                                    </td>
                                    <td className="py-2 px-1 text-center">
                                      {data.file > 0 ? (
                                        <span className="inline-block w-7 h-7 leading-7 rounded bg-orange-100 text-orange-700 font-bold text-xs">{data.file}</span>
                                      ) : <span className="text-gray-300">-</span>}
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                              {/* Totals */}
                              <td className="py-2 px-1 text-center bg-gray-100 border-l border-gray-300">
                                <span className="inline-block w-8 h-7 leading-7 rounded bg-blue-600 text-white font-bold text-xs">{tc.total_calls}</span>
                              </td>
                              <td className="py-2 px-1 text-center bg-gray-100">
                                <span className="inline-block w-8 h-7 leading-7 rounded bg-indigo-600 text-white font-bold text-xs">{tc.total_presentations || 0}</span>
                              </td>
                              <td className="py-2 px-1 text-center bg-gray-100">
                                <span className="inline-block w-8 h-7 leading-7 rounded bg-teal-600 text-white font-bold text-xs">{tc.total_leads || 0}</span>
                              </td>
                              <td className="py-2 px-1 text-center bg-gray-100">
                                <span className="inline-block w-8 h-7 leading-7 rounded bg-orange-500 text-white font-bold text-xs">{tc.total_file || 0}</span>
                              </td>
                            </tr>
                          ))}
                          {/* Grand Totals Row */}
                          <tr className="bg-green-600 text-white font-bold">
                            <td className="py-3 px-4 sticky left-0 bg-green-600 z-10">TOTAL</td>
                            {sortedHours.map(hour => {
                              const totals = hourlyReports.telecallers?.reduce((acc, tc) => {
                                const data = getHourData(tc, hour);
                                return {
                                  calls: acc.calls + data.calls,
                                  presentations: acc.presentations + data.presentations,
                                  leads: acc.leads + data.leads,
                                  file: acc.file + data.file
                                };
                              }, { calls: 0, presentations: 0, leads: 0, file: 0 });
                              return (
                                <React.Fragment key={`total-${hour}`}>
                                  <td className="py-2 px-1 text-center border-l border-green-500 text-blue-200">{totals.calls || '-'}</td>
                                  <td className="py-2 px-1 text-center text-indigo-200">{totals.presentations || '-'}</td>
                                  <td className="py-2 px-1 text-center text-teal-200">{totals.leads || '-'}</td>
                                  <td className="py-2 px-1 text-center text-orange-200">{totals.file || '-'}</td>
                                </React.Fragment>
                              );
                            })}
                            {/* Grand Totals */}
                            <td className="py-2 px-1 text-center bg-green-700 border-l border-green-500">
                              {hourlyReports.telecallers?.reduce((sum, tc) => sum + tc.total_calls, 0) || 0}
                            </td>
                            <td className="py-2 px-1 text-center bg-green-700">
                              {hourlyReports.telecallers?.reduce((sum, tc) => sum + (tc.total_presentations || 0), 0) || 0}
                            </td>
                            <td className="py-2 px-1 text-center bg-green-700">
                              {hourlyReports.telecallers?.reduce((sum, tc) => sum + (tc.total_leads || 0), 0) || 0}
                            </td>
                            <td className="py-2 px-1 text-center bg-green-700">
                              {hourlyReports.telecallers?.reduce((sum, tc) => sum + (tc.total_file || 0), 0) || 0}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}
        </>
      )}

      {/* Activity Tab Content */}
      {activeTab === 'activity' && (
        <>
          {/* Date Picker for Activity */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-600">Select Date:</span>
            <input
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              className="input-field text-sm py-1.5"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {activityLogs.length > 0 ? (
                activityLogs.map((group) => (
                  <div key={group.user_id} className="card">
                    <div className="p-4 border-b border-gray-100 bg-gray-50">
                      <h3 className="text-lg font-semibold text-gray-900">{group.user_name}</h3>
                      <p className="text-xs text-gray-500">{group.activities?.length || 0} activities</p>
                    </div>
                    
                    <div className="divide-y divide-gray-100">
                      {group.activities && group.activities.map((log, index) => (
                        <div key={log.id || index} className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              log.action === 'login' ? 'bg-green-100' :
                              log.action === 'logout' ? 'bg-red-100' :
                              log.action.includes('break') ? 'bg-orange-100' : 'bg-gray-100'
                            }`}>
                              {getActionIcon(log.action)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{getActionLabel(log.action)}</p>
                              {log.reason && (
                                <p className="text-xs text-gray-400">Reason: {log.reason}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">{formatTimestamp(log.timestamp)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="card p-8 text-center">
                  <Activity size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-500">No activity logs for this date</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminReports;
