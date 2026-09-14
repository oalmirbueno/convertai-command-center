import { describe, expect, it } from "vitest";
import { insightsDoCliente, leiturasDoCliente, montarEsteira } from "@/lib/esteira/esteiraMontar";
import { periodoSocial } from "@/lib/esteira/periodoSocial";
import type { FatosDoCliente, MetricaSemanaFato } from "@/lib/esteira/esteiraTipos";

const hoje = new Date("2026-09-14T12:00:00Z");
const semana = (weekStart: string, reach: number | null, capturedAt: string): MetricaSemanaFato => ({
  accountId: "synthetic", weekStart,
  weekEnd: new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10),
  capturedAt, reach, followers: null, interactions: null,
});
const atual = semana("2026-09-07", 100, "2026-09-14T08:00:00Z");
const anterior = semana("2026-08-31", 200, "2026-09-07T08:00:00Z");
const fatos = (metricas: MetricaSemanaFato[]): FatosDoCliente => ({
  clientId: "synthetic", criadoEm: null, servicos: { social: true, trafego: false },
  posts: [], tarefas: [], campanhas: [], contasAds: [], vendas: [], saldoVerba: null,
  checklists: [], marcos: [], conexoes: [], metricas, briefingRespondido: true,
  dossieResumo: null, onboardingHas: {}, estados: {}, rituais: [], oculto: { areas: [], ate: null },
});

describe("Esteira: períodos sociais com evidência", () => {
  it("segunda compara as duas semanas encerradas; zero parcial não vira -100%", () => {
    const f = fatos([semana("2026-09-14", 0, "2026-09-14T08:00:00Z"), atual, anterior]);
    const insight = insightsDoCliente(f, hoje)[0];
    const leitura = leiturasDoCliente(f, hoje, [])[0];
    expect(insight).toMatchObject({ atual: 100, anteriores: [200], variacao: -50 });
    expect(leitura.numeros.find((n) => n.rotulo === "Alcance")).toMatchObject({ atual: 100, anterior: 200, variacao: -50 });
    expect(insight.texto).toContain(leitura.periodo);
    expect(leitura.periodo).toContain("14/09 parcial, fora da comparação");
  });

  it.each([
    ["semana ausente", [anterior]],
    ["coleta parcial antiga", [{ ...atual, capturedAt: "2026-09-11T12:00:00Z" }, anterior]],
    ["coleta sem data", [{ ...atual, capturedAt: null }, anterior]],
    ["coleta futura", [{ ...atual, capturedAt: "2026-09-15T12:00:00Z" }, anterior]],
    ["alcance ausente", [{ ...atual, reach: null }, anterior]],
  ] as const)("%s não se transforma em zero ou recomendação de queda", (_caso, metricas) => {
    const f = fatos([...metricas]);
    expect(insightsDoCliente(f, hoje)[0]).toMatchObject({ atual: null, variacao: null, tendencia: "sem-base" });
    const leitura = leiturasDoCliente(f, hoje, [])[0];
    expect(leitura.caiu).toEqual([]);
    expect(leitura.fazer).toEqual([]);
  });

  it("zero coletado depois de semana encerrada continua uma queda real de 100%", () => {
    const f = fatos([{ ...atual, reach: 0 }, anterior]);
    expect(insightsDoCliente(f, hoje)[0]).toMatchObject({ atual: 0, variacao: -100, tendencia: "cai" });
    expect(leiturasDoCliente(f, hoje, [])[0].caiu).toContain("Alcance: 0 (antes 200, -100%)");
  });

  it("não salta uma semana ausente para fabricar comparação consecutiva", () => {
    const f = fatos([atual, semana("2026-08-24", 200, "2026-08-31T08:00:00Z")]);
    expect(insightsDoCliente(f, hoje)[0]).toMatchObject({ atual: 100, anteriores: [], variacao: null });
  });

  it("sexta ainda exclui a semana corrente; domingo à noite no Brasil não vira segunda UTC", () => {
    const metricas = [atual, anterior];
    expect(periodoSocial(metricas, new Date("2026-09-11T12:00:00Z")).inicio).toBe("2026-08-31");
    expect(periodoSocial(metricas, new Date("2026-09-14T01:00:00Z")).inicio).toBe("2026-08-31");
  });

  it("arquivada e cancelada saem da fila sem ganhar conclusão nem perder histórico", () => {
    const f = fatos([]);
    f.tarefas = ["archived", "cancelled", "done", "todo"].map((status) => ({
      id: status, titulo: `Tarefa ${status}`, status, dueDate: "2026-09-01", assignedTo: null,
      source: null, updatedAt: "2026-09-14T08:00:00Z",
    }));
    const original = JSON.stringify(f);
    const e = montarEsteira(f, hoje);
    expect(e.itens.filter((i) => i.fonte === "tarefa").map((i) => i.key)).toEqual(["task:todo"]);
    expect(e.feitos.filter((i) => i.fonte === "tarefa").map((i) => i.key)).toEqual(["task:done"]);
    expect(JSON.stringify(f)).toBe(original);
  });
});
