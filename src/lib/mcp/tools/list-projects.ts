import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { buildPageMeta } from "../editorial";
import {
  mcpScopeAllowsClient,
  resolveMcpClientScope,
} from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "Listar projetos",
  description: "Lista projetos visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    client_id: z.string().uuid().optional().describe("Filtrar por cliente."),
    status: z.string().optional().describe("Filtrar por status do projeto."),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, status, limit, offset }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const pageLimit = limit ?? 50;
    const pageOffset = offset ?? 0;
    const scopeResult = await resolveMcpClientScope(sb, ctx.getUserId());
    if (scopeResult.error) {
      return {
        content: [{ type: "text", text: "Não foi possível resolver os projetos autorizados." }],
        isError: true,
      };
    }
    const scope = scopeResult.scope;
    if (client_id && !mcpScopeAllowsClient(scope, client_id)) {
      return {
        content: [{ type: "text", text: "Cliente não encontrado no acesso atual." }],
        isError: true,
      };
    }
    if (!scope.unrestricted && scope.clientIds.length === 0) {
      return {
        content: [{ type: "text", text: "0 projetos." }],
        structuredContent: {
          projects: [],
          meta: buildPageMeta(0, 0, pageOffset, pageLimit),
        },
      };
    }
    let q = sb.from("projects")
      .select(
        "id, name, status, progress, client_id, created_at, updated_at",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pageOffset, pageOffset + pageLimit - 1);
    if (client_id) q = q.eq("client_id", client_id);
    else if (!scope.unrestricted) q = q.in("client_id", scope.clientIds);
    if (status) q = q.eq("status", status);
    const { data, error, count } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const projects = data ?? [];
    const meta = buildPageMeta(
      count ?? projects.length,
      projects.length,
      pageOffset,
      pageLimit,
    );
    return {
      content: [{ type: "text", text: `${projects.length} projetos.` }],
      structuredContent: { projects, meta },
    };
  },
});
