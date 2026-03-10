import { supabase } from "@/integrations/supabase/client";

export async function getAdminId(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_admin_user_id");
  if (error || !data) return null;
  return data as string;
}

/**
 * Dedup check: avoid sending nearly identical notifications within a short window.
 * Returns true if a similar notification exists in the last 5 minutes.
 */
async function isDuplicate(userId: string, message: string, type: string): Promise<boolean> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("notification_type", type)
    .eq("message", message)
    .gte("created_at", fiveMinAgo)
    .limit(1);
  return (data || []).length > 0;
}

export async function notifyAdmin(message: string, type: string, link: string) {
  const adminId = await getAdminId();
  if (!adminId) return;
  if (await isDuplicate(adminId, message, type)) return;
  await supabase.from("notifications").insert({
    user_id: adminId,
    message,
    notification_type: type,
    link,
  });
}

export async function notifyUser(userId: string, message: string, type: string, link: string) {
  if (await isDuplicate(userId, message, type)) return;
  await supabase.from("notifications").insert({
    user_id: userId,
    message,
    notification_type: type,
    link,
  });
}
