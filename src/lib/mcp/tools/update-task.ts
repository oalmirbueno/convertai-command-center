import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { normalizeTaskStatus, TASK_STATUS_VALUES } from "../compat";
import { isValidIsoDate, TASK_DELIVERY_TYPE_VALUES } from "../editorial";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * O par que faltava de create_task: criar sem poder corrigir obriga o agente
 * a abandonar tarefa errada e criar outra, sujando o Kanban. Projeto e
 * origem (source) ficam fora: mover trabalho de projeto é decisão de painel.
 */
export default defineTool({
  name: "update_task",
  title: "Atualizar tarefa",
  description:
    "Atualiza campos de uma tarefa existente: title, description, status, priority, delivery_type, due_date, assigned_to. Nao troca a tarefa de projeto.",
  inputSchema: {
    task_id: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    delivery_type: z.enum(TASK_DELIVERY_TYPE_VALUES).optional(),
    due_date: z.string().nullable().optional().describe("ISO date (YYYY-MM-DD) ou null para limpar."),
    assigned_to: z.string().uuid().nullable().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    if (typeof input.due_date === "string" && !isValidIsoDate(input.due_date)) {
      return { content: [{ type: "text", text: "due_date precisa ser data ISO real (YYYY-MM-DD) ou null." }], isError: true };
    }
    const patch: Record<string, unknown> = {};
    for (const campo of ["title", "description", "priority", "delivery_type", "due_date", "assigned_to"] as const) {
      if (input[campo] !== undefined) patch[campo] = input[campo];
    }
    if (input.status !== undefined) {
      // O Kanban lê kanban_status; deixar só status atualizado esconderia a
      // mudança da tela. Os dois andam juntos, como no create_task.
      const status = normalizeTaskStatus(input.status);
      patch.status = status;
      patch.kanban_status = status;
    }
    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text", text: "Informe ao menos um campo para atualizar." }], isError: true };
    }
    const { data: existente } = await sb.from("tasks").select("id, deleted_at").eq("id", input.task_id).maybeSingle();
    if (!existente || existente.deleted_at) {
      return { content: [{ type: "text", text: "Tarefa nao encontrada no seu acesso atual." }], isError: true };
    }
    const { data, error } = await sb.from("tasks").update(patch).eq("id", input.task_id)
      .select("id, project_id, title, status, kanban_status, priority, delivery_type, due_date, assigned_to").single();
    if (error) return { content: [{ type: "text", text: `Nao foi possivel atualizar: ${error.message}` }], isError: true };
    return {
      content: [{ type: "text", text: `Tarefa atualizada: ${data.title}.` }],
      structuredContent: { task: data },
    };
  },
});
