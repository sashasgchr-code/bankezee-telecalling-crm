import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import { AuthShell } from './GpAuth';
import { FileForm, FileSuccess } from './FileForm';

export default function PublicRefer() {
  const { code } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  const [res, setRes] = useState(null);
  useEffect(() => { api.get(`/gp/public/partner/${code}`).then(({ data }) => setP(data)).catch(() => setErr('This application link is not valid.')); }, [code]);
  return (
    <AuthShell>
      {err ? <p className="text-sm text-[#A12B2B]" data-testid="refer-invalid">{err}</p> : !p ? <p className="text-sm">Loading…</p> : res ? (
        <div data-testid="refer-done"><FileSuccess res={res} /><p className="text-sm text-center text-[#6B6F6A]">A Bankezee loan expert will call you shortly. Please keep your File ID for reference.</p></div>
      ) : (
        <>
          <h1 className="text-3xl font-bold">Apply for a loan</h1>
          <p className="text-sm text-[#6B6F6A] mt-1 mb-6">Shared by Bankezee Growth Partner {p.display_name} ({p.partner_id})</p>
          <FileForm customer endpoint={`/gp/public/refer/${code}`} uploadUrl={(d, cat) => `/gp/public/files/${d.file_id}/documents?token=${d.upload_token}&category=${cat}`} onDone={setRes} />
        </>
      )}
    </AuthShell>
  );
}
