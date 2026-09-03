import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';
import { toast } from 'sonner';
import api from '../../services/api';
import { ArrowLeft, Plus, Pencil, Trash2, Building2, Check, X } from 'lucide-react';

const LOAN_TYPE_OPTIONS = [
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'vehicle_loan', label: 'Vehicle Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'education_loan', label: 'Education Loan' },
  { value: 'balance_transfer', label: 'Balance Transfer' },
  { value: 'bt_topup', label: 'BT + Top Up' },
  { value: 'merge_consolidation', label: 'Merge/Consolidation' },
];

const COMPANY_OPTIONS = ['Govt', 'Listed', 'Non-Listed', 'MNC', 'Proprietorship', 'Partnership', 'All'];

const emptyPolicy = {
  bank_name: '', is_active: true, applicable_profiles: ['salaried'],
  loan_types: ['personal_loan'], min_salary: '', max_salary: '', min_cibil: '',
  min_age: 21, max_age: 60, min_loan_amount: '', max_loan_amount: '',
  min_tenure: '', max_tenure: '', roi_min: '', roi_max: '', max_foir: '',
  company_categories: [], min_present_employment_months: '', min_total_employment_months: '',
  bachelor_accommodation: '', hostel_accommodation: '',
  bt_allowed: false, max_bt_count: '', app_loan_bt: false, cc_bt_allowed: false,
  topup_allowed: false, merge_consolidation: false, min_loan_seasoning_months: '',
  processing_fee: '', special_notes: '', special_features: '',
  required_documents: '', serviceable_locations: ''
};

export default function BankPolicyMaster() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [formData, setFormData] = useState({...emptyPolicy});
  const [showForm, setShowForm] = useState(false);

  const fetchPolicies = async () => {
    try {
      const res = await api.get('/bank-policies/policies');
      setPolicies(res.data);
    } catch (e) { toast.error('Failed to load policies'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPolicies(); }, []);

  const handleSave = async () => {
    if (!formData.bank_name.trim()) { toast.error('Bank name required'); return; }
    try {
      const payload = {
        ...formData,
        min_salary: formData.min_salary ? Number(formData.min_salary) : null,
        max_salary: formData.max_salary ? Number(formData.max_salary) : null,
        min_cibil: formData.min_cibil ? Number(formData.min_cibil) : null,
        min_age: formData.min_age ? Number(formData.min_age) : 21,
        max_age: formData.max_age ? Number(formData.max_age) : 60,
        min_loan_amount: formData.min_loan_amount ? Number(formData.min_loan_amount) : null,
        max_loan_amount: formData.max_loan_amount ? Number(formData.max_loan_amount) : null,
        min_tenure: formData.min_tenure ? Number(formData.min_tenure) : null,
        max_tenure: formData.max_tenure ? Number(formData.max_tenure) : null,
        roi_min: formData.roi_min ? Number(formData.roi_min) : null,
        roi_max: formData.roi_max ? Number(formData.roi_max) : null,
        max_foir: formData.max_foir ? Number(formData.max_foir) : null,
        min_present_employment_months: formData.min_present_employment_months ? Number(formData.min_present_employment_months) : null,
        min_total_employment_months: formData.min_total_employment_months ? Number(formData.min_total_employment_months) : null,
        min_loan_seasoning_months: formData.min_loan_seasoning_months ? Number(formData.min_loan_seasoning_months) : null,
        max_bt_count: formData.max_bt_count ? Number(formData.max_bt_count) : null,
        required_documents: typeof formData.required_documents === 'string' ? formData.required_documents.split(',').map(s => s.trim()).filter(Boolean) : formData.required_documents,
        serviceable_locations: typeof formData.serviceable_locations === 'string' ? formData.serviceable_locations.split(',').map(s => s.trim()).filter(Boolean) : formData.serviceable_locations,
      };

      if (editingPolicy) {
        await api.put(`/bank-policies/policies/${editingPolicy}`, payload);
        toast.success('Policy updated');
      } else {
        await api.post('/bank-policies/policies', payload);
        toast.success('Policy created');
      }
      setShowForm(false);
      setEditingPolicy(null);
      setFormData({...emptyPolicy});
      fetchPolicies();
    } catch (e) { toast.error('Failed to save policy'); }
  };

  const handleEdit = (policy) => {
    setEditingPolicy(policy.id);
    setFormData({
      ...emptyPolicy,
      ...policy,
      required_documents: Array.isArray(policy.required_documents) ? policy.required_documents.join(', ') : policy.required_documents || '',
      serviceable_locations: Array.isArray(policy.serviceable_locations) ? policy.serviceable_locations.join(', ') : policy.serviceable_locations || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this policy?')) return;
    try {
      await api.delete(`/bank-policies/policies/${id}`);
      toast.success('Policy deleted');
      fetchPolicies();
    } catch (e) { toast.error('Failed to delete'); }
  };

  const toggleCompany = (cat) => {
    const current = formData.company_categories || [];
    setFormData({
      ...formData,
      company_categories: current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat]
    });
  };

  const F = ({ label, field, type = 'text', placeholder = '' }) => (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <Input type={type} value={formData[field] || ''} onChange={e => setFormData({...formData, [field]: e.target.value})}
        className="h-9" placeholder={placeholder} />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
            <h1 className="text-lg font-bold text-slate-800">Bank Policy Master</h1>
            <span className="text-sm text-slate-400">{policies.length} policies</span>
          </div>
          <Button size="sm" onClick={() => { setEditingPolicy(null); setFormData({...emptyPolicy}); setShowForm(true); }} data-testid="add-policy-btn">
            <Plus className="w-4 h-4 mr-1" /> Add Lender Policy
          </Button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-4">
        {/* Form */}
        {showForm && (
          <Card className="mb-4" data-testid="policy-form">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{editingPolicy ? 'Edit Policy' : 'New Lender Policy'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-slate-500">Bank/NBFC Name *</Label>
                  <Input value={formData.bank_name} onChange={e => setFormData({...formData, bank_name: e.target.value})}
                    className="h-9" placeholder="e.g., HDFC Bank" data-testid="bank-name-input" />
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Active</Label>
                  <Select value={formData.is_active ? 'yes' : 'no'} onValueChange={v => setFormData({...formData, is_active: v === 'yes'})}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Active</SelectItem>
                      <SelectItem value="no">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Profile</Label>
                  <Select value={formData.applicable_profiles?.[0] || 'salaried'} onValueChange={v => setFormData({...formData, applicable_profiles: [v]})}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="salaried">Salaried</SelectItem>
                      <SelectItem value="self_employed">Self Employed</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="Min Salary (₹)" field="min_salary" type="number" />
                <F label="Min CIBIL" field="min_cibil" type="number" />
                <F label="Max FOIR (%)" field="max_foir" type="number" />
                <F label="ROI Min (%)" field="roi_min" type="number" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="ROI Max (%)" field="roi_max" type="number" />
                <F label="Min Age" field="min_age" type="number" />
                <F label="Max Age" field="max_age" type="number" />
                <F label="Max Loan (₹)" field="max_loan_amount" type="number" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="Min Loan (₹)" field="min_loan_amount" type="number" />
                <F label="Min Tenure (months)" field="min_tenure" type="number" />
                <F label="Max Tenure (months)" field="max_tenure" type="number" />
                <F label="Min Present Emp (months)" field="min_present_employment_months" type="number" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <F label="Min Total Emp (months)" field="min_total_employment_months" type="number" />
                <F label="Min Loan Seasoning (months)" field="min_loan_seasoning_months" type="number" />
                <F label="Max BT Count" field="max_bt_count" type="number" />
                <F label="Processing Fee" field="processing_fee" />
              </div>

              {/* Company Categories */}
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Company Categories</Label>
                <div className="flex flex-wrap gap-3">
                  {COMPANY_OPTIONS.map(cat => (
                    <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox checked={(formData.company_categories || []).includes(cat)} onCheckedChange={() => toggleCompany(cat)} />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>

              {/* BT/Topup toggles */}
              <div className="flex flex-wrap gap-6">
                {[
                  ['bt_allowed', 'BT Allowed'],
                  ['app_loan_bt', 'App Loan BT'],
                  ['cc_bt_allowed', 'CC BT Allowed'],
                  ['topup_allowed', 'Top-up Allowed'],
                  ['merge_consolidation', 'Merge/Consolidation'],
                ].map(([field, label]) => (
                  <label key={field} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={formData[field] || false} onCheckedChange={v => setFormData({...formData, [field]: v})} />
                    {label}
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <F label="Special Notes" field="special_notes" placeholder="Any special conditions..." />
                <F label="Special Features" field="special_features" placeholder="Key features..." />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <F label="Required Documents (comma separated)" field="required_documents" placeholder="Salary slip, Bank stmt, PAN..." />
                <F label="Serviceable Locations (comma separated)" field="serviceable_locations" placeholder="Mumbai, Delhi, Bangalore..." />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} data-testid="save-policy-btn">
                  <Check className="w-4 h-4 mr-1" /> {editingPolicy ? 'Update Policy' : 'Create Policy'}
                </Button>
                <Button variant="outline" onClick={() => { setShowForm(false); setEditingPolicy(null); }}>
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Policy List */}
        {loading ? (
          <p className="text-center py-10 text-slate-400">Loading policies...</p>
        ) : policies.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Building2 className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No bank policies yet</p>
            <p className="text-sm">Click "Add Lender Policy" to create your first policy</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {policies.map(p => (
              <Card key={p.id} className={`${!p.is_active ? 'opacity-50' : ''}`} data-testid={`policy-card-${p.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-base">{p.bank_name}</h3>
                        {p.is_active ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Active</span>
                          : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Inactive</span>}
                        {p.applicable_profiles && (
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                            {(Array.isArray(p.applicable_profiles) ? p.applicable_profiles : [p.applicable_profiles]).map(pr => pr === 'self_employed' ? 'SE' : pr.charAt(0).toUpperCase() + pr.slice(1)).join(' | ')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>Salary: <b className="text-slate-700">{p.salary_text || (p.min_salary ? `₹${Number(p.min_salary).toLocaleString()}` : '—')}</b></span>
                        <span>CIBIL: <b className="text-slate-700">{p.cibil_text || (p.min_cibil ? p.min_cibil : '—')}</b></span>
                        <span>FOIR: <b className="text-slate-700">{p.foir_text || (p.max_foir ? `${p.max_foir}%` : '—')}</b></span>
                        <span>ROI: <b className="text-slate-700">{p.roi_text || (p.roi_min ? `${p.roi_min}–${p.roi_max}%` : '—')}</b></span>
                        <span>Loan: <b className="text-slate-700">{p.loan_amount_text || (p.max_loan_amount ? `₹${Number(p.max_loan_amount).toLocaleString()}` : '—')}</b></span>
                        <span>Tenure: <b className="text-slate-700">{p.tenure_text || (p.max_tenure ? `${p.max_tenure}m` : '—')}</b></span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.bt_allowed ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>BT: {p.bt_text || (p.bt_allowed ? 'Yes' : 'No')}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.topup_allowed ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>Top-up: {p.topup_text || (p.topup_allowed ? 'Yes' : 'No')}</span>
                        {p.bachelor_accommodation !== undefined && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.bachelor_accommodation ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>Bachelor: {p.bachelor_accommodation ? 'Yes' : 'No'}</span>
                        )}
                        {p.hostel_accommodation !== undefined && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${p.hostel_accommodation ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>Hostel: {p.hostel_accommodation ? 'Yes' : 'No'}</span>
                        )}
                      </div>
                      {p.eligible_employees && <p className="text-[10px] text-slate-500 mt-1">Profiles: {p.eligible_employees}</p>}
                      {p.special_notes && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{p.special_notes}</p>}
                      {p.updated_at && <p className="text-[10px] text-slate-300 mt-0.5">Updated: {new Date(p.updated_at).toLocaleDateString()} by {p.updated_by}</p>}
                    </div>
                    <div className="flex gap-1 ml-3">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(p)} data-testid={`edit-policy-${p.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
