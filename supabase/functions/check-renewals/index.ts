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
      .select("id, full_name, company_name, plan_renewal_date")
      .gte("plan_renewal_date", todayStr)
      .lte("plan_renewal_date", in7Str)
      .neq("plan_status", "inactive");

    // Clients already expired (past due)
    const { data: expired } = await supabase
      .from("profiles")
      .select("id, full_name, company_name, plan_renewal_date")
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

    for (const c of clients || []) {
      const name = c.company_name || c.full_name;
      const date = new Date(c.plan_renewal_date + "T00:00:00");
      const diffDays = Math.ceil(
        (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      const msg =
        diffDays === 0
          ? `⚠️ O plano de "${name}" vence HOJE!`
          : `📅 O plano de "${name}" vence em ${diffDays} dia(s) (${date.toLocaleDateString("pt-BR")})`;

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
      const msg = `🔴 O plano de "${name}" está vencido há ${diffDays} dia(s)!`;

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
