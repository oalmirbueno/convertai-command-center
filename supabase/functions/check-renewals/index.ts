import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get admin user id
    const { data: adminId } = await supabase.rpc("get_admin_user_id");
    if (!adminId) {
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
        await supabase.functions.invoke("send-transactional-email", {
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
      .neq("plan_status", "inactive");

    // Clients already expired (past due)
    const { data: expired } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name, plan_name, plan_renewal_date, plan_value, overdue_since")
      .lt("plan_renewal_date", todayStr)
      .neq("plan_status", "inactive");

    // Check existing notifications from today to avoid duplicates
    const { data: existingNotifs } = await supabase
      .from("notifications")
      .select("message")
      .eq("user_id", adminId)
      .eq("notification_type", "billing")
      .gte("created_at", todayStr + "T00:00:00Z");

    const existingMessages = new Set(
      (existingNotifs || []).map((n: any) => n.message)
    );

    const notifications: any[] = [];
    let pausedCount = 0;

    for (const c of clients || []) {
      const name = c.company_name || c.full_name;
      const date = new Date(c.plan_renewal_date + "T00:00:00");
      const diffDays = Math.ceil(
        (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      const valueStr = c.plan_value ? ` — R$ ${Number(c.plan_value).toFixed(2)}` : "";
      const msg =
        diffDays === 0
          ? `⚠️ O plano de "${name}" vence HOJE!${valueStr}`
          : `📅 O plano de "${name}" vence em ${diffDays} dia(s) (${date.toLocaleDateString("pt-BR")})${valueStr}`;

      if (!existingMessages.has(msg)) {
        notifications.push({
          user_id: adminId,
          message: msg,
          notification_type: "billing",
          link: "/clientes",
        });
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
      const valueStr = c.plan_value ? ` — R$ ${Number(c.plan_value).toFixed(2)}` : "";

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

          const pauseMsg = `🚫 Projetos de "${name}" foram PAUSADOS por inadimplência (${overdueDays} dias)`;
          if (!existingMessages.has(pauseMsg)) {
            notifications.push({
              user_id: adminId,
              message: pauseMsg,
              notification_type: "billing",
              link: "/clientes",
            });
          }

          // Notify client too
          await supabase.from("notifications").insert({
            user_id: c.id,
            message: `⚠️ Seus projetos foram pausados por pendência financeira. Entre em contato para regularizar.`,
            notification_type: "billing",
            link: "/financeiro",
          });
        }
      }

      const msg = `🔴 O plano de "${name}" está vencido há ${diffDays} dia(s)!${valueStr}`;
      if (!existingMessages.has(msg)) {
        notifications.push({
          user_id: adminId,
          message: msg,
          notification_type: "billing",
          link: "/clientes",
        });
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
