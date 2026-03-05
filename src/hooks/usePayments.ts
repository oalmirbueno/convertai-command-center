import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useProjectPayments(projectId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project-payments", user?.id, projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_payments")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!user && !!projectId,
  });
}

export function usePaymentInstallments(paymentId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["payment-installments", user?.id, paymentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_installments")
        .select("*")
        .eq("payment_id", paymentId!)
        .order("installment_number", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!paymentId,
  });
}
