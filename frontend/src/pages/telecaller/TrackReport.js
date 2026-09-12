import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import api from '../../services/api';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function TrackReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No user_id sent - backend self-scopes to the authenticated Growth Partner.
      const { data } = await api.get(`/reports/daily-tracking-sheet?month=${month}&year=${year}`);
      setSheet(Array.isArray(data) && data.length ? data[0] : null);
    } catch (e) { setSheet(null); } finally { setLoading(false); }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); };
  const isCurrent = month === (now.getMonth() + 1) && year === now.getFullYear();

  const t = sheet?.totals || {};
  const rows = sheet?.daily_data || [];

  return (
    <div className="p-4 max-w-5xl mx-auto pb-24" data-testid="gp-track-report">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="text-indigo-600" size={22} />
        <h1 className="text-xl font-bold text-gray-900">Track Report</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs text-gray-500">Growth Partner</p>
            <p className="text-base font-semibold text-gray-900" data-testid="gp-track-name">{sheet?.user_name || '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" data-testid="gp-track-prev"><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold text-gray-800 min-w-[130px] text-center" data-testid="gp-track-month">{MONTHS[month-1]} {year}</span>
            <button onClick={nextMonth} disabled={isCurrent} className="p-2 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50" data-testid="gp-track-next"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="File Goal" value={sheet?.file_goal ?? '—'} />
          <Stat label="Achieved" value={sheet?.achieved_files ?? 0} accent="text-orange-600" />
          <Stat label="Total Calls" value={t.calls ?? 0} accent="text-blue-600" />
          <Stat label="Talk Time" value={t.talk_time_formatted ?? '0m'} accent="text-purple-600" />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-10">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-gray-400 py-10" data-testid="gp-track-empty">No activity for {MONTHS[month-1]} {year}</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {['Date','Day','Start','End','Calls','Connected','Leads','Files','Talk Time'].map(h => (
                    <th key={h} className="py-2 px-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody data-testid="gp-track-table-body">
                {rows.map((d, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap">{d.date}</td>
                    <td className="py-2 px-3">{d.day}</td>
                    <td className="py-2 px-3">{d.start_time}</td>
                    <td className="py-2 px-3">{d.end_time}</td>
                    <td className="py-2 px-3 text-blue-600">{d.calls}</td>
                    <td className="py-2 px-3 text-green-600">{d.connected}</td>
                    <td className="py-2 px-3 text-purple-600">{d.leads}</td>
                    <td className="py-2 px-3 text-orange-600">{d.files}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{d.talk_time_formatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((d, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-3" data-testid={`gp-track-card-${i}`}>
                <div className="font-semibold text-gray-900 mb-2">{d.date} · {d.day}</div>
                <div className="grid grid-cols-2 gap-y-1 text-sm">
                  <Row k="Start" v={d.start_time} /><Row k="End" v={d.end_time} />
                  <Row k="Calls" v={d.calls} /><Row k="Connected" v={d.connected} />
                  <Row k="Leads" v={d.leads} /><Row k="Files" v={d.files} />
                  <Row k="Talk Time" v={d.talk_time_formatted} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent = 'text-gray-900' }) => (
  <div className="bg-gray-50 rounded-lg p-3">
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`text-lg font-bold ${accent}`}>{value}</p>
  </div>
);
const Row = ({ k, v }) => (
  <><span className="text-gray-500">{k}</span><span className="text-gray-900 font-medium text-right">{v}</span></>
);
