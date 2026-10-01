/**
 * Fundo trocável dos mockups de estúdio (frente MCK, rodada 2). O mockup guarda onde está o
 * objeto e a luz do fundo (sombra de contato); aqui se desenha o fundo novo, do tamanho da cena,
 * com a cor, o degradê ou a textura da marca. A composição (shader ou composicao.ts) multiplica
 * esse fundo pela luz guardada, então a sombra continua embaixo do objeto.
 */
import type { TipoDeFundoDaCena } from "./ajustes";

export interface FundoPedido {
  tipo: TipoDeFundoDaCena;
  /** Cor principal (#rrggbb). */
  cor: string;
  /** Segunda cor do degradê. */
  cor2?: string | null;
  textura?: { imagem: CanvasImageSource; largura: number; altura: number } | null;
  /** Força da textura sobre a cor (0 a 1). */
  opacidadeTextura?: number;
}

/** Cor #rrggbb um pouco mais clara ou escura (fator > 1 clareia). Cor inválida: cinza claro. */
export function ajustarCor(hex: string, fator: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return "#ececec";
  const n = parseInt(m[1], 16);
  const canal = (v: number) => {
    const x = fator >= 1 ? v + (255 - v) * (fator - 1) : v * fator;
    return Math.max(0, Math.min(255, Math.round(x)));
  };
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * O fundo novo, do tamanho do mockup. "original" não desenha nada (null): fica o fundo neutro que
 * veio no mockup. O degradê vai de cima para baixo, como a luz de estúdio.
 */
export function desenharFundo(pedido: FundoPedido, largura: number, altura: number): HTMLCanvasElement | null {
  if (pedido.tipo === "original") return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(largura));
  c.height = Math.max(1, Math.round(altura));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  if (pedido.tipo === "degrade") {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, ajustarCor(pedido.cor, 1.12));
    g.addColorStop(1, pedido.cor2 || ajustarCor(pedido.cor, 0.78));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = pedido.cor;
  }
  ctx.fillRect(0, 0, c.width, c.height);
  if (pedido.tipo === "textura" && pedido.textura) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pedido.opacidadeTextura ?? 0.35));
    ctx.globalCompositeOperation = "multiply";
    const t = pedido.textura;
    const f = Math.max(c.width / t.largura, c.height / t.altura);
    ctx.drawImage(t.imagem, (c.width - t.largura * f) / 2, (c.height - t.altura * f) / 2, t.largura * f, t.altura * f);
    ctx.restore();
  }
  return c;
}

export const ROTULOS_DO_FUNDO: Record<TipoDeFundoDaCena, string> = {
  original: "Original",
  cor: "Cor da marca",
  degrade: "Degradê da marca",
  textura: "Cor com textura",
};

/**
 * O fundo pedido pelos ajustes (cor da paleta pelo índice; o degradê vai da cor escolhida para a
 * seguinte da paleta). "original" = null: o mockup fica com o fundo que veio.
 */
export function fundoDosAjustes(
  a: { fundoCena: TipoDeFundoDaCena; corDoFundoCena: number; opacidade: number },
  cores: string[],
  textura: FundoPedido["textura"],
): FundoPedido | null {
  if (a.fundoCena === "original" || !cores.length) return null;
  const i = a.corDoFundoCena % cores.length;
  return {
    tipo: a.fundoCena === "textura" && !textura ? "cor" : a.fundoCena,
    cor: cores[i],
    cor2: cores.length > 1 ? cores[(i + 1) % cores.length] : null,
    textura: a.fundoCena === "textura" ? textura : null,
    opacidadeTextura: Math.max(0.2, a.opacidade),
  };
}
