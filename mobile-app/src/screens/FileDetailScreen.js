import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  getFileDetails,
  updateFileDetails,
  updateFileStatus,
  addFileNote,
  updateEligibilities,
  assignFile,
  getOpsTeam,
} from '../services/api';

const FILE_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'documents_collected', label: 'Documents Collected' },
  { value: 'not_eligible', label: 'Not Eligible' },
  { value: 'sent_to_bank', label: 'Sent to Bank' },
  { value: 'login', label: 'Login' },
  { value: 'not_login', label: 'Not Login' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'disbursed', label: 'Disbursed' },
  { value: 'not_disbursed', label: 'Not Disbursed' },
  { value: 'rejected', label: 'Rejected' },
];

const EMPLOYMENT_TYPES = [
  { value: 'salaried', label: 'Salaried' },
  { value: 'self_employed', label: 'Self Employed' },
  { value: 'business', label: 'Business Owner' },
  { value: 'professional', label: 'Professional' },
];

const LOAN_TYPES = [
  { value: 'reduce_home_loan_emi', label: 'Reduce Home Loan EMI' },
  { value: 'merge_multiple_loans', label: 'Merge Multiple Loans' },
  { value: 'top_up_loan', label: 'Top-Up Loan' },
  { value: 'new_personal_loan', label: 'New Personal Loan' },
  { value: 'new_home_loan', label: 'New Home Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'balance_transfer', label: 'Balance Transfer' },
];

// Structured existing-loans editor (matches the web app's existing_loans array)
const EXISTING_LOAN_TYPES = [
  'Personal Loan', 'Home Loan', 'Car Loan', 'Two Wheeler Loan', 'Education Loan',
  'Business Loan', 'Credit Card', 'Overdraft', 'Loan Against Property', 'Gold Loan', 'Other'
];
const EMPTY_EXISTING_LOAN = { bank: '', loan_type: '', loan_amount: '', sanction_date: '', outstanding: '', roi: '', emi: '' };
const loanNum = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const loanMoney = (v) => (loanNum(v) ? `₹${loanNum(v).toLocaleString('en-IN')}` : '-');

const FileDetailScreen = ({ route, navigation }) => {
  const { fileId } = route.params;
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [note, setNote] = useState('');
  const [opsTeam, setOpsTeam] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState('');
  
  // Editable fields
  const [details, setDetails] = useState({
    full_name: '',
    mobile: '',
    email: '',
    mother_name: '',
    current_address: '',
    employment_type: '',
    company_name: '',
    net_salary: '',
    office_address: '',
    obligations_emi: '',
    existing_loan_1: '',
    existing_loan_2: '',
    existing_loan_3: '',
    type_of_loan: '',
    cibil_score: '',
    loan_amount_required: '',
    tenure_required: '',
  });
  const [existingLoans, setExistingLoans] = useState([]);

  useEffect(() => {
    loadFileDetails();
    loadOpsTeam();
  }, [fileId]);

  const loadFileDetails = async () => {
    try {
      setLoading(true);
      const response = await getFileDetails(fileId);
      setFile(response);
      setSelectedStatus(response.file_status || 'new');
      setSelectedAssignee(response.file_assigned_to || '');
      
      const fd = response.file_details || {};
      setDetails({
        full_name: response.name || '',
        mobile: response.phone || '',
        email: response.email || '',
        mother_name: fd.mother_name || '',
        current_address: fd.current_address || '',
        employment_type: response.employment_type || fd.employment_type || '',
        company_name: fd.company_name || '',
        net_salary: fd.net_salary?.toString() || '',
        office_address: fd.office_address || '',
        obligations_emi: fd.obligations_emi?.toString() || '',
        existing_loan_1: fd.existing_loan_1 || '',
        existing_loan_2: fd.existing_loan_2 || '',
        existing_loan_3: fd.existing_loan_3 || '',
        type_of_loan: fd.type_of_loan || response.requirement || '',
        cibil_score: fd.cibil_score?.toString() || '',
        loan_amount_required: fd.loan_amount_required?.toString() || '',
        tenure_required: fd.tenure_required?.toString() || '',
      });
      setExistingLoans(Array.isArray(fd.existing_loans) ? fd.existing_loans : []);
    } catch (error) {
      console.error('Error loading file:', error);
      Alert.alert('Error', 'Failed to load file details');
      navigation.goBack();
    } finally {
      setLoading(false);
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

  const handleSaveDetails = async () => {
    try {
      setSaving(true);
      await updateFileDetails(fileId, {
        full_name: details.full_name,
        mobile: details.mobile,
        email: details.email,
        additional_data: {
          mother_name: details.mother_name,
          current_address: details.current_address,
          company_name: details.company_name,
          net_salary: details.net_salary,
          office_address: details.office_address,
          obligations_emi: details.obligations_emi,
          existing_loan_1: details.existing_loan_1,
          existing_loan_2: details.existing_loan_2,
          existing_loan_3: details.existing_loan_3,
          existing_loans: existingLoans,
          type_of_loan: details.type_of_loan,
          cibil_score: details.cibil_score,
          loan_amount_required: details.loan_amount_required,
          tenure_required: details.tenure_required,
        },
        employment_type: details.employment_type,
      });
      Alert.alert('Success', 'Details saved successfully');
      setIsEditing(false);
      loadFileDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to save details');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (selectedStatus === file?.file_status) return;
    
    try {
      await updateFileStatus(fileId, selectedStatus);
      Alert.alert('Success', 'Status updated');
      loadFileDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const handleAssignment = async () => {
    if (!selectedAssignee || selectedAssignee === file?.file_assigned_to) return;
    
    try {
      await assignFile(fileId, selectedAssignee);
      Alert.alert('Success', 'File assigned successfully');
      loadFileDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to assign file');
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    
    try {
      await addFileNote(fileId, note);
      Alert.alert('Success', 'Note added');
      setNote('');
      loadFileDetails();
    } catch (error) {
      Alert.alert('Error', 'Failed to add note');
    }
  };

  const setLoanField = (index, key, value) => {
    setExistingLoans(prev => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  };
  const addLoan = () => setExistingLoans(prev => [...prev, { ...EMPTY_EXISTING_LOAN }]);
  const removeLoan = (index) => setExistingLoans(prev => prev.filter((_, i) => i !== index));

  const renderField = (label, field, keyboardType = 'default', multiline = false) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {isEditing ? (
        <TextInput
          style={[styles.input, multiline && styles.multilineInput]}
          value={details[field]}
          onChangeText={(text) => setDetails(prev => ({ ...prev, [field]: text }))}
          keyboardType={keyboardType}
          multiline={multiline}
          placeholderTextColor="#9CA3AF"
        />
      ) : (
        <Text style={styles.fieldValue}>{details[field] || '-'}</Text>
      )}
    </View>
  );

  const renderSelectField = (label, field, options) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {isEditing ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectContainer}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.selectOption,
                details[field] === opt.value && styles.selectOptionActive
              ]}
              onPress={() => setDetails(prev => ({ ...prev, [field]: opt.value }))}
            >
              <Text style={[
                styles.selectOptionText,
                details[field] === opt.value && styles.selectOptionTextActive
              ]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.fieldValue}>
          {options.find(o => o.value === details[field])?.label || details[field] || '-'}
        </Text>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>File Details</Text>
        {isEditing ? (
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSaveDetails} style={styles.saveBtn} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.editBtn}>
            <Text style={styles.editText}>✏️ Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Check Eligibility CTA */}
          <TouchableOpacity
            style={styles.eligibilityBtn}
            onPress={() => navigation.navigate('Eligibility', { fileId })}
            data-testid="check-eligibility-btn"
          >
            <Text style={styles.eligibilityBtnIcon}>🏦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.eligibilityBtnText}>Check Bank Eligibility</Text>
              <Text style={styles.eligibilityBtnSub}>Analyse this file against all bank policies</Text>
            </View>
            <Text style={styles.eligibilityBtnArrow}>›</Text>
          </TouchableOpacity>

          {/* Customer Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👤 Customer Details</Text>
            {renderField('Full Name', 'full_name')}
            {renderField('Mobile', 'mobile', 'phone-pad')}
            {renderField('Email', 'email', 'email-address')}
            {renderField('Mother Name', 'mother_name')}
            {renderField('Current Address', 'current_address', 'default', true)}
          </View>

          {/* Employment Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💼 Employment Details</Text>
            {renderSelectField('Employment Type', 'employment_type', EMPLOYMENT_TYPES)}
            {renderField('Company Name', 'company_name')}
            {renderField('Net Salary (₹)', 'net_salary', 'numeric')}
            {renderField('Office Address', 'office_address', 'default', true)}
          </View>

          {/* Existing Loans */}
          <View style={styles.section}>
            <View style={styles.loansHeader}>
              <Text style={styles.sectionTitle}>📊 Existing Loans ({existingLoans.length})</Text>
              {isEditing && (
                <TouchableOpacity onPress={addLoan} style={styles.addLoanBtn} data-testid="add-existing-loan-btn">
                  <Text style={styles.addLoanText}>+ Add Loan</Text>
                </TouchableOpacity>
              )}
            </View>
            {renderField('Monthly EMI (₹)', 'obligations_emi', 'numeric')}
            {existingLoans.length > 0 && (
              <Text style={styles.loansSummary}>
                Total EMI {loanMoney(existingLoans.reduce((s, l) => s + loanNum(l.emi), 0))} · Total Outstanding {loanMoney(existingLoans.reduce((s, l) => s + loanNum(l.outstanding), 0))}
              </Text>
            )}
            {existingLoans.length === 0 && !isEditing && (
              <Text style={styles.noLoansText}>No existing loans recorded</Text>
            )}
            {existingLoans.map((loan, index) => (
              <View key={index} style={styles.loanCard}>
                <View style={styles.loanCardHeader}>
                  <Text style={styles.loanCardTitle}>Loan {index + 1}</Text>
                  {isEditing && (
                    <TouchableOpacity onPress={() => removeLoan(index)}>
                      <Text style={styles.removeLoanText}>🗑 Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Bank / Lender</Text>
                  {isEditing ? (
                    <TextInput style={styles.input} value={loan.bank || ''} onChangeText={(t) => setLoanField(index, 'bank', t)} placeholder="e.g., HDFC Bank" placeholderTextColor="#9CA3AF" />
                  ) : (<Text style={styles.fieldValue}>{loan.bank || '-'}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Type of Loan</Text>
                  {isEditing ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectContainer}>
                      {EXISTING_LOAN_TYPES.map(opt => (
                        <TouchableOpacity key={opt} style={[styles.selectOption, loan.loan_type === opt && styles.selectOptionActive]} onPress={() => setLoanField(index, 'loan_type', opt)}>
                          <Text style={[styles.selectOptionText, loan.loan_type === opt && styles.selectOptionTextActive]}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : (<Text style={styles.fieldValue}>{loan.loan_type || '-'}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Loan Amount (₹)</Text>
                  {isEditing ? (<TextInput style={styles.input} value={String(loan.loan_amount || '')} onChangeText={(t) => setLoanField(index, 'loan_amount', t)} keyboardType="numeric" placeholderTextColor="#9CA3AF" />) : (<Text style={styles.fieldValue}>{loanMoney(loan.loan_amount)}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Sanction Date</Text>
                  {isEditing ? (<TextInput style={styles.input} value={loan.sanction_date || ''} onChangeText={(t) => setLoanField(index, 'sanction_date', t)} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />) : (<Text style={styles.fieldValue}>{loan.sanction_date || '-'}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Outstanding (₹)</Text>
                  {isEditing ? (<TextInput style={styles.input} value={String(loan.outstanding || '')} onChangeText={(t) => setLoanField(index, 'outstanding', t)} keyboardType="numeric" placeholderTextColor="#9CA3AF" />) : (<Text style={styles.fieldValue}>{loanMoney(loan.outstanding)}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>ROI (%)</Text>
                  {isEditing ? (<TextInput style={styles.input} value={String(loan.roi || '')} onChangeText={(t) => setLoanField(index, 'roi', t)} keyboardType="numeric" placeholderTextColor="#9CA3AF" />) : (<Text style={styles.fieldValue}>{loan.roi ? `${loan.roi}%` : '-'}</Text>)}
                </View>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>EMI (₹)</Text>
                  {isEditing ? (<TextInput style={styles.input} value={String(loan.emi || '')} onChangeText={(t) => setLoanField(index, 'emi', t)} keyboardType="numeric" placeholderTextColor="#9CA3AF" />) : (<Text style={styles.fieldValue}>{loanMoney(loan.emi)}</Text>)}
                </View>
              </View>
            ))}
            {[details.existing_loan_1, details.existing_loan_2, details.existing_loan_3].filter(Boolean).length > 0 && (
              <View style={styles.legacyBox}>
                <Text style={styles.legacyTitle}>Legacy CRM notes (read-only)</Text>
                {[details.existing_loan_1, details.existing_loan_2, details.existing_loan_3].filter(Boolean).map((t, i) => (
                  <Text key={i} style={styles.legacyText}>• {t}</Text>
                ))}
              </View>
            )}
          </View>

          {/* Loan Requirements */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🎯 Loan Requirements</Text>
            {renderSelectField('Type of Loan', 'type_of_loan', LOAN_TYPES)}
            {renderField('CIBIL Score', 'cibil_score', 'numeric')}
            {renderField('Loan Amount Required (₹)', 'loan_amount_required', 'numeric')}
            {renderField('Tenure Required (months)', 'tenure_required', 'numeric')}
          </View>

          {/* Status Update */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 Update Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusContainer}>
              {FILE_STATUSES.map(status => (
                <TouchableOpacity
                  key={status.value}
                  style={[
                    styles.statusChip,
                    selectedStatus === status.value && styles.statusChipActive
                  ]}
                  onPress={() => setSelectedStatus(status.value)}
                >
                  <Text style={[
                    styles.statusChipText,
                    selectedStatus === status.value && styles.statusChipTextActive
                  ]}>
                    {status.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity 
              style={[styles.updateBtn, selectedStatus === file?.file_status && styles.updateBtnDisabled]}
              onPress={handleStatusUpdate}
              disabled={selectedStatus === file?.file_status}
            >
              <Text style={styles.updateBtnText}>Update Status</Text>
            </TouchableOpacity>
          </View>

          {/* Assignment */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👥 Assign File</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusContainer}>
              {opsTeam.map(member => (
                <TouchableOpacity
                  key={member.id}
                  style={[
                    styles.assigneeChip,
                    selectedAssignee === member.id && styles.assigneeChipActive
                  ]}
                  onPress={() => setSelectedAssignee(member.id)}
                >
                  <Text style={[
                    styles.assigneeChipText,
                    selectedAssignee === member.id && styles.assigneeChipTextActive
                  ]}>
                    {member.full_name || member.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity 
              style={[styles.updateBtn, (!selectedAssignee || selectedAssignee === file?.file_assigned_to) && styles.updateBtnDisabled]}
              onPress={handleAssignment}
              disabled={!selectedAssignee || selectedAssignee === file?.file_assigned_to}
            >
              <Text style={styles.updateBtnText}>Assign</Text>
            </TouchableOpacity>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📝 Add Note</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Write a note..."
              multiline
              placeholderTextColor="#9CA3AF"
            />
            <TouchableOpacity 
              style={[styles.updateBtn, !note.trim() && styles.updateBtnDisabled]}
              onPress={handleAddNote}
              disabled={!note.trim()}
            >
              <Text style={styles.updateBtnText}>Add Note</Text>
            </TouchableOpacity>
          </View>

          {/* Activity Log */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📜 Activity Log</Text>
            {(file?.file_activities || []).slice().reverse().slice(0, 10).map((activity, idx) => (
              <View key={idx} style={styles.activityItem}>
                <Text style={styles.activityMessage}>{activity.message}</Text>
                <Text style={styles.activityTime}>
                  {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : 'N/A'}
                </Text>
              </View>
            ))}
            {(!file?.file_activities || file.file_activities.length === 0) && (
              <Text style={styles.noActivity}>No activity yet</Text>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    padding: 4,
  },
  backText: {
    fontSize: 16,
    color: '#16a34a',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    padding: 8,
  },
  editText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16a34a',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  cancelText: {
    fontSize: 14,
    color: '#6B7280',
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#16a34a',
  },
  saveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 12,
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 16,
  },
  eligibilityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#86efac',
    marginTop: 12,
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 16,
  },
  eligibilityBtnIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  eligibilityBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#15803d',
  },
  eligibilityBtnSub: {
    fontSize: 12,
    color: '#16a34a',
    marginTop: 2,
  },
  eligibilityBtnArrow: {
    fontSize: 24,
    color: '#16a34a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#16a34a',
    marginBottom: 16,
  },
  loansHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addLoanBtn: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addLoanText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  loansSummary: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 10,
  },
  noLoansText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  loanCard: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  loanCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  loanCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803d',
  },
  removeLoanText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  legacyBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  legacyTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b45309',
    marginBottom: 4,
  },
  legacyText: {
    fontSize: 13,
    color: '#374151',
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '500',
  },
  fieldValue: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  selectContainer: {
    flexDirection: 'row',
    marginTop: 4,
  },
  selectOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  selectOptionActive: {
    backgroundColor: '#16a34a',
  },
  selectOptionText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  selectOptionTextActive: {
    color: '#fff',
  },
  statusContainer: {
    marginBottom: 12,
  },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  statusChipActive: {
    backgroundColor: '#16a34a',
  },
  statusChipText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  statusChipTextActive: {
    color: '#fff',
  },
  assigneeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  assigneeChipActive: {
    backgroundColor: '#3B82F6',
  },
  assigneeChipText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  assigneeChipTextActive: {
    color: '#fff',
  },
  updateBtn: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  updateBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
  updateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  activityItem: {
    borderLeftWidth: 2,
    borderLeftColor: '#16a34a',
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  activityMessage: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  activityTime: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  noActivity: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 20,
  },
});

export default FileDetailScreen;
