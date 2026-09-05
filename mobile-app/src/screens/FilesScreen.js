import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Alert,
} from 'react-native';
import { getFiles, getFilesStats, getOpsTeam, bulkAssignFiles } from '../services/api';

const FILE_STATUS_COLORS = {
  new: '#3B82F6',
  contacted: '#06B6D4',
  documents_collected: '#8B5CF6',
  not_eligible: '#EF4444',
  sent_to_bank: '#6366F1',
  login: '#14B8A6',
  not_login: '#F97316',
  approved: '#22C55E',
  declined: '#EF4444',
  disbursed: '#10B981',
  not_disbursed: '#F43F5E',
  rejected: '#6B7280',
};

const FILE_STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  documents_collected: 'Docs Collected',
  not_eligible: 'Not Eligible',
  sent_to_bank: 'Sent to Bank',
  login: 'Login',
  not_login: 'Not Login',
  approved: 'Approved',
  declined: 'Declined',
  disbursed: 'Disbursed',
  not_disbursed: 'Not Disbursed',
  rejected: 'Rejected',
};

const FilesScreen = ({ navigation, user }) => {
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loanType, setLoanType] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [opsTeam, setOpsTeam] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Same filter scope applied to BOTH stats cards and the file list.
  const buildParams = () => {
    const params = {};
    if (statusFilter) params.file_status = statusFilter;
    if (loanType) params.loan_types = loanType;
    const now = new Date();
    const iso = (d) => d.toISOString();
    if (datePreset === 'today') {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      params.start_date = iso(s); params.end_date = iso(now);
    } else if (datePreset === 'yesterday') {
      const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 999);
      params.start_date = iso(s); params.end_date = iso(e);
    } else if (datePreset === 'week') {
      const s = new Date(now); s.setDate(s.getDate() - s.getDay()); s.setHours(0, 0, 0, 0);
      params.start_date = iso(s); params.end_date = iso(now);
    } else if (datePreset === 'month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      params.start_date = iso(s); params.end_date = iso(now);
    }
    return params;
  };

  useEffect(() => {
    loadData();
    loadOpsTeam();
  }, []);

  useEffect(() => {
    setPage(1);
    setFiles([]);
    loadFiles(1, true);
    loadStats();
  }, [statusFilter, loanType, datePreset]);

  const loadData = async () => {
    await Promise.all([loadFiles(1, true), loadStats()]);
  };

  const loadFiles = async (pageNum = 1, reset = false) => {
    try {
      if (reset) setLoading(true);
      const params = { page: pageNum, limit: 20, ...buildParams() };

      const response = await getFiles(params);
      const newFiles = response.files || [];

      if (reset) {
        setFiles(newFiles);
      } else {
        setFiles(prev => [...prev, ...newFiles]);
      }

      setHasMore(pageNum < (response.pagination?.pages || 1));
      setPage(pageNum);
    } catch (error) {
      console.error('Error loading files:', error);
      Alert.alert('Error', 'Failed to load files');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadStats = async () => {
    try {
      // Stats represent the COMPLETE filtered dataset (same filters as the list).
      const response = await getFilesStats(buildParams());
      setStats(response);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadOpsTeam = async () => {
    try {
      const response = await getOpsTeam();
      setOpsTeam(response || []);
    } catch (error) {
      console.error('Error loading ops team:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await loadData();
  }, [statusFilter]);

  const loadMore = () => {
    if (!loading && hasMore) {
      loadFiles(page + 1, false);
    }
  };

  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev =>
      prev.includes(fileId)
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleBulkAssign = async (assigneeId) => {
    if (selectedFiles.length === 0) return;
    
    try {
      await bulkAssignFiles(selectedFiles, assigneeId);
      Alert.alert('Success', `${selectedFiles.length} files assigned`);
      setSelectedFiles([]);
      onRefresh();
    } catch (error) {
      Alert.alert('Error', 'Failed to assign files');
    }
  };

  const filteredFiles = files.filter(file => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      (file.name || '').toLowerCase().includes(search) ||
      (file.phone || '').includes(search) ||
      (file.email || '').toLowerCase().includes(search)
    );
  });

  const fmtAmt = (v) => {
    const n = Number(v) || 0;
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
    return `₹${n}`;
  };

  const renderStatsCard = (title, value, color) => (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value || 0}</Text>
      <Text style={styles.statLabel}>{title}</Text>
    </View>
  );

  const renderFileItem = ({ item }) => {
    const statusColor = FILE_STATUS_COLORS[item.file_status] || FILE_STATUS_COLORS.new;
    const statusLabel = FILE_STATUS_LABELS[item.file_status] || 'New';
    const isSelected = selectedFiles.includes(item.id);
    const assignee = opsTeam.find(o => o.id === item.file_assigned_to);

    return (
      <TouchableOpacity
        style={[styles.fileCard, isSelected && styles.fileCardSelected]}
        onPress={() => navigation.navigate('FileDetail', { fileId: item.id })}
        onLongPress={isAdmin ? () => toggleFileSelection(item.id) : undefined}
      >
        {isAdmin && selectedFiles.length > 0 && (
          <TouchableOpacity
            style={[styles.checkbox, isSelected && styles.checkboxSelected]}
            onPress={() => toggleFileSelection(item.id)}
          >
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        )}
        <View style={styles.fileInfo}>
          <Text style={styles.fileName}>{item.name || 'Unnamed'}</Text>
          <Text style={styles.filePhone}>{item.phone}</Text>
          {item.requirement && (
            <Text style={styles.fileRequirement}>{item.requirement}</Text>
          )}
          {assignee && (
            <Text style={styles.assignee}>👤 {assignee.full_name || assignee.name}</Text>
          )}
        </View>
        <View style={styles.fileRight}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {item.updated_at && (
            <Text style={styles.fileDate}>
              {new Date(item.updated_at).toLocaleDateString()}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderFilters = () => {
    const LOAN_TYPES = [
      { v: '', l: 'All Loans' }, { v: 'personal_loan', l: 'Personal' }, { v: 'home_loan', l: 'Home' },
      { v: 'business_loan', l: 'Business' }, { v: 'car_loan', l: 'Car' }, { v: 'lap', l: 'LAP' },
      { v: 'education_loan', l: 'Education' }, { v: 'gold_loan', l: 'Gold' },
    ];
    const DATES = [
      { v: 'all', l: 'All Time' }, { v: 'today', l: 'Today' }, { v: 'yesterday', l: 'Yesterday' },
      { v: 'week', l: 'This Week' }, { v: 'month', l: 'This Month' },
    ];
    return (
      <View style={styles.filtersContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !statusFilter && styles.filterChipActive]}
            onPress={() => setStatusFilter('')}
          >
            <Text style={[styles.filterChipText, !statusFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {Object.entries(FILE_STATUS_LABELS).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterChip, statusFilter === key && styles.filterChipActive]}
              onPress={() => setStatusFilter(key)}
              data-testid={`files-status-${key}`}
            >
              <Text style={[styles.filterChipText, statusFilter === key && styles.filterChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {LOAN_TYPES.map(lt => (
            <TouchableOpacity
              key={lt.v || 'all'}
              style={[styles.filterChip, loanType === lt.v && styles.filterChipLoan]}
              onPress={() => setLoanType(lt.v)}
              data-testid={`files-loan-${lt.v || 'all'}`}
            >
              <Text style={[styles.filterChipText, loanType === lt.v && styles.filterChipTextActive]}>{lt.l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {DATES.map(d => (
            <TouchableOpacity
              key={d.v}
              style={[styles.filterChip, datePreset === d.v && styles.filterChipDate]}
              onPress={() => setDatePreset(d.v)}
              data-testid={`files-date-${d.v}`}
            >
              <Text style={[styles.filterChipText, datePreset === d.v && styles.filterChipTextActive]}>{d.l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderBulkActions = () => {
    if (!isAdmin || selectedFiles.length === 0) return null;

    return (
      <View style={styles.bulkActionsBar}>
        <Text style={styles.bulkText}>{selectedFiles.length} selected</Text>
        <TouchableOpacity
          style={styles.bulkAssignBtn}
          onPress={() => {
            Alert.alert(
              'Assign Files',
              'Select team member',
              opsTeam.map(member => ({
                text: member.full_name || member.name,
                onPress: () => handleBulkAssign(member.id),
              })).concat([{ text: 'Cancel', style: 'cancel' }])
            );
          }}
        >
          <Text style={styles.bulkAssignText}>Assign</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.bulkClearBtn}
          onPress={() => setSelectedFiles([])}
        >
          <Text style={styles.bulkClearText}>Clear</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📁 Files</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      {stats && (
        <View style={styles.statsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {renderStatsCard('Total', stats.total_files, '#6B7280')}
            {renderStatsCard('New', stats.new, '#3B82F6')}
            {renderStatsCard('In Progress', stats.in_progress, '#F59E0B')}
            {renderStatsCard('Login', stats.login, '#6366F1')}
            {renderStatsCard('Approved', stats.approved, '#22C55E')}
            {renderStatsCard('Disbursed', stats.disbursed, '#10B981')}
            {renderStatsCard('Interim Rej', stats.interim_rejects, '#F97316')}
            {renderStatsCard('Final Rej', stats.final_rejections, '#EF4444')}
            {renderStatsCard('Approved ₹', fmtAmt(stats.total_approved_amount), '#22C55E')}
            {renderStatsCard('Disbursed ₹', fmtAmt(stats.total_disbursed_amount), '#10B981')}
            {renderStatsCard('Pipeline ₹', fmtAmt(stats.amt_in_pipeline), '#8B5CF6')}
          </ScrollView>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      {/* Filters */}
      {renderFilters()}

      {/* Bulk Actions */}
      {renderBulkActions()}

      {/* Files List */}
      {loading && page === 1 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      ) : filteredFiles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📁</Text>
          <Text style={styles.emptyText}>No files found</Text>
          <Text style={styles.emptySubtext}>Files appear when leads are marked as "File"</Text>
        </View>
      ) : (
        <FlatList
          data={filteredFiles}
          renderItem={renderFileItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loading && page > 1 ? (
              <ActivityIndicator style={styles.footerLoader} color="#16a34a" />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  refreshBtn: {
    padding: 8,
  },
  refreshText: {
    fontSize: 20,
  },
  statsContainer: {
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  statCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
    marginRight: 12,
    minWidth: 80,
    borderLeftWidth: 3,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  searchContainer: {
    padding: 12,
    backgroundColor: '#fff',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  filtersContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#16a34a',
  },
  filterChipLoan: {
    backgroundColor: '#2563eb',
  },
  filterChipDate: {
    backgroundColor: '#7c3aed',
  },
  filterChipText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  bulkActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#DCFCE7',
    borderBottomWidth: 1,
    borderBottomColor: '#BBF7D0',
  },
  bulkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#166534',
  },
  bulkAssignBtn: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  bulkAssignText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  bulkClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bulkClearText: {
    color: '#166534',
    fontWeight: '500',
    fontSize: 14,
  },
  listContent: {
    padding: 12,
  },
  fileCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  fileCardSelected: {
    backgroundColor: '#DCFCE7',
    borderWidth: 2,
    borderColor: '#16a34a',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  checkmark: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  filePhone: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 2,
  },
  fileRequirement: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  assignee: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  fileRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fileDate: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
  },
});

export default FilesScreen;
