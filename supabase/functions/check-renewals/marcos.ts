/**
 * Quando um vencimento de plano merece aviso no sino da equipe.
 *
 * Antes: um aviso por cliente TODO dia da semana anterior ao vencimento e
 * TODO dia depois de vencido ("vencido há 5 dias", "há 6", "há 7"...), com
 * emoji e travessão, para um único admin sorteado. Agora: só nos marcos,
 * para todo admin humano, com link para a ficha do cliente.
 */

/** Dias antes do vencimento que avisam (0 = vence hoje). */
export const MARCOS_ANTES = [7, 3, 1, 0] as const;
/** Dias depois do vencimento que avisam; depois do último, a cada 30 dias. */
export const MARCOS_VENCIDO = [1, 3, 7, 15, 30] as const;

export function avisaAntes(dias: number): boolean {
  return (MARCOS_ANTES as readonly number[]).includes(dias);
}

export function avisaVencido(dias: number): boolean {
  if ((MARCOS_VENCIDO as readonly number[]).includes(dias)) return true;
  return dias > 30 && dias % 30 === 0;
}

const reais = (valor: unknown): string =>
  valor == null || valor === ""
    ? ""
    : ` · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor))}`;

const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

export function textoAntes(nome: string, diasAte: number, dataBr: string, valor: unknown): string {
  if (diasAte === 0) return `Plano de "${nome}" vence hoje${reais(valor)}`;
  return `Plano de "${nome}" vence em ${dias(diasAte)} (${dataBr})${reais(valor)}`;
}

export function textoVencido(nome: string, diasVencido: number, valor: unknown): string {
  return `Plano de "${nome}" está vencido há ${dias(diasVencido)}${reais(valor)}`;
}

export function textoPausa(nome: string, diasVencido: number): string {
  return `Projetos de "${nome}" pausados por inadimplência (${dias(diasVencido)} de atraso)`;
}

export function linkDoCliente(clienteId: string): string {
  return `/clientes?client=${encodeURIComponent(clienteId)}`;
}
