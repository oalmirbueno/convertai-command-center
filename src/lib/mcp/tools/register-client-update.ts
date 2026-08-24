import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

/**
 * Este arquivo nasceu DEPOIS do bundle: uma sessão antiga escreveu a
 * ferramenta direto em supabase/functions/mcp/index.ts e esqueceu a fonte.
 * Como o bundle é regenerado a partir daqui, a ferramenta ia sumir no
 * próximo build. O teste mcp-poder-total agora compara os dois conjuntos.
 */
export default defineTool({
  name: "register_client_update",
  title: "Registrar atualizacao no diario do cliente",
  description:
    "Registra no Diario do Trabalho o que foi feito, por que e o proximo passo. O cliente ve a ACAO em tempo real no painel (sem autor). Use client_visible=false para nota interna da equipe.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente dono do diario."),
    message: z.string().min(5).max(4000).describe("O que foi feito, por que foi feito e qual o proximo passo."),
    client_visible: z.boolean().optional().describe("true (padrao) = cliente ve; false = nota interna."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ client_id, message, client_visible }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const projects = await sb.from("projects").select("id").eq("client_id", client_id).is("deleted_at", null).limit(1);
    const project = projects.data && projects.data[0];
    if (!project) {
      return { content: [{ type: "text", text: "Cliente sem projeto ativo: crie um projeto antes de registrar o diario." }], isError: true };
    }
    const { error } = await sb.from("updates").insert({
      project_id: project.id,
      author_id: ctx.getUserId(),
      message,
      update_type: "progress",
      client_visible: client_visible !== false,
    });
    if (error) {
      return { content: [{ type: "text", text: `Nao foi possivel registrar: ${error.message}` }], isError: true };
    }
    return { content: [{ type: "text", text: "Atualizacao registrada. O cliente ja ve no Diario do Trabalho." }] };
  },
});
