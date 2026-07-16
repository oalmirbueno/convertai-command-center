import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "Listar tarefas",
  description: "Lista tarefas do Kanban visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    project_id: z.string().uuid().optional(),
    status: z.enum(["todo", "doing", "review", "done"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id, status, limit }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    let q = sb.from("tasks")
      .select("id, title, description, status, priority, due_date, project_id, assigned_to, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 100);
    if (project_id) q = q.eq("project_id", project_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `${data?.length ?? 0} tarefas.` }],
      structuredContent: { tasks: data ?? [] },
    };
  },
});
