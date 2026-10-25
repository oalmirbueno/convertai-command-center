import { useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import EscolherDocumentos from "@/components/laboratorio/no/EscolherDocumentos";
import { subirVideos } from "@/components/mesa-videos/videosApi";
import type { VideoProntoDaPeca } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * O vídeo pronto da peça da campanha (23/10/2026, dono: "eu consigo adicionar vídeo por ali mesmo e ele já
 * entra automático na campanha"): enviar do computador (o mesmo envio da Mesa Vídeos, bucket mesa) ou
 * escolher no Workspace do cliente. A peça guarda o caminho (ação campanha_peca_de_video).
 */

/** arquivo_id: o registro do envio no acervo da Mesa Vídeos (a peça do Mês leva ao Workspace por ele). */
export type VideoEscolhido = Omit<VideoProntoDaPeca, "em"> & { arquivo_id?: string };

const EH_VIDEO = /\.(mp4|mov|m4v|webm)$/i;

/** Os dois jeitos de trazer o vídeo: Enviar e Workspace. */
export function TrazerVideo({ clientId, rotulo, disabled, aoEscolher }: { clientId: string; rotulo: string; disabled?: boolean; aoEscolher: (v: VideoEscolhido) => Promise<void> | void }) {
  const [enviando, setEnviando] = useState(false);
  const [workspace, setWorkspace] = useState(false);
  const [erro, setErro] = useState("");
  const entrada = useRef<HTMLInputElement>(null);
  const enviar = async (arquivo: File) => {
    setErro("");
    if (arquivo.type.indexOf("video/") !== 0) {
      setErro("Use um vídeo MP4, MOV ou WebM.");
      return;
    }
    setEnviando(true);
    try {
      const r = await subirVideos(clientId, [arquivo], () => undefined);
      const a = r.registrados[0];
      if (!a) throw new Error((r.recusados[0] && r.recusados[0].motivo) || r.aviso || "O vídeo não subiu.");
      await aoEscolher({ bucket: "mesa", caminho: a.storage_path, nome: arquivo.name, arquivo_id: a.id, ...(a.duracao_s ? { duracao_s: a.duracao_s } : {}) });
    } catch (e) {
      setErro(textoDoErro(e));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <button type="button" className={juntar(botao.barra, "border border-border")} onClick={() => entrada.current && entrada.current.click()} disabled={disabled || enviando} aria-label={`${rotulo}: enviar do computador`}>
          {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          {enviando ? "Enviando…" : "Enviar vídeo"}
        </button>
        <button type="button" className={juntar(botao.barra, "border border-border")} onClick={() => setWorkspace(true)} disabled={disabled || enviando} aria-label={`${rotulo}: escolher no Workspace`}>
          <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Do Workspace
        </button>
        <input
          ref={entrada}
          type="file"
          className="hidden"
          accept="video/mp4,video/quicktime,video/webm"
          aria-label={`${rotulo}: arquivo de vídeo`}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) void enviar(f);
            e.target.value = "";
          }}
        />
      </div>
      {erro && <p className="mt-1 text-[12px] text-destructive">{erro}</p>}
      {workspace && (
        <EscolherDocumentos
          aberta
          umSo
          soDoCliente
          clienteId={clientId}
          jaEscolhidos={[]}
          titulo="Vídeo do Workspace"
          aceitar={(n) => EH_VIDEO.test(n.storage_path || "") || (n.mime || "").indexOf("video/") === 0}
          onFechar={() => setWorkspace(false)}
          onEscolher={(lista) => {
            setWorkspace(false);
            const a = lista[0];
            if (a && a.path) void Promise.resolve(aoEscolher({ bucket: "workspace", caminho: a.path, nome: a.nome || a.path.split("/").pop() || "vídeo" })).catch((e) => setErro(textoDoErro(e)));
          }}
        />
      )}
    </div>
  );
}

/** O vídeo pronto na peça: o player, trocar e tirar. */
export function VideoPronto({ clientId, video, aoTrocar, aoTirar }: { clientId: string; video: VideoProntoDaPeca; aoTrocar: (v: VideoEscolhido) => Promise<void>; aoTirar: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [tirando, setTirando] = useState(false);
  useEffect(() => {
    let vivo = true;
    void (supabase as any).storage
      .from(video.bucket)
      .createSignedUrl(video.caminho, 3600)
      .then((r: { data?: { signedUrl?: string } | null }) => {
        if (vivo) setUrl(r && r.data && r.data.signedUrl ? r.data.signedUrl : null);
      }, () => undefined);
    return () => {
      vivo = false;
    };
  }, [video.bucket, video.caminho]);
  return (
    <div className="min-w-0 space-y-2" data-video-pronto={video.caminho}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
          Vídeo pronto: {video.nome}
          {video.duracao_s ? ` · ${Math.round(video.duracao_s)} s` : ""}
        </span>
        <button
          type="button"
          className={botao.icone}
          aria-label="Tirar o vídeo da peça"
          title="Tirar o vídeo da peça (o arquivo continua no acervo)"
          disabled={tirando}
          onClick={async () => {
            setTirando(true);
            try {
              await aoTirar();
            } finally {
              setTirando(false);
            }
          }}
        >
          {tirando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {url && <video src={url} controls playsInline preload="metadata" className="max-h-80 w-full max-w-[220px] rounded-md bg-black" aria-label={`Vídeo ${video.nome}`} />}
      <TrazerVideo clientId={clientId} rotulo="Trocar o vídeo" aoEscolher={aoTrocar} />
    </div>
  );
}
