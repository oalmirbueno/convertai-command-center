/**
 * FINANCEIRO para o MCP — leitura, e só leitura.
 *
 * O escopo `aceleriq:finance` existia desde o começo e não tinha uma única
 * ferramenta atrás dele: uma porta sem sala. O agente financeiro conseguia
 * ver o trabalho e o resultado da operação, e não conseguia ver um centavo
 * — então acompanhava o mês por fora, no chute, ou pedia print.
 *
 * Aqui o financeiro passa a enxergar o mês inteiro:
 *
 *   - o retrato do mês (entrou, saiu, sobrou, o que está em aberto e o que
 *     venceu, a receita recorrente, o custo fixo e a previsão de 30/60/90);
 *   - a linha a linha do caixa, com o que já foi baixado e o que não;
 *   - o resumo por cliente, com plano, margem e o que está vencido;
 *   - os planos e as regras de recorrência, que são o esqueleto do MRR.
 *
 * DUAS LINHAS QUE NÃO SE CRUZAM, de propósito:
 *
 * 1. NADA AQUI ESCREVE. Não existe baixa, não existe lançamento, não existe
 *    cancelamento por esta via. Lançar dinheiro é decisão com consequência
 *    fora do painel, e é feita no painel, por gente, com nome em cima. O
 *    MCP acompanha; quem movimenta é o dono.
 *
 * 2. NÚMERO SEM MAQUIAGEM. As leituras chamam as MESMAS funções do banco
 *    que a tela do Financeiro usa (`financial_overview_v2`,
 *    `financial_cash_flow_v2`, `financial_client_summaries_v2`). Recalcular
 *    por fora criaria um segundo faturamento de agosto — e no primeiro
 *    acerto de lançamento os dois discordariam, com o agente dizendo uma
 *    coisa e a tela do dono, outra.
 *
 * O acesso é agência: o despachante já barra princípio restrito a cliente
 * em ferramenta que não esteja na lista de tenant-scoped, e nenhuma daqui
 * está. Finanças da casa não vazam para chave de cliente.
 */

import { db, isUuid, pageMeta, READ_LIMITS } from './aceleriq-read-services.ts';

/** Os três olhares do Financeiro, iguais aos da tela. */
export type FinanceMode = 'cash' | 'accrual' | 'forecast';

const MODOS: readonly FinanceMode[] = ['cash', 'accrual', 'forecast'];

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const texto = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
};

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * A competência normalizada para o primeiro dia do mês.
 *
 * O Financeiro fecha por MÊS de competência; aceitar "2026-08-14" e usar
 * como veio faria a mesma pergunta ter respostas diferentes conforme o dia
 * digitado. Sem valor, é o mês corrente.
 */
export function normalizarCompetencia(valor: unknown): string {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  if (/^\d{4}-\d{2}$/.test(bruto)) return `${bruto}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return `${bruto.slice(0, 7)}-01`;
  if (bruto) throw new Error('competence must be YYYY-MM or YYYY-MM-DD');
  const hoje = new Date();
  const mes = String(hoje.getUTCMonth() + 1).padStart(2, '0');
  return `${hoje.getUTCFullYear()}-${mes}-01`;
}

function normalizarModo(valor: unknown): FinanceMode {
  if (valor === undefined || valor === null || valor === '') return 'cash';
  const modo = String(valor);
  if (!MODOS.includes(modo as FinanceMode)) {
    throw new Error(`mode must be one of: ${MODOS.join(', ')}`);
  }
  return modo as FinanceMode;
}

/** As RPCs devolvem jsonb: ora objeto, ora lista, ora lista dentro de campo. */
function linhasDe(valor: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(valor)) return valor as Array<Record<string, unknown>>;
  if (valor && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    for (const campo of ['rows', 'items', 'entries', 'data']) {
      if (Array.isArray(obj[campo])) return obj[campo] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/* ───────────────────────── A cobrança que existe ─────────────────────── */

/**
 * O dinheiro real da casa mora em `billing`, não no módulo v2.
 *
 * O v2 nasceu completo (planos, competência, baixa, apuração) e a tela dele
 * foi retirada antes de a operação migrar. Resultado: as tabelas do v2
 * ficaram quase vazias e a cobrança do dia a dia seguiu em `billing` —
 * mensalidade, avulso e projeto, com vencimento e pagamento.
 *
 * Ler só o v2 fazia o agente responder "não há caixa" com trinta e quatro
 * cobranças reais no banco. Uma leitura financeira que não vê o dinheiro
 * que existe é pior que nenhuma: ela responde com autoridade e erra.
 *
 * As duas fontes NUNCA são somadas. Somar criaria receita fantasma se um
 * mesmo valor existir dos dois lados; elas vêm lado a lado, cada uma com o
 * nome da sua origem, e a leitura diz em qual confiar hoje.
 */
/**
 * As MESMAS réguas da tela /financeiro, uma por uma.
 *
 * Cada linha abaixo existe porque a tela faz assim. Inventar régua mais
 * "correta" aqui produziria um número que o dono nunca viu, e o agente
 * discordaria dele na frente do cliente. Se a tela mudar, isto muda junto.
 */
async function lerCobranca(competence: string) {
  const fimDoMes = (() => {
    const [ano, mes] = competence.split('-').map(Number);
    return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  })();
  const hoje = new Date().toISOString().slice(0, 10);

  const [cobrancas, clientes] = await Promise.all([
    comPrazo(
      db()
        .from('billing')
        .select('id, client_id, type, amount, paid_amount, status, due_date, paid_date, platform, description')
        .order('due_date', { ascending: false })
        .limit(READ_LIMITS.maxPageSize),
    ),
    comPrazo(
      db()
        .from('profiles')
        .select('id, full_name, company_name, plan_value, plan_status, client_type, services_config')
        .limit(READ_LIMITS.maxPageSize),
    ),
  ]);
  if (cobrancas.error) throw new Error(`billing: ${cobrancas.error.message}`);

  const linhas = (cobrancas.data ?? []) as Array<Record<string, unknown>>;
  const perfis = (clientes.data ?? []) as Array<Record<string, unknown>>;
  const nomePorId = new Map(
    perfis.map((c) => [String(c.id), texto(c.company_name) ?? texto(c.full_name) ?? '(sem nome)']),
  );

  // Empresa do grupo é casa, não cliente: fica fora de qualquer cobrança.
  const ehInterno = (c: Record<string, unknown>) =>
    Boolean((c.services_config as Record<string, unknown> | null)?.internal_company);

  // Cliente em standby/inativo tem a recorrência PAUSADA na visão do
  // financeiro: cobrar quem está parado infla o a receber com dinheiro que
  // ninguém espera.
  const pausados = new Set(
    perfis
      .filter((c) => {
        const situacao = texto(c.plan_status);
        return situacao === 'standby' || situacao === 'inactive' || ehInterno(c);
      })
      .map((c) => String(c.id)),
  );
  const recorrenciaPausada = (r: Record<string, unknown>) =>
    texto(r.type) === 'renewal' && pausados.has(String(r.client_id));

  // Recebido respeita pagamento PARCIAL: nesse caso vale o que entrou, não
  // o que foi cobrado.
  const recebidoDe = (r: Record<string, unknown>) => {
    const total = numero(r.amount);
    const pago = numero(r.paid_amount);
    const situacao = texto(r.status);
    if (situacao === 'partial') return Math.min(pago, total);
    if (situacao === 'paid') return pago > 0 && pago < total ? pago : total;
    return 0;
  };

  const noMes = (data: string | null) => Boolean(data && data >= competence && data < fimDoMes);
  // Recarga de anúncio não é receita da casa: é verba do cliente passando.
  const contaComoReceita = (r: Record<string, unknown>) => texto(r.type) !== 'ads_recharge';

  const abertas = linhas.filter((r) => texto(r.status) === 'pending' && !recorrenciaPausada(r));
  const pagas = linhas.filter((r) => ['paid', 'partial'].includes(texto(r.status) ?? ''));

  const abertasDoMes = abertas.filter((r) => contaComoReceita(r) && noMes(texto(r.due_date)));
  const pagasDoMes = pagas.filter(
    (r) => contaComoReceita(r) && noMes(texto(r.paid_date) ?? texto(r.due_date)),
  );
  const vencidas = abertas.filter((r) => {
    const venc = texto(r.due_date);
    return Boolean(venc && venc < hoje);
  });

  // Receita mensal esperada: a soma dos planos ativos, fora avulso e fora
  // empresa do grupo. É o MRR que a tela mostra.
  const receitaEsperada = perfis
    .filter(
      (c) =>
        numero(c.plan_value) > 0 &&
        texto(c.plan_status) === 'active' &&
        texto(c.client_type) !== 'one_off' &&
        !ehInterno(c),
    )
    .reduce((s, c) => s + numero(c.plan_value), 0);

  return {
    linhas,
    nomePorId,
    recebidoDe,
    contaComoReceita,
    recorrenciaPausada,
    resumo: {
      recebido_no_mes: pagasDoMes.reduce((s, r) => s + recebidoDe(r), 0),
      a_receber_no_mes: abertasDoMes.reduce((s, r) => s + numero(r.amount), 0),
      vencido_no_mes: abertasDoMes
        .filter((r) => (texto(r.due_date) ?? '') < hoje)
        .reduce((s, r) => s + numero(r.amount), 0),
      // Vencido total não se prende ao mês: dívida velha continua dívida.
      vencido_total: vencidas.filter(contaComoReceita).reduce((s, r) => s + numero(r.amount), 0),
      recebido_total: pagas.filter(contaComoReceita).reduce((s, r) => s + recebidoDe(r), 0),
      a_receber_total: abertas.filter(contaComoReceita).reduce((s, r) => s + numero(r.amount), 0),
      receita_mensal_esperada: receitaEsperada,
      cobrancas_abertas: abertas.length,
      cobrancas_vencidas: vencidas.length,
      cobrancas_no_banco: linhas.length,
    },
  };
}

/**
 * A cobrança da casa, linha a linha, como a tela /financeiro mostra.
 *
 * Devolve cada cobrança com cliente, tipo, valor, vencimento, pagamento e
 * o quanto de fato entrou (respeitando parcial), mais o resumo do mês.
 */
export async function getFinanceBilling(opts: {
  competence?: string;
  status?: string;
  type?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
}) {
  const competence = normalizarCompetencia(opts.competence);
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  if (opts.client_id && !isUuid(opts.client_id)) throw new Error('client_id must be a UUID');

  const cobranca = await lerCobranca(competence);
  const hoje = new Date().toISOString().slice(0, 10);

  let linhas = cobranca.linhas.map((r) => {
    const venc = texto(r.due_date);
    const situacao = texto(r.status);
    return {
      id: texto(r.id),
      cliente_id: texto(r.client_id),
      cliente: cobranca.nomePorId.get(String(r.client_id)) ?? '(sem nome)',
      tipo: texto(r.type),
      descricao: texto(r.description),
      valor: numero(r.amount),
      recebido: cobranca.recebidoDe(r),
      situacao,
      vencimento: venc,
      pagamento: texto(r.paid_date),
      vencida: Boolean(situacao === 'pending' && venc && venc < hoje),
      plataforma: texto(r.platform),
      // A recorrência de cliente parado fica visível, mas marcada: ela não
      // entra nos totais, e esconder isso viraria pergunta sem resposta.
      recorrencia_pausada: cobranca.recorrenciaPausada(r),
      conta_como_receita: cobranca.contaComoReceita(r),
    };
  });

  if (opts.status) linhas = linhas.filter((l) => l.situacao === String(opts.status));
  if (opts.type) linhas = linhas.filter((l) => l.tipo === String(opts.type));
  if (opts.client_id) linhas = linhas.filter((l) => l.cliente_id === opts.client_id);

  const total = linhas.length;
  return {
    competence,
    fonte: 'billing (a mesma tabela da tela /financeiro)',
    items: linhas.slice(offset, offset + limit),
    resumo: cobranca.resumo,
    ...pageMeta(total, limit, offset),
  };
}

/* ─────────────────────────── O retrato do mês ────────────────────────── */

/**
 * O mês em uma tela: entrou, saiu, sobrou, o que está em aberto, o que
 * venceu, a receita que se repete, o custo fixo e a previsão à frente.
 *
 * `leitura` traduz o retrato em uma frase — é o que evita o agente ler
 * "net: -3200" e anunciar prejuízo quando faltam duas semanas de recebimento
 * no mês.
 */
export async function getFinanceOverview(opts: { mode?: string; competence?: string }) {
  const mode = normalizarModo(opts.mode);
  const competence = normalizarCompetencia(opts.competence);

  const [retrato, cobranca] = await Promise.all([
    comPrazo(db().rpc('financial_overview_v2', { p_mode: mode, p_competence: competence })),
    lerCobranca(competence),
  ]);
  const { data, error } = retrato;
  if (error) throw new Error(`financial_overview_v2: ${error.message}`);

  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  /**
   * O bloco que impede a resposta zerada com dinheiro no banco.
   *
   * A cobrança real vem sempre, ao lado do módulo v2 e NUNCA somada a ele:
   * somar criaria receita fantasma se um valor existir dos dois lados. O
   * campo `use_estes_numeros` diz qual das duas fontes responde hoje, para
   * o agente não ter que escolher no escuro.
   */
  const moduloVazio = cobranca.resumo.cobrancas_no_banco > 0
    && numero(linha?.income) === 0
    && numero(linha?.settled_income) === 0;

  const bloco = {
    cobranca: {
      fonte: 'billing (a mesma tabela da tela /financeiro)',
      ...cobranca.resumo,
    },
    use_estes_numeros: moduloVazio ? 'cobranca' : 'modulo_v2',
    aviso: moduloVazio
      ? 'O módulo financeiro v2 está sem lançamentos nesta competência, mas a cobrança da casa TEM registros. Responda pelos números de `cobranca` e diga que vieram da tela /financeiro. Não afirme que não há caixa.'
      : null,
  };

  if (!linha) {
    return {
      mode,
      competence,
      encontrado: cobranca.resumo.cobrancas_no_banco > 0,
      ...bloco,
      leitura:
        `Competência ${competence.slice(0, 7)}: recebido ${cobranca.resumo.recebido_no_mes.toFixed(2)}, ` +
        `a receber ${cobranca.resumo.a_receber_no_mes.toFixed(2)}, vencido ${cobranca.resumo.vencido_total.toFixed(2)} ` +
        `(fonte: cobrança da casa).`,
    };
  }

  const entrou = numero(linha.income);
  const saiu = numero(linha.expense);
  const liquido = numero(linha.net);
  const aReceber = numero(linha.pending_income);
  const vencido = numero(linha.overdue_income);
  const recorrente = numero(linha.recurring_revenue ?? linha.mrr);
  const custoFixo = numero(linha.fixed_costs ?? linha.recurring_expense);

  return {
    mode,
    competence,
    encontrado: true,
    ...bloco,
    saldo_inicial: numero(linha.opening_balance),
    entrou,
    saiu,
    liquido,
    recebido: numero(linha.settled_income),
    pago: numero(linha.settled_expense),
    a_receber: aReceber,
    a_pagar: numero(linha.pending_expense),
    vencido_a_receber: vencido,
    receita_recorrente: recorrente,
    custo_fixo: custoFixo,
    previsao_30_dias: numero(linha.forecast_30_days),
    previsao_60_dias: numero(linha.forecast_60_days),
    previsao_90_dias: numero(linha.forecast_90_days),
    clientes: Math.trunc(numero(linha.clients_count)),
    // A frase existe para o número não ser lido fora de contexto: mês com
    // líquido negativo e muito a receber não é prejuízo, é mês em curso.
    leitura: (moduloVazio
      ? [
        `Competência ${competence.slice(0, 7)}: pelos números da tela /financeiro, recebido ` +
        `${cobranca.resumo.recebido_no_mes.toFixed(2)}, a receber ${cobranca.resumo.a_receber_no_mes.toFixed(2)}.`,
        cobranca.resumo.vencido_total > 0
          ? `ATENÇÃO: ${cobranca.resumo.vencido_total.toFixed(2)} vencido em ${cobranca.resumo.cobrancas_vencidas} cobranças.`
          : null,
        cobranca.resumo.receita_mensal_esperada > 0
          ? `Receita mensal esperada dos planos ativos: ${cobranca.resumo.receita_mensal_esperada.toFixed(2)}.`
          : null,
        'O módulo v2 está sem lançamentos nesta competência; estes números vêm da cobrança da casa.',
      ]
      : [
        `Competência ${competence.slice(0, 7)} (${mode}): entrou ${entrou.toFixed(2)}, saiu ${saiu.toFixed(2)}, líquido ${liquido.toFixed(2)}.`,
        aReceber > 0 ? `Ainda há ${aReceber.toFixed(2)} a receber neste mês.` : null,
        vencido > 0 ? `ATENÇÃO: ${vencido.toFixed(2)} vencido e não recebido.` : null,
        recorrente > 0 ? `Receita recorrente do mês: ${recorrente.toFixed(2)}.` : null,
      ]
    ).filter(Boolean).join(' '),
    raw: linha,
  };
}

/* ────────────────────────── O caixa, linha a linha ───────────────────── */

/**
 * As movimentações da competência: o que entrou, o que saiu, o que está
 * previsto, cada uma com data, cliente, valor e se já foi baixada.
 *
 * Filtra por direção, situação e cliente porque a pergunta real quase nunca
 * é "me mostre tudo" — é "o que está vencido do fulano".
 */
export async function listFinanceEntries(opts: {
  mode?: string;
  competence?: string;
  direction?: string;
  status?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
}) {
  const mode = normalizarModo(opts.mode);
  const competence = normalizarCompetencia(opts.competence);
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  if (opts.direction && !['in', 'out'].includes(String(opts.direction))) {
    throw new Error("direction must be 'in' or 'out'");
  }
  if (opts.client_id && !isUuid(opts.client_id)) {
    throw new Error('client_id must be a UUID');
  }

  const { data, error } = await comPrazo(
    db().rpc('financial_cash_flow_v2', { p_mode: mode, p_competence: competence }),
  );
  if (error) throw new Error(`financial_cash_flow_v2: ${error.message}`);

  let linhas = linhasDe(data).map((linha) => ({
    id: texto(linha.id),
    entry_id: texto(linha.entry_id),
    tipo: texto(linha.source_type),
    competencia: texto(linha.competence),
    data_movimento: texto(linha.movement_date),
    vencimento: texto(linha.due_date),
    baixado_em: texto(linha.settled_on),
    direcao: texto(linha.direction),
    natureza: texto(linha.kind),
    descricao: texto(linha.description),
    cliente_id: texto(linha.client_id),
    cliente: texto(linha.client_name),
    projeto_id: texto(linha.project_id),
    valor: numero(linha.amount),
    valor_com_sinal: numero(linha.signed_amount),
    valor_bruto: numero(linha.gross_amount),
    reserva_de_imposto: numero(linha.tax_reserve_amount),
    situacao: texto(linha.status),
    // Baixado é o que tem data de baixa: "status" varia de nome entre as
    // fontes, a data não mente.
    baixado: Boolean(texto(linha.settled_on)),
    metodo: texto(linha.method),
  }));

  if (opts.direction) linhas = linhas.filter((l) => l.direcao === opts.direction);
  if (opts.status) linhas = linhas.filter((l) => l.situacao === String(opts.status));

  if (opts.client_id) {
    // A linha de BAIXA não carrega client_id — ela pertence ao lançamento.
    // Filtrar só pelo campo deixaria de fora justamente o que já foi pago,
    // e o cliente em dia apareceria como se nada tivesse entrado.
    const { data: doCliente } = await comPrazo(
      db()
        .from('financial_entries')
        .select('id')
        .eq('client_id', opts.client_id)
        .eq('competence', competence),
    );
    const idsDoCliente = new Set((doCliente ?? []).map((r: Record<string, unknown>) => String(r.id)));
    linhas = linhas.filter((l) =>
      l.cliente_id === opts.client_id || (l.entry_id ? idsDoCliente.has(l.entry_id) : false)
    );
  }

  const total = linhas.length;
  const pagina = linhas.slice(offset, offset + limit);

  return {
    mode,
    competence,
    items: pagina,
    totais_do_filtro: {
      entradas: linhas.filter((l) => l.direcao === 'in').reduce((s, l) => s + l.valor, 0),
      saidas: linhas.filter((l) => l.direcao === 'out').reduce((s, l) => s + l.valor, 0),
      em_aberto: linhas.filter((l) => !l.baixado).reduce((s, l) => s + l.valor, 0),
    },
    ...pageMeta(total, limit, offset),
  };
}

/* ────────────────────────── O mês por cliente ────────────────────────── */

/**
 * Cada cliente com o que cobra, o que já entrou, o que está em aberto, o
 * que venceu e a margem que sobra depois do imposto e do custo direto.
 *
 * É a leitura que responde "quem está pagando em dia" e "quem dá lucro" —
 * as duas perguntas que decidem renovação e reajuste.
 */
export async function listFinanceClientSummaries(opts: { client_id?: string }) {
  if (opts.client_id && !isUuid(opts.client_id)) {
    throw new Error('client_id must be a UUID');
  }

  const { data, error } = await comPrazo(db().rpc('financial_client_summaries_v2'));
  if (error) throw new Error(`financial_client_summaries_v2: ${error.message}`);

  let linhas = linhasDe(data).map((linha) => ({
    cliente_id: texto(linha.client_id),
    cliente: texto(linha.client_name),
    plano: texto(linha.plan_name),
    cobranca: texto(linha.pricing_mode),
    periodo: texto(linha.billing_period),
    valor_do_plano: numero(linha.final_plan_amount ?? linha.plan_amount),
    valor_operacional: numero(linha.operational_amount),
    imposto_reservado: numero(linha.tax_reserve),
    custo_direto: numero(linha.direct_cost),
    custo_direto_estimado: linha.direct_cost_estimated === true,
    margem_percentual: numero(linha.contribution_margin_percent),
    recebido: numero(linha.settled_amount),
    em_aberto: numero(linha.open_amount),
    vencido: numero(linha.overdue_amount),
    proximo_vencimento: texto(linha.next_due_date),
    dia_de_vencimento: linha.due_day == null ? null : Math.trunc(numero(linha.due_day)),
    situacao: texto(linha.billing_status ?? linha.status),
    // Revisão pendente é sinal de que o número ali ainda não é confiável;
    // esconder isso faria o agente afirmar valor que o dono ainda discute.
    revisao_necessaria: linha.review_required === true,
    proximo_plano: texto(linha.upcoming_plan_name),
    proximo_plano_valor: numero(linha.upcoming_final_amount ?? linha.upcoming_operational_amount),
    proximo_plano_inicio: texto(linha.upcoming_starts_on),
  }));

  if (opts.client_id) linhas = linhas.filter((l) => l.cliente_id === opts.client_id);

  const inadimplentes = linhas.filter((l) => l.vencido > 0);

  return {
    items: linhas,
    total: linhas.length,
    resumo: {
      clientes: linhas.length,
      receita_contratada: linhas.reduce((s, l) => s + l.valor_do_plano, 0),
      em_aberto: linhas.reduce((s, l) => s + l.em_aberto, 0),
      vencido: linhas.reduce((s, l) => s + l.vencido, 0),
      clientes_com_vencido: inadimplentes.length,
      clientes_em_revisao: linhas.filter((l) => l.revisao_necessaria).length,
    },
  };
}

/* ─────────────────────── Planos e recorrências ───────────────────────── */

/** Os planos da casa e a versão vigente de cada um: o que se cobra e por quê. */
export async function listFinancePlans(opts: { limit?: number; offset?: number; include_archived?: boolean }) {
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  let qb = db()
    .from('financial_plans')
    .select('id, code, name, description, is_active, archived_at, created_at, updated_at', { count: 'exact' })
    .order('name', { ascending: true });
  if (!opts.include_archived) qb = qb.is('archived_at', null);

  const { data, error, count } = await comPrazo(qb.range(offset, offset + limit - 1));
  if (error) throw new Error(`financial_plans: ${error.message}`);

  const ids = (data ?? []).map((p: Record<string, unknown>) => String(p.id));
  const versoes = new Map<string, Record<string, unknown>>();
  if (ids.length > 0) {
    const { data: linhasVersao } = await comPrazo(
      db()
        .from('financial_plan_versions')
        .select(
          'id, plan_id, version, operational_amount, final_amount, amount_kind, tax_rate, direct_cost_amount, direct_cost_estimated, billing_period, setup_fee, valid_from, valid_to, is_active',
        )
        .in('plan_id', ids)
        .eq('is_active', true)
        .order('valid_from', { ascending: false }),
    );
    for (const v of (linhasVersao ?? []) as Array<Record<string, unknown>>) {
      const chave = String(v.plan_id);
      // A lista vem da mais recente: a primeira de cada plano é a vigente.
      if (!versoes.has(chave)) versoes.set(chave, v);
    }
  }

  return {
    items: (data ?? []).map((p: Record<string, unknown>) => {
      const v = versoes.get(String(p.id));
      return {
        id: texto(p.id),
        codigo: texto(p.code),
        nome: texto(p.name),
        descricao: texto(p.description),
        ativo: p.is_active === true,
        arquivado: Boolean(p.archived_at),
        versao_vigente: v
          ? {
            id: texto(v.id),
            versao: Math.trunc(numero(v.version)),
            periodo: texto(v.billing_period),
            valor_operacional: numero(v.operational_amount),
            valor_final: numero(v.final_amount),
            // 'needs_review' avisa que o valor ainda não foi conferido: o
            // agente precisa saber disso antes de afirmar preço.
            natureza_do_valor: texto(v.amount_kind),
            aliquota: numero(v.tax_rate),
            custo_direto: numero(v.direct_cost_amount),
            custo_direto_estimado: v.direct_cost_estimated === true,
            taxa_de_entrada: numero(v.setup_fee),
            vigente_desde: texto(v.valid_from),
            vigente_ate: texto(v.valid_to),
          }
          : null,
      };
    }),
    ...pageMeta(count, limit, offset),
  };
}

/**
 * As regras de recorrência: o que se repete todo mês sem ninguém lançar.
 *
 * É o esqueleto do MRR — e a resposta para "por que entrou isso aqui de
 * novo", que sem esta leitura só existia no banco.
 */
export async function listFinanceRecurringRules(opts: {
  client_id?: string;
  limit?: number;
  offset?: number;
  include_inactive?: boolean;
}) {
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  if (opts.client_id && !isUuid(opts.client_id)) {
    throw new Error('client_id must be a UUID');
  }

  let qb = db()
    .from('financial_recurring_rules')
    .select(
      'id, client_id, stable_code, name, description, direction, kind, category, brand, amount, operational_amount, tax_rate, frequency, due_day, starts_on, ends_on, is_active, created_at, updated_at',
      { count: 'exact' },
    )
    .order('name', { ascending: true });
  // Regra recorrente não é arquivada: ela é LIGADA ou DESLIGADA (`is_active`).
  if (!opts.include_inactive) qb = qb.eq('is_active', true);
  if (opts.client_id) qb = qb.eq('client_id', opts.client_id);

  const { data, error, count } = await comPrazo(qb.range(offset, offset + limit - 1));
  if (error) throw new Error(`financial_recurring_rules: ${error.message}`);

  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  // Nesta tabela a direção é 'income'/'expense' — e não o 'in'/'out' dos
  // lançamentos. Trocar os dois é o erro que inverteria receita e custo.
  const ativas = linhas.filter((r) => r.is_active === true);
  const entradas = ativas.filter((r) => texto(r.direction) === 'income');
  const saidas = ativas.filter((r) => texto(r.direction) === 'expense');

  return {
    items: linhas.map((r) => ({
      id: texto(r.id),
      cliente_id: texto(r.client_id),
      codigo: texto(r.stable_code),
      nome: texto(r.name),
      descricao: texto(r.description),
      direcao: texto(r.direction),
      natureza: texto(r.kind),
      categoria: texto(r.category),
      marca: texto(r.brand),
      valor: numero(r.amount),
      valor_operacional: numero(r.operational_amount),
      aliquota: numero(r.tax_rate),
      frequencia: texto(r.frequency),
      dia_de_vencimento: r.due_day == null ? null : Math.trunc(numero(r.due_day)),
      comeca_em: texto(r.starts_on),
      termina_em: texto(r.ends_on),
      ativa: r.is_active === true,
    })),
    resumo: {
      receita_recorrente: entradas.reduce((s, r) => s + numero(r.amount), 0),
      custo_recorrente: saidas.reduce((s, r) => s + numero(r.amount), 0),
      regras_de_entrada: entradas.length,
      regras_de_saida: saidas.length,
    },
    ...pageMeta(count, limit, offset),
  };
}
