import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Briefing, Campanha, ConteudoDaCampanha, EstadoDoEstudio, Formato, LancamentoDoExtrato, Marca, ResumoDaCampanha } from "./modelo";

/**
 * Chamadas do Aceleriq de Bolso. Tudo passa pelas funções bolso_* do banco (o membro não lê tabela) e pela
 * edge function "bolso" (processar o próprio job). Download por URL assinada curta do bucket privado.
 */

const banco = supabase as unknown as SupabaseClient;

/** Erros do banco do estúdio já vêm em português claro; o resto vira frase genérica. */
export function erroDoBolso(e: unknown): string {
  const obj = (e || {}) as { code?: string; message?: string; context?: { status?: number } };
  const codigos = ["42501", "22023", "40001", "53400", "P0001"];
  if (obj.message && obj.code && codigos.indexOf(obj.code) >= 0) return obj.message;
  if (obj.context && obj.context.status === 401) return "Sua sessão venceu. Entre de novo.";
  if (obj.message && /Failed to fetch|NetworkError|network/i.test(obj.message)) return "Sem conexão. Confira a internet e tente de novo.";
  return "Não foi possível concluir agora. Tente de novo em instantes.";
}

async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await banco.rpc(nome, args || {});
  if (error) throw error;
  return data as T;
}

export const lerEstado = () => rpc<EstadoDoEstudio>("bolso_estado");
export const lerExtrato = (limite = 50) => rpc<LancamentoDoExtrato[]>("bolso_extrato", { _limite: limite });
export const lerMarca = () => rpc<Marca | null>("bolso_marca_ler");
export const salvarMarca = (m: Marca) => rpc<Marca>("bolso_marca_salvar", { _dados: m, _versao: m.versao ?? null });
export const listarCampanhas = () => rpc<ResumoDaCampanha[]>("bolso_campanhas_listar");
export const lerCampanha = (id: string) => rpc<Campanha>("bolso_campanha_ler", { _id: id });
export const salvarCampanha = (dados: { id?: string; titulo?: string; briefing: Briefing }, versao?: number) =>
  rpc<string>("bolso_campanha_salvar", { _dados: dados, _versao: versao ?? null });
export const salvarVersao = (campanha: string, conteudo: ConteudoDaCampanha) => rpc<number>("bolso_versao_salvar", { _campanha: campanha, _conteudo: conteudo });
export const escolherVersao = (campanha: string, numero: number) => rpc<void>("bolso_versao_escolher", { _campanha: campanha, _numero: numero });
export const escolherArte = (arquivo: string) => rpc<void>("bolso_arte_escolher", { _arquivo: arquivo });
export const cancelarPedido = (job: string) => rpc<void>("bolso_cancelar", { _job: job });

export function pedir(campanha: string, tipo: "texto" | "imagem", formato: Formato | null, chave: string, tarifaVista: number) {
  return rpc<{ job_id: string; estado: string; repetido: boolean; tarifa?: number; provedor?: string }>("bolso_pedir", {
    _campanha: campanha, _tipo: tipo, _formato: formato, _chave: chave, _tarifa_vista: tarifaVista,
  });
}

/** Pede ao servidor para processar o job (o crédito já está reservado; repetir não cobra de novo). */
export async function processar(jobId: string): Promise<{ estado: string }> {
  const { data, error } = await supabase.functions.invoke("bolso", { body: { acao: "processar", job_id: jobId } });
  if (error) throw error;
  return data as { estado: string };
}

/** URL assinada de 60 s para ver ou baixar a arte (só a pasta do dono abre). */
export async function urlDaArte(caminho: string, nomeParaBaixar?: string): Promise<string> {
  const { data, error } = await supabase.storage.from("bolso").createSignedUrl(caminho, 60, nomeParaBaixar ? { download: nomeParaBaixar } : undefined);
  if (error || !data) throw error || new Error("Arquivo indisponível");
  return data.signedUrl;
}

// ─── Administração ─────────────────────────────────────────────────────
export interface VisaoAdmin {
  config: { modulo_exposto: boolean; geracao_real: boolean; pagamentos: boolean; modo_simulado: boolean; kill_switch: boolean;
    limites: { paralelo_por_usuario: number; pedidos_por_dia_usuario: number; teto_global_dia: number } | null; destino_agencia: string | null };
  politicas: { id: string; versao: number; estado: "rascunho" | "aprovado" | "arquivado"; teste: boolean; nota: string;
    dados: { creditos_iniciais: number; tarifa_texto: number; tarifa_imagem: number; validade_meses: number; formatos: Formato[] }; aprovado_em: string | null }[];
  incertos: { id: string; tipo: string; provedor: string; carteira: string; erro: string | null; atualizado_em: string }[];
  fila: number;
  direitos: number;
  eventos_pendentes: number;
}

export const lerVisaoAdmin = () => rpc<VisaoAdmin>("bolso_admin_visao");
export const salvarConfig = (dados: Record<string, unknown>) => rpc<VisaoAdmin["config"]>("bolso_admin_config", { _dados: dados });
export const criarPolitica = (dados: VisaoAdmin["politicas"][number]["dados"], teste: boolean, nota: string) =>
  rpc<string>("bolso_admin_politica_criar", { _dados: dados, _teste: teste, _nota: nota });
export const aprovarPolitica = (id: string) => rpc<void>("bolso_admin_politica_aprovar", { _id: id });
export const arquivarPolitica = (id: string) => rpc<void>("bolso_admin_politica_arquivar", { _id: id });
export const concederAcesso = (userId: string, tipo: "anual" | "teste", politica: string, referencia: string) =>
  rpc<string>("bolso_admin_conceder", { _user: userId, _tipo: tipo, _politica: politica, _referencia: referencia });
export const reconciliar = (job: string, decisao: "liberar" | "reenfileirar") => rpc<void>("bolso_admin_reconciliar", { _job: job, _decisao: decisao });
export async function processarFila(): Promise<{ processados: { job_id: string; estado: string }[] }> {
  const { data, error } = await supabase.functions.invoke("bolso", { body: { acao: "processar_fila" } });
  if (error) throw error;
  return data as { processados: { job_id: string; estado: string }[] };
}
