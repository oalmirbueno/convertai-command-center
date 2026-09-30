import { supabase } from "@/integrations/supabase/client";
import type { Camada, LayoutDaPeca } from "../../../supabase/functions/_shared/aplicacoes-da-marca";

/**
 * Desenha no canvas o layout de uma peça da marca (IDV2): redes, papelaria.
 * A logo e o padrão são imagens reais (bucket mesa, por blob: o canvas não
 * fica "sujo" e o PNG sai). Texto com a fonte da marca já carregada
 * (useFontesGoogle); sem ela, a reserva do sistema.
 */

function retanguloArredondado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const raio = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.lineTo(x + w - raio, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + raio);
  ctx.lineTo(x + w, y + h - raio);
  ctx.quadraticCurveTo(x + w, y + h, x + w - raio, y + h);
  ctx.lineTo(x + raio, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - raio);
  ctx.lineTo(x, y + raio);
  ctx.quadraticCurveTo(x, y, x + raio, y);
  ctx.closePath();
}

/** Quebra o texto em até 3 linhas que cabem na largura. */
export function linhasQueCabem(medir: (s: string) => number, textoBruto: string, largura: number, maxLinhas = 3): string[] {
  const palavras = String(textoBruto || "").split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (!atual || medir(teste) <= largura) atual = teste;
    else {
      linhas.push(atual);
      atual = p;
      if (linhas.length === maxLinhas - 1) break;
    }
  }
  const usadas = linhas.join(" ").split(/\s+/).filter(Boolean).length + (atual ? atual.split(/\s+/).length : 0);
  if (atual) linhas.push(usadas < palavras.length ? `${atual}...` : atual);
  return linhas.slice(0, maxLinhas);
}

type ImagemDaPeca = { imagem: CanvasImageSource; largura: number; altura: number };

function desenharCamada(ctx: CanvasRenderingContext2D, c: Camada, imagens: { logo?: ImagemDaPeca | null; padrao?: ImagemDaPeca | null }) {
  if (c.tipo === "retangulo") {
    ctx.fillStyle = c.cor;
    if (c.raio) {
      retanguloArredondado(ctx, c.x, c.y, c.w, c.h, c.raio);
      ctx.fill();
    } else ctx.fillRect(c.x, c.y, c.w, c.h);
    return;
  }
  if (c.tipo === "texto") {
    ctx.fillStyle = c.cor;
    ctx.font = `${c.peso} ${c.tamanho}px "${c.familia}", Helvetica, Arial, sans-serif`;
    ctx.textAlign = c.alinhar === "centro" ? "center" : c.alinhar === "direita" ? "right" : "left";
    ctx.textBaseline = "alphabetic";
    const linhas = c.maxLargura ? linhasQueCabem((s) => ctx.measureText(s).width, c.texto, c.maxLargura) : [c.texto];
    const passo = c.tamanho * 1.18;
    linhas.forEach((l, i) => ctx.fillText(l, c.x, c.y + i * passo));
    return;
  }
  const img = c.tipo === "logo" ? imagens.logo : imagens.padrao;
  if (!img || !img.largura || !img.altura) return;
  if (c.tipo === "logo") {
    const f = Math.min(c.w / img.largura, c.h / img.altura);
    const w = img.largura * f;
    const h = img.altura * f;
    ctx.drawImage(img.imagem, c.x + (c.w - w) / 2, c.y + (c.h - h) / 2, w, h);
    return;
  }
  ctx.save();
  ctx.globalAlpha = c.opacidade;
  ctx.beginPath();
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.clip();
  const f = Math.max(c.w / img.largura, c.h / img.altura);
  ctx.drawImage(img.imagem, c.x + (c.w - img.largura * f) / 2, c.y + (c.h - img.altura * f) / 2, img.largura * f, img.altura * f);
  ctx.restore();
}

const comoImagem = (img: HTMLImageElement | null | undefined): ImagemDaPeca | null => (img ? { imagem: img, largura: img.naturalWidth || img.width, altura: img.naturalHeight || img.height } : null);

/** Desenha o layout num canvas do tamanho da peça vezes a escala (1 = tamanho real). */
export function desenharLayout(l: LayoutDaPeca, imagens: { logo?: HTMLImageElement | null; padrao?: HTMLImageElement | null }, escala = 1, destino?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = destino || document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(l.largura * escala));
  canvas.height = Math.max(1, Math.round(l.altura * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.fillStyle = l.fundo;
  ctx.fillRect(0, 0, l.largura, l.altura);
  const imgs = { logo: comoImagem(imagens.logo), padrao: comoImagem(imagens.padrao) };
  for (const c of l.camadas) desenharCamada(ctx, c, imgs);
  return canvas;
}

/** data URL de um arquivo do bucket mesa (para o SVG exportado levar a logo e o padrão dentro). */
export async function dataUrlDoBucket(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("mesa").download(caminho);
  if (error || !data) return null;
  return await new Promise<string | null>((resolver) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === "string" ? leitor.result : null);
    leitor.onerror = () => resolver(null);
    leitor.readAsDataURL(data);
  });
}
