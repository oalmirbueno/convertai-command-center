/**
 * Semelhança entre lâminas (17/10/2026, dono: "repete a mesma imagem da capa
 * para os demais"). Depois de gerar uma lâmina do miolo, o código compara a
 * imagem com a capa e com a lâmina anterior por uma assinatura de diferença
 * (dHash 8x8 sobre a imagem reduzida a 9x8 em cinza): quase igual vira AVISO
 * na versão ("ficou parecida com a capa"), nunca refaz sozinha (regra do dono:
 * sem laço de correção). Sem IA e sem custo.
 *
 * A mesma identidade (fundo, paleta, grid) deixa as lâminas próximas; por isso
 * o limiar é baixo: só a quase cópia (mesma foto ou mesma cena) passa dele.
 *
 * Puro (sem Deno nem npm): quem chama reduz a imagem e passa os 72 tons.
 * Sem travessão.
 */

/** Distância máxima (de 64 bits) para chamar duas lâminas de quase iguais. */
export const LIMIAR_DE_QUASE_IGUAL = 8;

/** dHash: 64 bits a partir de 9x8 tons de cinza (linha por linha); bit 1 quando o pixel é mais claro que o da direita. */
export function dHash(tons: number[]): boolean[] {
  if (tons.length !== 72) throw new Error("dHash espera 9x8 tons");
  const bits: boolean[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(tons[y * 9 + x] > tons[y * 9 + x + 1]);
  return bits;
}

export function distancia(a: boolean[], b: boolean[]): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

/** Tom de cinza de um pixel RGBA (32 bits, como o imagescript devolve). */
export function cinza(rgba: number): number {
  const r = (rgba >>> 24) & 0xff, g = (rgba >>> 16) & 0xff, b = (rgba >>> 8) & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Os avisos da lâmina comparada com a capa e a anterior (vazio quando nenhuma é quase igual). */
export function avisosDeSemelhanca(e: { ordem: number; esta: boolean[]; capa?: boolean[] | null; anterior?: { ordem: number; hash: boolean[] } | null }): string[] {
  const saida: string[] = [];
  if (e.ordem > 1 && e.capa && distancia(e.esta, e.capa) <= LIMIAR_DE_QUASE_IGUAL) {
    saida.push("Esta lâmina ficou quase igual à capa (mesma foto ou mesma cena). Peça em Ajustar: \"troque a cena, mostre outra coisa\".");
  }
  if (e.anterior && e.anterior.ordem > 1 && distancia(e.esta, e.anterior.hash) <= LIMIAR_DE_QUASE_IGUAL) {
    saida.push(`Esta lâmina ficou quase igual à lâmina ${e.anterior.ordem}. Peça em Ajustar uma cena diferente.`);
  }
  return saida;
}
