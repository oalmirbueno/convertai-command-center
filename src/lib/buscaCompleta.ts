/**
 * Buscar tudo, ou dizer que não deu.
 *
 * As consultas da Central pegavam as N linhas mais recentes de TODOS os
 * clientes e filtravam por cliente depois. Isso tem duas armadilhas, e as
 * duas são silenciosas:
 *
 *  1. O teto escrito no código (`.limit(400)`). Basta a carteira crescer para
 *     o cliente que você abriu não vir na janela — e a tela diz "sem
 *     contexto" com o dado gravado no banco.
 *
 *  2. O teto que NINGUÉM escreveu. Consulta sem `.limit()` não é ilimitada:
 *     o PostgREST corta no `max-rows` do servidor. `files` já tem 909 linhas.
 *     Esse é o pior dos dois, porque não aparece em lugar nenhum do código.
 *
 * A saída não é aumentar o número — é buscar por páginas até acabar, e
 * devolver `truncado` quando o teto de segurança for atingido. Quem chama
 * mostra o aviso. Dado incompleto apresentado como completo é o defeito que
 * queremos matar; dado incompleto que se anuncia é aceitável.
 */

export interface ResultadoDaPagina<T> {
  data: T[] | null;
  error: unknown;
}

export interface BuscaCompleta<T> {
  linhas: T[];
  /** O teto de segurança foi atingido: há mais linhas que não vieram. */
  truncado: boolean;
}

export interface OpcoesDeBusca {
  /** Linhas por página. */
  pagina?: number;
  /** Teto de segurança, para uma tabela em fuga não travar a tela. */
  teto?: number;
}

/**
 * Percorre a consulta em páginas até o fim.
 *
 * `montar` recebe o intervalo e devolve a consulta já com `.range(de, ate)`.
 * A paginação para quando a página volta menor que o pedido — isso significa
 * que acabou — ou quando o teto é alcançado.
 */
export async function buscarTodas<T>(
  montar: (de: number, ate: number) => PromiseLike<ResultadoDaPagina<T>>,
  opcoes: OpcoesDeBusca = {},
): Promise<BuscaCompleta<T>> {
  const pagina = Math.max(1, opcoes.pagina ?? 1000);
  const teto = Math.max(pagina, opcoes.teto ?? 5000);

  const linhas: T[] = [];
  let de = 0;

  while (de < teto) {
    const ate = Math.min(de + pagina, teto) - 1;
    const { data, error } = await montar(de, ate);
    // Erro devolve o que já veio, marcado como incompleto: meia lista sem
    // aviso é justamente o defeito que este arquivo existe para evitar.
    if (error) return { linhas, truncado: true };

    const recebidas = data || [];
    linhas.push(...recebidas);

    if (recebidas.length < ate - de + 1) return { linhas, truncado: false };
    de = ate + 1;
  }

  return { linhas, truncado: true };
}
