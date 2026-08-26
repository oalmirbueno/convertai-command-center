/**
 * O guarda do client_id: recusa o id fantasma E ensina o certo.
 *
 * O caso real, do log de auditoria: 22 gravacoes da Verzelo recusadas
 * seguidas, todas com o mesmo id `e590497e-f985-47be-8b2f-493bae1da7df` —
 * dois caracteres trocados de lugar no id verdadeiro, que termina em
 * `b8f2`. A validacao estava certa (gravar num cliente inexistente criaria
 * orfao invisivel), mas a mensagem so dizia "confira o id": o agente nao
 * tinha como saber ONDE errou, tentava de novo com o mesmo id e falhava de
 * novo. Erro que nao ensina vira laco.
 *
 * Aqui a recusa vem com o conserto junto:
 *
 *   1. Se o id enviado e uma TRANSPOSICAO de um id real (dois caracteres
 *      vizinhos trocados), a mensagem nomeia o cliente e o id correto.
 *      E o erro mais comum quando um humano ou um modelo copia uuid.
 *   2. Se nao for, mas o texto do pedido citar um cliente pelo nome, a
 *      mensagem sugere aquele cliente e o id dele.
 *   3. Em ultimo caso, lista alguns clientes ativos com nome e id.
 *
 * O que NAO se faz aqui, em nenhuma hipotese: adivinhar e gravar assim
 * mesmo. Escrever no cliente errado e pior que falhar — a falha aparece na
 * hora; o dado no cliente errado aparece semanas depois, como confusao.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface ClienteConhecido {
  id: string;
  nome: string;
}

/**
 * Caracteres trocados de lugar: o erro classico de quem copia uuid.
 *
 * A primeira versao so aceitava UMA troca de vizinhos, e nao teria pegado o
 * caso real da Verzelo: `8b2f` no lugar de `b8f2` sao DUAS trocas, quatro
 * posicoes diferentes. Conferido caractere a caractere antes de escrever
 * esta regra — detector que nao pega o caso que existe e teatro.
 *
 * A regra que sobrou: mesmos caracteres, ordem trocada, em poucas posicoes.
 * Dois uuids diferentes de verdade praticamente nunca sao anagramas um do
 * outro, e mesmo se fossem o guarda apenas SUGERE — nunca grava sozinho.
 */
function ehTransposicao(errado: string, certo: string): boolean {
  if (errado.length !== certo.length || errado === certo) return false;
  let diferentes = 0;
  for (let i = 0; i < errado.length; i += 1) {
    if (errado[i] !== certo[i]) diferentes += 1;
    if (diferentes > 6) return false;
  }
  if (diferentes < 2) return false;
  const ordenado = (s: string) => [...s].sort().join('');
  return ordenado(errado) === ordenado(certo);
}

/**
 * Confere o client_id contra o banco. Devolve em silencio quando existe;
 * lanca um erro que ENSINA quando nao existe.
 *
 * `pistaDeTexto` e o conteudo que o agente estava gravando: quando o id
 * nao bate, o nome do cliente costuma estar escrito ali dentro, e e o que
 * permite apontar o registro certo em vez de mandar procurar.
 */
export async function exigirClienteExistente(
  sb: SupabaseClient,
  clientId: string,
  pistaDeTexto?: string,
): Promise<void> {
  const { data: perfil, error } = await sb
    .from('profiles')
    .select('id, deleted_at')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (perfil && !(perfil as { deleted_at: string | null }).deleted_at) return;

  // A partir daqui a gravacao JA vai falhar. O que resta e falhar bem.
  const { data: linhas } = await sb
    .from('profiles')
    .select('id, full_name, company_name, deleted_at')
    .is('deleted_at', null)
    .limit(500);

  const clientes: ClienteConhecido[] = ((linhas ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id),
    nome: String(c.company_name ?? c.full_name ?? '(sem nome)').trim(),
  }));

  const transposto = clientes.find((c) => ehTransposicao(clientId, c.id));
  if (transposto) {
    throw new Error(
      `client_id ${clientId} nao existe: voce trocou dois caracteres de lugar. `
      + `O id correto de ${transposto.nome} e ${transposto.id}. `
      + 'Grave de novo com esse id.',
    );
  }

  const pista = (pistaDeTexto ?? '').toLowerCase();
  const peloNome = pista
    ? clientes.filter((c) => c.nome.length >= 3 && pista.includes(c.nome.toLowerCase()))
    : [];
  if (peloNome.length === 1) {
    throw new Error(
      `client_id ${clientId} nao corresponde a nenhum cliente ativo. `
      + `O texto fala de ${peloNome[0].nome}, cujo id e ${peloNome[0].id}. `
      + 'Confirme antes de gravar.',
    );
  }

  const amostra = clientes
    .slice(0, 8)
    .map((c) => `${c.nome} = ${c.id}`)
    .join('; ');
  throw new Error(
    `client_id ${clientId} nao corresponde a nenhum cliente ativo. `
    + `Use aceleriq_list_clients para achar o id certo. Alguns ativos: ${amostra}`,
  );
}
