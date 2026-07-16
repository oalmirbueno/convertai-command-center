import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_clients",
  title: "Listar clientes",
  description: "Lista clientes visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de registros (padrão 50)."),
    search: z.string().optional().describe("Filtro por nome ou empresa."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, search }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    let q = sb.from("profiles")
      .select("id, full_name, email, company_name, status, created_at")
      .limit(limit ?? 50)
      .order("created_at", { ascending: false });
    if (search) q = q.or(`full_name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `${data?.length ?? 0} clientes.` }],
      structuredContent: { clients: data ?? [] },
    };
  },
});
