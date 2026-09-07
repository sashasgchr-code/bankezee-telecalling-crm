import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
} from 'react-native';
import { registerGP } from '../services/api';

const CITIES = [
  'Hyderabad', 'Bangalore', 'Chennai', 'Mumbai', 'Delhi', 'Pune',
  'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Other',
];

const BANKS = [
  'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Bank of Baroda', 'Punjab National Bank', 'Canara Bank', 'Union Bank',
  'IndusInd Bank', 'Yes Bank', 'IDFC First Bank', 'Federal Bank', 'Other',
];

const RegisterScreen = ({ navigation }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(null); // 'city' | 'bank' | null

  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', city: '', password: '',
    pan_number: '',
    bank_name: '', account_holder: '', account_number: '', confirm_account_number: '', ifsc_code: '',
  });

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep1 = () => {
    if (!formData.name.trim()) return 'Please enter your full name';
    if (!formData.email.trim()) return 'Please enter your email';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Please enter a valid email';
    if (!formData.phone.trim()) return 'Please enter your phone number';
    if (!/^[6-9]\d{9}$/.test(formData.phone)) return 'Please enter a valid 10-digit phone number';
    if (!formData.city) return 'Please select your city';
    if (!formData.password || formData.password.length < 6) return 'Password must be at least 6 characters';
    return null;
  };

  const validateStep2 = () => {
    if (!formData.pan_number.trim()) return 'Please enter your PAN number';
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.pan_number.toUpperCase())) {
      return 'Please enter a valid PAN number (e.g., ABCDE1234F)';
    }
    return null;
  };

  const validateStep3 = () => {
    if (!formData.bank_name) return 'Please select your bank';
    if (!formData.account_holder.trim()) return 'Please enter account holder name';
    if (!formData.account_number.trim()) return 'Please enter account number';
    if (formData.account_number !== formData.confirm_account_number) return 'Account numbers do not match';
    if (!formData.ifsc_code.trim()) return 'Please enter IFSC code';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.ifsc_code.toUpperCase())) return 'Please enter a valid IFSC code';
    return null;
  };

  const handleNext = () => {
    let validationError = null;
    if (currentStep === 1) validationError = validateStep1();
    else if (currentStep === 2) validationError = validateStep2();
    if (validationError) {
      setError(validationError);
      return;
    }
    setCurrentStep((prev) => prev + 1);
    setError('');
  };

  const handleBack = () => {
    setCurrentStep((prev) => prev - 1);
    setError('');
  };

  const handleSubmit = async () => {
    const validationError = validateStep3();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const registrationData = {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        city: formData.city,
        password: formData.password,
        pan_number: formData.pan_number.toUpperCase(),
        bank_name: formData.bank_name,
        account_holder: formData.account_holder.trim(),
        account_number: formData.account_number.trim(),
        ifsc_code: formData.ifsc_code.toUpperCase(),
        role: 'telecaller',
        status: 'pending_approval',
        is_active: false,
      };
      await registerGP(registrationData);
      setCurrentStep(4);
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateCode = () => {
    if (!formData.name) return 'XXXXXX';
    const prefix = formData.name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
    return `${prefix}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  };

  const renderProgress = () => (
    <View style={styles.progressRow}>
      {[1, 2, 3].map((step) => (
        <React.Fragment key={step}>
          <View style={[
            styles.stepCircle,
            step === currentStep ? styles.stepCircleActive : step < currentStep ? styles.stepCircleDone : styles.stepCircleIdle,
          ]}>
            <Text style={[
              styles.stepCircleText,
              step === currentStep ? styles.stepTextActive : step < currentStep ? styles.stepTextDone : styles.stepTextIdle,
            ]}>{step < currentStep ? '✓' : step}</Text>
          </View>
          {step < 3 && <View style={[styles.stepLine, step < currentStep && styles.stepLineDone]} />}
        </React.Fragment>
      ))}
    </View>
  );

  const renderPicker = (label, field, options) => (
    <TouchableOpacity style={styles.selectBox} onPress={() => setPickerOpen(field)} data-testid={`${field}-input`}>
      <Text style={formData[field] ? styles.selectText : styles.selectPlaceholder}>
        {formData[field] || label}
      </Text>
      <Text style={styles.selectChevron}>▾</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoWrap}>
          <Text style={styles.logoTitle}>BANKEZEE</Text>
          <Text style={styles.logoSub}>Connect</Text>
        </View>

        {currentStep < 4 && renderProgress()}

        <View style={styles.card}>
          {error ? (
            <View style={styles.errorBox} data-testid="register-error">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Step 1: Basic Information */}
          {currentStep === 1 && (
            <View>
              <Text style={styles.cardTitle}>Basic Information</Text>
              <Text style={styles.cardSubtitle}>Enter your personal details</Text>

              <Text style={styles.label}>Full Name *</Text>
              <TextInput style={styles.input} value={formData.name} onChangeText={(t) => updateField('name', t)}
                placeholder="Enter your full name" placeholderTextColor="#9CA3AF" data-testid="name-input" />

              <Text style={styles.label}>Email Address *</Text>
              <TextInput style={styles.input} value={formData.email} onChangeText={(t) => updateField('email', t)}
                placeholder="Enter your email" placeholderTextColor="#9CA3AF" keyboardType="email-address"
                autoCapitalize="none" autoCorrect={false} data-testid="email-input" />

              <Text style={styles.label}>Phone Number *</Text>
              <TextInput style={styles.input} value={formData.phone}
                onChangeText={(t) => updateField('phone', t.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number" placeholderTextColor="#9CA3AF" keyboardType="phone-pad"
                data-testid="phone-input" />

              <Text style={styles.label}>City *</Text>
              {renderPicker('Select your city', 'city', CITIES)}

              <Text style={styles.label}>Password *</Text>
              <View style={styles.passwordWrap}>
                <TextInput style={styles.passwordInput} value={formData.password}
                  onChangeText={(t) => updateField('password', t)}
                  placeholder="Minimum 6 characters" placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPassword} data-testid="password-input" />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>

              {/* Partner Code Preview */}
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Your Partner Code (auto-generated)</Text>
                <Text style={styles.codeValue}>{generateCode()}</Text>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} data-testid="register-continue-btn">
                <Text style={styles.primaryBtnText}>Continue  →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: KYC Details */}
          {currentStep === 2 && (
            <View>
              <Text style={styles.cardTitle}>KYC Details</Text>
              <Text style={styles.cardSubtitle}>Verify your identity</Text>

              <Text style={styles.label}>PAN Number *</Text>
              <TextInput style={styles.input} value={formData.pan_number}
                onChangeText={(t) => updateField('pan_number', t.toUpperCase().slice(0, 10))}
                placeholder="ABCDE1234F" placeholderTextColor="#9CA3AF" autoCapitalize="characters"
                data-testid="pan-input" />
              <Text style={styles.hint}>Format: 5 letters, 4 numbers, 1 letter</Text>

              <Text style={[styles.label, { marginTop: 16 }]}>ID Document (Optional)</Text>
              <TouchableOpacity
                style={styles.uploadBox}
                onPress={() => Alert.alert('ID Document', 'Optional. You can submit your ID document later once your account is approved.')}>
                <Text style={styles.uploadIcon}>⬆️</Text>
                <Text style={styles.uploadText}>Upload Aadhaar / Driving License / Passport</Text>
                <Text style={styles.uploadSub}>Can be added later after approval</Text>
              </TouchableOpacity>

              <View style={styles.rowBtns}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack}>
                  <Text style={styles.secondaryBtnText}>←  Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtnFlex} onPress={handleNext} data-testid="register-continue-btn">
                  <Text style={styles.primaryBtnText}>Continue  →</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Step 3: Bank Details */}
          {currentStep === 3 && (
            <View>
              <Text style={styles.cardTitle}>Bank Details</Text>
              <Text style={styles.cardSubtitle}>For commission payouts</Text>

              <Text style={styles.label}>Bank Name *</Text>
              {renderPicker('Select your bank', 'bank_name', BANKS)}

              <Text style={styles.label}>Account Holder Name *</Text>
              <TextInput style={styles.input} value={formData.account_holder}
                onChangeText={(t) => updateField('account_holder', t)}
                placeholder="Name as per bank account" placeholderTextColor="#9CA3AF" data-testid="account-holder-input" />

              <Text style={styles.label}>Account Number *</Text>
              <TextInput style={styles.input} value={formData.account_number}
                onChangeText={(t) => updateField('account_number', t.replace(/\D/g, ''))}
                placeholder="Enter account number" placeholderTextColor="#9CA3AF" keyboardType="numeric"
                data-testid="account-number-input" />

              <Text style={styles.label}>Confirm Account Number *</Text>
              <TextInput style={styles.input} value={formData.confirm_account_number}
                onChangeText={(t) => updateField('confirm_account_number', t.replace(/\D/g, ''))}
                placeholder="Re-enter account number" placeholderTextColor="#9CA3AF" keyboardType="numeric" />

              <Text style={styles.label}>IFSC Code *</Text>
              <TextInput style={styles.input} value={formData.ifsc_code}
                onChangeText={(t) => updateField('ifsc_code', t.toUpperCase().slice(0, 11))}
                placeholder="e.g., SBIN0001234" placeholderTextColor="#9CA3AF" autoCapitalize="characters"
                data-testid="ifsc-input" />

              <View style={styles.rowBtns}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack}>
                  <Text style={styles.secondaryBtnText}>←  Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtnFlex, isLoading && { opacity: 0.6 }]}
                  onPress={handleSubmit} disabled={isLoading} data-testid="register-submit-btn">
                  {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit Registration</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Step 4: Success */}
          {currentStep === 4 && (
            <View style={styles.successWrap}>
              <View style={styles.successIcon}><Text style={{ fontSize: 32 }}>✅</Text></View>
              <Text style={styles.cardTitle}>Registration Submitted!</Text>
              <Text style={styles.cardSubtitle}>
                Your registration is pending admin approval. You'll receive an email once your account is activated.
              </Text>
              <View style={styles.nextBox}>
                <Text style={styles.nextTitle}>What happens next?</Text>
                <Text style={styles.nextItem}>• Admin will review your details</Text>
                <Text style={styles.nextItem}>• You'll receive approval notification</Text>
                <Text style={styles.nextItem}>• Once approved, you can login and start working</Text>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('Login')} data-testid="go-to-login-btn">
                <Text style={styles.primaryBtnText}>Go to Login</Text>
              </TouchableOpacity>
            </View>
          )}

          {currentStep < 4 && (
            <Text style={styles.loginRow}>
              Already have an account?{' '}
              <Text style={styles.loginLink} onPress={() => navigation.navigate('Login')} data-testid="signin-link">Sign In</Text>
            </Text>
          )}
        </View>
      </ScrollView>

      {/* City / Bank picker modal */}
      <Modal visible={!!pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerOpen(null)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>{pickerOpen === 'city' ? 'Select City' : 'Select Bank'}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(pickerOpen === 'city' ? CITIES : BANKS).map((opt) => (
                <TouchableOpacity key={opt} style={styles.pickerItem}
                  onPress={() => { updateField(pickerOpen, opt); setPickerOpen(null); }}>
                  <Text style={styles.pickerItemText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0fdf4' },
  scroll: { padding: 20, paddingBottom: 40 },
  logoWrap: { alignItems: 'center', marginTop: 24, marginBottom: 20 },
  logoTitle: { fontSize: 30, fontWeight: 'bold', color: '#16a34a', letterSpacing: 1 },
  logoSub: { fontSize: 20, color: '#6b7280', marginTop: -2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  stepCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: '#16a34a' },
  stepCircleDone: { backgroundColor: '#dcfce7' },
  stepCircleIdle: { backgroundColor: '#f3f4f6' },
  stepCircleText: { fontSize: 14, fontWeight: '600' },
  stepTextActive: { color: '#fff' },
  stepTextDone: { color: '#16a34a' },
  stepTextIdle: { color: '#9ca3af' },
  stepLine: { width: 48, height: 4, borderRadius: 2, backgroundColor: '#e5e7eb', marginHorizontal: 4 },
  stepLineDone: { backgroundColor: '#16a34a' },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 4 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#6b7280', marginBottom: 18 },
  errorBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { color: '#dc2626', fontSize: 13 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', marginBottom: 12 },
  hint: { fontSize: 11, color: '#9ca3af', marginTop: -6, marginBottom: 8 },
  passwordWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, marginBottom: 12 },
  passwordInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827' },
  eyeBtn: { padding: 12 },
  eyeText: { fontSize: 18 },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 12 },
  selectText: { fontSize: 15, color: '#111827' },
  selectPlaceholder: { fontSize: 15, color: '#9CA3AF' },
  selectChevron: { fontSize: 14, color: '#6b7280' },
  codeBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, padding: 12, marginTop: 6, marginBottom: 4 },
  codeLabel: { fontSize: 11, color: '#16a34a', marginBottom: 4 },
  codeValue: { fontSize: 16, fontWeight: 'bold', color: '#15803d', letterSpacing: 1 },
  primaryBtn: { backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryBtnFlex: { flex: 1, backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  secondaryBtnText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', gap: 12, marginTop: 18 },
  uploadBox: { borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed', borderRadius: 12, padding: 20, alignItems: 'center' },
  uploadIcon: { fontSize: 22, marginBottom: 6 },
  uploadText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  uploadSub: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  successWrap: { alignItems: 'center', paddingVertical: 8 },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  nextBox: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 16, marginVertical: 18, alignSelf: 'stretch' },
  nextTitle: { fontSize: 13, fontWeight: '700', color: '#b45309', marginBottom: 8 },
  nextItem: { fontSize: 13, color: '#d97706', marginBottom: 4 },
  loginRow: { textAlign: 'center', marginTop: 18, color: '#6b7280', fontSize: 14 },
  loginLink: { color: '#16a34a', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30 },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  pickerItemText: { fontSize: 15, color: '#374151' },
});

export default RegisterScreen;
