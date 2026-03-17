import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Phone, TrendingUp, Loader2, ChevronDown, ChevronUp, Download, RefreshCw, Calendar, BarChart3, Activity, LogIn, LogOut, Coffee, FileText, PhoneCall, User } from 'lucide-react';
import api from '../../services/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const AdminReports = () => {
  const [reports, setReports] = useState(null);
  const [hourlyReports, setHourlyReports] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [detailedCalls, setDetailedCalls] = useState(null);
  const [telecallers, setTelecallers] = useState([]);
  const [selectedTelecaller, setSelectedTelecaller] = useState('all');
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeTab, setActiveTab] = useState('summary'); // 'summary', 'hourly', 'activity', or 'calls'
  const [hourlyDate, setHourlyDate] = useState(new Date().toISOString().split('T')[0]);
  const [activityDate, setActivityDate] = useState(new Date().toISOString().split('T')[0]);
  const [callsFromDate, setCallsFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [callsToDate, setCallsToDate] = useState(new Date().toISOString().split('T')[0]);
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

  const fetchDetailedCalls = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      let url = `/reports/detailed-calls?from_date=${callsFromDate}&to_date=${callsToDate}`;
      if (selectedTelecaller && selectedTelecaller !== 'all') {
        url += `&telecaller_id=${selectedTelecaller}`;
      }
      
      const response = await api.get(url);
      setDetailedCalls(response.data);
    } catch (error) {
      console.error('Error fetching detailed calls:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [callsFromDate, callsToDate, selectedTelecaller]);

  const fetchTelecallers = useCallback(async () => {
    try {
      const response = await api.get('/users?role=telecaller');
      setTelecallers(response.data || []);
    } catch (error) {
      console.error('Error fetching telecallers:', error);
    }
  }, []);

  useEffect(() => {
    fetchTelecallers();
  }, [fetchTelecallers]);

  useEffect(() => {
    if (activeTab === 'summary') {
      fetchReports();
    } else if (activeTab === 'hourly') {
      fetchHourlyReports();
    } else if (activeTab === 'activity') {
      fetchActivityLogs();
    } else if (activeTab === 'calls') {
      fetchDetailedCalls();
    }
  }, [activeTab, fetchReports, fetchHourlyReports, fetchActivityLogs, fetchDetailedCalls]);

  const handleRefresh = () => {
    if (activeTab === 'summary') {
      fetchReports(true);
    } else if (activeTab === 'hourly') {
      fetchHourlyReports(true);
    } else if (activeTab === 'activity') {
      fetchActivityLogs(true);
    } else if (activeTab === 'calls') {
      fetchDetailedCalls(true);
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

  const downloadCallsCSV = () => {
    if (!detailedCalls?.calls?.length) return;

    // Create CSV content
    const headers = [
      'Date',
      'Time',
      'Caller Name',
      'Customer Name',
      'Mobile',
      'Email',
      'City',
      'Source',
      'Call Outcome',
      'Duration (seconds)',
      'Duration',
      'Lead Status',
      'Notes'
    ];
    
    const rows = detailedCalls.calls.map(call => [
      call.call_date || '',
      call.call_time || '',
      call.caller_name || '',
      call.customer_name || '',
      call.customer_phone || '',
      call.customer_email || '',
      call.customer_city || '',
      call.customer_source || '',
      call.call_outcome?.replace('_', ' ') || '',
      call.call_duration_seconds || 0,
      call.call_duration_formatted || '0s',
      call.lead_status?.replace('_', ' ') || '',
      (call.notes || '').replace(/"/g, "'").replace(/\n/g, ' ')
    ]);

    // Build CSV string
    let csvContent = `Detailed Call Report\n`;
    csvContent += `Period: ${callsFromDate} to ${callsToDate}\n`;
    csvContent += `Telecaller: ${selectedTelecaller === 'all' ? 'All' : telecallers.find(t => t.id === selectedTelecaller)?.name || selectedTelecaller}\n`;
    csvContent += `Total Calls: ${detailedCalls.total_count}\n\n`;
    csvContent += headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const filename = `call_report_${callsFromDate}_to_${callsToDate}.csv`;
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
      cyan: [0, 188, 212],         // Cyan
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
        { label: 'Avg Call', value: formatTime(reports.overall?.avg_call_time_seconds), color: colors.cyan },
        { label: 'Idle Time', value: formatTime(reports.overall?.total_idle_seconds), color: colors.red },
        { label: 'File Ratio', value: `${(reports.overall?.calls_to_file_ratio || 0).toFixed(1)}%`, color: colors.teal },
      ];

      const boxWidth = 25;
      const boxHeight = 18;
      const startX = 14;
      metrics.forEach((metric, i) => {
        const x = startX + (i * (boxWidth + 3));
        doc.setFillColor(...metric.color);
        doc.roundedRect(x, yPos, boxWidth, boxHeight, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(String(metric.value), x + boxWidth / 2, yPos + 8, { align: 'center' });
        doc.setFontSize(5);
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
        formatTime(tc.avg_call_time_seconds),
        formatTime(tc.total_idle_seconds),
        `${(tc.calls_to_file_ratio || 0).toFixed(1)}%`
      ]);

      autoTable(doc, {
        startY: yPos,
        head: [['Name', 'Status', 'Calls', 'Leads', 'File', 'Pres', 'Talk', 'Avg', 'Idle', 'File %']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: colors.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 13 },
          2: { cellWidth: 11, halign: 'center' },
          3: { cellWidth: 11, halign: 'center' },
          4: { cellWidth: 11, halign: 'center' },
          5: { cellWidth: 11, halign: 'center' },
          6: { cellWidth: 16, halign: 'center' },
          7: { cellWidth: 14, halign: 'center' },
          8: { cellWidth: 16, halign: 'center' },
          9: { cellWidth: 14, halign: 'center' },
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
            if (data.column.index === 7) data.cell.styles.textColor = colors.cyan;
            if (data.column.index === 8) data.cell.styles.textColor = colors.red;
            if (data.column.index === 9) data.cell.styles.textColor = colors.teal;
          }
        }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // HOURLY REPORT (new page) - Matching UI Design Exactly with separate CPLF columns
    if (hourlyReports) {
      doc.addPage('l'); // Landscape for wider table
      const landPageWidth = doc.internal.pageSize.getWidth();
      yPos = 15;

      // Header for hourly report - Green gradient style matching UI
      doc.setFillColor(...colors.primary);
      doc.rect(0, 0, landPageWidth, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Caller-wise Hourly Report', 14, 14);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('C = Calls, P = Presentations, L = Leads, F = File', 14, 23);
      doc.text(`Date: ${hourlyDate}`, landPageWidth - 14, 14, { align: 'right' });
      yPos = 36;

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
        // Build header row with hours and TOTAL
        const headerRow = ['Telecaller'];
        sortedHours.forEach(hour => {
          headerRow.push(`${hour.toString().padStart(2, '0')}:00`);
          headerRow.push(''); // Span for P
          headerRow.push(''); // Span for L
          headerRow.push(''); // Span for F
        });
        headerRow.push('TOTAL');
        headerRow.push('');
        headerRow.push('');
        headerRow.push('');

        // Build sub-header row with C P L F
        const subHeaderRow = [''];
        for (let i = 0; i <= sortedHours.length; i++) {
          subHeaderRow.push('C');
          subHeaderRow.push('P');
          subHeaderRow.push('L');
          subHeaderRow.push('F');
        }

        // Build data rows
        const bodyData = [];
        
        hourlyReports.telecallers.forEach(tc => {
          const row = [tc.user_name];
          sortedHours.forEach(hour => {
            const data = getHourData(tc, hour);
            row.push(data.calls > 0 ? data.calls : '-');
            row.push(data.presentations > 0 ? data.presentations : '-');
            row.push(data.leads > 0 ? data.leads : '-');
            row.push(data.file > 0 ? data.file : '-');
          });
          // TOTAL column
          row.push(tc.total_calls || 0);
          row.push(tc.total_presentations || 0);
          row.push(tc.total_leads || 0);
          row.push(tc.total_file || 0);
          bodyData.push(row);
        });

        // TOTAL row
        const totalRow = ['TOTAL'];
        sortedHours.forEach(hour => {
          const totals = hourlyReports.telecallers.reduce((acc, tc) => {
            const data = getHourData(tc, hour);
            return {
              c: acc.c + (data.calls || 0),
              p: acc.p + (data.presentations || 0),
              l: acc.l + (data.leads || 0),
              f: acc.f + (data.file || 0)
            };
          }, { c: 0, p: 0, l: 0, f: 0 });
          totalRow.push(totals.c || '-');
          totalRow.push(totals.p || '-');
          totalRow.push(totals.l || '-');
          totalRow.push(totals.f || '-');
        });
        // Grand totals
        const grandTotals = {
          c: hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_calls || 0), 0),
          p: hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_presentations || 0), 0),
          l: hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_leads || 0), 0),
          f: hourlyReports.telecallers.reduce((sum, tc) => sum + (tc.total_file || 0), 0)
        };
        totalRow.push(grandTotals.c);
        totalRow.push(grandTotals.p);
        totalRow.push(grandTotals.l);
        totalRow.push(grandTotals.f);
        bodyData.push(totalRow);

        // Calculate column widths
        const totalDataCols = (sortedHours.length + 1) * 4; // Each hour has 4 columns (C,P,L,F)
        const telecallerColWidth = 40;
        const availableWidth = landPageWidth - telecallerColWidth - 16;
        const dataColWidth = Math.max(8, availableWidth / totalDataCols);

        const columnStyles = { 
          0: { cellWidth: telecallerColWidth, halign: 'left', fontStyle: 'bold' } 
        };
        for (let i = 1; i <= totalDataCols; i++) {
          columnStyles[i] = { cellWidth: dataColWidth, halign: 'center' };
        }

        autoTable(doc, {
          startY: yPos,
          head: [headerRow, subHeaderRow],
          body: bodyData,
          theme: 'grid',
          styles: {
            lineColor: [220, 220, 220],
            lineWidth: 0.3,
            fontSize: 7,
            cellPadding: 2,
          },
          headStyles: { 
            fillColor: [245, 245, 245], 
            textColor: [60, 60, 60], 
            fontStyle: 'bold', 
            fontSize: 7,
            halign: 'center',
            cellPadding: 2,
          },
          bodyStyles: { fontSize: 7, halign: 'center', cellPadding: 2 },
          columnStyles: columnStyles,
          margin: { left: 8, right: 8 },
          didParseCell: function(data) {
            const totalDataCols = (sortedHours.length + 1) * 4;
            const isTotalRow = data.section === 'body' && data.row.index === bodyData.length - 1;
            const isTotalColStart = data.column.index === totalDataCols - 3;
            
            // Style the TOTAL row (last row) - green background
            if (isTotalRow) {
              data.cell.styles.fillColor = colors.primary;
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = 'bold';
            }
            
            // Style the TOTAL column section (last 4 columns) - light purple background
            const totalColStart = 1 + sortedHours.length * 4;
            if (data.section === 'body' && data.column.index >= totalColStart && !isTotalRow) {
              data.cell.styles.fillColor = [238, 235, 255]; // Light purple like UI
              data.cell.styles.fontStyle = 'bold';
            }
            
            // Style TOTAL header
            if (data.section === 'head' && data.row.index === 0 && data.column.index >= totalColStart) {
              data.cell.styles.fillColor = [238, 235, 255];
              data.cell.styles.fontStyle = 'bold';
            }
            
            // Telecaller name column
            if (data.section === 'body' && data.column.index === 0 && !isTotalRow) {
              data.cell.styles.halign = 'left';
              data.cell.styles.fontStyle = 'bold';
            }
            
            // Alternating row colors (not for TOTAL row or TOTAL columns)
            if (data.section === 'body' && !isTotalRow && data.column.index < totalColStart) {
              if (data.row.index % 2 === 1) {
                data.cell.styles.fillColor = [252, 252, 252];
              }
            }
            
            // Color code the sub-header row (C, P, L, F)
            if (data.section === 'head' && data.row.index === 1 && data.column.index > 0) {
              const colInGroup = (data.column.index - 1) % 4;
              if (colInGroup === 0) data.cell.styles.textColor = colors.secondary; // C - blue
              if (colInGroup === 1) data.cell.styles.textColor = colors.indigo;    // P - indigo
              if (colInGroup === 2) data.cell.styles.textColor = colors.teal;      // L - teal
              if (colInGroup === 3) data.cell.styles.textColor = colors.orange;    // F - orange
            }
            
            // Color code values in body
            if (data.section === 'body' && data.column.index > 0) {
              const colInGroup = (data.column.index - 1) % 4;
              if (!isTotalRow) {
                if (colInGroup === 0 && data.cell.raw !== '-') data.cell.styles.textColor = colors.secondary;
                if (colInGroup === 1 && data.cell.raw !== '-') data.cell.styles.textColor = colors.indigo;
                if (colInGroup === 2 && data.cell.raw !== '-') data.cell.styles.textColor = colors.teal;
                if (colInGroup === 3 && data.cell.raw !== '-') data.cell.styles.textColor = colors.orange;
              }
            }
          },
        });
        yPos = doc.lastAutoTable.finalY + 10;
      } else {
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(10);
        doc.text('No hourly data available', landPageWidth / 2, yPos + 20, { align: 'center' });
      }
    }

    // ACTIVITY LOG (new page) - Tabular format with separate columns for each break - Matching UI Design
    if (activityLogs && activityLogs.length > 0) {
      doc.addPage('l'); // Landscape for wider table with multiple break columns
      const landPageWidth = doc.internal.pageSize.getWidth();
      yPos = 15;

      // Calculate max breaks across all telecallers
      const maxBreaks = Math.max(
        ...activityLogs.map(group => {
          const breakStarts = (group.activities || []).filter(a => a.action === 'break_start');
          return breakStarts.length;
        }),
        1
      );

      // Header for activity log - Purple gradient style matching UI
      doc.setFillColor(...colors.purple);
      doc.rect(0, 0, landPageWidth, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Telecaller Activity Log', 14, 14);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Daily login, break, and logout times', 14, 23);
      doc.text(`Date: ${activityDate}`, landPageWidth - 14, 14, { align: 'right' });
      yPos = 36;

      const formatTime = (ts) => {
        if (!ts) return '-';
        return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      };

      // Build dynamic headers matching UI exactly
      const headers = ['Telecaller', 'Login'];
      for (let i = 0; i < maxBreaks; i++) {
        headers.push(`Break ${i + 1} From`);
        headers.push(`Break ${i + 1} To`);
      }
      headers.push('Logout');

      // Build table data with dynamic break columns
      const activityTableData = activityLogs.map(group => {
        const loginTime = group.activities?.find(a => a.action === 'login')?.timestamp;
        const logoutTime = group.activities?.find(a => a.action === 'logout')?.timestamp;
        const breakStarts = group.activities?.filter(a => a.action === 'break_start') || [];
        const breakEnds = group.activities?.filter(a => a.action === 'break_end') || [];
        
        const row = [group.user_name, formatTime(loginTime)];
        for (let i = 0; i < maxBreaks; i++) {
          row.push(formatTime(breakStarts[i]?.timestamp));
          row.push(formatTime(breakEnds[i]?.timestamp));
        }
        row.push(formatTime(logoutTime));
        return row;
      });

      // Calculate column widths dynamically to fit all columns - ensuring nothing gets cut off
      const totalCols = 2 + maxBreaks * 2 + 1; // Telecaller + Login + breaks + Logout
      const landMargin = 8;
      const usableWidth = landPageWidth - (landMargin * 2);
      
      // Adjust font and cell padding based on number of columns
      const needsCompactMode = totalCols > 7;
      const fontSize = needsCompactMode ? 7 : 8;
      const cellPadding = needsCompactMode ? 2 : 3;
      
      // Calculate column widths to ensure everything fits
      const telecallerColWidth = needsCompactMode ? 35 : 45;
      const availableForOthers = usableWidth - telecallerColWidth;
      const otherColWidth = availableForOthers / (totalCols - 1);
      
      const columnStyles = {
        0: { cellWidth: telecallerColWidth, halign: 'left', fontStyle: 'bold' },
      };
      for (let i = 1; i < totalCols; i++) {
        columnStyles[i] = { cellWidth: otherColWidth, halign: 'center' };
      }

      autoTable(doc, {
        startY: yPos,
        head: [headers],
        body: activityTableData,
        theme: 'grid',
        tableWidth: usableWidth,
        styles: {
          lineColor: [220, 220, 220],
          lineWidth: 0.3,
          fontSize: fontSize,
          cellPadding: cellPadding,
          overflow: 'linebreak',
        },
        headStyles: { 
          fillColor: [245, 245, 245], 
          textColor: [60, 60, 60], 
          fontStyle: 'bold', 
          fontSize: fontSize,
          halign: 'center',
          cellPadding: cellPadding,
        },
        bodyStyles: { fontSize: fontSize, halign: 'center', cellPadding: cellPadding },
        columnStyles: columnStyles,
        margin: { left: landMargin, right: landMargin },
        didParseCell: function(data) {
          if (data.section === 'body') {
            // Telecaller name column
            if (data.column.index === 0) {
              data.cell.styles.halign = 'left';
              data.cell.styles.fontStyle = 'bold';
            }
            // Login column - green background and text like UI
            if (data.column.index === 1 && data.cell.raw !== '-') {
              data.cell.styles.textColor = colors.primary;
              data.cell.styles.fontStyle = 'bold';
            }
            // Break columns - orange text like UI (indices 2 to 2 + maxBreaks*2 - 1)
            if (data.column.index >= 2 && data.column.index < 2 + maxBreaks * 2 && data.cell.raw !== '-') {
              data.cell.styles.textColor = colors.orange;
              data.cell.styles.fontStyle = 'bold';
            }
            // Logout column - red text like UI (last column)
            if (data.column.index === 2 + maxBreaks * 2 && data.cell.raw !== '-') {
              data.cell.styles.textColor = colors.red;
              data.cell.styles.fontStyle = 'bold';
            }
            // Alternating row colors
            if (data.row.index % 2 === 1) {
              data.cell.styles.fillColor = [252, 252, 252];
            }
          }
          // Style header columns with matching colors
          if (data.section === 'head') {
            if (data.column.index === 1) data.cell.styles.textColor = colors.primary;
            if (data.column.index >= 2 && data.column.index < 2 + maxBreaks * 2) data.cell.styles.textColor = colors.orange;
            if (data.column.index === 2 + maxBreaks * 2) data.cell.styles.textColor = colors.red;
          }
        }
      });
      yPos = doc.lastAutoTable.finalY + 10;
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
        <button
          onClick={() => setActiveTab('calls')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'calls'
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <PhoneCall size={16} />
          Call Log
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
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
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
                    <p className="text-xl font-bold text-cyan-600">
                      {formatTime(reports.overall.avg_call_time_seconds)}
                    </p>
                    <p className="text-xs text-gray-500">Avg Call</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-red-500">
                      {formatTime(reports.overall.total_idle_seconds)}
                    </p>
                    <p className="text-xs text-gray-500">Idle Time</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-teal-600">
                      {(reports.overall.calls_to_file_ratio || 0).toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500">File Ratio</p>
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
                      <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mb-4 p-3 bg-white rounded-lg">
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
                          <p className="text-lg font-bold text-cyan-600">{formatTime(tc.avg_call_time_seconds)}</p>
                          <p className="text-xs text-gray-500">Avg Call</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-red-500">{formatTime(tc.total_idle_seconds)}</p>
                          <p className="text-xs text-gray-500">Idle Time</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-teal-600">{(tc.calls_to_file_ratio || 0).toFixed(1)}%</p>
                          <p className="text-xs text-gray-500">File Ratio</p>
                        </div>
                      </div>

                      {/* Status Breakdown */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">STATUS BREAKDOWN</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'new', label: 'New', color: '#4CAF50' },
                            { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
                            { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
                            { key: 'presentation', label: 'Presentation', color: '#673AB7' },
                            { key: 'leads', label: 'Lead', color: '#00C853' },
                            { key: 'file', label: 'File', color: '#FF9800' },
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
                            { key: 'calls_not_connecting', label: 'Not Connecting', color: '#9E9E9E' },
                            { key: 'calls_no_answer', label: 'No Answer', color: '#F44336' },
                            { key: 'calls_busy', label: 'Busy', color: '#FF9800' },
                            { key: 'calls_wrong_number', label: 'Wrong Number', color: '#E91E63' },
                            { key: 'calls_voicemail', label: 'Voicemail', color: '#9C27B0' },
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
                (() => {
                  // Calculate max breaks across all telecallers
                  const maxBreaks = Math.max(
                    ...activityLogs.map(group => {
                      const breakStarts = (group.activities || []).filter(a => a.action === 'break_start');
                      return breakStarts.length;
                    }),
                    1 // At least show 1 break column
                  );
                  
                  return (
                    <div className="card overflow-hidden">
                      <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-3">
                        <h3 className="text-lg font-semibold text-white">Telecaller Activity Log</h3>
                        <p className="text-purple-100 text-xs mt-1">Daily login, break, and logout times</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="text-left py-3 px-4 font-bold text-gray-800 border-b-2 border-gray-300 sticky left-0 bg-gray-100 min-w-[150px] z-10">
                                Telecaller
                              </th>
                              <th className="text-center py-3 px-4 font-bold text-green-700 border-b-2 border-gray-300 min-w-[90px]">
                                <div className="flex items-center justify-center gap-1">
                                  <LogIn size={14} />
                                  Login
                                </div>
                              </th>
                              {/* Dynamic break columns */}
                              {Array.from({ length: maxBreaks }, (_, i) => (
                                <React.Fragment key={`break-header-${i}`}>
                                  <th className="text-center py-3 px-3 font-bold text-orange-600 border-b-2 border-gray-300 min-w-[85px]">
                                    <div className="flex items-center justify-center gap-1">
                                      <Coffee size={12} />
                                      Break {i + 1} From
                                    </div>
                                  </th>
                                  <th className="text-center py-3 px-3 font-bold text-orange-600 border-b-2 border-gray-300 min-w-[85px]">
                                    <div className="flex items-center justify-center gap-1">
                                      <Coffee size={12} />
                                      Break {i + 1} To
                                    </div>
                                  </th>
                                </React.Fragment>
                              ))}
                              <th className="text-center py-3 px-4 font-bold text-red-600 border-b-2 border-gray-300 min-w-[90px]">
                                <div className="flex items-center justify-center gap-1">
                                  <LogOut size={14} />
                                  Logout
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {activityLogs.map((group, idx) => {
                              const activities = group.activities || [];
                              const loginActivity = activities.find(a => a.action === 'login');
                              const logoutActivity = activities.find(a => a.action === 'logout');
                              const breakStarts = activities.filter(a => a.action === 'break_start');
                              const breakEnds = activities.filter(a => a.action === 'break_end');
                              
                              return (
                                <tr key={group.user_id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-purple-50 transition-colors`}>
                                  <td className={`py-3 px-4 font-semibold text-gray-900 sticky left-0 z-10 border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                                    {group.user_name}
                                  </td>
                                  <td className="py-3 px-4 text-center border-b border-gray-200">
                                    {loginActivity?.timestamp ? (
                                      <span className="inline-block px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold text-xs">
                                        {formatTimestamp(loginActivity.timestamp)}
                                      </span>
                                    ) : <span className="text-gray-300">-</span>}
                                  </td>
                                  {/* Dynamic break cells */}
                                  {Array.from({ length: maxBreaks }, (_, i) => (
                                    <React.Fragment key={`break-cell-${group.user_id}-${i}`}>
                                      <td className="py-3 px-3 text-center border-b border-gray-200">
                                        {breakStarts[i]?.timestamp ? (
                                          <span className="inline-block px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold text-xs">
                                            {formatTimestamp(breakStarts[i].timestamp)}
                                          </span>
                                        ) : <span className="text-gray-300">-</span>}
                                      </td>
                                      <td className="py-3 px-3 text-center border-b border-gray-200">
                                        {breakEnds[i]?.timestamp ? (
                                          <span className="inline-block px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold text-xs">
                                            {formatTimestamp(breakEnds[i].timestamp)}
                                          </span>
                                        ) : <span className="text-gray-300">-</span>}
                                      </td>
                                    </React.Fragment>
                                  ))}
                                  <td className="py-3 px-4 text-center border-b border-gray-200">
                                    {logoutActivity?.timestamp ? (
                                      <span className="inline-block px-2 py-1 rounded-full bg-red-100 text-red-700 font-semibold text-xs">
                                        {formatTimestamp(logoutActivity.timestamp)}
                                      </span>
                                    ) : <span className="text-gray-300">-</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()
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

      {/* Call Log Tab Content */}
      {activeTab === 'calls' && (
        <>
          {/* Date Filter and Telecaller Filter */}
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={callsFromDate}
                  onChange={(e) => setCallsFromDate(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={callsToDate}
                  onChange={(e) => setCallsToDate(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telecaller</label>
                <select
                  value={selectedTelecaller}
                  onChange={(e) => setSelectedTelecaller(e.target.value)}
                  className="input-field min-w-[180px]"
                >
                  <option value="all">All Telecallers</option>
                  {telecallers.map(tc => (
                    <option key={tc.id} value={tc.id}>{tc.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => fetchDetailedCalls(true)}
                className="btn-primary flex items-center gap-2"
              >
                <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                Load
              </button>
              <button
                onClick={() => downloadCallsCSV()}
                disabled={!detailedCalls?.calls?.length}
                className="btn-secondary flex items-center gap-2"
              >
                <Download size={16} />
                Download CSV
              </button>
            </div>
          </div>

          {/* Call Log Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {detailedCalls?.calls?.length > 0 ? (
                <div className="card overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3">
                    <h3 className="text-lg font-semibold text-white">Detailed Call Report</h3>
                    <p className="text-blue-100 text-xs mt-1">
                      {detailedCalls.total_count} calls from {callsFromDate} to {callsToDate}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="text-left py-3 px-3 font-bold text-gray-800 border-b-2 border-gray-300 min-w-[100px]">Date</th>
                          <th className="text-left py-3 px-3 font-bold text-gray-800 border-b-2 border-gray-300 min-w-[80px]">Time</th>
                          <th className="text-left py-3 px-3 font-bold text-green-700 border-b-2 border-gray-300 min-w-[130px]">
                            <div className="flex items-center gap-1"><User size={14} />Caller</div>
                          </th>
                          <th className="text-left py-3 px-3 font-bold text-blue-700 border-b-2 border-gray-300 min-w-[150px]">Customer Name</th>
                          <th className="text-left py-3 px-3 font-bold text-gray-800 border-b-2 border-gray-300 min-w-[120px]">Mobile</th>
                          <th className="text-left py-3 px-3 font-bold text-gray-800 border-b-2 border-gray-300 min-w-[100px]">City</th>
                          <th className="text-center py-3 px-3 font-bold text-orange-600 border-b-2 border-gray-300 min-w-[110px]">Call Outcome</th>
                          <th className="text-center py-3 px-3 font-bold text-purple-600 border-b-2 border-gray-300 min-w-[90px]">Duration</th>
                          <th className="text-center py-3 px-3 font-bold text-teal-600 border-b-2 border-gray-300 min-w-[100px]">Lead Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailedCalls.calls.map((call, idx) => (
                          <tr key={call.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                            <td className="py-2 px-3 border-b border-gray-200 text-gray-700">{call.call_date}</td>
                            <td className="py-2 px-3 border-b border-gray-200 text-gray-700">{call.call_time}</td>
                            <td className="py-2 px-3 border-b border-gray-200 font-medium text-green-700">{call.caller_name}</td>
                            <td className="py-2 px-3 border-b border-gray-200 font-medium text-gray-900">{call.customer_name}</td>
                            <td className="py-2 px-3 border-b border-gray-200 text-gray-700">{call.customer_phone}</td>
                            <td className="py-2 px-3 border-b border-gray-200 text-gray-600">{call.customer_city || '-'}</td>
                            <td className="py-2 px-3 border-b border-gray-200 text-center">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                                call.call_outcome === 'connected' ? 'bg-green-100 text-green-700' :
                                call.call_outcome === 'no_answer' ? 'bg-red-100 text-red-700' :
                                call.call_outcome === 'busy' ? 'bg-orange-100 text-orange-700' :
                                call.call_outcome === 'not_connecting' ? 'bg-gray-100 text-gray-700' :
                                call.call_outcome === 'wrong_number' ? 'bg-purple-100 text-purple-700' :
                                call.call_outcome === 'voicemail' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {call.call_outcome?.replace('_', ' ') || '-'}
                              </span>
                            </td>
                            <td className="py-2 px-3 border-b border-gray-200 text-center font-medium text-purple-700">
                              {call.call_duration_formatted || '0s'}
                            </td>
                            <td className="py-2 px-3 border-b border-gray-200 text-center">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                call.lead_status === 'new' ? 'bg-blue-100 text-blue-700' :
                                call.lead_status === 'contacted' ? 'bg-yellow-100 text-yellow-700' :
                                call.lead_status === 'follow_up' ? 'bg-orange-100 text-orange-700' :
                                call.lead_status === 'presentation' ? 'bg-indigo-100 text-indigo-700' :
                                call.lead_status === 'leads' ? 'bg-teal-100 text-teal-700' :
                                call.lead_status === 'file' ? 'bg-green-100 text-green-700' :
                                call.lead_status === 'not_interested' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {call.lead_status?.replace('_', ' ') || '-'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="card p-8 text-center">
                  <PhoneCall size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-500">No call records for the selected period</p>
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
