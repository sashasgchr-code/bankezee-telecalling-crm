import React from 'react';
import { Boxes, Layers } from 'lucide-react';

const fmtTime = (seconds) => {
  if (!seconds) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
};

const Tile = ({ label, value, color }) => (
  <div className="text-center">
    <p className="text-xl font-bold" style={{ color }}>{value}</p>
    <p className="text-xs text-gray-500">{label}</p>
  </div>
);

// Combined Totals (Connect + Meta + TL) rendered ON TOP of the Connect tables.
// NOTE: TL->File is the SAME underlying file already counted in Connect (GP owns it), so TL files
// are NOT added to the combined File count; TL contributes calls/connected/talk-time only.
export const CombinedTotalsCard = ({ connect, meta, tl, testid = 'combined-totals' }) => {
  const c = connect || {};
  const m = meta || {};
  const t = tl || {};
  const calls = (c.total_calls || 0) + (m.total_calls || 0) + (t.tl_calls || 0);
  const leads = (c.total_leads_generated || 0) + (m.total_leads_generated || 0);
  const file = (c.total_file || 0) + (m.total_file || 0);
  const talk = (c.total_call_seconds || 0) + (m.total_call_seconds || 0) + (t.talk_seconds || 0);
  const showTalk = talk > 0;
  const hasTl = !!tl;
  return (
    <div className="card p-4 mb-6 border-l-4 border-indigo-500" data-testid={testid}>
      <div className="flex items-center gap-2 mb-4">
        <Layers size={18} className="text-indigo-600" />
        <h3 className="text-lg font-semibold text-gray-900">Combined Totals</h3>
        <span className="text-xs text-gray-400">(Connect + Meta{hasTl ? ' + TL' : ''})</span>
      </div>
      <div className={`grid ${showTalk ? 'grid-cols-4' : 'grid-cols-3'} gap-3`}>
        <Tile label="Total Calls" value={calls} color="#4f46e5" />
        <Tile label="Leads" value={leads} color="#2563eb" />
        <Tile label="File" value={file} color="#ea580c" />
        {showTalk && <Tile label="Talk Time" value={fmtTime(talk)} color="#7c3aed" />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-gray-100 text-xs">
        <span className="text-gray-500">Connect calls: <b className="text-gray-800">{c.total_calls || 0}</b></span>
        <span className="text-gray-500">Meta calls: <b className="text-emerald-700">{m.total_calls || 0}</b></span>
        {hasTl && <span className="text-gray-500">TL calls: <b className="text-indigo-700">{t.tl_calls || 0}</b></span>}
        {hasTl && <span className="text-gray-500">TL files (attr.): <b className="text-indigo-700">{t.files || 0}</b></span>}
        <span className="text-gray-500">Connect files: <b className="text-gray-800">{c.total_file || 0}</b></span>
        <span className="text-gray-500">Meta files: <b className="text-emerald-700">{m.total_file || 0}</b></span>
      </div>
    </div>
  );
};

// Separate TL second-level performance table (rendered UNDER the Connect + Meta tables).
export const TLSummaryTable = ({ data }) => {
  if (!data) return null;
  const o = data.overall || {};
  const tls = data.tls || [];
  const fmtT = (s) => { if (!s) return '0m'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  return (
    <div className="card p-4 mt-6 border-t-4 border-indigo-500" data-testid="tl-summary-section">
      <div className="flex items-center gap-2 mb-4">
        <Layers size={18} className="text-indigo-600" />
        <h3 className="text-lg font-semibold text-gray-900">TL Second-Level Performance</h3>
        <span className="text-xs text-gray-400">(from tl_call_logs only)</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4 p-3 bg-indigo-50/60 rounded-lg">
        <Tile label="TL Calls" value={o.tl_calls || 0} color="#4f46e5" />
        <Tile label="Connected" value={o.connected || 0} color="#7c3aed" />
        <Tile label="Follow-ups" value={o.follow_ups || 0} color="#2563eb" />
        <Tile label="Files (attr.)" value={o.files || 0} color="#ea580c" />
        <Tile label="Talk" value={fmtT(o.talk_seconds)} color="#0f766e" />
        <Tile label="Conv %" value={`${o.conversion_pct || 0}%`} color="#059669" />
      </div>
      {tls.length === 0 ? <p className="text-center text-gray-500 py-3 text-sm">No TL activity in this period</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              {['Team Leader', 'Calls', 'Connected', 'Call Back', 'NA', 'Follow-ups', 'Files', 'Talk', 'Conv %'].map((h) => <th key={h} className="py-2 px-3 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>{tls.map((r) => (
              <tr key={r.tl_id} className="border-b border-gray-100" data-testid={`tl-summary-row-${r.tl_id}`}>
                <td className="py-2 px-3 font-medium text-gray-900">{r.tl_name}</td>
                <td className="py-2 px-3 text-blue-600 font-semibold">{r.tl_calls}</td>
                <td className="py-2 px-3 text-purple-600">{r.connected}</td>
                <td className="py-2 px-3">{r.call_back}</td>
                <td className="py-2 px-3">{r.not_answering}</td>
                <td className="py-2 px-3">{r.follow_ups}</td>
                <td className="py-2 px-3 text-orange-600">{r.files}</td>
                <td className="py-2 px-3">{fmtT(r.talk_seconds)}</td>
                <td className="py-2 px-3 text-emerald-600 font-semibold">{r.conversion_pct}%</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Separate Meta performance table (rendered UNDER the Connect tables).
export const MetaSummaryTable = ({ data }) => {
  if (!data) return null;
  const overall = data.overall || {};
  const partners = data.partners || [];
  return (
    <div className="card p-4 mt-6 border-t-4 border-emerald-500" data-testid="meta-summary-section">
      <div className="flex items-center gap-2 mb-4">
        <Boxes size={18} className="text-emerald-600" />
        <h3 className="text-lg font-semibold text-gray-900">Meta CRM Performance</h3>
        <span className="text-xs text-gray-400">(isolated Meta data)</span>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4 p-3 bg-emerald-50/60 rounded-lg">
        <Tile label="Meta Calls" value={overall.total_calls || 0} color="#059669" />
        <Tile label="Meta Leads" value={overall.total_leads_generated || 0} color="#2563eb" />
        <Tile label="Meta File" value={overall.total_file || 0} color="#ea580c" />
        <Tile label="Meta Talk Time" value={fmtTime(overall.total_call_seconds)} color="#7c3aed" />
      </div>
      {partners.length === 0 ? (
        <p className="text-center text-gray-500 py-4 text-sm">No Meta activity in this period</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-semibold">Growth Partner</th>
                <th className="py-2 px-3 font-semibold text-center">Calls</th>
                <th className="py-2 px-3 font-semibold text-center">Connected</th>
                <th className="py-2 px-3 font-semibold text-center">Leads</th>
                <th className="py-2 px-3 font-semibold text-center">File</th>
                <th className="py-2 px-3 font-semibold text-center">Talk Time</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.user_id} className="border-b border-gray-100" data-testid={`meta-summary-row-${p.user_id}`}>
                  <td className="py-2 pr-3 font-medium text-gray-900">{p.user_name}</td>
                  <td className="py-2 px-3 text-center text-blue-600 font-semibold">{p.total_calls}</td>
                  <td className="py-2 px-3 text-center text-purple-600">{p.total_connected}</td>
                  <td className="py-2 px-3 text-center text-teal-600">{p.leads_generated}</td>
                  <td className="py-2 px-3 text-center text-orange-600">{p.file}</td>
                  <td className="py-2 px-3 text-center text-gray-700">{fmtTime(p.total_call_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Separate Meta hourly table (rendered UNDER the Connect hourly table).
export const MetaHourlyTable = ({ data }) => {
  if (!data) return null;
  const telecallers = data.telecallers || [];
  const allHours = new Set();
  telecallers.forEach((tc) => (tc.hourly_breakdown || []).forEach((hb) => allHours.add(hb.hour)));
  const sortedHours = Array.from(allHours).sort((a, b) => a - b);
  const getHourData = (tc, hour) => (tc.hourly_breakdown || []).find((h) => h.hour === hour) || { calls: 0, connected: 0, leads: 0, file: 0 };

  return (
    <div className="card overflow-hidden mt-6 border-t-4 border-emerald-500" data-testid="meta-hourly-section">
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-3">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Boxes size={18} /> Meta CRM — Hourly Report</h3>
        <p className="text-emerald-100 text-xs mt-1">C = Calls, Co = Connected, L = Leads, F = File · isolated Meta data</p>
      </div>
      {sortedHours.length === 0 ? (
        <p className="text-center text-gray-500 py-6 text-sm">No Meta hourly data available</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th rowSpan={2} className="text-left py-3 px-4 font-bold text-gray-800 border-b-2 border-gray-300 sticky left-0 bg-gray-100 min-w-[120px] z-10">Growth Partner</th>
                {sortedHours.map((hour) => (
                  <th key={hour} colSpan={4} className="text-center py-2 px-1 font-bold text-gray-800 border-b border-l border-gray-300 bg-gray-50">
                    {`${hour.toString().padStart(2, '0')}:00`}
                  </th>
                ))}
                <th colSpan={4} className="text-center py-2 px-1 font-bold text-white bg-emerald-700 border-l border-gray-300">TOTAL</th>
              </tr>
              <tr className="bg-gray-50">
                {sortedHours.map((hour) => (
                  <React.Fragment key={`sub-${hour}`}>
                    <th className="py-2 px-1 text-xs font-semibold text-blue-600 border-l border-gray-200 w-8">C</th>
                    <th className="py-2 px-1 text-xs font-semibold text-purple-600 w-8">Co</th>
                    <th className="py-2 px-1 text-xs font-semibold text-teal-600 w-8">L</th>
                    <th className="py-2 px-1 text-xs font-semibold text-orange-600 w-8">F</th>
                  </React.Fragment>
                ))}
                <th className="py-2 px-1 text-xs font-semibold text-blue-200 bg-emerald-700 border-l border-emerald-500 w-8">C</th>
                <th className="py-2 px-1 text-xs font-semibold text-purple-200 bg-emerald-700 w-8">Co</th>
                <th className="py-2 px-1 text-xs font-semibold text-teal-200 bg-emerald-700 w-8">L</th>
                <th className="py-2 px-1 text-xs font-semibold text-orange-200 bg-emerald-700 w-8">F</th>
              </tr>
            </thead>
            <tbody>
              {telecallers.map((tc, idx) => (
                <tr key={tc.user_id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-emerald-50 transition-colors`}>
                  <td className={`py-3 px-4 font-semibold text-gray-900 sticky left-0 z-10 border-b border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{tc.user_name}</td>
                  {sortedHours.map((hour) => {
                    const d = getHourData(tc, hour);
                    return (
                      <React.Fragment key={`${tc.user_id}-${hour}`}>
                        <td className="py-2 px-1 text-center border-l border-gray-100">{d.calls > 0 ? <span className="inline-block w-7 h-7 leading-7 rounded bg-blue-100 text-blue-700 font-bold text-xs">{d.calls}</span> : <span className="text-gray-300">-</span>}</td>
                        <td className="py-2 px-1 text-center">{d.connected > 0 ? <span className="inline-block w-7 h-7 leading-7 rounded bg-purple-100 text-purple-700 font-bold text-xs">{d.connected}</span> : <span className="text-gray-300">-</span>}</td>
                        <td className="py-2 px-1 text-center">{d.leads > 0 ? <span className="inline-block w-7 h-7 leading-7 rounded bg-teal-100 text-teal-700 font-bold text-xs">{d.leads}</span> : <span className="text-gray-300">-</span>}</td>
                        <td className="py-2 px-1 text-center">{d.file > 0 ? <span className="inline-block w-7 h-7 leading-7 rounded bg-orange-100 text-orange-700 font-bold text-xs">{d.file}</span> : <span className="text-gray-300">-</span>}</td>
                      </React.Fragment>
                    );
                  })}
                  <td className="py-2 px-1 text-center bg-gray-100 border-l border-gray-300"><span className="inline-block w-8 h-7 leading-7 rounded bg-blue-600 text-white font-bold text-xs">{tc.total_calls}</span></td>
                  <td className="py-2 px-1 text-center bg-gray-100"><span className="inline-block w-8 h-7 leading-7 rounded bg-purple-600 text-white font-bold text-xs">{tc.total_connected || 0}</span></td>
                  <td className="py-2 px-1 text-center bg-gray-100"><span className="inline-block w-8 h-7 leading-7 rounded bg-teal-600 text-white font-bold text-xs">{tc.total_leads || 0}</span></td>
                  <td className="py-2 px-1 text-center bg-gray-100"><span className="inline-block w-8 h-7 leading-7 rounded bg-orange-500 text-white font-bold text-xs">{tc.total_file || 0}</span></td>
                </tr>
              ))}
              <tr className="bg-emerald-600 text-white font-bold">
                <td className="py-3 px-4 sticky left-0 bg-emerald-600 z-10">TOTAL</td>
                {sortedHours.map((hour) => {
                  const t = telecallers.reduce((acc, tc) => {
                    const d = getHourData(tc, hour);
                    return { calls: acc.calls + d.calls, connected: acc.connected + (d.connected || 0), leads: acc.leads + d.leads, file: acc.file + d.file };
                  }, { calls: 0, connected: 0, leads: 0, file: 0 });
                  return (
                    <React.Fragment key={`mt-${hour}`}>
                      <td className="py-2 px-1 text-center border-l border-emerald-500 text-blue-200">{t.calls || '-'}</td>
                      <td className="py-2 px-1 text-center text-purple-200">{t.connected || '-'}</td>
                      <td className="py-2 px-1 text-center text-teal-200">{t.leads || '-'}</td>
                      <td className="py-2 px-1 text-center text-orange-200">{t.file || '-'}</td>
                    </React.Fragment>
                  );
                })}
                <td className="py-2 px-1 text-center bg-emerald-700 border-l border-emerald-500">{telecallers.reduce((s, tc) => s + (tc.total_calls || 0), 0)}</td>
                <td className="py-2 px-1 text-center bg-emerald-700">{telecallers.reduce((s, tc) => s + (tc.total_connected || 0), 0)}</td>
                <td className="py-2 px-1 text-center bg-emerald-700">{telecallers.reduce((s, tc) => s + (tc.total_leads || 0), 0)}</td>
                <td className="py-2 px-1 text-center bg-emerald-700">{telecallers.reduce((s, tc) => s + (tc.total_file || 0), 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
