const INICIO = '<!-- operacao_carteira_v1 -->';
const FIM = '<!-- /operacao_carteira_v1 -->';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CarteiraOperacao = { version: 1; client_ids: string[] };

/** Seleção de acompanhamento, nunca permissão de acesso ou aprovação de anúncio. */
export function lerCarteira(scope?: string | null): CarteiraOperacao | null {
  if (!scope?.includes(INICIO)) return null;
  const parte = scope.split(INICIO)[1]?.split(FIM);
  if (scope.split(INICIO).length !== 2 || parte?.length !== 2) throw new Error('A seleção de clientes precisa ser conferida.');
  let v: any;
  try { v = JSON.parse(parte[0].trim()); } catch { throw new Error('A seleção de clientes precisa ser conferida.'); }
  if (v?.version !== 1 || !Array.isArray(v.client_ids) || v.client_ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))) throw new Error('A seleção de clientes precisa ser conferida.');
  return { version: 1, client_ids: [...new Set<string>(v.client_ids)] };
}

export function gravarCarteira(scope: string | null | undefined, ids: string[]): string {
  lerCarteira(scope); // Não substituir silenciosamente um registro inválido.
  if (ids.some(id => !UUID.test(id))) throw new Error('Escolha clientes cadastrados no painel.');
  const bloco = `${INICIO}\n${JSON.stringify({ version: 1, client_ids: [...new Set(ids)].sort() })}\n${FIM}`;
  if (scope?.includes(INICIO)) {
    const inicio = scope.indexOf(INICIO); const fim = scope.indexOf(FIM, inicio) + FIM.length;
    return scope.slice(0, inicio) + bloco + scope.slice(fim);
  }
  return `${scope || ''}${scope ? '\n\n' : ''}${bloco}`;
}

export function blocoDaCampanha(x: { situacao: string; campanha: { status: string }; divergencia: boolean }) {
  if (x.situacao === 'entrega') return 'ativo';
  if (x.situacao === 'desatualizada' || x.divergencia || x.campanha.status === 'ACTIVE') return 'trabalhar';
  return 'inativo';
}

export function contextoDoPedido(cliente: { id: string; nome: string }, pedido: string) {
  return `Cliente: ${cliente.nome}\nReferência do cliente: ${cliente.id}\n\n${pedido.trim()}`;
}
