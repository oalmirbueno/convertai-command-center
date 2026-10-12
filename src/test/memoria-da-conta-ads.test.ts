import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDaMemoria,
  CAMADAS_VAZIAS,
  calcularFinancas,
  custoAlvoDasFinancas,
  montarCamadas,
  normalizarCamadas,
} from "../../supabase/functions/mesa-ads/modulos/memoria-da-conta";
import { limitesEfetivos } from "../../supabase/functions/mesa-ads/rotina-trafego";

/**
 * Memória da conta em 8 camadas (12/10/2026, skill memoria-de-conta-ads).
 * Regra da casa: CPA máximo e ROAS de equilíbrio saem do código, nunca da IA.
 */

describe("finanças da conta (C01) calculadas em código", () => {
  it("venda: CPA máximo = ticket x margem e ROAS de equilíbrio = 1 / margem", () => {
    const f = calcularFinancas({ ...CAMADAS_VAZIAS.financas, ticket_medio_brl: 200, margem_pct: 40, compras_no_ano: 3 });
    expect(f.custo_maximo_brl).toBe(80);
    expect(f.por).toBe("compra");
    expect(f.roas_de_equilibrio).toBe(2.5);
    expect(f.valor_do_cliente_no_ano_brl).toBe(240);
    expect(f.faltando).toEqual([]);
    expect(f.contas.join(" ")).toContain("R$ 80,00 por compra");
  });

  it("lead: custo máximo = ticket x margem x taxa de fechamento", () => {
    const f = calcularFinancas({ ...CAMADAS_VAZIAS.financas, conversao: "lead", ticket_medio_brl: 1000, margem_pct: 50, taxa_fechamento_pct: 10 });
    expect(f.custo_maximo_brl).toBe(50);
    expect(f.por).toBe("lead");
  });

  it("sem dado: número nulo e diz o que falta (nunca inventa)", () => {
    const f = calcularFinancas({ ...CAMADAS_VAZIAS.financas, conversao: "lead", ticket_medio_brl: 300 });
    expect(f.custo_maximo_brl).toBeNull();
    expect(f.roas_de_equilibrio).toBeNull();
    expect(f.faltando).toEqual(["margem de contribuição", "taxa de fechamento dos leads"]);
  });

  it("o custo máximo só vira custo-alvo quando o tipo de resultado da conta bate", () => {
    const venda = calcularFinancas({ ...CAMADAS_VAZIAS.financas, ticket_medio_brl: 200, margem_pct: 40 });
    expect(custoAlvoDasFinancas(venda, "compras")).toBe(80);
    expect(custoAlvoDasFinancas(venda, "leads")).toBeNull();
    expect(custoAlvoDasFinancas(venda, null)).toBeNull();
    const lead = calcularFinancas({ ...CAMADAS_VAZIAS.financas, conversao: "lead", ticket_medio_brl: 1000, margem_pct: 50, taxa_fechamento_pct: 10 });
    expect(custoAlvoDasFinancas(lead, "mensagens")).toBe(50);
    expect(custoAlvoDasFinancas(lead, "compras")).toBeNull();
  });
});

describe("o que vem da tela é saneado", () => {
  it("número fora da faixa some, texto com travessão vira vírgula, enum estranho volta ao padrão", () => {
    const t = String.fromCharCode(0x2014);
    const c = normalizarCamadas({
      financas: { ticket_medio_brl: "1.234,50", margem_pct: 140, conversao: "outra" },
      confiabilidade: { pixel: "quebrado", armadilhas: `REPLIES ${t} não é conversa` },
      mercado: { datas: [{ dia: "2026-12-24", nome: "Natal" }, { dia: "amanhã", nome: "x" }] },
    });
    expect(c.financas.ticket_medio_brl).toBe(1234.5);
    expect(c.financas.margem_pct).toBeNull();
    expect(c.financas.conversao).toBe("venda");
    expect(c.confiabilidade.pixel).toBe("nao_sei");
    expect(c.confiabilidade.armadilhas).toBe("REPLIES , não é conversa");
    expect(c.mercado.datas).toEqual([{ dia: "2026-12-24", nome: "Natal" }]);
  });

  it("'12.5' sem vírgula continua 12,5 (não vira 125)", () => {
    expect(normalizarCamadas({ financas: { margem_pct: "12.5" } }).financas.margem_pct).toBe(12.5);
  });
});

describe("as 8 camadas e o bloco do agente", () => {
  const preenchidas = normalizarCamadas({ financas: { ticket_medio_brl: 200, margem_pct: 40 } });
  const camadas = montarCamadas({
    preenchidas,
    financas: calcularFinancas(preenchidas.financas),
    mapa: { campanhas_ativas: ["Vendas outubro"], pausados_recentes: [], feito_recente: [], ofertas_arquivadas: [] },
    regras: { limites: [{ nome: "Custo-alvo por resultado", valor: "R$ 80,00", fonte: "custo máximo das finanças da conta (ticket x margem)" }], ensinadas: ["Nunca pausar no fim de semana."] },
    biblioteca: { aprendizados: [], vencedores: [], perdedores: [] },
    atualidade: { ultima_coleta: "2026-10-12T10:00:00Z", horas_desde_a_coleta: 9, contas_conectadas: 1 },
  });

  it("são exatamente C00 a C07, na ordem", () => {
    expect(camadas.map((c) => c.id)).toEqual(["C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07"]);
  });

  it("coleta parada há mais de 6 h vira aviso na C07", () => {
    expect(camadas.find((c) => c.id === "C07")!.linhas.join(" ")).toContain("não decidir com estes números");
  });

  it("o bloco manda citar a camada e respeita o teto", () => {
    const b = blocoDaMemoria(camadas);
    expect(b).toContain("MEMÓRIA DA CONTA (8 camadas");
    expect(b).toContain("C01 FINANÇAS (calculado)");
    expect(b).toContain("Regra do dono: Nunca pausar no fim de semana.");
    expect(blocoDaMemoria(camadas, 300).length).toBeLessThanOrEqual(300);
  });
});

describe("a rotina e o agente usam o custo das finanças", () => {
  it("fonte 'financas' fica logo depois do dono e antes do plano", () => {
    const so = limitesEfetivos({ custoDaFinanca: 80, custoDoPlano: 60, custoDoBriefing: 50 });
    expect(so.limites.custo_alvo_brl).toBe(80);
    expect(so.fontes.custo_alvo_brl).toBe("financas");
    const comDono = limitesEfetivos({ dono: { custo_alvo_brl: 70 }, custoDaFinanca: 80 });
    expect(comDono.fontes.custo_alvo_brl).toBe("dono");
  });

  it("o index lê a memória na conversa, no otimizar, no retrato e na rotina", () => {
    const idx = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-ads/index.ts"), "utf8");
    expect(idx).toContain("memoria_ler: memoriaLer,");
    expect(idx).toContain("memoria_salvar: memoriaSalvar,");
    expect(idx).toContain("blocoDaMemoria(camadasDaMemoria)");
    expect((idx.match(/custoDaFinanca: /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("a memória não mora no dossiê (leitores pegam o dossiê atual sem filtrar o tipo)", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261012010000_ads_memoria_da_conta.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_memoria_da_conta");
    expect(sql).toContain("Não usa client_dossiers de propósito");
  });
});
