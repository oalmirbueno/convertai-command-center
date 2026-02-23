import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useBilling(clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["billing", user?.id, clientId],
    queryFn: async () => {
      let query = supabase
        .from("billing")
        .select("*, client:profiles!billing_client_id_fkey(full_name, company_name)")
        .order("due_date", { ascending: false });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useAdsWallet(clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-wallet", user?.id, clientId],
    queryFn: async () => {
      let query = supabase
        .from("ads_wallet")
        .select("*, client:profiles!ads_wallet_client_id_fkey(full_name, company_name)")
        .order("created_at", { ascending: false });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useRechargeRequests(clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["recharge-requests", user?.id, clientId],
    queryFn: async () => {
      let query = supabase
        .from("recharge_requests")
        .select("*, client:profiles!recharge_requests_client_id_fkey(full_name, company_name), requester:profiles!recharge_requests_requested_by_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
