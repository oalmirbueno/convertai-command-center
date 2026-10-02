import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Expand, Maximize2, Minimize2, MonitorPlay, Pause, Play, Shrink, SkipBack, SkipForward } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { tempoComQuadro } from "@/lib/editor/tempo";
import { ComposicaoDoProjeto, quadrosDoProjeto } from "./Composicao";
import { useTempo, type Relogio } from "./apoio";

/**
 * Prévia do editor: Remotion Player com a composição gerada do projeto
 * (frente V-B). O cursor mora no relógio (apoio.ts); a prévia escreve nele a
 * cada quadro e obedece quando alguém muda o tempo (linha do tempo, atalhos).
 */

/** Só o relógio da prévia redesenha a cada quadro (antes, a prévia inteira redesenhava 25 vezes por segundo). */
function TempoDaPrevia({ relogio, fps, duracao, taxa }: { relogio: Relogio; fps: number; duracao: number; taxa: number }) {
  const tempo = useTempo(relogio, 1 / fps);
  return (
    <span className={juntar(texto.auxiliar, "ml-2 tabular-nums")}>
      {tempoComQuadro(tempo, fps)} / {tempoComQuadro(duracao, fps)}
      {taxa !== 1 ? ` · ${taxa}x` : ""}
    </span>
  );
}

export interface ControleDaPrevia {
  tocarOuPausar: () => void;
  tocar: () => void;
  pausar: () => void;
  irPara: (s: number) => void;
  tocando: () => boolean;
  velocidade: (v: number) => void;
}

const Previa = forwardRef<
  ControleDaPrevia,
  {
    projeto: ProjetoDeEdicao;
    urls: Record<string, string>;
    relogio: Relogio;
    compacta?: boolean;
    /** Vídeo grande: o editor esconde as laterais (o botão só aparece quando o editor passa isto). */
    ampliada?: boolean;
    onAmpliar?: () => void;
    /**
     * 02/10: "Tela cheia" é o EDITOR na tela inteira (prévia, linha do tempo,
     * ferramentas e o agente), sem o menu do painel. "Só o vídeo" é o player
     * sozinho, agora com controles (antes a tela cheia era só o vídeo, sem
     * botão nenhum para pausar ou voltar).
     */
    telaCheia?: boolean;
    onTelaCheia?: () => void;
  }
>(function Previa({ projeto, urls, relogio, compacta, ampliada, onAmpliar, telaCheia, onTelaCheia }, ref) {
  const player = useRef<PlayerRef | null>(null);
  const [tocando, setTocando] = useState(false);
  const [taxa, setTaxa] = useState(1);
  const vindoDoPlayer = useRef(false);
  const fps = projeto.fps;
  const total = quadrosDoProjeto(projeto);
  const props = useMemo(() => ({ projeto, urls }), [projeto, urls]);
  // O player sozinho na tela cheia do navegador ganha os controles dele (fora dela, os controles são os de baixo).
  const [soVideo, setSoVideo] = useState(false);
  useEffect(() => {
    const mudou = () => {
      const d = document as unknown as { fullscreenElement?: Element | null; webkitFullscreenElement?: Element | null };
      const el = d.fullscreenElement || d.webkitFullscreenElement || null;
      setSoVideo(!!el && !!caixa.current && caixa.current.contains(el));
    };
    document.addEventListener("fullscreenchange", mudou);
    document.addEventListener("webkitfullscreenchange", mudou);
    return () => {
      document.removeEventListener("fullscreenchange", mudou);
      document.removeEventListener("webkitfullscreenchange", mudou);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    tocarOuPausar: () => player.current && player.current.toggle(),
    tocar: () => player.current && player.current.play(),
    pausar: () => player.current && player.current.pause(),
    irPara: (s: number) => relogio.set(Math.max(0, Math.min(s, (total - 1) / fps))),
    tocando: () => !!(player.current && player.current.isPlaying()),
    velocidade: (v: number) => setTaxa(v),
  }));

  // Player -> relógio.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const aoQuadro = (e: { detail: { frame: number } }) => {
      vindoDoPlayer.current = true;
      relogio.set(e.detail.frame / fps);
      vindoDoPlayer.current = false;
    };
    const aoTocar = () => setTocando(true);
    const aoPausar = () => {
      setTocando(false);
      setTaxa(1);
    };
    p.addEventListener("frameupdate", aoQuadro);
    p.addEventListener("play", aoTocar);
    p.addEventListener("pause", aoPausar);
    p.addEventListener("ended", aoPausar);
    return () => {
      p.removeEventListener("frameupdate", aoQuadro);
      p.removeEventListener("play", aoTocar);
      p.removeEventListener("pause", aoPausar);
      p.removeEventListener("ended", aoPausar);
    };
  }, [fps, relogio]);

  // Relógio -> Player (quando quem mudou não foi o próprio Player).
  useEffect(
    () =>
      relogio.ouvir((s) => {
        if (vindoDoPlayer.current || !player.current) return;
        const alvo = Math.max(0, Math.min(total - 1, Math.round(s * fps)));
        if (player.current.getCurrentFrame() !== alvo) player.current.seekTo(alvo);
      }),
    [relogio, fps, total],
  );

  // Tamanho que cabe na caixa, na proporção do projeto (medido; sem aspect-ratio).
  const caixa = useRef<HTMLDivElement | null>(null);
  const [medida, setMedida] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => {
      const w = el.clientWidth;
      const h = el.clientHeight || (compacta ? Math.round(w * (projeto.altura / projeto.largura)) : 0);
      setMedida((m) => (m.w === w && m.h === h ? m : { w, h }));
    };
    medir();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = RO ? new RO(medir) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", medir);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [compacta, projeto.altura, projeto.largura]);
  const escala = medida.w > 0 && medida.h > 0 ? Math.min(medida.w / projeto.largura, medida.h / projeto.altura) : 0;
  const larguraDoPlayer = Math.max(1, Math.floor(projeto.largura * escala));
  const alturaDoPlayer = Math.max(1, Math.floor(projeto.altura * escala));
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-previa-do-editor="">
      <div
        ref={caixa}
        className={juntar("flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-md bg-black", compacta ? "" : "flex-1")}
        style={compacta ? { height: Math.min(480, Math.round((medida.w || 300) * (projeto.altura / projeto.largura))) } : undefined}
      >
        <div style={{ width: larguraDoPlayer, height: alturaDoPlayer }}>
          <Player
            ref={player}
            component={ComposicaoDoProjeto}
            inputProps={props}
            durationInFrames={total}
            fps={fps}
            compositionWidth={projeto.largura}
            compositionHeight={projeto.altura}
            playbackRate={taxa}
            controls={soVideo}
            style={{ width: larguraDoPlayer, height: alturaDoPlayer }}
            clickToPlay={false}
            // Licença gratuita do Remotion: a gestão da Aceleriq tem 2 pessoas (dono, 26/09/2026).
            acknowledgeRemotionLicense
            doubleClickToFullscreen
            spaceKeyToPlayOrPause={false}
            errorFallback={() => <div className="flex h-full w-full items-center justify-center text-[12px] text-white/70">Não deu para tocar esta mídia aqui.</div>}
          />
        </div>
      </div>
      <div className={juntar("mt-2 flex min-w-0 items-center", compacta && "justify-center")}>
        <button type="button" className={botao.icone} onClick={() => relogio.set(Math.max(0, relogio.get() - 1))} aria-label="Voltar 1 segundo (J)">
          <SkipBack className="h-4 w-4" />
        </button>
        <button type="button" className={juntar(botao.icone, "mx-1")} onClick={() => player.current && player.current.toggle()} aria-label={tocando ? "Pausar (espaço)" : "Tocar (espaço)"}>
          {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => relogio.set(Math.min((total - 1) / fps, relogio.get() + 1))} aria-label="Avançar 1 segundo">
          <SkipForward className="h-4 w-4" />
        </button>
        <TempoDaPrevia relogio={relogio} fps={fps} duracao={projeto.duracao_s} taxa={taxa} />
        {!compacta && (
          <span className="ml-auto flex items-center">
            {onAmpliar && (
              <button type="button" className={botao.icone} onClick={onAmpliar} aria-label={ampliada ? "Voltar ao tamanho normal (Esc)" : "Ampliar o vídeo"} title={ampliada ? "Voltar ao tamanho normal (Esc)" : "Ampliar o vídeo"} data-ampliar-previa="">
                {ampliada ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            )}
            {onTelaCheia && (
              <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onTelaCheia} aria-pressed={!!telaCheia} aria-label={telaCheia ? "Sair da tela cheia (Esc)" : "Tela cheia"} title={telaCheia ? "Sair da tela cheia (Esc)" : "Tela cheia: o editor e o agente na tela inteira"} data-tela-cheia="">
                {telaCheia ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
            )}
            <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => player.current && player.current.requestFullscreen()} aria-label="Só o vídeo" title="Só o vídeo, com controles (Esc volta). Dois cliques no vídeo também." data-so-o-video="">
              <MonitorPlay className="h-4 w-4" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
});

export default Previa;
