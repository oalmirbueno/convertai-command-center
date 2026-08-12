import { describe, expect, it } from "vitest";
import {
  buildProgressView,
  cycleFillPercent,
  usesPercentProgress,
} from "./projectProgress";

const reference = new Date(2026, 7, 12); // 12 de agosto de 2026

describe("andamento por tipo de contrato", () => {
  it("usa porcentagem apenas em projeto avulso", () => {
    expect(usesPercentProgress({ id: "a", billing_mode: "one_off" })).toBe(true);
    expect(usesPercentProgress({ id: "b", billing_mode: "included" })).toBe(false);
  });

  it("mantem a barra de porcentagem do avulso", () => {
    const view = buildProgressView(
      { id: "a", billing_mode: "one_off", progress: 62 },
      [],
      reference,
    );
    expect(view).toEqual({ mode: "percent", percent: 62 });
  });

  it("limita porcentagem invalida a faixa 0-100", () => {
    expect(buildProgressView({ id: "a", billing_mode: "one_off", progress: 180 }, [], reference))
      .toEqual({ mode: "percent", percent: 100 });
    expect(buildProgressView({ id: "a", billing_mode: "one_off", progress: null }, [], reference))
      .toEqual({ mode: "percent", percent: 0 });
  });

  it("troca porcentagem por ritmo do ciclo no recorrente", () => {
    const view = buildProgressView(
      { id: "p1", billing_mode: "included" },
      [
        { project_id: "p1", status: "done", due_date: "2026-08-03", title: "Post 1" },
        { project_id: "p1", status: "done", due_date: "2026-08-07", title: "Post 2" },
        { project_id: "p1", status: "in_progress", due_date: "2026-08-20", title: "Reel do mes" },
        { project_id: "outro", status: "done", due_date: "2026-08-05", title: "Ignorar" },
      ],
      reference,
    );
    expect(view.mode).toBe("cycle");
    if (view.mode !== "cycle") throw new Error("esperava ciclo");
    expect(view.done).toBe(2);
    expect(view.total).toBe(3);
    expect(view.label).toBe("2 de 3 entregas do mês");
    expect(view.nextTitle).toBe("Reel do mes");
    expect(view.nextDate).toBe("2026-08-20");
  });

  it("ignora tarefa apagada", () => {
    const view = buildProgressView(
      { id: "p1", billing_mode: "included" },
      [
        { project_id: "p1", status: "done", due_date: "2026-08-03", deleted_at: "2026-08-04" },
        { project_id: "p1", status: "done", due_date: "2026-08-05" },
      ],
      reference,
    );
    if (view.mode !== "cycle") throw new Error("esperava ciclo");
    expect(view.total).toBe(1);
  });

  it("nao inventa numero quando o mes ainda nao tem entrega", () => {
    const view = buildProgressView({ id: "p1", billing_mode: "included" }, [], reference);
    if (view.mode !== "cycle") throw new Error("esperava ciclo");
    expect(view.label).toBe("Ciclo em andamento");
    expect(view.total).toBe(0);
    expect(cycleFillPercent(view)).toBe(0);
  });

  it("preenche a barra do ciclo pela proporcao entregue", () => {
    const view = buildProgressView(
      { id: "p1", billing_mode: "included" },
      [
        { project_id: "p1", status: "done", due_date: "2026-08-03" },
        { project_id: "p1", status: "todo", due_date: "2026-08-25" },
      ],
      reference,
    );
    expect(cycleFillPercent(view)).toBe(50);
  });
});
