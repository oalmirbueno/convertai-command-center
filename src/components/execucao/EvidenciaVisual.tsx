import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Expand, FileText } from "lucide-react";
import { resolveFileUrl } from "@/lib/fileUrls";
import { supabase } from "@/integrations/supabase/client";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function RelatorioDeTexto({ href }: { href: string }) {
  const leitura = useQuery({ queryKey: ["relatorio-texto-privado", href], queryFn: async () => {
    const resposta = await fetch(href);
    if (!resposta.ok) throw new Error("Arquivo indisponível");
    const blob = await resposta.blob();
    if (blob.size > 1024 * 1024) throw new Error("Arquivo grande demais para a leitura rápida");
    return blob.text();
  } });
  if (leitura.isLoading) return <p className="p-4 text-sm text-muted-foreground">Abrindo relatório…</p>;
  if (leitura.error) return <p className="p-4 text-sm">Não foi possível mostrar o texto. <a className="text-primary" href={href} target="_blank" rel="noopener noreferrer">Abrir arquivo</a></p>;
  return <article className="prose prose-sm dark:prose-invert mx-auto w-full max-w-4xl overflow-x-auto break-words px-4 py-6 leading-7 prose-p:my-3"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{leitura.data || "Arquivo vazio."}</ReactMarkdown></article>;
}

/** `compacto` (16/10): miniatura quadrada para galeria (diário, arquivos), em vez da imagem grande. */
export default function EvidenciaVisual({ url, nome = "Comprovação", compacto = false }: { url: string; nome?: string; compacto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const tipo = destinoDaEvidencia(url);
  const { data: assinado, isError, refetch } = useQuery({
    queryKey: ["evidencia-assinada", url], enabled: tipo === "privado" || tipo === "arquivo", staleTime: 240_000,
    queryFn: async () => {
      if (tipo === "arquivo") {
        const { data: arquivo, error } = await supabase.from("files")
          .select("file_name,file_url,storage_bucket,storage_path,status,archived_at,mime_type")
          .eq("id", url.slice("aceleriq-file://".length)).single();
        if (error || !arquivo || arquivo.status !== "ready" || arquivo.archived_at) throw new Error("Arquivo indisponível com seu acesso atual");
        // 16/10: nome sem extensão ("Antes de levar o computador…") escondia que era PNG e a
        // imagem virava ícone de documento; o tipo vem do mime ou do caminho guardado.
        const temExtensao = /\.[a-z0-9]{2,5}$/i.test(String(arquivo.file_name || ""));
        const doCaminho = String(arquivo.storage_path || "").match(/\.[a-z0-9]{2,5}$/i)?.[0] || "";
        const doMime = String((arquivo as { mime_type?: string }).mime_type || "").split("/")[1]?.replace("jpeg", "jpg") || "";
        const formato = temExtensao ? arquivo.file_name : `${arquivo.file_name}${doCaminho || (doMime ? `.${doMime}` : "")}`;
        return { href: await resolveFileUrl({ fileUrl: arquivo.file_url, storageBucket: arquivo.storage_bucket, storagePath: arquivo.storage_path, expiresIn: 600 }), nome: arquivo.file_name, formato };
      }
      return { href: await resolveFileUrl({ fileUrl: url, expiresIn: 600 }), nome: url, formato: url };
    },
  });
  // Miniatura de galeria: prova só em texto (sem arquivo nem link) não vira aviso no meio da lista.
  if (!tipo) return compacto ? null : <p className="text-xs text-muted-foreground">A comprovação precisa de um arquivo ou link válido.</p>;
  if (isError) return <button onClick={() => void refetch()} className="text-xs text-warning">Não foi possível abrir com seu acesso atual. Tentar novamente</button>;
  const href = tipo === "web" ? url : assinado?.href;
  if (!href) return compacto ? <div className="aspect-square w-full animate-pulse rounded-lg bg-muted/50" aria-label="Carregando comprovação" /> : <p className="text-xs text-muted-foreground">Carregando comprovação…</p>;
  const formato = assinado?.formato || assinado?.nome || url;
  const imagem = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(formato);
  const arquivo = tipo !== "web" || /\.(png|jpe?g|webp|gif|pdf|mp4|webm|mp3|wav|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(formato);
  const titulo = nome === "Arquivo da execução" && assinado?.nome ? assinado.nome : nome;
  return <>
    {compacto ? (
      <button type="button" onClick={() => setAberto(true)} className="group block w-full overflow-hidden rounded-lg border border-border bg-muted/30 text-left hover:border-primary/60" aria-label={`Ver ${titulo}`} title={titulo}>
        {imagem
          ? <img src={href} loading="lazy" referrerPolicy="no-referrer" alt={titulo} className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]" />
          : <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 p-3 text-center"><FileText className="h-8 w-8 text-primary" aria-hidden="true" /><span className="line-clamp-2 text-[11.5px] text-foreground">{titulo}</span></span>}
        {imagem && <span className="block truncate px-2 py-1 text-[11px] text-muted-foreground">{titulo}</span>}
      </button>
    ) : (
    <button type="button" onClick={() => setAberto(true)} className="group block w-full overflow-hidden rounded-xl border border-border bg-background text-left hover:border-primary/60" aria-label={`Ver ${titulo}`}>
      {imagem && <img src={href} loading="lazy" referrerPolicy="no-referrer" alt={titulo} className="max-h-[400px] w-full object-contain" />}
      <span className="flex items-center gap-2 px-3 py-2 text-sm"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{titulo}</span><Expand className="h-4 w-4 text-muted-foreground" /></span>
    </button>
    )}
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-h-[95vh] w-[96vw] max-w-6xl overflow-y-auto">
        <DialogTitle className="pr-8 break-words">{titulo}</DialogTitle>
        <DialogDescription>{imagem ? "Clique na imagem para ampliar ou reduzir." : "Visualização dentro do painel."}</DialogDescription>
        {tipo !== "web" && /\.(md|txt)(?:[?#]|$)/i.test(formato) ? <RelatorioDeTexto href={href} /> : arquivo ? <FilePreviewContent fileName={formato} fileUrl={href} fileId={tipo === "arquivo" ? url.slice("aceleriq-file://".length) : undefined} /> : <>
          <iframe title={titulo} src={href} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" className="h-[70vh] w-full rounded-lg border border-border bg-white" />
          <p className="text-xs text-muted-foreground">Alguns sites bloqueiam a exibição incorporada. <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary">Abrir o site</a></p>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
