import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Leituras da Mesa Freela (RLS: só admin/manager). Chaves com o prefixo
 * "freela" para a invalidação em bloco depois de cada escrita.
 */

export function useFreelaContatos() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["freela", "contatos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freela_contatos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useFreelaPropostas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["freela", "propostas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freela_propostas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useFreelaProjetos() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["freela", "projetos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freela_projetos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useFreelaParcelas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["freela", "parcelas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freela_parcelas")
        .select("*")
        .order("vencimento", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}
