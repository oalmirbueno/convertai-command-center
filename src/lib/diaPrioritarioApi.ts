import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DiaPrioritarioDoCliente, SituacaoDoDia, TipoDeRegistro } from "@/lib/diaPrioritario";

/**
 * Dia Prioritário no painel: leituras e escritas. Toda escrita passa pelas RPCs do banco
 * (dia_prioritario_definir só para admin; dia_prioritario_registrar para a equipe do cliente).
 * O cliente lê só o próprio dia, e só confirmado (RLS).
 */

const COLUNAS = "client_id, dia, situacao, origem, observacao, dias_indisponiveis, definido_por, atualizado_em";

export const CHAVE_DOS_DIAS = ["dia-prioritario", "todos"] as const;
export const chaveDoDia = (clientId: string | null | undefined) => ["dia-prioritario", "cliente", clientId || "-"] as const;
export const chaveDoHistorico = (clientId: string | null | undefined) => ["dia-prioritario", "historico", clientId || "-"] as const;
export const CHAVE_DO_VIDEO = ["dia-prioritario", "video"] as const;

/** Todos os dias que a pessoa pode ver (equipe: os clientes que ela acessa). */
export function useDiasPrioritarios(ligado = true) {
  return useQuery({
    queryKey: CHAVE_DOS_DIAS,
    enabled: ligado,
    staleTime: 60_000,
    queryFn: async (): Promise<DiaPrioritarioDoCliente[]> => {
      const { data, error } = await supabase.from("cliente_dia_prioritario").select(COLUNAS);
      if (error) throw error;
      return (data ?? []) as DiaPrioritarioDoCliente[];
    },
  });
}

/** O dia de um cliente (null quando ainda não tem, ou quando o cliente não pode ver). */
export function useDiaDoCliente(clientId: string | null | undefined) {
  return useQuery({
    queryKey: chaveDoDia(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<DiaPrioritarioDoCliente | null> => {
      const { data, error } = await supabase.from("cliente_dia_prioritario").select(COLUNAS).eq("client_id", clientId as string).maybeSingle();
      if (error) throw error;
      return (data as DiaPrioritarioDoCliente | null) ?? null;
    },
  });
}

export interface MudancaDoDia {
  id: string;
  dia_antes: number | null;
  dia_depois: number | null;
  situacao_antes: string | null;
  situacao_depois: string;
  origem: string;
  motivo: string | null;
  autor: string | null;
  em: string;
}

export function useHistoricoDoDia(clientId: string | null | undefined, ligado = true) {
  return useQuery({
    queryKey: chaveDoHistorico(clientId),
    enabled: !!clientId && ligado,
    staleTime: 60_000,
    queryFn: async (): Promise<MudancaDoDia[]> => {
      const { data, error } = await supabase
        .from("cliente_dia_prioritario_historico")
        .select("id, dia_antes, dia_depois, situacao_antes, situacao_depois, origem, motivo, autor, em")
        .eq("client_id", clientId as string)
        .order("em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as MudancaDoDia[];
    },
  });
}

/** Erro do banco em português (as RPCs devolvem códigos estáveis). */
export function textoDoErroDoDia(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e || "");
  if (m.includes("DIA_PRIORITARIO_MANUAL_PRESERVADO")) return "Este cliente já tem um dia definido à mão. Para trocar pela sugestão, confirme a substituição.";
  if (m.includes("RPC_ADMIN_REQUIRED")) return "Só administradores mudam o Dia Prioritário.";
  if (m.includes("RPC_STAFF_REQUIRED") || m.includes("RPC_CLIENT_SCOPE_DENIED")) return "Você não tem acesso a este cliente.";
  if (m.includes("DIA_PRIORITARIO_DIA_INVALIDO")) return "Escolha um dia de segunda a sexta.";
  if (m.includes("DIA_PRIORITARIO_CLIENTE_INVALIDO")) return "Cliente não encontrado.";
  if (m.includes("DIA_PRIORITARIO_DATA_FUTURA")) return "O registro é do que já aconteceu: a data não pode ser futura.";
  return "Não foi possível salvar agora. Tente de novo.";
}

export async function definirDia(p: {
  clientId: string;
  dia: number | null;
  situacao: SituacaoDoDia;
  origem: "manual" | "sugerida";
  observacao?: string | null;
  motivo?: string | null;
  diasIndisponiveis?: number[] | null;
  substituirManual?: boolean;
}): Promise<DiaPrioritarioDoCliente> {
  const { data, error } = await supabase.rpc("dia_prioritario_definir", {
    _client_id: p.clientId,
    _dia: p.situacao === "nao_aplicavel" ? null : p.dia,
    _situacao: p.situacao,
    _origem: p.origem,
    _observacao: p.observacao ?? null,
    _motivo: p.motivo ?? null,
    _dias_indisponiveis: p.diasIndisponiveis ?? null,
    _substituir_manual: !!p.substituirManual,
  });
  if (error) throw error;
  return data as unknown as DiaPrioritarioDoCliente;
}

export async function registrarNoDia(p: {
  clientId: string;
  tipo: TipoDeRegistro;
  resumo?: string;
  combinados?: string;
  proximosPassos?: string;
  data?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("dia_prioritario_registrar", {
    _client_id: p.clientId,
    _tipo: p.tipo,
    _resumo: p.resumo || null,
    _combinados: p.combinados || null,
    _proximos_passos: p.proximosPassos || null,
    _data: p.data || null,
  });
  if (error) throw error;
  return data as string;
}

/** Depois de salvar: relê o que mostra o dia (Central, cadastro, card). */
export function useReleDoDia() {
  const qc = useQueryClient();
  return (clientId?: string) => {
    void qc.invalidateQueries({ queryKey: ["dia-prioritario"] });
    if (clientId) void qc.invalidateQueries({ queryKey: ["dia-prioritario", "registros", clientId] });
  };
}

// ------------------------------------------------------------------ vídeo oficial

export interface VideoDoDia {
  titulo: string;
  fonte: "arquivo" | "link" | null;
  video_path: string | null;
  video_url: string | null;
  capa_path: string | null;
  publicado: boolean;
  atualizado_em: string;
}

export const PASTA_DO_VIDEO = "agencia/dia-prioritario";
const BUCKET = "mesa";

/** O vídeo oficial. Para o cliente, só volta quando publicado (RLS); sem linha, null. */
export function useVideoDoDia(ligado = true) {
  return useQuery({
    queryKey: CHAVE_DO_VIDEO,
    enabled: ligado,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VideoDoDia | null> => {
      const { data, error } = await supabase
        .from("dia_prioritario_video")
        .select("titulo, fonte, video_path, video_url, capa_path, publicado, atualizado_em")
        .maybeSingle();
      if (error) throw error;
      return (data as VideoDoDia | null) ?? null;
    },
  });
}

/** O vídeo pode aparecer? Publicado e com a fonte preenchida (nunca player vazio). */
export const videoPronto = (v: VideoDoDia | null | undefined): v is VideoDoDia =>
  !!v && v.publicado && ((v.fonte === "arquivo" && !!v.video_path) || (v.fonte === "link" && !!v.video_url));

/** URL assinada (10 min) de um arquivo do vídeo; null quando não abre. */
export async function urlDoArquivoDoVideo(caminho: string | null | undefined): Promise<string | null> {
  if (!caminho) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 600);
  return error || !data ? null : data.signedUrl;
}

/** Envia o vídeo ou a capa (admin), sempre com nome novo: nada é sobrescrito. */
export async function enviarArquivoDoVideo(arquivo: File, tipo: "video" | "capa"): Promise<string> {
  const ext = (arquivo.name.split(".").pop() || (tipo === "video" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const caminho = `${PASTA_DO_VIDEO}/${tipo}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (error) throw error;
  return caminho;
}

export async function salvarVideoDoDia(v: Partial<Pick<VideoDoDia, "titulo" | "fonte" | "video_path" | "video_url" | "capa_path" | "publicado">>): Promise<void> {
  const { error } = await supabase.from("dia_prioritario_video").update(v).eq("id", true);
  if (error) throw error;
}

// ------------------------------------------------------------------ dados da sugestão e da Central

export interface TarefaDoDia {
  id: string;
  title: string;
  status: string | null;
  due_date: string | null;
  client_id: string;
  delivery_type: string | null;
}

/** Tarefas abertas dos clientes (a fila real do Kanban; nada é copiado ou criado). */
export async function tarefasAbertasDosClientes(): Promise<TarefaDoDia[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, due_date, delivery_type, projects!inner(client_id, deleted_at)")
    .is("deleted_at", null)
    .is("projects.deleted_at", null)
    .not("status", "in", "(done,archived,cancelled)")
    .limit(3000);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((t) => {
      const p = t.projects as { client_id?: string } | Array<{ client_id?: string }> | null;
      const clientId = Array.isArray(p) ? p[0]?.client_id : p?.client_id;
      return { id: String(t.id), title: String(t.title || ""), status: (t.status as string) ?? null, due_date: (t.due_date as string) ?? null, delivery_type: (t.delivery_type as string) ?? null, client_id: String(clientId || "") };
    })
    .filter((t) => !!t.client_id);
}
