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

/**
 * Foto qualquer (JPEG, PNG) vira PNG no tamanho da lâmina pelo centro:
 * 1088 x 1360 por padrão (post e carrossel 4:5); o criativo de anúncio passa
 * o tamanho do formato (1088 x 1088 no 1:1, 1088 x 1920 no 9:16).
 */
export async function fotoNaLamina(bytes: Uint8Array, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA): Promise<Uint8Array> {
  return await cobrir(await decodificar(bytes), largura, altura).encode(1);
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

/**
 * Tom dominante e claridade da logo, para o prompt pôr atrás dela um fundo de
 * valor oposto (logo azul nunca sobre fundo azul). Ignora pixels transparentes
 * e, em logo sem transparência, o fundo quase branco.
 */
export async function analisarLogo(bytes: Uint8Array): Promise<{ tom: string | null; clara: boolean }> {
  const img = await decodificar(bytes);
  const pequena = img.width > 200 ? img.clone().resize(200, Image.RESIZE_AUTO) : img;
  const b = pequena.bitmap;
  let r = 0, g = 0, bl = 0, n = 0, opacos = 0;
  for (let i = 0; i < b.length; i += 4) {
    if (b[i + 3] < 128) continue;
    opacos++;
    const claro = b[i] > 235 && b[i + 1] > 235 && b[i + 2] > 235;
    if (claro) continue;
    r += b[i]; g += b[i + 1]; bl += b[i + 2]; n++;
  }
  // Quase tudo branco: logo branca (versão para fundo escuro).
  if (!opacos || n < opacos * 0.08) return { tom: "#FFFFFF", clara: true };
  r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminancia = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const hex = `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return { tom: hex, clara: luminancia > 0.45 };
}

/**
 * Logo pronta para anexar ao gerador: no máximo 512 px e sem fundo falso.
 * Muita logo chega com o "xadrez" de transparência desenhado na própria imagem
 * (ou com fundo branco); o gerador copia isso como uma caixa. Aqui o fundo
 * claro e sem cor ligado à borda vira transparente (preenchimento a partir das
 * bordas, então o branco de dentro da logo fica).
 */
export async function logoLimpa(bytes: Uint8Array): Promise<Uint8Array> {
  const img = await decodificar(bytes);
  const l = img.width > 512 || img.height > 512 ? img.clone().contain(512, 512) : img.clone();
  const W = l.width, H = l.height, b = l.bitmap;
  const fundo = (i: number) => {
    if (b[i + 3] < 16) return true;
    const r = b[i], g = b[i + 1], bl = b[i + 2];
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
    return min >= 200 && max - min <= 18;
  };
  const visto = new Uint8Array(W * H);
  const pilha: number[] = [];
  for (let x = 0; x < W; x++) pilha.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) pilha.push(y * W, y * W + W - 1);
  let limpos = 0;
  while (pilha.length) {
    const p = pilha.pop()!;
    if (visto[p]) continue;
    visto[p] = 1;
    if (!fundo(p * 4)) continue;
    b[p * 4 + 3] = 0;
    limpos++;
    const x = p % W, y = (p - x) / W;
    if (x > 0) pilha.push(p - 1);
    if (x < W - 1) pilha.push(p + 1);
    if (y > 0) pilha.push(p - W);
    if (y < H - 1) pilha.push(p + W);
  }
  // Nada ou quase tudo limpo: a logo não tinha fundo falso (ou é branca); vai como veio.
  if (limpos < W * H * 0.05 || limpos > W * H * 0.97) return bytes;
  return await l.encode(1);
}

/** Amplia a área em volta (margem relativa), para o gerador ter espaço de fundir a borda. */
export function ampliar(a: Area, margem = 0.03): Area {
  return { x0: limitar(a.x0 - margem), y0: limitar(a.y0 - margem), x1: limitar(a.x1 + margem), y1: limitar(a.y1 + margem) };
}

// ------------------------------------------------ panorama do carrossel contínuo
//
// Correção de 23/09 (noite): a tela dupla antiga não emendava. O gerador
// redesenha a tela inteira mesmo com máscara, e a lâmina nova continuava a
// cópia redesenhada da anterior, não a anterior de verdade. Agora o fundo do
// carrossel nasce como UM panorama (trechos de até 3 lâminas), é fatiado e
// cada lâmina recebe o texto por cima só na área do texto: as emendas batem
// porque as fatias vêm da mesma imagem.

/** Tamanho do trecho de k lâminas lado a lado (múltiplos de 16, proporção até 2,4:1). */
export const tamanhoDoTrecho = (k: number) => `${LARGURA_LAMINA * k}x${ALTURA_LAMINA}`;

/**
 * Tela do trecho seguinte: a primeira lâmina (o fundo já pronto do trecho
 * anterior) à esquerda e o resto aberto na máscara para o gerador continuar.
 */
export async function telaDoTrecho(k: number, primeira: Uint8Array): Promise<{ tela: Uint8Array; mascara: Uint8Array }> {
  const W = LARGURA_LAMINA * k;
  const tela = new Image(W, ALTURA_LAMINA);
  tela.fill(0x808080ff);
  tela.composite(cobrir(await decodificar(primeira)), 0, 0);
  return {
    tela: await tela.encode(1),
    mascara: await mascara(W, ALTURA_LAMINA, [{ x0: 1 / k, y0: 0, x1: 1, y1: 1 }]),
  };
}

/** Corta o trecho em k fundos 1088 x 1360, da esquerda para a direita. */
export async function fatiarPanorama(bytes: Uint8Array, k: number): Promise<Uint8Array[]> {
  const img = cobrir(await decodificar(bytes), LARGURA_LAMINA * k, ALTURA_LAMINA);
  const fatias: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    fatias.push(await img.clone().crop(i * LARGURA_LAMINA, 0, LARGURA_LAMINA, ALTURA_LAMINA).encode(1));
  }
  return fatias;
}

/**
 * Emenda entre trechos: o gerador redesenha de leve a lâmina de ligação, então
 * a borda esquerda do fundo novo pode sair num tom um pouco diferente da borda
 * direita do fundo que já existe. Aqui a diferença de cor de cada linha na
 * divisa é medida e aplicada no fundo novo, sumindo aos poucos em `faixa` px.
 */
export async function corrigirEmenda(anterior: Uint8Array, nova: Uint8Array, faixa = 180): Promise<Uint8Array> {
  const a = cobrir(await decodificar(anterior));
  const n = cobrir(await decodificar(nova));
  const W = n.width, H = n.height;
  const pa = a.bitmap, pn = n.bitmap;
  const media = (bm: Uint8ClampedArray, y: number, x0: number, x1: number, c: number) => {
    let s = 0, q = 0;
    for (let x = x0; x < x1; x++) { s += bm[(y * W + x) * 4 + c]; q++; }
    return s / Math.max(1, q);
  };
  // Diferença por linha (R, G, B) medida em 6 colunas de cada lado da divisa.
  const delta: number[][] = [];
  for (let y = 0; y < H; y++) {
    delta.push([0, 1, 2].map((c) => media(pa, y, W - 6, W, c) - media(pn, y, 0, 6, c)));
  }
  // Suaviza entre linhas para não criar listras.
  const R = 16;
  const suave = delta.map((_, y) => [0, 1, 2].map((c) => {
    let s = 0, q = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy >= 0 && yy < H) { s += delta[yy][c]; q++; } }
    return s / q;
  }));
  const larg = Math.min(faixa, W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < larg; x++) {
      const peso = 1 - x / larg;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) pn[i + c] = Math.max(0, Math.min(255, pn[i + c] + suave[y][c] * peso));
    }
  }
  return await n.encode(1);
}
