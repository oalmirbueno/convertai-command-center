import type { CSSProperties } from "react";
import { familiaDaFonte, type CamadaDoQuadro, type EstadoDaCamada } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Estilo de cada camada do Quadro animado (frente CNV, 30/09). O MESMO cálculo
 * serve ao palco do editor (DOM), à miniatura do cartão e à composição do
 * render (Remotion, workers/render): a tela e o MP4 batem.
 *
 * Sem import de "@/": o worker empacota este arquivo junto com a composição.
 * `largura` é a largura do quadro em px (a letra é fração dela).
 */

export function caixaDaCamada(c: CamadaDoQuadro, e: EstadoDaCamada): CSSProperties {
  const recorte = e.recorte < 0.999 ? `inset(0 ${Math.round((1 - e.recorte) * 1000) / 10}% 0 0)` : undefined;
  return {
    position: "absolute",
    left: `${e.x * 100}%`,
    top: `${e.y * 100}%`,
    width: `${c.l * 100}%`,
    height: `${c.a * 100}%`,
    opacity: e.opacidade,
    transform: `rotate(${e.rotacao}deg) scale(${e.escala})`,
    WebkitTransform: `rotate(${e.rotacao}deg) scale(${e.escala})`,
    transformOrigin: "50% 50%",
    clipPath: recorte,
    WebkitClipPath: recorte,
  };
}

/** Caixa de fora do texto (alinha o bloco na caixa da camada). */
export function alinhamentoDoTexto(c: CamadaDoQuadro): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: c.alinhamento === "esquerda" ? "flex-start" : c.alinhamento === "direita" ? "flex-end" : "center",
    textAlign: c.alinhamento === "esquerda" ? "left" : c.alinhamento === "direita" ? "right" : "center",
  };
}

export function estiloDoTexto(c: CamadaDoQuadro, largura: number): CSSProperties {
  const tamanho = Math.max(1, c.tamanho * largura);
  return {
    display: "inline-block",
    maxWidth: "100%",
    fontFamily: familiaDaFonte(c.fonte),
    fontWeight: c.peso,
    fontSize: tamanho,
    lineHeight: 1.12,
    color: c.cor,
    textTransform: c.maiusculas ? "uppercase" : "none",
    letterSpacing: c.maiusculas ? "0.02em" : "normal",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    textShadow: c.sombra ? `0 ${Math.round(tamanho * 0.06)}px ${Math.round(tamanho * 0.3)}px rgba(0,0,0,0.55)` : "none",
    background: c.fundo || "transparent",
    padding: c.fundo ? `${tamanho * 0.12}px ${tamanho * 0.32}px` : 0,
    borderRadius: c.fundo ? tamanho * 0.18 : 0,
  };
}

export function estiloDaForma(c: CamadaDoQuadro, largura: number): CSSProperties {
  const raio = c.forma === "circulo" ? "50%" : c.forma === "pilula" ? 9999 : Math.round(c.canto * largura);
  return {
    width: "100%",
    height: "100%",
    background: c.cor,
    borderRadius: raio,
    border: c.borda > 0 && c.borda_cor ? `${Math.max(1, c.borda * largura)}px solid ${c.borda_cor}` : undefined,
    boxSizing: "border-box",
  };
}

export function estiloDaMidia(c: CamadaDoQuadro, largura: number): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: c.ajuste === "conter" || c.tipo === "logo" ? "contain" : "cover",
    borderRadius: Math.round(c.canto * largura),
    display: "block",
  };
}

/** Tempo da mídia de vídeo dentro da camada (s), para o quadro atual do quadro animado. */
export const tempoDaMidia = (c: CamadaDoQuadro, t: number) => Math.max(0, t - c.inicio_s);
