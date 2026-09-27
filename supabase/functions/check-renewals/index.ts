import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cabecalhosDoEmailInterno } from "../_shared/email-interno.ts";
import {
  avisaAntes,
  avisaVencido,
  linkDoCliente,
  textoAntes,
  textoPausa,
  textoVencido,
} from "./marcos.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const CRON_SECRET =
    Deno.env.get("CRON_SECRET") ??
    Deno.env.get("OPS_WEBHOOK_SECRET") ?? "";
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("x-webhook-secret") ?? "";
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Todo admin humano (antes: um só, sorteado por get_admin_user_id, que
    // caía no admin temporário e deixava o dono sem o aviso). Robô e conta
    // apagada ficam de fora.
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIdsBrutos = Array.from(new Set(((adminRoles as { user_id: string }[] | null) ?? []).map((r) => r.user_id)));
    const { data: adminProfiles } = adminIdsBrutos.length
      ? await supabase.from("profiles").select("id, email, deleted_at").in("id", adminIdsBrutos)
      : { data: [] as { id: string; email: string | null; deleted_at: string | null }[] };
    const adminIds = ((adminProfiles as { id: string; email: string | null; deleted_at: string | null }[] | null) ?? [])
      .filter((p) => !p.deleted_at && !/^n8n@/i.test(p.email ?? ""))
      .map((p) => p.id);
    if (adminIds.length === 0) {
      return new Response(JSON.stringify({ error: "No admin found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date();
    const in7days = new Date(today);
    in7days.setDate(in7days.getDate() + 7);

    const todayStr = today.toISOString().split("T")[0];
    const in7Str = in7days.toISOString().split("T")[0];

    const brl = (v: any) =>
      v != null
        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v))
        : "—";
    const brDate = (d: string) =>
      new Date(d + "T00:00:00").toLocaleDateString("pt-BR");

    // Fire a branded billing email for a specific client/milestone (idempotent)
    const sendBillingEmail = async (
      c: any,
      status: "upcoming" | "today" | "overdue",
      milestone: string,
      extra: Record<string, any>
    ) => {
      if (!c.email) return;
      try {
        // x-cron-secret: sem ele o send-transactional-email devolvia 401
        // e o lembrete ao cliente não saía (ver _shared/email-interno.ts).
        const { error: envioErro } = await supabase.functions.invoke("send-transactional-email", {
          headers: cabecalhosDoEmailInterno(),
          body: {
            templateName: "billing-reminder",
            recipientEmail: c.email,
            idempotencyKey: `billing-${c.id}-${c.plan_renewal_date}-${milestone}`,
            templateData: {
              name: c.full_name,
              company: c.company_name,
              planName: c.plan_name || "Plano de Recorrência",
              amount: brl(c.plan_value),
              dueDate: brDate(c.plan_renewal_date),
              status,
              ...extra,
            },
          },
        });
        if (envioErro) console.warn("billing email failed", c.id, envioErro.message);
      } catch (e) {
        console.warn("billing email failed", c.id, e);
      }
    };

    // Clients with renewal date between today and 7 days from now
    const { data: clients } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name, plan_name, plan_renewal_date, plan_value")
      .gte("plan_renewal_date", todayStr)
      .lte("plan_renewal_date", in7Str)
      .not("plan_status", "in", "(inactive,standby)")
      .neq("client_type", "one_off");

    // Clients already expired (past due)
    const { data: expired } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name, plan_name, plan_renewal_date, plan_value, overdue_since")
      .lt("plan_renewal_date", todayStr)
      .not("plan_status", "in", "(inactive,standby)")
      .neq("client_type", "one_off");

    // O que já foi avisado hoje, por pessoa: rodar duas vezes no mesmo dia
    // não repete o aviso.
    const { data: existingNotifs } = await supabase
      .from("notifications")
      .select("user_id, message")
      .in("user_id", adminIds)
      .eq("notification_type", "billing")
      .gte("created_at", todayStr + "T00:00:00Z");

    const existingMessages = new Set(
      (existingNotifs || []).map((n: any) => `${n.user_id}|${n.message}`)
    );

    const notifications: any[] = [];
    let pausedCount = 0;
    const avisarAdmins = (message: string, link: string) => {
      for (const adminId of adminIds) {
        const chave = `${adminId}|${message}`;
        if (existingMessages.has(chave)) continue;
        existingMessages.add(chave);
        notifications.push({ user_id: adminId, message, notification_type: "billing", link });
      }
    };

    for (const c of clients || []) {
      const name = c.company_name || c.full_name;
      const date = new Date(c.plan_renewal_date + "T00:00:00");
      const diffDays = Math.ceil(
        (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      // Só nos marcos (7, 3, 1 dia e no dia): o sino não é lista de cobrança.
      if (avisaAntes(diffDays)) {
        avisarAdmins(
          textoAntes(name, diffDays, date.toLocaleDateString("pt-BR"), c.plan_value),
          linkDoCliente(c.id),
        );
      }

      // Client-facing billing email at key milestones (7/3/1 days, due day)
      if (diffDays === 0) {
        await sendBillingEmail(c, "today", "due-day", {});
      } else if ([7, 3, 1].includes(diffDays)) {
        await sendBillingEmail(c, "upcoming", `d-${diffDays}`, { daysUntil: diffDays });
      }
    }

    for (const c of expired || []) {
      const name = c.company_name || c.full_name;
      const date = new Date(c.plan_renewal_date + "T00:00:00");
      const diffDays = Math.abs(
        Math.ceil(
          (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        )
      );
      // Set overdue_since if not already set
      if (!c.overdue_since) {
        await supabase
          .from("profiles")
          .update({ overdue_since: c.plan_renewal_date })
          .eq("id", c.id);
      }

      // Check if overdue for 30+ days → pause projects
      const overdueStart = c.overdue_since || c.plan_renewal_date;
      const overdueDays = Math.ceil(
        (today.getTime() - new Date(overdueStart + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)
      );

      if (overdueDays >= 30) {
        // Pause all active projects for this client
        const { data: activeProjects } = await supabase
          .from("projects")
          .select("id, name")
          .eq("client_id", c.id)
          .neq("status", "paused")
          .neq("status", "completed");

        if (activeProjects && activeProjects.length > 0) {
          for (const proj of activeProjects) {
            await supabase
              .from("projects")
              .update({ status: "paused" })
              .eq("id", proj.id);
          }
          pausedCount += activeProjects.length;

          avisarAdmins(textoPausa(name, overdueDays), linkDoCliente(c.id));

          // Notify client too
          await supabase.from("notifications").insert({
            user_id: c.id,
            message: "Seus projetos foram pausados por pendência financeira. Fale com a gente para regularizar.",
            notification_type: "billing",
            link: "/financeiro",
          });
        }
      }

      // Vencido: 1, 3, 7, 15 e 30 dias, depois a cada 30 (antes: todo dia).
      if (avisaVencido(diffDays)) {
        avisarAdmins(textoVencido(name, diffDays, c.plan_value), linkDoCliente(c.id));
      }

      // Client-facing overdue email at key milestones
      if ([1, 3, 7, 15].includes(diffDays)) {
        await sendBillingEmail(c, "overdue", `od-${diffDays}`, { daysOverdue: diffDays });
      }
    }

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }

    return new Response(
      JSON.stringify({
        sent: notifications.length,
        upcoming: (clients || []).length,
        expired: (expired || []).length,
        paused_projects: pausedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
