import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIQUOTA_MAXIMA, ALIQUOTA_MINIMA, aliquotaDaCompetencia, competenciaDe,
  custoMensal, diasAteVencer, limitarAliquota, proximoVencimento, reservaTributaria,
} from "@/lib/tributos";

/**
 * A alíquota por mês e o pagamento do custo fixo.
 *
 * As duas regras que não podem voltar atrás:
 *  - alíquota é por competência, e mês sem registro se declara presumido;
 *  - pagar rola o vencimento a partir do VENCIMENTO, não do pagamento.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

describe("a alíquota fica dentro da faixa", () => {
  it("6% é o piso e 9% é o teto", () => {
    expect(limitarAliquota(0.02)).toBe(ALIQUOTA_MINIMA);
    expect(limitarAliquota(0.5)).toBe(ALIQUOTA_MAXIMA);
    expect(limitarAliquota(0.075)).toBe(0.075);
  });

  it("valor absurdo cai no piso em vez de reservar o caixa inteiro", () => {
    expect(limitarAliquota(Number.NaN)).toBe(ALIQUOTA_MINIMA);
    expect(limitarAliquota(0.9)).toBe(ALIQUOTA_MAXIMA);
  });
});

describe("cada competência guarda a sua alíquota", () => {
  const registros = [
    { competencia: "2026-01-01", rate: 0.06 },
    { competencia: "2026-08-01", rate: 0.08 },
  ];

  it("mês registrado devolve o número confirmado", () => {
    const r = aliquotaDaCompetencia("2026-08-01", registros);
    expect(r.rate).toBe(0.08);
    expect(r.presumida).toBe(false);
  });

  it("janeiro continua a 6% mesmo com agosto a 8%", () => {
    // É o ponto inteiro da tabela: gravar setembro não reescreve o que já
    // foi reservado no começo do ano.
    expect(aliquotaDaCompetencia("2026-01-01", registros).rate).toBe(0.06);
  });

  it("mês sem registro se declara presumido, e NÃO herda do anterior", () => {
    // Herdar em silêncio faria setembro parecer confirmado a 8% só porque
    // agosto foi — e ninguém saberia que aquilo era chute.
    const r = aliquotaDaCompetencia("2026-09-01", registros);
    expect(r.rate).toBe(ALIQUOTA_MINIMA);
    expect(r.presumida).toBe(true);
  });

  it("competência é sempre o dia 1", () => {
    expect(competenciaDe("2026-08-17")).toBe("2026-08-01");
    expect(competenciaDe(new Date(2026, 11, 31))).toBe("2026-12-01");
  });
});

describe("a reserva incide sobre o bruto", () => {
  it("8% de 10.000 são 800", () => {
    expect(reservaTributaria(10_000, 0.08)).toBe(800);
  });
  it("valor não positivo não reserva nada", () => {
    expect(reservaTributaria(0, 0.08)).toBe(0);
    expect(reservaTributaria(-5, 0.08)).toBe(0);
  });
});

describe("o próximo vencimento sai do vencimento, não do pagamento", () => {
  it("mês a mês", () => {
    expect(proximoVencimento("2026-08-10")).toBe("2026-09-10");
  });

  it("pagar em atraso não empurra os meses seguintes", () => {
    // Vence dia 10, pago dia 29: o próximo continua dia 10. Se saísse do
    // pagamento, cada atraso deslocaria o calendário para sempre.
    expect(proximoVencimento("2026-08-10")).toBe("2026-09-10");
  });

  it("dia 31 cai no último dia do mês curto, sem transbordar", () => {
    expect(proximoVencimento("2026-01-31")).toBe("2026-02-28");
    expect(proximoVencimento("2026-08-31")).toBe("2026-09-30");
  });

  it("vira o ano", () => {
    expect(proximoVencimento("2026-12-15")).toBe("2027-01-15");
    expect(proximoVencimento("2026-03-05", "yearly")).toBe("2027-03-05");
  });
});

describe("o atraso é dito em dias", () => {
  it("negativo quando venceu", () => {
    expect(diasAteVencer("2026-08-10", "2026-08-29")).toBe(-19);
    expect(diasAteVencer("2026-08-29", "2026-08-29")).toBe(0);
    expect(diasAteVencer("2026-09-10", "2026-08-29")).toBe(12);
  });
});

describe("o custo mensal rateia o anual", () => {
  it("anual entra dividido por doze", () => {
    // Somar o anual inteiro faria a estrutura parecer doze vezes mais cara
    // em janeiro e barata no resto do ano.
    expect(custoMensal([
      { amount: 100, recurrence: "monthly" },
      { amount: 1200, recurrence: "yearly" },
    ])).toBe(200);
  });

  it("linha não recorrente não entra no custo fixo", () => {
    // As saídas já pagas viram recurrence 'none': contá-las de novo
    // dobraria a despesa do mês.
    expect(custoMensal([
      { amount: 100, recurrence: "monthly" },
      { amount: 999, recurrence: "none" },
    ])).toBe(100);
  });
});

describe("a migration do pagamento", () => {
  const migracao = ler("supabase/migrations/20260830010000_aliquota_por_mes_e_pagamento_de_custo_fixo.sql");

  it("o próximo vencimento sai do vencimento atual", () => {
    expect(migracao).toContain("_molde.due_date + case when _molde.recurrence = 'yearly'");
  });

  it("a saída paga não vira molde", () => {
    // recurrence 'none' na linha inserida: se fosse 'monthly', o mesmo
    // custo passaria a ser projetado duas vezes no fluxo de caixa.
    expect(migracao).toContain("_quando, 'paid', 'none',");
  });

  it("só admin ou manager registram pagamento", () => {
    expect(migracao).toContain("sem_permissao: apenas admin ou manager registram pagamento");
  });

  it("recusa pagar o que não é recorrente", () => {
    expect(migracao).toContain("nao_e_recorrente");
  });

  it("a competência é sempre o dia 1", () => {
    expect(migracao).toContain("competencia_e_dia_primeiro");
  });

  it("manager lê a alíquota, mas só admin escreve", () => {
    // Mudar a alíquota é mudar quanto do caixa fica reservado ao governo.
    expect(migracao).toContain("admin_manager_leem_aliquota");
    expect(migracao).toContain("admin_escreve_aliquota");
    expect(migracao).toContain("for all using (public.has_role(auth.uid(), 'admin'::public.app_role))");
  });
});

describe("a tela financeira", () => {
  const custos = ler("src/components/finance/FixedCosts.tsx");
  const tributaria = ler("src/components/finance/AreaTributaria.tsx");

  it("as três abas existem", () => {
    for (const r of ["Custos fixos", "Pró-labore", "Tributária"]) {
      expect(custos).toContain(r);
    }
  });

  it("pagar usa o RPC atômico, e não dois updates soltos", () => {
    expect(custos).toContain('rpc("expense_pagar"');
    expect(custos).toContain("proximo_vencimento");
  });

  it("o vencimento é editável e mostra o atraso", () => {
    expect(custos).toContain("setVencModal");
    expect(custos).toContain("em atraso");
  });

  it("o histórico tem rolagem própria", () => {
    expect(custos).toContain("Histórico de pagamentos");
    expect(custos).toMatch(/max-h-\S+ space-y-1 overflow-y-auto/);
  });

  it("a aba do pró-labore soma com o proporcional", () => {
    expect(custos).toContain("Estrutura com o proporcional");
    expect(custos).toContain("fixedWithoutProLabore + suggested");
  });

  it("a barra vai de 6 a 9 com passo de meio ponto", () => {
    expect(tributaria).toContain("min={ALIQUOTA_MINIMA * 1000}");
    expect(tributaria).toContain("max={ALIQUOTA_MAXIMA * 1000}");
    expect(tributaria).toContain("step={5}");
  });

  it("falha de leitura não vira lista zerada", () => {
    expect(tributaria).toContain("NÃO estão zerados");
  });

  it("mês presumido é dito, não escondido", () => {
    expect(tributaria).toContain("presumido no piso");
  });
});

describe("um so jeito de pagar nas duas telas", () => {
  const estorno = ler("supabase/migrations/20260831010000_pagamento_unico_e_estorno.sql");
  const fluxo = ler("src/components/finance/CashFlow.tsx");

  it("o Fluxo deixou de virar o status na propria linha", () => {
    // Era o defeito: marcar o MOLDE como pago o congela naquele mes e ele
    // para de projetar os meses seguintes — o custo fixo some da previsao.
    expect(fluxo).not.toContain('.update({ status: newStatus, paid_date:');
    expect(fluxo).toContain('rpc("expense_pagar"');
    expect(fluxo).toContain('rpc("expense_estornar"');
  });

  it("despesa pontual paga no lugar, sem criar linha nova", () => {
    // Era o caminho que faltava e que obrigava o Fluxo a ter modelo proprio.
    expect(estorno).toContain("'pontual', true");
  });

  it("o pagamento guarda de qual molde veio", () => {
    // Sem o vinculo, estornar deixaria o vencimento rolado para sempre.
    expect(estorno).toContain("parent_expense_id");
    expect(estorno).toContain("_molde.id)");
  });

  it("o estorno devolve o vencimento ao mes pago", () => {
    expect(estorno).toContain("set due_date = _pago.due_date");
    expect(estorno).toContain("delete from public.expenses where id = _pago.id");
  });

  it("pagamento antigo sem molde apenas reabre", () => {
    // As 18 saidas que ja existiam nasceram antes da regra; forcar um
    // vinculo nelas seria inventar historia.
    expect(estorno).toContain("if _pago.parent_expense_id is null then");
  });
});

describe("as saidas realizadas e o pro-labore no fluxo", () => {
  const fluxo = ler("src/components/finance/CashFlow.tsx");

  it("a aba Realizadas existe e so mostra o que saiu", () => {
    expect(fluxo).toContain("Realizadas (");
    expect(fluxo).toContain('e.status === "paid" && e.paid_date');
  });

  it("a aba de pro-labore usa a receita OPERACIONAL, nao a bruta", () => {
    // Usar o bruto inflaria a retirada em toda a faixa: a parte do governo
    // nunca foi receita da agencia.
    expect(fluxo).toContain("monthReceivedGross * (1 - DEFAULT_TAX_RATE)");
    expect(fluxo).toContain("interpolateProLabore(operacional)");
  });

  it("lanca o pro-labore ja no valor proporcional", () => {
    expect(fluxo).toContain("lancarProLaboreProporcional");
    expect(fluxo).toContain("proLaboreView.proporcional");
  });

  it("as duas listas novas tem rolagem propria", () => {
    expect(fluxo).toContain('max-h-[420px] divide-y divide-border overflow-y-auto');
    expect(fluxo).toContain('max-h-[300px] divide-y divide-border overflow-y-auto');
  });
});

describe("o pró-labore proporcional em um clique", () => {
  const fluxo = ler("src/components/finance/CashFlow.tsx");

  it("está no menu de Novo lançamento", () => {
    expect(fluxo).toContain("Lançar pró-labore proporcional");
    expect(fluxo).toContain("void lancarProLaboreProporcional()");
  });

  it("AJUSTA quando já existe, em vez de criar um segundo", () => {
    // Criar outro daria DOIS pró-labores somando no fluxo, e o dono só
    // descobriria no fechamento do mês.
    expect(fluxo).toContain("const molde = proLaboreView.molde;");
    expect(fluxo).toContain("sem criar uma segunda retirada");
    expect(fluxo).toContain('.eq("id", molde.id)');
  });

  it("não faz nada quando já está no valor certo", () => {
    // Gravar por gravar sujaria a trilha com uma alteração que não alterou.
    expect(fluxo).toContain("Math.abs(atual - valor) < 0.01");
  });

  it("o rótulo muda conforme o caso, para o clique não surpreender", () => {
    expect(fluxo).toContain("Ajustar pró-labore para");
  });

  it("recusa quando não há receita para calcular", () => {
    // Zero proporcional não é decisão: é falta de base.
    expect(fluxo).toContain("Sem receita operacional no mês para calcular o proporcional");
  });
});
