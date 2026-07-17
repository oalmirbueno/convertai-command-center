import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "Listar projetos",
  description: "Lista projetos visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("Filtrar por cliente."),
    status: z.string().optional().describe("Filtrar por status do projeto."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    let q = sb.from("projects")
      .select("id, name, status, progress, client_id, created_at, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 50);
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `${data?.length ?? 0} projetos.` }],
      structuredContent: { projects: data ?? [] },
    };
  },
});
