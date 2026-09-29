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

/** Mede a luma de uma logo numa cópia pequena (64 px). */
export function medirLogo(img: HTMLImageElement): number | null {
  const lado = 64;
  const f = Math.min(1, lado / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * f));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * f));
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

/** Carrega as logos do kit (principal e alternativa) e mede cada uma. Logo que não abre fica fora. */
export async function carregarLogos(lista: LogoDoKitParaCarregar[]): Promise<LogoCarregada[]> {
  const out: LogoCarregada[] = [];
  for (const l of lista) {
    const onde = await ondeEstaALogo(l.path, l.fileId);
    if (!onde) continue;
    try {
      const img = await carregarImagem(onde.caminho, onde.bucket);
      out.push({
        id: l.id,
        imagem: img,
        largura: img.naturalWidth,
        altura: img.naturalHeight,
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
