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
    <div data-testid="eligibility-tracker">
      {/* Header with Add Bank button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Building2 size={20} className="text-green-600" />
          <span className="font-medium">Bank Eligibilities ({eligibilities.length}/7 maximum)</span>
        </div>
        {canEdit && (
          <button 
            onClick={onAdd} 
            disabled={eligibilities.length >= 7}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            data-testid="add-bank-btn"
          >
            <Plus size={16} /> Add Bank
          </button>
        )}
      </div>
      
      {/* Empty State */}
      {eligibilities.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <Building2 size={32} className="mx-auto text-gray-400 mb-2" />
          <p className="text-gray-500">
            {canEdit 
              ? 'No bank eligibilities yet. Click "Add Bank" to start tracking.' 
              : 'No bank eligibilities have been added to this file yet.'}
          </p>
        </div>
      ) : (
        /* Eligibility Cards - Progressive Workflow */
        <div className="space-y-4">
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
      
      {/* Save Button */}
      {canEdit && eligibilities.length > 0 && (
        <button 
          onClick={onSave} 
          disabled={isSaving}
          className="w-full mt-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          data-testid="save-eligibilities-btn"
        >
          {isSaving && <Loader2 size={16} className="animate-spin" />}
          {isSaving ? 'Saving...' : 'Save All Eligibilities'}
        </button>
      )}
    </div>
  );
};

export default EligibilityTracker;
