import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Situações de projeto que já não recebem tarefa nem post da agenda. */
export const PROJETO_FECHADO = ["done", "completed", "concluido", "concluded", "cancelled", "canceled", "cancelado", "archived", "arquivado"];

/**
 * Projeto ativo mais recente do cliente (a tarefa e o post da agenda sempre têm projeto).
 * 22/10: usado no gravar quando nem a tela, nem a proposta, nem a marca trazem o projeto.
 */
export async function projetoAtivoDoCliente(servico: Pick<SupabaseClient, "from">, clientId: string): Promise<string | null> {
  const { data } = await servico.from("projects").select("id, status, updated_at").eq("client_id", clientId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(20);
  const ativo = ((data as { id: string; status: string | null }[] | null) ?? []).find((x) => PROJETO_FECHADO.indexOf(String(x.status ?? "").toLowerCase()) < 0);
  return ativo ? ativo.id : null;
}
