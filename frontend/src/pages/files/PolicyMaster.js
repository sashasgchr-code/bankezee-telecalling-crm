import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Search, Plus, Edit2, Trash2, ChevronLeft, ChevronDown, ChevronRight,
  Check, X, FileText, Filter, Loader2, AlertTriangle, DollarSign, 
  Users, Percent, Calendar, Home, Briefcase, CreditCard, Clock
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

// Complete Policy Master - All OLD CRM fields preserved
const PolicyMaster = () => {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [loanTypeFilter, setLoanTypeFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [expandedPolicy, setExpandedPolicy] = useState(null);

  useEffect(() => {
    fetchPolicies();
  }, [loanTypeFilter]);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (loanTypeFilter) params.append('loan_type', loanTypeFilter);
      const response = await api.get(`/files/policies?${params.toString()}`);
      setPolicies(response.data.policies || []);
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast.error('Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  const filteredPolicies = policies.filter(p => 
    p.bank_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.special_notes?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount) => {
    if (!amount) return '-';
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
    return `₹${amount.toLocaleString()}`;
  };

  const loanTypes = [
    { value: '', label: 'All Loan Types' },
    { value: 'personal_loan', label: 'Personal Loan' },
    { value: 'home_loan', label: 'Home Loan' },
    { value: 'business_loan', label: 'Business Loan' },
    { value: 'car_loan', label: 'Car Loan' },
    { value: 'lap', label: 'Loan Against Property' },
    { value: 'education_loan', label: 'Education Loan' },
    { value: 'gold_loan', label: 'Gold Loan' },
  ];

  const handleDelete = async (policyId) => {
    if (!window.confirm('Are you sure you want to delete this policy?')) return;
    try {
      await api.delete(`/files/policies/${policyId}`);
      toast.success('Policy deleted');
      fetchPolicies();
    } catch (error) {
      toast.error('Failed to delete policy');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Building2 className="text-green-600" size={24} />
                Policy Master
              </h1>
              <p className="text-sm text-gray-500">{policies.length} bank policies configured</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg flex items-center gap-2 hover:bg-green-700"
            data-testid="add-policy-btn"
          >
            <Plus size={18} /> Add Policy
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by bank name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-lg text-sm"
              data-testid="policy-search"
            />
          </div>
          <select
            value={loanTypeFilter}
            onChange={(e) => setLoanTypeFilter(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-lg text-sm bg-white"
            data-testid="loan-type-filter"
          >
            {loanTypes.map(lt => (
              <option key={lt.value} value={lt.value}>{lt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Policies List */}
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : filteredPolicies.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Building2 size={48} className="mx-auto mb-4 text-gray-300" />
            <p>No policies found</p>
          </div>
        ) : (
          filteredPolicies.map((policy) => (
            <PolicyCard 
              key={policy.id} 
              policy={policy}
              isExpanded={expandedPolicy === policy.id}
              onToggle={() => setExpandedPolicy(expandedPolicy === policy.id ? null : policy.id)}
              onEdit={() => { setEditingPolicy(policy); setShowAddModal(true); }}
              onDelete={() => handleDelete(policy.id)}
              formatCurrency={formatCurrency}
            />
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <PolicyModal
          policy={editingPolicy}
          onClose={() => { setShowAddModal(false); setEditingPolicy(null); }}
          onSave={() => { fetchPolicies(); setShowAddModal(false); setEditingPolicy(null); }}
        />
      )}
    </div>
  );
};

// Policy Card Component - Displays all OLD CRM fields
const PolicyCard = ({ policy, isExpanded, onToggle, onEdit, onDelete, formatCurrency }) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid={`policy-card-${policy.bank_name}`}>
      {/* Policy Header */}
      <div 
        className="px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${policy.is_active ? 'bg-green-100' : 'bg-gray-100'}`}>
              <Building2 size={20} className={policy.is_active ? 'text-green-600' : 'text-gray-400'} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{policy.bank_name}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{policy.salary_text || `Min ₹${(policy.min_salary || 0).toLocaleString()}`}</span>
                <span>•</span>
                <span>{policy.cibil_text || (policy.min_cibil ? `CIBIL ${policy.min_cibil}+` : 'All CIBIL')}</span>
                <span>•</span>
                <span>{policy.applicable_profiles || 'Salaried'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${policy.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {policy.is_active ? 'Active' : 'Inactive'}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
            >
              <Trash2 size={16} />
            </button>
            {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </div>
        </div>
      </div>

      {/* Expanded Details - ALL OLD CRM FIELDS */}
      {isExpanded && (
        <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 space-y-4">
          {/* Basic Criteria */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
              <CreditCard size={12} /> Basic Criteria
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PolicyField label="Min Salary" value={policy.salary_text || formatCurrency(policy.min_salary)} />
              <PolicyField label="Min CIBIL" value={policy.cibil_text || (policy.min_cibil || 'No Min')} />
              <PolicyField label="Max FOIR" value={policy.foir_text || `${policy.max_foir || 50}%`} />
              <PolicyField label="Applicable Profiles" value={policy.applicable_profiles || 'Salaried'} />
            </div>
          </div>

          {/* Loan Parameters */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
              <DollarSign size={12} /> Loan Parameters
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PolicyField label="Loan Amount" value={policy.loan_amount_text || `${formatCurrency(policy.min_loan_amount)} - ${formatCurrency(policy.max_loan_amount)}`} />
              <PolicyField label="Tenure" value={policy.tenure_text || `${policy.min_tenure || 0}-${policy.max_tenure || 60} months`} />
              <PolicyField label="ROI" value={policy.roi_text || (policy.roi_min ? `${policy.roi_min}% - ${policy.roi_max}%` : '-')} />
              <PolicyField label="Processing Fee" value={policy.processing_fee || '-'} />
            </div>
          </div>

          {/* Employment Requirements */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
              <Briefcase size={12} /> Employment Requirements
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PolicyField label="Company Categories" value={policy.company_requirement_text || policy.company_categories || '-'} />
              <PolicyField label="Eligible Employees" value={policy.eligible_employees || '-'} />
              <PolicyField label="Present Employment" value={policy.present_employment_text || `${policy.min_present_employment_months || 0} months`} />
              <PolicyField label="Total Employment" value={policy.total_employment_text || `${policy.min_total_employment_months || 0} months`} />
            </div>
          </div>

          {/* Age & Accommodation */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
              <Users size={12} /> Age & Accommodation
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PolicyField label="Age Limit" value={policy.age_text || `${policy.min_age || 21}-${policy.max_age || 60}`} />
              <PolicyField label="Bachelor Accommodation" value={policy.bachelor_accommodation ? 'Allowed' : 'Not Allowed'} />
              <PolicyField label="Hostel Accommodation" value={policy.hostel_accommodation ? 'Allowed' : 'Not Allowed'} />
              <PolicyField label="Serviceable Locations" value={policy.serviceable_locations?.join(', ') || 'All India'} />
            </div>
          </div>

          {/* BT & Top-up Policies */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
              <Percent size={12} /> BT & Top-up Policies
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PolicyField label="BT Allowed" value={policy.bt_text || (policy.bt_allowed ? `Yes (Max ${policy.max_bt_count || 0} BTs)` : 'No')} />
              <PolicyField label="App Loan BT" value={policy.bt_app_loans_text || (policy.app_loan_bt ? 'Allowed' : 'Not Allowed')} />
              <PolicyField label="CC BT" value={policy.cc_bt_allowed ? 'Allowed' : 'Not Allowed'} />
              <PolicyField label="Top-up" value={policy.topup_text || (policy.topup_allowed ? 'Allowed' : 'Not Allowed')} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mt-2">
              <PolicyField label="Merge/Consolidation" value={policy.merge_consolidation ? 'Allowed' : 'Not Allowed'} />
              <PolicyField label="Min Loan Seasoning" value={policy.min_loan_seasoning_months ? `${policy.min_loan_seasoning_months} months` : '-'} />
            </div>
          </div>

          {/* Special Features */}
          {policy.special_features && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Special Features</h4>
              <p className="text-sm text-gray-700 bg-blue-50 p-2 rounded">{policy.special_features}</p>
            </div>
          )}

          {/* Special Notes */}
          {policy.special_notes && (
            <div className="p-3 bg-yellow-50 rounded-lg">
              <p className="text-xs text-yellow-800 font-medium flex items-center gap-1">
                <AlertTriangle size={14} /> Special Notes
              </p>
              <p className="text-sm text-yellow-700 mt-1">{policy.special_notes}</p>
            </div>
          )}

          {/* Required Documents */}
          {policy.required_documents?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                <FileText size={12} /> Required Documents
              </h4>
              <div className="flex flex-wrap gap-1">
                {policy.required_documents.map((doc, i) => (
                  <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{doc}</span>
                ))}
              </div>
            </div>
          )}

          {/* Loan Types */}
          {policy.loan_types?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Applicable Loan Types</h4>
              <div className="flex flex-wrap gap-1">
                {policy.loan_types.map((lt, i) => (
                  <span key={i} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">{lt.replace('_', ' ')}</span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-gray-400 pt-2 border-t border-gray-200">
            Last updated: {policy.updated_at ? new Date(policy.updated_at).toLocaleString() : 'N/A'} 
            {policy.updated_by && ` by ${policy.updated_by}`}
          </div>
        </div>
      )}
    </div>
  );
};

// Policy Field Display Component
const PolicyField = ({ label, value }) => (
  <div>
    <p className="text-gray-500 text-xs">{label}</p>
    <p className="font-medium text-gray-900">{value || '-'}</p>
  </div>
);

// ============ POLICY ADD/EDIT MODAL - ALL OLD CRM FIELDS ============
const PolicyModal = ({ policy, onClose, onSave }) => {
  const [activeSection, setActiveSection] = useState('basic');
  const [formData, setFormData] = useState(policy || {
    // Basic Info
    bank_name: '',
    applicable_profiles: 'salaried',
    is_active: true,
    loan_types: ['personal_loan'],
    
    // Salary & CIBIL
    min_salary: '',
    salary_text: '',
    min_cibil: '',
    cibil_text: '',
    max_foir: 50,
    foir_text: '',
    
    // Loan Parameters
    min_loan_amount: '',
    max_loan_amount: '',
    loan_amount_text: '',
    min_tenure: 12,
    max_tenure: 60,
    tenure_text: '',
    roi_min: '',
    roi_max: '',
    roi_text: '',
    processing_fee: '',
    
    // Employment
    company_categories: '',
    company_requirement_text: '',
    eligible_employees: '',
    min_present_employment_months: 6,
    min_total_employment_months: 12,
    present_employment_text: '',
    total_employment_text: '',
    
    // Age & Accommodation
    min_age: 21,
    max_age: 60,
    age_text: '',
    bachelor_accommodation: true,
    hostel_accommodation: true,
    serviceable_locations: [],
    
    // BT & Top-up
    bt_allowed: false,
    max_bt_count: 2,
    bt_text: '',
    app_loan_bt: false,
    bt_app_loans_text: '',
    cc_bt_allowed: false,
    topup_allowed: false,
    topup_text: '',
    merge_consolidation: false,
    min_loan_seasoning_months: '',
    
    // Documents & Notes
    required_documents: [],
    special_notes: '',
    special_features: ''
  });
  const [saving, setSaving] = useState(false);
  const [newDoc, setNewDoc] = useState('');
  const [newLocation, setNewLocation] = useState('');

  const handleSave = async () => {
    if (!formData.bank_name) {
      toast.error('Bank name is required');
      return;
    }
    
    setSaving(true);
    try {
      if (policy?.id) {
        await api.put(`/files/policies/${policy.id}`, formData);
        toast.success('Policy updated');
      } else {
        await api.post('/files/policies', formData);
        toast.success('Policy created');
      }
      onSave();
    } catch (error) {
      toast.error('Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const addItem = (field, value, setValue) => {
    if (value.trim()) {
      setFormData({
        ...formData,
        [field]: [...(formData[field] || []), value.trim()]
      });
      setValue('');
    }
  };

  const removeItem = (field, index) => {
    setFormData({
      ...formData,
      [field]: formData[field].filter((_, i) => i !== index)
    });
  };

  const inputClass = "w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  const sections = [
    { id: 'basic', label: 'Basic Info', icon: Building2 },
    { id: 'criteria', label: 'Eligibility', icon: CreditCard },
    { id: 'loan', label: 'Loan Params', icon: DollarSign },
    { id: 'employment', label: 'Employment', icon: Briefcase },
    { id: 'age', label: 'Age & Location', icon: Users },
    { id: 'bt', label: 'BT & Top-up', icon: Percent },
    { id: 'docs', label: 'Documents', icon: FileText }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white">
          <h2 className="text-lg font-semibold">{policy ? 'Edit Policy' : 'Add New Policy'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>
        
        {/* Section Tabs */}
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 overflow-x-auto">
          <div className="flex gap-1">
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  activeSection === section.id 
                    ? 'bg-green-600 text-white' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <section.icon size={14} />
                {section.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Basic Info Section */}
          {activeSection === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Bank Name *</label>
                  <input
                    value={formData.bank_name}
                    onChange={(e) => setFormData({...formData, bank_name: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., HDFC Bank"
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    value={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.value === 'true'})}
                    className={inputClass}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className={labelClass}>Applicable Profiles</label>
                <select
                  value={formData.applicable_profiles}
                  onChange={(e) => setFormData({...formData, applicable_profiles: e.target.value})}
                  className={inputClass}
                >
                  <option value="salaried">Salaried</option>
                  <option value="self_employed">Self Employed</option>
                  <option value="both">Both</option>
                </select>
              </div>
              
              <div>
                <label className={labelClass}>Loan Types</label>
                <div className="flex flex-wrap gap-2">
                  {['personal_loan', 'home_loan', 'business_loan', 'car_loan', 'lap', 'education_loan', 'gold_loan'].map(lt => (
                    <label key={lt} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                      <input
                        type="checkbox"
                        checked={formData.loan_types?.includes(lt)}
                        onChange={(e) => {
                          const types = e.target.checked 
                            ? [...(formData.loan_types || []), lt]
                            : (formData.loan_types || []).filter(t => t !== lt);
                          setFormData({...formData, loan_types: types});
                        }}
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <span className="text-sm">{lt.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                    </label>
                  ))}
                </div>
              </div>
              
              <div>
                <label className={labelClass}>Special Features</label>
                <textarea
                  value={formData.special_features}
                  onChange={(e) => setFormData({...formData, special_features: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  rows={2}
                  placeholder="e.g., Digital journey, Pre-approved offers..."
                />
              </div>
            </div>
          )}

          {/* Eligibility Criteria Section */}
          {activeSection === 'criteria' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Min Salary (₹)</label>
                  <input
                    type="number"
                    value={formData.min_salary}
                    onChange={(e) => setFormData({...formData, min_salary: e.target.value})}
                    className={inputClass}
                    placeholder="25000"
                  />
                </div>
                <div>
                  <label className={labelClass}>Salary Text (Display)</label>
                  <input
                    value={formData.salary_text}
                    onChange={(e) => setFormData({...formData, salary_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., 25K-50K+ depending on category"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Min CIBIL</label>
                  <input
                    type="number"
                    value={formData.min_cibil}
                    onChange={(e) => setFormData({...formData, min_cibil: e.target.value})}
                    className={inputClass}
                    placeholder="650"
                  />
                </div>
                <div>
                  <label className={labelClass}>CIBIL Text (Display)</label>
                  <input
                    value={formData.cibil_text}
                    onChange={(e) => setFormData({...formData, cibil_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., 0/-1 Allowed"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Max FOIR (%)</label>
                  <input
                    type="number"
                    value={formData.max_foir}
                    onChange={(e) => setFormData({...formData, max_foir: e.target.value})}
                    className={inputClass}
                    placeholder="50"
                  />
                </div>
                <div>
                  <label className={labelClass}>FOIR Text (Display)</label>
                  <input
                    value={formData.foir_text}
                    onChange={(e) => setFormData({...formData, foir_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., 55%-65% depending on profile"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Loan Parameters Section */}
          {activeSection === 'loan' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Min Loan Amount (₹)</label>
                  <input
                    type="number"
                    value={formData.min_loan_amount}
                    onChange={(e) => setFormData({...formData, min_loan_amount: e.target.value})}
                    className={inputClass}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Loan Amount (₹)</label>
                  <input
                    type="number"
                    value={formData.max_loan_amount}
                    onChange={(e) => setFormData({...formData, max_loan_amount: e.target.value})}
                    className={inputClass}
                    placeholder="5000000"
                  />
                </div>
                <div>
                  <label className={labelClass}>Amount Text (Display)</label>
                  <input
                    value={formData.loan_amount_text}
                    onChange={(e) => setFormData({...formData, loan_amount_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Up to ₹50L"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Min Tenure (months)</label>
                  <input
                    type="number"
                    value={formData.min_tenure}
                    onChange={(e) => setFormData({...formData, min_tenure: e.target.value})}
                    className={inputClass}
                    placeholder="12"
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Tenure (months)</label>
                  <input
                    type="number"
                    value={formData.max_tenure}
                    onChange={(e) => setFormData({...formData, max_tenure: e.target.value})}
                    className={inputClass}
                    placeholder="60"
                  />
                </div>
                <div>
                  <label className={labelClass}>Tenure Text (Display)</label>
                  <input
                    value={formData.tenure_text}
                    onChange={(e) => setFormData({...formData, tenure_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Up to 72 months"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>ROI Min (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.roi_min}
                    onChange={(e) => setFormData({...formData, roi_min: e.target.value})}
                    className={inputClass}
                    placeholder="10.5"
                  />
                </div>
                <div>
                  <label className={labelClass}>ROI Max (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.roi_max}
                    onChange={(e) => setFormData({...formData, roi_max: e.target.value})}
                    className={inputClass}
                    placeholder="18"
                  />
                </div>
                <div>
                  <label className={labelClass}>ROI Text (Display)</label>
                  <input
                    value={formData.roi_text}
                    onChange={(e) => setFormData({...formData, roi_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., 10.5% - 18%"
                  />
                </div>
              </div>
              
              <div>
                <label className={labelClass}>Processing Fee</label>
                <input
                  value={formData.processing_fee}
                  onChange={(e) => setFormData({...formData, processing_fee: e.target.value})}
                  className={inputClass}
                  placeholder="e.g., 2% or ₹999 flat"
                />
              </div>
            </div>
          )}

          {/* Employment Section */}
          {activeSection === 'employment' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Company Categories</label>
                  <input
                    value={formData.company_categories}
                    onChange={(e) => setFormData({...formData, company_categories: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Govt, Listed, MNC, CAT A/B/C"
                  />
                </div>
                <div>
                  <label className={labelClass}>Company Requirement Text</label>
                  <input
                    value={formData.company_requirement_text}
                    onChange={(e) => setFormData({...formData, company_requirement_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Only Listed companies"
                  />
                </div>
              </div>
              
              <div>
                <label className={labelClass}>Eligible Employees</label>
                <input
                  value={formData.eligible_employees}
                  onChange={(e) => setFormData({...formData, eligible_employees: e.target.value})}
                  className={inputClass}
                  placeholder="e.g., Govt, CAT A/B/C employees"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Min Present Employment (months)</label>
                  <input
                    type="number"
                    value={formData.min_present_employment_months}
                    onChange={(e) => setFormData({...formData, min_present_employment_months: e.target.value})}
                    className={inputClass}
                    placeholder="6"
                  />
                </div>
                <div>
                  <label className={labelClass}>Present Employment Text</label>
                  <input
                    value={formData.present_employment_text}
                    onChange={(e) => setFormData({...formData, present_employment_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Min 6 months"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Min Total Employment (months)</label>
                  <input
                    type="number"
                    value={formData.min_total_employment_months}
                    onChange={(e) => setFormData({...formData, min_total_employment_months: e.target.value})}
                    className={inputClass}
                    placeholder="12"
                  />
                </div>
                <div>
                  <label className={labelClass}>Total Employment Text</label>
                  <input
                    value={formData.total_employment_text}
                    onChange={(e) => setFormData({...formData, total_employment_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., Min 1 year"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Age & Location Section */}
          {activeSection === 'age' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Min Age</label>
                  <input
                    type="number"
                    value={formData.min_age}
                    onChange={(e) => setFormData({...formData, min_age: e.target.value})}
                    className={inputClass}
                    placeholder="21"
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Age</label>
                  <input
                    type="number"
                    value={formData.max_age}
                    onChange={(e) => setFormData({...formData, max_age: e.target.value})}
                    className={inputClass}
                    placeholder="60"
                  />
                </div>
                <div>
                  <label className={labelClass}>Age Text</label>
                  <input
                    value={formData.age_text}
                    onChange={(e) => setFormData({...formData, age_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., 21-58"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.bachelor_accommodation}
                    onChange={(e) => setFormData({...formData, bachelor_accommodation: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Bachelor Accommodation Allowed</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.hostel_accommodation}
                    onChange={(e) => setFormData({...formData, hostel_accommodation: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Hostel Accommodation Allowed</span>
                </label>
              </div>
              
              <div>
                <label className={labelClass}>Serviceable Locations</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addItem('serviceable_locations', newLocation, setNewLocation)}
                    className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm"
                    placeholder="Add city..."
                  />
                  <button onClick={() => addItem('serviceable_locations', newLocation, setNewLocation)} className="px-4 h-10 bg-gray-100 rounded-lg hover:bg-gray-200">
                    <Plus size={18} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.serviceable_locations?.map((loc, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm flex items-center gap-1">
                      {loc}
                      <button onClick={() => removeItem('serviceable_locations', i)} className="text-blue-500 hover:text-blue-700">
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1">Leave empty for All India</p>
              </div>
            </div>
          )}

          {/* BT & Top-up Section */}
          {activeSection === 'bt' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.bt_allowed}
                    onChange={(e) => setFormData({...formData, bt_allowed: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Balance Transfer Allowed</span>
                </label>
                <div>
                  <label className={labelClass}>Max BT Count</label>
                  <input
                    type="number"
                    value={formData.max_bt_count}
                    onChange={(e) => setFormData({...formData, max_bt_count: e.target.value})}
                    className={inputClass}
                    placeholder="2"
                    disabled={!formData.bt_allowed}
                  />
                </div>
              </div>
              
              <div>
                <label className={labelClass}>BT Policy Text</label>
                <input
                  value={formData.bt_text}
                  onChange={(e) => setFormData({...formData, bt_text: e.target.value})}
                  className={inputClass}
                  placeholder="e.g., Up to 2 BTs allowed"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.app_loan_bt}
                    onChange={(e) => setFormData({...formData, app_loan_bt: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">App Loan BT Allowed</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.cc_bt_allowed}
                    onChange={(e) => setFormData({...formData, cc_bt_allowed: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Credit Card BT Allowed</span>
                </label>
              </div>
              
              <div>
                <label className={labelClass}>App Loan BT Text</label>
                <input
                  value={formData.bt_app_loans_text}
                  onChange={(e) => setFormData({...formData, bt_app_loans_text: e.target.value})}
                  className={inputClass}
                  placeholder="e.g., Bajaj, Tata Capital etc allowed"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.topup_allowed}
                    onChange={(e) => setFormData({...formData, topup_allowed: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Top-up Allowed</span>
                </label>
                <div>
                  <label className={labelClass}>Top-up Policy</label>
                  <input
                    value={formData.topup_text}
                    onChange={(e) => setFormData({...formData, topup_text: e.target.value})}
                    className={inputClass}
                    placeholder="e.g., After 6 months"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.merge_consolidation}
                    onChange={(e) => setFormData({...formData, merge_consolidation: e.target.checked})}
                    className="rounded border-gray-300 text-green-600"
                  />
                  <span className="text-sm">Merge/Consolidation Allowed</span>
                </label>
                <div>
                  <label className={labelClass}>Min Loan Seasoning (months)</label>
                  <input
                    type="number"
                    value={formData.min_loan_seasoning_months}
                    onChange={(e) => setFormData({...formData, min_loan_seasoning_months: e.target.value})}
                    className={inputClass}
                    placeholder="6"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Documents Section */}
          {activeSection === 'docs' && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Required Documents</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={newDoc}
                    onChange={(e) => setNewDoc(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addItem('required_documents', newDoc, setNewDoc)}
                    className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm"
                    placeholder="Add document requirement..."
                  />
                  <button onClick={() => addItem('required_documents', newDoc, setNewDoc)} className="px-4 h-10 bg-gray-100 rounded-lg hover:bg-gray-200">
                    <Plus size={18} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.required_documents?.map((doc, i) => (
                    <span key={i} className="px-2 py-1 bg-gray-100 rounded text-sm flex items-center gap-1">
                      {doc}
                      <button onClick={() => removeItem('required_documents', i)} className="text-red-500 hover:text-red-700">
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-xs text-gray-500">Common:</span>
                  {['PAN', 'Aadhaar', 'Payslips (3 months)', 'Bank Statement (6 months)', 'Form 16', 'ITR', 'Passport Photo', 'Address Proof'].map(doc => (
                    <button
                      key={doc}
                      onClick={() => {
                        if (!formData.required_documents?.includes(doc)) {
                          setFormData({...formData, required_documents: [...(formData.required_documents || []), doc]});
                        }
                      }}
                      className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
                    >
                      + {doc}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className={labelClass}>Special Notes</label>
                <textarea
                  value={formData.special_notes}
                  onChange={(e) => setFormData({...formData, special_notes: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  rows={4}
                  placeholder="Any special conditions, exceptions, or notes for this policy..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? 'Saving...' : 'Save Policy'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PolicyMaster;
