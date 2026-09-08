import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { BRAND, BRAND_DARK } from "./metaCommon";
import { ShieldCheck, Eye, EyeOff, KeyRound, Check, X, Loader2, Clock } from "lucide-react";

const ROLE_STYLES = {
  admin: "bg-blue-50 text-blue-700 border-blue-200",
  ops: "bg-violet-50 text-violet-700 border-violet-200",
  processor: "bg-amber-50 text-amber-700 border-amber-200",
  growth_partner: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function MetaUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState({});
  const [pwModal, setPwModal] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [processors, setProcessors] = useState([]);

  useEffect(() => { api.get("/meta/processors").then(({ data }) => setProcessors(data)).catch(() => {}); }, []);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get("/meta/users", { params: showDeleted ? { include_deleted: true } : {} }); setUsers(data); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to load users"); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showDeleted]);

  const setDefaultProcessor = async (u, processor_id) => {
    setBusyId(u.user_id);
    try { await api.patch(`/meta/users/${u.user_id}/default-processor`, { processor_id: processor_id || null }); toast.success(`Default processor updated for ${u.name}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); } finally { setBusyId(null); }
  };
  const restore = async (u) => {
    setBusyId(u.user_id);
    try { await api.patch(`/meta/users/${u.user_id}/restore`); toast.success(`${u.name} restored`); load(); }
    catch (e) { toast.error("Restore failed"); } finally { setBusyId(null); }
  };
  const setApproval = async (u, approved) => {
    setBusyId(u.user_id);
    try { await api.patch(`/meta/users/${u.user_id}/approve`, { approved }); toast.success(approved ? `${u.name} approved` : `${u.name} revoked`); load(); }
    catch (e) { toast.error("Action failed"); } finally { setBusyId(null); }
  };
  const removeUser = async (u) => {
    if (!window.confirm(`Delete ${u.name}? Their historical data is kept for reports.`)) return;
    setBusyId(u.user_id);
    try { await api.delete(`/meta/users/${u.user_id}`); toast.success(`${u.name} deleted`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); } finally { setBusyId(null); }
  };
  const savePassword = async () => {
    if (newPw.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setSaving(true);
    try { await api.patch(`/meta/users/${pwModal.user_id}/password`, { password: newPw }); toast.success(`Password updated for ${pwModal.name}`); setPwModal(null); setNewPw(""); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); } finally { setSaving(false); }
  };

  const pending = users.filter((u) => u.role === "growth_partner" && !u.approved);

  return (
    <div data-testid="meta-user-mgmt">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center gap-2 sticky top-0 z-30">
        <ShieldCheck size={20} style={{ color: BRAND }} />
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>User Management</h1>
        {pending.length > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5"><Clock size={12} /> {pending.length} pending approval</span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" data-testid="meta-show-deleted-toggle" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </header>

      <div className="p-4 md:p-8">
        <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-slate-50/80 border-b border-slate-200">
                {["User", "Role", "User ID", "Password", "Status", "Default Processor", "Actions"].map((h) => <th key={h} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 px-3 text-left">{h}</th>)}
              </tr></thead>
              <tbody data-testid="meta-users-table-body">
                {loading ? (
                  <tr><td colSpan={7} className="py-16 text-center text-slate-400 text-sm">Loading users...</td></tr>
                ) : users.map((u) => (
                  <tr key={u.user_id} data-testid={`meta-user-row-${u.user_id}`} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="py-2.5 px-3"><p className="text-sm font-medium text-slate-800">{u.name}</p><p className="text-xs text-slate-400">{u.email}</p></td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${ROLE_STYLES[u.role] || ROLE_STYLES.growth_partner}`}>{(u.role || "").replace("_", " ")}</span></td>
                    <td className="py-2.5 px-3"><code className="text-xs text-slate-500">{u.user_id}</code></td>
                    <td className="py-2.5 px-3">
                      {u.visible_password ? (
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-slate-700" data-testid={`meta-pw-${u.user_id}`}>{reveal[u.user_id] ? u.visible_password : "••••••••"}</code>
                          <button data-testid={`meta-reveal-pw-${u.user_id}`} onClick={() => setReveal({ ...reveal, [u.user_id]: !reveal[u.user_id] })} className="text-slate-400 hover:text-slate-700">{reveal[u.user_id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        </div>
                      ) : <span className="text-xs text-slate-400">Google login</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      {["growth_partner", "processor"].includes(u.role) ? (
                        u.approved ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={13} /> Approved</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><Clock size={13} /> Pending</span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      {u.role === "growth_partner" ? (
                        <select data-testid={`meta-default-processor-${u.user_id}`} value={u.default_processor_id || ""} disabled={busyId === u.user_id} onChange={(e) => setDefaultProcessor(u, e.target.value)}
                          className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white outline-none max-w-[150px]">
                          <option value="">None</option>{processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                        </select>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        {["growth_partner", "processor"].includes(u.role) && !u.approved && (
                          <button data-testid={`meta-approve-${u.user_id}`} disabled={busyId === u.user_id} onClick={() => setApproval(u, true)} className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60">
                            {busyId === u.user_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                          </button>
                        )}
                        {["growth_partner", "processor"].includes(u.role) && u.approved && (
                          <button data-testid={`meta-revoke-${u.user_id}`} disabled={busyId === u.user_id} onClick={() => setApproval(u, false)} className="inline-flex items-center gap-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"><X size={12} /> Revoke</button>
                        )}
                        <button data-testid={`meta-change-pw-${u.user_id}`} onClick={() => { setPwModal({ user_id: u.user_id, name: u.name }); setNewPw(""); }} className="inline-flex items-center gap-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"><KeyRound size={12} /> Password</button>
                        {u.role !== "admin" && !u.deleted && (
                          <button data-testid={`meta-delete-user-${u.user_id}`} disabled={busyId === u.user_id} onClick={() => removeUser(u)} className="inline-flex items-center gap-1 border border-red-200 text-red-600 hover:bg-red-50 rounded-md px-2.5 py-1 text-xs font-medium transition-colors">Delete</button>
                        )}
                        {u.deleted && (
                          <button data-testid={`meta-restore-user-${u.user_id}`} disabled={busyId === u.user_id} onClick={() => restore(u)} className="inline-flex items-center gap-1 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-md px-2.5 py-1 text-xs font-medium transition-colors">Restore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {pwModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPwModal(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()} data-testid="meta-password-modal">
            <h3 className="text-lg font-semibold mb-1" style={{ color: BRAND_DARK }}>Set new password</h3>
            <p className="text-sm text-slate-500 mb-4">for <strong>{pwModal.name}</strong></p>
            <input data-testid="meta-new-password-input" type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 6 characters" autoFocus className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPwModal(null)} className="border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-4 py-2 text-sm font-medium transition-colors">Cancel</button>
              <button data-testid="meta-save-password-btn" disabled={saving} onClick={savePassword} className="text-white rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>{saving && <Loader2 size={14} className="animate-spin" />} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
