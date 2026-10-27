import { supabase } from "@/integrations/supabase/client";
import { handleCombina, type IdentidadeCandidata } from "@/lib/identidadePrincipal";

/**
 * As contas em que o número de posts decide: as do topo quando nome e foto
 * empatam entre duas ou mais contas do mesmo cliente. Fora disso a contagem
 * não muda a escolha de escolherIdentidadePrincipal.
 */
export function contasEmpatadas(candidatas: readonly IdentidadeCandidata[], nome?: string | null): string[] {
  if (candidatas.length < 2) return [];
  const nota = (c: IdentidadeCandidata) => (handleCombina(c.username, nome) ? 2 : 0) + (c.profile_picture_url ? 1 : 0);
  const topo = Math.max(...candidatas.map(nota));
  const empatadas = candidatas.filter((c) => nota(c) === topo && c.external_account_id);
  return empatadas.length > 1 ? empatadas.map((c) => String(c.external_account_id)) : [];
}

/** Posts por conta, só pela contagem do banco (`head: true`, sem trazer linhas). */
export async function contarPostsDasContas(contas: readonly string[]): Promise<Map<string, number>> {
  const porConta = new Map<string, number>();
  await Promise.all(contas.map(async (conta) => {
    const { count } = await (supabase as any)
      .from("social_post_metrics")
      .select("external_account_id", { count: "exact", head: true })
      .eq("external_account_id", conta);
    porConta.set(conta, Number(count) || 0);
  }));
  return porConta;
}
