import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveFileUrl } from "@/lib/fileUrls";

/**
 * Miniatura leve para as galerias do Contexto: pede ao Storage a imagem já
 * reduzida (transformação) e, se a transformação falhar (SVG, imagem grande
 * demais), cai na original. A URL assinada fica no cache da Mesa por 45 min,
 * na mesma família de chaves de useUrlDaMesa.
 */
export function MiniaturaDoStorage({
  bucket,
  caminho,
  alt,
  largura = 320,
  ajuste = "cover",
  className = "",
}: {
  bucket: string;
  caminho: string | null | undefined;
  alt: string;
  largura?: number;
  ajuste?: "cover" | "contain";
  className?: string;
}) {
  const [original, setOriginal] = useState(false);
  const transformar = !original;
  const url = useQuery({
    queryKey: ["mesa", "url", bucket, caminho, transformar ? `mini-${largura}-${ajuste}` : "original"],
    enabled: !!caminho,
    staleTime: 45 * 60_000,
    retry: 1,
    queryFn: async () => {
      const c = String(caminho);
      const transform = transformar ? { width: largura, height: largura, resize: ajuste, quality: 70 } : null;
      if (c.indexOf("://") > 0) return resolveFileUrl({ fileUrl: c, transform });
      const { data, error } = await (supabase.storage.from(bucket) as any).createSignedUrl(c, 3600, transform ? { transform } : undefined);
      if (error || !data?.signedUrl) throw error || new Error("Imagem indisponível");
      return String(data.signedUrl);
    },
  });

  // Transformação recusada: tenta a original uma vez.
  const falhou = url.isError;
  useEffect(() => {
    if (falhou && transformar) setOriginal(true);
  }, [falhou, transformar]);

  if (!caminho || (url.isError && !transformar)) {
    return (
      <span className={`flex items-center justify-center bg-muted text-muted-foreground ${className}`} role="img" aria-label={`${alt}: imagem indisponível`}>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  if (!url.data) return <span className={`block animate-pulse bg-muted ${className}`} aria-hidden="true" />;
  return (
    <img
      src={url.data}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (transformar) setOriginal(true);
      }}
      className={`${ajuste === "contain" ? "object-contain" : "object-cover"} ${className}`}
    />
  );
}

/**
 * URLs assinadas em lote (uma chamada para a página inteira da galeria), para
 * as amostras da biblioteca de fontes. Devolve um objeto caminho → URL.
 */
export function useUrlsAssinadas(bucket: string, caminhos: string[]) {
  const unicos = caminhos.filter((c, i) => !!c && caminhos.indexOf(c) === i);
  return useQuery({
    queryKey: ["mesa", "urls", bucket, unicos.join("|")],
    enabled: unicos.length > 0,
    staleTime: 45 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unicos, 3600);
      if (error) throw error;
      const saida: Record<string, string> = {};
      for (const item of (data || []) as { path: string | null; signedUrl: string; error: string | null }[]) {
        if (item.path && item.signedUrl && !item.error) saida[item.path] = item.signedUrl;
      }
      return saida;
    },
  });
}
