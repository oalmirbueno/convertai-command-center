import { useEffect, useRef, useState } from "react";
import { Loader2, PlayCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { SeletorCompacto, botao, campoTexto, juntar, texto } from "@/components/sistema";
import { getVideoEmbedUrl } from "@/components/shared/FilePreviewContent";
import { CHAVE_DO_VIDEO, enviarArquivoDoVideo, salvarVideoDoDia, useVideoDoDia, type VideoDoDia } from "@/lib/diaPrioritarioApi";
import { PlayerDoVideoDoDia } from "./VideoDoDiaPrioritario";

/**
 * O vídeo oficial do Dia Prioritário (Configurações, só admin). Arquivo enviado ao painel (bucket mesa,
 * pasta agencia/dia-prioritario, sempre com nome novo) ou link do YouTube/Vimeo. Os clientes só veem
 * depois de "Publicado"; o banco recusa publicar sem vídeo. Não é o vídeo de boas-vindas.
 */

const LIMITE_DO_VIDEO_MB = 100;

export default function VideoDoDiaPrioritarioAdmin() {
  const qc = useQueryClient();
  const { data: video, isLoading } = useVideoDoDia();
  const [titulo, setTitulo] = useState("");
  const [fonte, setFonte] = useState<"arquivo" | "link">("arquivo");
  const [link, setLink] = useState("");
  const [enviando, setEnviando] = useState<"video" | "capa" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [previa, setPrevia] = useState(false);
  const entradaVideo = useRef<HTMLInputElement>(null);
  const entradaCapa = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!video) return;
    setTitulo(video.titulo);
    setFonte(video.fonte === "link" ? "link" : "arquivo");
    setLink(video.video_url || "");
  }, [video && video.atualizado_em]);

  const reler = () => void qc.invalidateQueries({ queryKey: CHAVE_DO_VIDEO });
  const salvar = async (campos: Partial<VideoDoDia>, ok: string) => {
    setSalvando(true);
    try {
      await salvarVideoDoDia(campos);
      toast.success(ok);
      reler();
    } catch (e) {
      const m = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
      toast.error("Não salvou", { description: m.includes("publicado_tem_video") ? "Para publicar, envie o arquivo ou cole o link do vídeo antes." : "Só administradores mudam o vídeo." });
    } finally {
      setSalvando(false);
    }
  };

  const enviar = async (arquivo: File | undefined, tipo: "video" | "capa") => {
    if (!arquivo) return;
    if (tipo === "video" && !/^video\//.test(arquivo.type)) return toast.error("Escolha um arquivo de vídeo (mp4).");
    if (tipo === "capa" && !/^image\//.test(arquivo.type)) return toast.error("Escolha uma imagem para a capa.");
    if (tipo === "video" && arquivo.size > LIMITE_DO_VIDEO_MB * 1024 * 1024) return toast.error(`O vídeo passa de ${LIMITE_DO_VIDEO_MB} MB.`, { description: "Use um link do YouTube ou Vimeo." });
    setEnviando(tipo);
    try {
      const caminho = await enviarArquivoDoVideo(arquivo, tipo);
      await salvarVideoDoDia(tipo === "video" ? { fonte: "arquivo", video_path: caminho } : { capa_path: caminho });
      toast.success(tipo === "video" ? "Vídeo enviado" : "Capa enviada", { description: video?.publicado ? "Já vale para os clientes." : "Ainda não publicado para os clientes." });
      reler();
    } catch {
      toast.error("O envio falhou. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  };

  if (isLoading) return <p className={texto.auxiliar}>Lendo o vídeo</p>;
  if (!video) return <p className={texto.auxiliar}>O vídeo ainda não está disponível neste ambiente.</p>;

  const linkValido = !!link.trim() && /^https:\/\//.test(link.trim());
  const temVideo = (video.fonte === "arquivo" && !!video.video_path) || (video.fonte === "link" && !!video.video_url);

  return (
    <div className="min-w-0 space-y-3" data-video-do-dia-admin="">
      <p className={texto.auxiliar}>
        {video.publicado ? "Publicado: os clientes veem no cartão do Dia Prioritário." : temVideo ? "Pronto, mas ainda não publicado." : "Sem vídeo: o cartão do cliente não mostra nada no lugar."}
      </p>
      <label className="block">
        <span className={juntar(texto.rotulo, "mb-1 block")}>Título</span>
        <input className={juntar(campoTexto, "w-full")} value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} onBlur={() => titulo.trim().length >= 3 && titulo !== video.titulo && void salvar({ titulo: titulo.trim() }, "Título salvo")} />
      </label>
      <div>
        <p className={juntar(texto.rotulo, "mb-1")}>De onde vem</p>
        <SeletorCompacto rotulo="Fonte do vídeo" opcoes={[{ valor: "arquivo", rotulo: "Arquivo enviado" }, { valor: "link", rotulo: "Link (YouTube, Vimeo)" }]} valor={fonte} onEscolher={(v) => setFonte(v as "arquivo" | "link")} />
      </div>
      {fonte === "arquivo" ? (
        <div className="flex flex-wrap items-center">
          <input ref={entradaVideo} type="file" accept="video/mp4,video/*" className="hidden" onChange={(e) => void enviar(e.target.files?.[0], "video")} />
          <button type="button" className={juntar(botao.secundario, "mb-1 mr-2 h-9")} onClick={() => entradaVideo.current?.click()} disabled={!!enviando}>
            {enviando === "video" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {video.video_path ? "Substituir o vídeo" : "Enviar o vídeo"}
          </button>
          <span className={texto.auxiliar}>{video.video_path ? "Arquivo enviado" : `mp4 até ${LIMITE_DO_VIDEO_MB} MB`}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-end">
          <label className="mb-1 mr-2 block min-w-0 flex-1">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Link</span>
            <input className={juntar(campoTexto, "w-full")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          <button type="button" className={juntar(botao.secundario, "mb-1 h-9")} disabled={!linkValido || salvando || (!getVideoEmbedUrl(link.trim()) && !/\.mp4(\?|$)/i.test(link.trim()))} onClick={() => void salvar({ fonte: "link", video_url: link.trim() }, "Link salvo")}>
            Salvar link
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center">
        <input ref={entradaCapa} type="file" accept="image/*" className="hidden" onChange={(e) => void enviar(e.target.files?.[0], "capa")} />
        <button type="button" className={juntar(botao.discreto, "mb-1 mr-2 h-9")} onClick={() => entradaCapa.current?.click()} disabled={!!enviando}>
          {enviando === "capa" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          {video.capa_path ? "Trocar a capa" : "Enviar a capa"}
        </button>
        {temVideo && (
          <button type="button" className={juntar(botao.discreto, "mb-1 h-9")} onClick={() => setPrevia(true)}>
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Ver como fica
          </button>
        )}
      </div>
      <label className="flex items-center justify-between border-t border-border pt-3">
        <span className={texto.corpo}>Publicado para os clientes</span>
        <Switch checked={video.publicado} disabled={salvando || (!temVideo && !video.publicado)} onCheckedChange={(v) => void salvar({ publicado: v }, v ? "Vídeo publicado no cartão dos clientes" : "Vídeo tirado do cartão dos clientes")} />
      </label>
      {temVideo && <PlayerDoVideoDoDia video={video} aberta={previa} onFechar={() => setPrevia(false)} />}
    </div>
  );
}
