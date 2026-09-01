import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Edit2, Loader2, Star, Building2, Download, FileArchive } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

import {
  CustomerDetailsSection,
  EmploymentDetailsSection,
  ExistingLoansSection,
  LoanRequirementsSection,
  EligibilityTracker,
  DocumentsPanel,
  ActivityLog,
  FileStatusCard,
  FileAssignmentCard
} from '../../components/file-detail';

const EMPTY_ELIGIBILITY = {
  bank_name: '',
  is_eligible: '',
  eligible_amount: '',
  eligible_tenure: '',
  not_eligible_reason: '',
  login_done: '',
  login_bank: '',
  login_rejection_reason: '',
  approval_status: '',
  approved_bank: '',
  approved_amount: '',
  approved_tenure: '',
  approved_roi: '',
  declined_bank: '',
  declined_reason: '',
  disbursed: '',
  disbursed_bank: '',
  disbursed_amount: '',
  disbursed_tenure: '',
  disbursed_roi: '',
  disbursement_rejection_reason: '',
  commission_percentage: '',
  commission_amount: ''
};

// Generate password for protected files (matches old CRM pattern)
const generateFilePassword = (fileId) => {
  const timestamp = Date.now();
  return `7${timestamp}${fileId?.slice(0, 8) || ''}`.slice(0, 20);
};

const FileDetailsPage = () => {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [newStatus, setNewStatus] = useState('new');
  const [opsTeam, setOpsTeam] = useState([]);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [eligibilities, setEligibilities] = useState([]);
  const [savingEligibilities, setSavingEligibilities] = useState(false);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [editedDetails, setEditedDetails] = useState({});
  const [rating, setRating] = useState(0);
  const [score, setScore] = useState(0);
  
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const canEdit = ['admin', 'telecaller'].includes(user.role);

  useEffect(() => {
    fetchFileData();
    fetchOpsTeam();
  }, [fileId]);

  const fetchFileData = async () => {
    try {
      const response = await api.get(`/files/${fileId}`);
      const data = response.data;
      
      if (!data) {
        toast.error('File not found');
        navigate(-1);
        return;
      }
      
      setFileData(data);
      setNewStatus(data.file_status || 'new');
      setSelectedAssignee(data.file_assigned_to || '');
      setRating(data.rating || 0);
      setScore(data.score || 0);
      
      // Initialize edited details
      const fileDetails = data.file_details || {};
      setEditedDetails({
        full_name: data.name || '',
        mobile: data.phone || '',
        email: data.email || '',
        city: data.city || '',
        employment_type: data.employment_type || fileDetails.employment_type || '',
        mother_name: fileDetails.mother_name || '',
        current_address: fileDetails.current_address || '',
        company_name: fileDetails.company_name || '',
        net_salary: fileDetails.net_salary || '',
        office_address: fileDetails.office_address || '',
        obligations_emi: fileDetails.obligations_emi || '',
        existing_loan_1: fileDetails.existing_loan_1 || '',
        existing_loan_2: fileDetails.existing_loan_2 || '',
        existing_loan_3: fileDetails.existing_loan_3 || '',
        type_of_loan: fileDetails.type_of_loan || data.requirement || '',
        cibil_score: fileDetails.cibil_score || '',
        loan_amount_required: fileDetails.loan_amount_required || '',
        tenure_required: fileDetails.tenure_required || ''
      });
      
      // Convert eligibilities to form format
      const formattedElig = (data.eligibilities || []).map(e => ({
        ...e,
        is_eligible: e.is_eligible === true ? 'yes' : e.is_eligible === false ? 'no' : '',
        login_done: e.login_done === true ? 'yes' : e.login_done === false ? 'no' : '',
        disbursed: e.disbursed === true ? 'yes' : e.disbursed === false ? 'no' : '',
        eligible_amount: e.eligible_amount || '',
        eligible_tenure: e.eligible_tenure || '',
        not_eligible_reason: e.not_eligible_reason || '',
        approved_amount: e.approved_amount || '',
        approved_tenure: e.approved_tenure || '',
        approved_roi: e.approved_roi || '',
        disbursed_amount: e.disbursed_amount || '',
        disbursed_tenure: e.disbursed_tenure || '',
        disbursed_roi: e.disbursed_roi || '',
      }));
      setEligibilities(formattedElig);
    } catch (error) {
      console.error('Failed to load file:', error);
      toast.error('Failed to load file details');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const fetchOpsTeam = async () => {
    try {
      const response = await api.get('/files/operations-team');
      setOpsTeam(response.data);
    } catch (error) {
      console.error('Failed to fetch ops team:', error);
    }
  };

  const handleDetailChange = (field, value) => {
    setEditedDetails(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveDetails = async () => {
    setSavingDetails(true);
    try {
      await api.put(`/files/${fileId}/details`, {
        full_name: editedDetails.full_name,
        mobile: editedDetails.mobile,
        email: editedDetails.email,
        city: editedDetails.city,
        employment_type: editedDetails.employment_type,
        additional_data: {
          mother_name: editedDetails.mother_name,
          current_address: editedDetails.current_address,
          company_name: editedDetails.company_name,
          net_salary: editedDetails.net_salary,
          office_address: editedDetails.office_address,
          obligations_emi: editedDetails.obligations_emi,
          existing_loan_1: editedDetails.existing_loan_1,
          existing_loan_2: editedDetails.existing_loan_2,
          existing_loan_3: editedDetails.existing_loan_3,
          type_of_loan: editedDetails.type_of_loan,
          cibil_score: editedDetails.cibil_score,
          loan_amount_required: editedDetails.loan_amount_required,
          tenure_required: editedDetails.tenure_required
        }
      });
      toast.success('Details saved successfully');
      setIsEditingDetails(false);
      fetchFileData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save details');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleStatusUpdate = async () => {
    try {
      await api.put(`/files/${fileId}/file-status`, { file_status: newStatus });
      toast.success('Status updated successfully');
      fetchFileData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    }
  };

  const handleAssignment = async () => {
    try {
      await api.put(`/files/${fileId}/assign`, { assigned_to: selectedAssignee });
      toast.success('File assigned successfully');
      fetchFileData();
    } catch (error) {
      toast.error('Failed to assign file');
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/files/${fileId}/notes`, { note: note });
      toast.success('Note added');
      setNote('');
      fetchFileData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add note');
    }
  };

  const handleRatingChange = async (newRating) => {
    setRating(newRating);
    try {
      await api.put(`/files/${fileId}/details`, { rating: newRating });
    } catch (error) {
      console.error('Failed to update rating');
    }
  };

  const handleCheckBankEligibility = () => {
    // Navigate to Policy Master or show eligibility check modal
    toast.info('Opening Bank Eligibility Checker...');
  };

  // Eligibility handlers
  const addEligibility = () => {
    if (eligibilities.length >= 7) return;
    setEligibilities([...eligibilities, { ...EMPTY_ELIGIBILITY }]);
  };

  const removeEligibility = (index) => {
    setEligibilities(eligibilities.filter((_, i) => i !== index));
  };

  const updateEligibility = (index, field, value) => {
    const updated = [...eligibilities];
    updated[index] = { ...updated[index], [field]: value };
    setEligibilities(updated);
  };

  const saveEligibilities = async () => {
    setSavingEligibilities(true);
    try {
      const formattedEligibilities = eligibilities.map(e => ({
        bank_name: e.bank_name || '',
        is_eligible: e.is_eligible === 'yes',
        eligible_amount: e.eligible_amount ? parseFloat(e.eligible_amount) : null,
        eligible_tenure: e.eligible_tenure ? parseInt(e.eligible_tenure) : null,
        not_eligible_reason: e.not_eligible_reason || null,
        login_done: e.login_done === 'yes' ? true : e.login_done === 'no' ? false : null,
        login_bank: e.login_bank || null,
        login_rejection_reason: e.login_rejection_reason || null,
        approval_status: e.approval_status || null,
        approved_bank: e.approved_bank || null,
        approved_amount: e.approved_amount ? parseFloat(e.approved_amount) : null,
        approved_tenure: e.approved_tenure ? parseInt(e.approved_tenure) : null,
        approved_roi: e.approved_roi ? parseFloat(e.approved_roi) : null,
        declined_bank: e.declined_bank || null,
        declined_reason: e.declined_reason || null,
        disbursed: e.disbursed === 'yes' ? true : e.disbursed === 'no' ? false : null,
        disbursed_bank: e.disbursed_bank || null,
        disbursed_amount: e.disbursed_amount ? parseFloat(e.disbursed_amount) : null,
        disbursed_tenure: e.disbursed_tenure ? parseInt(e.disbursed_tenure) : null,
        disbursed_roi: e.disbursed_roi ? parseFloat(e.disbursed_roi) : null,
        disbursement_rejection_reason: e.disbursement_rejection_reason || null,
        commission_percentage: e.commission_percentage ? parseFloat(e.commission_percentage) : null,
        commission_amount: e.commission_percentage && e.disbursed_amount 
          ? parseFloat(((parseFloat(e.disbursed_amount) * parseFloat(e.commission_percentage)) / 100).toFixed(2)) 
          : null
      }));
      await api.put(`/files/${fileId}/eligibilities`, { eligibilities: formattedEligibilities });
      toast.success('Eligibilities saved successfully');
      fetchFileData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save eligibilities');
    } finally {
      setSavingEligibilities(false);
    }
  };

  const handleDownloadAllZip = () => {
    toast.info('Preparing ZIP download...');
    // In real implementation, this would call a backend endpoint to create a ZIP
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-green-600" />
      </div>
    );
  }

  if (!fileData) return null;

  const filePassword = generateFilePassword(fileId);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header - Match Old CRM */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4 sticky top-0 z-50">
        <button 
          onClick={() => navigate(-1)} 
          className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
          data-testid="back-btn"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        
        <h1 className="text-xl font-bold text-gray-900">File Details</h1>
        
        {/* Star Rating */}
        <div className="flex items-center gap-1 ml-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRatingChange(star)}
              className="focus:outline-none"
            >
              <Star
                size={20}
                className={star <= rating 
                  ? 'text-yellow-400 fill-yellow-400' 
                  : 'text-gray-300 hover:text-yellow-300'
                }
              />
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-2">{score}/100</span>
        </div>
        
        {/* Check Bank Eligibility Button */}
        <button
          onClick={handleCheckBankEligibility}
          className="ml-4 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
        >
          <Building2 size={18} />
          Check Bank Eligibility
        </button>
        
        <div className="ml-auto text-sm text-gray-500">
          {fileData.name || 'Unnamed'} • {fileData.phone}
        </div>
      </nav>

      <div className="px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* Main Content - Left 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Complete File Information */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="file-info-card">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Complete File Information</h3>
                {canEdit && (
                  <div className="flex gap-2">
                    {isEditingDetails ? (
                      <>
                        <button 
                          onClick={() => setIsEditingDetails(false)} 
                          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleSaveDetails} 
                          disabled={savingDetails} 
                          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingDetails ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          {savingDetails ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={() => setIsEditingDetails(true)} 
                        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                      >
                        <Edit2 size={14} />
                        Edit Details
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="p-6 space-y-6">
                <CustomerDetailsSection
                  details={editedDetails}
                  isEditing={isEditingDetails}
                  onDetailChange={handleDetailChange}
                />
                <EmploymentDetailsSection
                  details={editedDetails}
                  isEditing={isEditingDetails}
                  onDetailChange={handleDetailChange}
                />
                <ExistingLoansSection
                  details={editedDetails}
                  isEditing={isEditingDetails}
                  onDetailChange={handleDetailChange}
                />
                <LoanRequirementsSection
                  details={editedDetails}
                  isEditing={isEditingDetails}
                  onDetailChange={handleDetailChange}
                />
              </div>
            </div>

            {/* Eligibility Tracker */}
            <EligibilityTracker
              eligibilities={eligibilities}
              canEdit={canEdit}
              onUpdate={updateEligibility}
              onAdd={addEligibility}
              onRemove={removeEligibility}
              onSave={saveEligibilities}
              isSaving={savingEligibilities}
            />

            {/* Status Update */}
            {canEdit && (
              <FileStatusCard
                currentStatus={fileData.file_status}
                newStatus={newStatus}
                onStatusChange={setNewStatus}
                onUpdate={handleStatusUpdate}
              />
            )}

            {/* Assign File */}
            {canEdit && (
              <FileAssignmentCard
                opsTeam={opsTeam}
                selectedAssignee={selectedAssignee}
                currentAssignee={fileData.file_assigned_to}
                onAssigneeChange={setSelectedAssignee}
                onAssign={handleAssignment}
              />
            )}
          </div>

          {/* Sidebar - Right column */}
          <div className="space-y-6">
            {/* Documents Panel with Password */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="documents-card">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FileArchive size={20} className="text-green-600" />
                  Documents ({(fileData.file_documents || []).length})
                </h3>
                <button 
                  onClick={handleDownloadAllZip}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                >
                  <Download size={14} />
                  Download All ZIP
                </button>
              </div>
              
              {/* Password Protected Files Notice */}
              {(fileData.file_documents || []).length > 0 && (
                <div className="mx-4 mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600 font-medium">
                    Password Protected Files: {filePassword}
                  </p>
                </div>
              )}
              
              <DocumentsPanel
                documents={fileData.file_documents || []}
                fileId={fileId}
                canEdit={canEdit}
                onDocumentsChange={() => fetchFileData()}
              />
            </div>
            
            <ActivityLog
              activities={fileData.file_activities || []}
              note={note}
              onNoteChange={setNote}
              onAddNote={handleAddNote}
              canEdit={canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileDetailsPage;
