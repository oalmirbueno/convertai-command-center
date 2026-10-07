import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { destinoDaEvidencia } from "@/lib/execucaoApresentacao";

export default function EvidenciaVisual({ url, nome = "Abrir comprovação" }: { url: string; nome?: string }) {
  const tipo = destinoDaEvidencia(url);
  const { data: assinado, isError } = useQuery({
    queryKey: ["evidencia-assinada", url], enabled: tipo === "privado", staleTime: 240_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("files").createSignedUrl(url.slice(8), 600);
      if (error || !data?.signedUrl) throw error || new Error("Anexo indisponível");
      return data.signedUrl;
    },
  });
  if (!tipo) return <p className="whitespace-pre-wrap break-words text-[13px] text-muted-foreground">{url}</p>;
  if (isError) return <p className="text-[12px] text-warning">Não foi possível abrir esta comprovação com seu acesso atual.</p>;
  const href = tipo === "privado" ? assinado : url;
  if (!href) return <p className="text-[12px] text-muted-foreground">Carregando comprovação…</p>;
  const imagem = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.test(url);
  const video = /\.(mp4|webm)(?:[?#]|$)/i.test(url);
  return <div className="min-w-0 space-y-1">
    {video && <video controls preload="metadata" src={href} className="max-h-72 w-full rounded-md bg-background object-contain" />}
    <a href={href} target="_blank" rel="noopener noreferrer" className="block rounded-md text-[13px] text-primary underline-offset-2 hover:underline">
      {imagem && <img src={href} loading="lazy" referrerPolicy="no-referrer" alt={nome} className="mb-1 max-h-72 w-full rounded-md border border-border bg-background object-contain" />}
      {nome}
    </a>
  </div>;
}
