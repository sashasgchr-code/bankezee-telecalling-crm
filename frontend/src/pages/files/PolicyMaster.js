import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Search, Plus, Edit2, Trash2, ChevronLeft, Check, X, 
  FileText, Filter, Loader2, AlertTriangle, DollarSign
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

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
    { value: 'education_loan', label: 'Education Loan' },
    { value: 'gold_loan', label: 'Gold Loan' },
    { value: 'lap', label: 'Loan Against Property' },
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
              <p className="text-sm text-gray-500">{policies.length} bank policies</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg flex items-center gap-2 hover:bg-green-700"
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
            />
          </div>
          <select
            value={loanTypeFilter}
            onChange={(e) => setLoanTypeFilter(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-lg text-sm bg-white"
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
            <div 
              key={policy.id} 
              className="bg-white rounded-lg border border-gray-200 overflow-hidden"
            >
              {/* Policy Header */}
              <div 
                className="px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedPolicy(expandedPolicy === policy.id ? null : policy.id)}
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
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${policy.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {policy.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingPolicy(policy); setShowAddModal(true); }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(policy.id); }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedPolicy === policy.id && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Loan Amount</p>
                      <p className="font-medium">{policy.loan_amount_text || formatCurrency(policy.max_loan_amount)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Tenure</p>
                      <p className="font-medium">{policy.tenure_text || `Up to ${policy.max_tenure} months`}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">ROI</p>
                      <p className="font-medium">{policy.roi_text || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Max FOIR</p>
                      <p className="font-medium">{policy.foir_text || `${policy.max_foir || 50}%`}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Age</p>
                      <p className="font-medium">{policy.age_text || `${policy.min_age || 21}-${policy.max_age || 60}`}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Present Employment</p>
                      <p className="font-medium">{policy.present_employment_text || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Total Employment</p>
                      <p className="font-medium">{policy.total_employment_text || '-'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Processing Fee</p>
                      <p className="font-medium">{policy.processing_fee || '-'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-500 text-xs">Company Requirement</p>
                      <p className="font-medium">{policy.company_requirement_text || policy.company_categories?.join(', ') || '-'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-500 text-xs">BT Policy</p>
                      <p className="font-medium">{policy.bt_text || (policy.bt_allowed ? 'Allowed' : 'Not Allowed')}</p>
                    </div>
                  </div>
                  {policy.special_notes && (
                    <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
                      <p className="text-xs text-yellow-800 font-medium flex items-center gap-1">
                        <AlertTriangle size={14} /> Special Notes
                      </p>
                      <p className="text-sm text-yellow-700 mt-1">{policy.special_notes}</p>
                    </div>
                  )}
                  {policy.required_documents?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Required Documents</p>
                      <div className="flex flex-wrap gap-1">
                        {policy.required_documents.map((doc, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{doc}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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

// Policy Add/Edit Modal Component
const PolicyModal = ({ policy, onClose, onSave }) => {
  const [formData, setFormData] = useState(policy || {
    bank_name: '',
    min_salary: '',
    min_cibil: '',
    cibil_text: '',
    salary_text: '',
    min_age: 21,
    max_age: 60,
    age_text: '',
    max_loan_amount: '',
    loan_amount_text: '',
    max_tenure: 60,
    tenure_text: '',
    roi_text: '',
    max_foir: 50,
    foir_text: '',
    processing_fee: '',
    company_categories: [],
    company_requirement_text: '',
    min_present_employment_months: '',
    min_total_employment_months: '',
    present_employment_text: '',
    total_employment_text: '',
    bt_allowed: false,
    bt_text: '',
    topup_allowed: false,
    topup_text: '',
    special_notes: '',
    required_documents: [],
    loan_types: ['personal_loan'],
    is_active: true
  });
  const [saving, setSaving] = useState(false);
  const [newDoc, setNewDoc] = useState('');

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

  const addDocument = () => {
    if (newDoc.trim()) {
      setFormData({
        ...formData,
        required_documents: [...(formData.required_documents || []), newDoc.trim()]
      });
      setNewDoc('');
    }
  };

  const removeDocument = (index) => {
    setFormData({
      ...formData,
      required_documents: formData.required_documents.filter((_, i) => i !== index)
    });
  };

  const inputClass = "w-full h-10 px-3 border border-gray-200 rounded-lg text-sm";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{policy ? 'Edit Policy' : 'Add New Policy'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          {/* Bank Name & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name *</label>
              <input
                value={formData.bank_name}
                onChange={(e) => setFormData({...formData, bank_name: e.target.value})}
                className={inputClass}
                placeholder="e.g., HDFC Bank"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
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

          {/* Salary & CIBIL */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Salary (₹)</label>
              <input
                type="number"
                value={formData.min_salary}
                onChange={(e) => setFormData({...formData, min_salary: e.target.value})}
                className={inputClass}
                placeholder="25000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min CIBIL</label>
              <input
                type="number"
                value={formData.min_cibil}
                onChange={(e) => setFormData({...formData, min_cibil: e.target.value})}
                className={inputClass}
                placeholder="650"
              />
            </div>
          </div>

          {/* Display Texts */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Salary Text (Display)</label>
              <input
                value={formData.salary_text}
                onChange={(e) => setFormData({...formData, salary_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., 25K-50K+ depending on category"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CIBIL Text (Display)</label>
              <input
                value={formData.cibil_text}
                onChange={(e) => setFormData({...formData, cibil_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., 0/-1 Allowed"
              />
            </div>
          </div>

          {/* Loan Amount & Tenure */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Loan Amount (₹)</label>
              <input
                type="number"
                value={formData.max_loan_amount}
                onChange={(e) => setFormData({...formData, max_loan_amount: e.target.value})}
                className={inputClass}
                placeholder="5000000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Tenure (months)</label>
              <input
                type="number"
                value={formData.max_tenure}
                onChange={(e) => setFormData({...formData, max_tenure: e.target.value})}
                className={inputClass}
                placeholder="60"
              />
            </div>
          </div>

          {/* ROI & FOIR */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ROI Text</label>
              <input
                value={formData.roi_text}
                onChange={(e) => setFormData({...formData, roi_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., 10.5% - 18%"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max FOIR (%)</label>
              <input
                type="number"
                value={formData.max_foir}
                onChange={(e) => setFormData({...formData, max_foir: e.target.value})}
                className={inputClass}
                placeholder="50"
              />
            </div>
          </div>

          {/* Age */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Age</label>
              <input
                type="number"
                value={formData.min_age}
                onChange={(e) => setFormData({...formData, min_age: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Age</label>
              <input
                type="number"
                value={formData.max_age}
                onChange={(e) => setFormData({...formData, max_age: e.target.value})}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Age Text</label>
              <input
                value={formData.age_text}
                onChange={(e) => setFormData({...formData, age_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., 21-58"
              />
            </div>
          </div>

          {/* Company & BT */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Requirement</label>
              <input
                value={formData.company_requirement_text}
                onChange={(e) => setFormData({...formData, company_requirement_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., Only Listed, Govt"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">BT Policy</label>
              <input
                value={formData.bt_text}
                onChange={(e) => setFormData({...formData, bt_text: e.target.value})}
                className={inputClass}
                placeholder="e.g., Up to 2 BTs allowed"
              />
            </div>
          </div>

          {/* Special Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Special Notes</label>
            <textarea
              value={formData.special_notes}
              onChange={(e) => setFormData({...formData, special_notes: e.target.value})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={3}
              placeholder="Any special conditions or notes..."
            />
          </div>

          {/* Required Documents */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Required Documents</label>
            <div className="flex gap-2 mb-2">
              <input
                value={newDoc}
                onChange={(e) => setNewDoc(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addDocument()}
                className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm"
                placeholder="Add document..."
              />
              <button onClick={addDocument} className="px-4 h-10 bg-gray-100 rounded-lg hover:bg-gray-200">
                <Plus size={18} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.required_documents?.map((doc, i) => (
                <span key={i} className="px-2 py-1 bg-gray-100 rounded text-sm flex items-center gap-1">
                  {doc}
                  <button onClick={() => removeDocument(i)} className="text-red-500 hover:text-red-700">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
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
