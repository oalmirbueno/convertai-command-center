import { useEffect, useRef, useState, type MouseEvent as EventoDoMouse, type TouchEvent as EventoDeToque } from "react";
import {
  caixaDe,
  encaixar,
  estadoNoTempo,
  FORMATOS_DO_QUADRO,
  idsDoGrupo,
  type CamadaDoQuadro,
  type Guia,
  type QuadroAnimado,
} from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { alinhamentoDoTexto, caixaDaCamada, estiloDaForma, estiloDaMidia, estiloDoTexto, tempoDaMidia } from "./estiloDaCamada";

/**
 * Palco do Quadro animado (frente CNV, 30/09): as camadas no tempo t, a
 * seleção com as alças de tamanho e de giro, o arrasto com encaixe (centro,
 * bordas, margem de segurança e as outras camadas) e as guias. Serve também
 * de miniatura (soLeitura), com o mesmo desenho do render.
 *
 * Piso Safari 11 / Chrome 64: sem Pointer Events; mouse e toque à parte, com
 * os ouvintes na janela durante o arrasto. Tamanho do quadro em px (sem
 * aspect-ratio): quem chama passa a largura e a altura sai do formato.
 */

type Gesto =
  | { tipo: "mover"; x0: number; y0: number; caixas: Record<string, { x: number; y: number; chaves: CamadaDoQuadro["chaves"] }>; outras: { x: number; y: number; l: number; a: number }[]; uniao: { x: number; y: number; l: number; a: number } }
  | { tipo: "tamanho"; canto: "nw" | "ne" | "sw" | "se" | "e" | "s"; x0: number; y0: number; id: string; caixa: { x: number; y: number; l: number; a: number }; proporcao: boolean }
  | { tipo: "giro"; id: string; cx: number; cy: number };

function ponto(e: MouseEvent | TouchEvent | EventoDoMouse | EventoDeToque): { x: number; y: number } | null {
  const toques = (e as TouchEvent).touches || (e as TouchEvent).changedTouches;
  if (toques && toques.length) return { x: toques[0].clientX, y: toques[0].clientY };
  const m = e as MouseEvent;
  return typeof m.clientX === "number" ? { x: m.clientX, y: m.clientY } : null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

function MidiaNoPalco({ c, url, t, tocando, largura }: { c: CamadaDoQuadro; url: string | null; t: number; tocando: boolean; largura: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const alvo = tempoDaMidia(c, t);
  useEffect(() => {
    const v = ref.current;
    if (!v || c.tipo !== "video") return;
    try {
      if (tocando) {
        if (Math.abs(v.currentTime - alvo) > 0.35) v.currentTime = alvo;
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => undefined);
      } else {
        v.pause();
        if (Math.abs(v.currentTime - alvo) > 0.04) v.currentTime = alvo;
      }
    } catch {
      /* vídeo ainda sem dados: acerta no próximo quadro */
    }
  }, [tocando, alvo, c.tipo]);
  if (!url) {
    return <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.08)", borderRadius: Math.round(c.canto * largura) }} />;
  }
  if (c.tipo === "video") return <video ref={ref} src={url} muted playsInline preload="auto" style={estiloDaMidia(c, largura)} />;
  return <img src={url} alt="" draggable={false} style={estiloDaMidia(c, largura)} />;
}

export function CamadaNoPalco({ c, t, url, largura, tocando }: { c: CamadaDoQuadro; t: number; url: string | null; largura: number; tocando: boolean }) {
  const e = estadoNoTempo(c, t);
  if (!e.visivel) return null;
  const caixa = caixaDaCamada(c, e);
  return (
    <div style={{ ...caixa, overflow: c.tipo === "texto" ? "visible" : "hidden", pointerEvents: "none" }} data-camada-no-palco={c.id}>
      {c.tipo === "texto" ? (
        <div style={alinhamentoDoTexto(c)}>
          <span style={estiloDoTexto(c, largura)}>{c.texto}</span>
        </div>
      ) : c.tipo === "forma" ? (
        <div style={estiloDaForma(c, largura)} />
      ) : (
        <MidiaNoPalco c={c} url={url} t={t} tocando={tocando} largura={largura} />
      )}
    </div>
  );
}

export default function PalcoDoQuadro({
  quadro,
  t,
  urls,
  largura,
  selecionadas = [],
  onSelecionar,
  onMudarCamadas,
  onEditarTexto,
  soLeitura = false,
  tocando = false,
}: {
  quadro: QuadroAnimado;
  t: number;
  urls: Record<string, string>;
  largura: number;
  selecionadas?: string[];
  onSelecionar?: (ids: string[], somar: boolean) => void;
  /** Mudança de posição, tamanho ou giro; `juntar` agrupa o arrasto num passo do desfazer. */
  onMudarCamadas?: (fn: (camadas: CamadaDoQuadro[]) => CamadaDoQuadro[], juntar: string) => void;
  onEditarTexto?: (id: string) => void;
  soLeitura?: boolean;
  tocando?: boolean;
}) {
  const f = FORMATOS_DO_QUADRO[quadro.formato] || FORMATOS_DO_QUADRO["9:16"];
  const altura = Math.round((largura * f.altura) / f.largura);
  const palco = useRef<HTMLDivElement | null>(null);
  const gesto = useRef<Gesto | null>(null);
  const [guias, setGuias] = useState<Guia[]>([]);
  const camadas = quadro.camadas;
  const atuais = useRef(camadas);
  atuais.current = camadas;

  const fracao = (p: { x: number; y: number }) => {
    const r = palco.current ? palco.current.getBoundingClientRect() : { left: 0, top: 0, width: largura, height: altura };
    return { x: (p.x - r.left) / (r.width || 1), y: (p.y - r.top) / (r.height || 1) };
  };

  useEffect(() => {
    if (soLeitura) return;
    const mover = (ev: MouseEvent | TouchEvent) => {
      const g = gesto.current;
      if (!g || !onMudarCamadas) return;
      const p = ponto(ev);
      if (!p) return;
      if (ev.cancelable) ev.preventDefault();
      const fr = fracao(p);
      const semEncaixe = (ev as MouseEvent).altKey === true;
      if (g.tipo === "mover") {
        let dx = fr.x - g.x0;
        let dy = fr.y - g.y0;
        const uniao = { x: g.uniao.x + dx, y: g.uniao.y + dy, l: g.uniao.l, a: g.uniao.a };
        if (!semEncaixe) {
          const enc = encaixar(uniao, g.outras);
          dx += enc.x - uniao.x;
          dy += enc.y - uniao.y;
          setGuias(enc.guias);
        } else setGuias([]);
        // As chaves de posição andam junto (o movimento da camada continua o mesmo, em outro lugar).
        const andar = (k: CamadaDoQuadro["chaves"][number]) => {
          const n = { ...k };
          if (typeof k.x === "number") n.x = r4(k.x + dx);
          if (typeof k.y === "number") n.y = r4(k.y + dy);
          return n;
        };
        onMudarCamadas((lista) => lista.map((c) => (g.caixas[c.id] ? { ...c, x: r4(g.caixas[c.id].x + dx), y: r4(g.caixas[c.id].y + dy), chaves: g.caixas[c.id].chaves.map(andar) } : c)), "mover");
      }
      if (g.tipo === "tamanho") {
        const dx = fr.x - g.x0;
        const dy = fr.y - g.y0;
        const b = g.caixa;
        let x = b.x;
        let y = b.y;
        let l = b.l;
        let a = b.a;
        if (g.canto === "se" || g.canto === "ne" || g.canto === "e") l = Math.max(0.01, b.l + dx);
        if (g.canto === "sw" || g.canto === "nw") {
          l = Math.max(0.01, b.l - dx);
          x = b.x + b.l - l;
        }
        if (g.canto === "se" || g.canto === "sw" || g.canto === "s") a = Math.max(0.005, b.a + dy);
        if (g.canto === "ne" || g.canto === "nw") {
          a = Math.max(0.005, b.a - dy);
          y = b.y + b.a - a;
        }
        const manter = g.proporcao !== ((ev as MouseEvent).shiftKey === true);
        if (manter && g.canto !== "e" && g.canto !== "s") {
          const k = l / b.l;
          a = b.a * k;
          if (g.canto === "ne" || g.canto === "nw") y = b.y + b.a - a;
        }
        onMudarCamadas((lista) => lista.map((c) => (c.id === g.id ? { ...c, x: r4(x), y: r4(y), l: r4(l), a: r4(a) } : c)), "tamanho");
      }
      if (g.tipo === "giro") {
        const px = fr.x * f.largura;
        const py = fr.y * f.altura;
        let ang = (Math.atan2(py - g.cy, px - g.cx) * 180) / Math.PI + 90;
        if (ang > 180) ang -= 360;
        if ((ev as MouseEvent).shiftKey || Math.abs(ang % 45) < 3 || Math.abs(ang % 45) > 42) ang = Math.round(ang / 15) * 15;
        onMudarCamadas((lista) => lista.map((c) => (c.id === g.id ? { ...c, rotacao: r4(ang) } : c)), "giro");
      }
    };
    const soltar = () => {
      gesto.current = null;
      setGuias([]);
    };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    window.addEventListener("touchmove", mover, { passive: false });
    window.addEventListener("touchend", soltar);
    window.addEventListener("touchcancel", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
      window.removeEventListener("touchmove", mover);
      window.removeEventListener("touchend", soltar);
      window.removeEventListener("touchcancel", soltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soLeitura, onMudarCamadas, largura, quadro.formato]);

  /** A camada de cima que está sob o ponto (as travadas e escondidas não pegam). */
  const camadaNoPonto = (fr: { x: number; y: number }): CamadaDoQuadro | null => {
    for (let i = camadas.length - 1; i >= 0; i--) {
      const c = camadas[i];
      if (!c.visivel || c.travada) continue;
      const e = estadoNoTempo(c, t);
      if (!e.visivel) continue;
      if (fr.x >= e.x && fr.x <= e.x + c.l && fr.y >= e.y && fr.y <= e.y + c.a) return c;
    }
    return null;
  };

  const comecar = (ev: EventoDoMouse | EventoDeToque) => {
    if (soLeitura || !onSelecionar) return;
    const p = ponto(ev);
    if (!p) return;
    const fr = fracao(p);
    const alvo = camadaNoPonto(fr);
    const somar = (ev as EventoDoMouse).shiftKey === true || (ev as EventoDoMouse).metaKey === true || (ev as EventoDoMouse).ctrlKey === true;
    if (!alvo) {
      if (!somar) onSelecionar([], false);
      return;
    }
    const grupo = idsDoGrupo(camadas, alvo.id);
    const jaSelecionada = selecionadas.indexOf(alvo.id) >= 0;
    const ids = somar ? (jaSelecionada ? selecionadas.filter((x) => grupo.indexOf(x) < 0) : selecionadas.concat(grupo)) : jaSelecionada ? selecionadas : grupo;
    onSelecionar(ids, false);
    if (somar && jaSelecionada) return;
    const movendo = camadas.filter((c) => ids.indexOf(c.id) >= 0 && !c.travada);
    if (!movendo.length || !onMudarCamadas) return;
    const caixas: Record<string, { x: number; y: number; chaves: CamadaDoQuadro["chaves"] }> = {};
    movendo.forEach((c) => (caixas[c.id] = { x: c.x, y: c.y, chaves: c.chaves }));
    gesto.current = {
      tipo: "mover",
      x0: fr.x,
      y0: fr.y,
      caixas,
      uniao: caixaDe(movendo),
      outras: camadas.filter((c) => ids.indexOf(c.id) < 0 && c.visivel && !(c.x <= 0.001 && c.y <= 0.001 && c.l >= 0.999 && c.a >= 0.999)).map((c) => ({ x: c.x, y: c.y, l: c.l, a: c.a })),
    };
  };

  const comecarTamanho = (ev: EventoDoMouse | EventoDeToque, c: CamadaDoQuadro, canto: "nw" | "ne" | "sw" | "se" | "e" | "s") => {
    ev.stopPropagation();
    const p = ponto(ev);
    if (!p) return;
    const fr = fracao(p);
    gesto.current = { tipo: "tamanho", canto, x0: fr.x, y0: fr.y, id: c.id, caixa: { x: c.x, y: c.y, l: c.l, a: c.a }, proporcao: c.tipo === "imagem" || c.tipo === "video" || c.tipo === "logo" };
  };

  const comecarGiro = (ev: EventoDoMouse | EventoDeToque, c: CamadaDoQuadro) => {
    ev.stopPropagation();
    gesto.current = { tipo: "giro", id: c.id, cx: (c.x + c.l / 2) * f.largura, cy: (c.y + c.a / 2) * f.altura };
  };

  const escolhidas = soLeitura ? [] : camadas.filter((c) => selecionadas.indexOf(c.id) >= 0);
  const unica = escolhidas.length === 1 ? escolhidas[0] : null;
  const ALCA = 10;
  const alca = (canto: "nw" | "ne" | "sw" | "se" | "e" | "s", c: CamadaDoQuadro) => {
    const pos: Record<string, { left: string; top: string; cursor: string }> = {
      nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
      ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
      sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
      se: { left: "100%", top: "100%", cursor: "nwse-resize" },
      e: { left: "100%", top: "50%", cursor: "ew-resize" },
      s: { left: "50%", top: "100%", cursor: "ns-resize" },
    };
    return (
      <span
        key={canto}
        onMouseDown={(e) => comecarTamanho(e, c, canto)}
        onTouchStart={(e) => comecarTamanho(e, c, canto)}
        style={{ position: "absolute", left: pos[canto].left, top: pos[canto].top, width: ALCA, height: ALCA, marginLeft: -ALCA / 2, marginTop: -ALCA / 2, background: "#ffffff", border: "1.5px solid #10b981", borderRadius: 2, cursor: pos[canto].cursor, pointerEvents: "auto" }}
        data-alca-de-tamanho={canto}
        aria-hidden="true"
      />
    );
  };

  return (
    <div
      ref={palco}
      className="relative select-none overflow-hidden"
      style={{ width: largura, height: altura, background: quadro.fundo, touchAction: soLeitura ? "auto" : "none" }}
      onMouseDown={comecar}
      onTouchStart={comecar}
      onDoubleClick={(e) => {
        const p = ponto(e);
        const alvo = p ? camadaNoPonto(fracao(p)) : null;
        if (alvo && alvo.tipo === "texto" && onEditarTexto) onEditarTexto(alvo.id);
      }}
      data-palco-do-quadro={soLeitura ? "miniatura" : "editor"}
      data-formato={quadro.formato}
    >
      {camadas.map((c) => (
        <CamadaNoPalco key={c.id} c={c} t={t} url={c.midia ? urls[c.midia.caminho] || null : null} largura={largura} tocando={tocando} />
      ))}
      {!soLeitura && (
        <>
          {/* Margem de segurança (6%): o que é importante fica dentro dela. */}
          <div className="pointer-events-none absolute border border-dashed border-white/20" style={{ left: "6%", top: "6%", right: "6%", bottom: "6%" }} aria-hidden="true" />
          {guias.map((g, i) => (
            <div
              key={i}
              className="pointer-events-none absolute bg-fuchsia-400"
              style={g.eixo === "v" ? { left: `${g.pos * 100}%`, top: 0, bottom: 0, width: 1 } : { top: `${g.pos * 100}%`, left: 0, right: 0, height: 1 }}
              data-guia={g.eixo}
            />
          ))}
          {escolhidas.map((c) => {
            const e = estadoNoTempo(c, t);
            return (
              <div
                key={`sel-${c.id}`}
                className="pointer-events-none absolute"
                style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, width: `${c.l * 100}%`, height: `${c.a * 100}%`, transform: `rotate(${e.rotacao}deg)`, WebkitTransform: `rotate(${e.rotacao}deg)`, outline: `1.5px solid ${c.travada ? "#f59e0b" : "#10b981"}` }}
                data-selecao={c.id}
              >
                {unica && unica.id === c.id && !c.travada && (
                  <>
                    {(["nw", "ne", "sw", "se", "e", "s"] as const).map((k) => alca(k, c))}
                    <span
                      onMouseDown={(ev) => comecarGiro(ev, c)}
                      onTouchStart={(ev) => comecarGiro(ev, c)}
                      style={{ position: "absolute", left: "50%", top: -28, width: 14, height: 14, marginLeft: -7, borderRadius: 9999, background: "#10b981", border: "2px solid #ffffff", cursor: "grab", pointerEvents: "auto" }}
                      data-alca-de-giro=""
                      aria-hidden="true"
                    />
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
