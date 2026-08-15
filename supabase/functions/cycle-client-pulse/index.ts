// Aceleriq OS — Bastidores da semana, do lado do cliente
//
// O ciclo interno é o trabalho que ninguém vê: conteúdo criado, painel
// atualizado, aprovação enviada, posts agendados. Esta função traduz esse
// checklist em uma leitura simples para o dono do negócio, sem jargão e sem
// expor a operação interna: quantas frentes andaram, o que já aconteceu nesta
// semana e quando foi a última movimentação.
//
// Segurança: a tabela do ciclo é da equipe (RLS não libera para o cliente),
// então a leitura usa service role SÓ depois de confirmar, com o JWT de quem
// chamou, que a pessoa pode acessar aquele cliente. Nenhum dado de outro
// cliente sai daqui, e nomes de etapa interna nunca são devolvidos crus.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

// O que cada etapa significa para quem contratou o serviço. É a tradução do
// bastidor: fala do resultado, não do processo interno.
const CLIENT_FACING: Record<string, string[]> = {
  social: [
    "conteúdo da semana criado",
    "material organizado no painel",
    "contas conferidas",
    "painel e agenda atualizados",
    "conteúdo enviado para sua aprovação",
    "publicações agendadas",
  ],
  trafego: [
    "campanhas revisadas",
    "criativos da semana prontos",
    "anúncios atualizados",
    "verba conferida",
    "resultados analisados",
    "leitura registrada no painel",
  ],
};
const AREA_LABEL: Record<string, string> = {
  social: "Redes sociais",
  trafego: "Tráfego pago",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mondayOfUtc(base: Date): string {
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Sessão expirada." }, 401);
    }

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);

    const body = await req.json().catch(() => ({}));
    const clientId = String(body?.client_id || "").trim() || userData.user.id;

    // O portão: só passa quem pode ver aquele cliente (o próprio dono ou a
    // equipe que o atende). A checagem roda com o JWT de quem chamou.
    const { data: canAccess, error: accessError } = await caller.rpc(
      "can_access_client", { _client_id: clientId },
    );
    if (accessError || canAccess !== true) return jsonResponse({ error: "Sem acesso." }, 403);

    const weekStart = mondayOfUtc(new Date());
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: rows, error: rowsError } = await admin
      .from("weekly_cycle_progress")
      .select("area, step, done_at")
      .eq("client_id", clientId)
      .eq("week_start", weekStart);
    if (rowsError) return jsonResponse({ error: "Não foi possível ler a semana." }, 500);

    const marks = rows || [];
    if (marks.length === 0) return jsonResponse({ week_start: weekStart, fronts: [], total: 0 });

    // Só o ciclo semanal (1 a 6) vira leitura de cliente. As etapas de
    // onboarding são conversa interna e ficam fora.
    const fronts = ["social", "trafego"]
      .map((area) => {
        const steps = marks
          .filter((row: any) => row.area === area && row.step <= 6)
          .sort((a: any, b: any) => a.step - b.step);
        if (steps.length === 0) return null;
        return {
          area,
          label: AREA_LABEL[area],
          done: steps.length,
          total: 6,
          highlights: steps.map((row: any) => CLIENT_FACING[area][row.step - 1]),
          last_at: steps
            .map((row: any) => row.done_at)
            .filter(Boolean)
            .sort()
            .pop() || null,
        };
      })
      .filter(Boolean);

    const total = fronts.reduce((sum: number, front: any) => sum + front.done, 0);
    return jsonResponse({ week_start: weekStart, fronts, total });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      500,
    );
  }
});
