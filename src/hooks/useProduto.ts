import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { carregarProduto, chaveDoProduto, type EstadoDoProduto } from "@/lib/produto/api";

/**
 * O estado do produto CRM e E-mail para quem está logado: a empresa, o papel,
 * o plano e o que está liberado. Uma leitura só, que as telas do produto e os
 * atalhos do painel e da área de membros compartilham.
 */
export function useProduto(ligado = true) {
  const { user } = useAuth();
  return useQuery<EstadoDoProduto>({
    queryKey: [...chaveDoProduto, user ? user.id : null],
    queryFn: carregarProduto,
    enabled: ligado && !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Relê o estado depois de uma ação (convite, plano, pagamento). */
export function useRelerProduto() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: chaveDoProduto });
}
