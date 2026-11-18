import { describe, expect, it } from "vitest";
import { montarHistorico, somarMes, variacao } from "@/lib/financeiro/historicoDoCaixa";
import { leituraAmpla, respostaDoHistorico } from "../../supabase/functions/agente-cfo/modulos/cfo-leitura-ampla";
import { intencaoPorPalavras } from "../../supabase/functions/agente-cfo/modulos/cfo-calculos";

// 16/11/2026: "falta o lucro do mês e quanto sobrou de caixa daquele mês com base no que entrou e saiu;
// já puxe do histórico para comparar; melhore o agente CFO, que consegue ler tudo".
describe("resultado mês a mês", () => {
  const base = {
    entradas: [
      { dia: "2026-09-10", valor: 5000 },
      { dia: "2026-10-05", valor: 7000 },
      { dia: "2026-11-03", valor: 6000 },
    ],
    saidas: [
      { dia: "2026-09-20", valor: 4000 },
      { dia: "2026-10-20", valor: 3000 },
      { dia: "2026-11-10", valor: 1000 },
    ],
    saldoHoje: 15000,
    ate: "2026-11",
  };
  it("lucro = entrou − saiu, e o caixa no fim anda para trás a partir do saldo de hoje", () => {
    const h = montarHistorico(base);
    expect(h.meses.map((m) => [m.mes, m.entrou, m.saiu, m.lucro, m.caixaNoFim])).toEqual([
      ["2026-09", 5000, 4000, 1000, 6000],
      ["2026-10", 7000, 3000, 4000, 10000],
      ["2026-11", 6000, 1000, 5000, 15000],
    ]);
    expect(h.meses[2].margem).toBe(83.3);
  });
  it("não mostra meses vazios antes do primeiro movimento e respeita o limite de meses", () => {
    expect(montarHistorico(base).meses[0].mes).toBe("2026-09");
    expect(montarHistorico({ ...base, quantos: 2 }).meses.map((m) => m.mes)).toEqual(["2026-10", "2026-11"]);
  });
  it("média, melhor e pior mês só com meses fechados (o corrente fica fora)", () => {
    const h = montarHistorico(base);
    expect(h.media).toEqual({ entrou: 6000, saiu: 3500, lucro: 2500 });
    expect(h.melhor?.mes).toBe("2026-10");
    expect(h.pior?.mes).toBe("2026-09");
  });
  it("mês escolhido no passado: o que entrou e saiu depois dele volta para trás", () => {
    const h = montarHistorico({ ...base, ate: "2026-10" });
    expect(h.meses[h.meses.length - 1]).toMatchObject({ mes: "2026-10", lucro: 4000, caixaNoFim: 10000 });
  });
  it("caixa usa a entrada líquida quando houver taxa (CRM e E-mail)", () => {
    const h = montarHistorico({ ...base, entradasDoCaixa: [...base.entradas.slice(0, 2), { dia: "2026-11-03", valor: 5900 }] });
    expect(h.meses[1].caixaNoFim).toBe(10100);
    expect(h.meses[2].lucro).toBe(5000);
  });
  it("variação em % e virada de ano", () => {
    expect(variacao(5000, 4000)).toBe(25);
    expect(variacao(1000, 0)).toBeNull();
    expect(somarMes("2026-12", 1)).toBe("2027-01");
    expect(somarMes("2027-01", -1)).toBe("2026-12");
  });
});

describe("agente CFO lê tudo", () => {
  const leitura = () =>
    leituraAmpla({
      hoje: "2026-11-16",
      cobrancas: [
        { client_id: "a", type: "renewal", amount: 900, status: "paid", paid_date: "2026-11-05" },
        { client_id: "b", type: "one_off", amount: 3000, paid_amount: 3000, status: "paid", paid_date: "2026-11-13" },
        { client_id: "a", type: "renewal", amount: 900, status: "paid", paid_date: "2026-10-05" },
        { client_id: "a", type: "ads_recharge", amount: 5000, status: "paid", paid_date: "2026-11-05" },
        { client_id: "c", type: "renewal", amount: 700, status: "pending", due_date: "2026-11-20" },
      ],
      pagamentos: [{ client_id: "b", installments: [{ amount: 1750, status: "paid", paid_date: "2026-11-15" }] }],
      despesas: [
        { amount: 500, category: "ferramentas", status: "paid", paid_date: "2026-11-02" },
        { amount: 300, category: "comissoes", status: "paid", paid_date: "2026-11-03" },
        { amount: 10000, category: "inv_trafego", status: "paid", paid_date: "2026-11-03" },
        { amount: 400, category: "ferramentas", status: "paid", paid_date: "2026-10-02" },
      ],
      clientes: [{ id: "a", company_name: "HS Consórcios" }, { id: "b", company_name: "Vip DK" }],
      config: { opening_balance: 1000 },
      produto: [{ valor: 99.8, valor_liquido: 97.8, pago_em: "2026-11-10T15:00:00Z" }],
      extras: [
        { cobranca: "mensal", status: "ativo", valor: 397 },
        { cobranca: "mensal", status: "aguardando", valor: 1970 },
        { cobranca: "comissao", status: "ativo", valor: 0 },
      ],
    });
  it("o mês: origem do dinheiro, CRM e E-mail, recarga de ads e aporte fora", () => {
    const { fatos, historico } = leitura();
    expect(fatos.entrou_no_mes_por_origem).toEqual({ mensalidades: 900, avulsos_e_extras: 3000, projetos: 1750, crm_email: 99.8 });
    const nov = historico.meses[historico.meses.length - 1];
    expect(nov).toMatchObject({ mes: "2026-11", entrou: 5749.8, saiu: 800, lucro: 4949.8 });
  });
  it("quem mais pagou, para onde foi o dinheiro e os extras", () => {
    const { fatos } = leitura();
    expect(fatos.quem_mais_pagou_3_meses).toEqual([{ cliente: "Vip DK", valor: 4750 }, { cliente: "HS Consórcios", valor: 1800 }]);
    expect(fatos.saiu_no_mes_por_categoria).toEqual([{ categoria: "ferramentas", valor: 500 }, { categoria: "comissoes", valor: 300 }]);
    expect(fatos.extras_dos_clientes).toEqual({ mensais_ativos: 1, mensais_ativos_por_mes: 397, aguardando_entrega: 1, aguardando_entrega_por_mes: 1970, variaveis_ativos: 1 });
  });
  it("caixa de hoje fecha com abertura + entradas líquidas − saídas", () => {
    const { historico } = leitura();
    // 1000 + (900+3000+900+1750+97.8) − (500+300+400) = 6447.8
    expect(historico.meses[historico.meses.length - 1].caixaNoFim).toBe(6447.8);
  });
  it("responde o mês citado e compara com o anterior", () => {
    const { historico } = leitura();
    const r = respostaDoHistorico(historico, "qual foi o lucro de outubro?");
    expect(r.split("\n")[0]).toContain("out/26: entrou R$");
    expect(r).toMatch(/lucro R\$\s500,00/);
    expect(respostaDoHistorico(historico, "quanto sobrou esse mês?").split("\n")[0]).toContain("nov/26");
  });
  it("perguntas sobre o passado vão para o histórico", () => {
    expect(intencaoPorPalavras("qual foi meu lucro em outubro?")).toBe("historico");
    expect(intencaoPorPalavras("quanto sobrou no mês passado")).toBe("historico");
    expect(intencaoPorPalavras("compare outubro com novembro")).toBe("historico");
    expect(intencaoPorPalavras("posso gastar 500 num curso?")).toBe("posso_gastar");
  });
});
