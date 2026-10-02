/**
 * FPS lido do próprio arquivo (02/10, auditoria do "Pacote para editar":
 * "FPS não informado"). Lê só o cabeçalho do MP4/MOV (caixas moov > trak >
 * mdia: mdhd dá a escala de tempo, hdlr diz se a trilha é de vídeo, stts dá a
 * duração de cada quadro), por pedaços (Range), sem baixar o vídeo. Puro: quem
 * chama passa a função que lê os bytes [ini, fim).
 */

export type LerBytes = (ini: number, fim: number) => Promise<Uint8Array>;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const tipo = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

interface Caixa {
  tipo: string;
  ini: number;
  corpo: number;
  fim: number;
}

/** Caixas filhas dentro de [ini, fim) de um buffer. */
function caixas(b: Uint8Array, ini: number, fim: number): Caixa[] {
  const saida: Caixa[] = [];
  let o = ini;
  while (o + 8 <= fim) {
    let tam = u32(b, o);
    let cab = 8;
    if (tam === 1 && o + 16 <= fim) {
      tam = u32(b, o + 8) * 4294967296 + u32(b, o + 12);
      cab = 16;
    } else if (tam === 0) tam = fim - o;
    if (tam < cab || o + tam > fim) break;
    saida.push({ tipo: tipo(b, o + 4), ini: o, corpo: o + cab, fim: o + tam });
    o += tam;
  }
  return saida;
}

const filha = (b: Uint8Array, c: Caixa, t: string) => caixas(b, c.corpo, c.fim).find((x) => x.tipo === t) || null;

/** FPS da trilha de vídeo dentro do conteúdo de um moov (o buffer começa no moov). */
export function fpsDoMoov(b: Uint8Array): number | null {
  const moov = caixas(b, 0, b.length).find((x) => x.tipo === "moov");
  if (!moov) return null;
  for (const trak of caixas(b, moov.corpo, moov.fim).filter((x) => x.tipo === "trak")) {
    const mdia = filha(b, trak, "mdia");
    if (!mdia) continue;
    const hdlr = filha(b, mdia, "hdlr");
    if (!hdlr || tipo(b, hdlr.corpo + 8) !== "vide") continue;
    const mdhd = filha(b, mdia, "mdhd");
    if (!mdhd) continue;
    const versao = b[mdhd.corpo];
    const escala = u32(b, mdhd.corpo + (versao === 1 ? 20 : 12));
    const minf = filha(b, mdia, "minf");
    const stbl = minf ? filha(b, minf, "stbl") : null;
    const stts = stbl ? filha(b, stbl, "stts") : null;
    if (!stts || !escala) continue;
    const n = u32(b, stts.corpo + 4);
    let melhor = { qtd: 0, delta: 0 };
    for (let k = 0; k < Math.min(n, 2000); k++) {
      const o = stts.corpo + 8 + k * 8;
      if (o + 8 > stts.fim) break;
      const qtd = u32(b, o);
      const delta = u32(b, o + 4);
      if (qtd > melhor.qtd && delta > 0) melhor = { qtd, delta };
    }
    if (!melhor.delta) continue;
    return normalizarFps(escala / melhor.delta);
  }
  return null;
}

/** 29,97 vira 30; 23,976 vira 24; 59,94 vira 60 (o projeto trabalha em quadros inteiros). */
export function normalizarFps(f: number): number | null {
  if (!isFinite(f) || f < 5 || f > 240) return null;
  return Math.round(f);
}

/** Acha o moov (no começo ou depois do mdat) e lê o FPS. Null quando não deu (o painel pede para escolher). */
export async function fpsDoMp4(ler: LerBytes, tamanhoMaximo = 8_000_000_000): Promise<number | null> {
  let o = 0;
  for (let volta = 0; volta < 24 && o < tamanhoMaximo; volta++) {
    const cab = await ler(o, o + 16);
    if (cab.length < 8) return null;
    let tam = u32(cab, 0);
    if (tam === 1 && cab.length >= 16) tam = u32(cab, 8) * 4294967296 + u32(cab, 12);
    const t = tipo(cab, 4);
    if (tam < 8) return null;
    if (t === "moov") {
      if (tam > 64_000_000) return null;
      return fpsDoMoov(await ler(o, o + tam));
    }
    o += tam;
  }
  return null;
}

/** Leitor por Range de uma URL (assinada) do armazenamento. */
export const lerPorUrl =
  (url: string): LerBytes =>
  async (ini, fim) => {
    const r = await fetch(url, { headers: { Range: `bytes=${ini}-${Math.max(ini, fim - 1)}` } });
    if (!r.ok && r.status !== 206) throw new Error(`Leitura do arquivo falhou (${r.status}).`);
    const b = new Uint8Array(await r.arrayBuffer());
    // Servidor sem Range devolve o arquivo inteiro: corta o pedaço pedido.
    return r.status === 206 ? b : b.subarray(ini, fim);
  };
