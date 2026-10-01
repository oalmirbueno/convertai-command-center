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
  /** Faixas de luma da logo (a regra confere se um pedaço some na superfície). */
  distribuicao?: Array<{ luma: number; peso: number }> | null;
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
  /**
   * Assinatura da marca (IDV2): uma linha de texto (slogan ou nome) na fonte do
   * título, embaixo da logo, só no slot de arte. A fonte já vem carregada.
   */
  assinatura?: { texto: string; familia: string } | null;
  /** Deslocamento da logo dentro da área segura (-1 a 1 em cada eixo; 0 = centro). */
  posicao?: { x: number; y: number } | null;
  /** Giro da logo em graus. */
  rotacao?: number;
  /** Versão da logo: auto (pelo contraste), a do kit como veio, branca ou preta. */
  variante?: "auto" | "original" | "branca" | "preta";
  /** Arte com a logo sozinha ou em padrão repetido (estampa da marca). */
  modo?: "logo" | "padrao";
}

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A logo (lw x lh) contida na área segura do design (W x H), ocupando `escala` dela. Sem posição,
 * no centro; com posição, desliza até a borda da área (-1 encosta à esquerda/topo, 1 à direita/base).
 */
export function caixaDaLogo(area: [number, number, number, number], W: number, H: number, lw: number, lh: number, escala: number, posicao?: { x: number; y: number } | null): Caixa {
  const ax = area[0] * W;
  const ay = area[1] * H;
  const aw = Math.max(1, (area[2] - area[0]) * W);
  const ah = Math.max(1, (area[3] - area[1]) * H);
  const e = Math.max(0.1, Math.min(1, escala));
  const f = Math.min((aw * e) / Math.max(1, lw), (ah * e) / Math.max(1, lh));
  const w = lw * f;
  const h = lh * f;
  const px = posicao ? Math.max(-1, Math.min(1, posicao.x || 0)) : 0;
  const py = posicao ? Math.max(-1, Math.min(1, posicao.y || 0)) : 0;
  return { x: ax + ((aw - w) / 2) * (1 + px), y: ay + ((ah - h) / 2) * (1 + py), w, h };
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

  const doKit: LogoDoKit[] = logos.map((l) => ({ id: l.id, tom: l.tom, luminancia: l.luma, distribuicao: l.distribuicao }));
  const automatica = escolherVarianteDaLogo(superficieDoSlot(slot, escolhas), doKit);
  const escolha = varianteForcada(automatica, escolhas.variante, logos);
  const v = escolha.variante;
  const logo = v.tipo === "original" ? logos.find((l) => l.id === v.id) || logos[0] : logos[0];
  const escala = escolhas.escala > 0 ? escolhas.escala : ESCALA_POR_PAPEL[slot.papel] || 0.5;
  const padrao = escolhas.modo === "padrao" && (slot.papel === "arte" || slot.papel === "verso");
  const cx = padrao
    ? caixaDaLogo([0, 0, 1, 1], W, H, logo.largura, logo.altura, Math.max(0.06, escala * 0.28))
    : caixaDaLogo(slot.areaSegura, W, H, logo.largura, logo.altura, slot.papel === "verso" ? escala * 0.65 : escala, escolhas.posicao);
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
  const giro = ((escolhas.rotacao || 0) * Math.PI) / 180;
  if (padrao) {
    for (const p of posicoesDoPadrao(W, H, lw, lh)) desenharGirado(ctx, camada, p.x, p.y, lw, lh, giro);
  } else {
    desenharGirado(ctx, camada, cx.x, cx.y, lw, lh, giro);
  }
  desenharAssinatura(ctx, slot, escolhas, W, H);
  return { canvas: c, escolha };
}

/** A versão pedida na tela vence a automática (auto = regra do contraste). */
export function varianteForcada(auto: EscolhaDaVariante, pedida: EscolhasDoDesign["variante"], logos: Array<Pick<LogoCarregada, "id">>): EscolhaDaVariante {
  if (!pedida || pedida === "auto") return auto;
  if (pedida === "original") {
    const id = auto.variante.tipo === "original" ? auto.variante.id : logos[0] ? logos[0].id : "principal";
    return { variante: { tipo: "original", id }, contraste: auto.contraste, motivo: "versão do kit pedida na tela" };
  }
  return { variante: { tipo: pedida }, contraste: auto.contraste, motivo: `versão ${pedida} pedida na tela` };
}

/** Onde cada logo do padrão fica (grade com linhas alternadas, meia logo de folga). */
export function posicoesDoPadrao(W: number, H: number, lw: number, lh: number): Array<{ x: number; y: number }> {
  const passoX = Math.max(4, lw * 1.9);
  const passoY = Math.max(4, lh * 2.2);
  const out: Array<{ x: number; y: number }> = [];
  let linha = 0;
  for (let y = -lh; y < H + lh && out.length < 600; y += passoY, linha++) {
    const deslocar = linha % 2 ? passoX / 2 : 0;
    for (let x = -lw + deslocar; x < W + lw && out.length < 600; x += passoX) out.push({ x, y });
  }
  return out;
}

function desenharGirado(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, giro: number) {
  if (!giro) {
    ctx.drawImage(img, Math.round(x), Math.round(y));
    return;
  }
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(giro);
  ctx.drawImage(img, -w / 2, -h / 2);
  ctx.restore();
}

/** A linha da assinatura no rodapé da área segura (arte), na cor que contrasta com o fundo. */
function desenharAssinatura(ctx: CanvasRenderingContext2D, slot: SlotDoMockup, escolhas: EscolhasDoDesign, W: number, H: number) {
  const a = escolhas.assinatura;
  if (!a || !a.texto || slot.papel !== "arte") return;
  const ax = slot.areaSegura[0] * W;
  const ay = slot.areaSegura[1] * H;
  const aw = Math.max(1, (slot.areaSegura[2] - slot.areaSegura[0]) * W);
  const ah = Math.max(1, (slot.areaSegura[3] - slot.areaSegura[1]) * H);
  const tamanho = Math.max(8, Math.round(Math.min(ah * 0.07, aw * 0.06)));
  ctx.save();
  ctx.fillStyle = (lumaDoHex(escolhas.fundo) ?? 0) > 0.55 ? "#111111" : "#ffffff";
  ctx.font = `600 ${tamanho}px "${a.familia}", Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let texto = a.texto;
  while (texto.length > 3 && ctx.measureText(texto).width > aw * 0.9) texto = `${texto.slice(0, -4)}...`;
  ctx.fillText(texto, ax + aw / 2, ay + ah * 0.94);
  ctx.restore();
}
