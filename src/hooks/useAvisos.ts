import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * O sino (frente N, 27/09).
 *
 * A lista do sino traz os 40 avisos mais recentes (useNotifications). A
 * contagem de não lidas saía dessa lista, então passava de 30 e parava:
 * quem tinha 150 pendentes via "9+" e, na aba "Não lidas", só as que
 * cabiam entre as 30 últimas. Aqui a contagem e a lista das não lidas vêm
 * do banco, e o sino recarrega na hora em que um aviso chega.
 */

/** Prefixo comum: invalidar ["notifications"] recarrega lista, contagem e não lidas. */
export const CHAVE_DOS_AVISOS = "notifications";

export function useContagemDeNaoLidas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE_DOS_AVISOS, user?.id, "contagem-nao-lidas"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("read", false);
      if (error) throw error;
      // 28/09 (AD4): contagem que não é número vira 0. Com NaN (Content-Range sem o total), o
      // resultado da consulta nunca era "igual" ao anterior (NaN !== NaN), o sino re-renderizava
      // o painel inteiro milhares de vezes por segundo e a mesa podia não passar do esqueleto.
      return typeof count === "number" && Number.isFinite(count) ? count : 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });
}

/** A aba "Não lidas": todas as pendentes (até 100), não só as da lista. */
export function useAvisosNaoLidos(ativo: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE_DOS_AVISOS, user?.id, "lista-nao-lidas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!user && ativo,
  });
}

/**
 * Tempo real: aviso novo (ou rajada agrupada) chega pelo canal do banco e o
 * sino recarrega em meio segundo. O intervalo de 30 s fica como rede, caso
 * o canal caia.
 */
export function useAvisosEmTempoReal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const recarregar = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        queryClient.invalidateQueries({ queryKey: [CHAVE_DOS_AVISOS] });
      }, 500);
    };
    let canal: ReturnType<typeof supabase.channel> | null = null;
    try {
      canal = supabase
        .channel(`avisos:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          recarregar,
        )
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      if (espera) clearTimeout(espera);
      if (canal) supabase.removeChannel(canal);
    };
  }, [userId, queryClient]);
}

/** Uma chamada só (antes: uma por aviso, e só as que estavam na lista). */
export async function marcarTodasComoLidas(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
}
