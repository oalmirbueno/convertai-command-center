import { supabase } from "@/integrations/supabase/client";
import { extrairPaleta } from "@/lib/identidadeVisual";
import type { LogoDoBrandbook } from "../../../supabase/functions/_shared/brandbook";
import { pastaDoProjeto } from "./identidadeApi";

/**
 * Arquivos da marca no navegador (etapa Sistema). Regra "logo pelo código":
 * a logo é o arquivo real da equipe (SVG ou PNG). Ao enviar:
 * - o original vai para mesa/<cliente>/marca/identidade/<projeto>/logos/;
 * - uma prévia PNG com transparência (até 800 px) sai do próprio arquivo
 *   (SVG desenhado no canvas): o PDF, a página pública e o kit usam a prévia;
 * - a paleta sai dos pixels da logo (extrairPaleta, já do painel).
 *
 * Vetorizar PNG: o painel não tem biblioteca leve para isso hoje. A equipe
 * envia o SVG feito no editor de vetor; o PNG serve de logo, com o aviso.
 */

export const TIPOS_DE_LOGO: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const LADO_DA_PREVIA = 800;
export const TETO_DO_ARQUIVO = 10 * 1024 * 1024;

export function extensaoDe(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome || "");
  return m ? m[1].toLowerCase() : "";
}

/** Arquivo aceito como logo? Devolve o motivo quando não. */
export function motivoParaRecusarLogo(arquivo: { name: string; size: number }): string | null {
  const ext = extensaoDe(arquivo.name);
  if (!TIPOS_DE_LOGO[ext]) return "Envie a logo em SVG, PNG, JPG ou WEBP.";
  if (arquivo.size > TETO_DO_ARQUIVO) return "A logo passou de 10 MB. Exporte menor.";
  return null;
}

function abrirImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rejeitar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a imagem."));
    img.src = url;
  });
}

/** Desenha a imagem num canvas de até `lado` px (SVG sem tamanho vira 800 x 400). */
async function desenhar(arquivo: Blob, lado: number, fundo?: string): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await abrirImagem(url);
    const w0 = img.naturalWidth || 800;
    const h0 = img.naturalHeight || 400;
    // Vetor desenha no tamanho da prévia (nítido); bitmap só reduz, nunca amplia.
    const maior = Math.max(w0, h0);
    const escala = arquivo.type === "image/svg+xml" ? lado / maior : Math.min(1, lado / maior);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * escala));
    canvas.height = Math.max(1, Math.round(h0 * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não conseguiu desenhar a imagem.");
    if (fundo) {
      ctx.fillStyle = fundo;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function paraBlob(canvas: HTMLCanvasElement, tipo: string, qualidade?: number): Promise<Blob> {
  return new Promise((resolver, rejeitar) => canvas.toBlob((b) => (b ? resolver(b) : rejeitar(new Error("O navegador não gerou a prévia."))), tipo, qualidade));
}

/** Envia a logo (original + prévia PNG) e devolve o item para o sistema. */
export async function enviarLogo(clientId: string, projetoId: string, arquivo: File, slot: string, rotulo: string): Promise<LogoDoBrandbook> {
  const motivo = motivoParaRecusarLogo(arquivo);
  if (motivo) throw new Error(motivo);
  const ext = extensaoDe(arquivo.name);
  const mime = TIPOS_DE_LOGO[ext];
  const base = `${pastaDoProjeto(clientId, projetoId)}/logos/${slot}-${Date.now()}`;
  const original = `${base}.${ext}`;
  const env = await supabase.storage.from("mesa").upload(original, arquivo, { contentType: mime, upsert: false });
  if (env.error) throw env.error;
  const canvas = await desenhar(new Blob([arquivo], { type: mime }), LADO_DA_PREVIA);
  const png = await paraBlob(canvas, "image/png");
  const previa = `${base}-previa.png`;
  const env2 = await supabase.storage.from("mesa").upload(previa, png, { contentType: "image/png", upsert: false });
  if (env2.error) throw env2.error;
  return { caminho: original, mime, rotulo: rotulo.slice(0, 60), previa_png: previa, largura: canvas.width, altura: canvas.height };
}

/** Imagem de apoio (grafismo, pattern, foto): vira JPEG de até 1600 px (o PDF usa como está). */
export async function enviarImagemDeApoio(clientId: string, projetoId: string, arquivo: File, pasta: "grafismos" | "aplicacoes" | "mockups"): Promise<string> {
  const ext = extensaoDe(arquivo.name);
  if (["png", "jpg", "jpeg", "webp"].indexOf(ext) < 0) throw new Error("Envie a imagem em PNG, JPG ou WEBP.");
  if (arquivo.size > TETO_DO_ARQUIVO) throw new Error("A imagem passou de 10 MB.");
  const canvas = await desenhar(arquivo, 1600, "#FFFFFF");
  const jpg = await paraBlob(canvas, "image/jpeg", 0.88);
  const caminho = `${pastaDoProjeto(clientId, projetoId)}/${pasta}/${Date.now()}.jpg`;
  const env = await supabase.storage.from("mesa").upload(caminho, jpg, { contentType: "image/jpeg", upsert: false });
  if (env.error) throw env.error;
  return caminho;
}

/** A paleta dos pixels da prévia da logo (até 6 cores, as que mais aparecem). */
export async function paletaDaLogo(caminho: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from("mesa").download(caminho);
  if (error || !data) throw error || new Error("Não foi possível baixar a logo.");
  const canvas = await desenhar(data, 96);
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // Branco e preto quase puros costumam ser fundo ou contorno: saem da sugestão (a equipe pode pôr de volta).
  return extrairPaleta(px, 8)
    .map((c) => c.hex)
    .filter((h) => ["#FFFFFF", "#000000"].indexOf(h) < 0)
    .slice(0, 6);
}
