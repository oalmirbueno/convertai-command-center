import { describe, expect, it } from "vitest";
import { vinculoEncerrado } from "@/lib/execucaoVinculos";

describe("Vínculos de Execução e estado real da tarefa", () => {
  it.each(["awaiting_input", "queued", "review", "blocked", "in_progress"])("guarda no histórico vínculo %s cuja tarefa já está concluída", (status) => {
    const link = Object.freeze({ kanban_task_id: "task", status });
    expect(vinculoEncerrado(link, new Map([["task", { status: "done" }]]), true)).toBe(true);
    expect(link.status).toBe(status);
  });
  it("preserva a conclusão registrada pelo operador", () => {
    expect(vinculoEncerrado({ kanban_task_id: "task", status: "done" }, new Map([["task", { status: "done" }]]), true)).toBe(false);
  });
  it.each(["archived", "cancelled"])("arquivamento %s não aparece na operação ativa", status => {
    expect(vinculoEncerrado({ painel_task_id: "task", status: "queued" }, new Map([["task", { status }]]), true)).toBe(true);
  });
  it("só interpreta ausência como histórico depois da leitura bem-sucedida", () => {
    const link = { kanban_task_id: "task", status: "awaiting_input" };
    expect(vinculoEncerrado(link, new Map(), false)).toBe(false);
    expect(vinculoEncerrado(link, new Map(), true)).toBe(true);
    expect(vinculoEncerrado({ status: "queued" }, new Map(), true)).toBe(false);
  });
  it("mantém tarefa ativa e reconhece exclusão lógica sem inventar conclusão", () => {
    const link = { kanban_task_id: "task", status: "review" };
    expect(vinculoEncerrado(link, new Map([["task", { status: "review" }]]), true)).toBe(false);
    expect(vinculoEncerrado(link, new Map([["task", { status: "review", deleted_at: "2026-09-14T12:00:00Z" }]]), true)).toBe(true);
  });
});
