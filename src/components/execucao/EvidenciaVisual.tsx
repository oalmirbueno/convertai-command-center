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

export default function EvidenciaVisual({ url, nome = "Comprovação" }: { url: string; nome?: string }) {
  const [aberto, setAberto] = useState(false);
  const tipo = destinoDaEvidencia(url);
  const { data: assinado, isError, refetch } = useQuery({
    queryKey: ["evidencia-assinada", url], enabled: tipo === "privado" || tipo === "arquivo", staleTime: 240_000,
    queryFn: async () => {
      if (tipo === "arquivo") {
        const { data: arquivo, error } = await supabase.from("files")
          .select("file_name,file_url,storage_bucket,storage_path,status,archived_at")
          .eq("id", url.slice("aceleriq-file://".length)).single();
        if (error || !arquivo || arquivo.status !== "ready" || arquivo.archived_at) throw new Error("Arquivo indisponível com seu acesso atual");
        return { href: await resolveFileUrl({ fileUrl: arquivo.file_url, storageBucket: arquivo.storage_bucket, storagePath: arquivo.storage_path, expiresIn: 600 }), nome: arquivo.file_name };
      }
      return { href: await resolveFileUrl({ fileUrl: url, expiresIn: 600 }), nome: url };
    },
  });
  if (!tipo) return <p className="text-xs text-muted-foreground">A comprovação precisa de um arquivo ou link válido.</p>;
  if (isError) return <button onClick={() => void refetch()} className="text-xs text-warning">Não foi possível abrir com seu acesso atual. Tentar novamente</button>;
  const href = tipo === "web" ? url : assinado?.href;
  if (!href) return <p className="text-xs text-muted-foreground">Carregando comprovação…</p>;
  const formato = assinado?.nome || url;
  const imagem = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(formato);
  const arquivo = tipo !== "web" || /\.(png|jpe?g|webp|gif|pdf|mp4|webm|mp3|wav|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(formato);
  const titulo = nome === "Arquivo da execução" && assinado?.nome ? assinado.nome : nome;
  return <>
    <button type="button" onClick={() => setAberto(true)} className="group block w-full overflow-hidden rounded-xl border border-border bg-background text-left hover:border-primary/60" aria-label={`Ver ${titulo}`}>
      {imagem && <img src={href} loading="lazy" referrerPolicy="no-referrer" alt={titulo} className="max-h-[400px] w-full object-contain" />}
      <span className="flex items-center gap-2 px-3 py-2 text-sm"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{titulo}</span><Expand className="h-4 w-4 text-muted-foreground" /></span>
    </button>
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
