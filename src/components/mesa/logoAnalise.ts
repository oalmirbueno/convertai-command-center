import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * A logo lida no navegador (pedido do dono, 25/09: "a imagem com o texto
 * branco tem que ser legível; às vezes a logo é branca e ele não vai
 * conseguir ler"). Três perguntas, pelos pixels da própria imagem:
 * - a logo é clara (branca, some em fundo claro) ou escura?
 * - ela tem fundo opaco liso (branco, creme, preto) que vira caixa na arte?
 * - dá para ler? (letras brancas sobre fundo branco não dá)
 *
 * A régua de "clara" é a mesma do servidor (analisarLogo, imagem-local.ts):
 * luminância média acima de 0,45 ou parte branca de 20% ou mais.
 * Sem createImageBitmap (Safari 11) a imagem abre por <img>.
 */

export type TomDaLogo = "clara" | "escura";
export type TipoDeFundo = "branco" | "creme" | "preto" | "liso";
/** Fundo de conferência da logo na tela: xadrez (neutro), claro ou escuro. */
export type FundoDaLogo = "xadrez" | "claro" | "escuro";

export interface AnaliseDaLogo {
  tom: TomDaLogo;
  /** A borda já é transparente (PNG recortado). */
  transparente: boolean;
  /** Fundo opaco liso em volta do desenho; null quando é transparente ou não é liso (foto). */
  fundo: { tipo: TipoDeFundo; hex: string } | null;
  /** Quase nada se destaca do fundo: letras brancas sobre branco, por exemplo. */
  ilegivel: boolean;
}

type Pixels = Uint8ClampedArray | Uint8Array;

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminancia = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hexDe = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => ("0" + Math.round(v).toString(16)).slice(-2)).join("").toUpperCase()}`;
const distancia = (px: Pixels, i: number, cor: number[]) => Math.max(Math.abs(px[i] - cor[0]), Math.abs(px[i + 1] - cor[1]), Math.abs(px[i + 2] - cor[2]));

export function tipoDoFundo(r: number, g: number, b: number): TipoDeFundo {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx <= 45) return "preto";
  if (mn >= 232 && mx - mn <= 14) return "branco";
  if (mn >= 185 && mx - mn <= 45) return "creme";
  return "liso";
}

/** Índices da moldura de 1 px da imagem. */
function borda(W: number, H: number): number[] {
  const saida: number[] = [];
  for (let x = 0; x < W; x++) {
    saida.push(x);
    if (H > 1) saida.push((H - 1) * W + x);
  }
  for (let y = 1; y < H - 1; y++) {
    saida.push(y * W);
    if (W > 1) saida.push(y * W + W - 1);
  }
  return saida;
}

/** Análise pelos pixels RGBA (já reduzidos). Null para imagem vazia ou toda transparente. */
export function analisarPixels(px: Pixels, W: number, H: number): AnaliseDaLogo | null {
  if (!W || !H || px.length < W * H * 4) return null;
  const moldura = borda(W, H);
  let transparentes = 0;
  let sr = 0, sg = 0, sb = 0, opacosNaBorda = 0;
  for (const p of moldura) {
    const i = p * 4;
    if (px[i + 3] < 16) {
      transparentes++;
      continue;
    }
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
    opacosNaBorda++;
  }
  const transparente = transparentes >= moldura.length * 0.5;
  let corDoFundo: number[] | null = null;
  if (!transparente && opacosNaBorda) {
    const media = [sr / opacosNaBorda, sg / opacosNaBorda, sb / opacosNaBorda];
    let parecidos = 0;
    for (const p of moldura) {
      const i = p * 4;
      if (px[i + 3] >= 16 && distancia(px, i, media) <= 28) parecidos++;
    }
    if (parecidos >= opacosNaBorda * 0.85) corDoFundo = media;
  }

  // Desenho: o que é opaco e (com fundo liso) se afasta da cor do fundo.
  let n = 0, brancos = 0, somaR = 0, somaG = 0, somaB = 0, opacos = 0;
  for (let i = 0; i < W * H * 4; i += 4) {
    if (px[i + 3] < 128) continue;
    opacos++;
    if (corDoFundo && distancia(px, i, corDoFundo) <= 48) continue;
    n++;
    somaR += px[i];
    somaG += px[i + 1];
    somaB += px[i + 2];
    const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
    if (mn > 235 && mx - mn <= 20) brancos++;
  }
  if (!opacos) return null;
  const fundo = corDoFundo ? { tipo: tipoDoFundo(corDoFundo[0], corDoFundo[1], corDoFundo[2]), hex: hexDe(corDoFundo[0], corDoFundo[1], corDoFundo[2]) } : null;
  const lumFundo = corDoFundo ? luminancia(corDoFundo[0], corDoFundo[1], corDoFundo[2]) : null;

  if (!n) {
    // Nada se destaca do fundo liso: se o fundo é claro, é a logo branca sobre branco.
    const claroDemais = lumFundo !== null && lumFundo > 0.45;
    return { tom: claroDemais ? "clara" : "escura", transparente, fundo, ilegivel: true };
  }
  const lumDesenho = luminancia(somaR / n, somaG / n, somaB / n);
  const tom: TomDaLogo = lumDesenho > 0.45 || brancos / n >= 0.2 ? "clara" : "escura";
  // Pouco desenho, ou desenho quase da cor do fundo: não dá para ler.
  const ilegivel = lumFundo !== null && (n < W * H * 0.004 || contraste(lumFundo, lumDesenho) < 1.8);
  return { tom, transparente, fundo, ilegivel };
}

/** Fundo da miniatura que dá contraste com a logo: escuro para a clara, claro para a escura, xadrez sem saber. */
export function fundoDeConferencia(tom: TomDaLogo | null | undefined): FundoDaLogo {
  if (tom === "clara") return "escuro";
  if (tom === "escura") return "claro";
  return "xadrez";
}

/** Valor gravado no banco (logo_tom) em forma segura. */
export function tomGravado(valor: unknown): TomDaLogo | null {
  return valor === "clara" || valor === "escura" ? valor : null;
}

/** Cinza médio em xadrez: nem a logo branca nem a preta somem nele. */
export const XADREZ_NEUTRO = {
  backgroundColor: "#BDBDBD",
  backgroundImage:
    "linear-gradient(45deg, #A3A3A3 25%, transparent 25%), linear-gradient(-45deg, #A3A3A3 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #A3A3A3 75%), linear-gradient(-45deg, transparent 75%, #A3A3A3 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};
/** Os mesmos fundos que o servidor põe atrás da logo para o gerador (FUNDO_DA_LOGO_CLARA/ESCURA). */
export const FUNDO_ESCURO_DA_LOGO = "#2B2B2B";
export const FUNDO_CLARO_DA_LOGO = "#F2F2F2";

export function estiloDoFundoDaLogo(fundo: FundoDaLogo): Record<string, string> {
  if (fundo === "claro") return { backgroundColor: FUNDO_CLARO_DA_LOGO };
  if (fundo === "escuro") return { backgroundColor: FUNDO_ESCURO_DA_LOGO };
  return XADREZ_NEUTRO;
}

/**
 * Tira o fundo liso ligado à borda. O preenchimento parte das bordas, como no
 * servidor (logoLimpa): a cor do fundo que fica presa dentro de uma letra
 * fechada não sai. A franja de 2 px perde a mistura com o fundo. Mexe nos
 * pixels. Devolve quantos pixels ficaram transparentes.
 * Nunca roda em logo que já é transparente (guarda do servidor, 26/09: o
 * preenchimento atravessava a transparência e apagava letras brancas).
 */
export function tirarFundoLiso(px: Pixels, W: number, H: number, hex: string): number {
  const cor = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  if (cor.some((v) => !isFinite(v))) return 0;
  // 0 = não visto; 1 = na pilha ou fica; 2 = fundo tirado. Pilha tipada: cada
  // pixel entra no máximo uma vez (logo de 2048 px sem estourar a memória do celular).
  const visto = new Uint8Array(W * H);
  const pilha = new Int32Array(W * H);
  let topo = 0;
  const empilhar = (p: number) => {
    if (visto[p]) return;
    visto[p] = 1;
    pilha[topo++] = p;
  };
  borda(W, H).forEach(empilhar);
  let limpos = 0;
  while (topo > 0) {
    const p = pilha[--topo];
    const i = p * 4;
    if (px[i + 3] >= 16 && distancia(px, i, cor) > 40) continue;
    px[i + 3] = 0;
    visto[p] = 2;
    limpos++;
    const x = p % W, y = (p - x) / W;
    if (x > 0) empilhar(p - 1);
    if (x < W - 1) empilhar(p + 1);
    if (y > 0) empilhar(p - W);
    if (y < H - 1) empilhar(p + W);
  }
  for (let passe = 0; passe < 2; passe++) {
    const franja: number[] = [];
    for (let p = 0; p < W * H; p++) {
      if (visto[p] === 2 || px[p * 4 + 3] === 0) continue;
      const x = p % W;
      if ((x > 0 && visto[p - 1] === 2) || (x < W - 1 && visto[p + 1] === 2) || (p >= W && visto[p - W] === 2) || (p + W < W * H && visto[p + W] === 2)) franja.push(p);
    }
    for (const p of franja) {
      const i = p * 4;
      const a = Math.min(1, distancia(px, i, cor) / 90);
      if (a < 1) {
        if (a <= 0.02) px[i + 3] = 0;
        else {
          for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - cor[c] * (1 - a)) / a)));
          px[i + 3] = Math.round(px[i + 3] * a);
        }
      }
      visto[p] = 2;
    }
  }
  return limpos;
}

// ------------------------------------------------------------------ navegador

type Aberta = { width: number; height: number } & CanvasImageSource;

/** Abre a imagem: createImageBitmap quando existe e funciona; senão <img> (Safari 11). */
export async function abrirImagemDaLogo(blob: Blob): Promise<Aberta> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* formato que o bitmap não abre: tenta pelo <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a logo."));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function desenhar(img: Aberta, lado: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; W: number; H: number } | null {
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * escala));
  const H = Math.max(1, Math.round(img.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  return { canvas, ctx, W, H };
}

/** Análise da logo a partir do arquivo (reduzida a 160 px). Null se o navegador não conseguir ler. */
export async function analisarBlobDaLogo(blob: Blob): Promise<AnaliseDaLogo | null> {
  const img = await abrirImagemDaLogo(blob);
  const d = desenhar(img, 160);
  if (!d) return null;
  const dados = d.ctx.getImageData(0, 0, d.W, d.H);
  return analisarPixels(dados.data, d.W, d.H);
}

/**
 * A logo sem o fundo liso, em PNG (lado máximo 2048 px, o mesmo limite do
 * kit). Null quando não dá para tirar com segurança: quase nada ou quase
 * tudo sairia (aí o fundo não era fundo).
 */
export async function logoSemFundo(blob: Blob, analise: AnaliseDaLogo, ladoMaximo = 2048): Promise<Blob | null> {
  if (!analise.fundo || analise.transparente) return null;
  const img = await abrirImagemDaLogo(blob);
  const d = desenhar(img, ladoMaximo);
  if (!d) return null;
  const dados = d.ctx.getImageData(0, 0, d.W, d.H);
  const limpos = tirarFundoLiso(dados.data, d.W, d.H, analise.fundo.hex);
  const total = d.W * d.H;
  if (limpos < total * 0.01 || limpos > total * 0.97) return null;
  d.ctx.putImageData(dados, 0, 0);
  return await new Promise<Blob | null>((resolver) => d.canvas.toBlob(resolver, "image/png"));
}

/** Tom da logo guardada no Storage, lido uma vez por caminho (a logo gravada não muda no mesmo caminho). */
export function useTomDaLogo(imagem: { bucket: string; caminho: string } | null, gravado: TomDaLogo | null) {
  return useQuery({
    queryKey: ["mesa", "tom-da-logo", imagem ? imagem.bucket : "", imagem ? imagem.caminho : ""],
    enabled: !!imagem && !gravado,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AnaliseDaLogo | null> => {
      if (!imagem) return null;
      const { data, error } = await supabase.storage.from(imagem.bucket).download(imagem.caminho);
      if (error || !data) return null;
      return await analisarBlobDaLogo(data).catch(() => null);
    },
  });
}
