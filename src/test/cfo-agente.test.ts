import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIQUOTA_PADRAO,
  AVULSO_DE_ENTRADA,
  ESCADA_DO_PRO_LABORE,
  PLANO_DE_ENTRADA,
  avaliarGasto,
  intencaoPorPalavras,
  proLaboreDaEscada,
  reais,
  respostaDoCFO,
  retratoDoCFO,
  valoresNoTexto,
  type DadosDoCFO,
} from "../../supabase/functions/agente-cfo/modulos/cfo-calculos";
import { caixinhasDe, montarDadosDoCFO } from "../../supabase/functions/agente-cfo/modulos/cfo-dados";
import { descricaoDoGasto, lerRota, perguntasDaRota } from "../../supabase/functions/agente-cfo/modulos/cfo-rota";
import { conferirTrava, propostaDaIntencao, propostaDeCortes, propostaDoPlano } from "../../supabase/functions/agente-cfo/modulos/cfo-acoes";
import { numerosForaDaConta, valoresEmReais } from "../../supabase/functions/agente-cfo/modulos/cfo-conferencia";
import { DEFAULT_TAX_RATE, DIRECTOR_PLAN_CATALOG, interpolateProLabore, ONE_OFF_CATALOG, PRO_LABORE_LADDER } from "@/lib/directorPlan";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

/**
 * Frente CFO (30/09): o motor do CFO é código determinístico. Fixture
 * sintética (nada de dado real no repositório): uma agência com 3
 * mensalistas, estrutura maior que a carteira e um cliente atrasado.
 */
function agencia(extra: Partial<DadosDoCFO> = {}): DadosDoCFO {
  return {
    hoje: "2026-09-15",
    cobrancas: [
      { id: "b1", client_id: "c1", type: "renewal", amount: 1000, paid_amount: 1000, status: "paid", due_date: "2026-09-05", paid_date: "2026-09-05" },
      { id: "b2", client_id: "c2", type: "renewal", amount: 800, paid_amount: null, status: "pending", due_date: "2026-09-01", paid_date: null },
      // Pago antes do vencimento de outubro: já está no caixa, não entra na projeção de outubro.
      { id: "b3", client_id: "c3", type: "renewal", amount: 600, paid_amount: 600, status: "paid", due_date: "2026-10-10", paid_date: "2026-09-10" },
      { id: "b4", client_id: "c1", type: "renewal", amount: 1000, paid_amount: null, status: "pending", due_date: "2026-10-05", paid_date: null },
      { id: "b5", client_id: "c9", type: "renewal", amount: 300, paid_amount: 100, status: "partial", due_date: "2026-08-01", paid_date: "2026-08-02" },
      { id: "b6", client_id: "c1", type: "ads_recharge", amount: 5000, paid_amount: 5000, status: "paid", due_date: "2026-09-02", paid_date: "2026-09-02" },
    ],
    parcelas: [
      { id: "p1", client_id: "c2", amount: 900, paid_amount: null, status: "pending", due_date: "2026-11-20", paid_date: null },
    ],
    despesas: [
      { id: "d1", description: "Chat GPT pro", category: "infraestrutura", amount: 1000, status: "pending", due_date: "2026-09-28", paid_date: null, recurrence: "monthly" },
      { id: "d2", description: "Claude Max", category: "infraestrutura", amount: 900, status: "pending", due_date: "2026-09-25", paid_date: null, recurrence: "monthly" },
      { id: "d3", description: "Heygen", category: "ferramentas", amount: 150, status: "pending", due_date: "2026-09-20", paid_date: null, recurrence: "monthly" },
      { id: "d4", description: "Contabilidade", category: "impostos", amount: 300, status: "pending", due_date: "2026-10-01", paid_date: null, recurrence: "monthly" },
      { id: "d5", description: "Pró-labore Almir", category: "salarios", amount: 1500, status: "pending", due_date: "2026-09-30", paid_date: null, recurrence: "monthly" },
      { id: "d6", description: "Domínio", category: "infraestrutura", amount: 120, status: "pending", due_date: "2027-02-10", paid_date: null, recurrence: "yearly" },
      { id: "d7", description: "Combustível", category: "outros", amount: 400, status: "paid", due_date: "2026-09-03", paid_date: "2026-09-03", recurrence: "none" },
      { id: "d8", description: "Adiantamento pró-labore", category: "salarios", amount: 100, status: "paid", due_date: "2026-09-08", paid_date: "2026-09-08", recurrence: "none" },
      // Capital do sócio: fora da despesa e da trava.
      { id: "d9", description: "Equipamento", category: "inv_insumos", amount: 2000, status: "paid", due_date: "2026-09-04", paid_date: "2026-09-04", recurrence: "none" },
      { id: "d10", description: "Eleven Labs", category: "ferramentas", amount: 30, status: "pending", due_date: "2026-08-31", paid_date: null, recurrence: "monthly" },
    ],
    clientes: [
      { id: "c1", nome: "Alfa", plan_name: "Pro", plan_value: 1000, plan_status: "active", client_type: "recurring", interno: false },
      { id: "c2", nome: "Beta", plan_name: "Pro", plan_value: 800, plan_status: "active", client_type: "recurring", interno: false },
      { id: "c3", nome: "Gama", plan_name: "Start", plan_value: 600, plan_status: "active", client_type: "hybrid", interno: false },
      { id: "c8", nome: "Casa", plan_name: null, plan_value: 9999, plan_status: "active", client_type: "recurring", interno: true },
      { id: "c9", nome: "Delta", plan_name: "Pro", plan_value: 300, plan_status: "standby", client_type: "recurring", interno: false },
    ],
    config: { saldoInicial: 2000, metaMensal: 5000, proLaboreAtual: 1500, proLaboreAlvo: 10000, reservaAlvo: 0 },
    caixinhas: { tax: 50, clients: 0, safety: 0 },
    metas: [],
    travas: [],
    ...extra,
  };
}

describe("CFO: o motor em código", () => {
  const r = retratoDoCFO(agencia());

  it("caixa: base + recebido (parcial e sem recarga de ads) - pago, sem capital", () => {
    // recebido: 1000 + 600 + 100 (parcial) = 1700; ads_recharge fora. pago: 400 + 100; capital fora.
    expect(r.caixa.recebidoTotal).toBe(1700);
    expect(r.caixa.pagoTotal).toBe(500);
    expect(r.caixa.saldo).toBe(3200);
    expect(r.caixa.saldoLivre).toBe(3150);
  });

  it("carteira: só mensalistas ativos fora da casa; estrutura com anual / 12 e pró-labore separado", () => {
    expect(r.carteira.mrr).toBe(2400);
    expect(r.carteira.clientesAtivos).toBe(3);
    expect(r.estrutura.proLabore).toBe(1500);
    expect(r.estrutura.custoFixo).toBe(1000 + 900 + 150 + 300 + 10 + 30);
    expect(r.margem.mensal).toBeLessThan(0);
    expect(r.carteira.pausados.map((p) => p.nome)).toEqual(["Delta"]);
  });

  it("atrasados: a receber (com o resto do parcial) e contas vencidas", () => {
    expect(r.atrasados.receber.map((x) => [x.cliente, x.valor])).toEqual([["Beta", 800], ["Delta", 200]]);
    expect(r.atrasados.pagar.map((x) => x.descricao)).toEqual(["Eleven Labs"]);
  });

  it("projeção: renovação paga antes não entra de novo; recorrente pelo plano depois", () => {
    const outubro = r.projecao[1];
    expect(outubro.mes).toBe("2026-10");
    // Alfa: cobrança lançada 1000; Beta: plano 800; Gama: já pagou em setembro (0).
    expect(outubro.entradasRecorrentes).toBe(1800);
    expect(r.projecao[2].entradasPontuais).toBe(900);
    expect(r.projecao[2].entradasRecorrentes).toBe(2400);
    // Anual só no mês dele.
    const fev = r.projecao.find((p) => p.mes === "2027-02")!;
    const mar = r.projecao.find((p) => p.mes === "2027-03")!;
    expect(fev.saidasFixas - mar.saidasFixas).toBe(120);
    expect(r.projecao.length).toBe(12);
  });

  it("limite: com a estrutura maior que a carteira o limite zera e explica por quê", () => {
    expect(r.limite.valor).toBe(0);
    expect(r.limite.motivo).toMatch(/abaixo do piso/);
    expect(r.naoGastar.join(" ")).toMatch(/Nenhuma assinatura ou custo fixo novo/);
  });

  it("aponta os erros do dono com números", () => {
    const chaves = r.alertas.map((a) => a.chave);
    expect(chaves).toEqual(expect.arrayContaining(["estrutura_maior_que_receita", "atrasados_a_receber", "contas_vencidas", "precos_abaixo_da_tabela", "sem_reserva", "adiantamento_de_pro_labore", "assinaturas_de_ia"]));
    expect(r.alertas[0].nivel).toBe("critico");
    expect(r.saude.rotulo).not.toBe("saudável");
  });

  it("cortes: essencial fica no fim e não entra na proposta", () => {
    expect(r.cortes[0].descricao).toBe("Chat GPT pro");
    expect(r.cortes.filter((c) => c.essencial).map((c) => c.descricao)).toEqual(expect.arrayContaining(["Contabilidade", "Domínio"]));
    const p = propostaDeCortes(r)!;
    expect(p.itens.map((i) => i.titulo)).toEqual(["Chat GPT pro", "Claude Max", "Heygen"]);
    expect(p.itens.every((i) => i.operacao === "cortar_custo")).toBe(true);
  });

  it("plano: metas em ordem e o que já foi guardado não volta", () => {
    expect(r.plano.map((m) => m.chave)).toEqual(["equilibrio", "reserva", "meta_mensal", "pro_labore"]);
    expect(r.plano[0].falta).toBeGreaterThan(0);
    const comMeta = retratoDoCFO(agencia({ metas: [{ id: "m1", titulo: "Equilíbrio", tipo: "equilibrio", valor_alvo: 4000 }] }));
    const p = propostaDoPlano(comMeta)!;
    expect(p.itens.map((i) => i.alvo_id)).not.toContain("meta-equilibrio");
    expect(comMeta.metas[0].atual).toBe(comMeta.carteira.mrrOperacional);
  });

  it("dá limite quando a carteira paga a estrutura", () => {
    const folgada = retratoDoCFO(agencia({ config: { saldoInicial: 30000, metaMensal: null, proLaboreAtual: null, proLaboreAlvo: null, reservaAlvo: null } }));
    expect(folgada.limite.valor).toBeGreaterThan(0);
    const a = avaliarGasto(folgada, { valor: 100 });
    expect(a.nivel).toBe("livre");
  });
});

describe("CFO: a trava", () => {
  const r = retratoDoCFO(agencia());

  it("gasto acima do limite fica bloqueado; capital do sócio fica fora", () => {
    const a = avaliarGasto(r, { valor: 1500 });
    expect(a.nivel).toBe("bloqueado");
    expect(a.excesso).toBe(1500);
    expect(avaliarGasto(r, { valor: 1500, categoria: "inv_ferramentas" }).foraDaTrava).toBe(true);
  });

  it("o lançamento proposto pede confirmação explícita e o Confirmar confere de novo", () => {
    const { acao, avaliacao } = propostaDaIntencao(r, "posso_gastar", { valor: 1500, recorrente: false, descricao: "Curso de edição", metaAnterior: null });
    expect(avaliacao?.nivel).toBe("bloqueado");
    expect((acao!.contexto as Record<string, unknown>).exige_confirmacao_explicita).toBe(true);
    expect(acao!.itens[0].operacao).toBe("lancar_despesa");
    expect(conferirTrava(acao!, r, false).pode).toBe(false);
    expect(conferirTrava(acao!, r, true).pode).toBe(true);
    // Com o caixa folgado na hora do Confirmar, passa sem o "entendi".
    const folgada = retratoDoCFO(agencia({ config: { saldoInicial: 40000, metaMensal: null, proLaboreAtual: null, proLaboreAlvo: null, reservaAlvo: null } }));
    expect(conferirTrava(acao!, folgada, false).pode).toBe(true);
  });

  it("a resposta diz não com o número e sem travessão", () => {
    const t = respostaDoCFO(r, "posso_gastar", { avaliacao: avaliarGasto(r, { valor: 1500 }) });
    expect(t.startsWith("Não.")).toBe(true);
    expect(t).toContain(reais(r.limiteQueVale.valor));
    for (const i of ["saude", "projecao", "onde_cortar", "plano", "erros", "este_mes"] as const) expect(respostaDoCFO(r, i)).not.toMatch(/[—–]/);
  });
});

describe("CFO: entende a pergunta (Jev com reserva)", () => {
  it("acha valores no texto e ignora número que não é dinheiro", () => {
    expect(valoresNoTexto("posso gastar R$ 1.500,50 num curso de 3 meses?").map((v) => v.valor)).toEqual([1500.5]);
    expect(valoresNoTexto("uma assinatura de 2 mil por mês").map((v) => v.valor)).toEqual([2000]);
  });

  it("com mais de um valor, o Jev escolhe entre os trechos (não escreve o número)", () => {
    const pedido = "Tenho 3.000 em caixa, posso gastar 800 reais num notebook?";
    const { questions, candidatos } = perguntasDaRota(pedido);
    expect(Object.keys(questions)).toEqual(["intencao", "recorrente", "valor"]);
    expect(candidatos.map((c) => c.valor)).toEqual([3000, 800]);
    const rota = lerRota(pedido, { intencao: { choice: "posso_gastar", confidence: 0.9 }, valor: { choice: "v1" }, recorrente: { noul: 0.1 } });
    expect(rota).toMatchObject({ intencao: "posso_gastar", valor: 800, recorrente: false, fonte: "jev" });
  });

  it("sem Jev, as palavras decidem", () => {
    expect(lerRota("onde eu corto custo?", null).intencao).toBe("onde_cortar");
    expect(intencaoPorPalavras("faça a projeção dos próximos meses")).toBe("projecao");
    expect(lerRota("posso pagar 120 por mês numa ferramenta?", null)).toMatchObject({ intencao: "posso_gastar", valor: 120, recorrente: true, fonte: "regra" });
    expect(descricaoDoGasto("posso gastar 1.500 num curso de edição?")).toBe("Curso de edição");
  });
});

describe("CFO: a IA explica, não calcula", () => {
  it("valor que não está na conta é apontado", () => {
    expect(valoresEmReais("Caixa de R$ 3.150,00 e sobra de -R$ 340,00")).toEqual([3150, 340]);
    expect(numerosForaDaConta("Você tem R$ 3.150,00 livres.", "Caixa livre R$ 3.150,00.", {})).toEqual([]);
    expect(numerosForaDaConta("Você tem R$ 9.999,00 livres.", "Caixa livre R$ 3.150,00.", { caixa: 3150 })).toEqual(["9999.00"]);
  });
});

describe("CFO: os parâmetros da casa batem com o Plano Diretor", () => {
  it("plano de entrada, avulso, escada e alíquota", () => {
    expect(PLANO_DE_ENTRADA.preco).toBe(DIRECTOR_PLAN_CATALOG[0].launchPrice);
    expect(PLANO_DE_ENTRADA.nome).toBe(DIRECTOR_PLAN_CATALOG[0].name);
    expect(AVULSO_DE_ENTRADA).toEqual({ nome: ONE_OFF_CATALOG[0].name, preco: ONE_OFF_CATALOG[0].launchPrice });
    expect(ESCADA_DO_PRO_LABORE).toEqual(PRO_LABORE_LADDER);
    expect(ALIQUOTA_PADRAO).toBe(DEFAULT_TAX_RATE);
    for (const v of [0, 4000, 5720, 10000, 12500, 47000, 2_000_000]) expect(proLaboreDaEscada(v)).toBe(interpolateProLabore(v));
  });
});

describe("CFO: das linhas do banco para o motor", () => {
  it("monta clientes, parcelas e caixinhas", () => {
    const d = montarDadosDoCFO({
      hoje: "2026-09-30",
      cobrancas: [{ id: "x", client_id: "c", type: "renewal", amount: "500.00", paid_amount: null, status: "pending", due_date: "2026-10-01", paid_date: null }],
      pagamentos: [{ id: "pp", client_id: "c", project: { name: "Site" }, installments: [{ id: "i", amount: 300, status: "pending", due_date: "2026-10-10" }] }],
      despesas: [],
      clientes: [{ id: "c", company_name: "Cliente", plan_value: 500, plan_status: "active", client_type: "recurring", services_config: { internal_company: true } }],
      config: { opening_balance: -10, monthly_goal: 7500 },
      caixinhas: caixinhasDe({ finance_boxes: { tax: "40.5" } }),
    });
    expect(d.parcelas[0]).toMatchObject({ client_id: "c", projeto: "Site", amount: 300 });
    expect(d.clientes[0].interno).toBe(true);
    expect(d.config).toMatchObject({ saldoInicial: -10, metaMensal: 7500 });
    expect(d.caixinhas).toEqual({ tax: 40.5, clients: 0, safety: 0 });
  });
});

describe("CFO: contratos do código", () => {
  it("migration: RLS só admin, sem DELETE pela API e na faixa da frente", () => {
    const sql = ler("supabase/migrations/20260930314000_cfo_agente.sql");
    for (const t of ["cfo_mensagens", "cfo_metas", "cfo_eventos"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toMatch(new RegExp(`REVOKE[^;]*DELETE[^;]*ON public\\.${t}`));
    }
    expect(sql.match(/has_role\(\(select auth\.uid\(\)\), 'admin'::public\.app_role\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/can_access_client\s*\(/);
  });

  it("função publicável, só admin, e registrada na tela", () => {
    expect(ler("supabase/config.toml")).toContain("[functions.agente-cfo]\n    verify_jwt = true");
    const fn = ler("supabase/functions/agente-cfo/index.ts");
    expect(fn).toContain('_role: "admin"');
    expect(fn).toContain("conferirTrava");
    // Nada de chamar outra função (cobrança, e-mail): o CFO só lê o financeiro e grava o que o dono confirma.
    expect(fn).not.toContain("functions.invoke");
    expect(fn).not.toMatch(/from\("billing"\)\.(insert|update|delete)/);
    expect(ler("src/lib/mesa/api.ts")).toContain('"agente-cfo"');
  });

  it("CFO no Assist, rota própria e a trava nas despesas novas", () => {
    expect(ler("src/lib/lancador.ts")).toContain('{ chave: "cfo", rotulo: "CFO (financeiro)" }');
    const assist = ler("src/components/admin/VoiceAssistant.tsx");
    expect(assist).toContain("modoCfo ?");
    expect(assist).toContain("<ConversaDoCFO");
    expect(ler("src/App.tsx")).toContain('path="/financeiro/cfo"');
    expect(ler("src/pages/AdminFinanceiro.tsx")).toContain('{ valor: "cfo", rotulo: "CFO"');
    expect(ler("src/components/finance/CashFlow.tsx")).toContain("await pedirLiberacao(");
    expect(ler("src/components/finance/FixedCosts.tsx")).toContain("await pedirLiberacao(");
  });
});

describe("CFO: criar, editar e simular são coisas diferentes (lote B, 09/10)", () => {
  const r = retratoDoCFO(agencia());

  it("'crie uma meta de teste' cria meta nova e nunca troca a meta mensal", () => {
    const pedido = "Crie uma meta de teste chamada 'Teste lote B' de economizar R$ 100 em outubro, para eu revisar.";
    expect(intencaoPorPalavras(pedido)).toBe("nova_meta");
    const { acao } = propostaDaIntencao(r, "nova_meta", { valor: 100, recorrente: false, descricao: pedido, metaAnterior: 8000, pedido });
    expect(acao!.itens.map((i) => i.operacao)).toEqual(["criar_meta"]);
    expect(acao!.itens[0].titulo).toBe("Teste lote B");
    expect(JSON.stringify(acao)).not.toContain("definir_meta_mensal");
  });

  it("mesmo classificada como 'meta', sem falar da meta mensal não vira cartão de substituição", () => {
    const pedido = "Crie uma meta de teste de R$ 100.";
    const { acao } = propostaDaIntencao(r, "meta", { valor: 100, recorrente: false, descricao: pedido, metaAnterior: 8000, pedido });
    expect(acao).toBeNull();
  });

  it("mudar a meta mensal, dita com todas as letras, continua sendo edição (com Confirmar)", () => {
    const pedido = "Mude a meta mensal de receita para R$ 12.000.";
    expect(intencaoPorPalavras(pedido)).toBe("meta");
    const { acao } = propostaDaIntencao(r, "meta", { valor: 12000, recorrente: false, descricao: pedido, metaAnterior: 8000, pedido });
    expect(acao!.itens.map((i) => i.operacao)).toEqual(["definir_meta_mensal"]);
  });

  it("simular avalia o gasto sem cartão (nada é gravado)", () => {
    const pedido = "E se eu contratar um editor de R$ 1.500 por mês? Só simula.";
    expect(intencaoPorPalavras(pedido)).toBe("simular");
    const { acao, avaliacao } = propostaDaIntencao(r, "simular", { valor: 1500, recorrente: true, descricao: pedido, metaAnterior: 8000, pedido });
    expect(acao).toBeNull();
    expect(avaliacao).not.toBeNull();
  });
});
