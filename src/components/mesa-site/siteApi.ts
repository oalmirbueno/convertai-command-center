import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { normalizarTrabalho, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";

/**
 * Ponte da Mesa Site com as funções mesa-site (etapas e diretor de site) e
 * motor-codigo (fila do motor: pedir, parar, listar, eventos). Nenhuma chave
 * passa por aqui: a tela manda ordens e lê linhas da fila e o estado ao vivo.
 */

export type LinhaDoSite = {
  id: string;
  client_id: string;
  marca_id: string | null;
  nome: string;
  projeto: string;
  etapa: string;
  briefing: Record<string, any>;
  referencias: any[];
  dna: Record<string, any>;
  direcao: Record<string, any>;
  conteudo: Record<string, any>;
  imagens: any[];
  revisao: Record<string, any>;
  publicacao: Record<string, any>;
  modelo: string | null;
  custo_usd?: number;
  arquivado_em: string | null;
  atualizado_em: string;
};

export type EventoDoMotor = { id: number; tipo: string; resumo: string; dados: Record<string, any>; em: string };
export type ExecutorDoMotor = { nome: string; visto_em: string; versao: string | null; capacidades: Record<string, any> } | null;

export const CHAVES = {
  sites: (clientId: string, marcaId: string | null) => ["mesa-site", "sites", clientId, marcaId || "todas"],
  trabalhos: (siteId: string) => ["mesa-site", "trabalhos", siteId],
  eventos: (trabalhoId: string) => ["mesa-site", "eventos", trabalhoId],
  publicacao: (siteId: string) => ["mesa-site", "publicacao", siteId],
};

export const chamarSite = <T = any>(acao: string, corpo: Record<string, unknown>) => chamarFuncao<T>("mesa-site", { acao, ...corpo });
export const chamarMotor = <T = any>(acao: string, corpo: Record<string, unknown>) => chamarFuncao<T>("motor-codigo", { acao, ...corpo });

export function useSites(clientId: string, marcaId: string | null) {
  return useQuery({
    queryKey: CHAVES.sites(clientId, marcaId),
    enabled: !!clientId,
    queryFn: async () => {
      const d = await chamarSite<{ sites: LinhaDoSite[]; indisponivel?: boolean; aviso?: string }>("sites_listar", { client_id: clientId, marca_id: marcaId || undefined });
      return { lista: d.sites || [], indisponivel: !!d.indisponivel, aviso: d.aviso || null };
    },
  });
}

/** O site aberto (da lista do cliente; a lista é a fonte: salvar devolve a linha e a tela troca nela). */
export function useSiteAberto(clientId: string, marcaId: string | null, siteId: string | null) {
  const q = useSites(clientId, marcaId);
  const site = q.data && siteId ? q.data.lista.find((s) => s.id === siteId) || null : null;
  return { ...q, site };
}

/** Troca a linha salva na lista do cache (sem esperar reler). */
export function useGuardarSite(clientId: string, marcaId: string | null) {
  const qc = useQueryClient();
  return (site: LinhaDoSite | null | undefined) => {
    if (!site) return;
    qc.setQueryData(CHAVES.sites(clientId, marcaId), (d: any) => (d ? { ...d, lista: [site].concat((d.lista || []).filter((s: LinhaDoSite) => s.id !== site.id)) } : d));
  };
}

const ABERTOS = ["na_fila", "executando", "parando"];

export function useTrabalhos(clientId: string, siteId: string | null) {
  const q = useQuery({
    queryKey: CHAVES.trabalhos(siteId || "nenhum"),
    enabled: !!siteId,
    queryFn: async () => {
      const d = await chamarMotor<{ trabalhos: unknown[]; executor: ExecutorDoMotor; executor_vivo: boolean }>("listar", { client_id: clientId, site_id: siteId });
      return {
        trabalhos: (d.trabalhos || []).map(normalizarTrabalho).filter((t): t is TrabalhoDoMotor => !!t),
        executor: d.executor || null,
        vivo: !!d.executor_vivo,
      };
    },
    // Enquanto há trabalho aberto, relê de 4 em 4 s (o canal ao vivo acelera quando está ligado).
    refetchInterval: (query) => {
      const d = query.state.data as { trabalhos: TrabalhoDoMotor[] } | undefined;
      return d && d.trabalhos.some((t) => ABERTOS.indexOf(t.estado) >= 0) ? 4000 : 30_000;
    },
  });
  useAoVivo("motor_trabalhos", siteId ? `referencia_id=eq.${siteId}` : null, CHAVES.trabalhos(siteId || "nenhum"));
  return q;
}

export function useEventos(trabalho: TrabalhoDoMotor | null) {
  const aberto = !!trabalho && ABERTOS.indexOf(trabalho.estado) >= 0;
  const q = useQuery({
    queryKey: CHAVES.eventos(trabalho ? trabalho.id : "nenhum"),
    enabled: !!trabalho,
    queryFn: async () => {
      const d = await chamarMotor<{ eventos: EventoDoMotor[] }>("eventos", { trabalho_id: trabalho!.id });
      return d.eventos || [];
    },
    refetchInterval: aberto ? 2500 : false,
  });
  useAoVivo("motor_eventos", trabalho ? `trabalho_id=eq.${trabalho.id}` : null, CHAVES.eventos(trabalho ? trabalho.id : "nenhum"));
  return q;
}

/**
 * Escuta o banco (Realtime) e relê a chave em 300 ms. Sem a tabela na
 * publicação, o canal só não recebe nada e o intervalo segue valendo.
 */
function useAoVivo(tabela: string, filtro: string | null, chave: unknown[]) {
  const qc = useQueryClient();
  const chaveTexto = JSON.stringify(chave);
  useEffect(() => {
    if (!filtro) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const canal = supabase
      .channel(`mesa-site:${tabela}:${filtro}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: tabela, filter: filtro }, () => {
        if (espera) clearTimeout(espera);
        espera = setTimeout(() => void qc.invalidateQueries({ queryKey: JSON.parse(chaveTexto) }), 300);
      })
      .subscribe();
    return () => {
      if (espera) clearTimeout(espera);
      void supabase.removeChannel(canal);
    };
  }, [tabela, filtro, chaveTexto, qc]);
}

/** O último trabalho com prévia (o iframe mostra esta). */
export const previaAtual = (lista: TrabalhoDoMotor[]) => lista.find((t) => !!t.preview_url) || null;

/** Seções já construídas (trabalhos de construir terminados). */
export function secoesConstruidas(lista: TrabalhoDoMotor[]): string[] {
  const s: string[] = [];
  lista
    .filter((t) => t.estado === "feito" && t.tipo === "construir")
    .forEach((t) => ((Array.isArray(t.resultado.secoes) ? t.resultado.secoes : []) as string[]).forEach((x) => s.indexOf(x) < 0 && s.push(x)));
  return s;
}
