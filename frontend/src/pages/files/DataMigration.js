import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Download, Database } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const DataMigration = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.name.endsWith('.json')) {
      setFile(selectedFile);
      setResult(null);
    } else {
      toast.error('Please select a JSON file');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.json')) {
      setFile(droppedFile);
      setResult(null);
    } else {
      toast.error('Please drop a JSON file');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/files/import/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setResult(response.data);
      toast.success(`Migration complete! ${response.data.new_records} new, ${response.data.updated_records} updated`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Migration failed');
      setResult({ error: error.response?.data?.detail || 'Migration failed' });
    } finally {
      setUploading(false);
    }
  };

  const downloadExportScript = () => {
    // Create the export script content
    const scriptContent = `"""
=================================================================
OLD CRM DATA EXPORT SCRIPT
=================================================================
Run this script on any machine that can connect to the old CRM database.
It will export all data to a JSON file that you can then import into Connect.

INSTRUCTIONS:
1. Make sure Python 3.7+ is installed
2. Install required package: pip install pymongo
3. Update the DATABASE_NAME and COLLECTION_NAME below
4. Run: python export_old_crm.py
5. Upload the generated JSON file to Connect
=================================================================
"""

import json
from datetime import datetime
from pymongo import MongoClient
from bson import ObjectId

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================

# Your old CRM MongoDB connection string
OLD_CRM_URL = "mongodb+srv://finance-dash-166:d64p1c4lqs2c73a525pg@customer-apps.j2s0aq.mongodb.net/?appName=lead-gen-platform-13&maxPoolSize=5&retryWrites=true&w=majority"

# Database name (update if different)
DATABASE_NAME = "test"  # <-- UPDATE THIS

# Collection name where leads/files are stored
COLLECTION_NAME = "data"  # <-- UPDATE THIS

# ============================================

class JSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

def export_data():
    print("Connecting to database...")
    client = MongoClient(OLD_CRM_URL, serverSelectionTimeoutMS=30000)
    client.admin.command('ping')
    print("Connected!")
    
    db = client[DATABASE_NAME]
    collection = db[COLLECTION_NAME]
    total = collection.count_documents({})
    print(f"Found {total} documents")
    
    documents = list(collection.find({}))
    for doc in documents:
        if '_id' in doc:
            doc['_id'] = str(doc['_id'])
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"crm_export_{timestamp}.json"
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump({"files": documents}, f, cls=JSONEncoder, indent=2)
    
    print(f"Exported {len(documents)} records to {filename}")
    client.close()

if __name__ == "__main__":
    export_data()
`;

    const blob = new Blob([scriptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_old_crm.py';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export script downloaded');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-600 to-green-700">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Database size={24} />
              CRM Data Migration
            </h1>
            <p className="text-green-100 text-sm mt-1">
              Import data from old CRM (crm.bankezee.com) into Connect
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Step 1: Download Export Script */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Download Export Script</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Download the Python script and run it on a machine that can connect to the old CRM database.
                  </p>
                  <button
                    onClick={downloadExportScript}
                    className="mt-3 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 flex items-center gap-2"
                  >
                    <Download size={16} />
                    Download export_old_crm.py
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Run Script */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Run the Export Script</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    On a machine with MongoDB access, run:
                  </p>
                  <div className="mt-2 bg-gray-900 text-green-400 p-3 rounded-lg font-mono text-sm">
                    <p>pip install pymongo</p>
                    <p>python export_old_crm.py</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    This will generate a file like <code>crm_export_20260901_120000.json</code>
                  </p>
                </div>
              </div>
            </div>

            {/* Step 3: Upload */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">Upload Export File</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Upload the JSON file generated by the export script.
                  </p>
                  
                  <div
                    className={`mt-3 border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      dragOver ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-green-400'
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    {file ? (
                      <div className="flex items-center justify-center gap-3">
                        <FileText size={24} className="text-green-600" />
                        <span className="font-medium text-gray-900">{file.name}</span>
                        <span className="text-sm text-gray-500">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    ) : (
                      <>
                        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-gray-600">
                          Drag & drop your JSON file here, or{' '}
                          <label className="text-green-600 hover:text-green-700 cursor-pointer font-medium">
                            browse
                            <input
                              type="file"
                              accept=".json"
                              onChange={handleFileSelect}
                              className="hidden"
                            />
                          </label>
                        </p>
                      </>
                    )}
                  </div>

                  {file && (
                    <button
                      onClick={handleUpload}
                      disabled={uploading}
                      className="mt-4 w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold rounded-lg flex items-center justify-center gap-2"
                    >
                      {uploading ? (
                        <>
                          <Loader2 size={20} className="animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Upload size={20} />
                          Start Migration
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Result */}
            {result && (
              <div className={`rounded-lg p-4 ${result.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                <div className="flex items-start gap-3">
                  {result.error ? (
                    <AlertCircle size={24} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <CheckCircle size={24} className="text-green-500 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    {result.error ? (
                      <>
                        <h4 className="font-semibold text-red-800">Migration Failed</h4>
                        <p className="text-sm text-red-600 mt-1">{result.error}</p>
                      </>
                    ) : (
                      <>
                        <h4 className="font-semibold text-green-800">Migration Complete!</h4>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div className="bg-white rounded p-2 text-center">
                            <p className="text-2xl font-bold text-green-600">{result.new_records}</p>
                            <p className="text-gray-500">New Records</p>
                          </div>
                          <div className="bg-white rounded p-2 text-center">
                            <p className="text-2xl font-bold text-blue-600">{result.updated_records}</p>
                            <p className="text-gray-500">Updated</p>
                          </div>
                          <div className="bg-white rounded p-2 text-center">
                            <p className="text-2xl font-bold text-gray-600">{result.total_processed}</p>
                            <p className="text-gray-500">Total Processed</p>
                          </div>
                          <div className="bg-white rounded p-2 text-center">
                            <p className="text-2xl font-bold text-orange-600">{result.skipped}</p>
                            <p className="text-gray-500">Skipped</p>
                          </div>
                        </div>
                        {result.errors && result.errors.length > 0 && (
                          <div className="mt-3 text-xs text-orange-600">
                            <p className="font-medium">Errors ({result.errors.length}):</p>
                            <ul className="list-disc list-inside mt-1">
                              {result.errors.slice(0, 5).map((err, idx) => (
                                <li key={idx}>{err.phone}: {err.error}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Help Section */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-800 flex items-center gap-2">
            <AlertCircle size={18} />
            Need Help?
          </h3>
          <ul className="mt-2 text-sm text-blue-700 space-y-1">
            <li>• Make sure you have Python 3.7+ installed</li>
            <li>• The export script needs access to the old CRM database</li>
            <li>• Update DATABASE_NAME and COLLECTION_NAME in the script if needed</li>
            <li>• Existing records (matching phone) will be updated, not duplicated</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default DataMigration;
