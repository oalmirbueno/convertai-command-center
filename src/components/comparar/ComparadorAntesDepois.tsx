import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar, texto } from "@/components/sistema/estilos";

/**
 * Comparador antes e depois com alavanca de arrastar (frente V-B; tipo
 * CapCut). Reutilizável: imagem ou vídeo, em qualquer tela.
 *
 * - Modos: cortina (arrasta a divisa), lado a lado e alternar.
 * - Orientação: horizontal (divisa em pé, antes à esquerda) ou vertical.
 * - Arrasta com mouse e com toque (sem Pointer Events: Safari 11 não tem);
 *   teclado na alavanca: setas (Shift = passo grande), Home e End.
 * - Vídeo: os dois tocam juntos (play, pausa e tempo no mesmo controle; o
 *   "depois" segue o "antes" e é corrigido se escorregar mais de 0,1 s).
 * - Nada pisca: trocar a posição só muda o recorte (clip-path), as mídias
 *   ficam montadas.
 * Imagem funciona no Safari 11; vídeo sincronizado pede navegador atual
 * (sem ele, avisa e mostra os dois lado a lado com controles próprios).
 *
 * Onde plugar nas mesas de imagem: docs/video/EDITOR.md, seção Comparador.
 */

export type ModoDoComparador = "cortina" | "lado_a_lado" | "alternar";
export type OrientacaoDoComparador = "horizontal" | "vertical";

export interface LadoDoComparador {
  src: string;
  rotulo?: string;
}

/** Nova posição (0 a 100) pela tecla; null quando a tecla não é da alavanca. */
export function posicaoPelaTecla(pos: number, tecla: string, grande = false): number | null {
  const passo = grande ? 10 : 2;
  if (tecla === "ArrowLeft" || tecla === "ArrowDown") return Math.max(0, pos - passo);
  if (tecla === "ArrowRight" || tecla === "ArrowUp") return Math.min(100, pos + passo);
  if (tecla === "Home") return 0;
  if (tecla === "End") return 100;
  return null;
}

/** Posição (0 a 100) do ponteiro dentro da caixa. */
export function posicaoPeloPonteiro(x: number, y: number, caixa: { left: number; top: number; width: number; height: number }, orientacao: OrientacaoDoComparador): number {
  const v = orientacao === "horizontal" ? (x - caixa.left) / Math.max(1, caixa.width) : (y - caixa.top) / Math.max(1, caixa.height);
  return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
}

/** Recorte do "depois" para a posição (o depois fica à direita, ou embaixo). */
export const recorteDoDepois = (pos: number, orientacao: OrientacaoDoComparador) => (orientacao === "horizontal" ? `inset(0 0 0 ${pos}%)` : `inset(${pos}% 0 0 0)`);

const videoSincronizavel = () => typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && typeof HTMLMediaElement !== "undefined" && typeof (HTMLMediaElement.prototype as unknown as { play?: unknown }).play === "function";

function Midia({ tipo, lado, refVideo, estilo }: { tipo: "imagem" | "video"; lado: LadoDoComparador; refVideo?: (v: HTMLVideoElement | null) => void; estilo?: CSSProperties }) {
  const base: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "contain", ...estilo };
  if (tipo === "imagem") return <img src={lado.src} alt={lado.rotulo || ""} draggable={false} style={base} />;
  return <video ref={refVideo} src={lado.src} muted playsInline preload="auto" style={base} />;
}

export default function ComparadorAntesDepois({
  tipo,
  antes: antesBruto,
  depois: depoisBruto,
  rotulo: rotuloGeral,
  proporcao = 9 / 16,
  modoInicial = "cortina",
  orientacao: orientacaoInicial = "horizontal",
  rotulos = true,
  mostrarModos = true,
  posicaoInicial = 50,
  className,
  acoes,
}: {
  tipo: "imagem" | "video";
  /** URL ou { src, rotulo } (as duas formas: contrato combinado com a V-A em docs/video/CONTRATOS.md). */
  antes: string | LadoDoComparador;
  depois: string | LadoDoComparador;
  /** Título curto acima (opcional). */
  rotulo?: string;
  /** Altura / largura (9:16 em pé = 16/9; 1:1 = 1). */
  proporcao?: number;
  modoInicial?: ModoDoComparador;
  orientacao?: OrientacaoDoComparador;
  rotulos?: boolean;
  mostrarModos?: boolean;
  posicaoInicial?: number;
  className?: string;
  /** Botões extras na linha dos modos. */
  acoes?: ReactNode;
}) {
  const antes: LadoDoComparador = typeof antesBruto === "string" ? { src: antesBruto } : antesBruto;
  const depois: LadoDoComparador = typeof depoisBruto === "string" ? { src: depoisBruto } : depoisBruto;
  const [modo, setModo] = useState<ModoDoComparador>(modoInicial);
  const [orientacao, setOrientacao] = useState<OrientacaoDoComparador>(orientacaoInicial);
  const [pos, setPos] = useState(posicaoInicial);
  const [mostrandoDepois, setMostrandoDepois] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const caixa = useRef<HTMLDivElement | null>(null);
  const va = useRef<HTMLVideoElement | null>(null);
  const vb = useRef<HTMLVideoElement | null>(null);
  const arrastando = useRef(false);
  const sincroniza = tipo === "video" && videoSincronizavel();

  const mover = useCallback(
    (x: number, y: number) => {
      const el = caixa.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos(posicaoPeloPonteiro(x, y, { left: r.left, top: r.top, width: r.width, height: r.height }, orientacao));
    },
    [orientacao],
  );

  // Mouse e toque (toque com passive: false para não rolar a página enquanto arrasta).
  useEffect(() => {
    const el = caixa.current;
    if (!el || modo !== "cortina") return;
    const aoMover = (e: MouseEvent) => arrastando.current && mover(e.clientX, e.clientY);
    const aoSoltar = () => (arrastando.current = false);
    const aoTocar = (e: TouchEvent) => {
      if (!e.touches.length) return;
      arrastando.current = true;
      mover(e.touches[0].clientX, e.touches[0].clientY);
    };
    const aoArrastarToque = (e: TouchEvent) => {
      if (!arrastando.current || !e.touches.length) return;
      e.preventDefault();
      mover(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener("mousemove", aoMover);
    window.addEventListener("mouseup", aoSoltar);
    el.addEventListener("touchstart", aoTocar, { passive: true });
    el.addEventListener("touchmove", aoArrastarToque, { passive: false });
    el.addEventListener("touchend", aoSoltar);
    return () => {
      window.removeEventListener("mousemove", aoMover);
      window.removeEventListener("mouseup", aoSoltar);
      el.removeEventListener("touchstart", aoTocar);
      el.removeEventListener("touchmove", aoArrastarToque);
      el.removeEventListener("touchend", aoSoltar);
    };
  }, [modo, mover]);

  // Vídeo: o "depois" segue o "antes".
  useEffect(() => {
    if (!sincroniza) return;
    const a = va.current;
    const b = vb.current;
    if (!a || !b) return;
    let quadro = 0;
    const alinhar = () => {
      if (Math.abs(b.currentTime - a.currentTime) > 0.1) {
        try {
          b.currentTime = a.currentTime;
        } catch {
          /* ainda sem dados */
        }
      }
      setTempo(a.currentTime);
      if (!a.paused) quadro = window.requestAnimationFrame(alinhar);
    };
    const aoTocar = () => {
      setTocando(true);
      void b.play().catch(() => undefined);
      quadro = window.requestAnimationFrame(alinhar);
    };
    const aoPausar = () => {
      setTocando(false);
      b.pause();
      window.cancelAnimationFrame(quadro);
      alinhar();
    };
    const aoMeta = () => setDuracao(isFinite(a.duration) ? a.duration : 0);
    a.addEventListener("play", aoTocar);
    a.addEventListener("pause", aoPausar);
    a.addEventListener("ended", aoPausar);
    a.addEventListener("loadedmetadata", aoMeta);
    a.addEventListener("seeked", alinhar);
    if (a.readyState >= 1) aoMeta();
    return () => {
      window.cancelAnimationFrame(quadro);
      a.removeEventListener("play", aoTocar);
      a.removeEventListener("pause", aoPausar);
      a.removeEventListener("ended", aoPausar);
      a.removeEventListener("loadedmetadata", aoMeta);
      a.removeEventListener("seeked", alinhar);
    };
  }, [sincroniza, antes.src, depois.src, modo]);

  const tocarOuPausar = () => {
    const a = va.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };
  const irPara = (t: number) => {
    const a = va.current;
    const b = vb.current;
    if (!a) return;
    a.currentTime = t;
    if (b) b.currentTime = t;
    setTempo(t);
  };

  const horizontal = orientacao === "horizontal";
  const rotulo = (lado: "a" | "b", conteudo: ReactNode) =>
    rotulos ? (
      <span
        className="pointer-events-none absolute rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white"
        style={lado === "a" ? { left: 8, top: 8 } : horizontal ? { right: 8, top: 8 } : { left: 8, bottom: 8 }}
      >
        {conteudo}
      </span>
    ) : null;

  let corpo: ReactNode;
  if (modo === "lado_a_lado") {
    corpo = (
      <div className={juntar("grid h-full w-full", horizontal ? "grid-cols-2" : "grid-rows-2")} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        <div className="relative min-w-0 overflow-hidden">
          <Midia tipo={tipo} lado={antes} refVideo={(v) => (va.current = v)} />
          {rotulo("a", antes.rotulo || "Antes")}
        </div>
        <div className={juntar("relative min-w-0 overflow-hidden", horizontal ? "border-l-2" : "border-t-2", "border-white")}>
          <Midia tipo={tipo} lado={depois} refVideo={(v) => (vb.current = v)} />
          {rotulo("a", depois.rotulo || "Depois")}
        </div>
      </div>
    );
  } else if (modo === "alternar") {
    corpo = (
      <button type="button" className="absolute inset-0 h-full w-full cursor-pointer" onClick={() => setMostrandoDepois((x) => !x)} aria-label={mostrandoDepois ? "Mostrar o antes" : "Mostrar o depois"}>
        <Midia tipo={tipo} lado={antes} refVideo={(v) => (va.current = v)} estilo={{ opacity: mostrandoDepois ? 0 : 1 }} />
        <Midia tipo={tipo} lado={depois} refVideo={(v) => (vb.current = v)} estilo={{ opacity: mostrandoDepois ? 1 : 0 }} />
        {rotulo("a", mostrandoDepois ? depois.rotulo || "Depois" : antes.rotulo || "Antes")}
      </button>
    );
  } else {
    const recorte = recorteDoDepois(pos, orientacao);
    corpo = (
      <>
        <Midia tipo={tipo} lado={antes} refVideo={(v) => (va.current = v)} />
        <div className="absolute" style={{ left: 0, top: 0, right: 0, bottom: 0, clipPath: recorte, WebkitClipPath: recorte }}>
          <Midia tipo={tipo} lado={depois} refVideo={(v) => (vb.current = v)} />
        </div>
        {rotulo("a", antes.rotulo || "Antes")}
        {rotulo("b", depois.rotulo || "Depois")}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Divisa entre antes e depois"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-orientation={orientacao}
          onKeyDown={(e) => {
            const n = posicaoPelaTecla(pos, e.key, e.shiftKey);
            if (n === null) return;
            e.preventDefault();
            setPos(n);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            arrastando.current = true;
          }}
          className="absolute z-10 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={
            horizontal
              ? { left: `${pos}%`, top: 0, bottom: 0, width: 28, marginLeft: -14, cursor: "ew-resize" }
              : { top: `${pos}%`, left: 0, right: 0, height: 28, marginTop: -14, cursor: "ns-resize" }
          }
        >
          <span className="absolute bg-white shadow" style={horizontal ? { left: 13, top: 0, bottom: 0, width: 2 } : { top: 13, left: 0, right: 0, height: 2 }} />
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white text-[11px] font-bold text-black shadow">{horizontal ? "‹›" : "⌃"}</span>
        </div>
      </>
    );
  }

  return (
    <div className={juntar("min-w-0", className)} data-comparador={modo}>
      {rotuloGeral && <p className={juntar(texto.rotulo, "mb-1.5")}>{rotuloGeral}</p>}
      {mostrarModos && (
        <div className="mb-2 flex min-w-0 flex-wrap items-center">
          <SeletorCompacto
            rotulo="Modo de comparar"
            valor={modo}
            onEscolher={(v) => setModo(v as ModoDoComparador)}
            opcoes={[
              { valor: "cortina", rotulo: "Cortina" },
              { valor: "lado_a_lado", rotulo: "Lado a lado" },
              { valor: "alternar", rotulo: "Alternar" },
            ]}
          />
          {modo !== "alternar" && (
            <button type="button" className={juntar(botao.discreto, "ml-1")} onClick={() => setOrientacao(horizontal ? "vertical" : "horizontal")} aria-label="Trocar a orientação">
              {horizontal ? "Em pé" : "Deitado"}
            </button>
          )}
          {acoes}
        </div>
      )}
      <div
        ref={caixa}
        className="relative w-full select-none overflow-hidden rounded-md bg-black"
        style={{ paddingBottom: `${Math.round(proporcao * 10000) / 100}%`, touchAction: modo === "cortina" ? (horizontal ? "pan-y" : "pan-x") : undefined }}
        onMouseDown={(e) => {
          if (modo !== "cortina") return;
          arrastando.current = true;
          mover(e.clientX, e.clientY);
        }}
      >
        {corpo}
      </div>
      {tipo === "video" && (
        <div className="mt-2 flex min-w-0 items-center">
          {sincroniza ? (
            <>
              <button type="button" className={botao.icone} onClick={tocarOuPausar} aria-label={tocando ? "Pausar os dois" : "Tocar os dois"}>
                {tocando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, duracao)}
                step={0.04}
                value={Math.min(tempo, duracao || 0)}
                onChange={(e) => irPara(Number(e.target.value))}
                className="mx-2 min-w-0 flex-1"
                aria-label="Tempo dos dois vídeos"
              />
              <span className={juntar(texto.auxiliar, "tabular-nums")}>{tempo.toFixed(1)} s</span>
            </>
          ) : (
            <span className={texto.auxiliar}>Para tocar os dois juntos, use um navegador atualizado.</span>
          )}
        </div>
      )}
    </div>
  );
}
