import { describe, expect, it } from "vitest";
import { buildJourneyNarrative, type JourneySnapshot } from "./clientJourneyNarrative";

const reference = new Date(2026, 7, 12); // 12 de agosto de 2026

const empty: JourneySnapshot = {
  projects: [],
  tasks: [],
  milestones: [],
  pendingApprovals: 0,
  publications: [],
};

describe("narrativa automática de onde estamos", () => {
  it("nunca devolve tela vazia, mesmo sem nenhum dado", () => {
    const narrative = buildJourneyNarrative(empty, reference);
    expect(narrative.headline).toBeTruthy();
    expect(narrative.paragraphs.length).toBeGreaterThan(0);
    expect(narrative.nextStep).toBeTruthy();
    expect(narrative.signals).toHaveLength(4);
  });

  it("reconhece a fase pelo movimento real do painel", () => {
    expect(buildJourneyNarrative(empty, reference).phase).toBe("Montando a base");

    expect(
      buildJourneyNarrative(
        { ...empty, tasks: [{ project_id: "p", status: "in_progress", title: "Reel" }] },
        reference,
      ).phase,
    ).toBe("Em produção");

    expect(
      buildJourneyNarrative(
        { ...empty, publications: [{ status: "scheduled", scheduled_at: "2026-08-20T10:00:00Z" }] },
        reference,
      ).phase,
    ).toBe("Pronto para publicar");

    expect(
      buildJourneyNarrative(
        { ...empty, publications: [{ status: "published", published_at: "2026-08-05T10:00:00Z" }] },
        reference,
      ).phase,
    ).toBe("No ar e medindo");
  });

  it("conta entregas concluídas dentro do mês corrente", () => {
    const narrative = buildJourneyNarrative(
      {
        ...empty,
        tasks: [
          { project_id: "p", status: "done", due_date: "2026-08-03" },
          { project_id: "p", status: "done", due_date: "2026-08-10" },
          { project_id: "p", status: "done", due_date: "2026-07-28" }, // mês anterior
          { project_id: "p", status: "done", due_date: "2026-08-30" }, // ainda no futuro
        ],
      },
      reference,
    );
    expect(narrative.signals[0]).toEqual({
      label: "Entregas concluídas no mês",
      value: "2",
      tone: "good",
    });
  });

  it("prioriza a aprovação pendente como próximo passo", () => {
    const narrative = buildJourneyNarrative(
      { ...empty, pendingApprovals: 3, publications: [{ status: "scheduled", scheduled_at: "2026-08-20T10:00:00Z" }] },
      reference,
    );
    expect(narrative.nextStep).toContain("3 materiais esperando sua aprovação");
    expect(narrative.signals[3].tone).toBe("attention");
  });

  it("tranquiliza quando nada depende do cliente", () => {
    const narrative = buildJourneyNarrative(
      { ...empty, publications: [{ status: "scheduled", scheduled_at: "2026-08-20T10:00:00Z" }] },
      reference,
    );
    expect(narrative.nextStep).toContain("Nada pendente com você");
    expect(narrative.signals[3].tone).toBe("good");
  });

  it("ignora tarefa apagada na contagem", () => {
    const narrative = buildJourneyNarrative(
      {
        ...empty,
        tasks: [
          { project_id: "p", status: "todo", title: "Viva" },
          { project_id: "p", status: "todo", title: "Apagada", deleted_at: "2026-08-01" },
        ],
      },
      reference,
    );
    expect(narrative.signals[1].value).toBe("1");
  });

  it("cita a frente ativa e a próxima entrega em linguagem de gente", () => {
    const narrative = buildJourneyNarrative(
      {
        ...empty,
        projects: [{ id: "p", name: "Social Media", status: "active" }],
        tasks: [{ project_id: "p", status: "in_progress", title: "Carrossel de agosto", due_date: "2026-08-18" }],
      },
      reference,
    );
    const text = narrative.paragraphs.join(" ");
    expect(text).toContain("Social Media");
    expect(text).toContain("Carrossel de agosto");
    expect(text).toContain("18 de agosto");
  });

  it("não conta publicação agendada no passado como próxima", () => {
    const narrative = buildJourneyNarrative(
      { ...empty, publications: [{ status: "scheduled", scheduled_at: "2026-08-01T10:00:00Z" }] },
      reference,
    );
    expect(narrative.nextStep).toContain("Nada pendente");
    expect(narrative.nextStep).not.toContain("01 de agosto");
  });
});
