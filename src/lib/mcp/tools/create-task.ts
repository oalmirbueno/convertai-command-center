import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_task",
  title: "Criar tarefa",
  description: "Cria uma nova tarefa em um projeto (respeita RLS do usuário autenticado).",
  inputSchema: {
    project_id: z.string().uuid().describe("ID do projeto."),
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    status: z.enum(["todo", "doing", "review", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb.from("tasks").insert({
      project_id: input.project_id,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      due_date: input.due_date ?? null,
    }).select().single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Tarefa criada: ${data.id}` }],
      structuredContent: { task: data },
    };
  },
});
