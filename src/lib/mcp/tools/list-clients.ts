import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sanitizeProfileSearch } from "../compat";
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

    const { data: clientRoles, error: rolesError } = await sb
      .from("user_roles")
      .select("user_id")
      .eq("role", "client")
      .limit(1000);
    if (rolesError) {
      return { content: [{ type: "text", text: rolesError.message }], isError: true };
    }

    const clientIds = [...new Set((clientRoles ?? []).map((row) => row.user_id))];
    if (clientIds.length === 0) {
      return {
        content: [{ type: "text", text: "0 clientes." }],
        structuredContent: { clients: [] },
      };
    }

    let q = sb.from("profiles")
      .select("id, full_name, email, company_name, plan_status, plan_name, client_type, created_at")
      .in("id", clientIds)
      .is("deleted_at", null)
      .limit(limit ?? 50)
      .order("created_at", { ascending: false });
    const safeSearch = sanitizeProfileSearch(search);
    if (safeSearch) {
      q = q.or(
        `full_name.ilike.%${safeSearch}%,company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`,
      );
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const clients = (data ?? []).map((client) => ({
      ...client,
      status: client.plan_status,
    }));
    return {
      content: [{ type: "text", text: `${clients.length} clientes.` }],
      structuredContent: { clients },
    };
  },
});
