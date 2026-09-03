import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Edit2, Loader2, Star, Building2, Download, FileArchive, User, Briefcase, CreditCard, FileText } from 'lucide-react';
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
  FileAssignmentCard,
  CollapsibleSection
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
  const isAdmin = user.role === 'admin';
  const isOps = user.role === 'ops' || user.role === 'operations';
  // Growth Partner roles: telecaller, sales_agent, team_leader, partner, manager
  const isGP = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'manager'].includes(user.role);
  
  // Section 1 (Customer/Application Info): GP, Ops, Admin can all edit
  const canEditCustomerDetails = isAdmin || isOps || isGP;
  
  // Section 2 (Bank Processing): ONLY Ops and Admin can edit
  // GPs can VIEW bank processing status but CANNOT modify
  const canEditBankProcessing = isAdmin || isOps;
  
  // Overall edit permission (for general actions like notes, status)
  const canEdit = isAdmin || isOps || isGP;

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
      setRating(data.rating || data.star_rating || 0);
      setScore(data.score || data.star_score || 0);
      
      // Initialize edited details with ALL OLD CRM fields
      const fileDetails = data.file_details || data.additional_data || {};
      setEditedDetails({
        // Customer Details
        full_name: data.name || '',
        mobile: data.phone || '',
        email: data.email || '',
        father_name: fileDetails.father_name || '',
        mother_name: fileDetails.mother_name || '',
        date_of_birth: fileDetails.date_of_birth || '',
        pan_number: fileDetails.pan_number || '',
        aadhaar_number: fileDetails.aadhaar_number || '',
        current_address: fileDetails.current_address || '',
        city: data.city || fileDetails.city || '',
        permanent_address: fileDetails.permanent_address || '',
        pin_code: fileDetails.pin_code || '',
        residence_type: fileDetails.residence_type || '',
        years_at_current_address: fileDetails.years_at_current_address || '',
        
        // Employment Details
        employment_type: data.employment_type || fileDetails.employment_type || '',
        company_name: fileDetails.company_name || '',
        company_type: fileDetails.company_type || '',
        designation: fileDetails.designation || '',
        office_address: fileDetails.office_address || '',
        office_city: fileDetails.office_city || '',
        office_pincode: fileDetails.office_pincode || '',
        present_employment_months: fileDetails.present_employment_months || '',
        total_employment_months: fileDetails.total_employment_months || '',
        gross_salary: fileDetails.gross_salary || '',
        net_salary: fileDetails.net_salary || '',
        salary_bank_name: fileDetails.salary_bank_name || '',
        salary_account_number: fileDetails.salary_account_number || '',
        additional_income: fileDetails.additional_income || '',
        additional_income_source: fileDetails.additional_income_source || '',
        // Self-employed fields
        business_name: fileDetails.business_name || '',
        business_vintage: fileDetails.business_vintage || '',
        annual_turnover: fileDetails.annual_turnover || '',
        itr_filed_amount: fileDetails.itr_filed_amount || '',
        
        // Existing Obligations
        cibil_score: fileDetails.cibil_score || '',
        cibil_issues: fileDetails.cibil_issues || '',
        obligations_emi: fileDetails.obligations_emi || '',
        foir: fileDetails.foir || '',
        tvr_done: fileDetails.tvr_done || '',
        tvr_not_done_reason: fileDetails.tvr_not_done_reason || '',
        emi_ok: fileDetails.emi_ok || '',
        emi_not_ok_reason: fileDetails.emi_not_ok_reason || '',
        existing_loans: fileDetails.existing_loans || [],
        existing_loan_1: fileDetails.existing_loan_1 || '',
        existing_loan_2: fileDetails.existing_loan_2 || '',
        existing_loan_3: fileDetails.existing_loan_3 || '',
        credit_card_count: fileDetails.credit_card_count || '',
        total_cc_limit: fileDetails.total_cc_limit || '',
        cc_outstanding: fileDetails.cc_outstanding || '',
        cc_utilization: fileDetails.cc_utilization || '',
        
        // Loan Requirements
        type_of_loan: fileDetails.type_of_loan || data.requirement || '',
        loan_amount_required: fileDetails.loan_amount_required || '',
        tenure_required: fileDetails.tenure_required || '',
        loan_purpose: fileDetails.loan_purpose || '',
        expected_roi: fileDetails.expected_roi || '',
        expected_emi: fileDetails.expected_emi || '',
        bt_amount: fileDetails.bt_amount || '',
        current_roi: fileDetails.current_roi || '',
        topup_amount: fileDetails.topup_amount || '',
        property_value: fileDetails.property_value || '',
        property_type: fileDetails.property_type || '',
        property_location: fileDetails.property_location || '',
        vehicle_type: fileDetails.vehicle_type || '',
        vehicle_model: fileDetails.vehicle_model || '',
        vehicle_year: fileDetails.vehicle_year || '',
        requirement_notes: fileDetails.requirement_notes || '',
        
        // OLD CRM additional fields
        pending_documents: data.pending_documents || fileDetails.pending_documents || '',
        query_hold_reason: data.query_hold_reason || fileDetails.query_hold_reason || '',
        documents_note: fileDetails.documents_note || '',
        has_password_files: fileDetails.has_password_files || '',
        file_passwords: fileDetails.file_passwords || ''
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
      // Build comprehensive additional_data object with all OLD CRM fields
      const additionalData = {
        // Personal Details
        father_name: editedDetails.father_name,
        mother_name: editedDetails.mother_name,
        date_of_birth: editedDetails.date_of_birth,
        pan_number: editedDetails.pan_number,
        aadhaar_number: editedDetails.aadhaar_number,
        current_address: editedDetails.current_address,
        permanent_address: editedDetails.permanent_address,
        pin_code: editedDetails.pin_code,
        residence_type: editedDetails.residence_type,
        years_at_current_address: editedDetails.years_at_current_address,
        
        // Employment Details
        company_name: editedDetails.company_name,
        company_type: editedDetails.company_type,
        designation: editedDetails.designation,
        office_address: editedDetails.office_address,
        office_city: editedDetails.office_city,
        office_pincode: editedDetails.office_pincode,
        present_employment_months: editedDetails.present_employment_months,
        total_employment_months: editedDetails.total_employment_months,
        gross_salary: editedDetails.gross_salary,
        net_salary: editedDetails.net_salary,
        salary_bank_name: editedDetails.salary_bank_name,
        salary_account_number: editedDetails.salary_account_number,
        additional_income: editedDetails.additional_income,
        additional_income_source: editedDetails.additional_income_source,
        business_name: editedDetails.business_name,
        business_vintage: editedDetails.business_vintage,
        annual_turnover: editedDetails.annual_turnover,
        itr_filed_amount: editedDetails.itr_filed_amount,
        
        // Existing Obligations
        cibil_score: editedDetails.cibil_score,
        cibil_issues: editedDetails.cibil_issues,
        obligations_emi: editedDetails.obligations_emi,
        foir: editedDetails.foir,
        tvr_done: editedDetails.tvr_done,
        tvr_not_done_reason: editedDetails.tvr_not_done_reason,
        emi_ok: editedDetails.emi_ok,
        emi_not_ok_reason: editedDetails.emi_not_ok_reason,
        existing_loans: editedDetails.existing_loans,
        existing_loan_1: editedDetails.existing_loan_1,
        existing_loan_2: editedDetails.existing_loan_2,
        existing_loan_3: editedDetails.existing_loan_3,
        credit_card_count: editedDetails.credit_card_count,
        total_cc_limit: editedDetails.total_cc_limit,
        cc_outstanding: editedDetails.cc_outstanding,
        cc_utilization: editedDetails.cc_utilization,
        
        // Loan Requirements
        type_of_loan: editedDetails.type_of_loan,
        loan_amount_required: editedDetails.loan_amount_required,
        tenure_required: editedDetails.tenure_required,
        loan_purpose: editedDetails.loan_purpose,
        expected_roi: editedDetails.expected_roi,
        expected_emi: editedDetails.expected_emi,
        bt_amount: editedDetails.bt_amount,
        current_roi: editedDetails.current_roi,
        topup_amount: editedDetails.topup_amount,
        property_value: editedDetails.property_value,
        property_type: editedDetails.property_type,
        property_location: editedDetails.property_location,
        vehicle_type: editedDetails.vehicle_type,
        vehicle_model: editedDetails.vehicle_model,
        vehicle_year: editedDetails.vehicle_year,
        requirement_notes: editedDetails.requirement_notes,
        
        // OLD CRM additional fields
        pending_documents: editedDetails.pending_documents,
        documents_note: editedDetails.documents_note,
        has_password_files: editedDetails.has_password_files,
        file_passwords: editedDetails.file_passwords
      };
      
      await api.put(`/files/${fileId}/details`, {
        full_name: editedDetails.full_name,
        mobile: editedDetails.mobile,
        email: editedDetails.email,
        city: editedDetails.city,
        employment_type: editedDetails.employment_type,
        additional_data: additionalData
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

  const [checkingEligibility, setCheckingEligibility] = useState(false);

  // Navigate to separate Bank Eligibility Analysis page
  const handleCheckBankEligibility = () => {
    navigate(`/admin/files/${fileId}/eligibility`);
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
        
        {/* Check Bank Eligibility Button - Navigate to Analysis Page */}
        <button
          onClick={handleCheckBankEligibility}
          className="ml-4 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
        >
          <Building2 size={18} />
          Check Eligibility
        </button>
        
        <div className="ml-auto text-sm text-gray-500">
          {fileData.name || 'Unnamed'} • {fileData.phone}
        </div>
      </nav>

      <div className="px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* Main Content - Left 2 columns */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Section 1: Customer & Application Information - Collapsible on Mobile */}
            <CollapsibleSection
              title="Customer & Application"
              subtitle="Editable by Growth Partner, Ops, and Admin"
              icon={User}
              defaultExpanded={true}
              testId="file-info-card"
              rightContent={
                canEditCustomerDetails && (
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
                        data-testid="edit-details-btn"
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                )
              }
            >
              {/* Sub-sections within Customer & Application */}
              <div className="space-y-4">
                {/* Customer Details - Collapsible subsection */}
                <CollapsibleSection
                  title="Customer Details"
                  icon={User}
                  defaultExpanded={true}
                  className="border-gray-50"
                >
                  <CustomerDetailsSection
                    details={editedDetails}
                    isEditing={isEditingDetails}
                    onDetailChange={handleDetailChange}
                  />
                </CollapsibleSection>
                
                {/* Employment Details */}
                <CollapsibleSection
                  title="Employment & Income"
                  icon={Briefcase}
                  defaultExpanded={false}
                  className="border-gray-50"
                >
                  <EmploymentDetailsSection
                    details={editedDetails}
                    isEditing={isEditingDetails}
                    onDetailChange={handleDetailChange}
                  />
                </CollapsibleSection>
                
                {/* Existing Loans */}
                <CollapsibleSection
                  title="Existing Obligations"
                  icon={CreditCard}
                  defaultExpanded={false}
                  className="border-gray-50"
                >
                  <ExistingLoansSection
                    details={editedDetails}
                    isEditing={isEditingDetails}
                    onDetailChange={handleDetailChange}
                  />
                </CollapsibleSection>
                
                {/* Loan Requirements */}
                <CollapsibleSection
                  title="Loan Requirements"
                  icon={FileText}
                  defaultExpanded={false}
                  className="border-gray-50"
                >
                  <LoanRequirementsSection
                    details={editedDetails}
                    isEditing={isEditingDetails}
                    onDetailChange={handleDetailChange}
                  />
                </CollapsibleSection>
              </div>
            </CollapsibleSection>

            {/* Section 2: Bank Processing - Collapsible on Mobile */}
            <CollapsibleSection
              title="Bank Processing & Eligibility"
              subtitle={canEditBankProcessing 
                ? 'Editable by Ops and Admin only' 
                : 'View only - Contact Ops/Admin to update'}
              icon={Building2}
              defaultExpanded={true}
              testId="bank-processing-section"
              badge={!canEditBankProcessing && isGP && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">View Only</span>
              )}
            >
              <EligibilityTracker
                eligibilities={eligibilities}
                canEdit={canEditBankProcessing}
                onUpdate={updateEligibility}
                onAdd={addEligibility}
                onRemove={removeEligibility}
                onSave={saveEligibilities}
                isSaving={savingEligibilities}
              />
            </CollapsibleSection>

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
          <div className="space-y-4 sm:space-y-6">
            {/* Documents Panel - Collapsible on Mobile */}
            <CollapsibleSection
              title={`Documents (${(fileData.file_documents || fileData.documents || []).length})`}
              icon={FileArchive}
              defaultExpanded={false}
              testId="documents-card"
              rightContent={
                <button 
                  onClick={handleDownloadAllZip}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">Download ZIP</span>
                </button>
              }
            >
              {/* Password Protected Files Notice */}
              {(fileData.file_documents || fileData.documents || []).length > 0 && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600 font-medium">
                    Password: {filePassword}
                  </p>
                </div>
              )}
              
              <DocumentsPanel
                documents={fileData.file_documents || fileData.documents || []}
                pendingDocuments={fileData.pending_documents || []}
                requiredDocuments={fileData.required_documents || []}
                fileId={fileId}
                canEdit={canEdit}
                onDocumentsChange={() => fetchFileData()}
              />
            </CollapsibleSection>
            
            {/* Activity Log - Collapsible on Mobile */}
            <CollapsibleSection
              title="Activity Log"
              subtitle={`${(fileData.file_activities || []).length} events`}
              defaultExpanded={false}
              testId="activity-log-card"
            >
              <ActivityLog
                activities={fileData.file_activities || []}
                note={note}
                onNoteChange={setNote}
                onAddNote={handleAddNote}
                canEdit={canEdit}
                compact={true}
              />
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileDetailsPage;
