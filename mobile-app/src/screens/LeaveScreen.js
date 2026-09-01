import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getLeaveBalance, getMyLeaveRequests, getMyWfhRequests, submitLeaveRequest, submitWfhRequest, cancelLeaveRequest } from '../services/api';

const LeaveScreen = ({ user }) => {
  const [activeTab, setActiveTab] = useState('balance');
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modal states
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showWfhModal, setShowWfhModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Leave form
  const [leaveForm, setLeaveForm] = useState({
    start_date: new Date(),
    end_date: new Date(),
    leave_type: 'CASUAL',
    reason: '',
    half_day: false,
  });
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  
  // WFH form
  const [wfhForm, setWfhForm] = useState({
    date: new Date(),
    reason: '',
  });
  const [showWfhDatePicker, setShowWfhDatePicker] = useState(false);

  const loadData = async () => {
    try {
      const [balanceRes, leavesRes, wfhRes] = await Promise.all([
        getLeaveBalance(),
        getMyLeaveRequests(),
        getMyWfhRequests(),
      ]);
      setLeaveBalance(balanceRes);
      setLeaveRequests(leavesRes);
      setWfhRequests(wfhRes);
    } catch (error) {
      console.error('Error loading leave data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleSubmitLeave = async () => {
    if (!leaveForm.reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for leave');
      return;
    }
    
    setSubmitting(true);
    try {
      await submitLeaveRequest({
        start_date: leaveForm.start_date.toISOString().split('T')[0],
        end_date: leaveForm.end_date.toISOString().split('T')[0],
        leave_type: leaveForm.leave_type,
        reason: leaveForm.reason,
        half_day: leaveForm.half_day,
      });
      Alert.alert('Success', 'Leave request submitted successfully');
      setShowLeaveModal(false);
      setLeaveForm({
        start_date: new Date(),
        end_date: new Date(),
        leave_type: 'CASUAL',
        reason: '',
        half_day: false,
      });
      loadData();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit leave request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitWfh = async () => {
    if (!wfhForm.reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for WFH');
      return;
    }
    
    setSubmitting(true);
    try {
      await submitWfhRequest({
        date: wfhForm.date.toISOString().split('T')[0],
        reason: wfhForm.reason,
      });
      Alert.alert('Success', 'WFH request submitted successfully');
      setShowWfhModal(false);
      setWfhForm({ date: new Date(), reason: '' });
      loadData();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit WFH request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelLeave = (requestId) => {
    Alert.alert(
      'Cancel Request',
      'Are you sure you want to cancel this leave request?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelLeaveRequest(requestId);
              Alert.alert('Success', 'Leave request cancelled');
              loadData();
            } catch (error) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to cancel request');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'APPROVED': return '#10b981';
      case 'REJECTED': return '#ef4444';
      case 'CANCELLED': return '#6b7280';
      default: return '#f59e0b';
    }
  };

  const leaveTypes = [
    { label: 'Casual', value: 'CASUAL' },
    { label: 'Sick', value: 'SICK' },
    { label: 'Earned', value: 'EARNED' },
    { label: 'Unpaid', value: 'UNPAID' },
    { label: 'Emergency', value: 'EMERGENCY' },
  ];

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Leave Management</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={() => setShowLeaveModal(true)}
          >
            <Text style={styles.applyButtonText}>Apply Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyButton, styles.wfhButton]}
            onPress={() => setShowWfhModal(true)}
          >
            <Text style={styles.applyButtonText}>WFH</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {['balance', 'leaves', 'wfh'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab === 'balance' ? 'Balance' : tab === 'leaves' ? 'Leave Requests' : 'WFH'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {/* Balance Tab */}
        {activeTab === 'balance' && leaveBalance && (
          <View style={styles.balanceContainer}>
            {Object.entries(leaveBalance)
              .filter(([key]) => key !== 'year')
              .map(([type, data]) => (
                <View key={type} style={styles.balanceCard}>
                  <Text style={styles.balanceType}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                  <View style={styles.balanceValues}>
                    <Text style={styles.balanceRemaining}>
                      {typeof data.total === 'number' ? (data.total - data.used).toFixed(1) : '∞'}
                    </Text>
                    <Text style={styles.balanceTotal}>/ {data.total}</Text>
                  </View>
                  <Text style={styles.balanceUsed}>Used: {data.used} days</Text>
                </View>
              ))}
          </View>
        )}

        {/* Leave Requests Tab */}
        {activeTab === 'leaves' && (
          <View style={styles.requestsContainer}>
            {leaveRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No leave requests yet</Text>
              </View>
            ) : (
              leaveRequests.map((req) => (
                <View key={req.id} style={styles.requestCard}>
                  <View style={styles.requestHeader}>
                    <Text style={styles.requestType}>{req.leave_type}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(req.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(req.status) }]}>
                        {req.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.requestDates}>
                    {formatDate(req.start_date)} → {formatDate(req.end_date)}
                  </Text>
                  <Text style={styles.requestDays}>{req.leave_days} day(s)</Text>
                  <Text style={styles.requestReason} numberOfLines={2}>{req.reason}</Text>
                  {req.status === 'PENDING' && (
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => handleCancelLeave(req.id)}
                    >
                      <Text style={styles.cancelButtonText}>Cancel Request</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {/* WFH Requests Tab */}
        {activeTab === 'wfh' && (
          <View style={styles.requestsContainer}>
            {wfhRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No WFH requests yet</Text>
              </View>
            ) : (
              wfhRequests.map((req) => (
                <View key={req.id} style={styles.requestCard}>
                  <View style={styles.requestHeader}>
                    <Text style={styles.requestType}>Work From Home</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(req.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(req.status) }]}>
                        {req.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.requestDates}>{formatDate(req.date)}</Text>
                  <Text style={styles.requestReason} numberOfLines={2}>{req.reason}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Leave Application Modal */}
      <Modal visible={showLeaveModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Apply for Leave</Text>
            
            <Text style={styles.inputLabel}>Leave Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeSelector}>
              {leaveTypes.map((type) => (
                <TouchableOpacity
                  key={type.value}
                  style={[
                    styles.typeChip,
                    leaveForm.leave_type === type.value && styles.typeChipActive,
                  ]}
                  onPress={() => setLeaveForm({ ...leaveForm, leave_type: type.value })}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      leaveForm.leave_type === type.value && styles.typeChipTextActive,
                    ]}
                  >
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.inputLabel}>From</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowStartPicker(true)}
                >
                  <Text style={styles.dateButtonText}>
                    {leaveForm.start_date.toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dateField}>
                <Text style={styles.inputLabel}>To</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowEndPicker(true)}
                >
                  <Text style={styles.dateButtonText}>
                    {leaveForm.end_date.toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {showStartPicker && (
              <DateTimePicker
                value={leaveForm.start_date}
                mode="date"
                onChange={(event, date) => {
                  setShowStartPicker(false);
                  if (date) setLeaveForm({ ...leaveForm, start_date: date });
                }}
              />
            )}
            {showEndPicker && (
              <DateTimePicker
                value={leaveForm.end_date}
                mode="date"
                onChange={(event, date) => {
                  setShowEndPicker(false);
                  if (date) setLeaveForm({ ...leaveForm, end_date: date });
                }}
              />
            )}

            <TouchableOpacity
              style={styles.halfDayRow}
              onPress={() => setLeaveForm({ ...leaveForm, half_day: !leaveForm.half_day })}
            >
              <View style={[styles.checkbox, leaveForm.half_day && styles.checkboxChecked]}>
                {leaveForm.half_day && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.halfDayText}>Half Day</Text>
            </TouchableOpacity>

            <Text style={styles.inputLabel}>Reason</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Please specify reason for leave"
              value={leaveForm.reason}
              onChangeText={(text) => setLeaveForm({ ...leaveForm, reason: text })}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setShowLeaveModal(false)}
              >
                <Text style={styles.cancelModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitLeave}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* WFH Application Modal */}
      <Modal visible={showWfhModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Apply for WFH</Text>

            <Text style={styles.inputLabel}>Date</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowWfhDatePicker(true)}
            >
              <Text style={styles.dateButtonText}>
                {wfhForm.date.toLocaleDateString()}
              </Text>
            </TouchableOpacity>

            {showWfhDatePicker && (
              <DateTimePicker
                value={wfhForm.date}
                mode="date"
                onChange={(event, date) => {
                  setShowWfhDatePicker(false);
                  if (date) setWfhForm({ ...wfhForm, date: date });
                }}
              />
            )}

            <Text style={styles.inputLabel}>Reason</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Please specify reason for WFH"
              value={wfhForm.reason}
              onChangeText={(text) => setWfhForm({ ...wfhForm, reason: text })}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setShowWfhModal(false)}
              >
                <Text style={styles.cancelModalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitWfh}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 12,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  applyButton: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  wfhButton: {
    backgroundColor: '#3b82f6',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#10b981',
  },
  tabText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#10b981',
  },
  content: {
    padding: 16,
  },
  balanceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  balanceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '47%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  balanceType: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
    marginBottom: 8,
  },
  balanceValues: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceRemaining: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  balanceTotal: {
    fontSize: 14,
    color: '#9ca3af',
    marginLeft: 4,
  },
  balanceUsed: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  requestsContainer: {
    gap: 12,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  requestType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  requestDates: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  requestDays: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  requestReason: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 8,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    color: '#9ca3af',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
  },
  typeSelector: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  typeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  typeChipActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  typeChipText: {
    fontSize: 14,
    color: '#4b5563',
  },
  typeChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  dateButton: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dateButtonText: {
    fontSize: 15,
    color: '#1f2937',
  },
  halfDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  checkmark: {
    color: '#fff',
    fontWeight: 'bold',
  },
  halfDayText: {
    fontSize: 15,
    color: '#374151',
  },
  reasonInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelModalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  cancelModalButtonText: {
    fontSize: 16,
    color: '#4b5563',
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#10b981',
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

export default LeaveScreen;
