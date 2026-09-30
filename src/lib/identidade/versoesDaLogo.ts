import { supabase } from "@/integrations/supabase/client";
import type { LogoDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import {
  analisarLogo,
  COR_DA_MONOCROMATICA,
  COR_DA_NEGATIVA,
  type AnaliseDaLogo,
  type ImagemRGBA,
  recolorir,
  recortar,
  ROTULO_DA_VERSAO,
  semFundo,
  svgMonocromatico,
  type VersaoDaLogo,
  versoesPossiveis,
} from "../../../supabase/functions/mesa-identidade/modulos/leitura-da-logo";

/**
 * A logo real no navegador (frente IDV3, "Completar marca existente"): lê os
 * pixels no canvas, extrai as cores por código e faz as versões possíveis
 * (monocromática, negativa, sem fundo, símbolo) sem redesenhar nada. As
 * contas moram em supabase/functions/_shared/leitura-da-logo.ts (puras e
 * testadas); aqui só o canvas e o envio para o bucket mesa.
 */

/** Lado máximo usado para ler e gerar as versões (nítido para PDF e peças, leve no navegador). */
export const LADO_DAS_VERSOES = 1600;

async function baixar(caminho: string, bucket = "mesa"): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(caminho);
  if (error || !data) throw error || new Error("Não foi possível baixar a logo.");
  return data;
}

function abrir(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rejeitar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a logo."));
    img.src = url;
  });
}

/** Desenha o arquivo (SVG ou bitmap) num canvas de até `lado` px e devolve os pixels. */
export async function pixelsDoArquivo(arquivo: Blob, lado = LADO_DAS_VERSOES): Promise<ImagemRGBA> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await abrir(url);
    const w0 = img.naturalWidth || 800;
    const h0 = img.naturalHeight || 400;
    const vetor = /svg/i.test(arquivo.type);
    const escala = vetor ? lado / Math.max(w0, h0) : Math.min(1, lado / Math.max(w0, h0));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w0 * escala));
    canvas.height = Math.max(1, Math.round(h0 * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não conseguiu desenhar a logo.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: dados.data, largura: canvas.width, altura: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pngDosPixels(data: Uint8ClampedArray, largura: number, altura: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("O navegador não conseguiu desenhar a versão."));
  const img = ctx.createImageData(largura, altura);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolver, rejeitar) => canvas.toBlob((b) => (b ? resolver(b) : rejeitar(new Error("A versão não virou PNG."))), "image/png"));
}

/** Blob em texto por FileReader (Blob.text() não existe no Safari 11). */
function textoDoBlob(b: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === "string" ? leitor.result : "");
    leitor.onerror = () => rejeitar(new Error("O SVG não foi lido."));
    leitor.readAsText(b);
  });
}

/** O arquivo que vale para a leitura: o original (SVG ou bitmap); sem ele, a prévia PNG. */
async function arquivoDaLogo(logo: LogoDoBrandbook): Promise<{ blob: Blob; mime: string; svg: string | null }> {
  const blob = await baixar(logo.caminho).catch(() => null);
  if (blob) {
    const mime = /svg/i.test(logo.mime) ? "image/svg+xml" : logo.mime || blob.type || "image/png";
    const tipado = blob.type === mime ? blob : new Blob([blob], { type: mime });
    const svg = /svg/i.test(mime) ? await textoDoBlob(tipado) : null;
    return { blob: tipado, mime, svg };
  }
  if (!logo.previa_png) throw new Error("Não foi possível baixar a logo.");
  const previa = await baixar(logo.previa_png);
  return { blob: new Blob([previa], { type: "image/png" }), mime: "image/png", svg: null };
}

/** Lê a logo por código: fundo, caixa, orientação, cores e se o símbolo se separa. */
export async function lerLogoPorCodigo(logo: LogoDoBrandbook): Promise<{ analise: AnaliseDaLogo; pixels: ImagemRGBA; mime: string; svg: string | null }> {
  const a = await arquivoDaLogo(logo);
  const pixels = await pixelsDoArquivo(a.blob);
  return { analise: analisarLogo(pixels), pixels, mime: a.mime, svg: a.svg };
}

async function enviar(caminho: string, blob: Blob, tipo: string) {
  const { error } = await supabase.storage.from("mesa").upload(caminho, blob, { contentType: tipo, upsert: false });
  if (error) throw error;
}

export type VersoesGeradas = {
  alternativas: LogoDoBrandbook[];
  icone: LogoDoBrandbook[];
  geradas: VersaoDaLogo[];
  designer: Array<{ versao: VersaoDaLogo; motivo: string }>;
  /** O símbolo recortado (PNG em data URL) para o padrão feito com ele. */
  simbolo: { dataUrl: string; proporcao: number; caminho: string } | null;
};

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => (typeof leitor.result === "string" ? resolver(leitor.result) : rejeitar(new Error("Sem dados")));
    leitor.onerror = () => rejeitar(new Error("Sem dados"));
    leitor.readAsDataURL(blob);
  });
}

/**
 * Gera as versões possíveis por código e envia para a pasta do projeto
 * (mesa/<cliente>/marca/identidade/<projeto>/logos/). SVG original: a
 * monocromática e a negativa também saem em SVG (vetor recolorido); PNG
 * original: só PNG, e o vetor vai para a lista do designer.
 */
export async function gerarVersoesDaLogo(pasta: string, logo: LogoDoBrandbook, lida?: { analise: AnaliseDaLogo; pixels: ImagemRGBA; mime: string; svg: string | null }): Promise<VersoesGeradas> {
  const l = lida || (await lerLogoPorCodigo(logo));
  const { porCodigo, designer } = versoesPossiveis(l.analise, l.mime);
  const alternativas: LogoDoBrandbook[] = [];
  const icone: LogoDoBrandbook[] = [];
  const geradas: VersaoDaLogo[] = [];
  let simbolo: VersoesGeradas["simbolo"] = null;
  const agora = Date.now();
  for (const v of porCodigo) {
    const base = `${pasta}/logos/${v}-${agora}`;
    if (v === "simbolo") {
      if (!l.analise.simbolo.caixa) continue;
      const corte = recortar(l.pixels, l.analise, l.analise.simbolo.caixa);
      const png = await pngDosPixels(new Uint8ClampedArray(corte.data as ArrayLike<number>), corte.largura, corte.altura);
      await enviar(`${base}.png`, png, "image/png");
      icone.push({ caminho: `${base}.png`, mime: "image/png", rotulo: ROTULO_DA_VERSAO.simbolo, previa_png: `${base}.png`, largura: corte.largura, altura: corte.altura });
      simbolo = { dataUrl: await dataUrl(png), proporcao: corte.largura / Math.max(1, corte.altura), caminho: `${base}.png` };
      geradas.push(v);
      continue;
    }
    const pixels = v === "sem_fundo" ? semFundo(l.pixels, l.analise) : recolorir(l.pixels, l.analise, v === "negativa" ? COR_DA_NEGATIVA : COR_DA_MONOCROMATICA);
    const png = await pngDosPixels(pixels, l.pixels.largura, l.pixels.altura);
    await enviar(`${base}.png`, png, "image/png");
    let caminho = `${base}.png`;
    let mime = "image/png";
    if (l.svg && v !== "sem_fundo") {
      const vetor = svgMonocromatico(l.svg, v === "negativa" ? COR_DA_NEGATIVA : COR_DA_MONOCROMATICA);
      if (vetor) {
        await enviar(`${base}.svg`, new Blob([vetor], { type: "image/svg+xml" }), "image/svg+xml");
        caminho = `${base}.svg`;
        mime = "image/svg+xml";
      }
    }
    alternativas.push({ caminho, mime, rotulo: ROTULO_DA_VERSAO[v], previa_png: `${base}.png`, largura: l.pixels.largura, altura: l.pixels.altura });
    geradas.push(v);
  }
  return { alternativas, icone, geradas, designer, simbolo };
}
