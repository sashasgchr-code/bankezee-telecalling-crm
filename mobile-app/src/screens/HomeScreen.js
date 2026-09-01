import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { getLeads, getMyStats, logout, pingActivity } from '../services/api';
import { 
  makePhoneCall, 
  syncCallLogsWithBackend, 
  hasCallLogPermission,
  getCallLogForNumber 
} from '../services/callLogService';
import { useNavigation } from '@react-navigation/native';

const HomeScreen = ({ user, onLogout }) => {
  const navigation = useNavigation();
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  // Status colors
  const statusColors = {
    new: '#3B82F6',
    contacted: '#8B5CF6',
    not_interested: '#EF4444',
    follow_up: '#F59E0B',
    presentation: '#10B981',
    leads: '#06B6D4',
    file: '#22C55E',
  };

  // Outcome colors
  const outcomeColors = {
    connected: '#22C55E',
    no_answer: '#EF4444',
    busy: '#F59E0B',
    not_connecting: '#6B7280',
    wrong_number: '#DC2626',
    voicemail: '#8B5CF6',
  };

  const loadData = useCallback(async () => {
    try {
      const [leadsData, statsData] = await Promise.all([
        getLeads(),
        getMyStats(),
      ]);
      setLeads(leadsData);
      setStats(statsData);
    } catch (error) {
      console.error('Error loading data:', error);
      if (error.response?.status === 401) {
        onLogout();
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onLogout]);

  useEffect(() => {
    loadData();
    
    // Activity ping every 30 seconds
    const pingInterval = setInterval(() => {
      pingActivity().catch(console.error);
    }, 30000);

    // Sync call logs every 5 minutes
    const syncInterval = setInterval(() => {
      handleSyncCallLogs();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(pingInterval);
      clearInterval(syncInterval);
    };
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleSyncCallLogs = async () => {
    const hasPermission = await hasCallLogPermission();
    if (!hasPermission) {
      return;
    }

    setSyncing(true);
    try {
      const leadPhones = leads.map(lead => lead.phone);
      const result = await syncCallLogsWithBackend(leadPhones);
      setLastSyncResult(result);
      
      // Refresh data after sync
      loadData();
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleCallLead = async (lead) => {
    Alert.alert(
      'Call ' + lead.name,
      `Phone: ${lead.phone}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call',
          onPress: async () => {
            // Navigate to LeadDetail with autoCall flag
            // This ensures proper post-call modal with AppState detection
            navigation.navigate('LeadDetail', {
              lead: lead,
              user,
              autoCall: true
            });
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            onLogout();
          },
        },
      ]
    );
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const filteredLeads = leads.filter(lead =>
    lead.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.phone?.includes(searchQuery)
  );

  const renderLeadItem = ({ item: lead }) => (
    <TouchableOpacity
      style={styles.leadCard}
      onPress={() => handleCallLead(lead)}
    >
      <View style={styles.leadHeader}>
        <View style={styles.leadInfo}>
          <Text style={styles.leadName}>{lead.name}</Text>
          <Text style={styles.leadPhone}>{lead.phone}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          { backgroundColor: lead.last_call_outcome 
            ? outcomeColors[lead.last_call_outcome] || '#6B7280'
            : statusColors[lead.status] || '#6B7280' 
          }
        ]}>
          <Text style={styles.statusText}>
            {lead.last_call_outcome 
              ? lead.last_call_outcome.replace('_', ' ').toUpperCase()
              : (lead.status || 'NEW').replace('_', ' ').toUpperCase()
            }
          </Text>
        </View>
      </View>
      
      {lead.city && (
        <Text style={styles.leadCity}>{lead.city}</Text>
      )}
      
      <View style={styles.callButton}>
        <Text style={styles.callButtonText}>📞 Tap to Call</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.name}</Text>
          <Text style={styles.subtitle}>Telecaller Dashboard</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Cards */}
      {stats && (
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.calls_made || 0}</Text>
            <Text style={styles.statLabel}>Calls Made</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatTime(stats.total_call_seconds)}</Text>
            <Text style={styles.statLabel}>Talk Time</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatTime(stats.total_login_seconds)}</Text>
            <Text style={styles.statLabel}>Login Time</Text>
          </View>
        </View>
      )}

      {/* Sync Status */}
      <TouchableOpacity 
        style={styles.syncBanner}
        onPress={handleSyncCallLogs}
        disabled={syncing}
      >
        {syncing ? (
          <ActivityIndicator size="small" color="#10B981" />
        ) : (
          <Text style={styles.syncText}>
            {lastSyncResult 
              ? `✓ Synced ${lastSyncResult.synced} calls, ${lastSyncResult.matched} matched`
              : '🔄 Tap to sync call logs'
            }
          </Text>
        )}
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search leads..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Leads Count */}
      <Text style={styles.leadsCount}>
        {filteredLeads.length} leads assigned
      </Text>

      {/* Leads List */}
      <FlatList
        data={filteredLeads}
        renderItem={renderLeadItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#10B981']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No leads assigned yet</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#10B981',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  syncBanner: {
    backgroundColor: '#ecfdf5',
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  syncText: {
    color: '#065f46',
    fontSize: 14,
  },
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  leadsCount: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    color: '#6b7280',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  leadCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
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
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  leadPhone: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  leadCity: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  callButton: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  callButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 16,
  },
});

export default HomeScreen;
