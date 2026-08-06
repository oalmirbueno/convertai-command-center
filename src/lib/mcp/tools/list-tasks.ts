import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { taskStatusFilter, TASK_STATUS_VALUES } from "../compat";
import {
  buildPageMeta,
  TASK_DELIVERY_TYPE_VALUES,
  TASK_WORKSTREAM_VALUES,
} from "../editorial";
import {
  mcpScopeAllowsClient,
  resolveMcpClientScope,
} from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "Listar tarefas",
  description: "Lista tarefas do Kanban visíveis ao usuário autenticado (RLS aplicado).",
  inputSchema: {
    client_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    workstream: z.enum(TASK_WORKSTREAM_VALUES).optional(),
    delivery_type: z.enum(TASK_DELIVERY_TYPE_VALUES).optional(),
    source: z.string().trim().min(1).max(200).optional()
      .describe("Correspondência exata da origem da tarefa."),
    only_open: z.boolean().optional()
      .describe("Exclui tarefas done, archived e cancelled."),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const pageLimit = input.limit ?? 100;
    const pageOffset = input.offset ?? 0;
    const scopeResult = await resolveMcpClientScope(sb, ctx.getUserId());
    if (scopeResult.error) {
      return {
        content: [{ type: "text", text: "Não foi possível resolver as tarefas autorizadas." }],
        isError: true,
      };
    }
    const scope = scopeResult.scope;
    if (input.client_id && !mcpScopeAllowsClient(scope, input.client_id)) {
      return {
        content: [{ type: "text", text: "Cliente não encontrado no acesso atual." }],
        isError: true,
      };
    }
    if (!scope.unrestricted && scope.clientIds.length === 0) {
      return {
        content: [{ type: "text", text: "0 tarefas." }],
        structuredContent: {
          tasks: [],
          meta: buildPageMeta(0, 0, pageOffset, pageLimit),
        },
      };
    }
    let q = sb.from("tasks")
      .select(
        "id, title, description, status, priority, due_date, project_id, assigned_to, workstream, delivery_type, source, created_at, updated_at, projects!inner(client_id)",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(pageOffset, pageOffset + pageLimit - 1);
    if (input.client_id) q = q.eq("projects.client_id", input.client_id);
    else if (!scope.unrestricted) {
      q = q.in("projects.client_id", scope.clientIds);
    }
    if (input.project_id) q = q.eq("project_id", input.project_id);
    if (input.status) {
      const statuses = taskStatusFilter(input.status);
      q = statuses.length === 1
        ? q.eq("status", statuses[0])
        : q.in("status", statuses);
    }
    if (input.workstream) q = q.eq("workstream", input.workstream);
    if (input.delivery_type) q = q.eq("delivery_type", input.delivery_type);
    if (input.source) q = q.eq("source", input.source);
    if (input.only_open) {
      q = q.not("status", "in", "(done,archived,cancelled)");
    }
    const { data, error, count } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const tasks = (data ?? []).map((row) => {
      const { projects: _projects, ...task } = row;
      const projectScope = Array.isArray(_projects) ? _projects[0] : _projects;
      return { ...task, client_id: projectScope?.client_id ?? null };
    });
    const meta = buildPageMeta(
      count ?? tasks.length,
      tasks.length,
      pageOffset,
      pageLimit,
    );
    return {
      content: [{ type: "text", text: `${tasks.length} tarefas.` }],
      structuredContent: { tasks, meta },
    };
  },
});
