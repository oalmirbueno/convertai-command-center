/**
 * A regra de aprovação do cliente no cadastro (profiles.modo_aprovacao_do_cliente,
 * migration 20261114210000). Desde 27/11/2026 (migration 20261127120000) o
 * banco usa a regra EXATA 'dispensada' na Agenda, no agendamento e no envio:
 * peça aprovada pela agência (interna ou já liberada, sem decisão do cliente)
 * segue sem pedir o cliente, e cada publicação registra a dispensa. Nada aqui aprova pelo
 * cliente; a tela só lê a regra para não esconder o botão (o banco decide).
 *
 * A coluna é lida à parte, e não no select da carteira: se a leitura falhar,
 * a ficha continua abrindo e este bloco só avisa que não conseguiu ler.
 * Quem grava é só o admin (o gatilho profiles_guard_editable_fields barra o
 * resto no banco; a tela deixa o campo só para leitura).
 */

import { supabase } from "@/integrations/supabase/client";

export type ModoDeAprovacao = "portal" | "dispensada";

export const MODOS_DE_APROVACAO: readonly ModoDeAprovacao[] = ["portal", "dispensada"];

export const ROTULO_DO_MODO: Record<ModoDeAprovacao, string> = {
  portal: "Pelo portal do cliente",
  dispensada: "A revisão interna basta (exceção)",
};

export const EXPLICACAO_DO_MODO: Record<ModoDeAprovacao, string> = {
  portal: "O cliente vê a peça no portal e aprova ou pede ajuste. É a regra de todos os clientes.",
  dispensada: "Exceção combinada com o cliente: a revisão interna da agência é suficiente para a peça seguir.",
};

/** Qualquer valor desconhecido vale `portal`, o caminho normal. */
export function modoDeAprovacaoDe(valor: unknown): ModoDeAprovacao {
  return valor === "dispensada" ? "dispensada" : "portal";
}

/** Lê a regra do cliente. Lança se a leitura falhar (a tela trata e não trava a ficha). */
export async function lerModoDeAprovacao(clientId: string): Promise<ModoDeAprovacao> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from("profiles").select("modo_aprovacao_do_cliente").eq("id", clientId).maybeSingle();
  if (error) throw new Error(error.message || "Não foi possível ler a regra de aprovação.");
  return modoDeAprovacaoDe(data?.modo_aprovacao_do_cliente);
}

/** Estado do arquivo que a dispensa cobre (espelho de editorial_file_client_approval_waived). */
export interface ArquivoQuePodeSerDispensado {
  client_id?: string | null;
  parent_file_id?: string | null;
  archived_at?: string | null;
  status?: string | null;
  agency_approval_status?: string | null;
  visibility?: string | null;
  approval_status?: string | null;
  requires_approval?: boolean | null;
  client_decided_at?: string | null;
  client_decided_by?: string | null;
  locked_at?: string | null;
}

/**
 * Raiz aprovada pela agência, sem decisão do cliente e sem trava, em um dos
 * dois estados coerentes: interno (internal/none/requires_approval false) ou
 * liberado (approval/pending/requires_approval true). Mesmo predicado do SQL.
 */
export function arquivoLiberadoSemDecisao(f: ArquivoQuePodeSerDispensado | null | undefined): boolean {
  if (
    !f
    || f.parent_file_id
    || f.archived_at != null
    || (f.status ?? "ready") !== "ready"
    || f.agency_approval_status !== "approved"
    || f.client_decided_at != null
    || f.client_decided_by != null
    || f.locked_at
  ) return false;
  const interno = f.visibility === "internal" && f.approval_status === "none" && f.requires_approval === false;
  const liberado = f.visibility === "approval" && f.approval_status === "pending" && f.requires_approval === true;
  return interno || liberado;
}

/**
 * Agenda (só equipe): dos clientes informados, quais têm a regra exata
 * 'dispensada'. Falha de leitura devolve vazio: a tela cai no portal, que é o
 * caminho normal. Nada é gravado.
 */
export async function lerClientesComAprovacaoDispensada(clientIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (!ids.length) return new Set();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from("profiles").select("id, modo_aprovacao_do_cliente").in("id", ids);
    if (error || !Array.isArray(data)) return new Set();
    return new Set(
      (data as Array<{ id: string; modo_aprovacao_do_cliente?: unknown }>)
        .filter((linha) => linha.modo_aprovacao_do_cliente === "dispensada")
        .map((linha) => linha.id),
    );
  } catch {
    return new Set();
  }
}

/** Marca só de tela: raiz aprovada pela agência, sem decisão, de um cliente com a aprovação dispensada. */
export function marcarAprovacaoDispensada<T extends ArquivoQuePodeSerDispensado>(arquivo: T, dispensados: ReadonlySet<string>): T {
  if (!arquivo.client_id || !dispensados.has(arquivo.client_id) || !arquivoLiberadoSemDecisao(arquivo)) return arquivo;
  return { ...arquivo, client_approval_waived: true };
}

/** Grava a regra no cadastro. Só altera esta coluna; nada é agendado nem publicado por isso. */
export async function salvarModoDeAprovacao(clientId: string, modo: ModoDeAprovacao): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("profiles").update({ modo_aprovacao_do_cliente: modo }).eq("id", clientId);
  if (error) throw new Error(error.message || "Não foi possível salvar a regra de aprovação.");
}
