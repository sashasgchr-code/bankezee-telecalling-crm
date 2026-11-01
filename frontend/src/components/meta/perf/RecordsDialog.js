import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../services/api";
import { Loader2, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog";
import { downloadCsv, inr } from "./perfUtils";

// Generic drill-down: lists the exact records behind a count, with CSV export of the same query.
export const RecordsDialog = ({ open, onClose, title, url, params, columns, csvName }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get(url, { params }).then(({ data }) => setRows(data.items || [])).catch(() => setRows([]));
  }, [open, url, params]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="records-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-3 text-base">{title}
          <span className="text-xs font-normal text-slate-500" data-testid="records-count">{rows ? `${rows.length} records` : ""}</span>
          <button data-testid="records-export-btn" onClick={() => downloadCsv(url, params, csvName)} className="ml-auto mr-6 inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1"><Download size={12} />CSV</button>
        </DialogTitle></DialogHeader>
        <div className="overflow-auto flex-1">
          {!rows ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div> : rows.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No records</p> : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr>{columns.map(([k, l]) => <th key={k} className="text-left px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">{l}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.lead_id} className="border-t hover:bg-slate-50 cursor-pointer" data-testid={`record-row-${r.lead_id}`}
                  onClick={() => navigate(r.status === "FILE" || r.stage ? `/meta/files/${r.lead_id}` : `/meta/leads/${r.lead_id}`)}>
                  {columns.map(([k, , money]) => <td key={k} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate">{money ? inr(r[k]) : r[k] ?? "—"}</td>)}
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
