import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Wand2, PanelBottom, Eye, EyeOff, RefreshCw, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';
import { useLoanTypes } from '../../constants/loanTypes';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Btn, Card, Badge, Field, Input, Select, Empty, errMsg } from '../gp/ui';

const TONE = { draft: 'gray', published: 'green', hidden: 'red' };
const CAP = 0.2;
const useBlob = (url, dep) => {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let u; let live = true;
    if (url) api.get(url, { responseType: 'blob' }).then((r) => { u = URL.createObjectURL(r.data); if (live) setSrc(u); }).catch(() => setSrc(null));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [url, dep]);
  return src;
};
const hit = (p, b) => !(p.x + p.size <= b[0] || b[2] <= p.x || p.y + p.size * (1 + CAP) <= b[1] || b[3] <= p.y);

const PlacementEditor = ({ c, p, setP }) => {
  const src = useBlob(`/gp/admin/creatives/${c.id}/original`, c.version);
  const box = useRef(null);
  const [w, setW] = useState(0);
  const k = w ? w / c.width : 0;
  const drag = (e, resize) => {
    e.preventDefault();
    const sx = e.clientX; const sy = e.clientY; const o = { ...p };
    const move = (ev) => {
      const dx = (ev.clientX - sx) / k; const dy = (ev.clientY - sy) / k;
      if (resize) { const s = Math.max(c.min_qr, Math.min(c.width - o.x, Math.round(o.size + Math.max(dx, dy)))); setP({ ...o, size: s }); }
      else setP({ ...o, x: Math.round(Math.min(Math.max(0, o.x + dx), c.width - o.size)), y: Math.round(Math.min(Math.max(0, o.y + dy), c.height - o.size * (1 + CAP))) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const clashes = p.mode === 'overlay' ? (c.analysis?.occupied || []).filter((o) => hit(p, o.box) && !(p.zone && o.box[0] >= p.zone[0] && o.box[2] <= p.zone[2] && o.box[1] >= p.zone[1] && o.box[3] <= p.zone[3])) : [];
  return (
    <div className="relative select-none bg-[#F6F7F5] rounded-xl overflow-hidden" data-testid="creative-editor-canvas">
      {src && <img ref={box} src={src} alt="" className="w-full block" onLoad={(e) => setW(e.target.clientWidth)} draggable={false} />}
      {k > 0 && clashes.map((o, i) => <div key={i} className="absolute border-2 border-red-500 bg-red-500/20" style={{ left: o.box[0] * k, top: o.box[1] * k, width: (o.box[2] - o.box[0]) * k, height: (o.box[3] - o.box[1]) * k }} data-testid="creative-overlap-box" />)}
      {k > 0 && p.mode === 'overlay' && (
        <div onPointerDown={(e) => drag(e, false)} data-testid="creative-qr-box" className={`absolute cursor-move border-2 ${clashes.length ? 'border-red-600 bg-red-100/70' : 'border-[#2FB34A] bg-white/85'} flex flex-col items-center justify-center text-[10px] font-semibold`}
          style={{ left: p.x * k, top: p.y * k, width: p.size * k, height: p.size * (1 + CAP) * k }}>
          QR<span className="font-normal">Scan to Apply</span>
          <span onPointerDown={(e) => { e.stopPropagation(); drag(e, true); }} className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-[#2FB34A] rounded-sm cursor-se-resize" data-testid="creative-qr-resize" />
        </div>)}
      {p.mode === 'footer' && <div className="absolute inset-x-0 bottom-0 bg-[#2FB34A] text-white text-xs text-center py-1">White QR footer will be added below the artwork</div>}
      {clashes.length > 0 && <p className="absolute top-2 left-2 right-2 text-xs bg-red-600 text-white rounded-lg px-2 py-1" data-testid="creative-overlap-warning">QR overlaps {[...new Set(clashes.map((o) => o.kind))].join(', ')} — move it or use Add QR Footer</p>}
    </div>
  );
};

const Editor = ({ c, onClose, onSaved }) => {
  const { loanTypes } = useLoanTypes();
  const [cur, setCur] = useState(c);
  const [name, setName] = useState(c.name);
  const [loan, setLoan] = useState(c.loan_type || '');
  const [p, setP] = useState(c.placement.mode === 'overlay' ? c.placement : { ...c.placement, x: c.width - Math.max(c.min_qr, 200) - 20, y: c.height - Math.max(c.min_qr, 200) * 1.2 - 20, size: Math.max(c.min_qr, 200) });
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const preview = useBlob(`/gp/admin/creatives/${c.id}/preview.png`, `${tick}-${cur.version}`);
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const { data } = await api.put(`/gp/admin/creatives/${c.id}`, { name, loan_type: loan, placement: p.mode === 'overlay' ? { mode: 'overlay', x: p.x, y: p.y, size: p.size } : { mode: 'footer' }, ...extra });
      setCur(data); if (extra.use_auto || extra.placement) setP(data.placement.mode === 'overlay' ? data.placement : { ...p, mode: 'footer' }); setTick((t) => t + 1); onSaved();
      toast[data.issues.length ? 'warning' : 'success'](data.issues.length ? 'Saved with placement issues' : 'Saved — QR passes the scan check');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const replace = async (file) => {
    const fd = new FormData(); fd.append('file', file); setBusy(true);
    try { await api.post(`/gp/admin/creatives/${c.id}/replace`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); onSaved(); onClose(); toast.success('Image replaced — QR placement is being re-analysed. Open it again to review, then publish.'); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const publish = async () => { const { data } = await api.post('/gp/admin/creatives/publish', { ids: [c.id] }); const r = data.results[0]; r.ok ? toast.success('Published to Growth Partners') : toast.error(r.error); onSaved(); if (r.ok) onClose(); };
  const ok = !cur.issues.length && cur.qr_check?.ok;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="creative-editor">
        <DialogHeader><DialogTitle>Edit creative · v{cur.version}</DialogTitle></DialogHeader>
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <p className="text-xs text-[#6B6F6A]">Drag the QR to move it, drag the green corner to resize (minimum {cur.min_qr}px). Red boxes show content the QR would cover.</p>
            <PlacementEditor c={cur} p={p} setP={setP} />
            <div className="flex flex-wrap gap-2">
              <Btn variant="outline" data-testid="creative-auto" disabled={busy} onClick={() => save({ use_auto: true })}><Wand2 className="w-4 h-4" />Auto place</Btn>
              <Btn variant="outline" data-testid="creative-footer" disabled={busy} onClick={() => { setP({ ...p, mode: 'footer' }); save({ placement: { mode: 'footer' } }); }}><PanelBottom className="w-4 h-4" />Add QR Footer</Btn>
              {p.mode === 'footer' && <Btn variant="outline" data-testid="creative-overlay" onClick={() => setP({ ...p, mode: 'overlay' })}>Place on image</Btn>}
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D9DCD6] text-sm font-semibold cursor-pointer"><RefreshCw className="w-4 h-4" />Replace image
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="creative-replace" onChange={(e) => e.target.files[0] && replace(e.target.files[0])} /></label>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Creative name"><Input data-testid="creative-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Loan product (optional)"><select data-testid="creative-loan" value={loan} onChange={(e) => setLoan(e.target.value)} className="w-full rounded-lg border border-[#D9DCD6] bg-white px-3 py-2.5 text-sm">
              <option value="">General application form</option>{loanTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
            <div className="rounded-xl border border-[#E6E8E3] p-3 text-sm space-y-1" data-testid="creative-checks">
              <p>Placement: <b>{cur.placement.mode === 'footer' ? 'White QR footer' : 'On the artwork'}</b> {cur.auto_placement?.reason && <span className="text-xs text-[#6B6F6A]">· auto: {cur.auto_placement.reason}</span>}</p>
              <p>Export size: <b data-testid="creative-export">{cur.export?.width} × {cur.export?.height}px</b></p>
              <p className="flex items-center gap-1" data-testid="creative-qr-check">{cur.qr_check?.ok ? <CheckCircle2 className="w-4 h-4 text-[#2FB34A]" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}QR scan check {cur.qr_check?.ok ? 'passed (incl. WhatsApp compression)' : 'failed'}</p>
              {cur.analysis?.source !== 'ai' && <p className="text-xs text-[#8A6100]">Layout analysis unavailable — footer used for safety.</p>}
              {cur.issues.map((i) => <p key={i} className="text-xs text-red-700" data-testid="creative-issue">{i}</p>)}
            </div>
            <p className="text-xs font-semibold text-[#55585A]">Preview (exactly what partners download, with a preview QR)</p>
            {preview ? <img src={preview} alt="preview" className="w-full rounded-xl border border-[#E6E8E3]" data-testid="creative-preview" /> : <p className="text-sm">Rendering…</p>}
            <div className="flex justify-end gap-2"><Btn variant="outline" data-testid="creative-save" disabled={busy} onClick={() => save()}>{busy ? 'Checking…' : 'Save draft'}</Btn>
              <Btn data-testid="creative-publish" disabled={busy || !ok} onClick={publish}><Send className="w-4 h-4" />Publish</Btn></div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Tile = ({ c, sel, toggle, onEdit, onHide, onRetry }) => {
  const src = useBlob(c.processing ? null : `/gp/admin/creatives/${c.id}/preview.png`, `${c.version}-${c.updated_at}`);
  return (
    <Card className="p-3 flex flex-col" data-testid={`creative-${c.id}`}>
      <div className="aspect-square bg-[#F6F7F5] rounded-xl overflow-hidden flex items-center justify-center">{c.processing ? <span className="text-xs text-[#6B6F6A] flex items-center gap-1.5" data-testid={`creative-analysing-${c.id}`}><RefreshCw className="w-3.5 h-3.5 animate-spin" />Analysing layout…</span> : src ? <img src={src} alt={c.name} className="max-h-full max-w-full object-contain" /> : <span className="text-xs">Loading…</span>}</div>
      <div className="flex items-center gap-2 mt-2"><input type="checkbox" checked={sel} onChange={toggle} data-testid={`creative-select-${c.id}`} /><p className="font-semibold text-sm truncate mr-auto">{c.name}</p><Badge tone={TONE[c.status]} s={c.status}>{c.status}</Badge></div>
      <p className="text-xs text-[#6B6F6A]">{c.orientation} · {c.loan_label || 'General'} · {c.placement.mode === 'footer' ? 'footer' : 'on artwork'} · v{c.version}{c.pending_republish ? ' (unpublished changes)' : ''}</p>
      {c.issues.length > 0 && <p className="text-xs text-red-700 mt-1" data-testid={`creative-issues-${c.id}`}>{c.issues[0]}</p>}
      <div className="flex gap-2 mt-auto pt-2">{c.processing_error ? <Btn variant="outline" className="!py-1 flex-1" data-testid={`creative-retry-${c.id}`} onClick={onRetry}>Retry analysis</Btn> : <Btn variant="outline" className="!py-1 flex-1" disabled={!!c.processing} data-testid={`creative-edit-${c.id}`} onClick={onEdit}>Edit</Btn>}
        {c.status !== 'hidden' && <Btn variant="outline" className="!py-1" data-testid={`creative-hide-${c.id}`} onClick={onHide}><EyeOff className="w-4 h-4" /></Btn>}</div>
    </Card>
  );
};

export const AdminCreatives = () => {
  const { loanTypes } = useLoanTypes();
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState([]);
  const [edit, setEdit] = useState(null);
  const [loan, setLoan] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/gp/admin/creatives').then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []);
  const analysing = (rows || []).some((c) => c.processing);
  useEffect(() => { if (!analysing) return undefined; const t = setInterval(load, 4000); return () => clearInterval(t); }, [analysing]);
  const upload = async (files) => {
    if (!files.length) return;
    const fd = new FormData(); [...files].forEach((f) => fd.append('files', f)); if (loan) fd.append('loan_type', loan);
    setBusy(true);
    try {
      const { data } = await api.post('/gp/admin/creatives', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const bad = data.results.filter((r) => r.error); const fine = data.results.filter((r) => !r.error);
      bad.forEach((r) => toast.error(`${r.file}: ${r.error}`));
      if (fine.length) toast.success(`${fine.length} image(s) uploaded — QR placement is being analysed, previews appear in a few seconds`);
      setSel(fine.map((r) => r.id)); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const publish = async () => {
    const { data } = await api.post('/gp/admin/creatives/publish', { ids: sel });
    const ok = data.results.filter((r) => r.ok).length; const bad = data.results.filter((r) => !r.ok);
    if (ok) toast.success(`${ok} published`); bad.forEach((r) => toast.error(`${rows.find((c) => c.id === r.id)?.name}: ${r.error}`));
    setSel(bad.map((r) => r.id)); load();
  };
  const hide = async (c) => { await api.post(`/gp/admin/creatives/${c.id}/hide`); toast.success('Hidden from partners'); load(); };
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3" data-testid="creatives-upload">
        <Field label="Loan product for this upload (optional)"><select value={loan} onChange={(e) => setLoan(e.target.value)} data-testid="creatives-upload-loan" className="rounded-lg border border-[#D9DCD6] bg-white px-3 py-2.5 text-sm">
          <option value="">General application form</option>{loanTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <label className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2FB34A] text-white text-sm font-semibold cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          <Upload className="w-4 h-4" />{busy ? 'Uploading…' : 'Upload images'}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="creatives-upload-input" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
        <p className="text-xs text-[#6B6F6A] mr-auto">PNG, JPG or WebP · square, portrait or landscape · QR is placed automatically</p>
        <Btn data-testid="creatives-publish-selected" disabled={!sel.length} onClick={publish}><Send className="w-4 h-4" />Publish selected ({sel.length})</Btn>
      </Card>
      {rows && (rows.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{rows.map((c) => <Tile key={c.id} c={c} sel={sel.includes(c.id)} toggle={() => setSel(sel.includes(c.id) ? sel.filter((i) => i !== c.id) : [...sel, c.id])} onEdit={() => setEdit(c)} onHide={() => hide(c)} onRetry={() => api.post(`/gp/admin/creatives/${c.id}/reanalyse`).then(load)} />)}</div>
        : <Card><Empty icon={Eye} title="No creatives yet" text="Upload your first marketing images. Each partner downloads them with their own QR." /></Card>)}
      {edit && <Editor c={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
};
