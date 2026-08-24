import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * Concluir é a escrita mais frequente de um agente que executa rotina; ter
 * verbo próprio evita o update genérico com status errado. Recusa concluir
 * de novo: o replay silencioso esconderia um agente rodando em círculo.
 */
export default defineTool({
  name: "complete_task",
  title: "Concluir tarefa",
  description: "Marca uma tarefa como concluida (status=done). Recusa tarefa ja concluida. Sem outros efeitos.",
  inputSchema: {
    task_id: z.string().uuid(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ task_id }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const { data: existente } = await sb.from("tasks").select("id, title, status, deleted_at").eq("id", task_id).maybeSingle();
    if (!existente || existente.deleted_at) {
      return { content: [{ type: "text", text: "Tarefa nao encontrada no seu acesso atual." }], isError: true };
    }
    if (existente.status === "done") {
      return { content: [{ type: "text", text: `"${existente.title}" ja esta concluida.` }], isError: true };
    }
    const { data, error } = await sb.from("tasks").update({ status: "done", kanban_status: "done" }).eq("id", task_id)
      .select("id, project_id, title, status, kanban_status").single();
    if (error) return { content: [{ type: "text", text: `Nao foi possivel concluir: ${error.message}` }], isError: true };
    return {
      content: [{ type: "text", text: `Concluida: ${data.title}.` }],
      structuredContent: { task: data },
    };
  },
});
