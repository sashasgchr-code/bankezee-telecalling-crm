import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { FolderOpen, Plus, ArrowLeft, Upload, CheckCircle2, Circle } from 'lucide-react';
import api from '../../services/api';
import { Btn, Card, Badge, PageHead, Tabs, Empty, RTable, Input, Select, errMsg } from './ui';
import { FileForm, FileSuccess, statusTone } from './FileForm';
import { ShareTools } from './GpPortal';

export const StatusBadge = ({ s }) => <Badge tone={statusTone(s)} s={s?.label}>{s?.label}</Badge>;

const MyFiles = ({ onAdd }) => {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const load = () => api.get('/gp/files', { params: { search, status } }).then(({ data }) => setD(data));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card className="p-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <Input data-testid="files-search" className="!w-64" placeholder="Search name, mobile or File ID" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <Select data-testid="files-status" value={status} onChange={(e) => setStatus(e.target.value)} options={[['', 'All statuses'], ...(d?.counts || []).map((c) => [c.code, `${c.label} (${c.count})`])]} />
      </div>
      {d && (d.rows.length ? <RTable testid="files-table" rows={d.rows} cols={[['name', 'Customer', (r) => <button className="text-left font-semibold text-[#1F7A33] hover:underline" data-testid={`files-open-${r.id}`} onClick={() => nav(`/gp/files/${r.id}`)}>{r.name}</button>],
        ['id', 'File ID', (r) => <span className="text-xs font-mono">{r.id.slice(0, 8)}</span>], ['phone', 'Mobile'], ['loan_type', 'Loan type'], ['employment', 'Employment'],
        ['status', 'Status', (r) => <StatusBadge s={r.status} />], ['added', 'Submitted'], ['updated', 'Last update'], ['via', 'Source']]} />
        : <Empty icon={FolderOpen} title="No files yet" text="Add your first loan file or share your application link." action={<Btn onClick={onAdd}>Add New File</Btn>} />)}
    </Card>
  );
};

export const GpFiles = () => {
  const { me } = useOutletContext();
  const nav = useNavigate();
  const q = new URLSearchParams(useLocation().search);
  const [tab, setTab] = useState(q.get('share') ? 'share' : q.get('add') ? 'add' : 'list');
  const [res, setRes] = useState(null);
  return (
    <>
      <PageHead title="Files" sub="Loan files you submitted and their current CRM status." actions={<Btn data-testid="files-add" onClick={() => { setRes(null); setTab('add'); }}><Plus className="w-4 h-4" />Add New File</Btn>} />
      <Tabs tabs={[['list', 'My Files'], ['add', 'Add New File'], ['share', 'Share application link / QR']]} value={tab} onChange={setTab} />
      {tab === 'list' && <MyFiles onAdd={() => setTab('add')} />}
      {tab === 'add' && <Card className="p-5">{res ? <FileSuccess res={res} onOpen={() => nav(`/gp/files/${res.file_id}`)} onAnother={() => setRes(null)} />
        : <FileForm endpoint="/gp/files" uploadUrl={(d, cat) => `/gp/files/${d.file_id}/documents?category=${cat}`} onDone={setRes} />}</Card>}
      {tab === 'share' && <Card className="p-5"><ShareTools code={me.partner_id} /></Card>}
    </>
  );
};

const AddDocs = ({ f, onDone }) => {
  const [cat, setCat] = useState(f.checklist.find((c) => !c.uploaded)?.category || 'general');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const up = async () => {
    if (!file) return toast.error('Choose a document');
    const fd = new FormData(); fd.append('files', file);
    setBusy(true);
    try { await api.post(`/gp/files/${f.id}/documents?category=${cat}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast.success('Document added to the file'); setFile(null); onDone(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap gap-2 items-center mt-4" data-testid="file-add-docs">
      <Select data-testid="file-add-doc-type" value={cat} onChange={(e) => setCat(e.target.value)} options={[...f.checklist.map((c) => [c.category, c.label]), ['general', 'Other document']]} />
      <input type="file" accept=".pdf,image/*" className="text-xs" data-testid="file-add-doc-input" onChange={(e) => setFile(e.target.files[0])} />
      <Btn data-testid="file-add-doc-upload" disabled={busy} onClick={up}><Upload className="w-4 h-4" />{busy ? 'Uploading…' : 'Upload'}</Btn>
    </div>
  );
};

export const GpFileDetail = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get(`/gp/files/${id}`).then(({ data }) => setF(data)).catch((e) => setErr(errMsg(e, 'File not found')));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Card><Empty icon={FolderOpen} title={err} action={<Btn onClick={() => nav('/gp/files')}>Back to My Files</Btn>} /></Card>;
  if (!f) return <p className="text-sm text-[#6B6F6A]">Loading…</p>;
  const info = [['File ID', f.id], ['Mobile', f.phone], ['Loan type', f.loan_type], ['Employment', f.employment], ['City', f.city], ['Requested amount', f.loan_amount_required ? `₹${Number(f.loan_amount_required).toLocaleString('en-IN')}` : null], ['Company / business', f.company_name], ['Submitted', f.added], ['Source', f.via]];
  return (
    <>
      <button className="text-sm text-[#1F7A33] inline-flex items-center gap-1 mb-3" data-testid="file-back" onClick={() => nav('/gp/files')}><ArrowLeft className="w-4 h-4" />My Files</button>
      <PageHead title={f.name} sub={<>Loan File · <StatusBadge s={f.status} /></>} />
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-5 lg:col-span-2" data-testid="file-info"><dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">{info.map(([k, v]) => <div key={k}><dt className="text-xs text-[#6B6F6A]">{k}</dt><dd className="font-medium break-all" data-testid={`file-info-${k.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{v || '—'}</dd></div>)}</dl></Card>
        <Card className="p-5" data-testid="file-history"><p className="text-sm font-semibold mb-3">Status history</p>
          {f.history.map((h, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-t border-[#F0F1EE] first:border-0"><span>{h.label}</span><span className="text-xs text-[#6B6F6A]">{String(h.at || '').slice(0, 16).replace('T', ' ')}</span></div>)}</Card>
        <Card className="p-5 lg:col-span-3" data-testid="file-documents"><p className="text-sm font-semibold mb-3">Documents</p>
          <div className="grid sm:grid-cols-2 gap-2">{f.checklist.map((c) => <div key={c.category} className="flex items-center gap-2 text-sm" data-testid={`file-check-${c.category}`}>{c.uploaded ? <CheckCircle2 className="w-4 h-4 text-[#2FB34A]" /> : <Circle className="w-4 h-4 text-[#C9CCC6]" />}{c.label}{!c.uploaded && <span className="text-xs text-[#8A6100]">Missing</span>}</div>)}</div>
          {f.documents.length > 0 && <div className="mt-4 text-xs text-[#55585A] space-y-1">{f.documents.map((d, i) => <p key={i}>{d.name} · {d.category.replace('_', ' ')} · {String(d.uploaded_at || '').slice(0, 10)}</p>)}</div>}
          <AddDocs f={f} onDone={load} /></Card>
      </div>
    </>
  );
};
