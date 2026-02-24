import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller) throw new Error("Invalid token");

    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!callerRole) throw new Error("Unauthorized: admin only");

    const { action, ...payload } = await req.json();

    if (action === "create") {
      const { email, full_name, role } = payload;
      if (!email || !full_name || !role) throw new Error("Missing fields");

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: "Temp@2026!",
        email_confirm: true,
        user_metadata: { full_name, role },
      });
      if (createError) throw createError;

      await adminClient.from("profiles").upsert({
        id: newUser.user.id,
        email,
        full_name,
      }, { onConflict: "id" });

      await adminClient.from("user_roles").upsert({
        user_id: newUser.user.id,
        role,
      }, { onConflict: "user_id,role" });

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { user_id } = payload;
      if (!user_id) throw new Error("Missing user_id");
      if (user_id === caller.id) throw new Error("Cannot delete yourself");

      // Delete related data FIRST (service role bypasses RLS)
      await adminClient.from("user_roles").delete().eq("user_id", user_id);
      await adminClient.from("notifications").delete().eq("user_id", user_id);
      await adminClient.from("profiles").delete().eq("id", user_id);

      // Now delete auth user
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteError) throw deleteError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid action");
  } catch (err: any) {
    console.error("manage-team error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
