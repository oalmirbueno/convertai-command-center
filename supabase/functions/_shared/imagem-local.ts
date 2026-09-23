/**
 * Operações de imagem feitas na própria função, sem IA e sem custo:
 * tela dupla para o carrossel contínuo, máscara de edição, recorte, foto real
 * no formato 4:5 e a devolução dos pixels originais fora da área editada.
 *
 * Regra do dono (23/09): quando a lâmina usa uma foto real do cliente, a foto
 * não é refeita pelo gerador. O gerador desenha só onde a máscara abre (texto,
 * logo, área pedida) e o código devolve a foto original em todo o resto.
 *
 * Medido em 23/09 (Deno, 1088 x 1360): decodificar 33 ms, tela dupla 66 ms,
 * máscara 36 ms, recorte 74 ms, mistura com pena 136 ms.
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

export const LARGURA_LAMINA = 1088;
export const ALTURA_LAMINA = 1360;
export const TAMANHO_TELA_DUPLA = `${LARGURA_LAMINA * 2}x${ALTURA_LAMINA}`;

/** Área relativa à lâmina, de 0 a 1 (canto superior esquerdo até o inferior direito). */
export type Area = { x0: number; y0: number; x1: number; y1: number };

const limitar = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Normaliza as áreas pedidas pela tela: ordena os cantos, corta em [0,1] e descarta áreas vazias. */
export function normalizarAreas(bruto: unknown, max = 6): Area[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Area[] = [];
  for (const a of bruto.slice(0, max)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const xa = limitar(Number(r.x0)), xb = limitar(Number(r.x1));
    const ya = limitar(Number(r.y0)), yb = limitar(Number(r.y1));
    const area = { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
    if (area.x1 - area.x0 >= 0.02 && area.y1 - area.y0 >= 0.02) saida.push(area);
  }
  return saida;
}

export async function decodificar(bytes: Uint8Array): Promise<Image> {
  const img = await Image.decode(bytes);
  if (!(img instanceof Image)) throw new Error("imagem_animada");
  return img;
}

/** Recorte "cover" pelo centro no tamanho pedido (padrão: lâmina 4:5). */
export function cobrir(img: Image, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Image {
  const escala = Math.max(largura / img.width, altura / img.height);
  const l = Math.max(largura, Math.round(img.width * escala));
  const a = Math.max(altura, Math.round(img.height * escala));
  const c = img.clone();
  if (l !== img.width || a !== img.height) c.resize(l, a);
  return c.crop(Math.floor((l - largura) / 2), Math.floor((a - altura) / 2), largura, altura);
}

/** Foto qualquer (JPEG, PNG) vira PNG 1088 x 1360 pelo centro. */
export async function fotoNaLamina(bytes: Uint8Array): Promise<Uint8Array> {
  return await cobrir(await decodificar(bytes)).encode(1);
}

/**
 * Máscara no padrão do editor da OpenAI: pixel transparente = pode mudar;
 * opaco = fica. `abertas` em coordenadas relativas à tela inteira.
 */
export async function mascara(largura: number, altura: number, abertas: Area[]): Promise<Uint8Array> {
  const m = new Image(largura, altura);
  m.fill(0xffffffff);
  for (const a of abertas) {
    const x = Math.floor(a.x0 * largura), y = Math.floor(a.y0 * altura);
    const w = Math.max(1, Math.ceil((a.x1 - a.x0) * largura)), h = Math.max(1, Math.ceil((a.y1 - a.y0) * altura));
    // drawBox usa coordenadas a partir de 1.
    m.drawBox(x + 1, y + 1, w, h, 0x00000000);
  }
  return await m.encode(1);
}

/**
 * Tela dupla do carrossel contínuo: a lâmina anterior à esquerda, a metade
 * direita vazia para o gerador pintar a continuação. Devolve a tela e a máscara.
 */
export async function telaDupla(anterior: Uint8Array): Promise<{ tela: Uint8Array; mascara: Uint8Array }> {
  const esquerda = cobrir(await decodificar(anterior));
  const tela = new Image(LARGURA_LAMINA * 2, ALTURA_LAMINA);
  tela.fill(0x808080ff);
  tela.composite(esquerda, 0, 0);
  return {
    tela: await tela.encode(1),
    mascara: await mascara(LARGURA_LAMINA * 2, ALTURA_LAMINA, [{ x0: 0.5, y0: 0, x1: 1, y1: 1 }]),
  };
}

/** Metade direita da tela dupla, já no tamanho da lâmina. */
export async function metadeDireita(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await decodificar(bytes);
  const meio = Math.floor(img.width / 2);
  const direita = img.clone().crop(meio, 0, img.width - meio, img.height);
  return await cobrir(direita).encode(1);
}

/**
 * O gerador redesenha a imagem inteira mesmo com máscara. Aqui os pixels do
 * original voltam em tudo o que ficou fora das áreas abertas, com uma pena
 * suave na borda para não marcar a emenda.
 */
export async function devolverOriginalForaDasAreas(
  original: Uint8Array,
  gerado: Uint8Array,
  abertas: Area[],
  penaPx = 28,
): Promise<Uint8Array> {
  const g = await decodificar(gerado);
  const o = cobrir(await decodificar(original), g.width, g.height);
  const W = g.width, H = g.height;
  const caixas = abertas.map((a) => ({
    x0: a.x0 * W, y0: a.y0 * H, x1: a.x1 * W, y1: a.y1 * H,
  }));
  const fg = g.bitmap, bg = o.bitmap;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Distância até a área aberta mais próxima (0 dentro dela).
      let dist = Infinity;
      for (const c of caixas) {
        const dx = Math.max(c.x0 - x, 0, x - c.x1);
        const dy = Math.max(c.y0 - y, 0, y - c.y1);
        const d = Math.max(dx, dy);
        if (d < dist) dist = d;
        if (dist === 0) break;
      }
      if (dist === 0) continue;
      const peso = Math.min(1, dist / penaPx);
      const i = (y * W + x) * 4;
      fg[i] = fg[i] * (1 - peso) + bg[i] * peso;
      fg[i + 1] = fg[i + 1] * (1 - peso) + bg[i + 1] * peso;
      fg[i + 2] = fg[i + 2] * (1 - peso) + bg[i + 2] * peso;
      fg[i + 3] = 255;
    }
  }
  return await g.encode(1);
}

/** Amplia a área em volta (margem relativa), para o gerador ter espaço de fundir a borda. */
export function ampliar(a: Area, margem = 0.03): Area {
  return { x0: limitar(a.x0 - margem), y0: limitar(a.y0 - margem), x1: limitar(a.x1 + margem), y1: limitar(a.y1 + margem) };
}
