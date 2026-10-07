import { useQuery } from "@tanstack/react-query";
import { resolveFileUrl } from "@/lib/fileUrls";
import { supabase } from "@/integrations/supabase/client";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";

export default function EvidenciaVisual({ url, nome = "Abrir comprovação" }: { url: string; nome?: string }) {
  const tipo = destinoDaEvidencia(url);
  const { data: assinado, isError } = useQuery({
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
  if (!tipo) return <p className="whitespace-pre-wrap break-words text-[13px] text-muted-foreground">{url}</p>;
  if (isError) return <p className="text-[12px] text-warning">Não foi possível abrir esta comprovação com seu acesso atual.</p>;
  const href = tipo === "privado" || tipo === "arquivo" ? assinado?.href : url;
  if (!href) return <p className="text-[12px] text-muted-foreground">Carregando comprovação…</p>;
  const formato = assinado?.nome || url;
  const imagem = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(formato);
  const video = /\.(mp4|webm)(?:[?#]|$)/i.test(formato);
  return <div className="min-w-0 space-y-1">
    {video && <video controls preload="metadata" src={href} className="max-h-72 w-full rounded-md bg-background object-contain" />}
    <a href={href} target="_blank" rel="noopener noreferrer" className="block rounded-md text-[13px] text-primary underline-offset-2 hover:underline">
      {imagem && <img src={href} loading="lazy" referrerPolicy="no-referrer" alt={nome} className="mb-1 max-h-72 w-full rounded-md border border-border bg-background object-contain" />}
      {nome}
    </a>
  </div>;
}
