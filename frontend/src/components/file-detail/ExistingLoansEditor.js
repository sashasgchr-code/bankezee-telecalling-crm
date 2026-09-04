import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export const MAX_EXISTING_LOANS = 5;

const LOAN_TYPES = [
  'Personal Loan', 'Home Loan', 'Car Loan', 'Two Wheeler Loan', 'Education Loan',
  'Business Loan', 'Credit Card', 'Overdraft', 'Loan Against Property', 'Gold Loan', 'Other'
];

const BANKS = [
  'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank', 'IndusInd Bank', 'Yes Bank',
  'IDFC First', 'Bajaj Finance', 'Tata Capital', 'Aditya Birla Finance', 'Fullerton',
  'Poonawalla', 'L&T Finance', 'Piramal', 'Other'
];

const EMPTY_LOAN = { bank: '', loan_type: '', loan_amount: '', sanction_date: '', outstanding: '', roi: '', emi: '' };
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const money = (v) => (num(v) ? `₹${num(v).toLocaleString('en-IN')}` : '-');

const FIELDS = [
  { key: 'bank', label: 'Bank / Lender', type: 'list', options: BANKS, placeholder: 'e.g., Aditya Birla' },
  { key: 'loan_type', label: 'Type of Loan', type: 'select', options: LOAN_TYPES },
  { key: 'loan_amount', label: 'Loan Amount (₹)', type: 'number', placeholder: '500000' },
  { key: 'sanction_date', label: 'Sanction Date', type: 'date' },
  { key: 'outstanding', label: 'Outstanding (₹)', type: 'number', placeholder: '200000' },
  { key: 'roi', label: 'ROI (%)', type: 'number', placeholder: '14.5', step: '0.01' },
  { key: 'emi', label: 'EMI (₹)', type: 'number', placeholder: '12500' },
];

const ExistingLoansEditor = ({ loans = [], legacyLoans = [], isEditing, onChange }) => {
  const rows = Array.isArray(loans) ? loans : [];
  const totalEmi = rows.reduce((s, l) => s + num(l.emi), 0);
  const totalOutstanding = rows.reduce((s, l) => s + num(l.outstanding), 0);

  const setRow = (index, key, value) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    onChange(next);
  };

  return (
    <div data-testid="existing-loans-editor">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          Existing Loans ({rows.length})
          {rows.length > 0 && (
            <span className="ml-2 text-gray-700">
              · Total EMI <span className="font-semibold">{money(totalEmi)}</span>
              · Total Outstanding <span className="font-semibold">{money(totalOutstanding)}</span>
            </span>
          )}
        </p>
        {isEditing && (
          <button
            type="button"
            onClick={() => onChange([...rows, { ...EMPTY_LOAN }])}
            className="flex items-center gap-1 text-sm font-medium text-green-600 hover:text-green-700"
            data-testid="add-existing-loan-btn"
          >
            <Plus size={16} /> Add Loan
          </button>
        )}
      </div>

      {rows.length === 0 && !isEditing && (
        <p className="text-sm text-gray-400 italic">No existing loans recorded</p>
      )}

      {rows.map((loan, index) => (
        <div key={index} className="relative bg-gray-50 border border-gray-100 rounded-lg p-3 mb-3" data-testid={`existing-loan-${index + 1}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-green-700">Loan {index + 1}</span>
            {isEditing && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                className="text-red-500 hover:text-red-600"
                title="Remove loan"
                data-testid={`remove-existing-loan-${index + 1}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label className="text-xs text-gray-500 block mb-1">{field.label}</label>
                {isEditing ? (
                  field.type === 'select' ? (
                    <select
                      value={loan[field.key] || ''}
                      onChange={(e) => setRow(index, field.key, e.target.value)}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      data-testid={`existing-loan-${index + 1}-${field.key}`}
                    >
                      <option value="">Select</option>
                      {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === 'list' ? (
                    <>
                      <input
                        type="text"
                        list={`bank-options-${index}`}
                        value={loan[field.key] || ''}
                        onChange={(e) => setRow(index, field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                        data-testid={`existing-loan-${index + 1}-${field.key}`}
                      />
                      <datalist id={`bank-options-${index}`}>
                        {field.options.map((o) => <option key={o} value={o} />)}
                      </datalist>
                    </>
                  ) : (
                    <input
                      type={field.type}
                      step={field.step}
                      value={loan[field.key] || ''}
                      onChange={(e) => setRow(index, field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                      data-testid={`existing-loan-${index + 1}-${field.key}`}
                    />
                  )
                ) : (
                  <p className="font-medium text-gray-900 text-sm">
                    {field.type === 'number' && field.key !== 'roi'
                      ? money(loan[field.key])
                      : field.key === 'roi'
                        ? (loan.roi ? `${loan.roi}%` : '-')
                        : (loan[field.key] || '-')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {legacyLoans.filter(Boolean).length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3" data-testid="legacy-existing-loans">
          <p className="text-xs text-amber-700 font-medium mb-1">Legacy CRM notes (read-only)</p>
          {legacyLoans.filter(Boolean).map((text, i) => (
            <p key={i} className="text-sm text-gray-700">• {text}</p>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExistingLoansEditor;
