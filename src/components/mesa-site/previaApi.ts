import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import type { EdicaoDaPrevia } from "../../../supabase/functions/mesa-site/modulos/site-previa";
import type { DadosDaPreviaRapida } from "./previaEstatica";
import { CHAVES, chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";

/**
 * Ponte da prévia editável (SPV, 30/09) com a função mesa-site: os dados da
 * prévia rápida (cores, fontes, imagens assinadas), o histórico de edições e
 * a fila de edições da tela (uma de cada vez, na ordem: duas edições seguidas
 * nunca se atropelam no banco).
 */

export type DadosDaPrevia = DadosDaPreviaRapida & {
  cores_da_marca: { destaque: string; fundo: string; texto: string; escuro: boolean };
  paleta_da_marca: string[];
  ajustes: { destaque?: string; fundo?: string; texto?: string; fonte_titulo?: string; fonte_texto?: string };
  fontes_disponiveis: Array<{ familia: string; categoria: string }>;
  expira_em: string;
};

export type EdicaoRegistrada = {
  id: string;
  tipo: string;
  modo: "direto" | "ajuste";
  resumo: string;
  secao: string | null;
  trabalho_id: string | null;
  desfeita_em: string | null;
  criado_por: string | null;
  criado_em: string;
};

export type OrcamentoDoAjuste = {
  modo: "ajuste";
  precisa_confirmar: true;
  secao: string;
  instrucao: string;
  resumo: string;
  estimativa_usd: number;
  teto_sugerido_usd: number;
  livre_usd: number;
  modelo: { id: string; modelo_api: string } | null;
};

export type RespostaDaEdicao =
  | { modo: "direto"; site: LinhaDoSite; edicao: EdicaoRegistrada | null; resumo: string; avisos?: string[] }
  | { modo: "nada"; resumo: string; site: LinhaDoSite }
  | OrcamentoDoAjuste
  | { modo: "ajuste"; precisa_confirmar?: false; trabalho: TrabalhoDoMotor; edicao: EdicaoRegistrada | null; resumo: string; avisos?: string[] };

export const CHAVES_DA_PREVIA = {
  dados: (siteId: string, assinatura: string) => ["mesa-site", "previa-dados", siteId, assinatura],
  edicoes: (siteId: string) => ["mesa-site", "previa-edicoes", siteId],
};

/** O que muda os dados da prévia rápida: estilo (ajustes), imagens e marca (não o texto). */
export function assinaturaDosDados(site: Pick<LinhaDoSite, "estilo" | "imagens" | "marca_id">): string {
  const imagens = (Array.isArray(site.imagens) ? (site.imagens as Array<Record<string, unknown> | null>) : [])
    .map((i) => (i ? `${String(i.id)}:${i.escolhida !== false ? 1 : 0}:${String(i.secao || "")}:${String(i.slot || "")}` : ""))
    .join(",");
  const ajustes = site.estilo && typeof site.estilo === "object" ? (site.estilo as { ajustes?: unknown }).ajustes : null;
  return `${JSON.stringify(ajustes || {})}|${imagens}|${site.marca_id || ""}`;
}

export function usePreviaDados(site: LinhaDoSite) {
  const assinatura = assinaturaDosDados(site);
  return useQuery({
    queryKey: CHAVES_DA_PREVIA.dados(site.id, assinatura),
    queryFn: () => chamarSite<DadosDaPrevia>("previa_dados", { site_id: site.id }),
    // As URLs das imagens valem 1 h: relê antes de vencer; entre um e outro, a mesma resposta.
    staleTime: 45 * 60_000,
    refetchInterval: 50 * 60_000,
    placeholderData: (anterior) => anterior,
  });
}

export function useEdicoesDaPrevia(siteId: string) {
  return useQuery({
    queryKey: CHAVES_DA_PREVIA.edicoes(siteId),
    queryFn: () => chamarSite<{ edicoes: EdicaoRegistrada[]; indisponivel?: boolean; aviso?: string | null }>("previa_edicoes", { site_id: siteId }),
  });
}

/**
 * Editar e desfazer em fila (uma de cada vez). O site salvo volta para o cache
 * da lista na hora; o histórico e os trabalhos do motor são relidos.
 */
export function useEditorDaPrevia(site: LinhaDoSite) {
  const qc = useQueryClient();
  const guardar = useGuardarSite(site.client_id, site.marca_id);
  const cadeia = useRef<Promise<unknown>>(Promise.resolve());
  const [emAndamento, setEmAndamento] = useState(0);

  const naFila = <T,>(tarefa: () => Promise<T>): Promise<T> => {
    setEmAndamento((n) => n + 1);
    const p = cadeia.current.then(tarefa, tarefa);
    cadeia.current = p.then(
      () => undefined,
      () => undefined,
    );
    return p.finally(() => setEmAndamento((n) => Math.max(0, n - 1)));
  };

  const reler = () => {
    void qc.invalidateQueries({ queryKey: CHAVES_DA_PREVIA.edicoes(site.id) });
    void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
  };

  const editar = (edicao: EdicaoDaPrevia | Record<string, unknown>, extra: { confirmar?: boolean; instrucao?: string; teto_usd?: number; modelo_id?: string } = {}) =>
    naFila(async () => {
      const r = await chamarSite<RespostaDaEdicao>("previa_editar", { site_id: site.id, edicao, ...extra });
      if (r && "site" in r && r.site) guardar(r.site);
      if (r && (r.modo === "direto" || (r.modo === "ajuste" && !r.precisa_confirmar))) {
        const avisos = (r as { avisos?: string[] }).avisos || [];
        if (avisos.length) toast.warning(avisos.join(" "));
        reler();
      }
      return r;
    });

  const desfazer = (edicaoId: string) =>
    naFila(async () => {
      const r = await chamarSite<{ site: LinhaDoSite; edicao: EdicaoRegistrada; resumo: string; trabalho?: TrabalhoDoMotor | null }>("previa_desfazer", { site_id: site.id, edicao_id: edicaoId });
      if (r && r.site) guardar(r.site);
      reler();
      return r;
    });

  return { editar, desfazer, ocupado: emAndamento > 0 };
}
