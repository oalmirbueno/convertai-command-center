import { supabase } from "@/integrations/supabase/client";

export async function getAdminId(): Promise<string | null> {
  // Use SECURITY DEFINER function to bypass user_roles RLS
  const { data, error } = await supabase.rpc("get_admin_user_id");
  if (error || !data) return null;
  return data as string;
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
