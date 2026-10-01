/**
 * Monta um mockup pronto no navegador: baixa as camadas (uma vez), desenha o design de cada slot
 * com o kit da marca e compõe (WebGL ou reserva). Prévia na versão de trabalho (até 1280 px);
 * exportação na versão alta (até 3000 px), em PNG.
 */
import type { MockupDoCatalogo, SlotDoMockup } from "./catalogo";
import { carregarCamadas, carregarImagem, ondeEstaALogo } from "./api";
import { desenharDesign, type EscolhasDoDesign, type LogoCarregada } from "./designDoSlot";
import { lumaDaLogo, type TomDaLogo, type EscolhaDaVariante } from "./varianteDaLogo";
import { compositor } from "./webgl";
import { escalaQueCabe, limparForaDaTela } from "@/lib/recorte/limpezaDaLogo";
import { fundoPelaBorda } from "../../../supabase/functions/_shared/recorte-limpo";
import { ordenarCantos, projetarDesign, type Ponto } from "./homografia";

export type Qualidade = "trabalho" | "alta";

export interface Renderizado {
  canvas: HTMLCanvasElement;
  escolhas: Array<EscolhaDaVariante | null>;
  webgl: boolean;
}

export async function renderizarMockup(m: MockupDoCatalogo, qualidade: Qualidade, logos: LogoCarregada[], escolhas: EscolhasDoDesign, destino?: HTMLCanvasElement): Promise<Renderizado> {
  const alta = qualidade === "alta";
  const largura = alta ? m.largura : m.larguraTrabalho;
  const altura = alta ? m.altura : m.alturaTrabalho;
  const camadas = await carregarCamadas(alta ? m.caminhos.alta : m.caminhos.trabalho, largura, altura);
  const fator = largura / m.largura;
  const maxIndice = m.slots.reduce((t, s) => Math.max(t, s.indice), 0);
  const designs: Array<HTMLCanvasElement | null> = [];
  const vistas: Array<EscolhaDaVariante | null> = [];
  for (let i = 1; i <= maxIndice; i++) {
    const slot = m.slots.find((s) => s.indice === i);
    if (!slot) {
      designs.push(null);
      continue;
    }
    const d = desenharDesign(slot, logos, escolhas, fator);
    designs.push(d.canvas);
    vistas.push(d.escolha);
  }
  const canvas = destino || document.createElement("canvas");
  const c = compositor();
  c.desenhar(camadas, designs, canvas);
  return { canvas, escolhas: vistas, webgl: c.webgl };
}

/** Canvas -> Blob (Safari 11 tem toBlob). */
export function paraBlob(canvas: HTMLCanvasElement, tipo = "image/png", qualidade?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), tipo, qualidade);
  });
}

/** Largura e altura de uma imagem ou de um canvas. */
function medidas(img: HTMLImageElement | HTMLCanvasElement): { w: number; h: number } {
  const el = img as HTMLImageElement;
  return { w: el.naturalWidth || img.width || 1, h: el.naturalHeight || img.height || 1 };
}

/** Mede a luma de uma logo numa cópia pequena (64 px). */
export function medirLogo(img: HTMLImageElement | HTMLCanvasElement): number | null {
  const lado = 64;
  const m = medidas(img);
  const f = Math.min(1, lado / Math.max(m.w, m.h));
  const w = Math.max(1, Math.round(m.w * f));
  const h = Math.max(1, Math.round(m.h * f));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return lumaDaLogo(ctx.getImageData(0, 0, w, h).data);
  } catch {
    return null;
  }
}

export interface LogoDoKitParaCarregar {
  id: string;
  path: string | null | undefined;
  fileId: string | null | undefined;
  tom: TomDaLogo | string | null | undefined;
}

/** Lado da logo limpa para o mockup (a exportação alta tem até 3000 px no quadro inteiro). */
const LADO_DA_LOGO_NO_MOCKUP = 2000;

/**
 * Logo enviada com fundo liso e CLARO (JPEG, PNG com fundo branco): o fundo
 * sai pelo recorte limpo antes de compor, senão vira caixa branca ou ganha
 * contorno branco no mockup (revisão IDR, 01/10). O branco cercado pelo
 * desenho fica (contrato de 25/09). PNG transparente e logo em fundo escuro
 * ou de cor ficam como vieram: nada muda sem prévia. A conta roda fora da
 * tela (worker) e só quando a borda de uma cópia de 128 px mostra o fundo.
 */
export function logoSemCaixaBranca(img: HTMLImageElement): Promise<HTMLImageElement | HTMLCanvasElement> {
  // A mesma logo (carregarImagem guarda a imagem) não refaz a conta a cada troca de mockup.
  const ja = logosLimpas.get(img);
  if (ja) return ja;
  const p = limparParaMockup(img);
  logosLimpas.set(img, p);
  return p;
}

const logosLimpas = new WeakMap<HTMLImageElement, Promise<HTMLImageElement | HTMLCanvasElement>>();

async function limparParaMockup(img: HTMLImageElement): Promise<HTMLImageElement | HTMLCanvasElement> {
  const { w, h } = medidas(img);
  try {
    const amostra = desenharEmCanvas(img, Math.min(1, 128 / Math.max(w, h)));
    if (!amostra) return img;
    const pequena = amostra.ctx.getImageData(0, 0, amostra.c.width, amostra.c.height);
    const fundo = fundoPelaBorda({ data: pequena.data, largura: pequena.width, altura: pequena.height });
    if (fundo.tipo !== "solido" || !fundo.claro) return img;
    const cheia = desenharEmCanvas(img, escalaQueCabe(w, h, LADO_DA_LOGO_NO_MOCKUP));
    if (!cheia) return img;
    const px = cheia.ctx.getImageData(0, 0, cheia.c.width, cheia.c.height);
    const r = await limparForaDaTela({ op: "mockup", data: px.data, largura: px.width, altura: px.height });
    if (!r.data) return img;
    px.data.set(r.data);
    cheia.ctx.putImageData(px, 0, 0);
    return cheia.c;
  } catch {
    // Canvas indisponível ou imagem de outra origem: a logo vai como veio.
    return img;
  }
}

function desenharEmCanvas(img: HTMLImageElement, escala: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const { w, h } = medidas(img);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * escala));
  c.height = Math.max(1, Math.round(h * escala));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { c, ctx };
}

/** Carrega as logos do kit (principal e alternativa) e mede cada uma. Logo que não abre fica fora. */
export async function carregarLogos(lista: LogoDoKitParaCarregar[]): Promise<LogoCarregada[]> {
  const out: LogoCarregada[] = [];
  for (const l of lista) {
    const onde = await ondeEstaALogo(l.path, l.fileId);
    if (!onde) continue;
    try {
      const img = await logoSemCaixaBranca(await carregarImagem(onde.caminho, onde.bucket));
      const m = medidas(img);
      out.push({
        id: l.id,
        imagem: img,
        largura: m.w,
        altura: m.h,
        luma: medirLogo(img),
        tom: l.tom === "clara" || l.tom === "escura" ? l.tom : null,
      });
    } catch {
      /* logo que não abre: a tela avisa pelo número de logos carregadas */
    }
  }
  return out;
}

/** Slot de mentira para a cena gerada: a área inteira é a placa ou a tela. */
export function slotDaCena(largura: number, altura: number): SlotDoMockup {
  return { indice: 1, papel: "arte", nome: "área lisa", soPx: [Math.max(1, Math.round(largura)), Math.max(1, Math.round(altura))], areaSegura: [0.08, 0.14, 0.92, 0.86], luminanciaSuperficie: null, pxNaTela: null };
}

/**
 * Cena gerada + design da marca nos 4 cantos (homografia), na escala pedida (1 = tamanho da cena).
 * Usada pela prévia do editor e pelo envio (inclusive de cena guardada numa visita anterior).
 */
export function comporCena(img: HTMLImageElement, cantos: Ponto[], logos: LogoCarregada[], escolhas: EscolhasDoDesign, luz: number, escala: number): HTMLCanvasElement | null {
  const W = Math.round(img.naturalWidth * escala);
  const H = Math.round(img.naturalHeight * escala);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx || cantos.length !== 4) return null;
  ctx.drawImage(img, 0, 0, W, H);
  const q = ordenarCantos(cantos).map((p) => ({ x: p.x * escala, y: p.y * escala }));
  const larg = Math.sqrt(Math.pow(q[1].x - q[0].x, 2) + Math.pow(q[1].y - q[0].y, 2));
  const alt = Math.sqrt(Math.pow(q[3].x - q[0].x, 2) + Math.pow(q[3].y - q[0].y, 2));
  const design = desenharDesign(slotDaCena(larg * 1.5, alt * 1.5), logos, escolhas, 1).canvas;
  const dctx = design.getContext("2d");
  if (!dctx) return c;
  const base = ctx.getImageData(0, 0, W, H);
  const out = projetarDesign(
    { largura: W, altura: H, pixels: base.data },
    { largura: design.width, altura: design.height, pixels: dctx.getImageData(0, 0, design.width, design.height).data },
    q,
    { luz },
  );
  ctx.putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}
