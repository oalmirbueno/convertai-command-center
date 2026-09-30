/**
 * Chamada de servidor para servidor ao send-transactional-email.
 *
 * Com as chaves novas do projeto e o supabase-js recente (esm.sh @2 sem
 * versão fixa), a chamada feita só com `functions.invoke` chega ao
 * send-transactional-email sem a chave de serviço reconhecível e volta 401
 * (check-renewals: 401 todo dia às 08:00 desde pelo menos 19/09; o último
 * lembrete de cobrança entregue foi em 01/07). O caminho que funciona é o
 * mesmo dos gatilhos do banco: o cabeçalho x-cron-secret com o CRON_SECRET.
 *
 * Use em toda função que manda e-mail sem um usuário logado por trás.
 */
export function cabecalhosDoEmailInterno(
  lerSegredo: (nome: string) => string | undefined = (nome) => Deno.env.get(nome),
): Record<string, string> {
  const segredo = lerSegredo("CRON_SECRET")?.trim();
  return segredo ? { "x-cron-secret": segredo } : {};
}
