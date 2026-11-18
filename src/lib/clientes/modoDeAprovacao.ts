/**
 * A regra de aprovação do cliente no cadastro (profiles.modo_aprovacao_do_cliente,
 * migration 20261114210000). É só o registro da regra: as funções de agenda e
 * de publicação não leem esta coluna, então mudar aqui não pula a aprovação
 * de ninguém.
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

/** Grava a regra no cadastro. Só altera esta coluna; nada é agendado nem publicado por isso. */
export async function salvarModoDeAprovacao(clientId: string, modo: ModoDeAprovacao): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("profiles").update({ modo_aprovacao_do_cliente: modo }).eq("id", clientId);
  if (error) throw new Error(error.message || "Não foi possível salvar a regra de aprovação.");
}
