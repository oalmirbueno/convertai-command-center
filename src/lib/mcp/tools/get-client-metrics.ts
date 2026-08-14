import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireAuth, supabaseForUser } from "../supabase";

// Metricas REAIS do Instagram coletadas da Meta pelo robo semanal do painel.
// Semanas fechadas (segunda a domingo) + mergulho por publicacao. RLS: staff
// ve os clientes autorizados; cliente ve so o proprio.
export default defineTool({
  name: "get_client_metrics",
  title: "Métricas reais do Instagram",
  description:
    "Retorna as métricas semanais reais do Instagram do cliente (seguidores, alcance, interações, visitas ao perfil) e o desempenho por publicação (curtidas, comentários, alcance, salvos, compartilhamentos). Use para dar direcionamento com números verdadeiros e entender a crescente. Dados coletados da Meta automaticamente toda semana.",
  inputSchema: {
    client_id: z.string().uuid().describe("Cliente dono da conta."),
    weeks: z.number().int().min(1).max(52).optional().describe("Semanas de histórico (padrão 8)."),
    include_posts: z.boolean().optional().describe("Incluir desempenho por publicação (padrão true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id, weeks, include_posts }, ctx) => {
    const guard = requireAuth(ctx); if (guard) return guard;
    const sb = supabaseForUser(ctx);
    const { data: weekRows, error: weekError } = await sb
      .from("social_metrics_weekly")
      .select("week_start, week_end, followers, media_count, reach, profile_views, accounts_engaged, total_interactions, captured_at")
      .eq("client_id", client_id)
      .order("week_start", { ascending: false })
      .limit(weeks ?? 8);
    if (weekError) {
      return { content: [{ type: "text", text: weekError.message }], isError: true };
    }
    let posts: unknown[] = [];
    if (include_posts !== false) {
      const { data: postRows, error: postError } = await sb
        .from("social_post_metrics")
        .select("media_id, media_type, caption, permalink, posted_at, like_count, comments_count, reach, saved, shares, total_interactions")
        .eq("client_id", client_id)
        .order("posted_at", { ascending: false })
        .limit(25);
      if (postError) {
        return { content: [{ type: "text", text: postError.message }], isError: true };
      }
      posts = postRows ?? [];
    }
    return {
      content: [{
        type: "text",
        text: `${weekRows?.length ?? 0} semanas de métricas e ${posts.length} publicações.`,
      }],
      structuredContent: { weeks: weekRows ?? [], posts },
    };
  },
});
