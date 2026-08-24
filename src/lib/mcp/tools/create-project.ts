import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isValidIsoDate } from "../editorial";
import { mcpScopeAllowsClient, resolveMcpClientScope } from "../client-scope";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * A ferramenta que faltava por inteiro: os agentes liam projetos mas não
 * podiam abrir um. Cria SÓ a parte operacional — cobrança (billing_mode,
 * total_value) e marca ficam de fora de propósito: dinheiro entra pelo
 * painel, onde o plano financeiro é gerado junto e conferido por gente.
 */
export default defineTool({
  name: "create_project",
  title: "Criar projeto",
  description:
    "Cria um projeto para um cliente (respeita RLS do usuario autenticado). Campos operacionais apenas: nome, tipo, datas, escopo e objetivos. NAO define cobranca nem valores - isso e feito no painel, onde o plano financeiro nasce junto.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente dono do projeto."),
    name: z.string().min(1).max(200).describe("Nome do projeto."),
    project_type: z.string().min(1).max(64).describe("Tipo (ex.: social_media, site, automacao, evento)."),
    start_date: z.string().describe("Inicio, ISO (YYYY-MM-DD)."),
    deadline: z.string().describe("Prazo, ISO (YYYY-MM-DD)."),
    description: z.string().max(8000).optional(),
    scope: z.string().max(8000).optional(),
    objectives: z.string().max(8000).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    if (!isValidIsoDate(input.start_date) || !isValidIsoDate(input.deadline)) {
      return { content: [{ type: "text", text: "start_date e deadline precisam ser datas ISO reais (YYYY-MM-DD)." }], isError: true };
    }
    if (input.deadline < input.start_date) {
      return { content: [{ type: "text", text: "deadline nao pode ser antes de start_date." }], isError: true };
    }
    const actorId = ctx.getUserId();
    const scopeResult = await resolveMcpClientScope(sb, actorId);
    if (scopeResult.error) {
      return { content: [{ type: "text", text: "Nao foi possivel resolver o acesso a clientes." }], isError: true };
    }
    if (!mcpScopeAllowsClient(scopeResult.scope, input.client_id)) {
      return { content: [{ type: "text", text: "Cliente nao encontrado no seu acesso atual." }], isError: true };
    }
    const { data, error } = await sb.from("projects").insert({
      client_id: input.client_id,
      name: input.name,
      description: input.description ?? null,
      project_type: input.project_type,
      status: "planning",
      progress: 0,
      start_date: input.start_date,
      deadline: input.deadline,
      scope: input.scope ?? null,
      objectives: input.objectives ?? null,
      created_by: actorId,
    }).select("id, client_id, name, project_type, status, start_date, deadline").single();
    if (error) return { content: [{ type: "text", text: `Nao foi possivel criar: ${error.message}` }], isError: true };
    return {
      content: [{ type: "text", text: `Projeto criado: ${data.name} (${data.id}). Cobranca e valores, se houver, configure no painel.` }],
      structuredContent: { project: data },
    };
  },
});
