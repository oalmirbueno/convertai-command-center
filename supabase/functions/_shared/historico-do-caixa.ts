/**
 * Resultado mês a mês (16/11/2026, pedido do dono): "falta o lucro do mês e quanto sobrou de caixa
 * daquele mês com base no que entrou e saiu; já puxe do histórico para comparar".
 *
 * Conta pura (sem banco) para a tela e os testes:
 * - entrou: tudo que foi recebido no mês (mesma régua do "Entrou no mês");
 * - saiu: despesas pagas no mês (aporte de investidor fica fora, como no saldo);
 * - lucro: entrou − saiu;
 * - caixa no fim do mês: o saldo de hoje andando para trás. O fim do mês M é o saldo de hoje menos o
 *   que entrou depois de M mais o que saiu depois de M. Assim o último mês fecha exatamente com o
 *   "Saldo em caixa" da tela, sem precisar de um saldo inicial datado.
 */

export type Movimento = { dia: string; valor: number };

export type MesDoHistorico = {
  /** "AAAA-MM" */
  mes: string;
  entrou: number;
  saiu: number;
  lucro: number;
  /** lucro ÷ entrou, em %; null quando não entrou nada. */
  margem: number | null;
  caixaNoFim: number;
};

export type Historico = {
  meses: MesDoHistorico[];
  /** Médias dos meses fechados (sem o mês corrente), para comparar. */
  media: { entrou: number; saiu: number; lucro: number } | null;
  melhor: MesDoHistorico | null;
  pior: MesDoHistorico | null;
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const mesDe = (dia: string) => String(dia || "").slice(0, 7);

export function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * @param entradas o que entrou (valor cheio, igual ao "Entrou no mês")
 * @param entradasDoCaixa o que entrou no caixa (líquido de taxa); vazio = igual às entradas
 * @param saidas despesas pagas
 * @param saldoHoje o "Saldo em caixa" de hoje
 * @param ate mês corrente "AAAA-MM"
 * @param quantos quantos meses mostrar (contando o corrente)
 */
export function montarHistorico(e: {
  entradas: Movimento[];
  entradasDoCaixa?: Movimento[];
  saidas: Movimento[];
  saldoHoje: number;
  ate: string;
  quantos?: number;
}): Historico {
  const quantos = Math.max(1, Math.min(36, e.quantos ?? 12));
  const somaPorMes = (lista: Movimento[]) => {
    const m = new Map<string, number>();
    for (const x of lista) {
      const k = mesDe(x.dia);
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      m.set(k, (m.get(k) || 0) + (Number(x.valor) || 0));
    }
    return m;
  };
  const entrou = somaPorMes(e.entradas);
  const entrouCaixa = somaPorMes(e.entradasDoCaixa && e.entradasDoCaixa.length ? e.entradasDoCaixa : e.entradas);
  const saiu = somaPorMes(e.saidas);

  // O primeiro mês com movimento limita o começo (não mostra 12 meses vazios de antes da agência).
  const todos = [...entrou.keys(), ...saiu.keys()].filter((k) => k <= e.ate).sort();
  const primeiro = todos[0] || e.ate;
  const inicio = [somarMes(e.ate, -(quantos - 1)), primeiro].sort()[1];

  // Caixa no fim de cada mês, andando para trás a partir de hoje.
  const movimentoDoMes = (k: string) => (entrouCaixa.get(k) || 0) - (saiu.get(k) || 0);
  const depoisDoCorrente = [...new Set([...entrouCaixa.keys(), ...saiu.keys()])].filter((k) => k > e.ate)
    .reduce((s, k) => s + movimentoDoMes(k), 0);
  let caixa = e.saldoHoje - depoisDoCorrente;

  const meses: MesDoHistorico[] = [];
  for (let k = e.ate; k >= inicio; k = somarMes(k, -1)) {
    const en = centavos(entrou.get(k) || 0);
    const sa = centavos(saiu.get(k) || 0);
    const lucro = centavos(en - sa);
    meses.push({ mes: k, entrou: en, saiu: sa, lucro, margem: en > 0 ? Math.round((lucro / en) * 1000) / 10 : null, caixaNoFim: centavos(caixa) });
    caixa -= movimentoDoMes(k);
  }
  meses.reverse();

  const fechados = meses.filter((m) => m.mes < e.ate);
  const media = fechados.length
    ? {
        entrou: centavos(fechados.reduce((s, m) => s + m.entrou, 0) / fechados.length),
        saiu: centavos(fechados.reduce((s, m) => s + m.saiu, 0) / fechados.length),
        lucro: centavos(fechados.reduce((s, m) => s + m.lucro, 0) / fechados.length),
      }
    : null;
  const ordenados = [...fechados].sort((a, b) => b.lucro - a.lucro);
  return { meses, media, melhor: ordenados[0] || null, pior: ordenados.length > 1 ? ordenados[ordenados.length - 1] : null };
}

/** Diferença contra a referência, em % (null quando a referência é zero). */
export function variacao(atual: number, referencia: number | null | undefined): number | null {
  if (referencia === null || referencia === undefined || referencia === 0) return null;
  return Math.round(((atual - referencia) / Math.abs(referencia)) * 1000) / 10;
}
