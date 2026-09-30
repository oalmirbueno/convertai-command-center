import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import type { EtapaDaIdentidade, ModoDoProjeto } from "../../../supabase/functions/_shared/identidade-etapas";
import type { CandidatoDeNome, AlvoDoNaming } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { normalizarBrandbook, type DadosDoBrandbook, type ModeloDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";

/**
 * Mesa Identidade: a ponte da tela com a função mesa-identidade e as tabelas
 * idv_* (frente IDV). A leitura vai direto ao banco pela RLS da equipe; toda
 * escrita passa pela função (só service_role grava). O modelo das etapas, do
 * naming, das cores e do brandbook mora em supabase/functions/_shared (o
 * mesmo código roda na função, aqui e nos testes).
 *
 * Sem as tabelas (migration ainda não aplicada) a mesa abre e diz isso.
 */

export const CHAVES = {
  projetos: (clientId: string, marcaId: string | null) => ["mesa-identidade", "projetos", clientId, marcaId || "principal"] as const,
  projeto: (projetoId: string) => ["mesa-identidade", "projeto", projetoId] as const,
  rodadas: (clientId: string, filtro: string) => ["mesa-identidade", "rodadas", clientId, filtro] as const,
  brandbooks: (projetoId: string) => ["mesa-identidade", "brandbooks", projetoId] as const,
  arquivo: (fileId: string) => ["mesa-identidade", "arquivo", fileId] as const,
};

export interface ProjetoDeIdentidade {
  id: string;
  client_id: string;
  marca_id: string | null;
  modo: ModoDoProjeto;
  com_naming: boolean;
  titulo: string;
  etapa: EtapaDaIdentidade;
  concluidas: string[];
  dados: Record<string, any>;
  versao: number;
  estado: "ativo" | "entregue" | "arquivado";
  custo_usd: number;
  criado_em: string;
  atualizado_em: string;
}

export interface RodadaDeNomes {
  id: string;
  client_id: string;
  marca_id: string | null;
  projeto_id: string | null;
  campanha_id: string | null;
  alvo: AlvoDoNaming;
  pedido: string | null;
  criterios: string[];
  tecnicas: string[];
  candidatos: CandidatoDeNome[];
  escolhido: string | null;
  status: string;
  arquivo_pdf_id: string | null;
  mensagem_grupo: string | null;
  enviado_grupo_em: string | null;
  aviso_jev: string | null;
  custo_usd: number;
  criado_em: string;
}

export interface VersaoDoBrandbook {
  id: string;
  projeto_id: string;
  modelo: ModeloDoBrandbook;
  versao: number;
  dados: DadosDoBrandbook;
  nota: string | null;
  status: string;
  arquivo_pdf_id: string | null;
  token_publico: string | null;
  publicado_em: string | null;
  revogado_em: string | null;
  criado_em: string;
}

/** Tabela nova ainda não criada no banco? */
export function faltaATabela(erro: unknown): boolean {
  const e = (erro || {}) as { code?: string; message?: string };
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "banco_sem_identidade" || /idv_[a-z_]+.*(does not exist|schema cache)|relation .*idv_/i.test(String(e.message || ""));
}

export function chamarIdentidade<T = any>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  return chamarFuncao<T>("mesa-identidade", { acao, ...corpo });
}

const db = () => supabase as any;

const CAMPOS_DO_PROJETO = "id, client_id, marca_id, modo, com_naming, titulo, etapa, concluidas, dados, versao, estado, custo_usd, criado_em, atualizado_em";

function normalizarProjeto(v: any): ProjetoDeIdentidade | null {
  if (!v || typeof v.id !== "string") return null;
  return {
    ...v,
    marca_id: v.marca_id || null,
    concluidas: Array.isArray(v.concluidas) ? v.concluidas : ["inicio"],
    dados: v.dados && typeof v.dados === "object" ? v.dados : {},
    versao: Number(v.versao) || 1,
    custo_usd: Number(v.custo_usd) || 0,
  } as ProjetoDeIdentidade;
}

/**
 * Projetos do cliente na marca aberta: a principal (ou cliente sem marca) vê os
 * sem marca e os dela; outra marca só os dela (regra da herança).
 */
export function useProjetos(clientId: string, marca: { id: string; principal: boolean } | null) {
  return useQuery({
    queryKey: CHAVES.projetos(clientId, marca ? marca.id : null),
    enabled: !!clientId,
    queryFn: async (): Promise<ProjetoDeIdentidade[]> => {
      let q = db().from("idv_projetos").select(CAMPOS_DO_PROJETO).eq("client_id", clientId).neq("estado", "arquivado").order("atualizado_em", { ascending: false }).limit(30);
      if (marca && !marca.principal) q = q.eq("marca_id", marca.id);
      else if (marca) q = q.or(`marca_id.is.null,marca_id.eq.${marca.id}`);
      const { data, error } = await q;
      if (error) throw error;
      return ((data as unknown[]) || []).map(normalizarProjeto).filter((p): p is ProjetoDeIdentidade => !!p);
    },
  });
}

export function useProjeto(projetoId: string | null) {
  return useQuery({
    queryKey: CHAVES.projeto(projetoId || "nenhum"),
    enabled: !!projetoId,
    queryFn: async (): Promise<ProjetoDeIdentidade | null> => {
      const { data, error } = await db().from("idv_projetos").select(CAMPOS_DO_PROJETO).eq("id", projetoId).maybeSingle();
      if (error) throw error;
      return normalizarProjeto(data);
    },
  });
}

/** Grava a resposta da função no cache (tela nova sem reler do banco). */
export function guardarProjeto(qc: QueryClient, p: ProjetoDeIdentidade | null | undefined) {
  if (!p || !p.id) return;
  qc.setQueryData(CHAVES.projeto(p.id), normalizarProjeto(p));
  void qc.invalidateQueries({ queryKey: ["mesa-identidade", "projetos", p.client_id] });
}

const CAMPOS_DA_RODADA = "id, client_id, marca_id, projeto_id, campanha_id, alvo, pedido, criterios, tecnicas, candidatos, escolhido, status, arquivo_pdf_id, mensagem_grupo, enviado_grupo_em, aviso_jev, custo_usd, criado_em";

export function normalizarRodada(v: any): RodadaDeNomes | null {
  if (!v || typeof v.id !== "string") return null;
  return {
    ...v,
    criterios: Array.isArray(v.criterios) ? v.criterios.map(String) : [],
    tecnicas: Array.isArray(v.tecnicas) ? v.tecnicas.map(String) : [],
    candidatos: Array.isArray(v.candidatos) ? v.candidatos : [],
    custo_usd: Number(v.custo_usd) || 0,
  } as RodadaDeNomes;
}

/** Rodadas de nomes de um projeto ou de uma campanha (as mais novas primeiro). */
export function useRodadas(clientId: string, filtro: { projetoId?: string | null; campanhaId?: string | null }) {
  const chave = filtro.projetoId ? `p:${filtro.projetoId}` : filtro.campanhaId ? `c:${filtro.campanhaId}` : "todas";
  return useQuery({
    queryKey: CHAVES.rodadas(clientId, chave),
    enabled: !!clientId,
    queryFn: async (): Promise<RodadaDeNomes[]> => {
      let q = db().from("idv_naming_rodadas").select(CAMPOS_DA_RODADA).eq("client_id", clientId).neq("status", "arquivado").order("criado_em", { ascending: false }).limit(12);
      if (filtro.projetoId) q = q.eq("projeto_id", filtro.projetoId);
      else if (filtro.campanhaId) q = q.eq("campanha_id", filtro.campanhaId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data as unknown[]) || []).map(normalizarRodada).filter((r): r is RodadaDeNomes => !!r);
    },
  });
}

const CAMPOS_DO_BRANDBOOK = "id, client_id, projeto_id, modelo, versao, dados, nota, status, arquivo_pdf_id, token_publico, publicado_em, revogado_em, criado_em";

export function normalizarVersao(v: any): VersaoDoBrandbook | null {
  if (!v || typeof v.id !== "string") return null;
  return { ...v, modelo: v.modelo === "prancha" ? "prancha" : "paginado", versao: Number(v.versao) || 1, dados: normalizarBrandbook(v.dados, v.client_id) } as VersaoDoBrandbook;
}

export function useBrandbooks(projetoId: string | null) {
  return useQuery({
    queryKey: CHAVES.brandbooks(projetoId || "nenhum"),
    enabled: !!projetoId,
    queryFn: async (): Promise<VersaoDoBrandbook[]> => {
      const { data, error } = await db().from("idv_brandbooks").select(CAMPOS_DO_BRANDBOOK).eq("projeto_id", projetoId).neq("status", "arquivado").order("versao", { ascending: false }).limit(20);
      if (error) throw error;
      return ((data as unknown[]) || []).map(normalizarVersao).filter((b): b is VersaoDoBrandbook => !!b);
    },
  });
}

/** Situação do arquivo em Arquivos (revisão da agência e aprovação do cliente). */
export function useSituacaoDoArquivo(fileId: string | null) {
  return useQuery({
    queryKey: CHAVES.arquivo(fileId || "nenhum"),
    enabled: !!fileId,
    queryFn: async (): Promise<{ agency_approval_status: string | null; approval_status: string | null; visibility: string | null } | null> => {
      const { data, error } = await db().from("files").select("agency_approval_status, approval_status, visibility").eq("id", fileId).maybeSingle();
      if (error) throw error;
      return data || null;
    },
  });
}

/** Frase curta da situação da aprovação (painel e cliente). */
export function textoDaAprovacao(s: { agency_approval_status: string | null; approval_status: string | null } | null | undefined): string {
  if (!s) return "Sem envio";
  if (s.approval_status === "approved") return "Aprovado pelo cliente";
  if (s.approval_status === "rejected") return "Cliente pediu ajuste";
  if (s.agency_approval_status === "approved") return "Revisado, esperando o cliente";
  if (s.agency_approval_status === "rejected") return "Revisão pediu ajuste";
  if (s.agency_approval_status === "pending") return "Na revisão da agência";
  return "Em Arquivos";
}

/** Pasta do projeto no bucket mesa (a regra do servidor aceita só esta pasta). */
export function pastaDoProjeto(clientId: string, projetoId: string): string {
  return `${clientId}/marca/identidade/${projetoId}`;
}
