/**
 * A alíquota do mês, e por que ela não pode ser uma constante.
 *
 * O painel usava `DEFAULT_TAX_RATE = 6%` em oito lugares. No Simples a
 * alíquota efetiva sobe com o RBT12: o que é 6% em janeiro vira 8% em
 * setembro. Uma constante única obriga o passado a mentir junto com o
 * presente — trocar o número hoje reescreveria a reserva de todos os
 * meses já fechados, e o histórico deixaria de bater com o que foi pago.
 *
 * Aqui cada competência guarda a SUA alíquota. Mês sem registro cai no
 * piso declarado, e a função diz que caiu: estimativa assumida é
 * diferente de número confirmado, e quem lê precisa saber qual dos dois
 * está vendo.
 */

/** O piso da faixa em que a agência opera hoje. */
export const ALIQUOTA_MINIMA = 0.06;
/** O teto que o dono quer poder alcançar sem passar. */
export const ALIQUOTA_MAXIMA = 0.09;

export interface AliquotaDoMes {
  /** Primeiro dia do mês, em ISO: a competência. */
  competencia: string;
  rate: number;
  note?: string | null;
}

/** A competência de uma data: sempre o dia 1, sempre ISO. */
export function competenciaDe(data: Date | string): string {
  const d = typeof data === "string" ? new Date(`${data.slice(0, 10)}T12:00:00`) : data;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Mantém a alíquota dentro da faixa 6–9%.
 *
 * A barra não deveria conseguir sair da faixa, mas um valor vindo do
 * banco ou de um teclado pode. Truncar é mais seguro que aceitar: uma
 * alíquota de 90% por dedo escorregado reservaria o caixa inteiro.
 */
export function limitarAliquota(valor: number): number {
  if (!Number.isFinite(valor)) return ALIQUOTA_MINIMA;
  // Meio ponto percentual é o passo que o Simples usa na prática; sem
  // arredondar, a barra devolve 0.0637 e o número fica impossível de ler.
  const arredondado = Math.round(valor * 1000) / 1000;
  return Math.min(Math.max(arredondado, ALIQUOTA_MINIMA), ALIQUOTA_MAXIMA);
}

export interface AliquotaResolvida {
  rate: number;
  /** true quando NÃO havia registro para o mês e caiu no piso. */
  presumida: boolean;
  competencia: string;
}

/**
 * A alíquota de uma competência.
 *
 * Sem registro, devolve o piso E marca `presumida`. Nunca herda do mês
 * anterior: herdar silenciosamente faria setembro parecer confirmado a
 * 8% só porque agosto foi — e ninguém saberia que aquilo era um chute.
 */
export function aliquotaDaCompetencia(
  competencia: string,
  registros: readonly AliquotaDoMes[],
  piso: number = ALIQUOTA_MINIMA,
): AliquotaResolvida {
  const achado = registros.find((r) => r.competencia === competencia);
  if (!achado) return { rate: piso, presumida: true, competencia };
  return { rate: limitarAliquota(achado.rate), presumida: false, competencia };
}

/**
 * A reserva tributária de um valor bruto recebido.
 *
 * Sobre o BRUTO, não sobre o operacional: o imposto incide no que entrou
 * na conta. Aplicar sobre o líquido reservaria a menos, e a diferença só
 * apareceria na guia.
 */
export function reservaTributaria(brutoRecebido: number, rate: number): number {
  if (!Number.isFinite(brutoRecebido) || brutoRecebido <= 0) return 0;
  return Math.round(brutoRecebido * limitarAliquota(rate) * 100) / 100;
}

/**
 * O próximo vencimento de um custo recorrente.
 *
 * Sai do vencimento ATUAL, nunca da data de pagamento: pagar dia 29 uma
 * conta que vencia dia 10 não pode empurrar todos os meses seguintes
 * para o dia 29. Mesma regra do RPC no banco — as duas pontas concordam.
 *
 * Dia 31 em mês curto cai no último dia do mês, e não transborda para o
 * mês seguinte.
 */
export function proximoVencimento(
  vencimentoAtual: string,
  recorrencia: "monthly" | "yearly" = "monthly",
): string {
  const [ano, mes, dia] = vencimentoAtual.slice(0, 10).split("-").map(Number);
  if (recorrencia === "yearly") {
    return `${ano + 1}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  const proxMes = mes === 12 ? 1 : mes + 1;
  const proxAno = mes === 12 ? ano + 1 : ano;
  const ultimoDia = new Date(proxAno, proxMes, 0).getDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${proxAno}-${String(proxMes).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
}

/** Quantos dias faltam (negativo = vencido). */
export function diasAteVencer(vencimento: string, hoje: string): number {
  const a = new Date(`${vencimento.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${hoje.slice(0, 10)}T12:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}

export interface LinhaDeCusto {
  amount: number;
  recurrence: string;
}

/**
 * O custo fixo mensal: anual entra rateado por doze.
 *
 * Somar um anual inteiro no mês faria a estrutura parecer doze vezes
 * mais cara em janeiro e barata no resto do ano.
 */
export function custoMensal(linhas: readonly LinhaDeCusto[]): number {
  return linhas.reduce((soma, l) => {
    const v = Number(l.amount) || 0;
    if (l.recurrence === "monthly") return soma + v;
    if (l.recurrence === "yearly") return soma + v / 12;
    return soma;
  }, 0);
}
