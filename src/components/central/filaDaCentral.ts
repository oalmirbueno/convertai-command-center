/** Limita conexões sem esperar o cliente mais lento para avançar a fila. */
export async function emLotes<T>(itens: T[], tamanho: number, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, tamanho), itens.length) }, async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  }));
}
export const assinaturaDasRespostas = (respostas: string[], contexto: string, geral: string, pesquisar = false) =>
  JSON.stringify([respostas.map((r) => r.trim()), contexto.trim(), geral.trim(), pesquisar]);
