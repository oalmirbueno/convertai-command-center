import { supabase } from "@/integrations/supabase/client";

/**
 * O andamento da entrega de um cliente avulso.
 *
 * Não usa `weekly_cycle_progress` por dois motivos, e o segundo é o que
 * importa: aquela tabela tem `CHECK (area in ('social','trafego'))`, e tem
 * `week_start` na chave. Entrega avulsa não é semanal — "site construído"
 * acontece UMA vez, não toda segunda. Gravar ali faria a etapa concluída
 * sumir na virada da semana, que é o pior tipo de bug: silencioso e só
 * percebido dias depois.
 *
 * Mora em `project_memory`, que é onde os trabalhos avulsos já moram — então
 * a Central, o dossiê e o agente externo pelo MCP leem a entrega junto com o
 * resto da história do cliente, sem tabela nova.
 */

const KIND = "entrega_etapa";

/** As etapas já concluídas daquele serviço, por número. */
export async function listEtapasFeitas(clientId: string, servico: string): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("project_memory")
    .select("metadata")
    .eq("client_id", clientId)
    .eq("kind", KIND)
    .eq("metadata->>servico", servico);
  if (error || !data) return new Set();
  const feitas = new Set<number>();
  for (const linha of data as Array<{ metadata: { step?: number; done?: boolean } | null }>) {
    const step = Number(linha.metadata?.step);
    if (linha.metadata?.done === true && Number.isFinite(step)) feitas.add(step);
  }
  return feitas;
}

/**
 * Marca ou desmarca uma etapa da entrega.
 *
 * Desmarcar APAGA o registro em vez de gravar `done: false`. Um registro
 * dizendo "não foi feito" é ruído na história que a IA da Central lê: ela
 * contaria como acontecimento algo que não aconteceu.
 */
export async function marcarEtapa(input: {
  clientId: string;
  servico: string;
  step: number;
  rotulo: string;
  feito: boolean;
}): Promise<boolean> {
  const { clientId, servico, step, rotulo, feito } = input;
  try {
    if (!feito) {
      const { error } = await supabase
        .from("project_memory")
        .delete()
        .eq("client_id", clientId)
        .eq("kind", KIND)
        .eq("metadata->>servico", servico)
        .eq("metadata->>step", String(step));
      return !error;
    }

    // Apaga antes de gravar para não empilhar duas marcações da mesma etapa
    // se o botão for tocado duas vezes.
    await supabase
      .from("project_memory")
      .delete()
      .eq("client_id", clientId)
      .eq("kind", KIND)
      .eq("metadata->>servico", servico)
      .eq("metadata->>step", String(step));

    const { data: session } = await supabase.auth.getUser();
    const { error } = await supabase.from("project_memory").insert({
      client_id: clientId,
      kind: KIND,
      title: rotulo,
      content: `Entrega de ${servico}: ${rotulo} — concluído.`,
      source: "ciclo",
      tags: ["entrega", "avulso", servico],
      metadata: {
        servico,
        step,
        done: true,
        done_at: new Date().toISOString(),
        client_visible: false,
      },
      created_by: session?.user?.id || null,
    } as never);
    return !error;
  } catch {
    return false;
  }
}
