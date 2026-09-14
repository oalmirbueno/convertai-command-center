interface VinculoDeTarefa { kanban_task_id?: string | null; painel_task_id?: string | null; status: string }
interface EstadoDaTarefa { status?: string | null; deleted_at?: string | null }

/** Project only: closing a task never fabricates an operator completion or deletes history. */
export function vinculoEncerrado(
  vinculo: VinculoDeTarefa,
  tarefas: ReadonlyMap<string, EstadoDaTarefa>,
  tarefasProntas: boolean,
): boolean {
  const tarefaId = vinculo.kanban_task_id || vinculo.painel_task_id;
  if (!tarefaId || !tarefasProntas) return false;
  const tarefa = tarefas.get(tarefaId);
  if (!tarefa || tarefa.deleted_at) return true;
  if (["archived", "cancelled"].includes(tarefa.status ?? "")) return true;
  return tarefa.status === "done" && vinculo.status !== "done";
}
