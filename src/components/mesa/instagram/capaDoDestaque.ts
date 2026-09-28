import { supabase } from "@/integrations/supabase/client";
import { TAMANHO_DA_CAPA } from "../../../../supabase/functions/_shared/conhecimento-perfil-instagram";

/**
 * Capa de destaque pronta para subir no Instagram (1080 x 1920), montada no
 * navegador, sem custo: o fundo ocupa a tela toda e o desenho fica no círculo
 * do centro (o que o Instagram mostra).
 * - Ícone gerado: o fundo da tela é a cor do canto da própria imagem (a
 *   emenda some) e o ícone vai no centro, na largura toda.
 * - Logo da marca: fundo na cor do kit e a logo do cliente, inteira, no
 *   centro do círculo. Nada é redesenhado (trava da marca).
 * Safari 11 não tem createImageBitmap: abre pelo <img>.
 */

async function abrirImagem(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a imagem."));
      img.src = url;
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function novaTela(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = TAMANHO_DA_CAPA.largura;
  canvas.height = TAMANHO_DA_CAPA.altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu montar a capa.");
  return { canvas, ctx };
}

function paraPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rejeitar) => {
    canvas.toBlob((b) => (b ? resolver(b) : rejeitar(new Error("O navegador não conseguiu gerar o PNG."))), "image/png");
  });
}

/** Cor do canto de cima da imagem (#rrggbb). */
export function corDoCanto(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, Math.min(16, img.width), Math.min(16, img.height), 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const h = (v: number) => {
      const s = Math.round(v / n).toString(16);
      return s.length < 2 ? `0${s}` : s;
    };
    return `#${h(r)}${h(g)}${h(b)}`;
  } catch {
    return null;
  }
}

/** Capa com o ícone gerado (a imagem quadrada vai no centro). */
export async function capaComIcone(icone: Blob, fundoDoKit: string): Promise<Blob> {
  const img = await abrirImagem(icone);
  const { canvas, ctx } = novaTela();
  ctx.fillStyle = corDoCanto(img) || fundoDoKit;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Na largura toda, sem distorcer (o gerador pode devolver outra proporção).
  const w = canvas.width;
  const h = Math.round((img.height / Math.max(1, img.width)) * w);
  ctx.drawImage(img, 0, Math.round((canvas.height - h) / 2), w, h);
  return paraPng(canvas);
}

/** Capa com a logo do cliente, inteira, dentro do círculo do centro. */
export async function capaComLogo(logo: Blob, fundoDoKit: string): Promise<Blob> {
  const img = await abrirImagem(logo);
  const { canvas, ctx } = novaTela();
  ctx.fillStyle = fundoDoKit;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Cabe num quadrado inscrito no círculo de 720 (lado de uns 500 px), com folga.
  const caixa = Math.round(TAMANHO_DA_CAPA.circulo * 0.66);
  const escala = Math.min(caixa / img.width, caixa / img.height);
  const w = Math.max(1, Math.round(img.width * escala));
  const h = Math.max(1, Math.round(img.height * escala));
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return paraPng(canvas);
}

export async function baixarDoStorage(bucket: string, caminho: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(bucket).download(caminho);
  if (error || !data) throw error || new Error("Não foi possível baixar a imagem.");
  return data;
}

/** Nome de arquivo sem acento e sem espaço. */
export function nomeDoArquivo(nome: string, prefixo = "destaque"): string {
  const limpo = (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefixo}-${limpo || "capa"}.png`;
}

export function salvarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Várias capas num ZIP (jszip só carrega aqui). */
export async function baixarZipDasCapas(capas: Array<{ nome: string; blob: Blob }>, cliente: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modulo: any = await import("jszip");
  const JSZip = modulo.default || modulo;
  const zip = new JSZip();
  const usados: Record<string, number> = {};
  capas.forEach((c, i) => {
    let nome = nomeDoArquivo(c.nome, String(i + 1).padStart(2, "0"));
    if (usados[nome]) nome = nome.replace(".png", `-${++usados[nome]}.png`);
    else usados[nome] = 1;
    zip.file(nome, c.blob);
  });
  const blob = await zip.generateAsync({ type: "blob" });
  salvarBlob(blob, nomeDoArquivo(cliente, "destaques").replace(".png", ".zip"));
}
