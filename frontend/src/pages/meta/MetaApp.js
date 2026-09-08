import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import useAuthStore from '../../store/authStore';
import { toast } from 'sonner';
import {
  LayoutDashboard, Users2, FileText, FolderOpen, ArrowLeft, Loader2,
  Phone, Clock, AlertTriangle, X,
} from 'lucide-react';

const CRM_STATUSES = ['NEW', 'CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'];
const META_ROLES = ['admin', 'ops', 'processor', 'growth_partner'];

const StatusBadge = ({ status }) => (
  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
    status === 'FILE' ? 'bg-green-100 text-green-700'
    : status === 'NOT_QUALIFIED' || status === 'NOT_INTERESTED' ? 'bg-red-100 text-red-600'
    : status === 'LEAD' ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-600'}`} data-testid="meta-lead-status-badge">{status || '—'}</span>
);

// ---------------- Dashboard ----------------
const MetaDashboard = () => {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get('/meta/dashboard').then(r => setStats(r.data)).catch(() => {}); }, []);
  if (!stats) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div>;
  const cards = [
    { label: 'Total Meta Leads', value: stats.total_leads, color: 'text-gray-800' },
    { label: 'Files', value: stats.files, color: 'text-green-600' },
    { label: 'Unassigned', value: stats.unassigned, color: 'text-orange-600' },
  ];
  return (
    <div className="p-4" data-testid="meta-dashboard">
      <div className="grid grid-cols-3 gap-3 mb-6">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">By Status</h3>
      <div className="flex flex-wrap gap-2">
        {Object.entries(stats.by_status || {}).map(([k, v]) => (
          <div key={k} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <StatusBadge status={k} /> <span className="ml-1 font-semibold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------- Lead Detail ----------------
const MetaLeadDetail = ({ leadId, onBack, canAssign }) => {
  const [lead, setLead] = useState(null);
  const [partners, setPartners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api.get(`/meta/leads/${leadId}`).then(r => setLead(r.data)).catch(e => {
      toast.error(e.response?.data?.detail || 'Failed to load lead');
    });
  }, [leadId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canAssign) api.get('/meta/partners').then(r => setPartners(r.data)).catch(() => {}); }, [canAssign]);

  const changeStatus = async (status) => {
    setBusy(true);
    try { const r = await api.patch(`/meta/leads/${leadId}/status`, { status }); setLead(r.data); toast.success('Status updated'); }
    catch (e) { toast.error(e.response?.data?.detail || 'Not allowed'); } finally { setBusy(false); }
  };
  const assign = async (partner_id) => {
    setBusy(true);
    try { const r = await api.patch(`/meta/leads/${leadId}/assign`, { partner_id: partner_id || null }); setLead(r.data); toast.success('Assignment updated'); }
    catch (e) { toast.error(e.response?.data?.detail || 'Not allowed'); } finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { const r = await api.post(`/meta/leads/${leadId}/notes`, { text: note.trim() }); setLead(r.data); setNote(''); toast.success('Note added'); }
    catch (e) { toast.error(e.response?.data?.detail || 'Not allowed'); } finally { setBusy(false); }
  };

  if (!lead) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div>;
  const activities = [...(lead.activities || [])].reverse();
  const calls = lead.call_logs || [];

  return (
    <div className="p-4" data-testid="meta-lead-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600 mb-3" data-testid="meta-lead-back">
        <ArrowLeft size={16} /> Back to Leads
      </button>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{lead.full_name || 'Unnamed Lead'}</h2>
          <StatusBadge status={lead.status} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div><span className="text-gray-500">Phone:</span> {lead.phone || '—'}</div>
          <div><span className="text-gray-500">Email:</span> {lead.email || '—'}</div>
          <div><span className="text-gray-500">City:</span> {lead.city || '—'}</div>
          <div><span className="text-gray-500">Partner:</span> {lead.assigned_partner_name || 'Unassigned'}</div>
          <div><span className="text-gray-500">Salary:</span> {lead.monthly_salary || '—'}</div>
          <div><span className="text-gray-500">Loan:</span> {lead.outstanding_amount || '—'}</div>
        </div>
      </div>

      {/* Write workflows */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">Update Status</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {CRM_STATUSES.map(s => (
            <button key={s} disabled={busy} onClick={() => changeStatus(s)}
              className={`px-2.5 py-1 rounded text-xs border ${lead.status === s ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
              data-testid={`meta-status-${s}`}>{s}</button>
          ))}
        </div>
        {canAssign && (
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-700 mb-1">Assign Partner</div>
            <select value={lead.assigned_partner_id || ''} disabled={busy} onChange={(e) => assign(e.target.value)}
              className="h-9 px-3 border border-gray-300 rounded text-sm bg-white w-full" data-testid="meta-assign-select">
              <option value="">Unassigned</option>
              {partners.map(p => <option key={p.user_id} value={p.user_id}>{p.name} ({p.email})</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…"
            className="flex-1 h-9 px-3 border border-gray-300 rounded text-sm" data-testid="meta-note-input" />
          <button onClick={addNote} disabled={busy} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm" data-testid="meta-note-add">Add</button>
        </div>
      </div>

      {calls.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><Phone size={14} /> Call Logs ({calls.length})</div>
          {calls.slice().reverse().map((c, i) => (
            <div key={i} className="text-xs text-gray-600 border-b border-gray-100 py-1.5">
              {c.user_name} · {Math.floor((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s · {c.disposition} · {c.at}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} /> Activity History</div>
        {activities.length === 0 ? <div className="text-xs text-gray-400">No activity yet</div> :
          activities.map((a, i) => (
            <div key={i} className="text-xs text-gray-600 border-b border-gray-100 py-1.5" data-testid="meta-activity-item">
              <span className="font-medium">{a.type}</span> — {a.detail} <span className="text-gray-400">· {a.at}</span>
            </div>
          ))}
      </div>
    </div>
  );
};

// ---------------- Leads ----------------
const MetaLeads = ({ onOpen }) => {
  const [data, setData] = useState({ leads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: '1', page_size: '100' });
    if (status) params.append('status', status);
    if (q) params.append('q', q);
    api.get(`/meta/leads?${params}`).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  return (
    <div className="p-4" data-testid="meta-leads">
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/phone/email…"
          className="flex-1 h-9 px-3 border border-gray-300 rounded text-sm" data-testid="meta-leads-search" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 px-2 border border-gray-300 rounded text-sm bg-white" data-testid="meta-leads-status-filter">
          <option value="">All</option>
          {CRM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="text-xs text-gray-500 mb-2">{data.total} leads</div>
      {loading ? <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div> : (
        <div className="space-y-2">
          {data.leads.map(l => (
            <button key={l.lead_id} onClick={() => onOpen(l.lead_id)}
              className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-green-400"
              data-testid="meta-lead-row">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{l.full_name || 'Unnamed'}</span>
                <StatusBadge status={l.status} />
              </div>
              <div className="text-xs text-gray-500 mt-1">{l.phone || '—'} · {l.city || '—'} · {l.assigned_partner_name || 'Unassigned'}</div>
            </button>
          ))}
          {data.leads.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">No Meta leads</div>}
        </div>
      )}
    </div>
  );
};

// ---------------- Files ----------------
const MetaFiles = () => {
  const [data, setData] = useState({ files: [], total: 0, binary_pending: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/meta/files?page_size=200').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div>;
  return (
    <div className="p-4" data-testid="meta-files">
      <div className="text-xs text-gray-500 mb-3">{data.total} documents · {data.binary_pending} pending binary migration</div>
      <div className="space-y-2">
        {data.files.map(f => (
          <div key={f.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between" data-testid="meta-file-row">
            <div>
              <div className="text-sm font-medium text-gray-800 flex items-center gap-2"><FileText size={14} /> {f.filename}</div>
              <div className="text-xs text-gray-400">{Math.round((f.length || 0))} bytes · {f.uploadDate}</div>
            </div>
            {f.binary_pending ? (
              <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded" data-testid="meta-file-pending">
                <AlertTriangle size={12} /> Document migration pending
              </span>
            ) : <span className="text-xs text-green-600">Available</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------- User Management ----------------
const MetaUserMgmt = () => {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null); // connect user being edited

  const load = useCallback(() => { api.get('/meta/admin/user-management').then(r => setData(r.data)).catch(e => toast.error(e.response?.data?.detail || 'Load failed')); }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.patch(`/meta/admin/users/${edit.id}`, {
        meta_access: !!edit.meta_access,
        meta_role: edit.meta_role || null,
        meta_email: edit.meta_email || null,
        meta_user_id: edit.meta_user_id || null,
      });
      toast.success('Saved');
      setEdit(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
  };

  if (!data) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-green-600" /></div>;
  return (
    <div className="p-4" data-testid="meta-user-mgmt">
      <div className="text-xs text-gray-500 mb-3">Grant Meta access, set role/email, and map to a Meta user.</div>
      <div className="space-y-2">
        {data.connect_users.filter(u => u.meta_access || u.email).map(u => (
          <div key={u.id} className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{u.name} <span className="text-xs text-gray-400">({u.role})</span></div>
                <div className="text-xs text-gray-500">{u.email}</div>
                <div className="text-xs mt-1">
                  Meta: {u.meta_access
                    ? <span className="text-green-600 font-semibold">ON · {u.meta_role || '—'} · {u.meta_email || '—'}</span>
                    : <span className="text-gray-400">OFF</span>}
                </div>
              </div>
              <button onClick={() => setEdit({ ...u })} className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50" data-testid={`meta-user-edit-${u.id}`}>Manage</button>
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="meta-user-modal">
          <div className="bg-white rounded-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">Meta Access — {edit.name}</h3>
              <button onClick={() => setEdit(null)}><X size={18} className="text-gray-500" /></button>
            </div>
            <label className="flex items-center gap-2 mb-3 text-sm">
              <input type="checkbox" checked={!!edit.meta_access} onChange={(e) => setEdit({ ...edit, meta_access: e.target.checked })} data-testid="meta-access-toggle" />
              Meta Access
            </label>
            <label className="block text-xs font-medium text-gray-600 mb-1">Meta Role</label>
            <select value={edit.meta_role || ''} onChange={(e) => setEdit({ ...edit, meta_role: e.target.value })}
              className="w-full h-9 px-3 border border-gray-300 rounded text-sm bg-white mb-3" data-testid="meta-role-select">
              <option value="">—</option>
              {META_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className="block text-xs font-medium text-gray-600 mb-1">Meta Email</label>
            <input value={edit.meta_email || ''} onChange={(e) => setEdit({ ...edit, meta_email: e.target.value })}
              className="w-full h-9 px-3 border border-gray-300 rounded text-sm mb-3" data-testid="meta-email-input" />
            <label className="block text-xs font-medium text-gray-600 mb-1">Linked Meta User</label>
            <select value={edit.meta_user_id || ''} onChange={(e) => setEdit({ ...edit, meta_user_id: e.target.value })}
              className="w-full h-9 px-3 border border-gray-300 rounded text-sm bg-white mb-4" data-testid="meta-user-map-select">
              <option value="">— none —</option>
              {data.meta_users.map(m => (
                <option key={m.user_id} value={m.user_id} disabled={m.linked && m.user_id !== edit.meta_user_id}>
                  {m.name} ({m.email}) · {m.role}{m.linked && m.user_id !== edit.meta_user_id ? ' — already linked' : ''}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="px-4 py-2 text-sm border border-gray-300 rounded">Cancel</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-green-600 text-white rounded" data-testid="meta-user-save">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Shell ----------------
const MetaApp = () => {
  const { user } = useAuthStore();
  const metaRole = (user?.meta_role || '').toLowerCase();
  const isStaff = ['admin', 'ops'].includes(metaRole);
  const isConnectAdmin = user?.role === 'admin';
  const hasMeta = !!user?.meta_access;

  // Connect admins may manage Meta access even without meta_access of their own,
  // but they only get the User Mgmt tab (operational tabs need meta_access).
  const [tab, setTab] = useState(hasMeta ? 'dashboard' : 'users');
  const [openLead, setOpenLead] = useState(null);

  if (!hasMeta && !isConnectAdmin) {
    return <div className="p-8 text-center text-gray-500" data-testid="meta-no-access">You do not have Meta access.</div>;
  }

  const tabs = [
    ...(hasMeta ? [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'leads', label: 'Leads', icon: FileText },
      { id: 'files', label: 'Files', icon: FolderOpen },
    ] : []),
    ...(isConnectAdmin ? [{ id: 'users', label: 'User Mgmt', icon: Users2 }] : []),
  ];

  return (
    <div className="max-w-4xl mx-auto" data-testid="meta-app">
      <div className="bg-white border-b border-gray-200 px-4 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-lg font-bold text-gray-900">Meta CRM</h1>
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{user.meta_role}</span>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setOpenLead(null); }}
              className={`flex items-center gap-1 px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700 font-semibold' : 'border-transparent text-gray-500'}`}
              data-testid={`meta-tab-${t.id}`}>
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'dashboard' && <MetaDashboard />}
      {tab === 'leads' && (openLead
        ? <MetaLeadDetail leadId={openLead} onBack={() => setOpenLead(null)} canAssign={isStaff} />
        : <MetaLeads onOpen={setOpenLead} />)}
      {tab === 'files' && <MetaFiles />}
      {tab === 'users' && isConnectAdmin && <MetaUserMgmt />}
    </div>
  );
};

export default MetaApp;
