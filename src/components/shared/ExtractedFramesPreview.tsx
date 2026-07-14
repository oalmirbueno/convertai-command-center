import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, FileSpreadsheet, Presentation, FileText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Chunk {
  id: string;
  chunk_index: number;
  content_type: string | null;
  page_number: number | null;
  sheet_name: string | null;
  slide_number: number | null;
  text: string | null;
}

interface Props {
  fileId: string;
  kind: "xlsx" | "pptx" | "pdf" | "docx";
}

const KIND_META = {
  xlsx: { icon: FileSpreadsheet, label: "Planilha", frame: "Aba" },
  pptx: { icon: Presentation, label: "Apresentação", frame: "Slide" },
  pdf:  { icon: FileText, label: "Documento",   frame: "Página" },
  docx: { icon: FileText, label: "Documento",   frame: "Seção" },
} as const;

export default function ExtractedFramesPreview({ fileId, kind }: Props) {
  const [loading, setLoading] = useState(true);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: file }, { data }] = await Promise.all([
      supabase.from("files").select("extraction_status, extraction_error").eq("id", fileId).maybeSingle(),
      supabase
        .from("file_content_chunks")
        .select("id, chunk_index, content_type, page_number, sheet_name, slide_number, text")
        .eq("file_id", fileId)
        .order("chunk_index", { ascending: true })
        .limit(500),
    ]);
    setStatus(file?.extraction_status || null);
    setChunks((data as Chunk[]) || []);
    setActiveIdx(0);
    setLoading(false);
  }, [fileId]);

  useEffect(() => { load(); }, [load]);

  const reprocess = useCallback(async () => {
    setReprocessing(true);
    try {
      await supabase.functions.invoke("mcp-files-worker", { body: { file_id: fileId, force: true } });
      setTimeout(load, 2000);
    } finally {
      setReprocessing(false);
    }
  }, [fileId, load]);

  useEffect(() => {
    if (loading || chunks.length > 0 || reprocessing) return;
    if (["processing", "queued"].includes(status || "")) {
      const timer = window.setTimeout(load, 2500);
      return () => window.clearTimeout(timer);
    }
    reprocess();
  }, [chunks.length, load, loading, reprocess, reprocessing, status]);

  const meta = KIND_META[kind];
  const Icon = meta.icon;

  const active = chunks[activeIdx];
  const frameLabel = useMemo(() => {
    if (!active) return "";
    if (kind === "xlsx") return active.sheet_name || `Aba ${activeIdx + 1}`;
    if (kind === "pptx") return `Slide ${active.slide_number ?? activeIdx + 1}`;
    return `Página ${active.page_number ?? activeIdx + 1}`;
  }, [active, activeIdx, kind]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando páginas extraídas...
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 bg-secondary rounded-xl border border-border">
        <Icon className="w-10 h-10 text-muted-foreground/40" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">Conteúdo ainda não extraído</p>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-mono">{status || "pending"}</span>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reprocess} disabled={reprocessing} className="gap-1.5">
          {reprocessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Processar agora
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[220px,1fr] gap-3 h-[70vh] bg-secondary/40 rounded-xl border border-border overflow-hidden">
      {/* Thumbnails rail */}
      <div className="overflow-y-auto border-r border-border bg-background/60 p-2 space-y-2">
        {chunks.map((c, i) => {
          const label =
            kind === "xlsx" ? (c.sheet_name || `Aba ${i + 1}`) :
            kind === "pptx" ? `Slide ${c.slide_number ?? i + 1}` :
                              `Página ${c.page_number ?? i + 1}`;
          const preview = (c.text || "").slice(0, 140).trim();
          const active = i === activeIdx;
          return (
            <button
              key={c.id}
              onClick={() => setActiveIdx(i)}
              className={`w-full text-left rounded-lg border transition-all overflow-hidden ${
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                  : "border-border bg-background hover:border-primary/40"
              }`}
            >
              <div className="aspect-[4/3] bg-white p-2 border-b border-border overflow-hidden relative">
                <div className="text-[6px] leading-[8px] text-muted-foreground/80 whitespace-pre-wrap font-mono line-clamp-[14]">
                  {preview || "—"}
                </div>
                <div className="absolute top-1 right-1 bg-background/80 border border-border rounded px-1 text-[9px] font-medium">
                  {i + 1}
                </div>
              </div>
              <div className="px-2 py-1 text-[10px] font-medium truncate">{label}</div>
            </button>
          );
        })}
      </div>

      {/* Active frame */}
      <div className="overflow-y-auto p-6 bg-white">
        <div className="max-w-3xl mx-auto space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-b border-border pb-2">
            <Icon className="w-3.5 h-3.5" />
            <span className="font-medium text-foreground">{frameLabel}</span>
            <span>·</span>
            <span>{activeIdx + 1} / {chunks.length}</span>
          </div>
          {kind === "xlsx" ? (
            <TableRenderer text={active?.text || ""} />
          ) : (
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {active?.text || "(sem texto)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** Render CSV/TSV or pipe-delimited chunk text as a table when possible. */
function TableRenderer({ text }: { text: string }) {
  const rows = useMemo(() => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [] as string[][];
    const sep = lines[0].includes("\t") ? "\t" : lines[0].includes("|") ? "|" : ",";
    return lines.map((l) => l.split(sep).map((c) => c.trim()));
  }, [text]);

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">(vazio)</p>;

  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-secondary">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="text-left font-semibold px-2 py-1.5 border-b border-border whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, 500).map((r, i) => (
            <tr key={i} className="odd:bg-background even:bg-secondary/30">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 border-b border-border/60 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
