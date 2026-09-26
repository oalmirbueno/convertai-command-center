import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import {
  ehPecaDeVideo,
  FORMATOS_DE_VIDEO,
  normalizarEstruturaDoModelo,
  normalizarLinhaDoRoteiro,
  type AvisoDoJev,
  type EstruturaDoModelo,
  type LinhaDoRoteiro,
  type Roteiro,
  type StatusDoRoteiro,
  type TipoDeRoteiro,
  type VersaoDoRoteiro,
} from "../../../supabase/functions/_shared/roteiro-modelo";

/**
 * Mesa Roteiros: a ponte da tela com a função mesa-roteiros e as tabelas
 * roteiros e roteiro_modelos (Frente R2). O modelo do roteiro, as versões e
 * o PDF moram em supabase/functions/_shared (o mesmo código roda na função e
 * aqui). A leitura vai direto ao banco pela RLS da equipe; toda escrita passa
 * pela função (só service_role grava).
 *
 * Sem a tabela (SQL ainda não aplicado) a mesa abre e diz isso, sem quebrar.
 */

export const CHAVES = {
  pecas: (clientId: string) => ["mesa-roteiros", "pecas", clientId] as const,
  roteiros: (clientId: string) => ["mesa-roteiros", "roteiros", clientId] as const,
  modelos: (clientId: string) => ["mesa-roteiros", "modelos", clientId] as const,
};

export interface PecaDeVideo {
  id: string;
  titulo: string;
  descricao: string | null;
  data: string | null;
  formato: string;
  status: string;
  /** A agenda já tem roteiro gravado desta peça (calendario_propostas). */
  temRoteiroDaAgenda: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function diaIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Tabela nova ainda não criada no banco? */
export function faltaATabela(erro: unknown): boolean {
  const e = (erro || {}) as { code?: string; message?: string };
  return e.code === "42P01" || e.code === "PGRST205" || /roteiro(s|_modelos)?.*(does not exist|schema cache)|relation .*roteiro/i.test(String(e.message || ""));
}

/**
 * Peças de vídeo da agenda (Reels, vídeo, short, story), da semana passada
 * até 6 semanas à frente, e se a agenda já tem roteiro gravado de cada uma.
 */
export function usePecasDeVideo(clientId: string) {
  return useQuery({
    queryKey: CHAVES.pecas(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<PecaDeVideo[]> => {
      const hoje = new Date();
      const de = diaIso(new Date(hoje.getTime() - 7 * 86400000));
      const ate = diaIso(new Date(hoje.getTime() + 45 * 86400000));
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select("id, title, description, due_date, delivery_type, status, projects!inner(client_id, deleted_at)")
        .eq("projects.client_id", clientId)
        .is("projects.deleted_at", null)
        .is("deleted_at", null)
        .in("delivery_type", FORMATOS_DE_VIDEO)
        .gte("due_date", de)
        .lt("due_date", ate)
        .order("due_date", { ascending: true })
        .limit(80);
      if (error) throw error;
      const tarefas = ((data || []) as any[]).filter((t) => ehPecaDeVideo(t.delivery_type));
      const ids = tarefas.map((t) => String(t.id));
      const comRoteiro: Record<string, true> = {};
      if (ids.length) {
        const { data: propostas } = await (supabase as any)
          .from("calendario_propostas")
          .select("task_ids")
          .eq("client_id", clientId)
          .eq("status", "gravada")
          .overlaps("task_ids", ids);
        ((propostas || []) as { task_ids: string[] | null }[]).forEach((p) => (p.task_ids || []).forEach((t) => (comRoteiro[t] = true)));
      }
      return tarefas.map((t) => ({
        id: String(t.id),
        titulo: String(t.title || "Peça sem título"),
        descricao: t.description || null,
        data: t.due_date || null,
        formato: String(t.delivery_type || ""),
        status: String(t.status || ""),
        temRoteiroDaAgenda: !!comRoteiro[String(t.id)],
      }));
    },
  });
}

export interface RoteirosDoCliente {
  lista: LinhaDoRoteiro[];
  /** A tabela ainda não existe no banco (SQL pendente). */
  indisponivel: boolean;
}

export function useRoteiros(clientId: string) {
  return useQuery({
    queryKey: CHAVES.roteiros(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<RoteirosDoCliente> => {
      const { data, error } = await (supabase as any)
        .from("roteiros")
        .select("*")
        .eq("client_id", clientId)
        .order("atualizado_em", { ascending: false })
        .limit(200);
      if (error) {
        if (faltaATabela(error)) return { lista: [], indisponivel: true };
        throw error;
      }
      const lista = ((data || []) as unknown[]).map(normalizarLinhaDoRoteiro).filter((l): l is LinhaDoRoteiro => !!l);
      return { lista, indisponivel: false };
    },
  });
}

export interface ModeloDeRoteiro {
  id: string;
  escopo: "cliente" | "agencia";
  nome: string;
  tipo: TipoDeRoteiro;
  estrutura: EstruturaDoModelo;
  criado_em: string;
}

export function useModelos(clientId: string) {
  return useQuery({
    queryKey: CHAVES.modelos(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<{ lista: ModeloDeRoteiro[]; indisponivel: boolean }> => {
      const { data, error } = await (supabase as any)
        .from("roteiro_modelos")
        .select("id, escopo, client_id, nome, tipo, estrutura, criado_em")
        .is("revogado_em", null)
        .or(`client_id.eq.${clientId},escopo.eq.agencia`)
        .order("criado_em", { ascending: false })
        .limit(100);
      if (error) {
        if (faltaATabela(error)) return { lista: [], indisponivel: true };
        throw error;
      }
      const lista = ((data || []) as any[])
        .filter((m) => m && UUID.test(String(m.id)))
        .map((m) => {
          const estrutura = normalizarEstruturaDoModelo(m.estrutura);
          return {
            id: String(m.id),
            escopo: m.escopo === "agencia" ? ("agencia" as const) : ("cliente" as const),
            nome: String(m.nome || "Modelo"),
            tipo: estrutura.tipo,
            estrutura,
            criado_em: String(m.criado_em || ""),
          };
        });
      return { lista, indisponivel: false };
    },
  });
}

/** Roteiro vivo de cada peça (o não arquivado mais recente). */
export function roteiroDaPeca(lista: LinhaDoRoteiro[], taskId: string): LinhaDoRoteiro | null {
  return lista.filter((r) => r.task_id === taskId && !r.arquivado_em)[0] || null;
}

// ------------------------------------------------------------------ chamadas

export interface RespostaDoRoteiro {
  roteiro: LinhaDoRoteiro | null;
  versao?: VersaoDoRoteiro;
  aviso_jev?: AvisoDoJev | null;
  aviso_banco?: string | null;
  custo_usd?: number;
  saldo_usd?: number;
  sem_mudanca?: boolean;
}

function comRoteiroNormalizado<T extends { roteiro?: unknown }>(r: T): T & { roteiro: LinhaDoRoteiro | null } {
  return { ...r, roteiro: normalizarLinhaDoRoteiro(r && r.roteiro) };
}

export async function chamarRoteiros<T = RespostaDoRoteiro>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  const r = await chamarFuncao<any>("mesa-roteiros", { acao, ...corpo });
  return (r && typeof r === "object" && "roteiro" in r ? comRoteiroNormalizado(r) : r) as T;
}

export interface PedidoDeGeracao {
  client_id: string;
  task_id?: string | null;
  roteiro_id?: string | null;
  tipo: TipoDeRoteiro;
  duracao_s: number;
  objetivo?: string;
  pedido?: string;
  tema?: string;
  modelo_id?: string | null;
  modelo_roteiro_id?: string | null;
}

export const gerarRoteiro = (p: PedidoDeGeracao) => chamarRoteiros("gerar", p as unknown as Record<string, unknown>);
export const salvarVersao = (roteiroId: string, conteudo: Roteiro, versaoBase: number, nota?: string) =>
  chamarRoteiros("versao_salvar", { roteiro_id: roteiroId, conteudo, versao_base: versaoBase, nota });
export const mudarStatus = (roteiroId: string, status: StatusDoRoteiro) => chamarRoteiros<RespostaDoRoteiro & { modelo?: { id: string; nome: string } | null }>("status_mudar", { roteiro_id: roteiroId, status });

/** Guarda a linha nova no cache (a lista reflete na hora) e relê em seguida. */
export function atualizarNoCache(qc: QueryClient, clientId: string, linha: LinhaDoRoteiro | null) {
  if (linha) {
    qc.setQueryData<RoteirosDoCliente>(CHAVES.roteiros(clientId), (atual) => {
      const lista = (atual ? atual.lista : []).filter((r) => r.id !== linha.id);
      return { lista: [linha].concat(lista), indisponivel: false };
    });
  }
  void qc.invalidateQueries({ queryKey: CHAVES.roteiros(clientId) });
}
