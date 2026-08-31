import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLeads, getTelecallers } from '../services/api';
import { makePhoneCall } from '../services/callLogService';

const FILTER_STORAGE_KEY = '@data_screen_filters';

const DataScreen = ({ user }) => {
  const navigation = useNavigation();
  const [leads, setLeads] = useState([]);
  const [allLeads, setAllLeads] = useState([]); // Store all leads for counting
  const [filteredLeads, setFilteredLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [telecallers, setTelecallers] = useState([]);
  const [selectedTelecaller, setSelectedTelecaller] = useState('all');
  const [statusCounts, setStatusCounts] = useState({});
  const filtersLoaded = useRef(false);

  const isAdmin = user?.role === 'admin';

  // Status filter options (including 'new' for fresh data)
  const statuses = [
    { id: 'all', name: 'All', color: '#6b7280' },
    { id: 'new', name: 'New', color: '#3b82f6' },
    { id: 'follow_up', name: 'Follow Up', color: '#8b5cf6' },
    { id: 'not_interested', name: 'Not Interested', color: '#6b7280' },
    { id: 'leads', name: 'Lead', color: '#22c55e' },
    { id: 'file', name: 'File', color: '#ef4444' },
  ];

  // Call outcome filters (last call outcome)
  const callOutcomes = [
    { id: 'all', name: 'All', color: '#6b7280' },
    { id: 'connected', name: 'Connected', color: '#4CAF50' },
    { id: 'no_answer', name: 'No Answer', color: '#F44336' },
    { id: 'switched_off', name: 'Switched Off', color: '#9E9E9E' },
    { id: 'not_connecting', name: 'Not Connecting', color: '#9E9E9E' },
    { id: 'busy', name: 'Busy', color: '#FF9800' },
    { id: 'wrong_number', name: 'Wrong Number', color: '#E91E63' },
    { id: 'voicemail', name: 'Voicemail', color: '#9C27B0' },
  ];

  // Load saved filters on mount
  useEffect(() => {
    loadSavedFilters();
  }, []);

  // Save filters when they change
  useEffect(() => {
    if (filtersLoaded.current) {
      saveFilters();
    }
  }, [statusFilter, outcomeFilter, selectedTelecaller]);

  const loadSavedFilters = async () => {
    try {
      const saved = await AsyncStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) {
        const filters = JSON.parse(saved);
        setStatusFilter(filters.statusFilter || 'all');
        setOutcomeFilter(filters.outcomeFilter || 'all');
        setSelectedTelecaller(filters.selectedTelecaller || 'all');
      }
    } catch (error) {
      console.error('Error loading filters:', error);
    } finally {
      filtersLoaded.current = true;
    }
  };

  const saveFilters = async () => {
    try {
      await AsyncStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        statusFilter,
        outcomeFilter,
        selectedTelecaller,
      }));
    } catch (error) {
      console.error('Error saving filters:', error);
    }
  };

  // Calculate status counts from all leads
  const calculateStatusCounts = (leadsData) => {
    const counts = {};
    leadsData.forEach(lead => {
      const status = lead.status || 'new';
      counts[status] = (counts[status] || 0) + 1;
    });
    setStatusCounts(counts);
  };

  const loadLeads = useCallback(async (applyFilters = true) => {
    try {
      // First load ALL leads to get counts
      const allResponse = await getLeads({});
      setAllLeads(allResponse);
      calculateStatusCounts(allResponse);

      // Build params for filtered/searched leads
      let params = {};
      
      // If searching, pass search to backend for server-side search
      if (searchQuery && searchQuery.trim().length >= 2) {
        params.search = searchQuery.trim();
        // When searching, ignore other filters to search across all data
      } else if (applyFilters) {
        // Apply filters only when not searching
        if (statusFilter !== 'all') {
          params.status = statusFilter;
        }
        if (outcomeFilter !== 'all') {
          params.last_call_outcome = outcomeFilter;
        }
        if (isAdmin && selectedTelecaller !== 'all') {
          params.assigned_to = selectedTelecaller;
        }
      }
      
      const response = await getLeads(params);
      setLeads(response);
      
      // If server-side search was used, use results directly
      // Otherwise apply client-side filtering for immediate feedback
      if (searchQuery && searchQuery.trim().length >= 2) {
        setFilteredLeads(response);
      } else {
        filterLeads(response, searchQuery);
      }
    } catch (error) {
      console.error('Error loading leads:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, outcomeFilter, selectedTelecaller, isAdmin, searchQuery]);

  const loadTelecallers = async () => {
    if (isAdmin) {
      try {
        const response = await getTelecallers();
        setTelecallers(response);
      } catch (error) {
        console.error('Error loading telecallers:', error);
      }
    }
  };

  // Load data when screen comes into focus (retains filters)
  useFocusEffect(
    useCallback(() => {
      if (filtersLoaded.current) {
        loadLeads();
      }
    }, [loadLeads])
  );

  useEffect(() => {
    loadTelecallers();
  }, []);

  const filterLeads = (leadsData, query) => {
    if (!query) {
      setFilteredLeads(leadsData);
      return;
    }
    const lowerQuery = query.toLowerCase();
    // Search by name, phone, email, city
    const filtered = leadsData.filter(
      lead =>
        lead.name?.toLowerCase().includes(lowerQuery) ||
        lead.phone?.includes(query) ||
        String(lead.phone).replace(/[^0-9]/g, '').includes(query.replace(/[^0-9]/g, '')) ||
        lead.email?.toLowerCase().includes(lowerQuery) ||
        lead.city?.toLowerCase().includes(lowerQuery)
    );
    setFilteredLeads(filtered);
  };

  useEffect(() => {
    // For short queries, do client-side filtering for quick feedback
    if (!searchQuery || searchQuery.trim().length < 2) {
      filterLeads(leads, searchQuery);
    }
    // For longer queries, debounce and trigger server-side search
    else {
      const debounceTimer = setTimeout(() => {
        loadLeads();
      }, 500); // Wait 500ms after user stops typing
      return () => clearTimeout(debounceTimer);
    }
  }, [searchQuery]);

  // Reload when filters change (but not search - that's handled above)
  useEffect(() => {
    if (filtersLoaded.current && (!searchQuery || searchQuery.trim().length < 2)) {
      loadLeads();
    }
  }, [statusFilter, outcomeFilter, selectedTelecaller]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLeads();
    setRefreshing(false);
  };

  const handleCall = async (lead) => {
    Alert.alert('Call ' + lead.name, `Phone: ${lead.phone}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Call',
        onPress: () => {
          // Navigate to LeadDetail screen with autoCall flag
          // This ensures the post-call modal appears after the call ends
          navigation.navigate('LeadDetail', { 
            lead: lead, 
            user,
            autoCall: true  // Signal to auto-initiate call
          });
        },
      },
    ]);
  };

  const handleWhatsApp = (lead) => {
    const message = `Hi ${lead.name},\n\nThis is ${user?.name || 'Team'} from BankEzee.\n\nI'm calling about merging your multiple loans/credit card payments into one single EMI.\n\nWe'd like to understand your current EMIs and check whether we can help you reduce your monthly EMI burden and simplify your repayments.\n\nI tried reaching you but couldn't connect. Please call me back or simply reply "CALL ME" here and I'll get in touch with you.\n\nRegards,\n${user?.name || 'Team'}\nBankEzee – Loan Consolidation Platform\nwww.BankEzee.com`;
    
    // Clean phone and add 91 prefix for India
    let phone = String(lead.phone).split('.')[0].replace(/[^0-9]/g, '');
    phone = phone.replace(/^0+/, '');
    if (phone.length === 10) {
      phone = '91' + phone;
    } else if (!phone.startsWith('91') && phone.length > 10) {
      phone = '91' + phone;
    }
    
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    Linking.openURL(url);
  };

  const getStatusColor = (status) => {
    const statusObj = statuses.find(s => s.id === status);
    return statusObj?.color || '#6b7280';
  };

  const getOutcomeColor = (outcome) => {
    const outcomeObj = callOutcomes.find(o => o.id === outcome);
    return outcomeObj?.color || '#6b7280';
  };

  // Get count for a status
  const getStatusCount = (statusId) => {
    if (statusId === 'all') return allLeads.length;
    return statusCounts[statusId] || 0;
  };

  const renderLead = ({ item }) => (
    <TouchableOpacity
      style={styles.leadCard}
      onPress={() => navigation.navigate('LeadDetail', { lead: item, user })}
    >
      <View style={styles.leadHeader}>
        <View style={styles.leadInfo}>
          <Text style={styles.leadName}>{item.name}</Text>
          <Text style={styles.leadPhone}>{String(item.phone).split('.')[0]}</Text>
          {item.city && <Text style={styles.leadCity}>📍 {item.city}</Text>}
        </View>
        <View style={styles.badgeContainer}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status?.replace('_', ' ') || 'new'}
            </Text>
          </View>
          {item.last_call_outcome && (
            <View style={[styles.outcomeBadge, { backgroundColor: getOutcomeColor(item.last_call_outcome) + '20' }]}>
              <Text style={[styles.outcomeText, { color: getOutcomeColor(item.last_call_outcome) }]}>
                {item.last_call_outcome?.replace('_', ' ')}
              </Text>
            </View>
          )}
        </View>
      </View>
      
      {isAdmin && item.telecaller_name && (
        <Text style={styles.telecallerInfo}>👤 {item.telecaller_name}</Text>
      )}
      
      <View style={styles.leadActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleCall(item)}>
          <Text style={styles.actionBtnText}>📞 Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.whatsappBtn]} onPress={() => handleWhatsApp(item)}>
          <Text style={styles.actionBtnText}>💬 WhatsApp</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Data</Text>
        <Text style={styles.headerCount}>{filteredLeads.length} leads</Text>
      </View>

      {/* New Data Banner */}
      {statusCounts['new'] > 0 && statusFilter !== 'new' && (
        <TouchableOpacity 
          style={styles.newDataBanner}
          onPress={() => setStatusFilter('new')}
        >
          <Text style={styles.newDataText}>
            🆕 {statusCounts['new']} new data available
          </Text>
          <Text style={styles.tapToView}>Tap to view</Text>
        </TouchableOpacity>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone, email..."
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Status Filter with Counts */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>Status:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {statuses.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.filterChip,
                statusFilter === item.id && { backgroundColor: item.color },
              ]}
              onPress={() => setStatusFilter(item.id)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === item.id && { color: '#fff' },
                ]}
              >
                {item.name}
                {item.id !== 'all' && (
                  <Text style={styles.countText}> ({getStatusCount(item.id)})</Text>
                )}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Call Outcome Filter */}
      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>Call Outcome:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {callOutcomes.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.filterChip,
                outcomeFilter === item.id && { backgroundColor: item.color },
              ]}
              onPress={() => setOutcomeFilter(item.id)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  outcomeFilter === item.id && { color: '#fff' },
                ]}
              >
                {item.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Admin: Telecaller Filter */}
      {isAdmin && telecallers.length > 0 && (
        <View style={styles.telecallerFilter}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {[{ id: 'all', name: 'All Agents' }, ...telecallers].map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.telecallerChip,
                  selectedTelecaller === item.id && styles.telecallerChipActive,
                ]}
                onPress={() => setSelectedTelecaller(item.id)}
              >
                <Text
                  style={[
                    styles.telecallerChipText,
                    selectedTelecaller === item.id && styles.telecallerChipTextActive,
                  ]}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Leads List */}
      <FlatList
        data={filteredLeads}
        keyExtractor={item => item.id}
        renderItem={renderLead}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>📋</Text>
            <Text style={styles.emptyTitle}>No leads found</Text>
            <Text style={styles.emptySubtext}>
              {searchQuery ? 'Try a different search' : 'Pull to refresh'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerCount: {
    fontSize: 14,
    color: '#6b7280',
  },
  newDataBanner: {
    backgroundColor: '#EFF6FF',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
  },
  newDataText: {
    color: '#1D4ED8',
    fontWeight: '600',
    fontSize: 14,
  },
  tapToView: {
    color: '#3B82F6',
    fontSize: 12,
  },
  searchContainer: {
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  searchInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#111827',
  },
  filterContainer: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  filterLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    marginLeft: 4,
    fontWeight: '500',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginHorizontal: 3,
    backgroundColor: '#f3f4f6',
  },
  filterChipText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  countText: {
    fontSize: 11,
    fontWeight: '400',
  },
  telecallerFilter: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  telecallerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginHorizontal: 4,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  telecallerChipActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  telecallerChipText: {
    fontSize: 12,
    color: '#374151',
  },
  telecallerChipTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  listContent: {
    padding: 12,
  },
  leadCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  leadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  leadInfo: {
    flex: 1,
  },
  leadName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  leadPhone: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  leadCity: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  badgeContainer: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  outcomeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  outcomeText: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  telecallerInfo: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },
  leadActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
});

export default DataScreen;
