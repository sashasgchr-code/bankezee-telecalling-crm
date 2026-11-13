import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Copy, Eye, Image as ImageIcon } from 'lucide-react';
import api from '../../services/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Btn, Card, PageHead, Select, Empty, errMsg } from './ui';

const useImage = (id, version, enabled) => {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let u; let live = true;
    if (enabled) api.get(`/gp/creatives/${id}/image.png`, { responseType: 'blob' }).then((r) => { u = URL.createObjectURL(r.data); if (live) setSrc(u); }).catch(() => live && setErr('Could not generate this creative'));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, version, enabled]);
  return { src, err };
};

const CreativeCard = ({ c, enabled, onPreview }) => {
  const { src, err } = useImage(c.id, c.version, enabled);
  const download = async () => {
    try {
      const r = await api.get(`/gp/creatives/${c.id}/image.png`, { params: { download: true }, responseType: 'blob' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(r.data); l.download = `Bankezee-${c.name.replace(/[^a-z0-9]+/gi, '-')}.png`;
      document.body.appendChild(l); l.click(); l.remove();
    } catch (e) { toast.error(errMsg(e, 'Download failed')); }
  };
  const copy = () => { navigator.clipboard.writeText(c.link); toast.success('Application link copied'); };
  return (
    <Card className="p-3 flex flex-col" data-testid={`gp-creative-${c.id}`}>
      <button className="aspect-square bg-[#F6F7F5] rounded-xl overflow-hidden flex items-center justify-center" onClick={() => src && onPreview(c, src)} data-testid={`gp-creative-thumb-${c.id}`}>
        {src ? <img src={src} alt={c.name} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-[#6B6F6A]">{err || (enabled ? 'Personalising…' : 'Link unavailable')}</span>}
      </button>
      <p className="font-semibold text-sm mt-2 truncate">{c.name}</p>
      <p className="text-xs text-[#6B6F6A]">{c.loan_label || 'General application'}</p>
      <div className="grid grid-cols-3 gap-1.5 mt-3">
        <Btn variant="outline" className="!px-2 !py-1.5 !text-xs" disabled={!src} data-testid={`gp-creative-preview-${c.id}`} onClick={() => onPreview(c, src)}><Eye className="w-3.5 h-3.5" />Preview</Btn>
        <Btn className="!px-2 !py-1.5 !text-xs" disabled={!src} data-testid={`gp-creative-download-${c.id}`} onClick={download}><Download className="w-3.5 h-3.5" />PNG</Btn>
        <Btn variant="outline" className="!px-2 !py-1.5 !text-xs" disabled={!c.link} data-testid={`gp-creative-copy-${c.id}`} onClick={copy}><Copy className="w-3.5 h-3.5" />Link</Btn>
      </div>
    </Card>
  );
};

export const GpCreatives = () => {
  const [d, setD] = useState(null);
  const [loan, setLoan] = useState('');
  const [pv, setPv] = useState(null);
  useEffect(() => { api.get('/gp/creatives').then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e))); }, []);
  const opts = d ? [...new Map(d.items.map((i) => [i.loan_type || 'general', i.loan_label || 'General application'])).entries()] : [];
  const items = (d?.items || []).filter((i) => !loan || (i.loan_type || 'general') === loan);
  return (
    <>
      <PageHead title="Marketing Creatives" sub="Ready-to-share posters with your own application QR. Every scan opens your application link." />
      {d && !d.link_available && <Card className="p-4 mb-4 border-[#F2D492] bg-[#FFF8E6] text-sm text-[#8A6100]" data-testid="gp-creatives-no-link">{d.message}</Card>}
      {d && d.items.length > 0 && <div className="mb-4"><Select data-testid="gp-creatives-filter" value={loan} onChange={(e) => setLoan(e.target.value)} options={[['', 'All products'], ...opts]} /></div>}
      {d && (items.length ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="gp-creatives-grid">{items.map((c) => <CreativeCard key={c.id} c={c} enabled={d.link_available} onPreview={(cc, src) => setPv({ c: cc, src })} />)}</div>
        : <Card><Empty icon={ImageIcon} title="No creatives yet" text="Bankezee will publish marketing posters here for you to share." /></Card>)}
      {pv && <Dialog open onOpenChange={(o) => !o && setPv(null)}><DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="gp-creative-preview-dialog">
        <DialogHeader><DialogTitle>{pv.c.name}</DialogTitle></DialogHeader>
        <img src={pv.src} alt={pv.c.name} className="w-full rounded-xl border border-[#E6E8E3]" />
        <p className="text-xs text-[#6B6F6A] break-all" data-testid="gp-creative-link">{pv.c.link}</p>
      </DialogContent></Dialog>}
    </>
  );
};
