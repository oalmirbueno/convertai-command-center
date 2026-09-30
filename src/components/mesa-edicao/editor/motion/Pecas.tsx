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
    <Centro topo="46%">
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

function CartaoFinal({ params, desdeS, duracaoQuadros, cor, imagem }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const e = spring({ frame: f, fps, config: { damping: 16, stiffness: 140 } });
  const e2 = spring({ frame: f - Math.round(0.35 * fps), fps, config: { damping: 14 } });
  const s = interpolate(f, [duracaoQuadros - 4, duracaoQuadros], [1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ ...cheio, background: `rgba(8,8,8,${0.88 * e})`, opacity: s, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      {imagem && <Img src={imagem} style={{ maxWidth: "46%", maxHeight: "18%", objectFit: "contain", marginBottom: L * 0.05, transform: `scale(${0.8 + 0.2 * e})`, opacity: e }} />}
      <div style={{ color: "#fff", fontWeight: 900, fontSize: L * 0.075, textAlign: "center", padding: "0 8%", transform: `translateY(${(1 - e) * 40}px)`, opacity: e }}>{txt(params.titulo)}</div>
      {txt(params.botao) && <div style={{ marginTop: L * 0.05, background: cor, color: "#0a0a0a", fontWeight: 800, fontSize: L * 0.05, padding: `${L * 0.02}px ${L * 0.06}px`, borderRadius: L * 0.06, transform: `scale(${e2})` }}>{txt(params.botao)}</div>}
    </div>
  );
}

function Lettering({ params, tempos, desdeS, duracaoQuadros, cor }: PropsDaPeca & { cor: string }) {
  const { f, fps, L } = useQuadro(desdeS);
  const palavras = lista(params.palavras);
  const ts = palavras.map((_, k) => Math.round(((tempos && tempos[k] !== undefined ? tempos[k] : (k * duracaoQuadros) / Math.max(1, palavras.length) / fps)) * fps));
  let atual = 0;
  ts.forEach((t, k) => f >= t && (atual = k));
  const e = spring({ frame: f - ts[atual], fps, config: { damping: 12, stiffness: 200 } });
  const s = interpolate(f, [duracaoQuadros - Math.round(0.25 * fps), duracaoQuadros], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Centro topo="38%">
      <div style={{ fontFamily: FORTE, fontSize: L * 0.14, color: atual % 2 ? cor : "#fff", transform: `scale(${0.6 + 0.4 * e})`, opacity: s, textAlign: "center", lineHeight: 1, padding: "0 6%", textShadow: "0 8px 30px rgba(0,0,0,0.55)" }}>{(palavras[atual] || "").toUpperCase()}</div>
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
    default:
      return null;
  }
}
