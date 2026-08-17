import { describe, expect, it } from "vitest";
import { stepLabelForWeek, stepsForWeek } from "@/lib/cycleTasks";

/**
 * O ciclo repetia as mesmas seis etapas para todo cliente e toda semana, e
 * marcar virava burocracia. Agora três giram. A regra que não pode quebrar:
 * a rotação precisa ser estável, porque a marcação guarda só o número da
 * etapa. Se o sorteio mudasse, a etapa 5 marcada hoje significaria outra
 * coisa amanhã e o histórico viraria mentira.
 */
describe("etapas da semana", () => {
  it("mantém fixo o esqueleto do trabalho", () => {
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17");
    const fixas = etapas.filter((e) => e.fixed).map((e) => e.step);

    // Criar conteúdo, atualizar painel e agendar acontecem toda semana.
    expect(fixas).toEqual([1, 4, 6]);
    expect(etapas[0].label).toMatch(/conteúdo da semana/i);
    expect(etapas[3].label).toMatch(/painel atualizado/i);
    expect(etapas[5].label).toMatch(/agendad/i);
  });

  it("gira as outras três", () => {
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17");
    const giradas = etapas.filter((e) => !e.fixed).map((e) => e.step);
    expect(giradas).toEqual([2, 3, 5]);
  });

  it("dá etapas diferentes para clientes diferentes na mesma semana", () => {
    const a = stepsForWeek("social", "acerbi", "2026-08-17").map((e) => e.label);
    const b = stepsForWeek("social", "mirante", "2026-08-17").map((e) => e.label);
    expect(a).not.toEqual(b);
    // Mas o esqueleto continua igual nos dois.
    expect(a[0]).toBe(b[0]);
    expect(a[3]).toBe(b[3]);
    expect(a[5]).toBe(b[5]);
  });

  it("dá etapas diferentes para o mesmo cliente em semanas diferentes", () => {
    const semana1 = stepsForWeek("social", "acerbi", "2026-08-10").map((e) => e.label);
    const semana2 = stepsForWeek("social", "acerbi", "2026-08-17").map((e) => e.label);
    expect(semana1).not.toEqual(semana2);
  });

  it("é estável: a mesma semana devolve sempre as mesmas etapas", () => {
    // Esta é a garantia que protege o histórico das marcações.
    const primeira = stepsForWeek("trafego", "verzelo", "2026-07-06");
    const segunda = stepsForWeek("trafego", "verzelo", "2026-07-06");
    const terceira = stepsForWeek("trafego", "verzelo", "2026-07-06");
    expect(segunda).toEqual(primeira);
    expect(terceira).toEqual(primeira);
  });

  it("nunca repete a mesma etapa girada dentro da semana", () => {
    for (const semana of ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"]) {
      for (const cliente of ["a", "b", "c", "d", "e"]) {
        const giradas = stepsForWeek("social", cliente, semana)
          .filter((e) => !e.fixed)
          .map((e) => e.label);
        expect(new Set(giradas).size).toBe(3);
      }
    }
  });

  it("usa o vocabulário da frente certa", () => {
    const social = stepsForWeek("social", "x", "2026-08-17").map((e) => e.label).join(" ");
    const trafego = stepsForWeek("trafego", "x", "2026-08-17").map((e) => e.label).join(" ");
    expect(social).toMatch(/legenda|stories|reel|perfil|comentários|pauta|conteúdo/i);
    expect(trafego).toMatch(/campanha|anúncio|verba|público|criativo|pixel|lead/i);
  });

  it("responde o nome de uma etapa específica", () => {
    const etapas = stepsForWeek("social", "acerbi", "2026-08-17");
    expect(stepLabelForWeek("social", "acerbi", "2026-08-17", 3)).toBe(etapas[2].label);
    expect(stepLabelForWeek("social", "acerbi", "2026-08-17", 1)).toMatch(/conteúdo/i);
  });
});
