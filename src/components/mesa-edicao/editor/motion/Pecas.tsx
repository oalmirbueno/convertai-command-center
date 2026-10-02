import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { continueRender, delayRender, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { IdDaPeca, ParametrosDaPeca } from "../../../../lib/editor/motion/catalogo";

/**
 * Peças de motion da Aceleriq (frente EDT, F3, 30/09/2026). Componentes
 * Remotion PRÓPRIOS (nada copiado do pacote comprado): a mesma peça toca na
 * prévia (Player) e sai no render (worker). Tudo sai do quadro atual
 * (useCurrentFrame), sem relógio e sem sorteio. O tempo de cada item vem de
 * `tempos` (s desde o começo do clipe), tirado da palavra medida
 * (src/lib/editor/motion/catalogo.ts, temposDosItens).
 *
 * Sem import de "@/": o worker empacota este arquivo com o Remotion.
 */

export const VERDE_ACELERIQ = "#00FF66";

/**
 * Fontes livres (OFL) servidas pelo painel em /editor/fontes e copiadas pelo
 * worker (a pasta inteira). Em WOFF2, as mesmas letras dos .ttf ao lado, com
 * 67% menos peso (1,15 MB viravam download ao abrir o player). Os .ttf ficam:
 * o HyperFrames e os pedidos já gravados usam esses nomes.
 */
export const FONTES_DO_MOTION: { familia: string; arquivo: string; peso: string }[] = [
  { familia: "Montserrat", arquivo: "editor/fontes/Montserrat-Variable.woff2", peso: "100 900" },
  { familia: "Anton", arquivo: "editor/fontes/Anton-Regular.woff2", peso: "400" },
  { familia: "Caveat", arquivo: "editor/fontes/Caveat-Variable.woff2", peso: "400 700" },
  { familia: "Figtree", arquivo: "editor/fontes/Figtree-Variable.woff2", peso: "300 900" },
];

const SANS = "Montserrat, Outfit, Inter, sans-serif";
const FORTE = "Anton, Montserrat, sans-serif";
const MAO = "Caveat, 'Comic Sans MS', cursive";
const TEXTO = "Figtree, Outfit, Inter, sans-serif";

/**
 * Carrega as fontes antes do primeiro quadro (no render, o quadro espera:
 * delayRender). Sem FontFace (teste, navegador velho) segue com a reserva.
 */
export function CarregarFontes({ url }: { url: (caminho: string) => string }) {
  const [handle] = useState(() => (typeof window !== "undefined" && typeof (window as unknown as { FontFace?: unknown }).FontFace === "function" ? delayRender("fontes do motion") : null));
  useEffect(() => {
    if (handle === null) return;
    let vivo = true;
    const F = (window as unknown as { FontFace: new (f: string, s: string, d?: Record<string, string>) => { load: () => Promise<unknown> } }).FontFace;
    Promise.all(
      FONTES_DO_MOTION.map((f) =>
        new F(f.familia, `url(${url(f.arquivo)}) format('woff2')`, { weight: f.peso })
          .load()
          .then((ff) => (document as unknown as { fonts: { add: (x: unknown) => void } }).fonts.add(ff))
          .catch(() => null),
      ),
    ).finally(() => {
      if (vivo) continueRender(handle);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);
  return null;
}

/**
 * A letra da marca (arquivo do cliente): no render a URL já vem pronta e o
 * quadro espera (delayRender); na prévia a URL assinada chega depois e a
 * letra entra quando carregar. Falha vira aviso no console e o estilo segue
 * com a reserva (nunca trava o render).
 */
export function CarregarFonteDaMarca({ familia, url }: { familia: string | null; url: string | null }) {
  const temFontFace = typeof window !== "undefined" && typeof (window as unknown as { FontFace?: unknown }).FontFace === "function";
  const [handle] = useState(() => (temFontFace && familia && url ? delayRender("letra da marca") : null));
  useEffect(() => {
    let vivo = true;
    const soltar = () => {
      if (vivo && handle !== null) continueRender(handle);
    };
    if (!temFontFace || !familia || !url) {
      soltar();
      return;
    }
    const F = (window as unknown as { FontFace: new (f: string, s: string) => { load: () => Promise<unknown> } }).FontFace;
    new F(familia, `url(${url})`)
      .load()
      .then((ff) => (document as unknown as { fonts: { add: (x: unknown) => void } }).fonts.add(ff))
      .catch((e: unknown) => console.error(`[editor] a letra da marca (${familia}) não carregou`, e))
      .then(soltar);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familia, url]);
  return null;
}

export interface PropsDaPeca {
  peca: IdDaPeca;
  params: ParametrosDaPeca;
  /** Tempos (s desde o começo do clipe) dos itens, quando a peça tem itens. */
  tempos?: number[];
  /** Quanto o clipe já tinha andado (amostra que começa no meio). */
  desdeS?: number;
  duracaoQuadros: number;
  /** URL da imagem (polaroide, logo). */
  imagem?: string | null;
  /** Cor da marca (paleta do cliente) quando a peça não traz a própria. */
  corDaMarca?: string | null;
  /** 02/10: segunda cor da marca (identidade.cor2) e a letra da marca (família já carregada). */
  cor2?: string | null;
  letra?: string | null;
}

const txt = (v: unknown, padrao = "") => (typeof v === "string" && v ? v : padrao);
const num = (v: unknown, padrao = 0) => (typeof v === "number" && isFinite(v) ? v : padrao);
const lista = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

function useQuadro(desdeS = 0) {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  return { f: f + Math.round(desdeS * fps), fps, L: width, A: height };
}

/** Entrada com mola e saída suave nos últimos 0,3 s. */
function entradaSaida(f: number, fps: number, duracao: number, atraso = 0) {
  const e = spring({ frame: f - atraso, fps, config: { damping: 14, stiffness: 170, mass: 0.7 } });
  const s = interpolate(f, [duracao - Math.round(0.3 * fps), duracao], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { e, s };
}

const cheio: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" };

/** Texto legível sobre a cor (luminância): escuro sobre cor clara, branco sobre cor escura. */
export function tintaSobre(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const c = [m[1], m[2], m[3]].map((x) => {
    const v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? "#141414" : "#ffffff";
}

const saidaCubica = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const letraDe = (p: PropsDaPeca, reserva: string) => (p.letra ? `'${p.letra}', ${reserva}` : reserva);

function Centro({ children, topo = "50%" }: { children: ReactNode; topo?: string }) {
  return (
    <div style={{ ...cheio, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: topo, transform: "translateY(-50%)", display: "flex", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ peças

function Rotulo({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const pos = txt(params.posicao, "topo");
  const topo = pos === "base" ? "76%" : pos === "meio" ? "48%" : "14%";
  return (
    <Centro topo={topo}>
      <div style={{ transform: `translateY(${(1 - e) * 30}px) rotate(${-3 + e * 1.5}deg) scale(${0.8 + e * 0.2})`, opacity: s * Math.min(1, e * 1.4), background: "#fffdf6", color: "#1a1a1a", padding: `${L * 0.012}px ${L * 0.035}px`, borderRadius: L * 0.012, fontFamily: MAO, fontWeight: 700, fontSize: L * 0.07, boxShadow: "0 10px 30px rgba(0,0,0,0.35)", borderBottom: `${L * 0.008}px solid ${cor}` }}>{txt(params.texto)}</div>
    </Centro>
  );
}

function Carimbo({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const escala = interpolate(e, [0, 1], [2.4, 1]);
  return (
    <Centro topo="42%">
      <div style={{ transform: `rotate(-12deg) scale(${escala})`, opacity: s * Math.min(1, e * 2), border: `${L * 0.012}px solid ${cor}`, color: cor, padding: `${L * 0.01}px ${L * 0.04}px`, borderRadius: L * 0.02, fontFamily: FORTE, fontSize: L * 0.12, letterSpacing: "0.04em", background: "rgba(0,0,0,0.25)" }}>{txt(params.texto).toUpperCase()}</div>
    </Centro>
  );
}

function Lista({ params, tempos, desdeS, duracaoQuadros, cor, passos }: PropsDaPeca & { cor: string; passos?: boolean }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const itens = lista(params.itens);
  const riscada = params.modo === "riscada";
  return (
    <Centro topo="64%">
      <div style={{ width: "82%", opacity: s, transform: `translateY(${(1 - e) * 40}px)`, background: "rgba(12,12,12,0.82)", borderRadius: L * 0.03, padding: `${L * 0.04}px ${L * 0.05}px`, fontFamily: SANS, color: "#fff" }}>
        {txt(params.titulo) && <div style={{ fontSize: L * 0.045, fontWeight: 800, marginBottom: L * 0.02, color: cor }}>{txt(params.titulo)}</div>}
        {itens.map((it, k) => {
          const t = Math.round(((tempos && tempos[k] !== undefined ? tempos[k] : 0.15 + k * 0.5)) * fps);
          const ei = spring({ frame: f - t, fps, config: { damping: 16, stiffness: 180 } });
          const marca = interpolate(f - t, [Math.round(0.15 * fps), Math.round(0.45 * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", fontSize: L * 0.05, fontWeight: 700, margin: `${L * 0.012}px 0`, opacity: ei, transform: `translateX(${(1 - ei) * -40}px)` }}>
              <span style={{ width: L * 0.07, height: L * 0.07, marginRight: L * 0.025, borderRadius: passos ? "50%" : L * 0.012, background: passos ? cor : "transparent", border: passos ? "none" : `${L * 0.005}px solid ${cor}`, color: passos ? "#0b0b0b" : cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: L * 0.042, flexShrink: 0 }}>
                {passos ? k + 1 : riscada ? "" : marca > 0.5 ? "✓" : ""}
              </span>
              <span style={{ position: "relative" }}>
                {it}
                {riscada && <span style={{ position: "absolute", left: 0, top: "52%", height: L * 0.006, width: `${marca * 100}%`, background: "#ff4d4d" }} />}
              </span>
            </div>
          );
        })}
      </div>
    </Centro>
  );
}

function Contador({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const de = num(params.de, 0);
  const ate = num(params.ate, 0);
  const p = interpolate(f, [Math.round(0.15 * fps), Math.round(1.2 * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3) });
  const casas = Math.abs(ate % 1) > 0 ? 1 : 0;
  const valor = (de + (ate - de) * p).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return (
    <Centro topo="40%">
      <div style={{ textAlign: "center", opacity: s, transform: `scale(${0.7 + e * 0.3})` }}>
        <div style={{ fontFamily: FORTE, fontSize: L * 0.2, color: cor, lineHeight: 1, textShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
          {txt(params.prefixo)}
          {valor}
          {txt(params.sufixo)}
        </div>
        {txt(params.legenda) && <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: L * 0.045, color: "#fff", marginTop: L * 0.01, textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>{txt(params.legenda)}</div>}
      </div>
    </Centro>
  );
}

function Notificacao({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", top: `${4 + (1 - e) * -12}%`, opacity: s, fontFamily: TEXTO }}>
      <div style={{ display: "flex", alignItems: "center", background: "rgba(245,245,245,0.96)", borderRadius: L * 0.04, padding: `${L * 0.025}px ${L * 0.03}px`, boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}>
        <div style={{ width: L * 0.1, height: L * 0.1, borderRadius: L * 0.024, background: cor, marginRight: L * 0.025, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: L * 0.03, color: "#666", fontWeight: 600 }}>{txt(params.app, "Mensagem")} · agora</div>
          <div style={{ fontSize: L * 0.042, color: "#111", fontWeight: 800 }}>{txt(params.titulo)}</div>
          {txt(params.texto) && <div style={{ fontSize: L * 0.035, color: "#333" }}>{txt(params.texto)}</div>}
        </div>
      </div>
    </div>
  );
}

function Polaroide({ params, desdeS, duracaoQuadros, imagem }: PropsDaPeca) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  return (
    <Centro topo="42%">
      <div style={{ background: "#fbfbf7", padding: `${L * 0.03}px ${L * 0.03}px ${L * 0.1}px`, transform: `rotate(${interpolate(e, [0, 1], [14, -4])}deg) translateY(${(1 - e) * 200}px)`, opacity: s, boxShadow: "0 18px 40px rgba(0,0,0,0.45)", width: L * 0.62 }}>
        <div style={{ width: "100%", height: L * 0.56, background: "#ddd", overflow: "hidden" }}>{imagem ? <Img src={imagem} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}</div>
        {txt(params.legenda) && <div style={{ fontFamily: MAO, fontSize: L * 0.06, color: "#222", textAlign: "center", marginTop: L * 0.02 }}>{txt(params.legenda)}</div>}
      </div>
    </Centro>
  );
}

function CartaoFinal(props: PropsDaPeca & { cor: string }) {
  const { params, desdeS, duracaoQuadros, cor, imagem } = props;
  const { f, fps, L } = useQuadro(desdeS);
  const e = spring({ frame: f, fps, config: { damping: 16, stiffness: 140 } });
  const e2 = spring({ frame: f - Math.round(0.35 * fps), fps, config: { damping: 14 } });
  const s = interpolate(f, [duracaoQuadros - 4, duracaoQuadros], [1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ ...cheio, background: `rgba(8,8,8,${0.88 * e})`, opacity: s, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      {imagem && <Img src={imagem} style={{ maxWidth: "46%", maxHeight: "18%", objectFit: "contain", marginBottom: L * 0.05, transform: `scale(${0.8 + 0.2 * e})`, opacity: e }} />}
      <div style={{ color: "#fff", fontFamily: letraDe(props, SANS), fontWeight: 900, fontSize: L * 0.075, textAlign: "center", padding: "0 8%", transform: `translateY(${(1 - e) * 40}px)`, opacity: e }}>{txt(params.titulo)}</div>
      {txt(params.botao) && <div style={{ marginTop: L * 0.05, background: cor, color: tintaSobre(cor), fontWeight: 800, fontSize: L * 0.05, padding: `${L * 0.02}px ${L * 0.06}px`, borderRadius: L * 0.06, transform: `scale(${e2})` }}>{txt(params.botao)}</div>}
    </div>
  );
}

function Lettering(props: PropsDaPeca & { cor: string }) {
  const { params, tempos, desdeS, duracaoQuadros, cor } = props;
  const { f, fps, L } = useQuadro(desdeS);
  const palavras = lista(params.palavras);
  const ts = palavras.map((_, k) => Math.round(((tempos && tempos[k] !== undefined ? tempos[k] : (k * duracaoQuadros) / Math.max(1, palavras.length) / fps)) * fps));
  let atual = 0;
  ts.forEach((t, k) => f >= t && (atual = k));
  const e = spring({ frame: f - ts[atual], fps, config: { damping: 12, stiffness: 200 } });
  const s = interpolate(f, [duracaoQuadros - Math.round(0.25 * fps), duracaoQuadros], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Centro topo="38%">
      <div style={{ fontFamily: letraDe(props, FORTE), fontSize: L * 0.14, color: atual % 2 ? cor : "#fff", transform: `scale(${0.6 + 0.4 * e})`, opacity: s, textAlign: "center", lineHeight: 1, padding: "0 6%", textShadow: "0 8px 30px rgba(0,0,0,0.55)" }}>{(palavras[atual] || "").toUpperCase()}</div>
    </Centro>
  );
}

function Barra({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const alvo = Math.max(0, Math.min(100, num(params.valor, 0)));
  const p = interpolate(f, [Math.round(0.2 * fps), Math.round(1.1 * fps)], [0, alvo], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3) });
  return (
    <div style={{ position: "absolute", left: "8%", right: "8%", top: "62%", opacity: s * e, fontFamily: SANS, color: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: L * 0.045, marginBottom: L * 0.015, textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>
        <span>{txt(params.rotulo)}</span>
        <span style={{ color: cor }}>{Math.round(p)}%</span>
      </div>
      <div style={{ height: L * 0.035, borderRadius: L * 0.02, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: cor, borderRadius: L * 0.02 }} />
      </div>
    </div>
  );
}

function Preco({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const risco = interpolate(f, [Math.round(0.4 * fps), Math.round(0.7 * fps)], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Centro topo="44%">
      <div style={{ transform: `rotate(-4deg) translateY(${(1 - e) * -160}px)`, opacity: s, background: cor, color: "#0a0a0a", padding: `${L * 0.03}px ${L * 0.06}px`, borderRadius: L * 0.03, fontFamily: SANS, textAlign: "center", boxShadow: "0 16px 40px rgba(0,0,0,0.4)" }}>
        {txt(params.rotulo) && <div style={{ fontSize: L * 0.035, fontWeight: 700 }}>{txt(params.rotulo)}</div>}
        {txt(params.de) && (
          <div style={{ fontSize: L * 0.045, fontWeight: 700, position: "relative", display: "inline-block", opacity: 0.7 }}>
            {txt(params.de)}
            <span style={{ position: "absolute", left: 0, top: "50%", height: L * 0.006, width: `${risco}%`, background: "#0a0a0a" }} />
          </div>
        )}
        <div style={{ fontSize: L * 0.11, fontWeight: 900, lineHeight: 1.05 }}>{txt(params.por)}</div>
      </div>
    </Centro>
  );
}

function Comentario({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  return (
    <div style={{ position: "absolute", left: "7%", right: "7%", top: "64%", opacity: s, transform: `scale(${0.85 + 0.15 * e})`, transformOrigin: "0% 50%", fontFamily: TEXTO }}>
      <div style={{ display: "flex", alignItems: "flex-start", background: "#ffffff", borderRadius: L * 0.035, padding: `${L * 0.025}px ${L * 0.03}px`, boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}>
        <div style={{ width: L * 0.08, height: L * 0.08, borderRadius: "50%", background: cor, marginRight: L * 0.025, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: L * 0.032, fontWeight: 800, color: "#111" }}>{txt(params.usuario, "você")}</div>
          <div style={{ fontSize: L * 0.042, color: "#222", fontWeight: 600 }}>{txt(params.texto)}</div>
        </div>
      </div>
    </div>
  );
}

function Selo({ params, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const giro = interpolate(f, [0, duracaoQuadros], [0, 25]);
  const r = L * 0.2;
  return (
    <div style={{ position: "absolute", right: "8%", top: "18%", width: r * 2, height: r * 2, opacity: s, transform: `scale(${e}) rotate(${giro - 15}deg)` }}>
      <div style={{ ...cheio, borderRadius: "50%", background: cor, border: `${L * 0.01}px dashed rgba(0,0,0,0.35)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#0a0a0a", fontFamily: SANS, textAlign: "center" }}>
        <div style={{ fontWeight: 900, fontSize: L * 0.05, lineHeight: 1.05, padding: "0 12%" }}>{txt(params.texto)}</div>
        {txt(params.subtitulo) && <div style={{ fontWeight: 700, fontSize: L * 0.028, marginTop: L * 0.008 }}>{txt(params.subtitulo)}</div>}
      </div>
    </div>
  );
}

/** Logo do cliente (entra pelo código, nunca pelo gerador): no canto o vídeo todo, no fim ou como abertura. */
function Logo({ params, desdeS, duracaoQuadros, imagem, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const onde = txt(params.onde, "canto");
  const e = spring({ frame: f, fps, config: { damping: 15 } });
  const s = interpolate(f, [duracaoQuadros - Math.round(0.3 * fps), duracaoQuadros], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (!imagem) return null;
  if (onde === "canto") {
    return <Img src={imagem} style={{ position: "absolute", right: L * 0.05, top: L * 0.05, width: L * 0.16, height: L * 0.16, objectFit: "contain", opacity: 0.9 * Math.min(e, s) }} />;
  }
  const escala = onde === "sting" ? interpolate(f, [0, Math.round(0.6 * fps)], [1.6, 1], { extrapolateRight: "clamp" }) : 0.85 + 0.15 * e;
  return (
    <div style={{ ...cheio, background: onde === "sting" ? "#0a0a0a" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", opacity: s }}>
      <Img src={imagem} style={{ width: "46%", maxHeight: "30%", objectFit: "contain", transform: `scale(${escala})`, opacity: e, filter: onde === "sting" ? `drop-shadow(0 0 ${L * 0.03}px ${cor})` : undefined }} />
    </div>
  );
}

// ------------------------------------------------------------------ peças de edição da casa (02/10)

/**
 * Título do gancho: as palavras-chave da primeira frase, grandes, na letra
 * da marca, cada linha entrando (máscara de baixo para cima) quando é dita.
 * Fica na faixa de baixo (66%): o rosto do talking head fica livre.
 */
function Gancho(p: PropsDaPeca & { cor: string }) {
  const { params, tempos, desdeS, duracaoQuadros, cor } = p;
  const { f, fps, L } = useQuadro(desdeS);
  const linhas = lista(params.linhas).slice(0, 3);
  const maior = linhas.reduce((n, l) => Math.max(n, l.length), 1);
  const tamanho = Math.min(L * 0.12, (L * 0.86) / (maior * 0.56));
  const s = interpolate(f, [duracaoQuadros - Math.round(0.25 * fps), duracaoQuadros], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tinta = tintaSobre(cor);
  return (
    <div style={{ position: "absolute", left: "6%", right: "6%", top: txt(params.faixa) === "alto" ? "8%" : "60%", display: "flex", flexDirection: "column", alignItems: "center", opacity: s, transform: `scale(${0.96 + 0.04 * s})` }}>
      {linhas.map((l, k) => {
        const t = Math.round((tempos && tempos[k] !== undefined ? tempos[k] : k * 0.35) * fps);
        const e = spring({ frame: f - t, fps, config: { damping: 15, stiffness: 190, mass: 0.6 } });
        const ultima = k === linhas.length - 1 && linhas.length > 1;
        return (
          <div key={k} style={{ overflow: "hidden", paddingBottom: L * 0.006, marginTop: k ? L * 0.008 : 0 }}>
            <div
              style={{
                transform: `translateY(${(1 - e) * 110}%)`,
                fontFamily: letraDe(p, FORTE),
                fontSize: tamanho,
                lineHeight: 1.04,
                color: ultima ? tinta : "#ffffff",
                background: ultima ? cor : "transparent",
                padding: ultima ? `${L * 0.004}px ${L * 0.03}px` : 0,
                borderRadius: ultima ? L * 0.014 : 0,
                textAlign: "center",
                textShadow: ultima ? "none" : "0 6px 26px rgba(0,0,0,0.6)",
                letterSpacing: "0.01em",
              }}
            >
              {l}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Palavra em destaque: a barra da marca varre por trás e a palavra entra com mola, sem tapar o rosto. */
function Destaque(p: PropsDaPeca & { cor: string }) {
  const { params, desdeS, duracaoQuadros, cor } = p;
  const { f, fps, L } = useQuadro(desdeS);
  const { e, s } = entradaSaida(f, fps, duracaoQuadros);
  const varre = saidaCubica(f / Math.max(1, Math.round(0.28 * fps)));
  const texto = txt(params.texto);
  const lado = txt(params.lado, "centro");
  const tamanho = Math.min(L * 0.13, (L * 0.8) / (Math.max(4, texto.length) * 0.58));
  const tinta = tintaSobre(cor);
  const just = lado === "esquerda" ? "flex-start" : lado === "direita" ? "flex-end" : "center";
  return (
    <div style={{ position: "absolute", left: "7%", right: "7%", top: txt(params.faixa) === "alto" ? "12%" : "63%", display: "flex", justifyContent: just, opacity: s }}>
      <div style={{ position: "relative", transform: `rotate(-2deg) scale(${0.75 + 0.25 * e})`, transformOrigin: lado === "direita" ? "100% 50%" : lado === "esquerda" ? "0% 50%" : "50% 50%" }}>
        <div style={{ position: "absolute", left: 0, top: "8%", bottom: "8%", width: `${varre * 100}%`, background: cor, borderRadius: L * 0.012, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }} />
        <div style={{ position: "relative", fontFamily: letraDe(p, FORTE), fontSize: tamanho, lineHeight: 1.1, color: varre > 0.55 ? tinta : "#ffffff", padding: `0 ${L * 0.03}px`, whiteSpace: "nowrap", textShadow: varre > 0.55 ? "none" : "0 4px 18px rgba(0,0,0,0.6)" }}>{texto}</div>
      </div>
    </div>
  );
}

/** Nome e cargo: painel que entra da esquerda com o fio da marca, na faixa de baixo. */
function TercoInferior(p: PropsDaPeca & { cor: string }) {
  const { params, desdeS, duracaoQuadros, cor, cor2 } = p;
  const { f, fps, L } = useQuadro(desdeS);
  const e = spring({ frame: f, fps, config: { damping: 18, stiffness: 160 } });
  const e2 = spring({ frame: f - Math.round(0.12 * fps), fps, config: { damping: 18, stiffness: 160 } });
  const sai = interpolate(f, [duracaoQuadros - Math.round(0.3 * fps), duracaoQuadros], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: "6%", top: "74%", transform: `translateX(${(1 - e) * -120 - sai * 120}%)` }}>
      <div style={{ display: "flex", alignItems: "stretch", background: "rgba(10,10,10,0.78)", borderRadius: L * 0.014, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
        <div style={{ width: L * 0.012, background: cor }} />
        <div style={{ padding: `${L * 0.018}px ${L * 0.032}px` }}>
          <div style={{ fontFamily: letraDe(p, SANS), fontWeight: 800, fontSize: L * 0.052, color: "#fff", lineHeight: 1.1 }}>{txt(params.nome)}</div>
          {txt(params.cargo) && <div style={{ fontFamily: TEXTO, fontWeight: 600, fontSize: L * 0.032, color: txt(cor2) || cor, marginTop: L * 0.006, opacity: e2, transform: `translateX(${(1 - e2) * -20}px)` }}>{txt(params.cargo)}</div>}
        </div>
      </div>
    </div>
  );
}

const ICONES: Record<string, string> = {
  salvar: "M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z",
  comentar: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z",
  seguir: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  compartilhar: "M3 11l18-8-8 18-2-8z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

/** Chamada dita no fim: cartão com o ícone e o botão da marca (o botão pulsa), sem tapar o rosto. */
function Chamada(p: PropsDaPeca & { cor: string }) {
  const { params, desdeS, duracaoQuadros, cor } = p;
  const { f, fps, L } = useQuadro(desdeS);
  const e = spring({ frame: f, fps, config: { damping: 14, stiffness: 170 } });
  const pulso = 1 + 0.05 * Math.max(0, Math.sin(((f - Math.round(0.5 * fps)) / fps) * Math.PI * 2 * 1.2)) * (f > 0.5 * fps ? 1 : 0);
  const s = interpolate(f, [duracaoQuadros - Math.round(0.2 * fps), duracaoQuadros], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tinta = tintaSobre(cor);
  const icone = ICONES[txt(params.icone, "salvar")] || ICONES.salvar;
  const contorno = txt(params.icone) === "link";
  return (
    <div style={{ position: "absolute", left: "7%", right: "7%", top: "68%", display: "flex", justifyContent: "center", opacity: s, transform: `translateY(${(1 - e) * 60}px)` }}>
      <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.96)", borderRadius: L * 0.05, padding: `${L * 0.02}px ${L * 0.024}px`, boxShadow: "0 16px 40px rgba(0,0,0,0.35)", maxWidth: "100%" }}>
        <div style={{ width: L * 0.09, height: L * 0.09, borderRadius: "50%", background: cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: L * 0.024, transform: `scale(${0.6 + 0.4 * e})` }}>
          <svg viewBox="0 0 24 24" width={L * 0.05} height={L * 0.05} aria-hidden="true">
            <path d={icone} fill={contorno ? "none" : tinta} stroke={tinta} strokeWidth={contorno ? 2 : 0} strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ fontFamily: letraDe(p, SANS), fontWeight: 800, fontSize: L * 0.046, color: "#141414", lineHeight: 1.15, minWidth: 0 }}>{txt(params.texto)}</div>
        {txt(params.botao) && (
          <div style={{ marginLeft: L * 0.024, background: cor, color: tinta, fontFamily: SANS, fontWeight: 800, fontSize: L * 0.036, padding: `${L * 0.014}px ${L * 0.03}px`, borderRadius: L * 0.04, transform: `scale(${pulso})`, flexShrink: 0 }}>{txt(params.botao)}</div>
        )}
      </div>
    </div>
  );
}

/** A peça pelo id (clipe da trilha de sobreposição com estilo.peca). */
export function PecaDeMotion(p: PropsDaPeca) {
  const cor = txt(p.params.cor) || txt(p.corDaMarca) || VERDE_ACELERIQ;
  switch (p.peca) {
    case "rotulo":
      return <Rotulo {...p} cor={cor} />;
    case "carimbo":
      return <Carimbo {...p} cor={cor} />;
    case "lista":
      return <Lista {...p} cor={cor} />;
    case "passos":
      return <Lista {...p} cor={cor} passos />;
    case "contador":
      return <Contador {...p} cor={cor} />;
    case "notificacao":
      return <Notificacao {...p} cor={cor} />;
    case "polaroide":
      return <Polaroide {...p} />;
    case "cartao_final":
      return <CartaoFinal {...p} cor={cor} />;
    case "lettering":
      return <Lettering {...p} cor={cor} />;
    case "barra":
      return <Barra {...p} cor={cor} />;
    case "preco":
      return <Preco {...p} cor={cor} />;
    case "comentario":
      return <Comentario {...p} cor={cor} />;
    case "selo":
      return <Selo {...p} cor={cor} />;
    case "logo":
      return <Logo {...p} cor={cor} />;
    case "gancho":
      return <Gancho {...p} cor={cor} />;
    case "destaque":
      return <Destaque {...p} cor={cor} />;
    case "terco_inferior":
      return <TercoInferior {...p} cor={cor} />;
    case "chamada":
      return <Chamada {...p} cor={cor} />;
    default:
      return null;
  }
}
