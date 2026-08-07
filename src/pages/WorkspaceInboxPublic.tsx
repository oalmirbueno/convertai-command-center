import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { UploadCloud, Loader2, CheckCircle2, FileText, AlertCircle } from "lucide-react";


const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-inbox`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Usage = { files_24h: number; bytes_24h: number; uploads_1m: number };
type Limits = {
  max_file_bytes: number;
  max_files_per_24h: number;
  max_bytes_per_24h: number;
  max_uploads_per_minute: number;
};
type InboxInfo = {
  folder: { name: string };
  expires_at: string;
  limits: Limits;
  usage: Usage;
};
type Row = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "up" | "done" | "err";
  msg?: string;
};

const MAX_BATCH_FILES = 10;

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function WorkspaceInboxPublic() {
  const token = new URLSearchParams(window.location.search).get("t")
    || window.location.pathname.split("/").pop() || "";
  const [info, setInfo] = useState<InboxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sender, setSender] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isDragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const senderRef = useRef(sender); useEffect(() => { senderRef.current = sender; }, [sender]);
  const isUploading = rows.some((row) => row.status === "queued" || row.status === "up");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const r = await fetch(FN_URL, {
          headers: { apikey: ANON, "x-inbox-token": token },
          signal: controller.signal,
          referrerPolicy: "no-referrer",
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Link inválido");
        setInfo(j);
      } catch (e: unknown) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(errorMessage(e, "Link inválido"));
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function uploadFile(rowId: string, requestId: string, file: File) {
    setRows(prev => prev.map((row) => row.id === rowId ? { ...row, status: "up" } : row));
    try {
      const r = await fetch(FN_URL, {
        method: "POST",
        body: file,
        headers: {
          apikey: ANON,
          "content-type": file.type || "application/octet-stream",
          "x-inbox-token": token,
          "x-inbox-request-id": requestId,
          "x-inbox-file-name": encodeURIComponent(file.name),
          "x-inbox-sender": encodeURIComponent(senderRef.current.trim()),
        },
        referrerPolicy: "no-referrer",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Falha no upload");
      if (j.usage) setInfo((current) => current ? { ...current, usage: j.usage } : current);
      setRows(prev => prev.map((row) => row.id === rowId ? { ...row, status: "done" } : row));
    } catch (e: unknown) {
      setRows(prev => prev.map((row) => row.id === rowId
        ? { ...row, status: "err", msg: errorMessage(e, "Falha no upload") }
        : row));
    }
  }

  async function onFiles(list: FileList | File[] | null) {
    if (!list || !info || isUploading) return;
    const files = Array.from(list);
    if (!files.length) return;

    let remainingFiles = Math.max(0, info.limits.max_files_per_24h - info.usage.files_24h);
    let remainingBytes = Math.max(0, info.limits.max_bytes_per_24h - info.usage.bytes_24h);
    let remainingRate = Math.max(0, info.limits.max_uploads_per_minute - info.usage.uploads_1m);
    let acceptedInBatch = 0;
    const accepted: Array<{ file: File; row: Row; requestId: string }> = [];
    const nextRows: Row[] = [];

    for (const file of files) {
      const id = crypto.randomUUID();
      const base: Row = { id, name: file.name, size: file.size, status: "queued" };
      let msg: string | null = null;

      if (file.size <= 0) msg = "O arquivo está vazio.";
      else if (file.size > info.limits.max_file_bytes) {
        msg = `Máximo de ${formatMb(info.limits.max_file_bytes)} por arquivo.`;
      }
      else if (acceptedInBatch >= MAX_BATCH_FILES) msg = "Selecione no máximo 10 arquivos por lote.";
      else if (remainingRate <= 0) msg = "Aguarde um minuto antes de enviar mais arquivos.";
      else if (remainingFiles <= 0 || file.size > remainingBytes) msg = "A cota das últimas 24 horas foi atingida.";

      if (msg) {
        nextRows.push({ ...base, status: "err", msg });
        continue;
      }

      const requestId = crypto.randomUUID();
      accepted.push({ file, requestId, row: base });
      nextRows.push(base);
      acceptedInBatch += 1;
      remainingFiles -= 1;
      remainingRate -= 1;
      remainingBytes -= file.size;
    }

    setRows(prev => [...prev, ...nextRows]);
    // A short sequential queue avoids a browser-side burst. The database still
    // serializes reservations and enforces the limits under concurrent clients.
    for (const item of accepted) {
      await uploadFile(item.row.id, item.requestId, item.file);
    }
  }


  if (error) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold">Link inválido ou expirado</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </div>
  );
  if (!info) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const remainingFiles = Math.max(0, info.limits.max_files_per_24h - info.usage.files_24h);
  const remainingBytes = Math.max(0, info.limits.max_bytes_per_24h - info.usage.bytes_24h);
  const quotaBlocked = remainingFiles === 0 || remainingBytes === 0;
  const expiresLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(info.expires_at));

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <header className="text-center space-y-2 pt-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-mono uppercase tracking-wider">
            Inbox · Aceleriq
          </div>
          <h1 className="text-2xl font-bold">Envie arquivos para <span className="text-primary">{info.folder.name}</span></h1>
          <p className="text-sm text-muted-foreground">Link sem cadastro, válido até {expiresLabel}.</p>
        </header>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Seu nome (opcional)</label>
          <Input value={sender} onChange={e => setSender(e.target.value)} placeholder="Ex.: João / Empresa X" className="h-10" />
        </div>

        <div
          role="button"
          tabIndex={isUploading || quotaBlocked ? -1 : 0}
          onClick={() => { if (!isUploading && !quotaBlocked) inputRef.current?.click(); }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !isUploading && !quotaBlocked) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); if (!isUploading && !quotaBlocked) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); void onFiles(e.dataTransfer.files); }}
          aria-disabled={isUploading || quotaBlocked}
          aria-label={`Selecionar arquivos, máximo de ${formatMb(info.limits.max_file_bytes)} por arquivo`}
          className={`rounded-2xl border-2 border-dashed transition-colors p-10 text-center ${isUploading || quotaBlocked ? "cursor-not-allowed opacity-60 border-border bg-card" : "cursor-pointer"} ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-card"}`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            disabled={isUploading || quotaBlocked}
            onChange={(e) => { void onFiles(e.target.files); e.currentTarget.value = ""; }}
          />
          <UploadCloud className="w-10 h-10 mx-auto text-primary mb-3" />
          <p className="text-sm font-medium">
            {quotaBlocked ? "Cota das últimas 24 horas atingida" : isUploading ? "Enviando a fila atual" : isDragActive ? "Solte para enviar" : "Arraste arquivos ou clique aqui"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Até {formatMb(info.limits.max_file_bytes)} por arquivo e {MAX_BATCH_FILES} arquivos por lote
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <span className="text-muted-foreground">Disponíveis no período</span>
            <div className="font-medium mt-0.5">{remainingFiles} arquivos</div>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <span className="text-muted-foreground">Volume disponível</span>
            <div className="font-medium mt-0.5">{formatMb(remainingBytes)}</div>
          </div>
        </div>


        {!!rows.length && (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {r.status === "err"
                  ? <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                  : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{r.name}</div>
                  {r.msg && <div className="text-[10px] text-destructive mt-0.5">{r.msg}</div>}
                </div>
                <span className="text-[11px] text-muted-foreground">{formatMb(r.size)}</span>
                {r.status === "queued" && <span className="text-[11px] text-muted-foreground">na fila</span>}
                {r.status === "up" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                {r.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {r.status === "err" && <span className="text-[11px] text-destructive">não enviado</span>}
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-[10px] text-muted-foreground pt-4">
          Os arquivos aparecem no Workspace da equipe em quarentena até a verificação de segurança.
        </p>
      </div>
    </div>
  );
}
