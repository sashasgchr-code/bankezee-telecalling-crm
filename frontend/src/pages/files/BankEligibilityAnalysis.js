import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, RefreshCw, Printer, History, Sparkles, 
  CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp,
  Building2, IndianRupee, Percent, Clock, CreditCard, Upload
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

// Format currency in Indian format
const formatCurrency = (amount) => {
  if (!amount) return '-';
  const num = parseFloat(amount);
  if (num >= 100000) {
    return `₹${(num / 100000).toFixed(2)} L`;
  }
  return `₹${num.toLocaleString('en-IN')}`;
};

// Profile rating based on CIBIL and other factors
const getProfileRating = (cibil, foir) => {
  if (cibil >= 750 && foir < 50) return { label: 'Strong Profile', color: 'bg-green-500' };
  if (cibil >= 700 && foir < 60) return { label: 'Moderate Profile', color: 'bg-yellow-500' };
  if (cibil >= 650) return { label: 'Fair Profile', color: 'bg-orange-500' };
  return { label: 'Weak Profile', color: 'bg-red-500' };
};

const BankEligibilityAnalysis = () => {
  const { fileId } = useParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [fileData, setFileData] = useState(null);
  const [results, setResults] = useState(null);
  const [expandedBank, setExpandedBank] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetchFileData();
    fetchEligibilityHistory();
  }, [fileId]);

  const fetchFileData = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/files/${fileId}`);
      setFileData(response.data);
      
      // If there's a previous eligibility check result, load it
      if (response.data.last_eligibility_check) {
        setResults(response.data.last_eligibility_check);
      }
    } catch (error) {
      toast.error('Failed to load file data');
    } finally {
      setLoading(false);
    }
  };

  const fetchEligibilityHistory = async () => {
    try {
      const response = await api.get(`/files/${fileId}/eligibility-history`);
      setHistory(response.data || []);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  const runEligibilityCheck = async () => {
    setChecking(true);
    try {
      const response = await api.post(`/files/${fileId}/check-eligibility`);
      setResults(response.data);
      toast.success(`Eligibility analysis complete: ${response.data.eligible_count} banks eligible`);
      fetchEligibilityHistory();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to check eligibility');
    } finally {
      setChecking(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleAIParseDocs = async () => {
    toast.info('AI Document parsing feature coming soon');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  const fd = fileData?.file_details || {};
  const customerName = fd.full_name || fileData?.name || 'Customer';
  const loanType = fd.type_of_loan?.replace(/_/g, ' ') || 'Personal Loan';
  
  // Calculate customer metrics
  const cibil = parseInt(fd.cibil_score) || 0;
  const netSalary = parseFloat(fd.net_salary) || 0;
  const existingEmi = parseFloat(fd.total_emi) || 0;
  const requestedAmount = parseFloat(fd.loan_amount_required) || 0;
  const foir = netSalary > 0 ? Math.round((existingEmi / netSalary) * 100) : 0;
  const companyType = fd.company_type || fd.employment_type || 'Private';
  
  const profileRating = getProfileRating(cibil, foir);
  
  // Categorize results
  const eligibleBanks = results?.results?.filter(r => r.is_eligible) || [];
  const possibleBanks = results?.results?.filter(r => r.status === 'possible') || [];
  const notEligibleBanks = results?.results?.filter(r => !r.is_eligible && r.status !== 'possible') || [];
  
  // Sort eligible banks by amount
  const sortedEligible = [...eligibleBanks].sort((a, b) => 
    (parseFloat(b.eligible_amount) || 0) - (parseFloat(a.eligible_amount) || 0)
  );

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white" data-testid="bank-eligibility-analysis">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 print:static">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate(`/admin/files/${fileId}`)}
                className="p-2 hover:bg-gray-100 rounded-lg print:hidden"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Bank Eligibility Analysis</h1>
                <p className="text-sm text-gray-500">{customerName} — {loanType}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 print:hidden">
              <button
                onClick={runEligibilityCheck}
                disabled={checking}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
                {checking ? 'Checking...' : 'Recheck'}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <Printer size={16} />
                Print
              </button>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <History size={16} />
                History
              </button>
              <button
                onClick={handleAIParseDocs}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <Sparkles size={16} className="text-purple-500" />
                AI Parse Docs
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Customer Profile Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Customer Profile Summary</h2>
            <span className={`px-3 py-1 rounded-full text-white text-sm font-medium ${profileRating.color}`}>
              {profileRating.label}
            </span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{cibil || '-'}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">CIBIL</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(netSalary)}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Net Salary</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(existingEmi)}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">EMI</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{foir}%</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">FOIR</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(requestedAmount)}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Requested</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900 capitalize">{companyType?.toLowerCase()}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide mt-1">Company</p>
            </div>
          </div>

          {/* Eligibility Summary */}
          {results && (
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-100">
              <span className="flex items-center gap-2 text-green-600 font-medium">
                <CheckCircle size={18} />
                {eligibleBanks.length} Eligible
              </span>
              <span className="flex items-center gap-2 text-yellow-600 font-medium">
                <AlertCircle size={18} />
                {possibleBanks.length} Possible
              </span>
              <span className="flex items-center gap-2 text-red-600 font-medium">
                <XCircle size={18} />
                {notEligibleBanks.length} Not Eligible
              </span>
              <span className="text-gray-500 text-sm ml-auto">
                of {results.total_lenders_checked || results.results?.length || 0} lenders checked
              </span>
            </div>
          )}
        </div>

        {/* No Results Yet */}
        {!results && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Eligibility Check Yet</h3>
            <p className="text-gray-500 mb-6">
              Click "Recheck" to analyze bank eligibility based on customer profile and policy rules.
            </p>
            <button
              onClick={runEligibilityCheck}
              disabled={checking}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {checking ? 'Checking...' : 'Run Eligibility Check'}
            </button>
          </div>
        )}

        {/* Bank Comparison Table */}
        {results && sortedEligible.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 size={18} className="text-green-600" />
              Bank Comparison (Top {Math.min(sortedEligible.length, 5)})
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">Bank</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">Status</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-700">Eligible Amt</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">ROI</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">Tenure</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">Min Salary</th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700">CIBIL</th>
                    <th className="text-center py-3 px-2 font-semibold text-gray-700">BT</th>
                    <th className="text-center py-3 px-2 font-semibold text-gray-700">Top-up</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEligible.slice(0, 5).map((bank, index) => (
                    <tr key={bank.bank_name} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {index === 0 && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                              BEST MATCH
                            </span>
                          )}
                          {index === 1 && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                              2ND BEST
                            </span>
                          )}
                          <span className="font-medium text-gray-900">{bank.bank_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                          ELIGIBLE
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-green-600">
                        {formatCurrency(bank.eligible_amount)}
                      </td>
                      <td className="py-3 px-2 text-gray-600">
                        {bank.roi || bank.interest_rate || 'NA'}
                      </td>
                      <td className="py-3 px-2 text-gray-600">
                        {bank.tenure || bank.max_tenure || '-'}
                      </td>
                      <td className="py-3 px-2 text-gray-600">
                        {bank.min_salary ? formatCurrency(bank.min_salary) : '-'}
                      </td>
                      <td className="py-3 px-2 text-gray-600">
                        {bank.min_cibil || bank.cibil_requirement || '-'}
                      </td>
                      <td className="py-3 px-2 text-center">
                        {bank.allows_bt ? (
                          <CheckCircle size={16} className="text-green-500 mx-auto" />
                        ) : (
                          <XCircle size={16} className="text-gray-300 mx-auto" />
                        )}
                      </td>
                      <td className="py-3 px-2 text-center">
                        {bank.allows_topup ? (
                          <CheckCircle size={16} className="text-green-500 mx-auto" />
                        ) : (
                          <XCircle size={16} className="text-gray-300 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Missing Data Warning */}
        {results?.missing_data && results.missing_data.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-800">Missing Data — Confidence could improve</h4>
                <div className="flex flex-wrap gap-2 mt-2">
                  {results.missing_data.map((item, i) => (
                    <span key={i} className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
                      {item}
                    </span>
                  ))}
                </div>
                <button 
                  onClick={() => navigate(`/admin/files/${fileId}`)}
                  className="mt-3 flex items-center gap-2 text-amber-700 hover:text-amber-900 text-sm font-medium"
                >
                  <Upload size={14} />
                  Update Lead Data / Upload Documents
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recommended Options */}
        {results && sortedEligible.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles size={18} className="text-yellow-500" />
              RECOMMENDED OPTIONS ({sortedEligible.length})
            </h3>
            
            {sortedEligible.map((bank, index) => (
              <div key={bank.bank_name} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div 
                  className="p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedBank(expandedBank === bank.bank_name ? null : bank.bank_name)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {index === 0 && (
                        <span className="px-2 py-1 bg-green-600 text-white text-xs font-bold rounded">
                          BEST MATCH
                        </span>
                      )}
                      {index === 1 && (
                        <span className="px-2 py-1 bg-blue-600 text-white text-xs font-bold rounded">
                          2ND BEST
                        </span>
                      )}
                      <h4 className="text-lg font-semibold text-gray-900">{bank.bank_name}</h4>
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                        ELIGIBLE
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        bank.confidence === 'HIGH' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {bank.confidence || 'MEDIUM'} CONFIDENCE
                      </span>
                    </div>
                    {expandedBank === bank.bank_name ? (
                      <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={20} className="text-gray-400" />
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
                    <span className="flex items-center gap-1">
                      <IndianRupee size={14} className="text-gray-400" />
                      <strong>Amount:</strong> {formatCurrency(bank.eligible_amount)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Percent size={14} className="text-gray-400" />
                      <strong>ROI:</strong> {bank.roi || bank.interest_rate || 'NA'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={14} className="text-gray-400" />
                      <strong>Tenure:</strong> {bank.tenure || bank.max_tenure || '-'}
                    </span>
                    {bank.estimated_emi && (
                      <span className="flex items-center gap-1">
                        <CreditCard size={14} className="text-gray-400" />
                        <strong>Est. EMI:</strong> {formatCurrency(bank.estimated_emi)}
                      </span>
                    )}
                    <span>
                      <strong>Min Salary:</strong> {bank.min_salary ? formatCurrency(bank.min_salary) : '-'}
                    </span>
                  </div>
                </div>
                
                {expandedBank === bank.bank_name && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">CIBIL Requirement:</span>
                        <p className="font-medium text-gray-900">{bank.cibil_requirement || bank.min_cibil || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Balance Transfer:</span>
                        <p className="font-medium text-gray-900">
                          {bank.bt_details || (bank.allows_bt ? 'Allowed' : 'Not Allowed')}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Top-up:</span>
                        <p className="font-medium text-gray-900">
                          {bank.topup_details || (bank.allows_topup ? 'Allowed' : 'Not Allowed')}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Processing Fee:</span>
                        <p className="font-medium text-gray-900">{bank.processing_fee || '-'}</p>
                      </div>
                    </div>
                    {bank.notes && (
                      <p className="mt-3 text-sm text-gray-600 italic">{bank.notes}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Not Eligible Banks (Collapsed) */}
        {results && notEligibleBanks.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setExpandedBank(expandedBank === 'not_eligible' ? null : 'not_eligible')}
              className="w-full flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200 hover:bg-gray-50"
            >
              <span className="font-medium text-gray-700">
                NOT CURRENTLY ELIGIBLE ({notEligibleBanks.length} lenders)
              </span>
              {expandedBank === 'not_eligible' ? (
                <ChevronUp size={20} className="text-gray-400" />
              ) : (
                <ChevronDown size={20} className="text-gray-400" />
              )}
            </button>
            
            {expandedBank === 'not_eligible' && (
              <div className="mt-2 bg-white rounded-xl border border-gray-200 p-4">
                <div className="space-y-2">
                  {notEligibleBanks.map(bank => (
                    <div key={bank.bank_name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="font-medium text-gray-700">{bank.bank_name}</span>
                      <span className="text-sm text-red-600">{bank.not_eligible_reason || 'Does not meet criteria'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Disclaimer */}
        {results && (
          <p className="mt-6 text-xs text-gray-400 text-center">
            * BankEzee Eligibility Estimate. Final approval subject to bank verification and documentation.
          </p>
        )}

        {/* History Modal */}
        {showHistory && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
            <div className="bg-white rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Eligibility Check History</h3>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <XCircle size={20} />
                </button>
              </div>
              <div className="p-4">
                {history.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No previous checks</p>
                ) : (
                  <div className="space-y-3">
                    {history.map((check, i) => (
                      <div key={i} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-gray-900">
                            {new Date(check.checked_at).toLocaleString('en-IN')}
                          </span>
                          <span className="text-sm text-gray-500">
                            {check.eligible_count} eligible / {check.total_checked} checked
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{check.checked_by || 'System'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BankEligibilityAnalysis;
