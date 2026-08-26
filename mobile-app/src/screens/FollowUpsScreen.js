import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { getFollowUps, updateFollowUp, deleteFollowUp } from '../services/api';
import { makePhoneCall } from '../services/callLogService';

const FollowUpsScreen = ({ user }) => {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('pending'); // 'pending', 'completed', 'all'

  const loadFollowUps = useCallback(async () => {
    try {
      const params = filter === 'all' ? {} : { completed: filter === 'completed' };
      const response = await getFollowUps(params);
      setFollowUps(response);
    } catch (error) {
      console.error('Error loading follow-ups:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadFollowUps();
    setRefreshing(false);
  };

  const handleComplete = async (followUp) => {
    Alert.alert('Mark Complete', 'Mark this follow-up as completed?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete',
        onPress: async () => {
          try {
            await updateFollowUp(followUp.id, { is_completed: true });
            loadFollowUps();
          } catch (error) {
            Alert.alert('Error', 'Failed to update follow-up');
          }
        },
      },
    ]);
  };

  const handleDelete = async (followUp) => {
    Alert.alert('Delete', 'Delete this follow-up?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFollowUp(followUp.id);
            loadFollowUps();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete follow-up');
          }
        },
      },
    ]);
  };

  const handleCall = (followUp) => {
    if (followUp.lead_phone) {
      makePhoneCall(followUp.lead_phone);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOverdue = (dateString) => {
    return new Date(dateString) < new Date();
  };

  const renderFollowUp = ({ item }) => {
    const overdue = !item.is_completed && isOverdue(item.scheduled_at);
    
    return (
      <View style={[styles.card, item.is_completed && styles.completedCard, overdue && styles.overdueCard]}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.leadName}>{item.lead_name}</Text>
            <Text style={styles.leadPhone}>{item.lead_phone}</Text>
          </View>
          {item.is_completed ? (
            <Text style={styles.completedBadge}>✅ Done</Text>
          ) : overdue ? (
            <Text style={styles.overdueBadge}>⚠️ Overdue</Text>
          ) : null}
        </View>
        
        <View style={styles.scheduleRow}>
          <Text style={styles.scheduleIcon}>📅</Text>
          <Text style={[styles.scheduleText, overdue && styles.overdueText]}>
            {formatDate(item.scheduled_at)}
          </Text>
        </View>
        
        {item.notes && (
          <Text style={styles.notes}>{item.notes}</Text>
        )}
        
        {!item.is_completed && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => handleCall(item)}>
              <Text style={styles.actionBtnText}>📞 Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => handleComplete(item)}>
              <Text style={styles.actionBtnText}>✓ Done</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteBtnText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const pendingCount = followUps.filter(f => !f.is_completed).length;
  const completedCount = followUps.filter(f => f.is_completed).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Follow-ups</Text>
        <Text style={styles.headerCount}>{pendingCount} pending</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterTabs}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'pending' && styles.filterTabActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterTabText, filter === 'pending' && styles.filterTabTextActive]}>
            Pending ({pendingCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'completed' && styles.filterTabActive]}
          onPress={() => setFilter('completed')}
        >
          <Text style={[styles.filterTabText, filter === 'completed' && styles.filterTabTextActive]}>
            Completed ({completedCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
            All
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={followUps}
        keyExtractor={item => item.id}
        renderItem={renderFollowUp}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={styles.emptyTitle}>No follow-ups</Text>
            <Text style={styles.emptySubtext}>
              {filter === 'pending' ? 'No pending follow-ups' : 'No follow-ups found'}
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
    color: '#8b5cf6',
    fontWeight: '500',
  },
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  filterTabActive: {
    backgroundColor: '#8b5cf6',
  },
  filterTabText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  card: {
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
  completedCard: {
    opacity: 0.7,
  },
  overdueCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  completedBadge: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '500',
  },
  overdueBadge: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '500',
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  scheduleIcon: {
    marginRight: 8,
  },
  scheduleText: {
    fontSize: 14,
    color: '#374151',
  },
  overdueText: {
    color: '#ef4444',
  },
  notes: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 8,
    fontStyle: 'italic',
  },
  actions: {
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
  completeBtn: {
    backgroundColor: '#8b5cf6',
  },
  deleteBtn: {
    backgroundColor: '#f3f4f6',
    flex: 0,
    paddingHorizontal: 12,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  deleteBtnText: {
    fontSize: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
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

export default FollowUpsScreen;
