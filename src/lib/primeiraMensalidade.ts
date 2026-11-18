/**
 * As cobranças da primeira mensalidade no cadastro do cliente (12/11/2026).
 *
 * O que aconteceu: um cliente de R$ 700 pagou R$ 350 no dia e ficou de pagar os outros R$ 350 no dia
 * seguinte. O cadastro só sabia "recebida" ou "vai pagar", então a mensalidade entrou inteira como paga
 * e a divisão foi lançada como um "projeto" de R$ 700 em duas vezes: o caixa mostrou R$ 1.050 recebidos
 * quando tinham entrado R$ 350, e o cliente virou híbrido sem ter projeto.
 *
 * Agora a primeira mensalidade tem três jeitos: recebida, a receber ou DIVIDIDA (uma parte agora, o
 * resto numa data). A soma das partes é sempre o valor do plano; o mês seguinte segue cheio, na data
 * da renovação.
 */

export type ModoDaPrimeira = "recebida" | "a_receber" | "dividida";

export type CobrancaDaMensalidade = {
  client_id: string;
  type: "renewal";
  amount: number;
  due_date: string;
  paid_date?: string | null;
  paid_amount?: number | null;
  description: string;
  status: "paid" | "pending";
};

const duasCasas = (n: number) => Math.round(n * 100) / 100;

/** Amanhã, no calendário (a data padrão do restante). */
export function diaSeguinte(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/** O que falta na divisão. Devolve o motivo quando a divisão não fecha. */
export function conferirDivisao(valor: number, recebidoAgora: number, restanteVence: string, hoje: string): string | null {
  if (!(recebidoAgora > 0)) return "Diga quanto foi recebido agora.";
  if (recebidoAgora >= valor) return "O recebido agora precisa ser menor que a mensalidade. Se pagou tudo, escolha Recebida.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(restanteVence)) return "Diga em que dia vence o restante.";
  if (restanteVence < hoje) return "O restante não pode vencer antes de hoje.";
  return null;
}

export function cobrancasDaPrimeiraMensalidade(dados: {
  clienteId: string;
  nome: string;
  valor: number;
  modo: ModoDaPrimeira;
  hoje: string;
  /** Só no modo dividida. */
  recebidoAgora?: number;
  restanteVence?: string;
  /** A próxima renovação: gera a cobrança cheia do mês seguinte. */
  renovacao?: string | null;
}): CobrancaDaMensalidade[] {
  const { clienteId, nome, valor, modo, hoje } = dados;
  if (!(valor > 0)) return [];
  const base = { client_id: clienteId, type: "renewal" as const };
  const linhas: CobrancaDaMensalidade[] = [];
  if (modo === "dividida") {
    const agora = duasCasas(dados.recebidoAgora ?? 0);
    const resto = duasCasas(valor - agora);
    linhas.push({ ...base, amount: agora, due_date: hoje, paid_date: hoje, paid_amount: agora, description: `Mensalidade · ${nome} · parcela 1/2 (pago no cadastro)`, status: "paid" });
    linhas.push({ ...base, amount: resto, due_date: dados.restanteVence || diaSeguinte(hoje), description: `Mensalidade · ${nome} · parcela 2/2`, status: "pending" });
  } else {
    const recebida = modo === "recebida";
    linhas.push({
      ...base,
      amount: valor,
      due_date: hoje,
      paid_date: recebida ? hoje : null,
      paid_amount: recebida ? valor : null,
      description: `Mensalidade · ${nome}${recebida ? " (pago no cadastro)" : " (a receber)"}`,
      status: recebida ? "paid" : "pending",
    });
  }
  if (dados.renovacao && dados.renovacao > hoje) {
    linhas.push({ ...base, amount: valor, due_date: dados.renovacao, description: `Mensalidade · ${nome}`, status: "pending" });
  }
  return linhas;
}
