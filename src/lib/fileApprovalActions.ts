import { supabase } from "@/integrations/supabase/client";

export type FileApprovalDecision = "approved" | "rejected";
export type FileReleaseMode = "client_shared" | "approval";

type RpcResult<T = unknown> = {
  data: T;
  error: { message?: string } | null;
};

type ApprovalRpc = <T = unknown>(
  functionName: string,
  args: Record<string, unknown>,
) => Promise<RpcResult<T>>;

async function runApprovalRpc<T = unknown>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as ApprovalRpc;
  const { data, error } = await rpc<T>(functionName, args);
  if (error) throw error;
  return data;
}

export function requestFileAgencyReview(fileId: string) {
  return runApprovalRpc("request_file_agency_review", {
    p_file_id: fileId,
  });
}

export function reviewFileAgency(
  fileId: string,
  decision: FileApprovalDecision,
  feedback?: string | null,
) {
  return runApprovalRpc("review_file_agency", {
    p_file_id: fileId,
    p_decision: decision,
    p_feedback: feedback?.trim() || null,
  });
}

export function releaseFileToClient(fileId: string, mode: FileReleaseMode) {
  return runApprovalRpc("release_file_to_client", {
    p_file_id: fileId,
    p_mode: mode,
  });
}

/**
 * O cliente aprovou por fora (no grupo, no WhatsApp, no telefone) e a equipe
 * registra por ele. Guarda quem registrou e por onde veio o aceite, para o
 * histórico nunca fingir que o cliente clicou no painel.
 */
export type OfflineApprovalChannel =
  | "grupo"
  | "whatsapp"
  | "ligacao"
  | "presencial"
  | "email";

export function recordOfflineClientApproval(
  fileId: string,
  expectedVersion: number,
  channel: OfflineApprovalChannel,
  note?: string | null,
) {
  return runApprovalRpc("record_offline_client_approval", {
    p_file_id: fileId,
    p_expected_version: expectedVersion,
    p_channel: channel,
    p_note: note?.trim() || null,
  });
}

/**
 * Frente EN (28/09): o cliente deu o aval ao admin ("aprova por mim") e o admin
 * ou o gestor aprova em nome dele, num passo só no banco: revisão da agência,
 * liberação e o aceite do cliente (canal "equipe"). O cliente recebe um aviso e
 * vê no histórico "Aprovado por <nome> em nome do cliente". Só admin e gestor.
 */
export const NOTA_DO_AVAL = "aval do cliente ao admin";

export type EstadoDaAprovacaoPeloCliente = "aprovado" | "ja_aprovado" | "disponivel";

export interface AprovacaoPeloCliente {
  file_id: string;
  estado: EstadoDaAprovacaoPeloCliente;
  aprovado_por?: string;
}

export function aprovarPeloCliente(fileId: string, nota?: string | null) {
  return runApprovalRpc<AprovacaoPeloCliente>("aprovar_pelo_cliente", {
    p_file_id: fileId,
    p_nota: nota?.trim() || NOTA_DO_AVAL,
  });
}

/** Material que o admin ainda pode aprovar pelo cliente (o banco confere de novo). */
export function podeAprovarPeloCliente(f: {
  parent_file_id?: string | null;
  archived_at?: string | null;
  status?: string | null;
  visibility?: string | null;
  approval_status?: string | null;
  agency_approval_status?: string | null;
} | null | undefined): boolean {
  if (!f || f.parent_file_id || f.archived_at) return false;
  if ((f.status || "ready") !== "ready") return false;
  if (f.approval_status === "approved" || f.approval_status === "rejected") return false;
  if (f.agency_approval_status === "rejected") return false;
  if (f.visibility === "client_shared") return false;
  return true;
}

/** Frase curta para o erro do banco ao aprovar pelo cliente. */
export function motivoDaRecusaDaAprovacao(erro: unknown): string {
  const msg = erro && typeof erro === "object" && "message" in erro ? String((erro as { message?: unknown }).message || "") : String(erro || "");
  if (/só admin ou gestor|42501|access denied|sem acesso/i.test(msg)) return "Só admin ou gestor com acesso ao cliente aprova por ele.";
  if (/reprovado|rejected/i.test(msg)) return "Este material foi reprovado e a decisão é final. Entregue uma nova versão.";
  if (/arquivado/i.test(msg)) return "O material está arquivado. Desarquive antes de aprovar.";
  if (/immutable|travad/i.test(msg)) return "Esta versão já está travada. Confira o estado em Arquivos.";
  if (/snapshot/i.test(msg)) return "O post da Agenda mudou enquanto aprovava. Abra de novo e tente outra vez.";
  if (/could not find the function|does not exist/i.test(msg)) return "O banco ainda não tem a aprovação pelo cliente (migration EN-01 pendente).";
  return msg || "Não foi possível aprovar pelo cliente.";
}

export function decideFileApproval(
  fileId: string,
  expectedVersion: number,
  decision: FileApprovalDecision,
  feedback?: string | null,
) {
  return runApprovalRpc("decide_file_approval", {
    p_file_id: fileId,
    p_expected_version: expectedVersion,
    p_decision: decision,
    p_feedback: feedback?.trim() || null,
  });
}
