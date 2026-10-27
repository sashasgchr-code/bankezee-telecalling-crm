import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { FileText, Loader2 } from "lucide-react";

// Media is served only through the authorized backend; fetched with the auth header and shown as a blob.
export const MediaView = ({ msgId, part = "media", kind, filename }) => {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let u;
    api.get(`/inbox/messages/${msgId}/media`, { params: { part }, responseType: "blob" })
      .then(({ data }) => { u = URL.createObjectURL(data); setUrl(u); }).catch(() => setErr(true));
    return () => u && URL.revokeObjectURL(u);
  }, [msgId, part]);
  if (err) return <p className="text-xs italic opacity-70" data-testid={`media-unavailable-${msgId}`}>Media unavailable</p>;
  if (!url) return <Loader2 size={16} className="animate-spin opacity-60" />;
  if (kind === "image" || kind === "sticker") return <img src={url} alt="" data-testid={`media-image-${msgId}-${part}`} className="rounded-md max-h-64 w-full object-cover mb-1" />;
  if (kind === "audio") return <audio controls src={url} className="max-w-full" data-testid={`media-audio-${msgId}`} />;
  if (kind === "video") return <video controls src={url} className="rounded-md max-h-64 w-full" data-testid={`media-video-${msgId}`} />;
  return (
    <a href={url} download={filename || "document"} data-testid={`media-doc-${msgId}`} className="flex items-center gap-2 text-sm underline">
      <FileText size={16} /> {filename || "Document"}
    </a>
  );
};
