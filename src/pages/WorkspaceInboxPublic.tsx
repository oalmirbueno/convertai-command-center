import { useEffect, useRef, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2, FileText, AlertCircle } from "lucide-react";
import { CampoDeFormulario, Carregando, foco, juntar, texto } from "@/components/sistema";
import CascaPublica, { campoPublico } from "@/components/publico/CascaPublica";


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
    <CascaPublica titulo="Link inválido ou expirado" descricao={error} />
  );
  if (!info) return (
    <CascaPublica titulo="Enviar arquivos" descricao="Abrindo o link..." largura="media" centralizar={false}>
      <Carregando linhas={3} rotulo="Abrindo o link" />
    </CascaPublica>
  );

  const remainingFiles = Math.max(0, info.limits.max_files_per_24h - info.usage.files_24h);
  const remainingBytes = Math.max(0, info.limits.max_bytes_per_24h - info.usage.bytes_24h);
  const quotaBlocked = remainingFiles === 0 || remainingBytes === 0;
  const expiresLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(info.expires_at));
  const blocked = isUploading || quotaBlocked;

  return (
    <CascaPublica
      titulo={<>Enviar para <span className="text-primary">{info.folder.name}</span></>}
      descricao={`Sem cadastro. Válido até ${expiresLabel}.`}
      ajuda="Os arquivos aparecem no Workspace da equipe em quarentena até a verificação de segurança."
      largura="media"
      centralizar={false}
    >
      <CampoDeFormulario rotulo="Seu nome (opcional)">
        <input value={sender} onChange={e => setSender(e.target.value)} placeholder="Ex.: João / Empresa X" autoComplete="name" className={campoPublico} />
      </CampoDeFormulario>

      <div
        role="button"
        tabIndex={blocked ? -1 : 0}
        onClick={() => { if (!blocked) inputRef.current?.click(); }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !isUploading && !quotaBlocked) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!blocked) setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); void onFiles(e.dataTransfer.files); }}
        aria-disabled={blocked}
        aria-label={`Selecionar arquivos, máximo de ${formatMb(info.limits.max_file_bytes)} por arquivo`}
        className={juntar(
          "mt-5 flex min-w-0 flex-col items-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors",
          foco,
          blocked ? "cursor-not-allowed border-border opacity-60" : "cursor-pointer",
          !blocked && (isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"),
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          disabled={blocked}
          onChange={(e) => { void onFiles(e.target.files); e.currentTarget.value = ""; }}
        />
        <UploadCloud className="mb-3 h-8 w-8 text-primary" aria-hidden="true" />
        <p className={juntar(texto.corpo, "font-medium")}>
          {quotaBlocked ? "Cota das últimas 24 horas atingida" : isUploading ? "Enviando a fila atual" : isDragActive ? "Solte para enviar" : "Arraste arquivos ou clique aqui"}
        </p>
        <p className={juntar(texto.auxiliar, "mt-1")}>
          Até {formatMb(info.limits.max_file_bytes)} por arquivo e {MAX_BATCH_FILES} por lote
        </p>
      </div>

      <p className={juntar(texto.auxiliar, "mt-3 tabular-nums")}>
        Restam {remainingFiles} arquivos e {formatMb(remainingBytes)} no período.
      </p>

      {!!rows.length && (
        <ul className="mt-6 divide-y divide-border border-y border-border" aria-label="Arquivos enviados">
          {rows.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center py-2.5">
              {r.status === "err"
                ? <AlertCircle className="mr-3 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                : <FileText className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <div className="mr-3 min-w-0 flex-1">
                <p className={juntar(texto.corpo, "truncate")}>{r.name}</p>
                {r.msg && <p className="mt-0.5 text-[12px] leading-4 text-destructive">{r.msg}</p>}
              </div>
              <span className={juntar(texto.auxiliar, "mr-3 shrink-0 tabular-nums")}>{formatMb(r.size)}</span>
              <span className="flex w-[72px] shrink-0 justify-end">
                {r.status === "queued" && <span className={texto.auxiliar}>na fila</span>}
                {r.status === "up" && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Enviando" />}
                {r.status === "done" && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Enviado" />}
                {r.status === "err" && <span className="text-[12px] leading-4 text-destructive">não enviado</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CascaPublica>
  );
}
