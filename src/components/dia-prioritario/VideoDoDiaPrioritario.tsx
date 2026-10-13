import { useEffect, useState } from "react";
import { PlayCircle } from "lucide-react";
import { JanelaCentral, foco, juntar, texto } from "@/components/sistema";
import { getVideoEmbedUrl } from "@/components/shared/FilePreviewContent";
import { urlDoArquivoDoVideo, useVideoDoDia, videoPronto, type VideoDoDia } from "@/lib/diaPrioritarioApi";

/**
 * O vídeo oficial do Dia Prioritário (motion design, produzido depois). Só aparece quando a equipe
 * publicou e há vídeo de verdade: sem player vazio, link quebrado ou conteúdo de exemplo. Abre numa
 * janela central (a página fica onde está), sem tocar sozinho.
 */
export function PlayerDoVideoDoDia({ video, aberta, onFechar }: { video: VideoDoDia; aberta: boolean; onFechar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [capa, setCapa] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    setFalhou(false);
    if (video.fonte === "link") {
      const embed = video.video_url ? getVideoEmbedUrl(video.video_url) : null;
      setUrl(embed || video.video_url);
    } else {
      void Promise.all([urlDoArquivoDoVideo(video.video_path), urlDoArquivoDoVideo(video.capa_path)]).then(([v, c]) => {
        if (!vivo) return;
        setUrl(v);
        setCapa(c);
        if (!v) setFalhou(true);
      });
    }
    return () => {
      vivo = false;
    };
  }, [aberta, video.fonte, video.video_url, video.video_path, video.capa_path]);

  const embed = video.fonte === "link" && url ? getVideoEmbedUrl(video.video_url || "") : null;
  return (
    <JanelaCentral aberta={aberta} onFechar={onFechar} titulo={video.titulo} largura="lg" data-video-do-dia="">
      <div className="relative w-full overflow-hidden rounded-md bg-black" style={{ paddingTop: "56.25%" }}>
        {embed ? (
          <iframe
            src={embed}
            title={video.titulo}
            className="absolute inset-0 h-full w-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : url ? (
          <video className="absolute inset-0 h-full w-full" src={url} poster={capa || undefined} controls playsInline preload="metadata" />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-[13px] text-white/80">
            {falhou ? "O vídeo não abriu agora. Tente de novo em instantes." : "Carregando o vídeo"}
          </p>
        )}
      </div>
    </JanelaCentral>
  );
}

/** A miniatura com título e "Assistir"; nada quando o vídeo não está pronto. */
export default function VideoDoDiaPrioritario({ className }: { className?: string }) {
  const { data: video } = useVideoDoDia();
  const [aberto, setAberto] = useState(false);
  const [capa, setCapa] = useState<string | null>(null);
  const pronto = videoPronto(video);
  useEffect(() => {
    let vivo = true;
    if (pronto && video && video.capa_path) void urlDoArquivoDoVideo(video.capa_path).then((u) => vivo && setCapa(u));
    return () => {
      vivo = false;
    };
  }, [pronto, video && video.capa_path]);
  if (!pronto || !video) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={juntar("flex w-full min-w-0 items-center rounded-md border border-border bg-background px-2 py-2 text-left transition-colors hover:border-primary/40", foco, className)}
        data-miniatura-do-video=""
      >
        <span className="relative mr-3 block h-12 w-20 shrink-0 overflow-hidden rounded bg-muted">
          {capa && <img src={capa} alt="" className="h-full w-full object-cover" loading="lazy" />}
          <PlayCircle className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-primary drop-shadow" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-foreground">{video.titulo}</span>
          <span className={texto.auxiliar}>Assistir ao vídeo</span>
        </span>
      </button>
      <PlayerDoVideoDoDia video={video} aberta={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}
