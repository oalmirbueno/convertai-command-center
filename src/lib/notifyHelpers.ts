import { supabase } from "@/integrations/supabase/client";

export async function getAdminId(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_admin_user_id");
  if (error || !data) return null;
  return data as string;
}

/**
 * Notify admin(s) via edge function (uses service role to bypass RLS
 * when a non-staff user — e.g. a client — needs to create an admin notification).
 * Dedup is handled server-side.
 */
export async function notifyAdmin(message: string, type: string, link: string) {
  try {
    await supabase.functions.invoke("notify-admin", {
      body: { message, notification_type: type, link },
    });
  } catch (e) {
    console.error("[notifyAdmin] failed:", e);
  }
}

/**
 * Notify a specific user. If the caller is the user themself or staff,
 * direct insert works; otherwise we fall back to the edge function.
 */
export async function notifyUser(userId: string, message: string, type: string, link: string) {
  // Try direct insert first (works for self-notifications and staff)
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    message,
    notification_type: type,
    link,
  });
  if (!error) return;

  // Fallback: edge function with service role
  try {
    await supabase.functions.invoke("notify-admin", {
      body: { target_user_id: userId, message, notification_type: type, link },
    });
  } catch (e) {
    console.error("[notifyUser] failed:", e);
  }
}
