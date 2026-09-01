import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  AppState,
} from 'react-native';
import { getLead, updateLead, getLeadCallLogs, createFollowUp, logCallOutcome } from '../services/api';
import { makePhoneCall, getRecentCallForNumber, normalizePhoneNumber } from '../services/callLogService';

const LeadDetailScreen = ({ route, navigation }) => {
  const { lead: initialLead, user, autoCall } = route.params;
  const [lead, setLead] = useState(initialLead);
  const [callLogs, setCallLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  
  // Post-call modal state
  const [showCallModal, setShowCallModal] = useState(false);
  const [callStartTime, setCallStartTime] = useState(null);
  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [callNotes, setCallNotes] = useState('');
  const [detectedCallDuration, setDetectedCallDuration] = useState(null);
  const [lookingUpCall, setLookingUpCall] = useState(false);
  
  // Quick status modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  
  // Track if we're waiting for a call to end
  const pendingCallPhone = useRef(null);
  const autoCallTriggered = useRef(false);

  // Status options
  const statuses = [
    { id: 'new', label: 'New', color: '#3b82f6' },
    { id: 'follow_up', label: 'Follow Up', color: '#8b5cf6' },
    { id: 'not_interested', label: 'Not Interested', color: '#6b7280' },
    { id: 'leads', label: 'Lead', color: '#22c55e' },
    { id: 'file', label: 'File', color: '#ef4444' },
  ];

  // Call outcomes
  const callOutcomes = [
    { id: 'connected', label: 'Connected', color: '#4CAF50' },
    { id: 'no_answer', label: 'No Answer', color: '#F44336' },
    { id: 'switched_off', label: 'Switched Off', color: '#9E9E9E' },
    { id: 'not_connecting', label: 'Not Connecting', color: '#757575' },
    { id: 'busy', label: 'Busy', color: '#FF9800' },
    { id: 'wrong_number', label: 'Wrong Number', color: '#E91E63' },
    { id: 'voicemail', label: 'Voicemail', color: '#9C27B0' },
  ];

  useEffect(() => {
    loadLeadDetails();
  }, []);

  // Handle autoCall - automatically initiate call when navigated from DataScreen
  useEffect(() => {
    if (autoCall && !autoCallTriggered.current) {
      autoCallTriggered.current = true;
      // Small delay to ensure screen is loaded
      const timer = setTimeout(() => {
        initiateCall();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoCall]);

  // Function to initiate call (used by both manual press and autoCall)
  const initiateCall = async () => {
    const now = Date.now();
    setCallStartTime(now);
    pendingCallPhone.current = lead.phone;
    setDetectedCallDuration(null);
    setSelectedOutcome(null);
    setSelectedStatus(null);
    setCallNotes('');
    
    // Make the call
    await makePhoneCall(lead.phone);
  };

  // Monitor app state for post-call detection
  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [callStartTime]);

  const handleAppStateChange = useCallback(async (nextAppState) => {
    // When app comes back to foreground after a call
    if (nextAppState === 'active' && callStartTime && pendingCallPhone.current) {
      const timeSinceCallStart = Math.round((Date.now() - callStartTime) / 1000);
      
      // Only process if call was more than 3 seconds (user actually went to phone app)
      if (timeSinceCallStart > 3) {
        setLookingUpCall(true);
        
        // Wait a moment then query Android call log for actual duration
        console.log('Looking up call in Android call log...');
        
        try {
          const callResult = await getRecentCallForNumber(
            pendingCallPhone.current, 
            callStartTime,
            8000 // Wait up to 8 seconds for call log to update
          );
          
          if (callResult.success && callResult.call) {
            const actualDuration = callResult.call.duration_seconds;
            console.log(`Found call in log: ${actualDuration} seconds, type: ${callResult.call.type}`);
            
            setDetectedCallDuration(actualDuration);
            
            // Pre-select outcome based on duration
            if (actualDuration === 0) {
              setSelectedOutcome('no_answer');
            } else if (actualDuration > 0) {
              setSelectedOutcome('connected');
            }
          } else {
            console.log('Could not find call in Android call log');
            setDetectedCallDuration(null);
          }
        } catch (error) {
          console.log('Error looking up call log:', error);
          setDetectedCallDuration(null);
        }
        
        setLookingUpCall(false);
        
        // ALWAYS show the call outcome modal after returning from a call
        setShowCallModal(true);
      }
      
      // Reset tracking state
      setCallStartTime(null);
      pendingCallPhone.current = null;
    }
  }, [callStartTime]);

  const loadLeadDetails = async () => {
    setLoading(true);
    try {
      const [leadRes, logsRes] = await Promise.all([
        getLead(lead.id),
        getLeadCallLogs(lead.id).catch(() => []),
      ]);
      setLead(leadRes);
      setCallLogs(logsRes || []);
    } catch (error) {
      console.error('Error loading lead details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setEditData({
      name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      city: lead.city || '',
      status: lead.status,
      notes: lead.notes || '',
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateLead(lead.id, editData);
      setLead(updated);
      setIsEditing(false);
      Alert.alert('Success', 'Lead updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to update lead');
    } finally {
      setSaving(false);
    }
  };

  const handleCall = () => {
    const cleanPhone = String(lead.phone).split('.')[0];
    Alert.alert('Call ' + lead.name, `Phone: ${cleanPhone}`, [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Call', 
        onPress: initiateCall
      },
    ]);
  };

  const handleWhatsApp = () => {
    const message = `Hi ${lead.name},\n\nThis is ${user?.name || 'Team'} from BankEzee.\n\nI'm calling about merging your multiple loans/credit card payments into one single EMI.\n\nWe'd like to understand your current EMIs and check whether we can help you reduce your monthly EMI burden and simplify your repayments.\n\nI tried reaching you but couldn't connect. Please call me back or simply reply "CALL ME" here and I'll get in touch with you.\n\nRegards,\n${user?.name || 'Team'}\nBankEzee – Loan Consolidation Platform\nwww.BankEzee.com`;
    
    let phone = String(lead.phone).split('.')[0].replace(/[^0-9]/g, '');
    phone = phone.replace(/^0+/, '');
    if (phone.length === 10) {
      phone = '91' + phone;
    } else if (!phone.startsWith('91') && phone.length > 10) {
      phone = '91' + phone;
    }
    
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
  };

  // Submit call outcome from post-call modal
  const handleSubmitCallOutcome = async () => {
    if (!selectedOutcome) {
      Alert.alert('Required', 'Please select a call outcome');
      return;
    }

    try {
      // Log the call outcome with detected duration to the unified call_logs collection
      await logCallOutcome({
        lead_id: lead.id,
        outcome: selectedOutcome,
        notes: callNotes,
        duration_seconds: detectedCallDuration || 0,
        call_type: 'outgoing',
        device_timestamp: callStartTime ? new Date(callStartTime).toISOString() : new Date().toISOString(),
      });

      // Update status if changed
      if (selectedStatus && selectedStatus !== lead.status) {
        const updated = await updateLead(lead.id, { status: selectedStatus });
        setLead(updated);
      }

      // Reset modal state
      setShowCallModal(false);
      setSelectedOutcome(null);
      setSelectedStatus(null);
      setCallNotes('');
      setDetectedCallDuration(null);
      
      // Reload lead details
      loadLeadDetails();
      
      Alert.alert('Success', 'Call logged successfully');
    } catch (error) {
      console.error('Error logging call:', error);
      Alert.alert('Error', 'Failed to log call outcome');
    }
  };

  // Quick status update (without call)
  const handleQuickStatusUpdate = async (newStatus) => {
    try {
      const updated = await updateLead(lead.id, { status: newStatus });
      setLead(updated);
      setShowStatusModal(false);
      Alert.alert('Success', `Status updated to ${newStatus.replace('_', ' ')}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const handleScheduleFollowUp = () => {
    Alert.prompt(
      'Schedule Follow-up',
      'Enter notes for the follow-up:',
      async (notes) => {
        if (notes) {
          try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);
            
            await createFollowUp({
              lead_id: lead.id,
              scheduled_at: tomorrow.toISOString(),
              notes,
            });
            Alert.alert('Success', 'Follow-up scheduled for tomorrow');
          } catch (error) {
            Alert.alert('Error', 'Failed to schedule follow-up');
          }
        }
      }
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusColor = (status) => {
    const colors = {
      new: '#3b82f6',
      follow_up: '#8b5cf6',
      not_interested: '#6b7280',
      leads: '#22c55e',
      file: '#ef4444',
    };
    return colors[status] || '#6b7280';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Lead Info Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Contact Info</Text>
            {!isEditing ? (
              <TouchableOpacity onPress={handleEdit}>
                <Text style={styles.editBtn}>✏️ Edit</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setIsEditing(false)}>
                <Text style={styles.cancelBtn}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          {isEditing ? (
            <View>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={editData.name}
                onChangeText={v => setEditData({ ...editData, name: v })}
              />
              
              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={String(editData.phone)}
                onChangeText={v => setEditData({ ...editData, phone: v })}
                keyboardType="phone-pad"
              />
              
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={editData.email}
                onChangeText={v => setEditData({ ...editData, email: v })}
                keyboardType="email-address"
              />
              
              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                value={editData.city}
                onChangeText={v => setEditData({ ...editData, city: v })}
              />
              
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={editData.notes}
                onChangeText={v => setEditData({ ...editData, notes: v })}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.savingBtn]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{lead.name}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{String(lead.phone).split('.')[0]}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{lead.email || '-'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>City</Text>
                <Text style={styles.infoValue}>{lead.city || '-'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(lead.status) + '20' }]}>
                  <Text style={[styles.statusText, { color: getStatusColor(lead.status) }]}>
                    {lead.status?.replace('_', ' ') || 'New'}
                  </Text>
                </View>
              </View>
              {lead.notes && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Notes</Text>
                  <Text style={styles.infoValue}>{lead.notes}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Quick Status Update Button */}
        <TouchableOpacity 
          style={styles.quickStatusBtn}
          onPress={() => setShowStatusModal(true)}
        >
          <Text style={styles.quickStatusBtnText}>📝 Update Status</Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.callBtn} onPress={handleCall}>
            <Text style={styles.actionBtnText}>📞 Call</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsApp}>
            <Text style={styles.actionBtnText}>💬 WhatsApp</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.followUpBtn} onPress={handleScheduleFollowUp}>
          <Text style={styles.followUpBtnText}>📅 Schedule Follow-up</Text>
        </TouchableOpacity>

        {/* Log Call Button (manual trigger) */}
        <TouchableOpacity 
          style={styles.logCallBtn}
          onPress={() => {
            setDetectedCallDuration(null);
            setSelectedOutcome(null);
            setSelectedStatus(null);
            setCallNotes('');
            setShowCallModal(true);
          }}
        >
          <Text style={styles.logCallBtnText}>📋 Log Call Outcome</Text>
        </TouchableOpacity>

        {/* Call History */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Call History</Text>
          {callLogs.length > 0 ? (
            callLogs.map((log, index) => (
              <View key={index} style={styles.callLogItem}>
                <View style={styles.callLogHeader}>
                  <Text style={styles.callLogType}>
                    {log.call_type === 'incoming' ? '📲 Incoming' : '📞 Outgoing'}
                  </Text>
                  <Text style={styles.callLogDuration}>{formatDuration(log.duration_seconds)}</Text>
                </View>
                <Text style={styles.callLogDate}>{formatDate(log.timestamp)}</Text>
                {log.outcome && (
                  <Text style={styles.callLogOutcome}>Outcome: {log.outcome}</Text>
                )}
              </View>
            ))
          ) : (
            <Text style={styles.noCallLogs}>No call history yet</Text>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Post-Call Modal */}
      <Modal
        visible={showCallModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!lookingUpCall) {
            setShowCallModal(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {lookingUpCall ? (
              <View style={styles.lookingUpContainer}>
                <ActivityIndicator size="large" color="#16a34a" />
                <Text style={styles.lookingUpText}>Looking up call in phone history...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.modalTitle}>Log Call Outcome</Text>
                <Text style={styles.modalSubtitle}>How did the call go with {lead.name}?</Text>

                {/* Detected Duration Badge */}
                {detectedCallDuration !== null && (
                  <View style={styles.detectedDurationBadge}>
                    <Text style={styles.detectedDurationText}>
                      📞 Call Duration: {formatDuration(detectedCallDuration)}
                    </Text>
                    <Text style={styles.detectedDurationNote}>
                      (from Android call log)
                    </Text>
                  </View>
                )}

                {/* Call Outcome Selection */}
                <Text style={styles.sectionLabel}>Call Outcome *</Text>
                <View style={styles.outcomeGrid}>
                  {callOutcomes.map((outcome) => (
                    <TouchableOpacity
                      key={outcome.id}
                      style={[
                        styles.outcomeChip,
                        selectedOutcome === outcome.id && { backgroundColor: outcome.color },
                      ]}
                      onPress={() => setSelectedOutcome(outcome.id)}
                    >
                      <Text
                        style={[
                          styles.outcomeChipText,
                          selectedOutcome === outcome.id && { color: '#fff' },
                        ]}
                      >
                        {outcome.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Status Update (optional) */}
                <Text style={styles.sectionLabel}>Update Status (Optional)</Text>
                <View style={styles.statusGrid}>
                  {statuses.map((status) => (
                    <TouchableOpacity
                      key={status.id}
                      style={[
                        styles.statusChip,
                        selectedStatus === status.id && { backgroundColor: status.color },
                        lead.status === status.id && !selectedStatus && styles.currentStatus,
                      ]}
                      onPress={() => setSelectedStatus(status.id)}
                    >
                      <Text
                        style={[
                          styles.statusChipText,
                          selectedStatus === status.id && { color: '#fff' },
                        ]}
                      >
                        {status.label}
                        {lead.status === status.id && ' ✓'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Notes */}
                <Text style={styles.sectionLabel}>Notes (Optional)</Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder="Add call notes..."
                  value={callNotes}
                  onChangeText={setCallNotes}
                  multiline
                  numberOfLines={2}
                />

                {/* Modal Actions */}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelModalBtn}
                    onPress={() => {
                      setShowCallModal(false);
                      setSelectedOutcome(null);
                      setSelectedStatus(null);
                      setCallNotes('');
                      setDetectedCallDuration(null);
                    }}
                  >
                    <Text style={styles.cancelModalBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.submitModalBtn}
                    onPress={handleSubmitCallOutcome}
                  >
                    <Text style={styles.submitModalBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Quick Status Modal */}
      <Modal
        visible={showStatusModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Update Status</Text>
            <Text style={styles.modalSubtitle}>
              Current: {lead.status?.replace('_', ' ') || 'New'}
            </Text>

            <View style={styles.statusList}>
              {statuses.map((status) => (
                <TouchableOpacity
                  key={status.id}
                  style={[
                    styles.statusListItem,
                    { borderLeftColor: status.color, borderLeftWidth: 4 },
                    lead.status === status.id && styles.currentStatusItem,
                  ]}
                  onPress={() => handleQuickStatusUpdate(status.id)}
                >
                  <Text style={styles.statusListText}>{status.label}</Text>
                  {lead.status === status.id && (
                    <Text style={styles.currentLabel}>Current</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.cancelModalBtn}
              onPress={() => setShowStatusModal(false)}
            >
              <Text style={styles.cancelModalBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  editBtn: {
    color: '#16a34a',
    fontSize: 14,
    fontWeight: '500',
  },
  cancelBtn: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  saveBtn: {
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  savingBtn: {
    backgroundColor: '#86efac',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  quickStatusBtn: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#8b5cf6',
    borderStyle: 'dashed',
  },
  quickStatusBtnText: {
    color: '#8b5cf6',
    fontSize: 16,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  callBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  whatsappBtn: {
    flex: 1,
    backgroundColor: '#25D366',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  followUpBtn: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  followUpBtnText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '500',
  },
  logCallBtn: {
    backgroundColor: '#3b82f6',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  logCallBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  callLogItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  callLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  callLogType: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  callLogDuration: {
    fontSize: 14,
    color: '#16a34a',
    fontWeight: '600',
  },
  callLogDate: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  callLogOutcome: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
    fontStyle: 'italic',
  },
  noCallLogs: {
    color: '#9ca3af',
    textAlign: 'center',
    padding: 20,
  },
  // Modal styles
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
    maxHeight: '85%',
  },
  lookingUpContainer: {
    alignItems: 'center',
    padding: 40,
  },
  lookingUpText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  detectedDurationBadge: {
    backgroundColor: '#dcfce7',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  detectedDurationText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#16a34a',
  },
  detectedDurationNote: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
    marginBottom: 8,
  },
  outcomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  outcomeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginBottom: 4,
  },
  outcomeChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginBottom: 4,
  },
  statusChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  currentStatus: {
    borderWidth: 2,
    borderColor: '#16a34a',
  },
  notesInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '500',
  },
  submitModalBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitModalBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Status List Modal
  statusList: {
    marginTop: 12,
  },
  statusListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  currentStatusItem: {
    backgroundColor: '#dcfce7',
  },
  statusListText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  currentLabel: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '600',
  },
});

export default LeadDetailScreen;
