import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { capasDeVideoEmLote } from "@/lib/capaDoVideo";
import { juntar } from "./estilos";

/**
 * A capa de um vídeo (29/10/2026). Com a capa leve (<vídeo>.mini.jpg), a imagem; sem ela, o quadro do próprio
 * vídeo perto de 1 s, carregado só quando aparece na tela (antes: <video preload="none"> e o cartão vazio).
 * Sem nenhuma das duas, o ícone. Ocupa o pai inteiro (absolute inset-0): o pai dá o tamanho.
 *
 * Passe `capa` e `video` quando a lista já assinou em lote (Workspace); só `bucket` e `caminho` para buscar
 * sozinho (seletor, prancheta).
 */
export default function CapaDoVideo({
  bucket,
  caminho,
  capa,
  video,
  nome,
  className,
}: {
  bucket?: string | null;
  caminho?: string | null;
  capa?: string | null;
  video?: string | null;
  nome?: string;
  className?: string;
}) {
  const jaTem = capa !== undefined || video !== undefined;
  const busca = useQuery({
    queryKey: ["capa-do-video", bucket, caminho],
    queryFn: async () => (await capasDeVideoEmLote(bucket as string, [caminho as string]))[caminho as string] || { capa: null, video: null },
    enabled: !jaTem && !!bucket && !!caminho,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const urlCapa = jaTem ? capa || null : busca.data ? busca.data.capa : null;
  const urlVideo = jaTem ? video || null : busca.data ? busca.data.video : null;
  const [capaFalhou, setCapaFalhou] = useState(false);
  const base = juntar("absolute inset-0 h-full w-full object-cover", className);

  if (urlCapa && !capaFalhou) {
    return <img src={urlCapa} alt={nome ? `Capa do vídeo ${nome}` : ""} loading="lazy" className={base} onError={() => setCapaFalhou(true)} data-capa-do-video="imagem" />;
  }
  if (urlVideo) return <QuadroDoVideo url={urlVideo} className={base} />;
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-muted" data-capa-do-video="icone">
      <Film className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

/** O quadro do vídeo, carregado só quando o cartão entra na tela; perto de 1 s (o quadro 0 costuma ser preto). */
function QuadroDoVideo({ url, className }: { url: string; className: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [visivel, setVisivel] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visivel || !ref.current || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        setVisivel(true);
        obs.disconnect();
      }
    }, { rootMargin: "200px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visivel]);
  return (
    <video
      ref={ref}
      src={visivel ? `${url}#t=1` : undefined}
      muted
      playsInline
      preload={visivel ? "metadata" : "none"}
      aria-hidden="true"
      tabIndex={-1}
      className={juntar("pointer-events-none bg-muted", className)}
      data-capa-do-video="quadro"
    />
  );
}
