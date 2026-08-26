import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O Financeiro no MCP: completo para ver, incapaz de mexer.
 *
 * O pedido do dono foi exato: "mcp finanças tem que ser completo também,
 * para visualizar e não editar, para o financeiro acompanhar corretamente".
 *
 * As duas metades são igualmente importantes e puxam para lados opostos:
 * COMPLETO (o agente precisa ver o mês inteiro, senão volta a chutar) e
 * SÓ LEITURA (dinheiro se movimenta no painel, com nome em cima). Estes
 * testes seguram as duas ao mesmo tempo, porque a primeira pressiona a
 * segunda em cada evolução futura.
 */

const raiz = resolve(__dirname, "../..");
const servicos = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-finance-services.ts"), "utf8",
);
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"), "utf8",
);

describe("o financeiro enxerga o mês inteiro", () => {
  it("as cinco leituras existem e estão registradas no catálogo", () => {
    const nomes = [
      "aceleriq_get_finance_overview",
      "aceleriq_list_finance_entries",
      "aceleriq_get_finance_client_summaries",
      "aceleriq_list_finance_plans",
      "aceleriq_list_finance_recurring",
    ];
    for (const nome of nomes) expect(ferramentas).toContain(`'${nome}'`);

    // Registradas de fato: declarar a ferramenta e esquecer de listá-la em
    // RAW_TOOLS a deixaria invisível — o erro silencioso deste arquivo.
    const raw = ferramentas.slice(ferramentas.indexOf("const RAW_TOOLS"));
    for (const varivel of [
      "financeOverviewTool",
      "financeEntriesTool",
      "financeClientSummariesTool",
      "financePlansTool",
      "financeRecurringTool",
    ]) {
      expect(raw).toContain(`  ${varivel},`);
    }
  });

  it("o retrato do mês traz o que decide: aberto, vencido, recorrente e previsão", () => {
    const retrato = servicos.slice(
      servicos.indexOf("export async function getFinanceOverview"),
      servicos.indexOf("export async function listFinanceEntries"),
    );
    for (const campo of [
      "saldo_inicial", "entrou", "saiu", "liquido", "recebido", "pago",
      "a_receber", "a_pagar", "vencido_a_receber", "receita_recorrente",
      "custo_fixo", "previsao_30_dias", "previsao_60_dias", "previsao_90_dias",
      "clientes",
    ]) {
      // O campo pode sair explícito (`campo: valor`) ou abreviado (`campo,`).
      expect(retrato, `campo ${campo} ausente no retrato`)
        .toMatch(new RegExp(`\\n\\s+${campo}[,:]`));
    }
    // A frase de leitura evita o número lido fora de contexto: mês em curso
    // com líquido negativo não é prejuízo.
    expect(servicos).toContain("Ainda há ");
    expect(servicos).toContain("vencido e não recebido");
  });
});

describe("a area financeira inteira, nao so a visao geral", () => {
  const fluxo = readFileSync(
    resolve(raiz, "supabase/functions/_shared/aceleriq-finance-fluxo.ts"), "utf8",
  );

  it("as oito abas do painel tem leitura no MCP", () => {
    // O pedido: "tem que ter tudo, fluxo de caixa, mensalidades, o que
    // entrou e saiu, custos, investimentos, tudo completo mesmo".
    for (const nome of [
      "aceleriq_get_finance_dashboard",         // visao geral
      "aceleriq_get_finance_cash_flow",         // fluxo de caixa
      "aceleriq_list_finance_mensalidades",     // mensalidades
      "aceleriq_list_finance_expenses",         // custos fixos
      "aceleriq_get_finance_capital",           // capital
      "aceleriq_get_finance_ads_investment",    // ads wallet
      "aceleriq_list_finance_history",          // historico
      "aceleriq_list_finance_plans",            // planos & precos
      "aceleriq_list_finance_project_payments", // projetos
    ]) {
      expect(ferramentas, `falta ${nome}`).toContain(`'${nome}'`);
    }
  });

  it("aporte de socio NAO e despesa, em nenhuma conta", () => {
    // Misturar capital com operacao faria o mes parecer prejuizo sempre que
    // entrasse dinheiro proprio, e lucro quando o socio tirasse.
    expect(fluxo).toContain("const ehCapital");
    expect(fluxo).toContain("c === 'investidor' || c.startsWith('inv_')");
    // O fluxo de caixa separa antes de somar.
    expect(fluxo).toContain("gastos.filter((e) => !ehCapital(e))");
    expect(fluxo).toContain("aportes_de_socio");
  });

  it("o caixa entrega o SALDO LIVRE, nao so o saldo", () => {
    // Olhar so o saldo total ja fez gente gastar a reserva do imposto
    // achando que era lucro.
    expect(fluxo).toContain("saldo_livre");
    expect(fluxo).toContain("reservado_em_caixinhas");
    expect(fluxo).toContain("finance_boxes");
  });

  it("as mensalidades apontam o NOME, nao um total anonimo", () => {
    expect(fluxo).toContain("inadimplentes");
    expect(fluxo).toContain("em_dia");
    expect(fluxo).toContain("proxima_cobranca");
    expect(fluxo).toContain("ticket_medio");
    // "Em dia" e fato: nada vencido em aberto.
    expect(fluxo).toContain("em_dia: vencidas.length === 0");
  });

  it("o retorno de ads se declara termometro, nao atribuicao", () => {
    // Vender causalidade que o dado nao prova e o jeito mais facil de o
    // agente mentir com numero certo.
    expect(fluxo).toContain("termômetro de aquisição, não atribuição");
    expect(fluxo).toContain("verba do cliente");
  });

  it("o historico diz quem mexeu, quando e o que mudou", () => {
    expect(fluxo).toContain("payment_audit_log");
    expect(fluxo).toContain("valor_antes");
    expect(fluxo).toContain("valor_depois");
  });

  it("tudo isso continua sendo somente leitura", () => {
    expect(fluxo).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("o painel financeiro inteiro, mes a mes", () => {
  const painel = readFileSync(
    resolve(raiz, "supabase/functions/_shared/aceleriq-finance-dashboard.ts"), "utf8",
  );

  it("RECEBIDO soma planos MAIS parcelas de projeto", () => {
    // O print do dono: "RECEBIDO R$ 5.204,00 · Planos R$ 4.507,00 ·
    // Projetos R$ 697,00". A primeira versao lia so a cobranca e devolvia
    // 4.507 onde a tela mostra 5.204. Numero quase certo passa por verdade.
    expect(painel).toContain("recebidoPlanos + recebidoProjetos");
    expect(painel).toContain("recebido_planos");
    expect(painel).toContain("recebido_projetos");
    expect(painel).toContain("payment_installments");
  });

  it("o saldo em caixa usa a formula do Fluxo de Caixa", () => {
    // base conciliada + tudo que entrou (cobrancas + parcelas) − tudo que
    // saiu, fora despesa de investidor. Conferido: -14.853,36 + 22.863,00
    // − 1.465,00 = 6.544,64, o mesmo do print.
    expect(painel).toContain("opening_balance");
    expect(painel).toContain("recebidoTodoTempo - pagoTodoTempo");
    expect(painel).toContain("ehDespesaDeInvestidor");
  });

  it("a divisao automatica segue a escada do Plano Diretor", () => {
    // 5.204,00 bruto → 312,24 de imposto (6%) → 4.891,76 operacional →
    // 1.468,00 de pro-labore proporcional → 1.563,76 de reserva → 0,00 de
    // lucro. Cada linha do print sai destas contas.
    expect(painel).toContain("const ALIQUOTA_PADRAO = 0.06");
    expect(painel).toContain("function proLaboreProporcional");
    expect(painel).toContain("bruto - reservaTributaria");
    expect(painel).toContain("receitaOperacional - custosFixos - proLabore");
    expect(painel).toContain("Math.min(Math.max(depoisDaEstrutura, 0), alvoReservaClientes)");
    // Ponto de equilibrio: fixos + pro-labore OFICIAL, e o bruto pela aliquota.
    expect(painel).toContain("custosFixos + proLaboreOficial");
    expect(painel).toContain("equilibrioOperacional / (1 - ALIQUOTA_PADRAO)");
  });

  it("a aliquota vem do plano de cada cliente, com 6% de reserva", () => {
    // Cliente com plano de aliquota propria nao pode ser tributado pela
    // taxa ilustrativa: o imposto reservado sairia errado no mes inteiro.
    expect(painel).toContain("aliquotaDoCliente.get(it.clienteId)) ?? ALIQUOTA_PADRAO");
  });

  it("o pro-labore de despesa nao e descontado duas vezes", () => {
    expect(painel).toContain("ehProLabore");
    expect(painel).toContain("=== 'monthly' && !ehProLabore(e)");
  });

  it("entrega a serie do ano, a marca e os projetos - nao so o mes", () => {
    // "preciso de acesso a outros meses e de forma completa".
    expect(painel).toContain("serie_do_ano");
    expect(painel).toContain("receita_por_marca");
    expect(painel).toContain("projetos_individuais");
    expect(painel).toContain("ads_wallet");
    expect(painel).toContain("pendentes");
    expect(painel).toContain("recebidos");
    // E as tres ferramentas novas existem no catalogo.
    for (const nome of [
      "aceleriq_get_finance_dashboard",
      "aceleriq_list_finance_expenses",
      "aceleriq_list_finance_project_payments",
    ]) {
      expect(ferramentas).toContain(`'${nome}'`);
    }
  });

  it("continua sendo so leitura, inclusive no painel completo", () => {
    expect(painel).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("o agente vê o MESMO que o dono vê na tela", () => {
  it("lê a cobrança real (billing), não só o módulo v2 vazio", () => {
    // O relato: "ele puxou tudo zerado, diferente do que aparece pra mim".
    // O módulo v2 tinha 2 lançamentos; a cobrança da casa tinha 34. Ler só
    // o v2 fazia o agente responder "não há caixa" com dinheiro no banco.
    expect(ferramentas).toContain("'aceleriq_get_finance_billing'");
    expect(servicos).toContain("from('billing')");
    expect(servicos).toContain("export async function getFinanceBilling");
  });

  it("aplica as MESMAS réguas da tela /financeiro", () => {
    // Cada uma existe porque a tela faz assim. Régua "melhor" aqui daria um
    // número que o dono nunca viu.
    // 1. Pagamento parcial vale o que entrou, não o que foi cobrado.
    expect(servicos).toContain("if (situacao === 'partial') return Math.min(pago, total)");
    // 2. Recarga de anúncio não é receita da casa.
    expect(servicos).toContain("texto(r.type) !== 'ads_recharge'");
    // 3. Recorrência de cliente parado/interno fica fora dos totais.
    expect(servicos).toContain("situacao === 'standby' || situacao === 'inactive'");
    expect(servicos).toContain("internal_company");
    // 4. Recebido do mês pela data de pagamento, com o vencimento de reserva.
    expect(servicos).toContain("texto(r.paid_date) ?? texto(r.due_date)");
    // 5. Parcial conta como pago nos totais recebidos.
    expect(servicos).toContain("['paid', 'partial'].includes");
  });

  it("as duas fontes andam lado a lado e NUNCA somadas", () => {
    // Somar v2 com cobrança criaria receita fantasma se um valor existir
    // dos dois lados. O agente recebe as duas e a indicação de qual usar.
    expect(servicos).toContain("use_estes_numeros");
    expect(servicos).toContain("moduloVazio");
    expect(servicos).toContain("Não afirme que não há caixa");
    // A soma proibida não pode aparecer disfarçada de conveniência.
    expect(servicos).not.toMatch(/entrou \+ cobranca|cobranca\.resumo\.recebido_no_mes \+ /);
  });
});

describe("os números vêm da mesma fonte da tela do dono", () => {
  it("usa as RPCs oficiais do Financeiro, sem recalcular por fora", () => {
    expect(servicos).toContain("'financial_overview_v2'");
    expect(servicos).toContain("'financial_cash_flow_v2'");
    expect(servicos).toContain("'financial_client_summaries_v2'");
  });

  it("a competência é normalizada para o primeiro dia do mês", () => {
    // Sem isso, "2026-08-14" e "2026-08-01" dariam respostas diferentes para
    // a mesma pergunta — e o dono veria dois faturamentos de agosto.
    expect(servicos).toContain("export function normalizarCompetencia");
    expect(servicos).toContain("bruto.slice(0, 7)");
  });

  it("a recorrência usa income/expense, e não o in/out dos lançamentos", () => {
    // Trocar os dois vocabulários inverteria receita e custo no resumo.
    const trecho = servicos.slice(servicos.indexOf("listFinanceRecurringRules"));
    expect(trecho).toContain("texto(r.direction) === 'income'");
    expect(trecho).toContain("texto(r.direction) === 'expense'");
  });

  it("o filtro por cliente não perde as baixas do lançamento dele", () => {
    // A linha de baixa não carrega client_id: filtrar só pelo campo faria o
    // cliente que pagou parecer que não pagou.
    const trecho = servicos.slice(servicos.indexOf("export async function listFinanceEntries"));
    expect(trecho).toContain("idsDoCliente.has(l.entry_id)");
  });
});

describe("visualizar, nunca editar", () => {
  it("nenhuma escrita mora na camada financeira do MCP", () => {
    // As RPCs que movimentam dinheiro não podem ser alcançáveis por aqui.
    for (const proibida of [
      "financial_record_settlement",
      "financial_reverse_settlement",
      "financial_generate_competence",
      "financial_upsert_plan",
      "financial_archive_plan",
      "financial_upsert_recurring_rule",
      "financial_archive_recurring_rule",
      "financial_assign_client_plan",
      "financial_update_settings",
      "financial_create_plan_version",
    ]) {
      expect(servicos).not.toContain(proibida);
    }
    // E nenhum verbo de escrita direto em tabela.
    expect(servicos).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("as ferramentas se declaram somente leitura", () => {
    const trecho = ferramentas.slice(
      ferramentas.indexOf("// ─── Financeiro (somente leitura)"),
      ferramentas.indexOf("const RAW_TOOLS"),
    );
    expect(trecho).toBeTruthy();
    // A promessa aparece na descrição que o agente lê.
    expect(trecho.match(/SOMENTE LEITURA/g)?.length).toBeGreaterThanOrEqual(5);
    // E a marcação de comportamento é a de leitura.
    expect(ferramentas).toContain("scopes: FINANCE");
    expect(ferramentas).toContain("annotations: READ_ANNOTATIONS");
  });
});

describe("dinheiro é consentimento à parte", () => {
  it("exige aceleriq:finance — leitura geral NÃO abre o financeiro", () => {
    expect(ferramentas).toContain("const FINANCE: readonly ToolScope[] = ['aceleriq:finance'];");

    // A prova real: aceleriq:read não expande para finance. Se alguém
    // adicionar finance nessa lista, todo leitor passa a ver o caixa.
    const expansoes = ferramentas.slice(
      ferramentas.indexOf("export const SCOPE_EXPANSIONS"),
      ferramentas.indexOf("export function expandScopes"),
    );
    expect(expansoes).toContain("'aceleriq:read'");
    expect(expansoes).not.toContain("aceleriq:finance");
  });

  it("o escopo é CONCEDÍVEL: sem estar na lista de staff, era porta pintada", () => {
    // O relato: "não mostra nada do financeiro, o Hermes não enxerga, nem o
    // GPT, nem o Claude". O escopo era anunciado na descoberta, aparecia na
    // tela de permissão e tinha ferramentas no catálogo — e o filtro final
    // de concessão OAuth o descartava em silêncio, porque ninguém o havia
    // colocado na lista. Anunciar sem poder conceder é o pior dos mundos.
    const seguranca = readFileSync(
      resolve(raiz, "supabase/functions/_shared/mcp-security.ts"), "utf8",
    );
    const lista = seguranca.slice(
      seguranca.indexOf("export const OAUTH_STAFF_SCOPES"),
      seguranca.indexOf("] as const", seguranca.indexOf("export const OAUTH_STAFF_SCOPES")),
    );
    expect(lista).toContain("'aceleriq:finance'");
  });

  it("chave restrita a cliente não alcança o financeiro da casa", () => {
    // O despachante nega por padrão quem não é irrestrito; só as ferramentas
    // da lista tenant-scoped passam. Nenhuma financeira pode entrar lá.
    const seguranca = readFileSync(
      resolve(raiz, "supabase/functions/_shared/mcp-security.ts"), "utf8",
    );
    const lista = seguranca.slice(
      seguranca.indexOf("export const CLIENT_SCOPED_LEGACY_TOOLS"),
      seguranca.indexOf("const CLIENT_SCOPED_LEGACY_TOOL_SET"),
    );
    expect(lista).not.toContain("finance");
  });

  it("o escopo do financeiro segue marcado como sensível na tela de permissão", () => {
    expect(ferramentas).toContain("'aceleriq:finance': { title: 'Financeiro'");
    const linha = ferramentas.slice(ferramentas.indexOf("'aceleriq:finance': { title: 'Financeiro'"));
    expect(linha.slice(0, 200)).toContain("sensitive: true");
  });
});

describe("a versão anda junto nos dois lugares", () => {
  it("servidor e descoberta declaram a mesma versão, e ela subiu", () => {
    const metadata = readFileSync(
      resolve(raiz, "supabase/functions/mcp-oauth-metadata/index.ts"), "utf8",
    );
    const noServidor = ferramentas.match(/version: '(\d+\.\d+\.\d+)'/)?.[1];
    const naDescoberta = metadata.match(/MCP_VERSION = '(\d+\.\d+\.\d+)'/)?.[1];

    expect(noServidor).toBeTruthy();
    expect(noServidor).toBe(naDescoberta);

    // Piso, nao pino: 1.22.0 trouxe o financeiro; versoes futuras nao quebram.
    const [maior, menor] = String(noServidor).split(".").map(Number);
    expect(maior > 1 || (maior === 1 && menor >= 22)).toBe(true);
  });
});
