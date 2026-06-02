import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { message, notification_type, link, target_user_id } = await req.json();
    if (!message || !notification_type) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve target: explicit target_user_id OR all admins
    let targets: string[] = [];
    if (target_user_id) {
      targets = [target_user_id];
    } else {
      const { data: admins } = await supabase
        .from("user_roles").select("user_id").eq("role", "admin");
      targets = (admins || []).map((a: any) => a.user_id);
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup: skip if same message+type for same user within 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const inserts: any[] = [];
    for (const uid of targets) {
      const { data: dup } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", uid)
        .eq("notification_type", notification_type)
        .eq("message", message)
        .gte("created_at", fiveMinAgo)
        .limit(1);
      if (!dup || dup.length === 0) {
        inserts.push({ user_id: uid, message, notification_type, link: link || null });
      }
    }

    if (inserts.length > 0) {
      await supabase.from("notifications").insert(inserts);
    }

    return new Response(JSON.stringify({ ok: true, inserted: inserts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
