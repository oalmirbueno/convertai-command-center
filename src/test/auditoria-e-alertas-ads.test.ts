import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { alertasDaConta } from "../../supabase/functions/mesa-ads/modulos/alertas-da-conta";
import { controlesDaConta, notaDaAuditoria, type Controle } from "../../supabase/functions/mesa-ads/modulos/auditoria-da-conta";
import { LIMITES_PADRAO, type ItemDaConta, type Limites, type RetratoDaConta } from "../../supabase/functions/mesa-ads/rotina-trafego";

/**
 * Alertas da Conta ao vivo e a Auditoria da conta (12/10/2026, claude-ads adaptado à Meta).
 * Régua da camada 04 (limites da rotina) e da C01 (custo máximo e ROAS de equilíbrio), nunca número universal.
 */

const L: Limites = { ...LIMITES_PADRAO, custo_alvo_brl: 20 };
const anuncio = (o: Partial<ItemDaConta>): ItemDaConta => ({
  nivel: "anuncio", meta_id: "a1", nome: "Anúncio 1", status: "ACTIVE", campanha_id: "c1", campanha: "Camp", conjunto_id: "g1", conjunto: "Conj",
  resultado_tipo: "leads", resultado_rotulo: "Leads", orcamento_diario_brl: null, gasto: 100, impressoes: 5000, resultados: 5, custo_por_resultado: 20,
  ctr_link_pct: 1.2, cpm: 20, frequencia: 2, dias_com_gasto: 7, primeiro_dia: "2026-10-01", ctr_var_pct: 0, custo_var_pct: 0, ...o,
});
const retrato = (itens: ItemDaConta[], gasto = 100): RetratoDaConta => ({
  periodo: { inicio: "2026-09-29", fim: "2026-10-12", dias: 14 }, sincronizado_em: "2026-10-12", objetivo_tipo: "leads", resultado_rotulo: "Leads",
  itens, serie: [], totais: { gasto, resultados: 5, custo_por_resultado: 20 }, orcamento_ativo_brl: 30,
});
const base = { limites: L, custo_maximo_brl: null, roas_de_equilibrio: null, roas_da_conta: null, horas_desde_a_coleta: 1 };

describe("alertas da Conta ao vivo", () => {
  it("fadiga = frequência alta E CTR caindo (crítico); só frequência alta vira atenção", () => {
    const a = alertasDaConta({ ...base, retrato: retrato([anuncio({ frequencia: 4, ctr_var_pct: -30 }), anuncio({ meta_id: "a2", nome: "A2", frequencia: 4, ctr_var_pct: -5 })]) });
    expect(a.find((x) => x.alvo?.meta_id === "a1")?.tipo).toBe("fadiga");
    expect(a.find((x) => x.alvo?.meta_id === "a1")?.nivel).toBe("critico");
    expect(a.find((x) => x.alvo?.meta_id === "a2")?.tipo).toBe("frequencia_alta");
  });

  it("não alerta com denominador pequeno (poucas impressões, poucos resultados)", () => {
    const a = alertasDaConta({ ...base, retrato: retrato([anuncio({ impressoes: 200, frequencia: 6, ctr_var_pct: -60, resultados: 1, custo_var_pct: 200 })]) });
    expect(a).toEqual([]);
  });

  it("custo subindo e acima do custo máximo (C01) com volume", () => {
    const a = alertasDaConta({ ...base, custo_maximo_brl: 15, retrato: retrato([anuncio({ custo_var_pct: 40, custo_por_resultado: 35 })]) });
    expect(a.map((x) => x.tipo).sort()).toEqual(["custo_acima_do_maximo", "custo_subiu"]);
    expect(a.find((x) => x.tipo === "custo_acima_do_maximo")?.nivel).toBe("critico");
  });

  it("ROAS abaixo do equilíbrio e coleta parada", () => {
    const a = alertasDaConta({ ...base, roas_da_conta: 1.4, roas_de_equilibrio: 2.5, horas_desde_a_coleta: 30, retrato: retrato([], 200) });
    expect(a.map((x) => x.tipo)).toEqual(["coleta_parada", "roas_abaixo_do_equilibrio"]);
  });

  it("anúncio pausado não gera alerta", () => {
    expect(alertasDaConta({ ...base, retrato: retrato([anuncio({ status: "PAUSED", frequencia: 6, ctr_var_pct: -50 })]) })).toEqual([]);
  });
});

describe("auditoria da conta", () => {
  const entrada = {
    conectada: true,
    retrato: retrato([anuncio({}), { ...anuncio({}), nivel: "campanha" as const, meta_id: "c1", nome: "Camp", orcamento_diario_brl: 10 }]),
    anuncios: [
      { ad_id: "a1", nome: "A1", status: "ACTIVE", formato: "imagem", peca: "p1", gasto: 100, impressoes: 5000, resultados: 5, ctr_saida_pct: 1.2 },
      { ad_id: "a2", nome: "A2", status: "ACTIVE", formato: "imagem", peca: "p1", gasto: 50, impressoes: 3000, resultados: 2, ctr_saida_pct: 0.2 },
      { ad_id: "a3", nome: "A3", status: "ACTIVE", formato: "imagem", peca: "p1", gasto: 40, impressoes: 2000, resultados: 1, ctr_saida_pct: 0.9 },
    ],
    limites: L,
    financas: { custo_maximo_brl: null, faltando: ["ticket médio", "margem de contribuição"] },
    confiabilidade: { pixel: "nao_sei", api_de_conversoes: "nao_sei", evento_principal: "" },
    alertas: [],
    mix_alertas: [],
    horas_desde_a_coleta: 2,
    tipos_de_acao_vistos: ["onsite_conversion.messaging_conversation_started_7d"],
  };
  const controles = controlesDaConta(entrada);
  const r = (id: string) => controles.find((c) => c.id === id)!.resultado;

  it("julga o que mede e diz 'sem dado' para o resto (nunca falha por falta de dado)", () => {
    expect(r("M01")).toBe("passou"); // conversão chegando, mesmo sem a C03 preenchida
    expect(r("M02")).toBe("sem_dado");
    expect(r("F01")).toBe("falhou"); // sem economia definida
    expect(r("M25")).toBe("falhou"); // só imagem
    expect(r("M26")).toBe("falhou"); // mesma peça
    expect(r("M-CR4")).toBe("falhou"); // a2 com CTR 0,2%
    expect(r("M-ST1")).toBe("falhou"); // verba de R$ 10 abaixo do custo-alvo de R$ 20
    expect(r("M19")).toBe("sem_dado");
  });

  it("nota com pesos do claude-ads e faixa pela cobertura", () => {
    const n = notaDaAuditoria(controles);
    expect(n.cobertura).toBeGreaterThan(0);
    expect(["valendo", "provisoria", "dado_insuficiente"]).toContain(n.faixa);
    if (n.faixa === "dado_insuficiente") expect(n.nota).toBeNull();
    expect(n.prioridades[0].severidade === "critico" || n.prioridades[0].severidade === "alto").toBe(true);
    expect(n.categorias.map((c) => c.peso).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("cobertura abaixo de 60% não mostra nota; crítico sem dado entra nas prioridades", () => {
    const so: Controle[] = [
      { id: "X1", categoria: "medicao", nome: "x", severidade: "critico", resultado: "sem_dado", evidencia: "", acao: null },
      { id: "X2", categoria: "criativo", nome: "y", severidade: "medio", resultado: "passou", evidencia: "", acao: null },
    ];
    const n = notaDaAuditoria(so);
    expect(n.faixa).toBe("dado_insuficiente");
    expect(n.nota).toBeNull();
    expect(n.prioridades.map((p) => p.id)).toEqual(["X1"]);
  });

  it("tudo medido e passando dá 100", () => {
    const tudo: Controle[] = [
      { id: "A", categoria: "medicao", nome: "a", severidade: "critico", resultado: "passou", evidencia: "", acao: null },
      { id: "B", categoria: "criativo", nome: "b", severidade: "alto", resultado: "passou", evidencia: "", acao: null },
    ];
    expect(notaDaAuditoria(tudo)).toMatchObject({ nota: 100, cobertura: 100, faixa: "valendo" });
  });
});

describe("ligado na função e no agente", () => {
  const idx = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-ads/index.ts"), "utf8");
  it("ações novas e os alertas no contexto do agente sênior", () => {
    expect(idx).toContain("conta_alertas: contaAlertas,");
    expect(idx).toContain("auditoria_rodar: auditoriaRodar,");
    expect(idx).toContain("auditoria_ler: auditoriaLer,");
    expect(idx).toContain("ALERTAS_DA_CONTA: alertasParaAConta(");
  });
});
