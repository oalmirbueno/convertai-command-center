/** Limita conexões sem esperar o cliente mais lento para avançar a fila. */
export async function emLotes<T>(itens: T[], tamanho: number, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, tamanho), itens.length) }, async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  }));
}
export const assinaturaDasRespostas = (respostas: string[], contexto: string, geral: string, pesquisar = false) =>
  JSON.stringify([respostas.map((r) => r.trim()), contexto.trim(), geral.trim(), pesquisar]);

/**
 * Vagas de chamada ao servidor divididas entre a leitura e a aplicação da
 * mesma rodada (19/10). Quem pede com prioridade (o dono esperando um cliente
 * que ele mesmo tocou) entra antes de quem ainda espera a vez na leitura, sem
 * passar à frente de outra prioridade. O limite só desce: quando o servidor
 * falha, o resto da fila volta ao ritmo antigo.
 */
export interface Vagas {
  readonly limite: number;
  rodar<T>(fn: () => Promise<T>, prioridade?: boolean): Promise<T>;
  reduzir(limite: number): void;
}

export function criarVagas(limiteInicial: number): Vagas {
  let limite = Math.max(1, limiteInicial);
  let ativos = 0;
  const primeiro: Array<() => void> = [];
  const depois: Array<() => void> = [];
  const soltar = () => {
    while (ativos < limite && (primeiro.length || depois.length)) {
      ativos += 1;
      (primeiro.shift() ?? depois.shift())!();
    }
  };
  return {
    get limite() {
      return limite;
    },
    async rodar<T>(fn: () => Promise<T>, prioridade = false): Promise<T> {
      await new Promise<void>((entrar) => {
        (prioridade ? primeiro : depois).push(entrar);
        soltar();
      });
      try {
        return await fn();
      } finally {
        ativos -= 1;
        soltar();
      }
    },
    reduzir(novo: number) {
      limite = Math.max(1, Math.min(limite, novo));
    },
  };
}
