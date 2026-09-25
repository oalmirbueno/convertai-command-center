import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { chamarAds } from "@/components/mesa-ads/adsApi";
import {
  lerDesempenho,
  normalizarEvolucao,
  type DesempenhoDoCliente,
  type LeituraDaEvolucao,
} from "@/components/mesa-ads/contaApi";

/**
 * O que a Mesa já sabe do cliente, para a tela de métricas aconselhar junto.
 * Só leitura, pelo contrato pronto da mesa-ads (v4):
 * - a última leitura de evolução gravada (tabela evolucao_leituras, RLS da equipe);
 * - desempenho_cliente: orgânico e anúncios somados, grátis e sem IA;
 * - evolucao com gravar=false e explicar=false: a leitura na hora, grátis,
 *   sem mexer na memória dos agentes.
 */

export interface UltimaEvolucao {
  leitura: LeituraDaEvolucao;
  criadoEm: string;
}

export function useUltimaEvolucao(clientId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["metricas", "ultima-evolucao", clientId ?? "nenhum"],
    enabled: !!user && !!clientId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<UltimaEvolucao | null> => {
      const { data, error } = await (supabase as any)
        .from("evolucao_leituras")
        .select("leitura, explicacao, criado_em")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Sem a tabela (SQL da v4 não aplicado) ou sem permissão: sem conselho da Mesa, e só isso.
      if (error || !data) return null;
      const linha = data as { leitura: unknown; explicacao: unknown; criado_em: string };
      return { leitura: normalizarEvolucao({ leitura: linha.leitura, explicacao: linha.explicacao }), criadoEm: linha.criado_em };
    },
  });
}

export function useDesempenhoDaMesa(clientId?: string, dias = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["metricas", "desempenho-da-mesa", clientId ?? "nenhum", dias],
    enabled: !!user && !!clientId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: (): Promise<DesempenhoDoCliente | null> => lerDesempenho(clientId as string, dias),
  });
}

/** Leitura de evolução na hora: grátis, sem IA e sem gravar memória dos agentes. */
export async function pedirLeituraDaMesa(clientId: string, dias = 30): Promise<LeituraDaEvolucao> {
  return normalizarEvolucao(await chamarAds("evolucao", { client_id: clientId, dias, explicar: false, gravar: false }));
}
