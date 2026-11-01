/**
 * Projetos que pertencem ao cliente da tela. Em "Ver como cliente" o admin lê `useProjects()` sem filtro (vê
 * todos os projetos da agência), então o seletor "Projeto" dos Documentos listava projetos de outros clientes.
 * Para o cliente real nada muda: a RLS já só devolve os projetos dele, todos com `client_id` igual ao dele.
 * Sem cliente identificado, nenhum projeto.
 */
export function projetosDoCliente<T extends { client_id?: string | null }>(
  projetos: readonly T[] | null | undefined,
  clientId: string | null | undefined,
): T[] {
  if (!clientId) return [];
  return (projetos || []).filter((p) => p.client_id === clientId);
}
