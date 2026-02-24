import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
      const { email, full_name, role, password } = payload;
      if (!email || !full_name || !role) throw new Error("Missing fields");

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: password || "Temp@2026!",
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

      // Clean up ALL foreign key references before deleting auth user
      const cleanup = async (label: string, promise: Promise<any>) => {
        const res = await promise;
        if (res.error) console.error(`Cleanup ${label} failed:`, res.error);
        else console.log(`Cleanup ${label}: ok`);
      };

      await cleanup("tasks", adminClient.from("tasks").update({ assigned_to: null }).eq("assigned_to", user_id));
      await cleanup("files_uploaded", adminClient.from("files").update({ uploaded_by: caller.id }).eq("uploaded_by", user_id));
      await cleanup("files_client", adminClient.from("files").update({ client_id: caller.id }).eq("client_id", user_id));
      await cleanup("updates", adminClient.from("updates").delete().eq("author_id", user_id));
      await cleanup("notifications", adminClient.from("notifications").delete().eq("user_id", user_id));
      await cleanup("client_requests", adminClient.from("client_requests").delete().eq("client_id", user_id));
      await cleanup("reports_created", adminClient.from("reports").update({ created_by: null }).eq("created_by", user_id));
      await cleanup("reports_client", adminClient.from("reports").update({ client_id: caller.id }).eq("client_id", user_id));
      await cleanup("recharge_client", adminClient.from("recharge_requests").delete().eq("client_id", user_id));
      await cleanup("recharge_by", adminClient.from("recharge_requests").update({ requested_by: null }).eq("requested_by", user_id));
      await cleanup("recharge_approved", adminClient.from("recharge_requests").update({ approved_by: null }).eq("approved_by", user_id));
      await cleanup("ads_wallet", adminClient.from("ads_wallet").delete().eq("client_id", user_id));
      await cleanup("billing", adminClient.from("billing").delete().eq("client_id", user_id));
      await cleanup("briefings", adminClient.from("briefings").delete().eq("client_id", user_id));
      await cleanup("projects_client", adminClient.from("projects").update({ client_id: caller.id }).eq("client_id", user_id));
      await cleanup("projects_created", adminClient.from("projects").update({ created_by: null }).eq("created_by", user_id));
      await cleanup("user_roles", adminClient.from("user_roles").delete().eq("user_id", user_id));
      await cleanup("profiles", adminClient.from("profiles").delete().eq("id", user_id));

      // Finally delete auth user
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteError) {
        console.error("deleteUser error:", deleteError);
        throw new Error(deleteError.message || "Error deleting user");
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_password") {
      const { user_id, password } = payload;
      if (!user_id || !password) throw new Error("Missing user_id or password");
      if (password.length < 6) throw new Error("Password must be at least 6 characters");

      const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, { password });
      if (updateError) throw updateError;

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
