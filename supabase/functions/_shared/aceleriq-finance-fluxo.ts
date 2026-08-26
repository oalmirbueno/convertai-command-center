/**
 * O resto da area financeira: fluxo de caixa, mensalidades, capital,
 * investimento em anuncio e o historico de alteracoes.
 *
 * O pedido do dono foi para nao esperar pedido: "tem que ter tudo, fluxo de
 * caixa, mensalidades, o que entrou e saiu, custos, investimentos, tudo
 * completo mesmo, seja proativo nisso".
 *
 * O painel financeiro tem oito abas. Duas ja estavam cobertas (visao geral e
 * projetos). Aqui entram as outras: cada uma com as MESMAS formulas da tela,
 * porque numero diferente do que o dono ve e numero que ninguem pode usar.
 *
 * Uma linha atravessa o arquivo inteiro: **aporte de socio NAO e despesa**.
 * O painel separa capital de operacao em todo lugar, e misturar os dois
 * faria o mes parecer prejuizo sempre que entrasse dinheiro proprio, ou
 * lucro quando o socio tirasse. Por isso `ehCapital` aparece em quase toda
 * conta daqui.
 *
 * Nada escreve. Nem uma linha.
 */

import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';

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

function normalizarMes(valor: unknown): string {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  if (/^\d{4}-\d{2}$/.test(bruto)) return `${bruto}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return `${bruto.slice(0, 7)}-01`;
  if (bruto) throw new Error('competence must be YYYY-MM or YYYY-MM-DD');
  const hoje = new Date();
  return `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const janelaDoMes = (competence: string) => {
  const [ano, mes] = competence.split('-').map(Number);
  return {
    inicio: competence,
    fim: mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`,
  };
};

const noPeriodo = (data: string | null, inicio: string, fim: string) =>
  Boolean(data && data >= inicio && data < fim);

/** O quanto entrou de fato, respeitando pagamento parcial. Igual a tela. */
function recebidoDe(linha: Record<string, unknown>): number {
  const total = numero(linha.amount);
  const pago = numero(linha.paid_amount);
  const situacao = texto(linha.status);
  if (situacao === 'partial') return Math.min(pago, total);
  if (situacao === 'paid') return pago > 0 && pago < total ? pago : total;
  return 0;
}

/**
 * Capital: aporte de socio e investimento com o dinheiro dele.
 *
 * Fica FORA da despesa operacional em toda conta do painel. Misturar faria
 * o mes parecer prejuizo quando entra dinheiro proprio.
 */
const ehCapital = (e: Record<string, unknown>) => {
  const c = texto(e.category) ?? '';
  return c === 'investidor' || c.startsWith('inv_');
};

/** Investimento em aquisicao: ads proprios e trafego pago. */
const ehInvestimentoEmAds = (e: Record<string, unknown>) => {
  const c = texto(e.category) ?? '';
  return c === 'marketing' || c === 'inv_trafego';
};

const ROTULO_DA_CATEGORIA: Record<string, string> = {
  salarios: 'Salários & Pró-labore',
  ferramentas: 'Ferramentas / SaaS',
  marketing: 'Marketing & Ads próprios',
  impostos: 'Impostos & Taxas',
  fornecedores: 'Fornecedores',
  infraestrutura: 'Infraestrutura / Hosting',
  comissoes: 'Comissões',
  outros: 'Outros',
  inv_trafego: 'Investimento · Tráfego pago',
  inv_ferramentas: 'Investimento · Ferramentas',
  inv_insumos: 'Investimento · Insumos',
  inv_escritorio: 'Investimento · Escritório',
  inv_outros: 'Investimento · Outros',
  investidor: 'Aporte de sócio',
};

/* ─────────────────────────── Fluxo de caixa ──────────────────────────── */

/**
 * O caixa da casa: o que entrou, o que saiu, o que sobrou e o que esta
 * reservado, mes a mes.
 *
 * `saldo_livre` e o numero que decide se da para gastar: saldo menos as
 * caixinhas de reserva. Olhar so o saldo total ja fez gente gastar a
 * reserva do imposto achando que era lucro.
 */
export async function getFinanceCashFlow(opts: { meses?: number; segmento?: string }) {
  const meses = Math.min(Math.max(Number(opts.meses) || 12, 1), 24);
  const segmento = texto(opts.segmento) ?? 'all';
  if (!['all', 'recurring', 'one_off'].includes(segmento)) {
    throw new Error("segmento must be 'all', 'recurring' or 'one_off'");
  }

  const [cobrancas, perfis, pagamentos, despesas, config] = await Promise.all([
    comPrazo(db().from('billing').select(
      'id, client_id, type, amount, paid_amount, status, due_date, paid_date, description',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('profiles').select('id, full_name, company_name, client_type, services_config').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('project_payments').select('id, client_id, installments:payment_installments(*)').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('expenses').select(
      'id, description, supplier, category, amount, status, recurrence, due_date, paid_date, brand',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('financial_settings').select('*').eq('settings_key', 'default').maybeSingle()),
  ]);
  if (cobrancas.error) throw new Error(`billing: ${cobrancas.error.message}`);

  const clientes = (perfis.data ?? []) as Array<Record<string, unknown>>;
  const tipoDoCliente = new Map(clientes.map((c) => [String(c.id), texto(c.client_type) ?? 'recurring']));
  const nomeDoCliente = new Map(
    clientes.map((c) => [String(c.id), texto(c.company_name) ?? texto(c.full_name) ?? '(sem nome)']),
  );

  // O segmento decide pelo TIPO DO CLIENTE, não pela natureza do registro:
  // é a régua da tela, e trocá-la mudaria a leitura de recorrente e avulso.
  const noSegmento = (clientId: unknown) => {
    if (segmento === 'all') return true;
    const tipo = tipoDoCliente.get(String(clientId)) ?? 'recurring';
    return segmento === 'recurring'
      ? tipo === 'recurring' || tipo === 'hybrid'
      : tipo === 'one_off' || tipo === 'hybrid';
  };

  const linhas = ((cobrancas.data ?? []) as Array<Record<string, unknown>>).filter((r) => noSegmento(r.client_id));
  const parcelas = ((pagamentos.data ?? []) as Array<Record<string, unknown>>)
    // project_payments são sempre avulsos: no recorrente não entram.
    .filter((pp) => segmento !== 'recurring')
    .flatMap((pp) => {
      const lista = (pp.installments ?? []) as Array<Record<string, unknown>>;
      return lista.map((i) => ({ linha: i, clienteId: texto(pp.client_id) }));
    });

  const gastos = (despesas.data ?? []) as Array<Record<string, unknown>>;
  const operacionais = gastos.filter((e) => !ehCapital(e));
  const capital = gastos.filter(ehCapital);
  const cfg = (config.data ?? {}) as Record<string, unknown>;

  const contaReceita = (r: Record<string, unknown>) => texto(r.type) !== 'ads_recharge';

  const recebidoTodoTempo = cents(
    linhas
      .filter((r) => contaReceita(r) && ['paid', 'partial'].includes(texto(r.status) ?? ''))
      .reduce((s, r) => s + recebidoDe(r), 0) +
    parcelas
      .filter((p) => ['paid', 'partial'].includes(texto(p.linha.status) ?? ''))
      .reduce((s, p) => s + recebidoDe(p.linha), 0),
  );
  const pagoTodoTempo = cents(
    operacionais.filter((e) => texto(e.status) === 'paid').reduce((s, e) => s + numero(e.amount), 0),
  );
  const saldo = cents(numero(cfg.opening_balance) + recebidoTodoTempo - pagoTodoTempo);

  // Caixinhas de reserva: moram no perfil do admin, em services_config.
  const reservas = clientes
    .map((c) => (c.services_config as Record<string, unknown> | null)?.finance_boxes)
    .find((b) => b && typeof b === 'object') as Record<string, unknown> | undefined;
  const reservado = cents(
    Object.values(reservas ?? {}).reduce((s: number, v) => s + numero(v), 0),
  );

  // Série: do mês mais antigo pedido até o corrente.
  const hoje = new Date();
  const serie = Array.from({ length: meses }, (_, i) => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1 - i), 1));
    const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { inicio, fim } = janelaDoMes(chave);
    const entrou = cents(
      linhas
        .filter(
          (r) =>
            contaReceita(r) &&
            ['paid', 'partial'].includes(texto(r.status) ?? '') &&
            noPeriodo(texto(r.paid_date) ?? texto(r.due_date), inicio, fim),
        )
        .reduce((s, r) => s + recebidoDe(r), 0) +
      parcelas
        .filter(
          (p) =>
            ['paid', 'partial'].includes(texto(p.linha.status) ?? '') &&
            noPeriodo(texto(p.linha.paid_date) ?? texto(p.linha.due_date), inicio, fim),
        )
        .reduce((s, p) => s + recebidoDe(p.linha), 0),
    );
    const saiu = cents(
      operacionais
        .filter((e) => texto(e.status) === 'paid' && noPeriodo(texto(e.paid_date) ?? texto(e.due_date), inicio, fim))
        .reduce((s, e) => s + numero(e.amount), 0),
    );
    const aportes = cents(
      capital
        .filter((e) => texto(e.category) === 'investidor' && noPeriodo(texto(e.paid_date) ?? texto(e.due_date), inicio, fim))
        .reduce((s, e) => s + numero(e.amount), 0),
    );
    return { mes: chave.slice(0, 7), entrou, saiu, resultado: cents(entrou - saiu), aportes_de_socio: aportes };
  });

  // Saídas por categoria, no período inteiro da série.
  const inicioSerie = `${serie[0].mes}-01`;
  const porCategoria = new Map<string, number>();
  for (const e of operacionais) {
    if (texto(e.status) !== 'paid') continue;
    const quando = texto(e.paid_date) ?? texto(e.due_date);
    if (!quando || quando < inicioSerie) continue;
    const cat = texto(e.category) ?? 'outros';
    porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + numero(e.amount));
  }

  return {
    segmento,
    meses,
    caixa: {
      base_conciliada: cents(numero(cfg.opening_balance)),
      entrou_todo_tempo: recebidoTodoTempo,
      saiu_todo_tempo: pagoTodoTempo,
      saldo_em_caixa: saldo,
      reservado_em_caixinhas: reservado,
      // O número que decide se dá para gastar.
      saldo_livre: cents(saldo - reservado),
      caixinhas: reservas ?? {},
    },
    serie_mensal: serie,
    saidas_por_categoria: [...porCategoria.entries()]
      .map(([categoria, valor]) => ({
        categoria,
        rotulo: ROTULO_DA_CATEGORIA[categoria] ?? categoria,
        valor: cents(valor),
      }))
      .sort((a, b) => b.valor - a.valor),
    a_pagar: {
      total: cents(
        operacionais.filter((e) => texto(e.status) !== 'paid').reduce((s, e) => s + numero(e.amount), 0),
      ),
      vencidas: operacionais.filter(
        (e) => texto(e.status) !== 'paid' && (texto(e.due_date) ?? '') < new Date().toISOString().slice(0, 10),
      ).length,
    },
    leitura:
      `Saldo em caixa ${saldo.toFixed(2)}, com ${reservado.toFixed(2)} reservado em caixinhas: ` +
      `sobram ${cents(saldo - reservado).toFixed(2)} livres. ` +
      `No último mês entrou ${serie[serie.length - 1].entrou.toFixed(2)} e saiu ` +
      `${serie[serie.length - 1].saiu.toFixed(2)}.`,
    nota: 'Aporte de sócio não entra como receita nem como despesa: é capital, e vem em `serie_mensal.aportes_de_socio` e na leitura de capital.',
    clientes_no_segmento: new Set(linhas.map((r) => nomeDoCliente.get(String(r.client_id)))).size,
  };
}

/* ──────────────────────────── Mensalidades ───────────────────────────── */

/**
 * A carteira recorrente: quem paga quanto, quando renova e se esta em dia.
 *
 * E a leitura que responde "de onde vem o MRR" e "quem esta devendo",
 * cliente por cliente, em vez de um total que nao aponta ninguem.
 */
export async function listFinanceMensalidades(opts: { incluir_inativos?: boolean }) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [perfis, cobrancas] = await Promise.all([
    comPrazo(db().from('profiles').select(
      'id, full_name, company_name, plan_name, plan_value, plan_status, plan_renewal_date, client_type, brand, services_config, created_at',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('billing').select(
      'client_id, type, amount, paid_amount, status, due_date, paid_date',
    ).eq('type', 'renewal').limit(READ_LIMITS.maxPageSize)),
  ]);
  if (perfis.error) throw new Error(`profiles: ${perfis.error.message}`);

  const linhas = (cobrancas.data ?? []) as Array<Record<string, unknown>>;
  const clientes = (perfis.data ?? []) as Array<Record<string, unknown>>;
  const ehInterno = (c: Record<string, unknown>) =>
    Boolean((c.services_config as Record<string, unknown> | null)?.internal_company);

  const mensalistas = clientes.filter((c) => {
    if (ehInterno(c)) return false;
    if (texto(c.client_type) === 'one_off') return false;
    if (numero(c.plan_value) <= 0) return false;
    return opts.incluir_inativos ? true : texto(c.plan_status) === 'active';
  });

  const items = mensalistas.map((c) => {
    const minhas = linhas.filter((r) => String(r.client_id) === String(c.id));
    const pagas = minhas
      .filter((r) => ['paid', 'partial'].includes(texto(r.status) ?? ''))
      .sort((a, b) => (texto(b.paid_date) ?? '').localeCompare(texto(a.paid_date) ?? ''));
    const abertas = minhas
      .filter((r) => texto(r.status) === 'pending')
      .sort((a, b) => (texto(a.due_date) ?? '').localeCompare(texto(b.due_date) ?? ''));
    const vencidas = abertas.filter((r) => (texto(r.due_date) ?? '') < hoje);

    return {
      cliente_id: texto(c.id),
      cliente: texto(c.company_name) ?? texto(c.full_name) ?? '(sem nome)',
      plano: texto(c.plan_name),
      valor_mensal: numero(c.plan_value),
      situacao_do_plano: texto(c.plan_status),
      tipo: texto(c.client_type),
      marca: texto(c.brand),
      renovacao: texto(c.plan_renewal_date),
      cliente_desde: texto(c.created_at)?.slice(0, 10) ?? null,
      ultimo_pagamento: texto(pagas[0]?.paid_date) ?? null,
      ultimo_valor_pago: pagas[0] ? recebidoDe(pagas[0]) : 0,
      proxima_cobranca: texto(abertas[0]?.due_date) ?? null,
      em_aberto: cents(abertas.reduce((s, r) => s + numero(r.amount), 0)),
      vencido: cents(vencidas.reduce((s, r) => s + numero(r.amount), 0)),
      // "Em dia" é fato, não elogio: nada vencido em aberto.
      em_dia: vencidas.length === 0,
      cobrancas_pagas: pagas.length,
      total_ja_pago: cents(pagas.reduce((s, r) => s + recebidoDe(r), 0)),
    };
  }).sort((a, b) => b.valor_mensal - a.valor_mensal);

  const ativos = items.filter((i) => i.situacao_do_plano === 'active');
  return {
    items,
    resumo: {
      mrr: cents(ativos.reduce((s, i) => s + i.valor_mensal, 0)),
      mensalistas_ativos: ativos.length,
      inadimplentes: items.filter((i) => i.vencido > 0).length,
      vencido_total: cents(items.reduce((s, i) => s + i.vencido, 0)),
      ticket_medio: ativos.length ? cents(ativos.reduce((s, i) => s + i.valor_mensal, 0) / ativos.length) : 0,
    },
    total: items.length,
  };
}

/* ────────────────────────── Capital e investimento ───────────────────── */

/**
 * O dinheiro do socio: quanto entrou de aporte, quanto virou investimento e
 * o retorno bruto desde o primeiro aporte.
 *
 * Fica separado da operacao de proposito. O retorno e TERMOMETRO, nao
 * atribuicao: compara com toda a receita recebida no periodo, e dizer o
 * contrario seria vender causalidade que o dado nao prova.
 */
export async function getFinanceCapital(opts: { desde?: string }) {
  const [despesas, cobrancas, pagamentos] = await Promise.all([
    comPrazo(db().from('expenses').select(
      'id, description, supplier, category, amount, status, due_date, paid_date, notes',
    ).limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('billing').select('type, amount, paid_amount, status, due_date, paid_date').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('project_payments').select('installments:payment_installments(*)').limit(READ_LIMITS.maxPageSize)),
  ]);
  if (despesas.error) throw new Error(`expenses: ${despesas.error.message}`);

  const gastos = (despesas.data ?? []) as Array<Record<string, unknown>>;
  const capital = gastos.filter(ehCapital);
  const aportes = capital.filter((e) => texto(e.category) === 'investidor');
  const investimentos = capital.filter((e) => (texto(e.category) ?? '').startsWith('inv_'));

  const dataDe = (e: Record<string, unknown>) => texto(e.paid_date) ?? texto(e.due_date);
  const primeiroAporte = aportes
    .map(dataDe)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;
  const corte = texto(opts.desde) ?? primeiroAporte;

  const receita = cents(
    ((cobrancas.data ?? []) as Array<Record<string, unknown>>)
      .filter(
        (r) =>
          texto(r.type) !== 'ads_recharge' &&
          ['paid', 'partial'].includes(texto(r.status) ?? '') &&
          (!corte || (texto(r.paid_date) ?? texto(r.due_date) ?? '') >= corte),
      )
      .reduce((s, r) => s + recebidoDe(r), 0) +
    ((pagamentos.data ?? []) as Array<Record<string, unknown>>)
      .flatMap((pp) => (pp.installments ?? []) as Array<Record<string, unknown>>)
      .filter(
        (i) =>
          ['paid', 'partial'].includes(texto(i.status) ?? '') &&
          (!corte || (texto(i.paid_date) ?? texto(i.due_date) ?? '') >= corte),
      )
      .reduce((s, i) => s + recebidoDe(i), 0),
  );

  const totalAportado = cents(aportes.reduce((s, e) => s + numero(e.amount), 0));
  const totalInvestido = cents(investimentos.reduce((s, e) => s + numero(e.amount), 0));

  const porCategoria = new Map<string, number>();
  for (const e of investimentos) {
    const cat = texto(e.category) ?? 'inv_outros';
    porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + numero(e.amount));
  }

  return {
    desde: corte,
    primeiro_aporte: primeiroAporte,
    resumo: {
      total_aportado: totalAportado,
      total_investido: totalInvestido,
      receita_no_periodo: receita,
      // Retorno bruto: quantas vezes a receita do período cobre o aporte.
      retorno_bruto: totalAportado > 0 ? cents(receita / totalAportado) : null,
      resultado_bruto: cents(receita - totalAportado),
    },
    aportes: aportes
      .map((e) => ({
        id: texto(e.id),
        descricao: texto(e.description),
        valor: numero(e.amount),
        data: dataDe(e),
        situacao: texto(e.status),
      }))
      .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '')),
    investimentos_por_categoria: [...porCategoria.entries()]
      .map(([categoria, valor]) => ({
        categoria,
        rotulo: ROTULO_DA_CATEGORIA[categoria] ?? categoria,
        valor: cents(valor),
      }))
      .sort((a, b) => b.valor - a.valor),
    nota: 'O retorno compara com TODA a receita recebida no período: é termômetro de aquisição, não atribuição por campanha.',
  };
}

/**
 * Investimento em anuncio contra receita: o termometro de aquisicao.
 *
 * Soma as despesas de "Marketing & Ads proprios" e "Trafego pago" e compara
 * com a receita recebida. Nao e atribuicao por campanha - dizer que e seria
 * vender uma causalidade que o dado nao tem.
 */
export async function getFinanceAdsInvestment(opts: { meses?: number }) {
  const meses = Math.min(Math.max(Number(opts.meses) || 12, 1), 24);

  const [despesas, cobrancas, pagamentos, carteiras, recargas] = await Promise.all([
    comPrazo(db().from('expenses').select('category, amount, status, due_date, paid_date, description').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('billing').select('type, amount, paid_amount, status, due_date, paid_date').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('project_payments').select('installments:payment_installments(*)').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('ads_wallet').select('client_id, platform, balance, last_recharge_date').limit(READ_LIMITS.maxPageSize)),
    comPrazo(db().from('recharge_requests').select('client_id, platform, amount, status, created_at').limit(READ_LIMITS.maxPageSize)),
  ]);
  if (despesas.error) throw new Error(`expenses: ${despesas.error.message}`);

  const ads = ((despesas.data ?? []) as Array<Record<string, unknown>>).filter(ehInvestimentoEmAds);
  const linhas = (cobrancas.data ?? []) as Array<Record<string, unknown>>;
  const parcelas = ((pagamentos.data ?? []) as Array<Record<string, unknown>>)
    .flatMap((pp) => (pp.installments ?? []) as Array<Record<string, unknown>>);

  const hoje = new Date();
  const serie = Array.from({ length: meses }, (_, i) => {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1 - i), 1));
    const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { inicio, fim } = janelaDoMes(chave);
    const investido = cents(
      ads
        .filter((e) => noPeriodo(texto(e.paid_date) ?? texto(e.due_date), inicio, fim))
        .reduce((s, e) => s + numero(e.amount), 0),
    );
    const recebido = cents(
      linhas
        .filter(
          (r) =>
            texto(r.type) !== 'ads_recharge' &&
            ['paid', 'partial'].includes(texto(r.status) ?? '') &&
            noPeriodo(texto(r.paid_date) ?? texto(r.due_date), inicio, fim),
        )
        .reduce((s, r) => s + recebidoDe(r), 0) +
      parcelas
        .filter(
          (i) =>
            ['paid', 'partial'].includes(texto(i.status) ?? '') &&
            noPeriodo(texto(i.paid_date) ?? texto(i.due_date), inicio, fim),
        )
        .reduce((s, i) => s + recebidoDe(i), 0),
    );
    return { mes: chave.slice(0, 7), investido, receita_recebida: recebido };
  });

  const totalInvestido = cents(serie.reduce((s, m) => s + m.investido, 0));
  const totalReceita = cents(serie.reduce((s, m) => s + m.receita_recebida, 0));

  return {
    meses,
    resumo: {
      investido_no_periodo: totalInvestido,
      receita_no_periodo: totalReceita,
      retorno: totalInvestido > 0 ? cents(totalReceita / totalInvestido) : null,
    },
    serie_mensal: serie,
    carteiras_de_anuncio: ((carteiras.data ?? []) as Array<Record<string, unknown>>).map((w) => ({
      cliente_id: texto(w.client_id),
      plataforma: texto(w.platform),
      saldo: numero(w.balance),
      ultima_recarga: texto(w.last_recharge_date),
    })),
    recargas_pendentes: ((recargas.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => texto(r.status) === 'pending')
      .map((r) => ({
        cliente_id: texto(r.client_id),
        plataforma: texto(r.platform),
        valor: numero(r.amount),
        pedida_em: texto(r.created_at)?.slice(0, 10) ?? null,
      })),
    nota: 'Investimento = despesas de "Marketing & Ads próprios" e "Tráfego pago". O retorno compara com toda a receita recebida: termômetro de aquisição, não atribuição por campanha. A verba do cliente (ads_wallet) é dinheiro dele, não investimento da casa.',
  };
}

/* ──────────────────────────────── Histórico ──────────────────────────── */

/**
 * Quem mexeu em pagamento, quando e o que mudou.
 *
 * Sem isto, "esse valor estava diferente ontem" nao tem resposta - e a
 * conversa vira memoria contra memoria.
 */
export async function listFinanceHistory(opts: {
  entity_type?: string;
  entity_id?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), READ_LIMITS.maxPageSize);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  if (opts.entity_id && !isUuid(opts.entity_id)) throw new Error('entity_id must be a UUID');

  let qb = db()
    .from('payment_audit_log')
    .select('id, entity_type, entity_id, action, old_status, new_status, old_amount, new_amount, notes, performed_by, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (opts.entity_type) qb = qb.eq('entity_type', String(opts.entity_type));
  if (opts.entity_id) qb = qb.eq('entity_id', opts.entity_id);

  const { data, error, count } = await comPrazo(qb.range(offset, offset + limit - 1));
  if (error) throw new Error(`payment_audit_log: ${error.message}`);

  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  const autores = [...new Set(linhas.map((l) => texto(l.performed_by)).filter(Boolean))] as string[];
  const nome = new Map<string, string>();
  if (autores.length > 0) {
    const { data: perfis } = await comPrazo(
      db().from('profiles').select('id, full_name').in('id', autores),
    );
    for (const p of (perfis ?? []) as Array<Record<string, unknown>>) {
      nome.set(String(p.id), texto(p.full_name) ?? '(sem nome)');
    }
  }

  return {
    items: linhas.map((l) => ({
      id: texto(l.id),
      quando: texto(l.created_at),
      tipo: texto(l.entity_type),
      registro_id: texto(l.entity_id),
      acao: texto(l.action),
      situacao_antes: texto(l.old_status),
      situacao_depois: texto(l.new_status),
      valor_antes: l.old_amount == null ? null : numero(l.old_amount),
      valor_depois: l.new_amount == null ? null : numero(l.new_amount),
      observacao: texto(l.notes),
      por: texto(l.performed_by) ? nome.get(String(l.performed_by)) ?? '(usuário removido)' : null,
    })),
    total: count ?? linhas.length,
    limit,
    offset,
    has_more: offset + limit < (count ?? linhas.length),
  };
}
