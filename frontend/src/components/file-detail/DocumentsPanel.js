import React, { useState, useEffect } from 'react';
import { Upload, Download, Trash2, Loader2, FileText } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const formatFileSize = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const DocumentsPanel = ({ 
  documents = [],
  fileId,
  canEdit,
  onDocumentsChange
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState(documents || []);

  // Update local state when documents prop changes
  useEffect(() => {
    setUploadedFiles(documents || []);
  }, [documents]);

  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('document_type', 'general');
        
        const response = await api.post(`/files/${fileId}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        toast.success(`${file.name} uploaded successfully`);
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

  return (
    <div className="p-4">
      {uploadedFiles.length === 0 ? (
        <p className="text-center text-gray-500 py-4">No documents uploaded</p>
      ) : (
        <div className="space-y-2 mb-4">
          {uploadedFiles.map((doc, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <FileText size={16} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {doc.original_name || doc.file_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {doc.document_type} • {formatFileSize(doc.size)}
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
            multiple
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
                  Upload Documents
                </span>
              )}
            </div>
          </label>
          <p className="text-xs text-gray-500 mt-2 text-center">
            PDF, Images, DOC, XLS (max 10MB each) - Select multiple files
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentsPanel;
