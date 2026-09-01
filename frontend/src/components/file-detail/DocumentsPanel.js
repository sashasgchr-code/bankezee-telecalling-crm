import React, { useState } from 'react';
import { FileText, Upload, Download, Trash2, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const DocumentsPanel = ({ 
  documents = [],
  fileId,
  canEdit,
  onDocumentsChange
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState(documents || []);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', 'general');
      
      const response = await api.post(`/files/${fileId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      toast.success('Document uploaded successfully');
      const newDocs = [...uploadedFiles, response.data];
      setUploadedFiles(newDocs);
      if (onDocumentsChange) onDocumentsChange(newDocs);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to upload document');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
      if (onDocumentsChange) onDocumentsChange(newDocs);
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="documents-card">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FileText size={20} className="text-green-600" />
          Documents ({uploadedFiles.length})
        </h3>
      </div>
      <div className="p-6">
        {uploadedFiles.length === 0 ? (
          <p className="text-center text-gray-500 py-4">No documents uploaded</p>
        ) : (
          <div className="space-y-2 mb-4">
            {uploadedFiles.map((doc, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.original_name || doc.file_name}</p>
                  <p className="text-xs text-gray-500">{doc.document_type} • {((doc.size || 0) / 1024).toFixed(1)}KB</p>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => handleDownload(doc)}
                    className="p-2 text-gray-500 hover:text-green-600"
                  >
                    <Download size={16} />
                  </button>
                  {canEdit && (
                    <button 
                      onClick={() => handleDelete(doc.file_id)}
                      className="p-2 text-gray-500 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <div>
            <input 
              type="file" 
              className="hidden" 
              id="doc-upload"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx"
              onChange={handleUpload}
            />
            <label htmlFor="doc-upload">
              <div className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-center cursor-pointer hover:border-green-500 hover:bg-green-50 transition-colors">
                {uploading ? (
                  <span className="flex items-center justify-center gap-2 text-gray-600">
                    <Loader2 size={16} className="animate-spin" />
                    Uploading...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2 text-gray-600">
                    <Upload size={16} />
                    Upload Document
                  </span>
                )}
              </div>
            </label>
            <p className="text-xs text-gray-500 mt-2 text-center">PDF, Images, DOC, XLS (max 10MB)</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentsPanel;
