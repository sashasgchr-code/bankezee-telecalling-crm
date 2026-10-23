import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const GROUP_TYPES = [
  'Personal Loan', 'Home Loan', 'Car Loan', 'Two-Wheeler Loan', 'Business Loan',
  'Loan Against Property', 'Education Loan', 'Gold Loan', 'Credit Card Outstanding',
  'Consumer Durable Loan', 'Overdraft', 'Other',
];

const TYPE_LABELS = {
  personal_loan: 'Personal Loan', home_loan: 'Home Loan', car_loan: 'Car Loan',
  two_wheeler_loan: 'Two-Wheeler Loan', business_loan: 'Business Loan', lap: 'Loan Against Property',
  education_loan: 'Education Loan', gold_loan: 'Gold Loan', credit_card: 'Credit Card Outstanding',
  consumer_durable_loan: 'Consumer Durable Loan', overdraft: 'Overdraft', other: 'Other',
};

const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
const inr = (v) => `₹${num(v).toLocaleString('en-IN')}`;

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const labelFor = (g) => g.label || TYPE_LABELS[g.loan_type] || (g.loan_type ? titleCase(g.loan_type) : 'Other');

// Derive grouped totals from legacy individual loan records so existing files still show a table.
const deriveGroups = (loans = []) => {
  const map = {};
  (loans || []).forEach((l) => {
    const key = l.loan_type || l.type || 'other';
    if (!map[key]) map[key] = { loan_type: key, label: TYPE_LABELS[key] || titleCase(key) || 'Other', count: 0, total_outstanding: 0, total_emi: 0 };
    map[key].count += num(l.count || l.number_of_loans || 1);
    map[key].total_outstanding += num(l.outstanding);
    map[key].total_emi += num(l.emi);
  });
  return Object.values(map);
};

const GroupedLoansSection = ({ groups = [], existingLoans = [], pendingCreditReport = false, isEditing, onChange }) => {
  const [showRecords, setShowRecords] = useState(false);
  const rows = Array.isArray(groups) && groups.length > 0
    ? groups
    : deriveGroups(existingLoans);

  const totals = rows.reduce(
    (acc, g) => ({
      count: acc.count + num(g.count),
      outstanding: acc.outstanding + num(g.total_outstanding),
      emi: acc.emi + num(g.total_emi),
    }),
    { count: 0, outstanding: 0, emi: 0 }
  );

  const setRow = (index, key, value) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [key]: value } : r));
    onChange(next);
  };
  const addRow = () => onChange([...rows, { loan_type: '', label: '', count: 1, total_outstanding: '', total_emi: '' }]);
  const removeRow = (index) => onChange(rows.filter((_, i) => i !== index));

  const showPending = pendingCreditReport && rows.length === 0;

  return (
    <div data-testid="grouped-loans-section">
      {showPending ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700" data-testid="loans-pending-credit-report">
          Pending verification from credit report
        </div>
      ) : rows.length === 0 && !isEditing ? (
        <p className="text-sm text-gray-400 italic" data-testid="grouped-loans-empty">No existing loans recorded</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm" data-testid="grouped-loans-table">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="text-left font-medium px-3 py-2">Loan Type</th>
                <th className="text-right font-medium px-3 py-2">Count</th>
                <th className="text-right font-medium px-3 py-2">Total Outstanding</th>
                <th className="text-right font-medium px-3 py-2">Monthly EMI</th>
                {isEditing && <th className="px-3 py-2 w-10" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((g, index) => (
                <tr key={index} className="border-t border-gray-100" data-testid={`grouped-loan-row-${index}`}>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <select
                        value={labelFor(g)}
                        onChange={(e) => setRow(index, 'label', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
                        data-testid={`grouped-loan-type-${index}`}
                      >
                        <option value="">Select</option>
                        {GROUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span className="font-medium text-gray-900">{labelFor(g)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <input type="number" min="1" value={g.count ?? ''} onChange={(e) => setRow(index, 'count', e.target.value)}
                        className="w-20 px-2 py-1.5 border border-gray-200 rounded-md text-sm text-right" data-testid={`grouped-loan-count-${index}`} />
                    ) : (num(g.count) || '-')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <input type="number" value={g.total_outstanding ?? ''} onChange={(e) => setRow(index, 'total_outstanding', e.target.value)}
                        className="w-28 px-2 py-1.5 border border-gray-200 rounded-md text-sm text-right" data-testid={`grouped-loan-outstanding-${index}`} />
                    ) : inr(g.total_outstanding)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <input type="number" value={g.total_emi ?? ''} onChange={(e) => setRow(index, 'total_emi', e.target.value)}
                        className="w-28 px-2 py-1.5 border border-gray-200 rounded-md text-sm text-right" data-testid={`grouped-loan-emi-${index}`} />
                    ) : inr(g.total_emi)}
                  </td>
                  {isEditing && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => removeRow(index)} className="text-red-500 hover:text-red-600" data-testid={`grouped-loan-remove-${index}`}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <td className="px-3 py-2" data-testid="grouped-loans-total-label">TOTAL</td>
                <td className="px-3 py-2 text-right" data-testid="grouped-loans-total-count">{totals.count}</td>
                <td className="px-3 py-2 text-right" data-testid="grouped-loans-total-outstanding">{inr(totals.outstanding)}</td>
                <td className="px-3 py-2 text-right" data-testid="grouped-loans-total-emi">{inr(totals.emi)}</td>
                {isEditing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {isEditing && (
        <button type="button" onClick={addRow} className="mt-3 flex items-center gap-1 text-sm font-medium text-green-600 hover:text-green-700" data-testid="grouped-loan-add-btn">
          <Plus size={16} /> Add Another Loan Type
        </button>
      )}

      {/* Preserved individual loan records (historical, read-only) */}
      {existingLoans.filter(Boolean).length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowRecords((v) => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700" data-testid="grouped-loans-records-toggle">
            {showRecords ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Detailed loan records ({existingLoans.filter(Boolean).length}) — preserved
          </button>
          {showRecords && (
            <div className="mt-2 space-y-1" data-testid="grouped-loans-records">
              {existingLoans.filter(Boolean).map((l, i) => (
                <p key={i} className="text-xs text-gray-600">
                  • {TYPE_LABELS[l.loan_type || l.type] || titleCase(l.loan_type || l.type) || 'Loan'} · {l.bank || '-'} · Outstanding {inr(l.outstanding)} · EMI {inr(l.emi)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GroupedLoansSection;
