import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Save, Edit2, Loader2, Star, Building2, Download, 
  Trash2, Plus, Eye, EyeOff, Upload, ChevronDown, ChevronUp,
  User, Briefcase, CreditCard, FileText, Phone, Mail, MapPin,
  Calendar, Copy, Check
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import ExistingLoansEditor from '../../components/file-detail/ExistingLoansEditor';
import BankEligibilityRow from '../../components/file-detail/BankEligibilityRow';
import { FILE_STATUS_OPTIONS, getFileStatusLabel } from '../../components/file-detail/FileStatusCard';

// Legacy CRM rows store the decision flags as 'yes'/'no'; some Connect rows stored booleans.
// The UI works in 'yes'/'no' only, so every row is normalized on load.
const YES_NO_FIELDS = ['is_eligible', 'login_done', 'disbursed', 'tvr_done', 'emi_ok',
  'rc_submitted', 'noc_submitted', 'hypothecation'];

const normalizeEligibilities = (rows) => (Array.isArray(rows) ? rows : []).map(row => {
  const bank = { ...row };
  YES_NO_FIELDS.forEach(field => {
    const value = bank[field];
    if (typeof value === 'boolean') bank[field] = value ? 'yes' : 'no';
    else if (value === null || value === undefined) bank[field] = '';
    else bank[field] = String(value).toLowerCase();
  });
  if (!bank.eligible_roi && bank.roi) bank.eligible_roi = bank.roi;
  return bank;
});

// Format currency
const formatCurrency = (amount) => {
  if (!amount) return '';
  return new Intl.NumberFormat('en-IN').format(parseFloat(amount));
};

// Mask sensitive data
const maskPhone = (phone) => {
  if (!phone) return '-';
  const str = String(phone);
  if (str.length >= 10) return '******' + str.slice(-4);
  return str;
};

const maskEmail = (email) => {
  if (!email) return '-';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return local.slice(0, 2) + '****@' + domain;
};

// Generate password for protected files
const generateFilePassword = (fileId) => {
  const timestamp = Date.now();
  return `7${timestamp}${fileId?.slice(0, 8) || ''}`.slice(0, 20);
};

// Empty bank eligibility template
const EMPTY_BANK = {
  bank_name: '',
  is_eligible: '',
  eligible_amount: '',
  eligible_roi: '',
  not_eligible_reason: '',
  // Login Status
  login_done: '',
  login_bank: '',
  application_id: '',
  sm_name: '',
  sm_number: '',
  login_rejection_reason: '',
  // Approval Status
  approval_status: '',
  approved_bank: '',
  approved_amount: '',
  approved_tenure: '',
  approved_roi: '',
  declined_bank: '',
  declined_reason: '',
  // Vehicle loan conditions
  rc_submitted: '',
  rc_not_submitted_reason: '',
  noc_submitted: '',
  noc_not_submitted_reason: '',
  hypothecation: '',
  hypothecation_not_done_reason: '',
  // Disbursement
  disbursed: '',
  disbursal_date: '',
  disbursed_bank: '',
  disbursed_amount: '',
  disbursed_tenure: '',
  disbursed_roi: '',
  disbursement_rejection_reason: '',
  // Commission
  commission_percentage: '',
  commission_amount: ''
};

const FileDetailsPage = () => {
  const { fileId } = useParams();
  const navigate = useNavigate();
  
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Edit modes
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedDetails, setEditedDetails] = useState({});
  
  // Profile Analysis
  const [profileAnalysis, setProfileAnalysis] = useState({
    cibil_issues: '',
    foir: '',
    company_type: ''
  });
  
  // Bank Eligibilities (manual entry)
  const [eligibilities, setEligibilities] = useState([]);
  const [bankOptions, setBankOptions] = useState([]);
  const [showStarModal, setShowStarModal] = useState(false);
  const [starDraft, setStarDraft] = useState({ star_rating: 3, reason: '' });
  const [savingEligibilities, setSavingEligibilities] = useState(false);
  
  // Status update
  const [newStatus, setNewStatus] = useState('new');
  
  // Documents
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  
  // Activity
  const [note, setNote] = useState('');
  const [activities, setActivities] = useState([]);
  
  // UI state
  const [showMobile, setShowMobile] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [expandedBanks, setExpandedBanks] = useState({});
  
  // User permissions
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  const isOps = user.role === 'ops' || user.role === 'operations';
  const isManager = user.role === 'manager';
  const isHr = user.role === 'hr';
  const isGP = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'growth_partner'].includes(user.role);
  
  // GP, Admin, Ops, Managers can edit customer details (Image 1)
  const canEditLeadInfo = isAdmin || isOps || isManager || isGP;
  
  // Only Admin, Ops, Managers can edit Bank Eligibilities (Image 2 & 3)
  const canEditBankInfo = isAdmin || isOps || isManager;
  // SM name/number stay Admin/Ops only, as in the old CRM
  const canEditSmDetails = isAdmin || isOps;
  const loanType = String(fileData?.file_details?.type_of_loan || fileData?.requirement || '').toLowerCase();
  const isVehicleLoan = loanType.includes('vehicle') || loanType.includes('car') || loanType.includes('auto');
  const isUsedVehicleBt = isVehicleLoan && loanType.includes('used') && loanType.includes('bt');

  useEffect(() => {
    fetchFileData();
  }, [fileId]);

  const fetchFileData = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/files/${fileId}`);
      const data = response.data;
      
      if (!data) {
        toast.error('File not found');
        navigate(-1);
        return;
      }
      
      setFileData(data);
      setNewStatus(data.file_status || 'new');
      
      // Initialize details
      const fd = data.file_details || {};
      setEditedDetails({
        full_name: fd.full_name || data.name || '',
        mobile: fd.mobile || data.phone || '',
        email: fd.email || data.email || '',
        mother_name: fd.mother_name || '',
        current_address: fd.current_address || '',
        employment_type: fd.employment_type || data.employment_type || '',
        company_name: fd.company_name || '',
        net_salary: fd.net_salary || '',
        office_address: fd.office_address || '',
        monthly_emi_obligations: fd.monthly_emi_obligations || fd.obligations_emi || '',
        existing_loan_1: fd.existing_loan_1 || '',
        existing_loan_2: fd.existing_loan_2 || '',
        existing_loan_3: fd.existing_loan_3 || '',
        existing_loans: Array.isArray(fd.existing_loans) ? fd.existing_loans : [],
        type_of_loan: fd.type_of_loan || data.requirement || '',
        cibil_score: fd.cibil_score || '',
        loan_amount_required: fd.loan_amount_required || '',
        tenure_required: fd.tenure_required || '',
        source_type: fd.source_type || 'Agent',
        growth_partner_name: data.source_name || fd.growth_partner_name || '',
        growth_partner_code: fd.growth_partner_code || '',
        growth_partner_contact: fd.growth_partner_contact || ''
      });
      
      // Profile Analysis
      setProfileAnalysis({
        cibil_issues: fd.cibil_issues || '',
        foir: fd.foir || '',
        company_type: fd.company_type || ''
      });
      
      // Bank Eligibilities
      setEligibilities(normalizeEligibilities(data.eligibilities));
      
      // Documents
      setDocuments(data.documents || []);
      
      // Activities
      setActivities(data.file_activities || data.activities || []);
      
    } catch (error) {
      toast.error('Failed to load file data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get('/files/bank-names')
      .then(res => setBankOptions(res.data?.banks || []))
      .catch(() => setBankOptions([]));
  }, []);

  const handleStarOverride = async (payload) => {
    try {
      await api.put(`/files/${fileId}/star-rating`, payload);
      await fetchFileData();
      setShowStarModal(false);
      toast.success(payload.star_manual === false ? 'Star rating back to automatic' : 'Star rating updated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update star rating');
    }
  };

  const handleSaveDetails = async () => {    setSaving(true);
    try {
      await api.put(`/files/${fileId}/details`, {
        full_name: editedDetails.full_name,
        mobile: editedDetails.mobile,
        email: editedDetails.email,
        additional_data: editedDetails
      });
      toast.success('Details saved successfully');
      setIsEditingDetails(false);
      fetchFileData();
    } catch (error) {
      toast.error('Failed to save details');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfileAnalysis = async () => {
    setSaving(true);
    try {
      await api.put(`/files/${fileId}/details`, {
        additional_data: {
          ...fileData?.file_details,
          ...profileAnalysis
        }
      });
      toast.success('Profile analysis saved');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to save profile analysis');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEligibilities = async (rowsInput, successMessage = 'Bank eligibilities saved') => {
    const rows = Array.isArray(rowsInput) ? rowsInput : eligibilities;
    const banks = rows.filter(b => (b.bank_name || '').trim());
    if (banks.length !== rows.length) {
      toast.error('Every bank needs a name before saving');
      return false;
    }
    setSavingEligibilities(true);
    try {
      // Persist first, then adopt exactly what the backend stored (no optimistic success)
      const response = await api.put(`/files/${fileId}/eligibilities`, { eligibilities: banks });
      setEligibilities(normalizeEligibilities(response.data?.eligibilities || banks));
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save eligibilities - your entries are still here');
      return false;
    } finally {
      setSavingEligibilities(false);
    }
  };

  const handleSaveBank = (index) =>
    handleSaveEligibilities(eligibilities, `Bank #${index + 1} saved`);

  const handleAddBank = () => {
    if (eligibilities.length >= 7) {
      toast.error('Maximum 7 banks allowed');
      return;
    }
    setEligibilities([...eligibilities, { ...EMPTY_BANK }]);
  };

  const handleRemoveBank = async (index) => {
    const remaining = eligibilities.filter((_, i) => i !== index);
    if (!(eligibilities[index]?.bank_name || '').trim()) {
      setEligibilities(remaining);  // never saved, nothing to persist
      return;
    }
    if (!window.confirm(`Remove Bank #${index + 1}${eligibilities[index].bank_name ? ` (${eligibilities[index].bank_name})` : ''}?`)) return;
    await handleSaveEligibilities(remaining, `Bank #${index + 1} removed`);
  };

  const handleBankChange = (index, field, value) => {
    const updated = [...eligibilities];
    updated[index] = { ...updated[index], [field]: value };
    setEligibilities(updated);
  };

  const handleStatusUpdate = async () => {
    try {
      await api.put(`/files/${fileId}/file-status`, { file_status: newStatus });
      toast.success('Status updated');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/files/${fileId}/notes`, { note });
      toast.success('Note added');
      setNote('');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to add note');
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    
    setUploading(true);
    const formData = new FormData();
    for (let file of files) {
      formData.append('files', file);
    }
    
    try {
      await api.post(`/files/${fileId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Documents uploaded');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to upload documents');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      await api.delete(`/files/${fileId}/documents/${docId}`);
      toast.success('Document deleted');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  const handleDownloadAll = async () => {
    try {
      const response = await api.get(`/files/${fileId}/documents/download-all`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${fileData?.name || 'documents'}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error('Failed to download documents');
    }
  };

  const copyPassword = () => {
    const password = generateFilePassword(fileId);
    navigator.clipboard.writeText(password);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  const toggleBankExpand = (index) => {
    setExpandedBanks(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  const fd = fileData?.file_details || {};
  const filePassword = generateFilePassword(fileId);

  return (
    <div className="min-h-screen bg-gray-50 pb-24" data-testid="file-details-page">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-gray-900">File Details</h1>
            {fileData?.star_rating > 0 && (
              <div className="flex items-center gap-2 pl-3 ml-1 border-l border-gray-200" data-testid="file-star-rating">
                <span className="text-amber-500 text-lg leading-none tracking-tight" aria-hidden="true">
                  {'★'.repeat(fileData.star_rating)}{'☆'.repeat(5 - fileData.star_rating)}
                </span>
                <span className="text-sm font-semibold text-gray-800" data-testid="file-star-label">
                  {fileData.star_rating} Star Profile
                </span>
                <span className="text-xs text-gray-500" data-testid="file-star-score">
                  Score: {fileData.star_score}/100
                </span>
                {fileData.star_manual && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">manual</span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => { setStarDraft({ star_rating: fileData.star_rating || 3, reason: fileData.star_override_reason || '' }); setShowStarModal(true); }}
                    className="text-xs text-green-700 underline hover:text-green-800"
                    data-testid="star-override-btn"
                  >
                    Set manually
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const basePath = isAdmin || isOps || isManager ? '/admin' : (isHr ? '/hr' : '/agent');
              navigate(`${basePath}/files/${fileId}/check-eligibility`);
            }}
            className={`px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2 ${isHr ? 'hidden' : ''}`}
          >
            <Building2 size={18} />
            Check Eligibility
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Lead Information */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Complete Lead Information */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Complete Lead Information</h2>
                {canEditLeadInfo && (
                  <button
                    onClick={() => isEditingDetails ? handleSaveDetails() : setIsEditingDetails(true)}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : isEditingDetails ? <Save size={16} /> : <Edit2 size={16} />}
                    {isEditingDetails ? 'Save Details' : 'Edit Details'}
                  </button>
                )}
              </div>

              {/* Customer Details */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-green-600 mb-3">Customer Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Full Name</label>
                    {isEditingDetails ? (
                      <input
                        type="text"
                        value={editedDetails.full_name}
                        onChange={(e) => setEditedDetails({...editedDetails, full_name: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.full_name || fileData?.name || '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Mobile</label>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">
                        {showMobile ? (fd.mobile || fileData?.phone || '-') : maskPhone(fd.mobile || fileData?.phone)}
                      </p>
                      <button onClick={() => setShowMobile(!showMobile)} className="text-gray-400 hover:text-gray-600">
                        {showMobile ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Email</label>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">
                        {showEmail ? (fd.email || fileData?.email || '-') : maskEmail(fd.email || fileData?.email)}
                      </p>
                      <button onClick={() => setShowEmail(!showEmail)} className="text-gray-400 hover:text-gray-600">
                        {showEmail ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Mother Name</label>
                    {isEditingDetails ? (
                      <input
                        type="text"
                        value={editedDetails.mother_name}
                        onChange={(e) => setEditedDetails({...editedDetails, mother_name: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.mother_name || '-'}</p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">Current Address</label>
                    {isEditingDetails ? (
                      <input
                        type="text"
                        value={editedDetails.current_address}
                        onChange={(e) => setEditedDetails({...editedDetails, current_address: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.current_address || '-'}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Employment Details */}
              <div className="mb-6 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-green-600 mb-3">Employment Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Employment Type</label>
                    {isEditingDetails ? (
                      <select
                        value={editedDetails.employment_type}
                        onChange={(e) => setEditedDetails({...editedDetails, employment_type: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      >
                        <option value="">Select</option>
                        <option value="salaried">Salaried</option>
                        <option value="self_employed">Self Employed</option>
                        <option value="business">Business</option>
                      </select>
                    ) : (
                      <p className="font-medium text-gray-900 capitalize">{fd.employment_type || '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Company Name</label>
                    {isEditingDetails ? (
                      <input
                        type="text"
                        value={editedDetails.company_name}
                        onChange={(e) => setEditedDetails({...editedDetails, company_name: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.company_name || '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Net Salary (₹)</label>
                    {isEditingDetails ? (
                      <input
                        type="number"
                        value={editedDetails.net_salary}
                        onChange={(e) => setEditedDetails({...editedDetails, net_salary: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.net_salary ? formatCurrency(fd.net_salary) : '-'}</p>
                    )}
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-xs text-gray-500 block mb-1">Office Address</label>
                    {isEditingDetails ? (
                      <input
                        type="text"
                        value={editedDetails.office_address}
                        onChange={(e) => setEditedDetails({...editedDetails, office_address: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.office_address || '-'}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Existing Loans & Obligations */}
              <div className="mb-6 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-green-600 mb-3">Existing Loans & Obligations</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Monthly EMI Obligations (₹)</label>
                    {isEditingDetails ? (
                      <input
                        type="number"
                        value={editedDetails.monthly_emi_obligations}
                        onChange={(e) => setEditedDetails({...editedDetails, monthly_emi_obligations: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.monthly_emi_obligations || fd.obligations_emi || '0'}</p>
                    )}
                  </div>
                </div>
                <ExistingLoansEditor
                  loans={editedDetails.existing_loans}
                  legacyLoans={[fd.existing_loan_1, fd.existing_loan_2, fd.existing_loan_3]}
                  isEditing={isEditingDetails}
                  onChange={(loans) => setEditedDetails({...editedDetails, existing_loans: loans})}
                />
              </div>

              {/* Loan Requirements */}
              <div className="mb-6 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-green-600 mb-3">Loan Requirements</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Type of Loan</label>
                    {isEditingDetails ? (
                      <select
                        value={editedDetails.type_of_loan}
                        onChange={(e) => setEditedDetails({...editedDetails, type_of_loan: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      >
                        <option value="">Select</option>
                        <option value="new_personal_loan">New Personal Loan</option>
                        <option value="balance_transfer_topup_pl">Balance Transfer+Top Up PL</option>
                        <option value="used_vehicle_loan_bt">Used Vehicle Loan BT</option>
                        <option value="used_vehicle_loan_fresh">Used Vehicle Loan Fresh</option>
                        <option value="new_vehicle_loan">New Vehicle Loan</option>
                        <option value="merge_multiple_loans">Merge Multiple Loans</option>
                        <option value="balance_transfer_pl">Balance Transfer PL</option>
                        <option value="top_up_pl">Top Up PL</option>
                        <option value="bt_topup_hl">BT Topup HL</option>
                        <option value="reduce_home_loan_emi">Reduce Home Loan EMI</option>
                        <option value="business_loan">Business Loan</option>
                        <option value="new_home_loan">New Home Loan</option>
                      </select>
                    ) : (
                      <p className="font-medium text-gray-900">{fd.type_of_loan?.replace(/_/g, ' ') || '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">CIBIL Score</label>
                    {isEditingDetails ? (
                      <input
                        type="number"
                        value={editedDetails.cibil_score}
                        onChange={(e) => setEditedDetails({...editedDetails, cibil_score: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.cibil_score || '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Loan Amount Required (₹)</label>
                    {isEditingDetails ? (
                      <input
                        type="number"
                        value={editedDetails.loan_amount_required}
                        onChange={(e) => setEditedDetails({...editedDetails, loan_amount_required: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.loan_amount_required ? formatCurrency(fd.loan_amount_required) : '-'}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Tenure Required (months)</label>
                    {isEditingDetails ? (
                      <input
                        type="number"
                        value={editedDetails.tenure_required}
                        onChange={(e) => setEditedDetails({...editedDetails, tenure_required: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    ) : (
                      <p className="font-medium text-gray-900">{fd.tenure_required || '-'}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Lead Source & Status */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-sm font-semibold text-green-600 mb-3">Lead Source & Status</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Source Type</label>
                    <p className="font-medium text-gray-900">{fd.source_type || 'Agent'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Growth Partner Name</label>
                    <p className="font-medium text-gray-900">{fileData?.source_name || fd.growth_partner_name || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Growth Partner Code</label>
                    <p className="font-medium text-green-600">{fd.growth_partner_code || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Growth Partner Contact</label>
                    <p className="font-medium text-gray-900">{fd.growth_partner_contact || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Current Status</label>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                      fileData?.file_status === 'disbursed' ? 'bg-green-100 text-green-700' :
                      fileData?.file_status === 'approved' ? 'bg-blue-100 text-blue-700' :
                      fileData?.file_status === 'login' ? 'bg-purple-100 text-purple-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {fileData?.file_status?.replace(/_/g, ' ') || 'New'}
                    </span>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Created</label>
                    <p className="font-medium text-gray-900" data-testid="lead-created-date">
                      {fileData?.created_at ? new Date(fileData.created_at).toLocaleDateString('en-IN') : '-'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">File Created</label>
                    <p className="font-medium text-gray-900" data-testid="file-created-date">
                      {fileData?.file_created_at
                        ? new Date(fileData.file_created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Profile Analysis - Visible to all, editable by Admin, Ops, Managers only */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-green-600 flex items-center gap-2">
                    <Star size={18} />
                    Profile Analysis
                    {!canEditBankInfo && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                        View Only
                      </span>
                    )}
                  </h2>
                  {canEditBankInfo && (
                    <button
                      onClick={handleSaveProfileAnalysis}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      Save
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">CIBIL Issues</label>
                    <select
                      value={profileAnalysis.cibil_issues}
                      onChange={(e) => setProfileAnalysis({...profileAnalysis, cibil_issues: e.target.value})}
                      disabled={!canEditBankInfo}
                      className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm ${!canEditBankInfo ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Select</option>
                      <option value="no_issues">No Issues</option>
                      <option value="minor_issues">Minor Issues</option>
                      <option value="major_issues">Major Issues</option>
                      <option value="settlement">Settlement</option>
                      <option value="write_off">Write Off</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">FOIR %</label>
                    <input
                      type="text"
                      value={profileAnalysis.foir}
                      onChange={(e) => setProfileAnalysis({...profileAnalysis, foir: e.target.value})}
                      disabled={!canEditBankInfo}
                      placeholder="e.g., 65"
                      className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm ${!canEditBankInfo ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Company Type</label>
                    <select
                      value={profileAnalysis.company_type}
                      onChange={(e) => setProfileAnalysis({...profileAnalysis, company_type: e.target.value})}
                      disabled={!canEditBankInfo}
                      className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm ${!canEditBankInfo ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Select</option>
                      <option value="listed">Listed</option>
                      <option value="mnc">MNC</option>
                      <option value="private_ltd">Private Ltd</option>
                      <option value="partnership">Partnership</option>
                      <option value="proprietorship">Proprietorship</option>
                      <option value="government">Government</option>
                      <option value="psu">PSU</option>
                    </select>
                  </div>
                </div>
              </div>

            {/* Bank Eligibilities - Visible to all, editable by Admin, Ops, Managers only */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Building2 size={18} />
                    Bank Eligibilities ({eligibilities.length}/7)
                    {!canEditBankInfo && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                        View Only
                      </span>
                    )}
                  </h2>
                  {canEditBankInfo && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEligibilities()}
                        disabled={savingEligibilities}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {savingEligibilities ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save All
                      </button>
                      <button
                        onClick={handleAddBank}
                        disabled={eligibilities.length >= 7}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Plus size={16} />
                        Add Bank
                      </button>
                    </div>
                  )}
                </div>

                {eligibilities.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Building2 size={48} className="mx-auto text-gray-300 mb-3" />
                    <p>No banks added yet.{canEditBankInfo ? ' Click "Add Bank" to add bank eligibility.' : ''}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {eligibilities.map((bank, index) => (
                      <BankEligibilityRow
                        key={index}
                        bank={bank}
                        index={index}
                        canEdit={canEditBankInfo}
                        canEditSm={canEditSmDetails}
                        isVehicleLoan={isVehicleLoan}
                        isUsedVehicleBt={isUsedVehicleBt}
                        expanded={expandedBanks[index] !== false}
                        onToggle={toggleBankExpand}
                        onChange={handleBankChange}
                        onRemove={handleRemoveBank}
                        onSave={handleSaveBank}
                        saving={savingEligibilities}
                        bankOptions={bankOptions}
                      />
                    ))}
                  </div>
                )}
              </div>

            {/* Update Status - Visible to all, editable by Admin, Ops, Managers */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  Update Status
                  {!canEditBankInfo && (
                    <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      View Only
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-4">
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    disabled={!canEditBankInfo}
                    data-testid="file-status-select"
                    className={`flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm ${!canEditBankInfo ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                  >
                    {FILE_STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    {!FILE_STATUS_OPTIONS.some(opt => opt.value === newStatus) && newStatus && (
                      <option value={newStatus}>{getFileStatusLabel(newStatus)} (current)</option>
                    )}
                  </select>
                  {canEditBankInfo && (
                    <button
                      onClick={handleStatusUpdate}
                      data-testid="file-status-update-btn"
                      className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                    >
                      Update Status
                    </button>
                  )}
                </div>
              </div>
          </div>

          {/* Right Column - Documents & Activity */}
          <div className="space-y-6">
            {/* Documents */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <FileText size={18} className="text-green-600" />
                  Documents ({documents.length})
                </h2>
                <button
                  onClick={handleDownloadAll}
                  className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  <Download size={14} />
                  Download All ZIP
                </button>
              </div>

              {/* Password Protected Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-amber-700 font-medium">
                    Password Protected Files: {showPassword ? filePassword : '••••••••••••'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowPassword(!showPassword)} className="text-amber-600 hover:text-amber-800">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={copyPassword} className="text-amber-600 hover:text-amber-800">
                      {copiedPassword ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Documents List */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {documents.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No documents uploaded</p>
                ) : (
                  documents.map((doc, index) => (
                    <div key={doc.id || index} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.name || doc.filename}</p>
                        <p className="text-xs text-gray-500">{doc.category || 'general'} • {doc.size || '-'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={doc.url}
                          download
                          className="p-1 text-gray-500 hover:text-gray-700"
                        >
                          <Download size={16} />
                        </a>
                        {canEditLeadInfo && (
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
                            className="p-1 text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Upload */}
              {canEditLeadInfo && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <div className="flex flex-col items-center justify-center">
                      {uploading ? (
                        <Loader2 size={24} className="animate-spin text-green-600" />
                      ) : (
                        <>
                          <Upload size={24} className="text-gray-400 mb-2" />
                          <span className="text-sm text-gray-500">Upload Documents</span>
                          <span className="text-xs text-gray-400">PDF, Images, DOC, XLS (max 10MB each)</span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Activity Log */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-4">Activity Log</h2>
              
              {/* Add Note */}
              <div className="mb-4">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none"
                  rows={2}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!note.trim()}
                  className="mt-2 w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Add Note
                </button>
              </div>

              {/* Activity List */}
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {activities.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No activity yet</p>
                ) : (
                  [...activities].reverse().slice(0, 10).map((activity, index) => (
                    <div key={index} className="text-sm border-l-2 border-gray-200 pl-3">
                      <p className="text-gray-900">{activity.message || activity.note}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {activity.by_name || activity.user_name || 'System'} • 
                        {activity.timestamp ? new Date(activity.timestamp).toLocaleString('en-IN') : '-'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Admin manual star rating */}
      {showStarModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" data-testid="star-override-modal">
          <div className="bg-white rounded-xl w-full max-w-md p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Set star rating manually</h3>
            <p className="text-xs text-gray-500 mb-4">
              Calculated score: {fileData?.star_score}/100. A manual rating stays until you switch back to automatic.
            </p>
            <div className="flex items-center gap-1 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setStarDraft({ ...starDraft, star_rating: star })}
                  className={`text-2xl leading-none ${star <= starDraft.star_rating ? 'text-amber-500' : 'text-gray-300'}`}
                  data-testid={`star-option-${star}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-sm text-gray-600">{starDraft.star_rating} Star Profile</span>
            </div>
            <label className="text-xs text-gray-500 block mb-1">Reason (required)</label>
            <textarea
              rows={3}
              value={starDraft.reason}
              onChange={(e) => setStarDraft({ ...starDraft, reason: e.target.value })}
              placeholder="e.g. Strong banking history not captured in the score"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-4"
              data-testid="star-override-reason"
            />
            {fileData?.star_override_reason && (
              <p className="text-xs text-gray-500 mb-3">
                Current override: "{fileData.star_override_reason}"
                {fileData.star_override_by ? ` - ${fileData.star_override_by}` : ''}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => handleStarOverride({ star_manual: false })}
                className="text-sm text-gray-600 hover:text-gray-800 underline"
                data-testid="star-override-auto"
              >
                Use automatic score
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowStarModal(false)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  data-testid="star-override-cancel"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleStarOverride({ star_rating: starDraft.star_rating, reason: starDraft.reason })}
                  disabled={!starDraft.reason.trim()}
                  className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg disabled:opacity-50"
                  data-testid="star-override-save"
                >
                  Save rating
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default FileDetailsPage;
