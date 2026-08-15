// Aceleriq OS — Coach do Ciclo da Semana
//
// Lê o checklist semanal (weekly_cycle_progress) da semana pedida e da
// anterior, cruza com a carteira, e devolve um conselho curto de onde focar:
// quem está parado, o que ficou herdado da semana passada, o que fechar
// primeiro. A IA escreve o texto; se toda a cadeia de IA falhar, um coach
// determinístico monta o mesmo conselho a partir dos números — a tela nunca
// fica sem resposta.
//
// Segurança: leitura com o JWT do chamador (RLS decide o alcance; a tabela do
// ciclo é da equipe). Nada é gravado.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";

const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];

const STEP_LABELS: Record<string, string[]> = {
  social: [
    "conteúdo criado",
    "subir no painel",
    "conta conectada",
    "painel atualizado",
    "aprovação e ritual",
    "posts agendados",
  ],
  trafego: [
    "campanhas revisadas",
    "criativos prontos",
    "anúncios no ar",
    "verba conferida",
    "métricas lidas",
    "registro no painel",
  ],
};
const ONBOARDING_LABELS = [
  "acessos e briefing",
  "contas conectadas",
  "estratégia aprovada",
  "rotina rodando",
];

const SYSTEM_PROMPT = `Você é o coach de operação de uma agência de growth marketing brasileira (Aceleriq). O leitor é o dono da agência, olhando o checklist semanal da carteira no celular.

REGRAS:
1. 2 a 4 frases em português claro do Brasil, tom direto de sócio experiente, SEM TRAVESSÃO (use vírgula ou ponto), sem jargão e sem listas.
2. Use SOMENTE os fatos fornecidos. Nunca invente cliente, número ou etapa.
3. Priorize: (a) cliente com semana zerada, (b) etapa herdada da semana passada, (c) o que destrava o resto (aprovação antes de agendamento, por exemplo). Cite os clientes pelo nome.
4. Se a semana está bem, diga isso e aponte o próximo fechamento mais próximo.
5. Responda SOMENTE com JSON válido: {"coach":"..."}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): { coach?: string } {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta sem JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Sessão expirada." }, 401);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);

    const body = await req.json().catch(() => ({}));
    const area = body?.area === "trafego" ? "trafego" : "social";
    const weekStart = String(body?.week_start || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return jsonResponse({ error: "week_start inválido." }, 400);
    }
    const prevWeek = (() => {
      const d = new Date(`${weekStart}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 7);
      return d.toISOString().slice(0, 10);
    })();

    // O papel vive em user_roles, não em profiles: sem esse passo a carteira
    // volta vazia e o coach nunca aparece.
    const { data: clientRoles } = await db
      .from("user_roles")
      .select("user_id")
      .eq("role", "client");
    const clientIds = (clientRoles || []).map((row: any) => row.user_id);
    if (clientIds.length === 0) return jsonResponse({ coach: null });

    const [clientsRes, rowsRes] = await Promise.all([
      db.from("profiles")
        .select("id, company_name, full_name, plan_status, client_type, onboarding_done, services_config")
        .in("id", clientIds)
        .is("deleted_at", null),
      db.from("weekly_cycle_progress")
        .select("client_id, week_start, step, area")
        .eq("area", area)
        .in("week_start", [weekStart, prevWeek]),
    ]);

    // RLS devolve vazio para quem não é da equipe: sem carteira, sem coach.
    // O recorte é o mesmo da tela: empresa interna fora, e só quem contratou
    // a frente que está sendo lida.
    const clients = (clientsRes.data || []).filter(
      (c: any) =>
        (c.plan_status || "active") === "active" &&
        (c.client_type || "recurring") !== "one_off" &&
        c.services_config?.internal_company !== true &&
        c.services_config?.[area] === true,
    );
    if (clients.length === 0) return jsonResponse({ coach: null });

    const doneNow = new Map<string, Set<number>>();
    const donePrev = new Map<string, Set<number>>();
    for (const row of rowsRes.data || []) {
      const target = row.week_start === weekStart ? doneNow : donePrev;
      if (!target.has(row.client_id)) target.set(row.client_id, new Set());
      target.get(row.client_id)!.add(row.step);
    }

    const labels = STEP_LABELS[area];
    let closed = 0;
    const lines: string[] = [];
    for (const client of clients) {
      const name = client.company_name || client.full_name || "Cliente";
      // Onboarding é o estado do cadastro, não a idade dele: cliente que já
      // roda em rotina não volta a ser tratado como novo.
      const isNew = client.onboarding_done === false;
      const total = labels.length + (isNew ? ONBOARDING_LABELS.length : 0);
      const done = doneNow.get(client.id) || new Set<number>();
      const prevDone = donePrev.get(client.id) || new Set<number>();
      const doneCount = Array.from({ length: total }, (_, i) => (done.has(i + 1) ? 1 : 0))
        .reduce((a: number, b) => a + b, 0);
      if (doneCount >= total) { closed += 1; continue; }
      const firstMissing = Array.from({ length: total }, (_, i) => i + 1)
        .find((step) => !done.has(step))!;
      const missingLabel = firstMissing <= labels.length
        ? labels[firstMissing - 1]
        : ONBOARDING_LABELS[firstMissing - labels.length - 1];
      const inherited = prevDone.size > 0 && prevDone.size < labels.length;
      lines.push(
        `${name}${isNew ? " (cliente novo, em onboarding)" : ""}: ${doneCount}/${total} etapas, parado em "${missingLabel}"${inherited ? `, semana passada também ficou incompleta (${prevDone.size}/${labels.length})` : ""}${doneCount === 0 ? ", SEMANA AINDA ZERADA" : ""}`,
      );
    }

    const facts = [
      `Área: ${area === "social" ? "Social Media" : "Tráfego Pago"}`,
      `Semana: ${weekStart}`,
      `Clientes com semana fechada: ${closed} de ${clients.length}`,
      ...(lines.length ? ["Clientes em aberto:", ...lines] : ["Todos os clientes fecharam a semana."]),
    ].join("\n");

    // Coach de reserva, montado dos mesmos números: a tela nunca fica muda.
    const fallbackCoach = (() => {
      if (lines.length === 0) {
        return `Semana fechada para os ${clients.length} clientes da carteira. Aproveita para adiantar o conteúdo da próxima.`;
      }
      const zeroed = lines.filter((l) => l.includes("SEMANA AINDA ZERADA")).length;
      const first = lines[0].split(":")[0];
      const opening = zeroed > 0
        ? `${zeroed} ${zeroed === 1 ? "cliente ainda está" : "clientes ainda estão"} com a semana zerada.`
        : `${closed} de ${clients.length} clientes já fecharam a semana.`;
      return `${opening} Começa por ${first}, que é o ponto mais atrasado da carteira, e destrava primeiro as aprovações, porque agendamento depende delas.`;
    })();

    const aiCoach = await (async () => {
      try {
        const providers = resolveAiProviderChain({
          primaryModels: PRIMARY_MODEL_CHAIN,
          lovableModels: DEFAULT_LOVABLE_MODEL_CHAIN,
        });
        const { response, provider } = await requestAiChatCompletion(providers, {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `FATOS DA SEMANA (checklist real):\n${facts}` },
          ],
          temperature: 0.4,
        });
        if (!response.ok) {
          console.warn(`[coach] cadeia esgotada, último: ${provider.label} HTTP ${response.status}`);
          return null;
        }
        const completion = await response.json();
        const parsed = extractJson(completion?.choices?.[0]?.message?.content || "");
        return String(parsed?.coach || "").trim() || null;
      } catch (error) {
        console.warn(`[coach] falha: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    })();

    return jsonResponse({
      coach: aiCoach || fallbackCoach,
      source: aiCoach ? "ai" : "fallback",
      closed,
      total_clients: clients.length,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      500,
    );
  }
});
