import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Escritorio from "@/components/execucao/Escritorio";

afterEach(cleanup);

describe("Execução: escritório com trabalhos", () => {
  it("renderiza trabalho pendente, abre a tarefa e recalcula a decisão ao concluir", () => {
    const aoAbrirTarefa = vi.fn();
    const props = {
      agentes: [{ id: "op", display_name: "Operador sintético", role: "design", area: "Criação", status: "active" }],
      trabalhos: [{ operator_id: "op", status: "review", approval_required: true, kanban_task_id: "task", last_action: "Revisar peça sintética" }],
      tarefas: new Map([["task", { title: "Peça sintética", assigned_to: "human" }]]),
      humanos: new Map([["human", "Responsável sintético"]]),
      aoAbrirAgente: vi.fn(), aoAbrirTarefa,
    };
    const view = render(<Escritorio {...props} />);
    expect(screen.getByText(/trabalho está/)).toHaveTextContent("1 trabalho está parado esperando uma decisão sua");
    fireEvent.click(screen.getByRole("button", { name: /Peça sintética/ }));
    expect(aoAbrirTarefa).toHaveBeenCalledWith("task");
    view.rerender(<Escritorio {...props} trabalhos={[{ ...props.trabalhos[0], status: "done" }]} />);
    expect(screen.getByText(/Nada está parado esperando você/)).toBeInTheDocument();
  });

  it("renderiza o escritório vazio sem inventar decisão pendente", () => {
    render(<Escritorio agentes={[]} trabalhos={[]} tarefas={new Map()} humanos={new Map()} aoAbrirAgente={vi.fn()} aoAbrirTarefa={vi.fn()} />);
    expect(screen.getByText(/Nada está parado esperando você/)).toBeInTheDocument();
  });
});
