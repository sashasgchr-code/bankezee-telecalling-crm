import React from 'react';
import { Building2, Plus, Loader2 } from 'lucide-react';
import BankEligibilityCard from './BankEligibilityCard';

const EligibilityTracker = ({ 
  eligibilities, 
  canEdit, 
  onUpdate, 
  onAdd, 
  onRemove, 
  onSave,
  isSaving
}) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" data-testid="eligibility-card">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Building2 size={20} className="text-green-600" />
          Bank Eligibilities ({eligibilities.length}/7)
        </h3>
        {canEdit && (
          <button 
            onClick={onAdd} 
            disabled={eligibilities.length >= 7}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus size={16} /> Add Bank
          </button>
        )}
      </div>
      <div className="p-6">
        {eligibilities.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No eligibility records yet. Click "Add Bank" to start tracking.</p>
        ) : (
          <div className="space-y-6">
            {eligibilities.map((elig, index) => (
              <BankEligibilityCard
                key={index}
                eligibility={elig}
                index={index}
                canEdit={canEdit}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
        {canEdit && eligibilities.length > 0 && (
          <button 
            onClick={onSave} 
            disabled={isSaving}
            className="w-full mt-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving && <Loader2 size={16} className="animate-spin" />}
            {isSaving ? 'Saving...' : 'Save All Eligibilities'}
          </button>
        )}
      </div>
    </div>
  );
};

export default EligibilityTracker;
