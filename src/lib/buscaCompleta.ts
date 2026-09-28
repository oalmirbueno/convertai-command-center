/**
 * Buscar tudo, sem teto que corte, e dizer a verdade quando a leitura falha.
 *
 * As consultas da Central pegavam as N linhas mais recentes de TODOS os
 * clientes e filtravam por cliente depois. Isso tem duas armadilhas, e as
 * duas são silenciosas:
 *
 *  1. O teto escrito no código (`.limit(400)`). Basta a carteira crescer para
 *     o cliente que você abriu não vir na janela, e a tela diz "sem
 *     contexto" com o dado gravado no banco.
 *
 *  2. O teto que NINGUÉM escreveu. Consulta sem `.limit()` não é ilimitada:
 *     o PostgREST corta no `max-rows` do servidor (1.000).
 *
 * A saída é buscar por páginas até acabar.
 *
 * Frente CE (28/09/2026): o aviso "Parte dos dados não coube nesta leitura
 * (marcos)" apareceu com 81 marcos no banco, longe de qualquer teto. A causa
 * era outra: uma página que FALHOU (rede, banco ocupado) voltava marcada
 * como "cortada" e a tela anunciava corte que não existia, até a próxima
 * leitura. Agora são duas coisas diferentes:
 *  - erro: `lancarErro` (padrão da Central) faz a consulta falhar de verdade,
 *    o React Query tenta de novo e mantém o dado anterior na tela; o aviso
 *    diz "não foi possível ler agora", nunca "não coube";
 *  - corte: só existe quando quem chama pede um teto. Sem teto, lê até o fim,
 *    uma página de cada vez (controlado: nunca uma consulta gigante), com
 *    uma guarda contra laço de 200 páginas (200 mil linhas), que é defeito de
 *    consulta e não carteira.
 */

export interface ResultadoDaPagina<T> {
  data: T[] | null;
  error: unknown;
}

export interface BuscaCompleta<T> {
  linhas: T[];
  /** Um teto pedido por quem chama foi atingido: há mais linhas que não vieram. */
  truncado: boolean;
  /** Uma página falhou: o que veio é parcial (só sem `lancarErro`). */
  erro: boolean;
}

export interface OpcoesDeBusca {
  /** Linhas por página (o servidor devolve no máximo 1.000). */
  pagina?: number;
  /** Teto opcional. Sem ele, lê até acabar. */
  teto?: number;
  /** Falha de página vira exceção (o React Query tenta de novo e guarda o dado anterior). */
  lancarErro?: boolean;
}

/** Guarda contra laço: página cheia para sempre é consulta errada. */
export const PAGINAS_NO_MAXIMO = 200;

export class FalhaNaLeitura extends Error {
  constructor(public causa: unknown) {
    super("Não foi possível ler todos os dados agora.");
    this.name = "FalhaNaLeitura";
  }
}

/**
 * Percorre a consulta em páginas até o fim.
 *
 * `montar` recebe o intervalo e devolve a consulta já com `.range(de, ate)`.
 * A paginação para quando a página volta menor que o pedido (acabou), quando
 * o teto pedido é alcançado ou na guarda de páginas.
 */
export async function buscarTodas<T>(
  montar: (de: number, ate: number) => PromiseLike<ResultadoDaPagina<T>>,
  opcoes: OpcoesDeBusca = {},
): Promise<BuscaCompleta<T>> {
  const pagina = Math.max(1, Math.min(1000, opcoes.pagina ?? 1000));
  const teto = opcoes.teto === undefined ? Infinity : Math.max(pagina, opcoes.teto);

  const linhas: T[] = [];
  let de = 0;

  for (let n = 0; n < PAGINAS_NO_MAXIMO && de < teto; n += 1) {
    const ate = Math.min(de + pagina, teto) - 1;
    const { data, error } = await montar(de, ate);
    if (error) {
      if (opcoes.lancarErro) throw new FalhaNaLeitura(error);
      // Meia lista sem aviso é justamente o defeito que este arquivo evita.
      return { linhas, truncado: false, erro: true };
    }

    const recebidas = data || [];
    linhas.push(...recebidas);

    if (recebidas.length < ate - de + 1) return { linhas, truncado: false, erro: false };
    de = ate + 1;
  }

  return { linhas, truncado: true, erro: false };
}
