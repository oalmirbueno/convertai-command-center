// Aceleriq OS — Registro da semana no segundo cérebro
//
// O ciclo é a memória operacional da agência: o que foi feito, para quem, em
// que semana. Esta função fecha essa memória escrevendo um resumo da semana
// na caixa de entrada do segundo cérebro, para que a rotina de uma semana não
// se perca quando a próxima começa.
//
// O resumo é agregado (frente, cliente, quantas etapas, o que ficou aberto) e
// nunca inclui dado sensível: sem contato, sem valor, sem credencial.
//
// Segurança: só admin. A leitura do ciclo usa service role depois da checagem
// de papel, porque o resumo cobre a carteira inteira.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  bridgeStatusPublic,
  proposeUpdate,
  SecondBrainError,
} from "../_shared/second-brain-github.ts";

const AREA_LABEL: Record<string, string> = {
  social: "Social Media",
  trafego: "Tráfego Pago",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mondayOfUtc(base: Date): string {
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Sessão expirada." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id, _role: "admin",
    });
    if (!isAdmin) return jsonResponse({ error: "Somente administrador." }, 403);

    // O registro da semana NÃO depende do Segundo Cérebro. Ele é gravado
    // primeiro na memória do painel (que sempre funciona e é de onde a Central
    // lê) e só então espelhado no repositório, se der. Antes, bridge fora do
    // ar significava semana não registrada em lugar nenhum.
    const espelhoDisponivel = bridgeStatusPublic().configured;

    const body = await req.json().catch(() => ({}));
    const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.week_start || ""))
      ? String(body.week_start)
      : mondayOfUtc(new Date());

    const [rowsRes, rolesRes] = await Promise.all([
      admin.from("weekly_cycle_progress")
        .select("client_id, area, step").eq("week_start", weekStart),
      admin.from("user_roles").select("user_id").eq("role", "client"),
    ]);
    const marks = rowsRes.data || [];
    if (marks.length === 0) {
      return jsonResponse({ configured: true, written: false, reason: "semana sem marcações" });
    }

    const clientIds = (rolesRes.data || []).map((row: any) => row.user_id);
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, company_name, full_name, services_config, onboarding_done")
      .in("id", clientIds)
      .is("deleted_at", null);

    const nameOf = new Map<string, string>();
    const carteira: Record<string, any[]> = { social: [], trafego: [] };
    for (const profile of profiles || []) {
      nameOf.set(profile.id, (profile as any).company_name || (profile as any).full_name || "Cliente");
      const services = (profile as any).services_config || {};
      if (services.internal_company === true) continue;
      for (const area of ["social", "trafego"]) {
        if (services[area] === true) carteira[area].push(profile);
      }
    }

    const linhas: string[] = [];
    let totalDone = 0;
    for (const area of ["social", "trafego"]) {
      const lista = carteira[area];
      if (lista.length === 0) continue;
      linhas.push(`\n### ${AREA_LABEL[area]}`);
      for (const client of lista) {
        const total = 6 + ((client as any).onboarding_done === false ? 4 : 0);
        const done = marks.filter(
          (row: any) => row.client_id === client.id && row.area === area,
        ).length;
        totalDone += done;
        const abertas = Array.from({ length: total }, (_, index) => index + 1).filter(
          (step) => !marks.some(
            (row: any) => row.client_id === client.id && row.area === area && row.step === step,
          ),
        );
        linhas.push(
          `- **${nameOf.get(client.id)}**: ${done}/${total}` +
            (abertas.length > 0 ? ` (aberto: ${abertas.join(", ")})` : " — semana fechada"),
        );
      }
    }

    const resumo =
      `Fechamento operacional da semana de ${weekStart}: ${totalDone} etapas do ciclo ` +
      `concluídas na carteira, distribuídas entre Social Media e Tráfego Pago.`;
    const corpo = linhas.join("\n");

    // 1) Painel: a gravação que sempre acontece. Uma entrada por cliente, para
    // a história de cada um receber a sua própria semana.
    let gravadosNoPainel = 0;
    for (const area of ["social", "trafego"]) {
      for (const client of carteira[area]) {
        const total = 6 + ((client as any).onboarding_done === false ? 4 : 0);
        const done = marks.filter(
          (row: any) => row.client_id === client.id && row.area === area,
        ).length;
        if (done === 0) continue;
        const { error } = await admin.from("project_memory").insert({
          client_id: client.id,
          kind: "ciclo",
          title: `Semana de ${weekStart} · ${AREA_LABEL[area]}`,
          content:
            `A operação de ${AREA_LABEL[area].toLowerCase()} concluiu ${done} de ${total} ` +
            `etapas do ciclo semanal para este cliente na semana de ${weekStart}.`,
          source: "ciclo-semanal",
          tags: [area, "semana", weekStart],
          metadata: { week_start: weekStart, area, done, total, client_visible: false },
          created_by: userData.user.id,
        } as any);
        if (!error) gravadosNoPainel += 1;
      }
    }

    // 2) Segundo Cérebro: espelho. Falhar aqui não invalida o registro acima.
    let espelho: { ok: boolean; path?: string; reason?: string } = {
      ok: false,
      reason: espelhoDisponivel ? undefined : "bridge não configurado",
    };
    if (espelhoDisponivel) {
      try {
        const result = await proposeUpdate({
          title: `Ciclo semanal da carteira — semana de ${weekStart}`,
          summary: resumo,
          origin: "aceleriq-os/ciclo-semanal",
          suggested_destination: "memory/operacao/ciclo-semanal.md",
          correlation_id: `ciclo-${weekStart}-${crypto.randomUUID()}`,
          context:
            "Registro automático do checklist semanal do painel (weekly_cycle_progress). " +
            "Serve como memória do que a operação entregou em cada semana, por cliente e por frente.",
          body_markdown: corpo,
        });
        espelho = { ok: true, path: result.path };
      } catch (error) {
        // Causa real no log, mensagem honesta na resposta.
        const detalhe = error instanceof SecondBrainError
          ? String(error.message)
          : error instanceof Error ? error.message : String(error);
        console.warn(`[ciclo] espelho no segundo cérebro falhou: ${detalhe}`);
        espelho = {
          ok: false,
          reason: /403|forbidden|permission/i.test(detalhe)
            ? "o token do GitHub não tem permissão de escrita no repositório de memória"
            : detalhe.slice(0, 200),
        };
      }
    }

    return jsonResponse({
      written: gravadosNoPainel > 0,
      saved_to_panel: gravadosNoPainel,
      mirror: espelho,
      total_done: totalDone,
      week_start: weekStart,
    });
  } catch (error) {
    if (error instanceof SecondBrainError) {
      return jsonResponse({ configured: true, written: false, reason: String(error.message) }, 502);
    }
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado." },
      500,
    );
  }
});
