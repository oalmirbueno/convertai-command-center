import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/integrations/supabase/types";

/**
 * Reajuste do pró-labore nos Custos fixos: encerra a recorrência mensal antiga (recurrence "none") e cria o
 * lançamento novo a partir deste mês. São duas escritas sem transação. Antes nenhuma conferia o erro: se o
 * insert falhasse depois do update (RLS, rede), o pró-labore sumia dos custos fixos recorrentes (a linha velha
 * já não era mensal e a nova não existia) e a tela ainda dizia "Pró-labore atualizado". Agora, se o insert
 * falha, a linha antiga volta à recorrência que tinha e quem chamou recebe o erro.
 *
 * Devolve null quando as duas escritas deram certo, ou a mensagem para mostrar ao usuário.
 */
export async function reajustarProLabore(
  db: SupabaseClient<Database>,
  linhaAtiva: { id: string; recurrence: string | null },
  novaLinha: TablesInsert<"expenses">,
): Promise<string | null> {
  const { error: erroDoEncerramento } = await db.from("expenses").update({ recurrence: "none" }).eq("id", linhaAtiva.id);
  if (erroDoEncerramento) {
    return "Não consegui encerrar o pró-labore antigo. Nada foi alterado nos custos fixos.";
  }
  const { error: erroDoNovo } = await db.from("expenses").insert(novaLinha);
  if (!erroDoNovo) return null;

  const { error: erroAoDesfazer } = await db
    .from("expenses")
    .update({ recurrence: linhaAtiva.recurrence ?? "monthly" })
    .eq("id", linhaAtiva.id);
  return erroAoDesfazer
    ? "Não consegui criar o novo pró-labore nem reativar o antigo. Confira os custos fixos: o pró-labore pode estar sem recorrência."
    : "Não consegui criar o novo pró-labore nos custos fixos. O lançamento antigo continua valendo.";
}
