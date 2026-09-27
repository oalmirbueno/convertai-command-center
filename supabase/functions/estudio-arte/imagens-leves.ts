/**
 * Imagens leves no Estúdio (anti-bug AB2, 26/09): de onde vêm os bytes e
 * quantas imagens abrem por chamada, sem mudar o resultado aprovado.
 *
 * O limite da função é de 2 s de CPU. Abrir (decodificar) uma foto de 25 MP
 * leva mais que isso sozinho; 12 MP levam cerca de 1,1 s. Por isso:
 * - o que precisa ABRIR aqui (foto na lâmina, recorte, quadro da prancha,
 *   logo) usa a cópia leve gravada ao lado do original (pedida à copias-leves
 *   quando falta) e só abre o original até o teto de pixels;
 * - o que vai ao gerador COMO ESTÁ (anexos) segue cru quando é leve, o caso de
 *   sempre, e vira a cópia média (2048 px) quando é pesado, para caber no teto
 *   de 24 MB de imagens por pedido;
 * - a entrega recorta no máximo algumas lâminas fora da proporção por chamada.
 *
 * Só funções puras e constantes (o vitest lê este arquivo): nada de Deno,
 * npm ou abrir imagem aqui. Sem travessão nos textos de tela.
 */
import type { ResultadoDaReducao } from "../_shared/imagem-reduzida.ts";

/** Anexo cru segue como está até este tamanho (acima, a cópia média). */
export const MAX_BYTES_ANEXO_CRU = 6 * 1024 * 1024;
/** Sem cópia possível, o anexo cru ainda vai até este tamanho (base64 perto de 16 MB). */
export const MAX_BYTES_ANEXO_SEM_COPIA = 12 * 1024 * 1024;
/** Leitura em lote (até 12 fotos por chamada): só reduz aqui o que é barato de abrir. */
export const MAX_PIXELS_LEITURA_EM_LOTE = 700_000;
/** Anexo reduzido (fotos do rosto, elemento no replicar): redução aqui só quando é barata. */
export const MAX_PIXELS_REDUZIR_ANEXO = 1_500_000;
/** Entrega: lâminas fora da proporção recortadas (abertas) numa chamada só. */
export const MAX_RECORTES_NA_ENTREGA = 3;

type Dimensoes = { largura: number | null; altura: number | null } | null | undefined;

/** Original que pode abrir aqui: tamanho conhecido e até o teto de pixels. */
export function abreAqui(d: Dimensoes, tetoDePixels: number): boolean {
  return !!d && !!d.largura && !!d.altura && d.largura * d.altura <= tetoDePixels;
}

export type DestinoDaReducao = "usar" | "abrir_aqui" | "grande_demais";

/**
 * O que fazer com o resultado da redução quando quem chama precisa ABRIR a
 * imagem: coube (cópia ou reduzida), usa; original leve (formato que a redução
 * não trata), abre aqui como antes; original acima do teto, grande demais
 * (nunca decodificar 25 MP na função).
 */
export function destinoDaReducao(r: Pick<ResultadoDaReducao, "cabe" | "largura" | "altura">, tetoDePixels: number): DestinoDaReducao {
  if (r.cabe) return "usar";
  return abreAqui(r, tetoDePixels) ? "abrir_aqui" : "grande_demais";
}

/**
 * Anexo cru que vai ao gerador como está: leve em bytes e em pixels (o caso de
 * sempre: pin, print, capa gerada, logo). Pesado vira a cópia média.
 */
export function anexoCruServe(bytes: number, d: Dimensoes, tetoDePixels: number): boolean {
  return bytes <= MAX_BYTES_ANEXO_CRU && abreAqui(d, tetoDePixels);
}

/** "8000 x 6000 px" para as mensagens; sem o tamanho, "grande demais". */
export function textoDoTamanho(d: Dimensoes): string {
  return d && d.largura && d.altura ? `${d.largura} x ${d.altura} px` : "tamanho desconhecido";
}

/**
 * Tamanho gravado na versão ("1088x1360") já na proporção do alvo e sem
 * passar de 1,5 vez a largura dele: a entrega não abre esta lâmina (a mesma
 * regra de laminaFinal). Sem o tamanho gravado: pode precisar de recorte.
 */
export function laminaJaNoFormato(tamanho: unknown, alvo: { largura: number; altura: number }): boolean {
  const m = /^(\d+)x(\d+)$/.exec(String(tamanho == null ? "" : tamanho).trim());
  if (!m) return false;
  const l = Number(m[1]);
  const a = Number(m[2]);
  if (!(l > 0) || !(a > 0)) return false;
  return Math.abs(l / a - alvo.largura / alvo.altura) < 0.01 && l <= alvo.largura * 1.5;
}

/** Onde fica o recorte final guardado de uma lâmina (feito uma vez, na conferência ou na entrega). */
export const caminhoDoRecorteFinal = (caminho: string, alvo: { largura: number; altura: number }) =>
  `${caminho}.final-${alvo.largura}x${alvo.altura}.png`;

/** Entrega dividida: quantas foram e o que fazer (a entrega é idempotente, a próxima continua). */
export function mensagemDaEntregaEmPartes(entregues: number, total: number): string {
  const faltam = Math.max(0, total - entregues);
  return `${entregues} de ${total} lâminas já estão em Arquivos. Clique em Entregar de novo para terminar ${faltam === 1 ? "a que falta" : `as ${faltam} que faltam`}: lâminas fora do formato são recortadas aos poucos.`;
}
