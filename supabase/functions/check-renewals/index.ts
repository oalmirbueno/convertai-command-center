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

    // Clients with renewal date between today and 7 days from now
    const { data: clients } = await supabase
      .from("profiles")
      .select("id, full_name, company_name, plan_renewal_date, plan_value")
      .gte("plan_renewal_date", todayStr)
      .lte("plan_renewal_date", in7Str)
      .neq("plan_status", "inactive");

    // Clients already expired (past due)
    const { data: expired } = await supabase
      .from("profiles")
      .select("id, full_name, company_name, plan_renewal_date, plan_value, overdue_since")
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
