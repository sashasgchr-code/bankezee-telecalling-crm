import { useEffect, useState } from 'react';
import axios from 'axios';

// SINGLE SOURCE OF TRUTH (client mirror of backend/config/loan_types.py).
// The dropdown is served by GET /api/config/loan-types; this bundled list is the
// offline fallback and MUST stay identical to the backend canonical list.
const BACKEND = process.env.REACT_APP_BACKEND_URL;

export const CATEGORY_LABELS = {
  personal: 'Personal Loans',
  home: 'Home Loans',
  vehicle: 'Vehicle Loans',
  business: 'Business Loans',
  other: 'Other Loans',
};

export const LOAN_TYPES = [
  { value: 'new_personal_loan', label: 'New Personal Loan', category: 'personal', vehicle: false },
  { value: 'balance_transfer_pl', label: 'Balance Transfer PL', category: 'personal', vehicle: false },
  { value: 'top_up_pl', label: 'Top Up PL', category: 'personal', vehicle: false },
  { value: 'balance_transfer_topup_pl', label: 'Balance Transfer + Top Up PL', category: 'personal', vehicle: false },
  { value: 'merge_multiple_loans', label: 'Merge Multiple Loans', category: 'personal', vehicle: false },
  { value: 'new_home_loan', label: 'New Home Loan', category: 'home', vehicle: false },
  { value: 'balance_transfer_hl', label: 'Balance Transfer HL', category: 'home', vehicle: false },
  { value: 'top_up_hl', label: 'Top Up HL', category: 'home', vehicle: false },
  { value: 'balance_transfer_topup_hl', label: 'Balance Transfer + Top Up HL', category: 'home', vehicle: false },
  { value: 'reduce_home_loan_emi', label: 'Reduce Home Loan EMI', category: 'home', vehicle: false },
  { value: 'new_vehicle_loan', label: 'New Vehicle Loan', category: 'vehicle', vehicle: true },
  { value: 'used_vehicle_loan_fresh', label: 'Used Vehicle Loan (Fresh)', category: 'vehicle', vehicle: true },
  { value: 'used_vehicle_loan_bt', label: 'Used Vehicle Loan BT', category: 'vehicle', vehicle: true },
  { value: 'business_loan', label: 'Business Loan', category: 'business', vehicle: false },
  { value: 'msme_loan', label: 'MSME Loan', category: 'business', vehicle: false },
  { value: 'lap', label: 'LAP (Loan Against Property)', category: 'other', vehicle: false },
  { value: 'gold_loan', label: 'Gold Loan', category: 'other', vehicle: false },
  { value: 'education_loan', label: 'Education Loan', category: 'other', vehicle: false },
  { value: 'other', label: 'Other', category: 'other', vehicle: false },
];

export const VEHICLE_LOAN_VALUES = LOAN_TYPES.filter((t) => t.vehicle).map((t) => t.value);
export const isVehicleLoan = (value) => VEHICLE_LOAN_VALUES.includes(value);

let _cache = null;
export async function fetchLoanTypes() {
  if (_cache) return _cache;
  try {
    const { data } = await axios.get(`${BACKEND}/api/config/loan-types`);
    if (data && Array.isArray(data.loan_types) && data.loan_types.length) {
      _cache = data;
      return data;
    }
  } catch (e) {
    // fall through to bundled fallback
  }
  return { loan_types: LOAN_TYPES, category_labels: CATEGORY_LABELS, vehicle_loan_values: VEHICLE_LOAN_VALUES };
}

// React hook: returns the canonical list (backend-driven, bundled fallback) so the
// dropdown can never drift from web/mobile/Meta.
export function useLoanTypes() {
  const [state, setState] = useState({ loanTypes: LOAN_TYPES, categoryLabels: CATEGORY_LABELS });
  useEffect(() => {
    let mounted = true;
    fetchLoanTypes().then((d) => {
      if (mounted && d && Array.isArray(d.loan_types) && d.loan_types.length) {
        setState({ loanTypes: d.loan_types, categoryLabels: d.category_labels || CATEGORY_LABELS });
      }
    });
    return () => { mounted = false; };
  }, []);
  return state;
}
