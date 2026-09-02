import React, { useState, useEffect } from 'react';
import { Upload, Download, Trash2, Loader2, FileText, Check, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

// OLD CRM Document Types - Complete list preserved
const DOCUMENT_TYPES = [
  { value: 'pan', label: 'PAN Card', required: true },
  { value: 'aadhaar', label: 'Aadhaar Card', required: true },
  { value: 'photo', label: 'Passport Photo', required: true },
  { value: 'salary_slip_1', label: 'Salary Slip (Month 1)', required: true },
  { value: 'salary_slip_2', label: 'Salary Slip (Month 2)', required: true },
  { value: 'salary_slip_3', label: 'Salary Slip (Month 3)', required: true },
  { value: 'bank_statement', label: 'Bank Statement (6 months)', required: true },
  { value: 'form_16', label: 'Form 16', required: false },
  { value: 'itr', label: 'ITR', required: false },
  { value: 'company_id', label: 'Company ID Card', required: false },
  { value: 'address_proof', label: 'Address Proof', required: false },
  { value: 'rent_agreement', label: 'Rent Agreement', required: false },
  { value: 'electricity_bill', label: 'Electricity Bill', required: false },
  { value: 'property_docs', label: 'Property Documents', required: false },
  { value: 'vehicle_rc', label: 'Vehicle RC', required: false },
  { value: 'insurance', label: 'Insurance Papers', required: false },
  { value: 'business_proof', label: 'Business Proof', required: false },
  { value: 'gst_certificate', label: 'GST Certificate', required: false },
  { value: 'general', label: 'Other Document', required: false }
];

const formatFileSize = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

const DocumentsPanel = ({ 
  documents = [],
  pendingDocuments = [],
  requiredDocuments = [],
  fileId,
  canEdit,
  onDocumentsChange
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState(documents || []);
  const [selectedDocType, setSelectedDocType] = useState('general');
  const [showRequiredSection, setShowRequiredSection] = useState(true);
  const [showUploadedSection, setShowUploadedSection] = useState(true);

  // Update local state when documents prop changes
  useEffect(() => {
    setUploadedFiles(documents || []);
  }, [documents]);

  // Calculate document status
  const getDocumentStatus = () => {
    const required = requiredDocuments.length > 0 
      ? requiredDocuments 
      : DOCUMENT_TYPES.filter(d => d.required).map(d => d.value);
    
    const uploadedTypes = new Set(uploadedFiles.map(d => d.document_type));
    const pending = pendingDocuments || [];
    
    const completed = required.filter(type => uploadedTypes.has(type));
    const stillPending = required.filter(type => !uploadedTypes.has(type));
    
    return {
      total: required.length,
      completed: completed.length,
      pending: stillPending.length,
      requiredDocs: required,
      completedDocs: completed,
      pendingDocs: [...stillPending, ...pending.filter(p => !stillPending.includes(p))]
    };
  };

  const docStatus = getDocumentStatus();

  const handleUpload = async (e, docType = selectedDocType) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('document_type', docType);
        
        const response = await api.post(`/files/${fileId}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        toast.success(`${file.name} uploaded as ${DOCUMENT_TYPES.find(d => d.value === docType)?.label || docType}`);
        const newDocs = [...uploadedFiles, response.data];
        setUploadedFiles(newDocs);
      } catch (error) {
        toast.error(error.response?.data?.detail || `Failed to upload ${file.name}`);
      }
    }
    
    setUploading(false);
    e.target.value = '';
    if (onDocumentsChange) onDocumentsChange();
  };

  const handleDownload = async (doc) => {
    try {
      window.open(`${process.env.REACT_APP_BACKEND_URL}/api/files/download/${doc.file_id}`, '_blank');
    } catch (error) {
      toast.error('Failed to download document');
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    
    try {
      await api.delete(`/files/${fileId}/documents/${docId}`);
      toast.success('Document deleted');
      const newDocs = uploadedFiles.filter(f => f.file_id !== docId);
      setUploadedFiles(newDocs);
      if (onDocumentsChange) onDocumentsChange();
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  // Group uploaded documents by type
  const groupedDocs = uploadedFiles.reduce((acc, doc) => {
    const type = doc.document_type || 'general';
    if (!acc[type]) acc[type] = [];
    acc[type].push(doc);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Document Status Summary */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Document Status</h4>
          <span className="text-xs text-gray-500">
            {docStatus.completed}/{docStatus.total} required docs
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all ${
              docStatus.completed === docStatus.total ? 'bg-green-500' : 'bg-yellow-500'
            }`}
            style={{ width: `${(docStatus.completed / docStatus.total) * 100}%` }}
          />
        </div>
        <div className="flex gap-4 mt-2 text-xs">
          <span className="flex items-center gap-1 text-green-600">
            <Check size={12} /> {docStatus.completed} Uploaded
          </span>
          <span className="flex items-center gap-1 text-yellow-600">
            <Clock size={12} /> {docStatus.pending} Pending
          </span>
        </div>
      </div>

      {/* Required Documents Section */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button 
          onClick={() => setShowRequiredSection(!showRequiredSection)}
          className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <AlertCircle size={16} className="text-yellow-500" />
            Required Documents ({docStatus.pending} pending)
          </span>
          {showRequiredSection ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        
        {showRequiredSection && (
          <div className="p-4 space-y-2">
            {docStatus.requiredDocs.map((docType) => {
              const docInfo = DOCUMENT_TYPES.find(d => d.value === docType);
              const isUploaded = docStatus.completedDocs.includes(docType);
              const uploadedDoc = groupedDocs[docType]?.[0];
              
              return (
                <div 
                  key={docType} 
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isUploaded ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isUploaded ? (
                      <Check size={16} className="text-green-600" />
                    ) : (
                      <Clock size={16} className="text-yellow-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {docInfo?.label || docType}
                      </p>
                      {isUploaded && uploadedDoc && (
                        <p className="text-xs text-gray-500">
                          Uploaded {formatDate(uploadedDoc.uploaded_at)}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {isUploaded && uploadedDoc ? (
                      <>
                        <button 
                          onClick={() => handleDownload(uploadedDoc)}
                          className="p-1.5 text-gray-500 hover:text-green-600 rounded"
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                        {canEdit && (
                          <button 
                            onClick={() => handleDelete(uploadedDoc.file_id)}
                            className="p-1.5 text-gray-500 hover:text-red-600 rounded"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    ) : canEdit && (
                      <>
                        <input 
                          type="file" 
                          className="hidden" 
                          id={`upload-${docType}`}
                          accept=".pdf,.jpg,.jpeg,.png,.gif"
                          onChange={(e) => handleUpload(e, docType)}
                        />
                        <label 
                          htmlFor={`upload-${docType}`}
                          className="px-3 py-1.5 bg-yellow-600 text-white text-xs rounded-lg cursor-pointer hover:bg-yellow-700 flex items-center gap-1"
                        >
                          <Upload size={12} /> Upload
                        </label>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Uploaded Documents Section */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button 
          onClick={() => setShowUploadedSection(!showUploadedSection)}
          className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <FileText size={16} className="text-green-500" />
            All Uploaded Documents ({uploadedFiles.length})
          </span>
          {showUploadedSection ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        
        {showUploadedSection && (
          <div className="p-4">
            {uploadedFiles.length === 0 ? (
              <p className="text-center text-gray-500 py-4">No documents uploaded yet</p>
            ) : (
              <div className="space-y-2">
                {uploadedFiles.map((doc, idx) => {
                  const docInfo = DOCUMENT_TYPES.find(d => d.value === doc.document_type);
                  return (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {doc.original_name || doc.file_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            <span className="inline-block px-1.5 py-0.5 bg-gray-200 rounded text-gray-700 mr-1">
                              {docInfo?.label || doc.document_type}
                            </span>
                            {formatFileSize(doc.size)} • {formatDate(doc.uploaded_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button 
                          onClick={() => handleDownload(doc)}
                          className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded"
                          title="Download"
                        >
                          <Download size={16} />
                        </button>
                        {canEdit && (
                          <button 
                            onClick={() => handleDelete(doc.file_id)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* General Upload Section */}
      {canEdit && (
        <div className="border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Upload Additional Documents</h4>
          <div className="flex gap-2 mb-3">
            <select
              value={selectedDocType}
              onChange={(e) => setSelectedDocType(e.target.value)}
              className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm bg-white"
            >
              {DOCUMENT_TYPES.map(dt => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>
          <input 
            type="file" 
            className="hidden" 
            id="doc-upload-general"
            accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx"
            onChange={(e) => handleUpload(e, selectedDocType)}
            multiple
          />
          <label htmlFor="doc-upload-general">
            <div className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-center cursor-pointer hover:border-green-500 hover:bg-green-50 transition-colors">
              {uploading ? (
                <span className="flex items-center justify-center gap-2 text-gray-600">
                  <Loader2 size={16} className="animate-spin" />
                  Uploading...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 text-gray-600">
                  <Upload size={16} />
                  Select Files to Upload
                </span>
              )}
            </div>
          </label>
          <p className="text-xs text-gray-500 mt-2 text-center">
            PDF, Images, DOC, XLS (max 10MB each)
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentsPanel;
export { DOCUMENT_TYPES };
