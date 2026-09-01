import { describe, expect, it } from "vitest";
import {
  PHASE_LABELS, catalogSize, phaseForClient, stepLabelForWeek, stepsForWeek,
} from "@/lib/cycleTasks";

/**
 * O ciclo repetia as mesmas seis etapas para todo cliente e toda semana, e
 * marcar virava burocracia. Agora três giram, tiradas de um acervo grande
 * organizado pelo método A.C.E.L.E.R.A e filtrado pela fase em que aquele
 * cliente está.
 *
 * A regra que não pode quebrar: a rotação precisa ser estável, porque a
 * marcação guarda só o número da etapa. Se o sorteio mudasse, a etapa 5
 * marcada hoje significaria outra coisa amanhã e o histórico viraria mentira.
 */
describe("acervo de tarefas", () => {
  it("é grande o bastante para não repetir", () => {
    // Com 3 etapas por semana, um acervo pequeno se esgota em um mês.
    expect(catalogSize("social")).toBeGreaterThanOrEqual(30);
    expect(catalogSize("trafego")).toBeGreaterThanOrEqual(30);
  });

  it("cobre as sete fases do método", () => {
    expect(Object.keys(PHASE_LABELS)).toEqual([
      "analisar", "clarear", "estruturar", "lancar", "executar", "revisar", "acelerar",
    ]);
  });
});

describe("fase do cliente na jornada", () => {
  it("cliente entrando começa no diagnóstico", () => {
    expect(phaseForClient({ onboardingDone: false, daysAsClient: 5 })).toBe("analisar");
    expect(phaseForClient({ onboardingDone: false, daysAsClient: 30 })).toBe("clarear");
  });

  it("primeiros meses são de estruturar e lançar", () => {
    expect(phaseForClient({ onboardingDone: true, daysAsClient: 20 })).toBe("estruturar");
    expect(phaseForClient({ onboardingDone: true, daysAsClient: 45 })).toBe("lancar");
  });

  it("rotina em pé é execução", () => {
    expect(phaseForClient({ onboardingDone: true, daysAsClient: 75 })).toBe("executar");
  });

  it("cliente antigo passa a revisar", () => {
    expect(phaseForClient({ onboardingDone: true, daysAsClient: 100 })).toBe("revisar");
  });

  it("quem tem rotina madura e tempo de casa vai para escala", () => {
    // A sequência de semanas 100% é a prova de que a rotina se sustenta.
    expect(
      phaseForClient({ onboardingDone: true, daysAsClient: 200, closedStreak: 5 }),
    ).toBe("acelerar");
    // Sem a sequência, não escala: continua revisando.
    expect(
      phaseForClient({ onboardingDone: true, daysAsClient: 200, closedStreak: 1 }),
    ).toBe("revisar");
  });
});

describe("etapas da semana", () => {
  const opcoes = { services: { social: true, trafego: true } };

  it("as DUAS pontas do trabalho ficam fixas", () => {
    // Eram três (1, 4 e 6). Em 2026-09-01 o dono escolheu duas: o passo 4
    // ("painel atualizado") passou a girar, porque manter o painel em dia
    // é consequência do trabalho e não uma quarta parte dele.
    //
    // Ficam PRODUZIR (1) e COLOCAR NA RUA (6): as únicas que valem em toda
    // semana, para todo cliente, sem depender do que está pegando fogo.
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17", opcoes);
    expect(etapas.filter((e) => e.fixed).map((e) => e.step)).toEqual([1, 6]);
    expect(etapas[0].label).toMatch(/conteúdo da semana/i);
    expect(etapas[5].label).toMatch(/agendad/i);
  });

  it("o passo 4 gira, e por isso não é mais fixo", () => {
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17", opcoes);
    const quatro = etapas.find((e) => e.step === 4)!;
    expect(quatro.fixed).toBe(false);
    expect(quatro.label).not.toMatch(/painel atualizado/i);
  });

  it("as QUATRO giradas trazem fase e propósito", () => {
    const giradas = stepsForWeek("social", "acerbi", "2026-08-17", opcoes)
      .filter((e) => !e.fixed);
    expect(giradas).toHaveLength(4);
    for (const etapa of giradas) {
      expect(etapa.phase).toBeDefined();
      // Toda tarefa existe para gerar resultado ou mostrar o trabalho.
      expect(["resultado", "vitrine"]).toContain(etapa.intent);
    }
  });

  it("respeita a fase do cliente", () => {
    const novo = stepsForWeek("social", "x", "2026-08-17", {
      ...opcoes,
      phaseInput: { onboardingDone: false, daysAsClient: 5 },
    }).filter((e) => !e.fixed);
    const maduro = stepsForWeek("social", "x", "2026-08-17", {
      ...opcoes,
      phaseInput: { onboardingDone: true, daysAsClient: 250, closedStreak: 6 },
    }).filter((e) => !e.fixed);

    // Cliente novo recebe diagnóstico; cliente maduro recebe escala.
    expect(novo.some((e) => ["analisar", "clarear"].includes(e.phase!))).toBe(true);
    expect(maduro.some((e) => ["revisar", "acelerar"].includes(e.phase!))).toBe(true);
  });

  it("não entrega tarefa de serviço que o cliente não paga", () => {
    // "Conferir a página de destino" exige site contratado.
    for (const semana of ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]) {
      const etapas = stepsForWeek("trafego", "so-trafego", semana, {
        services: { trafego: true },
      });
      expect(etapas.map((e) => e.label).join(" ")).not.toMatch(/página de destino/i);
    }
  });

  it("dá etapas diferentes para clientes diferentes na mesma semana", () => {
    const a = stepsForWeek("social", "acerbi", "2026-08-17", opcoes).map((e) => e.label);
    const b = stepsForWeek("social", "mirante", "2026-08-17", opcoes).map((e) => e.label);
    expect(a).not.toEqual(b);
    expect(a[0]).toBe(b[0]); // o esqueleto é o mesmo
  });

  it("dá etapas diferentes para o mesmo cliente em semanas diferentes", () => {
    const s1 = stepsForWeek("social", "acerbi", "2026-08-10", opcoes).map((e) => e.label);
    const s2 = stepsForWeek("social", "acerbi", "2026-08-17", opcoes).map((e) => e.label);
    expect(s1).not.toEqual(s2);
  });

  it("é estável: a mesma semana devolve sempre as mesmas etapas", () => {
    // Esta é a garantia que protege o histórico das marcações.
    const primeira = stepsForWeek("trafego", "verzelo", "2026-07-06", opcoes);
    expect(stepsForWeek("trafego", "verzelo", "2026-07-06", opcoes)).toEqual(primeira);
    expect(stepsForWeek("trafego", "verzelo", "2026-07-06", opcoes)).toEqual(primeira);
  });

  it("nunca repete a mesma etapa girada dentro da semana", () => {
    for (const semana of ["2026-08-03", "2026-08-10", "2026-08-17"]) {
      for (const cliente of ["a", "b", "c", "d", "e"]) {
        const giradas = stepsForWeek("social", cliente, semana, opcoes)
          .filter((e) => !e.fixed)
          .map((e) => e.label);
        expect(new Set(giradas).size).toBe(4);
      }
    }
  });

  it("responde o nome de uma etapa específica", () => {
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17", opcoes);
    expect(stepLabelForWeek("social", "acerbi", "2026-08-17", 3, opcoes)).toBe(etapas[2].label);
  });
});
