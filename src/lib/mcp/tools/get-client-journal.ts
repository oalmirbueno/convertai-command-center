import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * Recuperado do bundle: uma sessão antiga escreveu a ferramenta só em
 * supabase/functions/mcp/index.ts. Sem este arquivo, o próximo build
 * regenerado apagaria a ferramenta do servidor em silêncio.
 */
export default defineTool({
  name: "get_client_journal",
  title: "Ler o diario e o retrato do cliente",
  description:
    "Puxa o contexto vivo de um cliente: notas do diario, materiais enviados/aprovados, publicacoes agendadas e no ar, e atualizacoes publicadas. Use antes de escrever qualquer coisa sobre o cliente.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente."),
    limit: z.number().int().min(1).max(100).optional().describe("Maximo de itens por fonte (padrao 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, limit }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const max = limit ?? 25;
    const projects = await sb.from("projects").select("id, name, status, billing_mode, deadline").eq("client_id", client_id).is("deleted_at", null);
    const projectIds = (projects.data || []).map((row) => row.id);
    const [notes, files, publications, reports] = await Promise.all([
      projectIds.length
        ? sb.from("updates").select("message, update_type, client_visible, created_at").in("project_id", projectIds).order("created_at", { ascending: false }).limit(max)
        : Promise.resolve({ data: [] }),
      sb.from("files").select("file_name, visibility, approval_status, approval_requested_at, client_decided_at, created_at").eq("client_id", client_id).is("archived_at", null).is("parent_file_id", null).order("created_at", { ascending: false }).limit(max),
      sb.from("editorial_publications").select("status, platform, scheduled_at, published_at, permalink, delivery_mode").eq("client_id", client_id).order("scheduled_at", { ascending: false }).limit(max),
      sb.from("reports").select("title, status, created_at, period_start, period_end").eq("client_id", client_id).order("created_at", { ascending: false }).limit(max),
    ]);
    const payload = {
      projects: projects.data || [],
      journal_notes: notes.data || [],
      files: files.data || [],
      publications: publications.data || [],
      reports: reports.data || [],
    };
    return {
      content: [{ type: "text", text: `Contexto do cliente: ${(projects.data || []).length} projeto(s), ${(notes.data || []).length} nota(s), ${(files.data || []).length} arquivo(s), ${(publications.data || []).length} publicacao(oes), ${(reports.data || []).length} relatorio(s).` }],
      structuredContent: payload,
    };
  },
});
