import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isValidIsoDate } from "../editorial";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * Atualiza SÓ o operacional. Cliente, cobrança (billing_mode, total_value),
 * marca e propriedade ficam fora da lista de campos de propósito: mover
 * projeto de cliente ou mexer em dinheiro é decisão de painel, com gente
 * olhando. A lista branca abaixo é a fronteira inteira.
 */
const CAMPOS = ["name", "description", "status", "project_type", "start_date", "deadline", "progress", "scope", "objectives"] as const;

export default defineTool({
  name: "update_project",
  title: "Atualizar projeto",
  description:
    "Atualiza campos operacionais de um projeto: name, description, status (planning/active/done/paused/standby/cancelled), project_type, start_date, deadline, progress 0-100, scope, objectives. Nao altera cliente, cobranca nem valores.",
  inputSchema: {
    project_id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(8000).nullable().optional(),
    status: z.enum(["planning", "active", "done", "paused", "standby", "cancelled"]).optional(),
    project_type: z.string().min(1).max(64).optional(),
    start_date: z.string().optional(),
    deadline: z.string().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    scope: z.string().max(8000).nullable().optional(),
    objectives: z.string().max(8000).nullable().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    for (const campo of ["start_date", "deadline"] as const) {
      const valor = input[campo];
      if (valor !== undefined && !isValidIsoDate(valor)) {
        return { content: [{ type: "text", text: `${campo} precisa ser data ISO real (YYYY-MM-DD).` }], isError: true };
      }
    }
    const patch: Record<string, unknown> = {};
    for (const campo of CAMPOS) {
      if (input[campo] !== undefined) patch[campo] = input[campo];
    }
    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text", text: "Informe ao menos um campo para atualizar." }], isError: true };
    }
    // Busca antes de escrever: RLS decide o acesso, e "não achei" vira
    // resposta clara em vez de um update que afeta zero linhas em silêncio.
    const { data: existente } = await sb.from("projects").select("id, deleted_at").eq("id", input.project_id).maybeSingle();
    if (!existente || existente.deleted_at) {
      return { content: [{ type: "text", text: "Projeto nao encontrado no seu acesso atual." }], isError: true };
    }
    const { data, error } = await sb.from("projects").update(patch).eq("id", input.project_id)
      .select("id, client_id, name, project_type, status, progress, start_date, deadline").single();
    if (error) return { content: [{ type: "text", text: `Nao foi possivel atualizar: ${error.message}` }], isError: true };
    return {
      content: [{ type: "text", text: `Projeto atualizado: ${data.name}.` }],
      structuredContent: { project: data },
    };
  },
});
