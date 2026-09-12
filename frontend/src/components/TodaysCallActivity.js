import React, { useState, useEffect } from 'react';
import { PhoneOutgoing, PhoneIncoming, Clock, PhoneCall } from 'lucide-react';
import api from '../services/api';

/**
 * Today's Call Activity — reuses the SAME source as the Dashboard "Today's Activity"
 * (GET /dashboard/stats?period=today). No second calculation engine: values reconcile
 * with the Dashboard for the same authenticated user. Role scoping is inherited from the
 * dashboard-stats endpoint (GP sees own; TL/Manager/Admin/Ops keep their permitted scope).
 */
const fmtTime = (seconds) => {
  const s = Number(seconds || 0);
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const TodaysCallActivity = () => {
  const [stats, setStats] = useState(null);
  const isHr = JSON.parse(localStorage.getItem('user') || '{}').role === 'hr';

  useEffect(() => {
    if (isHr) return;
    api.get('/dashboard/stats?period=today')
      .then((res) => setStats(res.data))
      .catch(() => {});
  }, [isHr]);

  if (isHr) return null;

  const co = stats?.call_outcomes;
  const outgoing = co
    ? (co.connected || 0) + (co.not_connecting || 0) + (co.no_answer || 0) +
      (co.busy || 0) + (co.wrong_number || 0) + (co.voicemail || 0)
    : (stats?.outgoing_calls?.count ?? stats?.calls ?? 0);
  const incoming = stats?.incoming_calls?.count || 0;
  const incomingTime = stats?.incoming_calls?.total_time_seconds || 0;
  const outgoingTalk = stats?.daily_session?.total_call_seconds ?? stats?.outgoing_calls?.total_time_seconds ?? 0;
  const totalTalk = outgoingTalk + incomingTime;

  const cards = [
    { key: 'outgoing', label: 'Outgoing', value: outgoing, icon: PhoneOutgoing, color: '#16a34a', bg: 'bg-green-50' },
    { key: 'incoming', label: 'Incoming', value: incoming, icon: PhoneIncoming, color: '#2563eb', bg: 'bg-blue-50' },
    { key: 'total-talk', label: 'Total Talk', value: fmtTime(totalTalk), icon: Clock, color: '#7c3aed', bg: 'bg-purple-50' },
    { key: 'incoming-time', label: 'Incoming Time', value: fmtTime(incomingTime), icon: PhoneCall, color: '#ea580c', bg: 'bg-orange-50' },
  ];

  return (
    <div className="card p-4 mb-5" data-testid="todays-call-activity">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <PhoneCall size={16} className="text-green-600" /> Today's Call Activity
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className={`${c.bg} rounded-lg p-3 text-center`} data-testid={`tca-${c.key}`}>
              <div className="flex items-center justify-center gap-1 mb-1">
                <Icon size={16} style={{ color: c.color }} />
                <span className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</span>
              </div>
              <p className="text-xs text-gray-600">{c.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TodaysCallActivity;
