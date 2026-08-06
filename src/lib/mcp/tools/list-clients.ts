import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sanitizeProfileSearch } from "../compat";
import { buildPageMeta } from "../editorial";
import { resolveMcpClientScope } from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_clients",
  title: "Listar clientes",
  description: "Lista clientes visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    limit: z.number().int().min(1).max(500).optional().describe("Máximo de registros (padrão 50)."),
    offset: z.number().int().min(0).optional().describe("Deslocamento da página (padrão 0)."),
    search: z.string().optional().describe("Filtro por nome ou empresa."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, offset, search }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const pageLimit = limit ?? 50;
    const pageOffset = offset ?? 0;
    const scopeResult = await resolveMcpClientScope(sb, ctx.getUserId());
    if (scopeResult.error) {
      return {
        content: [{ type: "text", text: "Não foi possível resolver os clientes autorizados." }],
        isError: true,
      };
    }
    const scope = scopeResult.scope;
    if (!scope.unrestricted && scope.clientIds.length === 0) {
      return {
        content: [{ type: "text", text: "0 clientes." }],
        structuredContent: {
          clients: [],
          meta: buildPageMeta(0, 0, pageOffset, pageLimit),
        },
      };
    }
    let q = sb.from("profiles")
      .select(
        "id, full_name, company_name, plan_status, plan_name, client_type, created_at, client_roles:user_roles!inner(role)",
        { count: "exact" },
      )
      .eq("client_roles.role", "client")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pageOffset, pageOffset + pageLimit - 1);
    if (!scope.unrestricted) q = q.in("id", scope.clientIds);
    const safeSearch = sanitizeProfileSearch(search);
    if (safeSearch) {
      q = q.or(
        `full_name.ilike.%${safeSearch}%,company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`,
      );
    }
    const { data, error, count } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const clients = (data ?? []).map((client) => {
      const { client_roles: _roles, ...profile } = client;
      return { ...profile, status: client.plan_status };
    });
    const meta = buildPageMeta(
      count ?? clients.length,
      clients.length,
      pageOffset,
      pageLimit,
    );
    return {
      content: [{ type: "text", text: `${clients.length} clientes.` }],
      structuredContent: { clients, meta },
    };
  },
});
