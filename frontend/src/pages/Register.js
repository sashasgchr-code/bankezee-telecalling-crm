import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Mail, Lock, Eye, EyeOff, User, Loader2, Phone, MapPin, 
  CreditCard, Building2, FileText, Upload, CheckCircle, ArrowRight, ArrowLeft
} from 'lucide-react';
import api from '../services/api';
import { toast } from 'sonner';

// City options
const CITIES = [
  'Hyderabad', 'Bangalore', 'Chennai', 'Mumbai', 'Delhi', 'Pune', 
  'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Other'
];

// Bank options
const BANKS = [
  'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Bank of Baroda', 'Punjab National Bank', 'Canara Bank', 'Union Bank',
  'IndusInd Bank', 'Yes Bank', 'IDFC First Bank', 'Federal Bank', 'Other'
];

const Register = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Form data
  const [formData, setFormData] = useState({
    // Basic Information
    name: '',
    email: '',
    phone: '',
    city: '',
    password: '',
    
    // KYC Details
    pan_number: '',
    id_document: null,
    id_document_name: '',
    
    // Bank Details
    bank_name: '',
    account_holder: '',
    account_number: '',
    confirm_account_number: '',
    ifsc_code: ''
  });

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be less than 5MB');
        return;
      }
      setFormData(prev => ({ 
        ...prev, 
        id_document: file,
        id_document_name: file.name 
      }));
    }
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
    if (formData.account_number !== formData.confirm_account_number) {
      return 'Account numbers do not match';
    }
    if (!formData.ifsc_code.trim()) return 'Please enter IFSC code';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.ifsc_code.toUpperCase())) {
      return 'Please enter a valid IFSC code';
    }
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
    
    setCurrentStep(prev => prev + 1);
    setError('');
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const validationError = validateStep3();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Create registration request (pending approval)
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
        is_active: false
      };

      await api.post('/auth/register-gp', registrationData);
      
      // Show success and redirect
      setCurrentStep(4); // Success step
      
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Generate partner code preview
  const generateCode = () => {
    if (!formData.name) return 'XXXXXX';
    const prefix = formData.name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
    return `${prefix}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex flex-col items-center justify-center p-4 sm:p-6" data-testid="register-page">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-green-600">BANKEZEE</h1>
          <p className="text-xl sm:text-2xl text-gray-600 -mt-1">Connect</p>
        </div>

        {/* Progress Steps */}
        {currentStep < 4 && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {[1, 2, 3].map((step) => (
              <React.Fragment key={step}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === currentStep
                    ? 'bg-green-600 text-white'
                    : step < currentStep
                    ? 'bg-green-100 text-green-600'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {step < currentStep ? <CheckCircle size={16} /> : step}
                </div>
                {step < 3 && (
                  <div className={`w-12 h-1 rounded ${step < currentStep ? 'bg-green-600' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm" data-testid="register-error">
              {error}
            </div>
          )}

          {/* Step 1: Basic Information */}
          {currentStep === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Basic Information</h2>
              <p className="text-gray-500 text-sm mb-6">Enter your personal details</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      data-testid="name-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      placeholder="Enter your email"
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      data-testid="email-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => updateField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile number"
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      data-testid="phone-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select
                      value={formData.city}
                      onChange={(e) => updateField('city', e.target.value)}
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 appearance-none"
                      data-testid="city-input"
                    >
                      <option value="">Select your city</option>
                      {CITIES.map(city => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => updateField('password', e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full px-4 py-3 pl-10 pr-12 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                      data-testid="password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                {/* Partner Code Preview */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs text-green-600 mb-1">Your Partner Code (auto-generated)</p>
                  <p className="font-mono font-bold text-green-700">{generateCode()}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleNext}
                className="w-full mt-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2"
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step 2: KYC Details */}
          {currentStep === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">KYC Details</h2>
              <p className="text-gray-500 text-sm mb-6">Verify your identity</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number *</label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      value={formData.pan_number}
                      onChange={(e) => updateField('pan_number', e.target.value.toUpperCase().slice(0, 10))}
                      placeholder="ABCDE1234F"
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                      data-testid="pan-input"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Format: 5 letters, 4 numbers, 1 letter</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ID Document (Optional)</label>
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-green-400 transition-colors">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="id-document"
                    />
                    <label htmlFor="id-document" className="cursor-pointer">
                      {formData.id_document_name ? (
                        <div className="flex items-center justify-center gap-2 text-green-600">
                          <FileText size={20} />
                          <span className="text-sm font-medium">{formData.id_document_name}</span>
                        </div>
                      ) : (
                        <div>
                          <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                          <p className="text-sm text-gray-500">Upload Aadhaar / Driving License / Passport</p>
                          <p className="text-xs text-gray-400 mt-1">PDF or Image, max 5MB</p>
                        </div>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} /> Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  Continue <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Bank Details */}
          {currentStep === 3 && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Bank Details</h2>
              <p className="text-gray-500 text-sm mb-6">For commission payouts</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name *</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select
                      value={formData.bank_name}
                      onChange={(e) => updateField('bank_name', e.target.value)}
                      className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 appearance-none"
                      data-testid="bank-input"
                    >
                      <option value="">Select your bank</option>
                      {BANKS.map(bank => (
                        <option key={bank} value={bank}>{bank}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder Name *</label>
                  <input
                    type="text"
                    value={formData.account_holder}
                    onChange={(e) => updateField('account_holder', e.target.value)}
                    placeholder="Name as per bank account"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    data-testid="account-holder-input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Number *</label>
                  <input
                    type="text"
                    value={formData.account_number}
                    onChange={(e) => updateField('account_number', e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter account number"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    data-testid="account-number-input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Account Number *</label>
                  <input
                    type="text"
                    value={formData.confirm_account_number}
                    onChange={(e) => updateField('confirm_account_number', e.target.value.replace(/\D/g, ''))}
                    placeholder="Re-enter account number"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">IFSC Code *</label>
                  <input
                    type="text"
                    value={formData.ifsc_code}
                    onChange={(e) => updateField('ifsc_code', e.target.value.toUpperCase().slice(0, 11))}
                    placeholder="e.g., SBIN0001234"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
                    data-testid="ifsc-input"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} /> Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2 disabled:opacity-50"
                  data-testid="register-submit-btn"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Registration'}
                </button>
              </div>
            </form>
          )}

          {/* Step 4: Success */}
          {currentStep === 4 && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted!</h2>
              <p className="text-gray-500 mb-6">
                Your registration is pending admin approval. You'll receive an email once your account is activated.
              </p>
              
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-amber-700 font-medium mb-2">What happens next?</p>
                <ul className="text-sm text-amber-600 space-y-1">
                  <li>• Admin will review your details</li>
                  <li>• You'll receive approval notification</li>
                  <li>• Once approved, you can login and start working</li>
                </ul>
              </div>

              <Link
                to="/login"
                className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
              >
                Go to Login
              </Link>
            </div>
          )}

          {/* Login Link */}
          {currentStep < 4 && (
            <p className="text-center mt-6 text-gray-500 text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-green-600 font-semibold hover:underline" data-testid="login-link">
                Sign In
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Register;
