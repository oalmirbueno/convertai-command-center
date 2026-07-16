import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_contracts",
  title: "Listar contratos",
  description: "Lista contratos visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    client_id: z.string().uuid().optional(),
    status: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    let q = sb.from("contracts")
      .select("id, title, status, client_id, total_value, currency, start_date, end_date, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `${data?.length ?? 0} contratos.` }],
      structuredContent: { contracts: data ?? [] },
    };
  },
});
