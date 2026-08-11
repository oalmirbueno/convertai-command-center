import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Caixinhas de reserva da Aceleriq — dinheiro separado dentro do caixa:
 * - tax: reserva tributária (imposto separado do gross-up);
 * - clients: custos de clientes / investimento (colchão para colocar no cliente);
 * - safety: reserva segura da agência (emergência).
 *
 * Guardadas em profiles.services_config.finance_boxes do próprio admin
 * (jsonb já existente — sem migration). Saldo livre = caixa − caixinhas.
 */
export interface FinanceBoxes {
  tax: number;
  clients: number;
  safety: number;
}

export const EMPTY_BOXES: FinanceBoxes = { tax: 0, clients: 0, safety: 0 };

export const boxesTotal = (b?: FinanceBoxes | null): number =>
  b ? (Number(b.tax) || 0) + (Number(b.clients) || 0) + (Number(b.safety) || 0) : 0;

export function useFinanceBoxes() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["finance-boxes", user?.id],
    queryFn: async (): Promise<FinanceBoxes> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("services_config")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      const raw = (data?.services_config as any)?.finance_boxes || {};
      return {
        tax: Number(raw.tax) || 0,
        clients: Number(raw.clients) || 0,
        safety: Number(raw.safety) || 0,
      };
    },
    enabled: !!user,
  });

  const save = useMutation({
    mutationFn: async (boxes: FinanceBoxes) => {
      // Merge sobre o services_config fresco para não perder outras chaves.
      const { data, error } = await supabase
        .from("profiles")
        .select("services_config")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      const current = (data?.services_config as any) || {};
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ services_config: { ...current, finance_boxes: boxes } as any })
        .eq("id", user!.id);
      if (updateError) throw updateError;
      return boxes;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-boxes"] }),
  });

  return { ...query, save };
}
