/**
 * Imagem reduzida para as funções SEM a transformação de imagem do Storage.
 *
 * 26/09/2026: o projeto passou da cota de "Storage Image Transformations"
 * (1.212 imagens de origem no ciclo contra 100 incluídas; com o teto de gastos
 * ligado o Supabase pode restringir o projeto). Nenhuma função pede mais
 * `download(..., { transform })`. A ordem agora é:
 *
 * 1. Cópia leve gravada pelo painel ao lado do original (src/lib/miniaturas.ts):
 *    `<caminho>.mini.jpg` (lado maior 640) e `<caminho>.media.jpg` (lado maior
 *    2048, só quando o original passa disso). Abrir a cópia custa pouco.
 * 2. O original, que volta como veio quando já cabe (só o cabeçalho é lido)
 *    ou é reduzido aqui (média de área, imagem-local.ts) quando é pequeno o
 *    bastante para o limite de 2 s de CPU da função.
 * 3. Original grande demais para abrir aqui: `cabe: false` com os bytes do
 *    original, e quem chamou segue o caminho que já usava quando a
 *    transformação falhava.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { dimensoesDoCabecalho, mimeDaImagem, reduzirParaCaber } from "./imagem-local.ts";

export const SUFIXO_MINIATURA = ".mini.jpg";
export const SUFIXO_MEDIA = ".media.jpg";
export const LADO_MINIATURA = 640;
export const LADO_MEDIA = 2048;

/**
 * Teto de pixels para reduzir o original dentro da função. Medido em 26/09
 * (Deno, imagescript): JPEG de 12 MP leva cerca de 1,1 s só para abrir; 6 MP
 * fica perto de 0,5 s e ainda deixa folga para o resto da chamada.
 */
export const MAX_PIXELS_REDUCAO_NA_FUNCAO = 6_000_000;

export const caminhoDaMiniatura = (caminho: string) => `${caminho}${SUFIXO_MINIATURA}`;
export const caminhoDaMedia = (caminho: string) => `${caminho}${SUFIXO_MEDIA}`;

export type OrigemDaReduzida = "miniatura" | "media" | "original";

export type ResultadoDaReducao = {
  /** true: bytes cabem na caixa pedida (com a folga). false: bytes são o original sem reduzir. */
  cabe: boolean;
  bytes: Uint8Array;
  mime: string;
  largura: number | null;
  altura: number | null;
  origem: OrigemDaReduzida;
};

export type OpcoesDaReducao = {
  /** Aceita até esta proporção acima da caixa sem reabrir a imagem (ex.: 1.05). */
  folga?: number;
  /** false: ignora as cópias do painel e vai direto ao original. */
  usarCopias?: boolean;
  /**
   * Logo: só aceita cópia em PNG. O painel grava a cópia em PNG quando a
   * origem tem transparência; cópia JPEG é descartada para a logo não perder
   * a nitidez do contorno.
   */
  copiaSoEmPng?: boolean;
  /** Maior arquivo aceito (bytes). */
  maxBytes?: number;
  /** Teto de pixels para reduzir o original aqui. */
  maxPixels?: number;
  qualidadeJpeg?: number;
  /**
   * Sem cópia e com o original caro de abrir aqui: pede a cópia a outra
   * chamada (copias-leves, com o próprio limite de CPU) e usa a média gravada.
   */
  pedirCopia?: boolean;
  /** Aceita a cópia média maior que a caixa, sem reabrir, até este tamanho em bytes. */
  aceitarCopiaMaiorAte?: number;
};

/**
 * Pede a cópia leve de uma imagem à função copias-leves (uma imagem por
 * chamada, com o próprio limite de CPU). Nunca lança: false quando não deu.
 */
export async function pedirCopiaLeve(bucket: string, caminho: string, prazoMs = 25_000): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chave) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), prazoMs);
  try {
    const r = await fetch(`${url}/functions/v1/copias-leves`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
      body: JSON.stringify({ bucket, caminho }),
      signal: ctrl.signal,
    });
    await r.body?.cancel().catch(() => undefined);
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function baixarBytes(db: SupabaseClient, bucket: string, caminho: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const { data, error } = await db.storage.from(bucket).download(caminho);
    if (error || !data) return null;
    if (typeof data.size === "number" && data.size > maxBytes) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  } catch {
    return null;
  }
}

function cabeNaCaixa(d: { largura: number; altura: number } | null, maxL: number, maxA: number, folga: number): boolean {
  return !!d && d.largura <= maxL * folga && d.altura <= maxA * folga;
}

/** Cópias que servem para a caixa pedida, da menor para a maior. */
export function copiasParaACaixa(maxL: number, maxA: number): OrigemDaReduzida[] {
  const menor = Math.min(maxL, maxA);
  if (menor <= LADO_MINIATURA * 1.25) return ["miniatura", "media"];
  if (menor <= LADO_MEDIA * 1.25) return ["media"];
  return [];
}

/**
 * Reduz para caber em maxL x maxA ("contain", sem ampliar e sem cortar), sem
 * a transformação do Storage. Null só quando nem o original pôde ser lido ou
 * não é imagem reconhecida.
 */
export async function reduzidaSemTransformacao(
  db: SupabaseClient,
  bucket: string,
  caminho: string,
  maxL: number,
  maxA: number,
  opcoes: OpcoesDaReducao = {},
): Promise<ResultadoDaReducao | null> {
  const folga = opcoes.folga ?? 1;
  const maxBytes = opcoes.maxBytes ?? 30 * 1024 * 1024;
  const maxPixels = opcoes.maxPixels ?? MAX_PIXELS_REDUCAO_NA_FUNCAO;

  if (opcoes.usarCopias !== false) {
    for (const origem of copiasParaACaixa(maxL, maxA)) {
      const bytes = await baixarBytes(db, bucket, origem === "miniatura" ? caminhoDaMiniatura(caminho) : caminhoDaMedia(caminho), maxBytes);
      const mime = bytes ? mimeDaImagem(bytes) : null;
      if (!bytes || !mime) continue;
      if (opcoes.copiaSoEmPng && mime !== "image/png") continue;
      const d = dimensoesDoCabecalho(bytes);
      if (cabeNaCaixa(d, maxL, maxA, folga)) return { cabe: true, bytes, mime, largura: d!.largura, altura: d!.altura, origem };
      // Quem chama várias imagens de uma vez aceita a cópia um pouco maior como está (sem gastar CPU abrindo).
      if (opcoes.aceitarCopiaMaiorAte && bytes.byteLength <= opcoes.aceitarCopiaMaiorAte) {
        return { cabe: true, bytes, mime, largura: d?.largura ?? null, altura: d?.altura ?? null, origem };
      }
      // Cópia maior que a caixa: reduzir a cópia (no máximo 2048 px) é barato.
      const r = await reduzirParaCaber(bytes, maxL, maxA, { qualidadeJpeg: opcoes.qualidadeJpeg, maxPixels: LADO_MEDIA * LADO_MEDIA });
      if (r) return { cabe: true, bytes: r.bytes, mime: r.mime, largura: r.largura, altura: r.altura, origem };
    }
  }

  const original = await baixarBytes(db, bucket, caminho, maxBytes);
  const mime = original ? mimeDaImagem(original) : null;
  if (!original || !mime) return null;
  const d = dimensoesDoCabecalho(original);
  if (cabeNaCaixa(d, maxL, maxA, folga)) return { cabe: true, bytes: original, mime, largura: d!.largura, altura: d!.altura, origem: "original" };
  const caroDeAbrir = !d || d.largura * d.altura > maxPixels;
  if (!caroDeAbrir) {
    const r = await reduzirParaCaber(original, maxL, maxA, { qualidadeJpeg: opcoes.qualidadeJpeg, maxPixels });
    if (r) return { cabe: true, bytes: r.bytes, mime: r.mime, largura: r.largura, altura: r.altura, origem: "original" };
  }
  // Caro de abrir aqui: a cópia vem de outra chamada (copias-leves) e é usada como está.
  if (opcoes.pedirCopia && (await pedirCopiaLeve(bucket, caminho))) {
    // Caixa pequena (leitura, classificação): a miniatura que a copias-leves também gravou já cabe.
    if (copiasParaACaixa(maxL, maxA)[0] === "miniatura") {
      const mini = await baixarBytes(db, bucket, caminhoDaMiniatura(caminho), maxBytes);
      const mm = mini ? mimeDaImagem(mini) : null;
      const dm = mini ? dimensoesDoCabecalho(mini) : null;
      if (mini && mm && !(opcoes.copiaSoEmPng && mm !== "image/png") && cabeNaCaixa(dm, maxL, maxA, folga)) {
        return { cabe: true, bytes: mini, mime: mm, largura: dm!.largura, altura: dm!.altura, origem: "miniatura" };
      }
    }
    const copia = await baixarBytes(db, bucket, caminhoDaMedia(caminho), maxBytes);
    const mc = copia ? mimeDaImagem(copia) : null;
    const dc = copia ? dimensoesDoCabecalho(copia) : null;
    if (copia && mc && (cabeNaCaixa(dc, maxL, maxA, folga) || copia.byteLength <= (opcoes.aceitarCopiaMaiorAte ?? 0))) {
      return { cabe: true, bytes: copia, mime: mc, largura: dc?.largura ?? null, altura: dc?.altura ?? null, origem: "media" };
    }
  }
  return { cabe: false, bytes: original, mime, largura: d?.largura ?? null, altura: d?.altura ?? null, origem: "original" };
}
