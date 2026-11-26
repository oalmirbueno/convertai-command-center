import { supabase } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

/**
 * Excluir cliente (26/11/2026, dono: "coloque uma opção de excluir clientes").
 *
 * A exclusão é a mesma de sempre (manage-team "delete" → admin_purge_user): apaga a conta e tudo o que é do
 * cliente, inclusive as cobranças, de forma definitiva. Por isso a janela mostra antes o que vai sumir, oferece
 * Inativar (some das listas e do ciclo, mas guarda o histórico e o Financeiro) e só libera com o nome digitado.
 */

export type OQueVaiSumir = { projetos: number; arquivos: number; posts: number; cobrancas: number; cobrancasPagas: number };

async function contar(tabela: "projects" | "files" | "editorial_posts" | "billing", clientId: string, soPagas = false): Promise<number> {
  // Tabela escolhida em tempo de execução: sem o tipo gerado (o TS estoura a profundidade com a união).
  type Consulta = PromiseLike<{ count: number | null; error: unknown }> & { eq: (c: string, v: string) => Consulta; in: (c: string, v: string[]) => Consulta };
  const base = (supabase as unknown as { from: (t: string) => { select: (c: string, o: { count: "exact"; head: true }) => Consulta } }).from(tabela);
  let consulta = base.select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (soPagas) consulta = consulta.in("status", ["paid", "partial"]);
  const { count, error } = await consulta;
  if (error) throw error;
  return count ?? 0;
}

/** O que a exclusão leva junto, para a pessoa decidir sabendo. */
export async function oQueVaiSumir(clientId: string): Promise<OQueVaiSumir> {
  const [projetos, arquivos, posts, cobrancas, cobrancasPagas] = await Promise.all([
    contar("projects", clientId),
    contar("files", clientId),
    contar("editorial_posts", clientId),
    contar("billing", clientId),
    contar("billing", clientId, true),
  ]);
  return { projetos, arquivos, posts, cobrancas, cobrancasPagas };
}

/** Normaliza o nome digitado para a conferência (sem acento, caixa e espaços duplos). */
export function nomeConfere(digitado: string, nome: string): boolean {
  const limpar = (s: string) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const alvo = limpar(nome);
  return alvo.length > 0 && limpar(digitado) === alvo;
}

/** Exclui de vez (só admin; o servidor confere). */
export async function excluirCliente(clientId: string): Promise<void> {
  const res = await supabase.functions.invoke("manage-team", { body: { action: "delete", user_id: clientId } });
  if (res.data?.error) throw new Error(res.data.error);
  if (res.error) throw new Error(await getSupabaseFunctionErrorMessage(res.error, "Erro ao excluir"));
}

/** Alternativa segura: inativa (some das listas e do ciclo, histórico e Financeiro ficam). */
export async function inativarCliente(clientId: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ plan_status: "inactive" } as never).eq("id", clientId);
  if (error) throw error;
}
