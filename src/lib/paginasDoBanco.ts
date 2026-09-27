/**
 * O banco devolve no máximo 1.000 linhas por pedido (max-rows do PostgREST),
 * sem avisar. Consulta que junta vários clientes (Ciclo, carteira) passa
 * disso e a contagem saía errada em silêncio. Aqui a leitura vai página a
 * página até acabar (ou até o teto), sempre na mesma ordem.
 *
 * `montar` devolve a consulta NOVA a cada chamada, já com a ordem (de
 * preferência terminando em `.order("id")`, para a página não repetir nem
 * pular linha).
 */
export const TAMANHO_DA_PAGINA = 1000;

type PaginaDoBanco<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type ConsultaPaginavel<T> = { range: (de: number, ate: number) => PaginaDoBanco<T> };

export async function lerTodasAsPaginas<T = Record<string, unknown>>(
  montar: () => ConsultaPaginavel<T>,
  teto = 20_000,
  tamanho = TAMANHO_DA_PAGINA,
): Promise<{ data: T[]; error: unknown }> {
  const data: T[] = [];
  for (let de = 0; de < teto; de += tamanho) {
    const quantas = Math.min(tamanho, teto - de);
    const r = await montar().range(de, de + quantas - 1);
    if (r.error) return { data, error: r.error };
    const linhas = r.data ?? [];
    for (let i = 0; i < linhas.length; i++) data.push(linhas[i]);
    if (linhas.length < quantas) break;
  }
  return { data, error: null };
}
