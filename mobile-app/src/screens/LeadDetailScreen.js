import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { getLead, updateLead, getLeadCallLogs, createFollowUp } from '../services/api';
import { makePhoneCall } from '../services/callLogService';

const LeadDetailScreen = ({ route, navigation }) => {
  const { lead: initialLead, user } = route.params;
  const [lead, setLead] = useState(initialLead);
  const [callLogs, setCallLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);

  const statuses = ['new', 'follow_up', 'not_interested', 'presentation', 'leads', 'file'];

  useEffect(() => {
    loadLeadDetails();
  }, []);

  const loadLeadDetails = async () => {
    setLoading(true);
    try {
      const [leadRes, logsRes] = await Promise.all([
        getLead(lead.id),
        getLeadCallLogs(lead.id),
      ]);
      setLead(leadRes);
      setCallLogs(logsRes);
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
    Alert.alert('Call ' + lead.name, `Phone: ${lead.phone}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call', onPress: () => makePhoneCall(lead.phone) },
    ]);
  };

  const handleWhatsApp = () => {
    const message = `Hi ${lead.name},\n\nThis is ${user?.name || 'Team'} from BankEzee.\n\nI'm calling about merging your multiple loans/credit card payments into one single EMI.\n\nWe'd like to understand your current EMIs and check whether we can help you reduce your monthly EMI burden and simplify your repayments.\n\nI tried reaching you but couldn't connect. Please call me back or simply reply "CALL ME" here and I'll get in touch with you.\n\nRegards,\n${user?.name || 'Team'}\nBankEzee – Loan Consolidation Platform\nwww.BankEzee.com`;
    
    let phone = lead.phone.replace(/[^0-9]/g, '');
    if (!phone.startsWith('91') && phone.length === 10) {
      phone = '91' + phone;
    }
    
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
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
      presentation: '#f59e0b',
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
    <ScrollView style={styles.container}>
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
              value={editData.phone}
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
            
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusPicker}>
              {statuses.map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.statusOption,
                    editData.status === status && { backgroundColor: getStatusColor(status) },
                  ]}
                  onPress={() => setEditData({ ...editData, status })}
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      editData.status === status && { color: '#fff' },
                    ]}
                  >
                    {status.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={editData.notes}
              onChangeText={v => setEditData({ ...editData, notes: v })}
              multiline
              numberOfLines={3}
            />
            
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? 'Saving...' : '💾 Save Changes'}
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
              <Text style={styles.infoValue}>{lead.phone}</Text>
            </View>
            {lead.email && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{lead.email}</Text>
              </View>
            )}
            {lead.city && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>City</Text>
                <Text style={styles.infoValue}>{lead.city}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(lead.status) + '20' }]}>
                <Text style={[styles.statusBadgeText, { color: getStatusColor(lead.status) }]}>
                  {lead.status?.replace('_', ' ')}
                </Text>
              </View>
            </View>
            {lead.notes && (
              <View style={styles.notesSection}>
                <Text style={styles.infoLabel}>Notes</Text>
                <Text style={styles.notesText}>{lead.notes}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Action Buttons */}
      {!isEditing && (
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleCall}>
            <Text style={styles.actionBtnText}>📞 Call Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.whatsappBtn]} onPress={handleWhatsApp}>
            <Text style={styles.actionBtnText}>💬 WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.followUpBtn]} onPress={handleScheduleFollowUp}>
            <Text style={styles.actionBtnText}>📅 Follow-up</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Call History */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Call History</Text>
        {callLogs.length > 0 ? (
          callLogs.map((log, index) => (
            <View key={log.id || index} style={styles.callLogItem}>
              <View style={styles.callLogHeader}>
                <Text style={styles.callLogOutcome}>{log.outcome?.replace('_', ' ')}</Text>
                <Text style={styles.callLogDuration}>{formatDuration(log.duration)}</Text>
              </View>
              <Text style={styles.callLogDate}>{formatDate(log.created_at)}</Text>
              {log.notes && <Text style={styles.callLogNotes}>{log.notes}</Text>}
            </View>
          ))
        ) : (
          <Text style={styles.noCallsText}>No call history yet</Text>
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
    color: '#3b82f6',
    fontWeight: '500',
  },
  cancelBtn: {
    color: '#ef4444',
    fontWeight: '500',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
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
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  notesSection: {
    marginTop: 12,
  },
  notesText: {
    fontSize: 14,
    color: '#374151',
    marginTop: 4,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  statusPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    marginBottom: 4,
  },
  statusOptionText: {
    fontSize: 12,
    color: '#374151',
    textTransform: 'capitalize',
  },
  saveBtn: {
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  saveBtnDisabled: {
    backgroundColor: '#86efac',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  whatsappBtn: {
    backgroundColor: '#25D366',
  },
  followUpBtn: {
    backgroundColor: '#8b5cf6',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  callLogItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  callLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  callLogOutcome: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    textTransform: 'capitalize',
  },
  callLogDuration: {
    fontSize: 14,
    color: '#16a34a',
    fontWeight: '500',
  },
  callLogDate: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  callLogNotes: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  noCallsText: {
    textAlign: 'center',
    color: '#9ca3af',
    paddingVertical: 20,
  },
});

export default LeadDetailScreen;
