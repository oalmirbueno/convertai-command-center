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
