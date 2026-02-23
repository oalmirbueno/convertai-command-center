import { supabase } from "@/integrations/supabase/client";

export async function getAdminId(): Promise<string | null> {
  const { data } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return data?.user_id || null;
}

export async function notifyAdmin(message: string, type: string, link: string) {
  const adminId = await getAdminId();
  if (!adminId) return;
  await supabase.from("notifications").insert({
    user_id: adminId,
    message,
    notification_type: type,
    link,
  });
}

export async function notifyUser(userId: string, message: string, type: string, link: string) {
  await supabase.from("notifications").insert({
    user_id: userId,
    message,
    notification_type: type,
    link,
  });
}
