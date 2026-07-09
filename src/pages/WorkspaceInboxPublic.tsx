import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, Loader2, CheckCircle2, FileText, X } from "lucide-react";
import { useDropzone } from "react-dropzone";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-inbox`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Row = { name: string; size: number; status: "queued" | "up" | "done" | "err"; msg?: string };

export default function WorkspaceInboxPublic() {
  const token = new URLSearchParams(window.location.search).get("t")
    || window.location.pathname.split("/").pop() || "";
  const { toast } = useToast();
  const [folder, setFolder] = useState<{ name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sender, setSender] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const senderRef = useRef(sender); useEffect(() => { senderRef.current = sender; }, [sender]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, { headers: { apikey: ANON } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Link inválido");
        setFolder(j.folder);
      } catch (e: any) { setError(e.message); }
    })();
  }, [token]);

  async function uploadFile(idx: number, file: File) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "up" } : r));
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (senderRef.current.trim()) fd.append("sender", senderRef.current.trim());
      const r = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
        method: "POST", body: fd, headers: { apikey: ANON },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Falha no upload");
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "done" } : r));
    } catch (e: any) {
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "err", msg: e.message } : r));
    }
  }

  const onDrop = (files: File[]) => {
    const start = rows.length;
    setRows(prev => [...prev, ...files.map(f => ({ name: f.name, size: f.size, status: "queued" as const }))]);
    files.forEach((f, i) => uploadFile(start + i, f));
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true });

  if (error) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold">Link inválido ou expirado</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </div>
  );
  if (!folder) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <header className="text-center space-y-2 pt-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-mono uppercase tracking-wider">
            Inbox · Aceleriq
          </div>
          <h1 className="text-2xl font-bold">Envie arquivos para <span className="text-primary">{folder.name}</span></h1>
          <p className="text-sm text-muted-foreground">Solte quantos arquivos quiser. Sem cadastro, sem instalar nada.</p>
        </header>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Seu nome (opcional)</label>
          <Input value={sender} onChange={e => setSender(e.target.value)} placeholder="Ex.: João / Empresa X" className="h-10" />
        </div>

        <div {...getRootProps()} className={`rounded-2xl border-2 border-dashed transition-colors p-10 text-center cursor-pointer ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-card"}`}>
          <input {...getInputProps()} />
          <UploadCloud className="w-10 h-10 mx-auto text-primary mb-3" />
          <p className="text-sm font-medium">{isDragActive ? "Solte para enviar" : "Arraste arquivos ou clique aqui"}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Vídeos, imagens, PDFs, docs — até 500 MB por arquivo</p>
        </div>

        {!!rows.length && (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-[11px] text-muted-foreground">{(r.size/1024/1024).toFixed(1)} MB</span>
                {r.status === "queued" && <span className="text-[11px] text-muted-foreground">na fila</span>}
                {r.status === "up" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                {r.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {r.status === "err" && <span className="text-[11px] text-destructive" title={r.msg}>erro</span>}
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground pt-4">
          Os arquivos aparecem diretamente no Workspace da equipe. Você não precisa avisar por outro canal.
        </p>
      </div>
    </div>
  );
}
