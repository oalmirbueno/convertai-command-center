import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MANAGED_ROLES = new Set(["admin", "client", "design", "traffic", "manager"]);

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

    const replaceManagedRole = async (userId: string, role: string) => {
      if (!MANAGED_ROLES.has(role)) throw new Error("Invalid role");

      const { error } = await adminClient.rpc("replace_managed_user_role", {
        _actor_id: caller.id,
        _user_id: userId,
        _role: role,
      });

      if (error) throw new Error(error.message || "Failed to assign role");
    };

    if (action === "create") {
      const { email, full_name, role, password, company_name } = payload;
      if (!email || !full_name || !role || !password) throw new Error("Missing fields");
      if (!MANAGED_ROLES.has(role)) throw new Error("Invalid role");
      if (typeof password !== "string" || password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        // The account cannot sign in while profile and role are being prepared.
        email_confirm: false,
        // Authorization never comes from user_metadata because users can edit it.
        user_metadata: { full_name, company_name: company_name || null },
        app_metadata: { managed_by_aceleriq: true },
      });
      if (createError) throw createError;

      const rollbackCreatedUser = async (reason: string) => {
        // Strip every application role first. Even if deleting the Auth user
        // fails, the unconfirmed account remains without panel privileges.
        const { error: stripRoleError } = await adminClient
          .from("user_roles")
          .delete()
          .eq("user_id", newUser.user.id);
        const { error: rollbackError } = await adminClient.auth.admin.deleteUser(newUser.user.id);
        if (stripRoleError || rollbackError) {
          console.error("manage-team rollback incomplete", {
            user_id: newUser.user.id,
            role_stripped: !stripRoleError,
            auth_user_deleted: !rollbackError,
          });
        }
        throw new Error(reason);
      };

      const { error: profileError } = await adminClient.from("profiles").upsert({
        id: newUser.user.id,
        email,
        full_name,
        company_name: company_name || null,
      }, { onConflict: "id" });
      if (profileError) await rollbackCreatedUser("Failed to create profile");

      try {
        await replaceManagedRole(newUser.user.id, role);
      } catch {
        await rollbackCreatedUser("Failed to assign role");
      }

      const { error: confirmError } = await adminClient.auth.admin.updateUserById(
        newUser.user.id,
        { email_confirm: true },
      );
      if (confirmError) await rollbackCreatedUser("Failed to activate user");

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_role") {
      const { user_id, role } = payload;
      if (!user_id || !role) throw new Error("Missing user_id or role");
      if (!MANAGED_ROLES.has(role)) throw new Error("Invalid role");
      if (user_id === caller.id && role !== "admin") {
        throw new Error("You cannot demote your own administrator account");
      }

      await replaceManagedRole(user_id, role);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { user_id } = payload;
      if (!user_id) throw new Error("Missing user_id");
      if (user_id === caller.id) throw new Error("Cannot delete yourself");

      // Administrator accounts must be demoted through the locked role RPC
      // before deletion. This prevents concurrent deletes from ever removing
      // the last administrator.
      const { data: targetRoles, error: targetRoleError } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user_id);
      if (targetRoleError) throw new Error("Failed to verify target role");
      if (targetRoles?.some(({ role }) => role === "admin")) {
        throw new Error("Demote the administrator before deleting this account");
      }

      // Clean up ALL foreign key references before deleting auth user
      const cleanup = async (label: string, promise: any) => {
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

      // Notify Ops (best-effort) — local-first delete already done.
      // The shared secret stays server-side and authenticates this function-to-function call.
      const opsWebhookSecret = Deno.env.get("OPS_WEBHOOK_SECRET");
      if (!opsWebhookSecret) {
        console.warn(
          "notify-ops profile_deleted skipped: OPS_WEBHOOK_SECRET not configured",
        );
      } else {
        try {
          const notifyResponse = await fetch(
            `${supabaseUrl}/functions/v1/notify-ops`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-webhook-secret": opsWebhookSecret,
              },
              body: JSON.stringify({
                type: "profile_deleted",
                data: { id: user_id },
              }),
            },
          );

          if (!notifyResponse.ok) {
            console.warn("notify-ops profile_deleted rejected:", {
              status: notifyResponse.status,
            });
          }
        } catch (e) {
          console.warn("notify-ops profile_deleted failed:", e);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_password") {
      const { user_id, password } = payload;
      if (!user_id || !password) throw new Error("Missing user_id or password");
      if (typeof password !== "string" || password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }

      const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, { password });
      if (updateError) throw updateError;

      // Keep credentials exclusively in Auth and invalidate pending first
      // access links after an administrator defines a new password.
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({
          portal_password: null,
          first_access_token: null,
          first_access_used_at: new Date().toISOString(),
        })
        .eq("id", user_id);
      if (profileError) throw profileError;

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
