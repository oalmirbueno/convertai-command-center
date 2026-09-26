import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
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

export interface ControleDaPrevia {
  tocarOuPausar: () => void;
  tocar: () => void;
  pausar: () => void;
  irPara: (s: number) => void;
  tocando: () => boolean;
  velocidade: (v: number) => void;
}

const Previa = forwardRef<ControleDaPrevia, { projeto: ProjetoDeEdicao; urls: Record<string, string>; relogio: Relogio; compacta?: boolean }>(function Previa({ projeto, urls, relogio, compacta }, ref) {
  const player = useRef<PlayerRef | null>(null);
  const [tocando, setTocando] = useState(false);
  const [taxa, setTaxa] = useState(1);
  const vindoDoPlayer = useRef(false);
  const fps = projeto.fps;
  const total = quadrosDoProjeto(projeto);
  const props = useMemo(() => ({ projeto, urls }), [projeto, urls]);
  const tempo = useTempo(relogio, 1 / fps);

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
        <button type="button" className={botao.icone} onClick={() => relogio.set(Math.max(0, tempo - 1))} aria-label="Voltar 1 segundo (J)">
          <SkipBack className="h-4 w-4" />
        </button>
        <button type="button" className={juntar(botao.icone, "mx-1")} onClick={() => player.current && player.current.toggle()} aria-label={tocando ? "Pausar (espaço)" : "Tocar (espaço)"}>
          {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" className={botao.icone} onClick={() => relogio.set(Math.min((total - 1) / fps, tempo + 1))} aria-label="Avançar 1 segundo">
          <SkipForward className="h-4 w-4" />
        </button>
        <span className={juntar(texto.auxiliar, "ml-2 tabular-nums")}>
          {tempoComQuadro(tempo, fps)} / {tempoComQuadro(projeto.duracao_s, fps)}
          {taxa !== 1 ? ` · ${taxa}x` : ""}
        </span>
      </div>
    </div>
  );
});

export default Previa;
