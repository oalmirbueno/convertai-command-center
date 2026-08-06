import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { normalizeTaskStatus } from "../compat";
import {
  EDITORIAL_CREATE_STATUS_VALUES,
  EDITORIAL_DELIVERY_TYPE_VALUES,
  editorialRequestFingerprint,
  editorialWorkstreamFor,
  isValidIsoDate,
  type EditorialDeliveryType,
} from "../editorial";
import {
  mcpScopeAllowsClient,
  resolveMcpClientScope,
} from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

const RETURN_FIELDS = [
  "id",
  "project_id",
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "assigned_to",
  "workstream",
  "delivery_type",
  "source",
  "created_at",
  "updated_at",
].join(", ");

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  workstream: string;
  delivery_type: string;
  source: string | null;
  created_at: string;
  updated_at: string;
};

function databaseError(code?: string) {
  const reference = code ? ` (${code})` : "";
  return {
    content: [{
      type: "text" as const,
      text: `Não foi possível criar o item editorial com o acesso atual${reference}.`,
    }],
    isError: true as const,
  };
}

function replayResult(task: TaskRow) {
  return {
    content: [{
      type: "text" as const,
      text: `Item editorial já existia: ${task.id}`,
    }],
    structuredContent: { task, replayed: true },
  };
}

export default defineTool({
  name: "create_editorial_item",
  title: "Criar item editorial",
  description:
    "Cria uma entrega publicável no Kanban editorial do cliente. Não aprova, não agenda e não publica. Usa a sessão OAuth, valida cliente/projeto e respeita RLS.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente obrigatório."),
    project_id: z.string().uuid().describe("Projeto pertencente ao cliente."),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4_000)
      .describe("Briefing, objetivo e contexto necessário para produzir a peça."),
    format: z.enum(EDITORIAL_DELIVERY_TYPE_VALUES)
      .describe("Formato publicável: arte, carrossel, vídeo ou equivalente editorial."),
    due_date: z.string().refine(isValidIsoDate)
      .describe("Data editorial obrigatória (YYYY-MM-DD)."),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    status: z.enum(EDITORIAL_CREATE_STATUS_VALUES).optional()
      .describe("Estado de produção. approved/done não são aceitos por esta ferramenta."),
    assigned_to: z.string().uuid().optional(),
    idempotency_key: z.string().uuid()
      .describe("UUID estável e único da operação. Repetir o mesmo UUID não duplica a tarefa."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx);
    if (guard) return guard;

    const sb = supabaseForUser(ctx);
    const actorId = ctx.getUserId();
    const scopeResult = await resolveMcpClientScope(sb, actorId);
    if (scopeResult.error) return databaseError(scopeResult.error.code);
    if (!mcpScopeAllowsClient(scopeResult.scope, input.client_id)) {
      return {
        content: [{
          type: "text",
          text: "Cliente não encontrado no acesso editorial atual.",
        }],
        isError: true,
      };
    }
    if (input.assigned_to && input.assigned_to !== actorId) {
      return {
        content: [{
          type: "text",
          text: "assigned_to só pode ser o próprio usuário autenticado nesta ferramenta.",
        }],
        isError: true,
      };
    }
    const { data: project, error: projectError } = await sb
      .from("projects")
      .select("id")
      .eq("id", input.project_id)
      .eq("client_id", input.client_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (projectError) return databaseError(projectError.code);
    if (!project) {
      return {
        content: [{
          type: "text",
          text: "Projeto não encontrado neste cliente ou sem acesso pela sessão atual.",
        }],
        isError: true,
      };
    }

    const deliveryType = input.format as EditorialDeliveryType;
    const status = normalizeTaskStatus(input.status);
    const initialTaskFields = {
      project_id: input.project_id,
      title: input.title,
      description: input.description,
      status,
      priority: input.priority ?? "medium",
      due_date: input.due_date,
      assigned_to: input.assigned_to ?? null,
      workstream: editorialWorkstreamFor(deliveryType),
      delivery_type: deliveryType,
    };
    const fingerprint = await editorialRequestFingerprint({
      client_id: input.client_id,
      ...initialTaskFields,
    });
    const source = `mcp:editorial:${input.idempotency_key}:${fingerprint}`;
    const expected = {
      ...initialTaskFields,
      source,
    };
    const findExisting = () => sb
      .from("tasks")
      .select(RETURN_FIELDS)
      .eq("id", input.idempotency_key)
      .maybeSingle();
    const { data: existing, error: existingError } = await findExisting();
    if (existingError) return databaseError(existingError.code);
    if (existing) {
      const task = existing as TaskRow;
      if (task.project_id === input.project_id && task.source === source) {
        return replayResult(task);
      }
      return {
        content: [{
          type: "text",
          text: "idempotency_key já foi usada por outra operação.",
        }],
        isError: true,
      };
    }

    const { data, error } = await sb
      .from("tasks")
      .insert({
        id: input.idempotency_key,
        ...expected,
        kanban_status: status,
      })
      .select(RETURN_FIELDS)
      .single();

    if (error) {
      // The deterministic task UUID also closes the concurrent retry race.
      if (error.code === "23505") {
        const { data: replay, error: replayError } = await findExisting();
        if (!replayError && replay) {
          const task = replay as TaskRow;
          if (task.project_id === input.project_id && task.source === source) {
            return replayResult(task);
          }
        }
      }
      return databaseError(error.code);
    }

    return {
      content: [{ type: "text", text: `Item editorial criado: ${data.id}` }],
      structuredContent: { task: data as TaskRow, replayed: false },
    };
  },
});
