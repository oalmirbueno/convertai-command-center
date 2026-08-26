/**
 * A TELA /financeiro inteira, para o agente ler.
 *
 * O relato do dono foi direto: "está errado os valores do mês, não é isso
 * que eu vejo aqui; eu preciso de todas essas informações, de outros meses
 * também, de forma completa, tudo mesmo, não só o básico".
 *
 * O print mostrou o erro em uma linha: RECEBIDO R$ 5.204,00 = Planos
 * R$ 4.507,00 + Projetos R$ 697,00. A primeira versão lia só a cobrança e
 * ignorava as parcelas de projeto, então devolvia 4.507 onde a tela mostra
 * 5.204. Número quase certo é pior que número ausente: passa por verdade.
 *
 * Aqui a regra é uma só e vale para cada linha deste arquivo: **a fórmula é
 * a da tela, não uma melhor**. Cada bloco abaixo é o espelho de um bloco de
 * `AdminFinanceiro.tsx` e de `ManagementSummary.tsx`. Se a tela mudar, isto
 * muda junto — e o teste de contrato existe para que a divergência apareça
 * como falha, não como um agente afirmando outro número na frente do
 * cliente.
 *
 * Nada aqui escreve. Nem uma linha.
 */

import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';

/* ────────────────────────── Régua do Plano Diretor ───────────────────── */

/** Alíquota ilustrativa da fase atual. Igual a DEFAULT_TAX_RATE do painel. */
const ALIQUOTA_PADRAO = 0.06;

/** Escada oficial de pró-labore por receita operacional mensal. */
const ESCADA_PRO_LABORE: Array<{ receita: number; proLabore: number }> = [
  { receita: 10_000, proLabore: 3_000 },
  { receita: 15_000, proLabore: 4_000 },
  { receita: 30_000, proLabore: 5_000 },
  { receita: 50_000, proLabore: 7_000 },
  { receita: 100_000, proLabore: 10_000 },
  { receita: 250_000, proLabore: 15_000 },
  { receita: 500_000, proLabore: 20_000 },
  { receita: 1_000_000, proLabore: 25_000 },
];

/** Pró-labore proporcional ao que entrou, sem saltos. Igual ao painel. */
function proLaboreProporcional(receitaOperacional: number): number {
  if (!Number.isFinite(receitaOperacional) || receitaOperacional <= 0) return 0;
  const primeiro = ESCADA_PRO_LABORE[0];
  if (receitaOperacional < primeiro.receita) {
    return Math.round((receitaOperacional / primeiro.receita) * primeiro.proLabore);
  }
  let anterior = primeiro;
  for (const degrau of ESCADA_PRO_LABORE.slice(1)) {
    if (receitaOperacional < degrau.receita) {
      const fracao = (receitaOperacional - anterior.receita) / (degrau.receita - anterior.receita);
      return Math.round(anterior.proLabore + fracao * (degrau.proLabore - anterior.proLabore));
    }
    anterior = degrau;
  }
  return anterior.proLabore;
}

/* ──────────────────────────────── Base ───────────────────────────────── */

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const texto = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
};

const cents = (v: number) => Math.round(v * 100) / 100;

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function mesDe(competence: string) {
  const [ano, mes] = competence.split('-').map(Number);
  const fim = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  return { ano, mes, inicio: competence, fim };
}

/** Está dentro do mês da competência? Compara texto ISO, sem fuso no meio. */
const dentroDoMes = (data: string | null, inicio: string, fim: string) =>
  Boolean(data && data >= inicio && data < fim);

/**
 * O quanto ENTROU de fato numa cobrança ou parcela.
 *
 * Pagamento parcial vale o que entrou; pago com valor menor que o cobrado
 * também. É o `receivedOf` da tela, letra por letra — usar `amount` direto
 * inflaria o recebido em todo pagamento parcial.
 */
function recebidoDe(linha: Record<string, unknown>): number {
  const total = numero(linha.amount);
  const pago = numero(linha.paid_amount);
  const situacao = texto(linha.status);
  if (situacao === 'partial') return Math.min(pago, total);
  if (situacao === 'paid') return pago > 0 && pago < total ? pago : total;
  return 0;
}

/* ─────────────────────────── O painel completo ───────────────────────── */

export interface EntradaFinanceira {
  competence?: string;
  /** Quantos meses da série anual devolver. Padrão: o ano da competência. */
  incluir_listas?: boolean;
}

/**
 * Tudo o que a tela /financeiro mostra para um mês, num retorno só.
 *
 * Uma chamada em vez de seis: o agente financeiro precisa do conjunto para
 * responder qualquer pergunta do mês, e seis idas separadas convidariam a
 * misturar meses diferentes numa conta só.
 */
export async function getFinanceDashboard(input: EntradaFinanceira & { client_id?: string }) {
  const competence = normalizarCompetencia(input.competence);
  const { ano, inicio, fim } = mesDe(competence);
  const hoje = new Date().toISOString().slice(0, 10);
  const proximo = mesDe(fim);

  const [cobrancas, perfis, pagamentos, despesas, carteiras, config, planos] = await Promise.all([
    comPrazo(db().from('billing').select(
      'id, client_id, type, amount, paid_amount, status, due_date, paid_date, platform, description',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('profiles').select(
      'id, full_name, company_name, plan_name, plan_value, plan_status, plan_renewal_date, client_type, brand, services_config',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('project_payments').select(
      'id, project_id, client_id, total_value, entry_amount, installments_count, notes, ' +
      'project:projects(name, project_type, brand), installments:payment_installments(*)',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('expenses').select(
      'id, description, supplier, category, amount, status, recurrence, due_date, paid_date, brand, notes',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('ads_wallet').select('client_id, balance, last_recharge_date').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('financial_settings').select('*').eq('settings_key', 'default').maybeSingle()),
    comPrazo(db().from('financial_plans').select(
      'id, name, financial_plan_versions(tax_rate, valid_from, is_active)',
    ).is('archived_at', null).limit(READ_LIMITS.maxPageSize)),
  ]);

  if (cobrancas.error) throw new Error(`billing: ${cobrancas.error.message}`);

  const linhas = (cobrancas.data ?? []) as Array<Record<string, unknown>>;
  const clientes = (perfis.data ?? []) as Array<Record<string, unknown>>;
  const projetos = (pagamentos.data ?? []) as Array<Record<string, unknown>>;
  const gastos = (despesas.data ?? []) as Array<Record<string, unknown>>;
  const ads = (carteiras.data ?? []) as Array<Record<string, unknown>>;
  const cfg = (config.data ?? {}) as Record<string, unknown>;

  const nomeDoCliente = new Map(
    clientes.map((c) => [String(c.id), texto(c.company_name) ?? texto(c.full_name) ?? '(sem nome)']),
  );

  /* ── Quem fica de fora ─────────────────────────────────────────────── */
  const ehInterno = (c: Record<string, unknown>) =>
    Boolean((c.services_config as Record<string, unknown> | null)?.internal_company);
  const pausados = new Set(
    clientes
      .filter((c) => {
        const s = texto(c.plan_status);
        return s === 'standby' || s === 'inactive' || ehInterno(c);
      })
      .map((c) => String(c.id)),
  );
  const recorrenciaPausada = (r: Record<string, unknown>) =>
    texto(r.type) === 'renewal' && pausados.has(String(r.client_id));
  // Recarga de anúncio é verba do cliente passando, não receita da casa.
  const contaReceita = (r: Record<string, unknown>) => texto(r.type) !== 'ads_recharge';

  /* ── Cobranças ─────────────────────────────────────────────────────── */
  const abertas = linhas.filter((r) => texto(r.status) === 'pending' && !recorrenciaPausada(r));
  const pagas = linhas.filter((r) => ['paid', 'partial'].includes(texto(r.status) ?? ''));
  const abertasDoMes = abertas.filter((r) => contaReceita(r) && dentroDoMes(texto(r.due_date), inicio, fim));
  const pagasDoMes = pagas.filter(
    (r) => contaReceita(r) && dentroDoMes(texto(r.paid_date) ?? texto(r.due_date), inicio, fim),
  );

  /* ── Parcelas de projeto: o pedaço que faltava ─────────────────────── */
  const parcelas = projetos.flatMap((pp) => {
    const lista = (pp.installments ?? []) as Array<Record<string, unknown>>;
    const projeto = (pp.project ?? {}) as Record<string, unknown>;
    return lista.map((i) => ({
      linha: i,
      clienteId: texto(pp.client_id),
      projetoNome: texto(projeto.name),
      projetoTipo: texto(projeto.project_type),
      pagamentoId: texto(pp.id),
    }));
  });
  const parcelasPagasDoMes = parcelas.filter(
    (p) =>
      ['paid', 'partial'].includes(texto(p.linha.status) ?? '') &&
      dentroDoMes(texto(p.linha.paid_date) ?? texto(p.linha.due_date), inicio, fim),
  );
  const parcelasAbertas = parcelas.filter((p) => texto(p.linha.status) === 'pending');

  const recebidoPlanos = cents(pagasDoMes.reduce((s, r) => s + recebidoDe(r), 0));
  const recebidoProjetos = cents(parcelasPagasDoMes.reduce((s, p) => s + recebidoDe(p.linha), 0));
  const recebidoNoMes = cents(recebidoPlanos + recebidoProjetos);

  const aReceberCobranca = cents(abertasDoMes.reduce((s, r) => s + numero(r.amount), 0));
  const aReceberParcelas = cents(
    parcelasAbertas
      .filter((p) => dentroDoMes(texto(p.linha.due_date), inicio, fim))
      .reduce((s, p) => s + numero(p.linha.amount), 0),
  );

  const atrasadoCobranca = cents(
    abertasDoMes.filter((r) => (texto(r.due_date) ?? '') < hoje).reduce((s, r) => s + numero(r.amount), 0),
  );
  const atrasadoParcelas = cents(
    parcelasAbertas
      .filter((p) => dentroDoMes(texto(p.linha.due_date), inicio, fim) && (texto(p.linha.due_date) ?? '') < hoje)
      .reduce((s, p) => s + numero(p.linha.amount), 0),
  );

  /* ── Receita esperada e projeção ───────────────────────────────────── */
  const mensalistas = clientes.filter(
    (c) =>
      numero(c.plan_value) > 0 &&
      texto(c.plan_status) === 'active' &&
      texto(c.client_type) !== 'one_off' &&
      !ehInterno(c),
  );
  const receitaEsperada = cents(mensalistas.reduce((s, c) => s + numero(c.plan_value), 0));
  const parcelasProximoMes = cents(
    parcelasAbertas
      .filter((p) => dentroDoMes(texto(p.linha.due_date), proximo.inicio, proximo.fim))
      .reduce((s, p) => s + numero(p.linha.amount), 0),
  );

  /* ── Saldo em caixa (fórmula do Fluxo de Caixa) ────────────────────── */
  const ehDespesaDeInvestidor = (e: Record<string, unknown>) => {
    const c = texto(e.category) ?? '';
    return c === 'investidor' || c.startsWith('inv_');
  };
  const recebidoTodoTempo = cents(
    pagas.filter(contaReceita).reduce((s, r) => s + recebidoDe(r), 0) +
    parcelas
      .filter((p) => ['paid', 'partial'].includes(texto(p.linha.status) ?? ''))
      .reduce((s, p) => s + recebidoDe(p.linha), 0),
  );
  const pagoTodoTempo = cents(
    gastos
      .filter((e) => texto(e.status) === 'paid' && !ehDespesaDeInvestidor(e))
      .reduce((s, e) => s + numero(e.amount), 0),
  );
  const saldoEmCaixa = cents(numero(cfg.opening_balance) + recebidoTodoTempo - pagoTodoTempo);

  /* ── Divisão automática (ManagementSummary) ────────────────────────── */
  const aliquotaPorPlano = new Map<string, number>();
  for (const p of (planos.data ?? []) as Array<Record<string, unknown>>) {
    const versoes = ((p.financial_plan_versions ?? []) as Array<Record<string, unknown>>)
      .filter((v) => v.is_active === true)
      .sort((a, b) => String(b.valid_from ?? '').localeCompare(String(a.valid_from ?? '')));
    const taxa = versoes[0]?.tax_rate;
    if (taxa !== null && taxa !== undefined) {
      aliquotaPorPlano.set(String(texto(p.name) ?? '').toLowerCase(), numero(taxa));
    }
  }
  const aliquotaDoCliente = new Map<string, number>();
  for (const c of clientes) {
    const chave = (texto(c.plan_name) ?? '').toLowerCase();
    aliquotaDoCliente.set(String(c.id), aliquotaPorPlano.get(chave) ?? ALIQUOTA_PADRAO);
  }

  const recebidosDoMes = [
    ...pagasDoMes.map((r) => ({ clienteId: texto(r.client_id), valor: recebidoDe(r) })),
    ...parcelasPagasDoMes.map((p) => ({ clienteId: p.clienteId, valor: recebidoDe(p.linha) })),
  ];
  const bruto = cents(recebidosDoMes.reduce((s, it) => s + it.valor, 0));
  const reservaTributaria = cents(
    recebidosDoMes.reduce(
      (s, it) => s + it.valor * ((it.clienteId && aliquotaDoCliente.get(it.clienteId)) ?? ALIQUOTA_PADRAO),
      0,
    ),
  );
  const receitaOperacional = cents(bruto - reservaTributaria);

  // Pró-labore em linha própria: nunca descontado duas vezes.
  const ehProLabore = (e: Record<string, unknown>) =>
    /pr[oó][\s_-]?labore/i.test(`${texto(e.description) ?? ''} ${texto(e.notes) ?? ''}`);
  const fixosMensais = gastos.filter((e) => texto(e.recurrence) === 'monthly' && !ehProLabore(e));
  const custosFixosReais = cents(fixosMensais.reduce((s, e) => s + numero(e.amount), 0));
  const custosFixos = custosFixosReais > 0 ? custosFixosReais : numero(cfg.tools_systems_cost ?? 2500);

  const proLabore = proLaboreProporcional(receitaOperacional);
  const proLaboreOficial = numero(cfg.current_pro_labore ?? 3000);
  const custoDiretoPadrao = numero(cfg.default_direct_cost ?? 275);
  const depoisDaEstrutura = receitaOperacional - custosFixos - proLabore;
  const alvoReservaClientes = mensalistas.length * custoDiretoPadrao;
  const reservaClientes = cents(Math.min(Math.max(depoisDaEstrutura, 0), alvoReservaClientes));
  const lucro = cents(depoisDaEstrutura - reservaClientes);
  const equilibrioOperacional = cents(custosFixos + proLaboreOficial);

  /* ── Série do ano ──────────────────────────────────────────────────── */
  const serie = Array.from({ length: 12 }, (_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, '0')}-01`;
    const janela = mesDe(mes);
    const rec = cents(
      pagas
        .filter((r) => contaReceita(r) && dentroDoMes(texto(r.paid_date) ?? texto(r.due_date), janela.inicio, janela.fim))
        .reduce((s, r) => s + recebidoDe(r), 0) +
      parcelas
        .filter(
          (p) =>
            ['paid', 'partial'].includes(texto(p.linha.status) ?? '') &&
            dentroDoMes(texto(p.linha.paid_date) ?? texto(p.linha.due_date), janela.inicio, janela.fim),
        )
        .reduce((s, p) => s + recebidoDe(p.linha), 0),
    );
    const pend = cents(
      abertas
        .filter((r) => contaReceita(r) && dentroDoMes(texto(r.due_date), janela.inicio, janela.fim))
        .reduce((s, r) => s + numero(r.amount), 0) +
      parcelasAbertas
        .filter((p) => dentroDoMes(texto(p.linha.due_date), janela.inicio, janela.fim))
        .reduce((s, p) => s + numero(p.linha.amount), 0),
    );
    return { mes: mes.slice(0, 7), recebido: rec, pendente: pend };
  });

  /* ── Proporção por marca ───────────────────────────────────────────── */
  const recebidoDeTipos = (tipos: string[]) =>
    cents(
      parcelas
        .filter(
          (p) =>
            ['paid', 'partial'].includes(texto(p.linha.status) ?? '') &&
            tipos.includes(p.projetoTipo ?? ''),
        )
        .reduce((s, p) => s + recebidoDe(p.linha), 0),
    );
  const marcaAceleriq = cents(pagas.filter(contaReceita).reduce((s, r) => s + recebidoDe(r), 0));
  const marcaSitebolt = recebidoDeTipos(['site', 'landing_page', 'event', 'other']);
  const marcaJunta = recebidoDeTipos(['automation']);

  /* ── Projetos individuais ──────────────────────────────────────────── */
  const projetosResumo = {
    total_contratado: cents(projetos.reduce((s, pp) => s + numero(pp.total_value), 0)),
    recebido: recebidoProjetos,
    pendente: aReceberParcelas,
    atrasado: atrasadoParcelas,
    quantidade: projetos.length,
  };

  const listaPendentes = [
    ...abertasDoMes.map((r) => ({
      origem: 'cobranca',
      id: texto(r.id),
      cliente: nomeDoCliente.get(String(r.client_id)) ?? '(sem nome)',
      descricao: texto(r.description),
      tipo: texto(r.type),
      valor: numero(r.amount),
      vencimento: texto(r.due_date),
      atrasada: (texto(r.due_date) ?? '') < hoje,
    })),
    ...parcelasAbertas
      .filter((p) => dentroDoMes(texto(p.linha.due_date), inicio, fim))
      .map((p) => ({
        origem: 'parcela_de_projeto',
        id: texto(p.linha.id),
        cliente: p.clienteId ? nomeDoCliente.get(p.clienteId) ?? '(sem nome)' : '(sem cliente)',
        descricao: `${p.projetoNome ?? 'Projeto'} · parcela ${numero(p.linha.installment_number)}`,
        tipo: 'project',
        valor: numero(p.linha.amount),
        vencimento: texto(p.linha.due_date),
        atrasada: (texto(p.linha.due_date) ?? '') < hoje,
      })),
  ].sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''));

  const listaRecebidos = [
    ...pagasDoMes.map((r) => ({
      origem: 'cobranca',
      cliente: nomeDoCliente.get(String(r.client_id)) ?? '(sem nome)',
      descricao: texto(r.description),
      tipo: texto(r.type),
      valor: recebidoDe(r),
      pagamento: texto(r.paid_date) ?? texto(r.due_date),
    })),
    ...parcelasPagasDoMes.map((p) => ({
      origem: 'parcela_de_projeto',
      cliente: p.clienteId ? nomeDoCliente.get(p.clienteId) ?? '(sem nome)' : '(sem cliente)',
      descricao: `${p.projetoNome ?? 'Projeto'} · parcela ${numero(p.linha.installment_number)}`,
      tipo: 'project',
      valor: recebidoDe(p.linha),
      pagamento: texto(p.linha.paid_date) ?? texto(p.linha.due_date),
    })),
  ].sort((a, b) => (b.pagamento ?? '').localeCompare(a.pagamento ?? ''));

  return {
    competence,
    fonte: 'As mesmas tabelas e fórmulas da tela /financeiro (billing + parcelas de projeto + despesas).',
    indicadores: {
      saldo_em_caixa: saldoEmCaixa,
      recebido_no_mes: recebidoNoMes,
      recebido_planos: recebidoPlanos,
      recebido_projetos: recebidoProjetos,
      a_receber_no_mes: cents(aReceberCobranca + aReceberParcelas),
      a_receber_cobrancas: aReceberCobranca,
      a_receber_parcelas: aReceberParcelas,
      atrasado: cents(atrasadoCobranca + atrasadoParcelas),
      receita_esperada: receitaEsperada,
      projecao_proximo_mes: cents(receitaEsperada + parcelasProximoMes),
      clientes_mensalistas: mensalistas.length,
    },
    divisao_automatica: {
      recebido_bruto: bruto,
      reserva_tributaria: reservaTributaria,
      receita_operacional: receitaOperacional,
      custos_fixos: cents(custosFixos),
      custos_fixos_origem: custosFixosReais > 0 ? 'despesas reais' : 'referência das configurações',
      pro_labore_proporcional: proLabore,
      pro_labore_oficial: proLaboreOficial,
      reserva_clientes_investimento: reservaClientes,
      lucro_do_mes: lucro,
      ponto_de_equilibrio_operacional: equilibrioOperacional,
      ponto_de_equilibrio_bruto: cents(equilibrioOperacional / (1 - ALIQUOTA_PADRAO)),
      meta_mensal: cfg.monthly_goal == null ? null : numero(cfg.monthly_goal),
    },
    receita_por_marca: {
      aceleriq: marcaAceleriq,
      sitebolt: marcaSitebolt,
      aceleriq_mais_sitebolt: marcaJunta,
      total: cents(marcaAceleriq + marcaSitebolt + marcaJunta),
    },
    projetos_individuais: projetosResumo,
    ads_wallet: {
      saldo_total: cents(ads.reduce((s, w) => s + numero(w.balance), 0)),
      carteiras: ads.length,
    },
    serie_do_ano: serie,
    pendentes: input.incluir_listas === false ? undefined : listaPendentes,
    recebidos: input.incluir_listas === false ? undefined : listaRecebidos,
    leitura:
      `Competência ${competence.slice(0, 7)}: recebido ${recebidoNoMes.toFixed(2)} ` +
      `(planos ${recebidoPlanos.toFixed(2)} + projetos ${recebidoProjetos.toFixed(2)}), ` +
      `a receber ${cents(aReceberCobranca + aReceberParcelas).toFixed(2)}, ` +
      `atrasado ${cents(atrasadoCobranca + atrasadoParcelas).toFixed(2)}. ` +
      `Saldo em caixa ${saldoEmCaixa.toFixed(2)}. Lucro do mês ${lucro.toFixed(2)} ` +
      `depois de imposto, custos fixos e pró-labore.`,
  };
}

/** Competência normalizada para o primeiro dia do mês. */
export function normalizarCompetencia(valor: unknown): string {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  if (/^\d{4}-\d{2}$/.test(bruto)) return `${bruto}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return `${bruto.slice(0, 7)}-01`;
  if (bruto) throw new Error('competence must be YYYY-MM or YYYY-MM-DD');
  const hoje = new Date();
  return `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/* ───────────────────────── Despesas e custos fixos ───────────────────── */

/**
 * As saídas da casa: custos fixos, variáveis, quem recebe e quando vence.
 *
 * Sem isto o agente vê só o que entra, e "o mês fechou bem" vira uma frase
 * que ignora metade da conta.
 */
export async function listFinanceExpenses(opts: {
  competence?: string;
  status?: string;
  recurrence?: string;
  category?: string;
  limit?: number;
  offset?: number;
}) {
  const competence = normalizarCompetencia(opts.competence);
  const { inicio, fim } = mesDe(competence);
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const { data, error } = await comPrazo(
    db()
      .from('expenses')
      .select('id, description, supplier, category, amount, status, recurrence, due_date, paid_date, brand, payment_method, notes')
      .order('due_date', { ascending: false })
      .limit(READ_LIMITS.maxPageSize),
  );
  if (error) throw new Error(`expenses: ${error.message}`);

  let linhas = (data ?? []) as Array<Record<string, unknown>>;
  if (opts.status) linhas = linhas.filter((e) => texto(e.status) === String(opts.status));
  if (opts.recurrence) linhas = linhas.filter((e) => texto(e.recurrence) === String(opts.recurrence));
  if (opts.category) linhas = linhas.filter((e) => texto(e.category) === String(opts.category));

  const doMes = linhas.filter(
    (e) => dentroDoMes(texto(e.paid_date) ?? texto(e.due_date), inicio, fim),
  );
  const mensais = linhas.filter((e) => texto(e.recurrence) === 'monthly');

  return {
    competence,
    items: linhas.slice(offset, offset + limit).map((e) => ({
      id: texto(e.id),
      descricao: texto(e.description),
      fornecedor: texto(e.supplier),
      categoria: texto(e.category),
      valor: numero(e.amount),
      situacao: texto(e.status),
      recorrencia: texto(e.recurrence),
      vencimento: texto(e.due_date),
      pagamento: texto(e.paid_date),
      marca: texto(e.brand),
      forma: texto(e.payment_method),
    })),
    resumo: {
      custo_fixo_mensal: cents(mensais.reduce((s, e) => s + numero(e.amount), 0)),
      pago_no_mes: cents(
        doMes.filter((e) => texto(e.status) === 'paid').reduce((s, e) => s + numero(e.amount), 0),
      ),
      a_pagar_no_mes: cents(
        doMes.filter((e) => texto(e.status) !== 'paid').reduce((s, e) => s + numero(e.amount), 0),
      ),
      despesas_no_banco: linhas.length,
    },
    total: linhas.length,
    limit,
    offset,
    has_more: offset + limit < linhas.length,
  };
}

/**
 * As parcelas de projeto, uma a uma: o pedaço que faltava no recebido.
 *
 * Existe separada porque "quanto o projeto do fulano já pagou" é pergunta
 * de todo dia, e a resposta some quando ela só vive dentro de um total.
 */
export async function listFinanceProjectPayments(opts: { client_id?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(Number(opts.limit) || READ_LIMITS.defaultPageSize, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  if (opts.client_id && !isUuid(opts.client_id)) throw new Error('client_id must be a UUID');

  const [pagamentos, perfis] = await Promise.all([
    comPrazo(
      db()
        .from('project_payments')
        .select(
          'id, project_id, client_id, total_value, entry_amount, entry_percentage, installments_count, notes, created_at, ' +
          'project:projects(name, project_type, brand), installments:payment_installments(*)',
        )
        .limit(READ_LIMITS.maxPageSize),
    ),
    comPrazo(db().from('profiles').select('id, full_name, company_name').limit(READ_LIMITS.maxPageSize)),
  ]);
  if (pagamentos.error) throw new Error(`project_payments: ${pagamentos.error.message}`);

  const nome = new Map(
    ((perfis.data ?? []) as Array<Record<string, unknown>>).map((c) => [
      String(c.id),
      texto(c.company_name) ?? texto(c.full_name) ?? '(sem nome)',
    ]),
  );
  const hoje = new Date().toISOString().slice(0, 10);

  let linhas = ((pagamentos.data ?? []) as Array<Record<string, unknown>>).map((pp) => {
    const parcelas = ((pp.installments ?? []) as Array<Record<string, unknown>>).sort(
      (a, b) => numero(a.installment_number) - numero(b.installment_number),
    );
    const projeto = (pp.project ?? {}) as Record<string, unknown>;
    return {
      id: texto(pp.id),
      cliente_id: texto(pp.client_id),
      cliente: nome.get(String(pp.client_id)) ?? '(sem nome)',
      projeto: texto(projeto.name),
      tipo_do_projeto: texto(projeto.project_type),
      valor_total: numero(pp.total_value),
      entrada: numero(pp.entry_amount),
      parcelas_previstas: Math.trunc(numero(pp.installments_count)),
      recebido: cents(parcelas.reduce((s, i) => s + recebidoDe(i), 0)),
      pendente: cents(
        parcelas.filter((i) => texto(i.status) === 'pending').reduce((s, i) => s + numero(i.amount), 0),
      ),
      atrasado: cents(
        parcelas
          .filter((i) => texto(i.status) === 'pending' && (texto(i.due_date) ?? '') < hoje)
          .reduce((s, i) => s + numero(i.amount), 0),
      ),
      parcelas: parcelas.map((i) => ({
        numero: Math.trunc(numero(i.installment_number)),
        valor: numero(i.amount),
        recebido: recebidoDe(i),
        situacao: texto(i.status),
        vencimento: texto(i.due_date),
        pagamento: texto(i.paid_date),
        atrasada: Boolean(texto(i.status) === 'pending' && (texto(i.due_date) ?? '') < hoje),
      })),
    };
  });

  if (opts.client_id) linhas = linhas.filter((l) => l.cliente_id === opts.client_id);

  return {
    items: linhas.slice(offset, offset + limit),
    resumo: {
      total_contratado: cents(linhas.reduce((s, l) => s + l.valor_total, 0)),
      recebido: cents(linhas.reduce((s, l) => s + l.recebido, 0)),
      pendente: cents(linhas.reduce((s, l) => s + l.pendente, 0)),
      atrasado: cents(linhas.reduce((s, l) => s + l.atrasado, 0)),
      projetos: linhas.length,
    },
    total: linhas.length,
    limit,
    offset,
    has_more: offset + limit < linhas.length,
  };
}
