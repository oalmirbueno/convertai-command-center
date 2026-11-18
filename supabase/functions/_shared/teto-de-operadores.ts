/**
 * Teto de operadores internos ATIVOS.
 *
 * O teto é o freio de um laço em fuga: conta só quem está com
 * status = 'active'. Operador pausado ou aposentado não ocupa vaga — mas
 * voltar com ele para active ocupa, e por isso a reativação também passa
 * pelo teto.
 *
 * Puro de propósito (sem banco, sem Deno): a decisão é testável sem mock.
 */

export const MAXIMO_DE_OPERADORES_ATIVOS = 40;

const COMO_LIBERAR_VAGA =
  'Para liberar vaga, pause ou aposente um operador que esteja ATIVO (aceleriq_operator_organize com status paused ou retired). '
  + 'Aposentar quem ja esta pausado ou aposentado nao libera vaga. '
  + `Reativar um operador pausado ou aposentado tambem conta no teto de ${MAXIMO_DE_OPERADORES_ATIVOS} ativos.`;

export function mensagemTetoNoCadastro(ativos: number) {
  return `limite de ${MAXIMO_DE_OPERADORES_ATIVOS} operadores ativos atingido (${ativos} ativos agora): nao da para cadastrar outro. `
    + COMO_LIBERAR_VAGA;
}

export function mensagemTetoNaReativacao(slug: string, ativos: number) {
  return `nao da para reativar "${slug}": ja ha ${ativos} operadores ativos e o limite e ${MAXIMO_DE_OPERADORES_ATIVOS}. `
    + COMO_LIBERAR_VAGA;
}

/** Cadastro novo entra como active: só cabe se ainda houver vaga. */
export function podeCadastrar(ativos: number): boolean {
  return ativos < MAXIMO_DE_OPERADORES_ATIVOS;
}

/**
 * A mudança de status ocupa uma vaga nova? Só quando pede active para
 * quem hoje NÃO está active. Quem já é active não é recusado por teto.
 */
export function reativacaoOcupaVaga(statusAtual: string | null | undefined, statusPedido: string | null | undefined): boolean {
  return statusPedido === 'active' && statusAtual !== 'active';
}

export function podeReativar(ativos: number): boolean {
  return ativos < MAXIMO_DE_OPERADORES_ATIVOS;
}
