import React, { useEffect, useState } from 'react';
import { Trophy, X, Loader2 } from 'lucide-react';
import api from '../services/api';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** A Growth Partner's own earnings (self-scoped via /files/my-earnings). */
const EarningsCard = () => {
  const now = new Date();
  const [filters, setFilters] = useState({ month: now.getMonth() + 1, year: now.getFullYear(), all_time: false });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.all_time) p.set('all_time', 'true');
      else { p.set('month', filters.month); p.set('year', filters.year); }
      const res = await api.get(`/files/my-earnings?${p.toString()}`);
      setData(res.data);
    } catch (e) { /* GP with no files simply shows zeros */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters]);

  const totals = data?.totals || { count: 0, disbursed_amount: 0, commission_amount: 0 };
  const lifetime = data?.lifetime || { commission_amount: 0 };

  return (
    <div className="card p-4" data-testid="gp-earnings-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
            <Trophy size={18} className="text-amber-500" />
          </div>
          <h3 className="font-semibold text-gray-900">Earnings</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" data-testid="earnings-all-time" checked={filters.all_time}
              onChange={(e) => setFilters({ ...filters, all_time: e.target.checked })} />
            All Time
          </label>
          {!filters.all_time && (
            <>
              <select data-testid="earnings-month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: parseInt(e.target.value) })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m.slice(0, 3)}</option>)}
              </select>
              <select data-testid="earnings-year" value={filters.year} onChange={(e) => setFilters({ ...filters, year: parseInt(e.target.value) })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
                {Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 text-amber-500 animate-spin" /></div>
      ) : (
        <button className="w-full text-left" onClick={() => setOpen(true)} data-testid="earnings-open-breakdown">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-700">{filters.all_time ? 'All-time' : `${MONTHS[filters.month - 1].slice(0, 3)} ${filters.year}`} Earnings</p>
              <p className="text-xl font-bold text-amber-600" data-testid="earnings-period-amount">{inr(totals.commission_amount)}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xs text-emerald-700">Lifetime Earnings</p>
              <p className="text-xl font-bold text-emerald-600" data-testid="earnings-lifetime-amount">{inr(lifetime.commission_amount)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2 text-xs text-gray-500">
            <span>Disbursed files: <b className="text-gray-800">{totals.count}</b></span>
            <span>Disbursed amount: <b className="text-gray-800">{inr(totals.disbursed_amount)}</b></span>
          </div>
          <p className="text-xs text-amber-600 mt-2 underline">View breakdown</p>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="earnings-breakdown-modal">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-amber-50">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /> My Earnings Breakdown</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="overflow-auto p-4">
              {(data?.rows || []).length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No disbursed files for this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Customer/File</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Disb. Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Bank</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Disbursed</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">%</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium text-gray-900">{r.customer}</td>
                        <td className="px-3 py-2 text-gray-600">{r.disbursement_date}</td>
                        <td className="px-3 py-2 text-gray-600">{r.disbursed_bank}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{inr(r.disbursed_amount)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{r.commission_percentage}%</td>
                        <td className="px-3 py-2 text-right text-emerald-600 font-medium">{inr(r.commission_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-50">
                    <tr className="font-semibold text-gray-800">
                      <td className="px-3 py-2" colSpan={5}>Total · {totals.count} file(s)</td>
                      <td className="px-3 py-2 text-right text-amber-700">{inr(totals.commission_amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EarningsCard;
