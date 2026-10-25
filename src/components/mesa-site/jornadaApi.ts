import { useQuery } from "@tanstack/react-query";
import type { ModeloPronto } from "../../../supabase/functions/mesa-site/modulos/modelos-prontos";
import { type ContextoDoCliente, type PartidaDoSite, passoInicial } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { chamarSite, type LinhaDoSite } from "./siteApi";

/**
 * Ponte da jornada da Mesa Site (25/10/2026) com a função mesa-site:
 * contexto do cliente (sem IA), galeria de sites prontos (o Jev recomenda)
 * e o que a jornada já guardou no site (direcao.jornada).
 */

export type JornadaDoSite = { objetivo: string | null; partida: PartidaDoSite | null; contexto: Record<string, unknown> };

export function jornadaDoSite(site: Pick<LinhaDoSite, "direcao">): JornadaDoSite {
  const j = site.direcao && typeof site.direcao.jornada === "object" && site.direcao.jornada ? (site.direcao.jornada as Record<string, any>) : {};
  return {
    objetivo: typeof j.objetivo === "string" ? j.objetivo : null,
    partida: j.partida && typeof j.partida === "object" ? (j.partida as PartidaDoSite) : null,
    contexto: j.contexto && typeof j.contexto === "object" ? j.contexto : {},
  };
}

export { passoInicial };

export const CHAVES_DA_JORNADA = {
  contexto: (siteId: string) => ["mesa-site", "jornada", "contexto", siteId],
  prontos: (siteId: string, objetivo: string | null) => ["mesa-site", "jornada", "prontos", siteId, objetivo || "todos"],
};

export type RespostaDoContexto = { contexto: ContextoDoCliente; do_cliente: ContextoDoCliente; origem: Record<string, string>; editado: Record<string, unknown>; nichos: string[] };

export function useContextoDoCliente(siteId: string) {
  return useQuery({
    queryKey: CHAVES_DA_JORNADA.contexto(siteId),
    queryFn: () => chamarSite<RespostaDoContexto>("jornada_contexto", { site_id: siteId }),
    staleTime: 60_000,
  });
}

export type RespostaDosProntos = { modelos: ModeloPronto[]; do_nicho: number; nichos: string[]; objetivo: string | null; recomendado: string | null; confianca: number | null; custo_usd: number };

/** A galeria só busca quando a partida "site pronto" está aberta (a recomendação do Jev é cobrada). */
export function useModelosProntos(siteId: string, objetivo: string | null, ativo: boolean) {
  return useQuery({
    queryKey: CHAVES_DA_JORNADA.prontos(siteId, objetivo),
    enabled: ativo,
    staleTime: Infinity,
    queryFn: () => chamarSite<RespostaDosProntos>("modelos_prontos_listar", { site_id: siteId, objetivo: objetivo || undefined }),
  });
}

/** Origem do campo em palavras (vai no title do campo). */
export const ROTULO_DA_ORIGEM: Record<string, string> = {
  site: "dados do site",
  marca: "contexto da marca",
  cadastro: "cadastro do cliente",
  estrategia: "estratégia aprovada",
  dossie: "dossiê",
  instagram: "Instagram da marca",
  ads: "ofertas da Mesa Ads",
};
