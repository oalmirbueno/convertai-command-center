/**
 * O design que entra em cada slot, montado pelo código a partir do kit da marca (a logo nunca
 * passa por gerador de imagem):
 *   arte  = cor de fundo da marca + logo no centro da área segura (+ textura opcional)
 *   verso = segunda cor + logo menor
 *   logo  = só a logo, em fundo transparente, dentro da área segura
 *   cor   = cor sólida (alça da caneca, cor da peça)
 * A versão da logo (do kit, branca ou preta) sai de escolherVarianteDaLogo.
 */
import type { SlotDoMockup } from "./catalogo";
import { escolherVarianteDaLogo, lumaDoHex, type EscolhaDaVariante, type LogoDoKit, type TomDaLogo } from "./varianteDaLogo";

export interface LogoCarregada {
  id: string;
  imagem: CanvasImageSource;
  largura: number;
  altura: number;
  luma: number | null;
  tom?: TomDaLogo;
}

export interface EscolhasDoDesign {
  /** Cor de fundo do slot de arte (#rrggbb). */
  fundo: string;
  /** Cor do verso e da peça (#rrggbb). */
  segunda: string;
  /** Tamanho da logo dentro da área segura (0,2 a 1). */
  escala: number;
  /** Textura de fundo (multiplica sobre a cor) e desgaste da logo (0 a 1). */
  textura?: { imagem: CanvasImageSource; largura: number; altura: number } | null;
  opacidadeTextura?: number;
  desgaste?: number;
}

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A logo (lw x lh) contida na área segura do design (W x H), no centro, ocupando `escala` dela. */
export function caixaDaLogo(area: [number, number, number, number], W: number, H: number, lw: number, lh: number, escala: number): Caixa {
  const ax = area[0] * W;
  const ay = area[1] * H;
  const aw = Math.max(1, (area[2] - area[0]) * W);
  const ah = Math.max(1, (area[3] - area[1]) * H);
  const e = Math.max(0.1, Math.min(1, escala));
  const f = Math.min((aw * e) / Math.max(1, lw), (ah * e) / Math.max(1, lh));
  const w = lw * f;
  const h = lh * f;
  return { x: ax + (aw - w) / 2, y: ay + (ah - h) / 2, w, h };
}

/**
 * Tamanho do design: o do smart object, mas nunca muito maior que o espaço que ele ocupa na
 * imagem que vai ser desenhada (amostrar um design enorme numa área pequena serrilha).
 * `fatorTela` = largura desenhada / largura da versão alta.
 */
export function tamanhoDoDesign(slot: Pick<SlotDoMockup, "soPx" | "pxNaTela">, fatorTela: number): [number, number] {
  const [sw, sh] = slot.soPx;
  const lado = Math.max(sw, sh);
  const alvo = slot.pxNaTela ? Math.max(64, slot.pxNaTela * fatorTela * 2) : lado;
  const f = Math.min(1, Math.min(2048, alvo) / lado);
  return [Math.max(1, Math.round(sw * f)), Math.max(1, Math.round(sh * f))];
}

/** O que fica embaixo da logo neste slot (luma 0..1). */
export function superficieDoSlot(slot: Pick<SlotDoMockup, "papel" | "luminanciaSuperficie">, escolhas: Pick<EscolhasDoDesign, "fundo" | "segunda">): number | null {
  if (slot.papel === "arte") return lumaDoHex(escolhas.fundo);
  if (slot.papel === "verso") return lumaDoHex(escolhas.segunda);
  return slot.luminanciaSuperficie;
}

/** Escala padrão da logo por papel. */
export const ESCALA_POR_PAPEL: Record<string, number> = { arte: 0.55, verso: 0.35, logo: 0.85, cor: 0 };

function tela(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function cobrir(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, W: number, H: number) {
  const f = Math.max(W / iw, H / ih);
  const w = iw * f;
  const h = ih * f;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export interface DesignPronto {
  canvas: HTMLCanvasElement;
  escolha: EscolhaDaVariante | null;
}

/** Desenha o design de um slot. Sem logo no kit, arte e verso saem só com a cor. */
export function desenharDesign(slot: SlotDoMockup, logos: LogoCarregada[], escolhas: EscolhasDoDesign, fatorTela: number): DesignPronto {
  const [W, H] = tamanhoDoDesign(slot, fatorTela);
  const c = tela(W, H);
  const ctx = c.getContext("2d");
  if (!ctx) return { canvas: c, escolha: null };
  if (slot.papel === "arte" || slot.papel === "verso" || slot.papel === "cor") {
    ctx.fillStyle = slot.papel === "verso" ? escolhas.segunda : escolhas.fundo;
    ctx.fillRect(0, 0, W, H);
    if (escolhas.textura && slot.papel !== "cor") {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, escolhas.opacidadeTextura ?? 0.3));
      cobrir(ctx, escolhas.textura.imagem, escolhas.textura.largura, escolhas.textura.altura, W, H);
      ctx.restore();
    }
  }
  if (slot.papel === "cor" || !logos.length) return { canvas: c, escolha: null };

  const doKit: LogoDoKit[] = logos.map((l) => ({ id: l.id, tom: l.tom, luminancia: l.luma }));
  const escolha = escolherVarianteDaLogo(superficieDoSlot(slot, escolhas), doKit);
  const v = escolha.variante;
  const logo = v.tipo === "original" ? logos.find((l) => l.id === v.id) || logos[0] : logos[0];
  const escala = escolhas.escala > 0 ? escolhas.escala : ESCALA_POR_PAPEL[slot.papel] || 0.5;
  const cx = caixaDaLogo(slot.areaSegura, W, H, logo.largura, logo.altura, slot.papel === "verso" ? escala * 0.65 : escala);
  const lw = Math.max(1, Math.round(cx.w));
  const lh = Math.max(1, Math.round(cx.h));
  const camada = tela(lw, lh);
  const lc = camada.getContext("2d");
  if (!lc) return { canvas: c, escolha };
  lc.drawImage(logo.imagem, 0, 0, lw, lh);
  if (v.tipo !== "original") {
    lc.globalCompositeOperation = "source-in";
    lc.fillStyle = v.tipo === "branca" ? "#ffffff" : "#111111";
    lc.fillRect(0, 0, lw, lh);
  }
  if (escolhas.textura && (escolhas.desgaste || 0) > 0) {
    lc.globalCompositeOperation = "destination-out";
    lc.globalAlpha = Math.max(0, Math.min(1, escolhas.desgaste || 0));
    cobrir(lc, escolhas.textura.imagem, escolhas.textura.largura, escolhas.textura.altura, lw, lh);
  }
  ctx.drawImage(camada, Math.round(cx.x), Math.round(cx.y));
  return { canvas: c, escolha };
}
