import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { getDailyTrackingSheet, getTelecallers } from '../services/api';

const { width } = Dimensions.get('window');

const TrackingScreen = ({ user }) => {
  const [data, setData] = useState(null);
  const [telecallers, setTelecallers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const isAdmin = user?.role === 'admin';

  // Load telecallers list (admin only)
  useEffect(() => {
    if (isAdmin) {
      loadTelecallers();
    } else {
      // For telecallers, use their own ID
      setSelectedUser(user?.id);
    }
  }, [isAdmin, user]);

  const loadTelecallers = async () => {
    try {
      const response = await getTelecallers();
      setTelecallers(response);
      if (response.length > 0 && !selectedUser) {
        setSelectedUser(response[0].id);
      }
    } catch (error) {
      console.error('Error loading telecallers:', error);
    }
  };

  const loadData = useCallback(async () => {
    if (!selectedUser) return;
    
    try {
      const response = await getDailyTrackingSheet(selectedUser, selectedMonth, selectedYear);
      // Find the data for selected user
      const userData = Array.isArray(response) 
        ? response.find(d => d.user_id === selectedUser) 
        : response;
      setData(userData);
    } catch (error) {
      console.error('Error loading tracking data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedUser, selectedMonth, selectedYear]);

  useEffect(() => {
    if (selectedUser) {
      setLoading(true);
      loadData();
    }
  }, [loadData, selectedUser]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const getMonthName = (month, year) => {
    return new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  };

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

  // Calculate totals from daily data
  const calculateTotals = () => {
    if (!data?.daily_data) return null;
    
    const dailyData = data.daily_data;
    return {
      totalCalls: dailyData.reduce((sum, d) => sum + (d.calls || 0), 0),
      totalConnected: dailyData.reduce((sum, d) => sum + (d.connected || 0), 0),
      totalTalkTime: dailyData.reduce((sum, d) => sum + (d.talk_time_seconds || 0), 0),
      totalFiles: dailyData.reduce((sum, d) => sum + (d.files || 0), 0),
      totalLeads: dailyData.reduce((sum, d) => sum + (d.leads || 0), 0),
      totalPresentations: dailyData.reduce((sum, d) => sum + (d.presentations || 0), 0),
      daysWorked: dailyData.length,
    };
  };

  const totals = calculateTotals();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.loadingText}>Loading tracking data...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Daily Tracking</Text>
        <Text style={styles.headerSubtitle}>Performance Report</Text>
      </View>

      {/* Admin: User Selector */}
      {isAdmin && telecallers.length > 0 && (
        <View style={styles.userSelector}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {telecallers.map(tc => (
              <TouchableOpacity
                key={tc.id}
                style={[
                  styles.userChip,
                  selectedUser === tc.id && styles.userChipActive,
                ]}
                onPress={() => setSelectedUser(tc.id)}
              >
                <Text
                  style={[
                    styles.userChipText,
                    selectedUser === tc.id && styles.userChipTextActive,
                  ]}
                >
                  {tc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Month Navigator */}
      <View style={styles.monthNavigator}>
        <TouchableOpacity onPress={prevMonth} style={styles.navButton}>
          <Text style={styles.navButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{getMonthName(selectedMonth, selectedYear)}</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.navButton}>
          <Text style={styles.navButtonText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      {totals && (
        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Month Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totals.totalCalls}</Text>
              <Text style={styles.summaryLabel}>Total Calls</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totals.totalConnected}</Text>
              <Text style={styles.summaryLabel}>Connected</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{formatTime(totals.totalTalkTime)}</Text>
              <Text style={styles.summaryLabel}>Talk Time</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totals.totalPresentations}</Text>
              <Text style={styles.summaryLabel}>Presentations</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totals.totalLeads}</Text>
              <Text style={styles.summaryLabel}>Leads</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totals.totalFiles}</Text>
              <Text style={styles.summaryLabel}>Files</Text>
            </View>
          </View>

          {/* Averages */}
          <View style={styles.averagesRow}>
            <View style={styles.averageItem}>
              <Text style={styles.averageValue}>
                {totals.daysWorked > 0 ? Math.round(totals.totalCalls / totals.daysWorked) : 0}
              </Text>
              <Text style={styles.averageLabel}>Avg Calls/Day</Text>
            </View>
            <View style={styles.averageItem}>
              <Text style={styles.averageValue}>
                {totals.daysWorked > 0 ? formatTime(Math.round(totals.totalTalkTime / totals.daysWorked)) : '0m'}
              </Text>
              <Text style={styles.averageLabel}>Avg Talk/Day</Text>
            </View>
            <View style={styles.averageItem}>
              <Text style={styles.averageValue}>{totals.daysWorked}</Text>
              <Text style={styles.averageLabel}>Days Worked</Text>
            </View>
          </View>
        </View>
      )}

      {/* Daily Data Table */}
      <View style={styles.tableSection}>
        <Text style={styles.sectionTitle}>Daily Breakdown</Text>
        
        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Date</Text>
          <Text style={styles.tableHeaderCell}>Calls</Text>
          <Text style={styles.tableHeaderCell}>Conn</Text>
          <Text style={styles.tableHeaderCell}>Talk</Text>
          <Text style={styles.tableHeaderCell}>Pres</Text>
          <Text style={styles.tableHeaderCell}>Leads</Text>
          <Text style={styles.tableHeaderCell}>Files</Text>
        </View>

        {/* Table Rows */}
        {data?.daily_data && data.daily_data.length > 0 ? (
          data.daily_data.map((day, index) => (
            <View 
              key={day.date} 
              style={[
                styles.tableRow,
                index % 2 === 0 && styles.tableRowAlt,
              ]}
            >
              <View style={[styles.tableCell, { flex: 1.5 }]}>
                <Text style={styles.dateText}>{day.date.slice(5)}</Text>
                <Text style={styles.dayText}>{day.day}</Text>
              </View>
              <Text style={styles.tableCell}>{day.calls || 0}</Text>
              <Text style={[styles.tableCell, day.connected > 0 && styles.connectedCell]}>
                {day.connected || 0}
              </Text>
              <Text style={styles.tableCellSmall}>{formatTime(day.talk_time_seconds)}</Text>
              <Text style={[styles.tableCell, day.presentations > 0 && styles.presentationCell]}>
                {day.presentations || 0}
              </Text>
              <Text style={[styles.tableCell, day.leads > 0 && styles.leadsCell]}>
                {day.leads || 0}
              </Text>
              <Text style={[styles.tableCell, day.files > 0 && styles.filesCell]}>
                {day.files || 0}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyTable}>
            <Text style={styles.emptyTableText}>No data for this month</Text>
          </View>
        )}

        {/* Table Footer (Totals) */}
        {totals && data?.daily_data?.length > 0 && (
          <View style={styles.tableFooter}>
            <Text style={[styles.tableFooterCell, { flex: 1.5 }]}>TOTAL</Text>
            <Text style={styles.tableFooterCell}>{totals.totalCalls}</Text>
            <Text style={styles.tableFooterCell}>{totals.totalConnected}</Text>
            <Text style={styles.tableFooterCellSmall}>{formatTime(totals.totalTalkTime)}</Text>
            <Text style={styles.tableFooterCell}>{totals.totalPresentations}</Text>
            <Text style={styles.tableFooterCell}>{totals.totalLeads}</Text>
            <Text style={styles.tableFooterCell}>{totals.totalFiles}</Text>
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
  },
  header: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#16a34a',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#dcfce7',
    marginTop: 4,
  },
  userSelector: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  userChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 4,
  },
  userChipActive: {
    backgroundColor: '#16a34a',
  },
  userChipText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  userChipTextActive: {
    color: '#fff',
  },
  monthNavigator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  navButton: {
    padding: 8,
    paddingHorizontal: 16,
  },
  navButtonText: {
    fontSize: 20,
    color: '#16a34a',
    fontWeight: 'bold',
  },
  monthText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  summarySection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  summaryCard: {
    width: (width - 48) / 3,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    margin: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  averagesRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  averageItem: {
    flex: 1,
    alignItems: 'center',
  },
  averageValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  averageLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  tableSection: {
    padding: 16,
    paddingTop: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#16a34a',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 10,
  },
  tableHeaderCell: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    backgroundColor: '#f9fafb',
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    textAlign: 'center',
  },
  tableCellSmall: {
    flex: 1,
    fontSize: 11,
    color: '#374151',
    textAlign: 'center',
  },
  dateText: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
  },
  dayText: {
    fontSize: 10,
    color: '#9ca3af',
  },
  connectedCell: {
    color: '#16a34a',
    fontWeight: '600',
  },
  presentationCell: {
    color: '#f59e0b',
    fontWeight: '600',
  },
  leadsCell: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  filesCell: {
    color: '#ef4444',
    fontWeight: '600',
  },
  tableFooter: {
    flexDirection: 'row',
    backgroundColor: '#16a34a',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    padding: 10,
  },
  tableFooterCell: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  tableFooterCellSmall: {
    flex: 1,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyTable: {
    backgroundColor: '#fff',
    padding: 40,
    alignItems: 'center',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  emptyTableText: {
    color: '#9ca3af',
    fontSize: 14,
  },
});

export default TrackingScreen;
