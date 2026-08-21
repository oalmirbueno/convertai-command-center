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

/**
 * As etapas feitas de VÁRIOS clientes de uma vez.
 *
 * A lista do Ciclo mostra os avulsos lado a lado; consultar cliente por
 * cliente traria uma ida ao banco por card. Aqui é uma consulta só, e o
 * resultado vem na chave "cliente:servico" que a tela usa para contar.
 */
export async function listEtapasDeVarios(
  clientIds: string[],
): Promise<Map<string, Set<number>>> {
  const mapa = new Map<string, Set<number>>();
  if (clientIds.length === 0) return mapa;
  const { data, error } = await supabase
    .from("project_memory")
    .select("client_id, metadata")
    .eq("kind", KIND)
    .in("client_id", clientIds);
  if (error || !data) return mapa;
  for (const linha of data as Array<{
    client_id: string;
    metadata: { step?: number; servico?: string; done?: boolean } | null;
  }>) {
    const step = Number(linha.metadata?.step);
    const servico = linha.metadata?.servico;
    if (linha.metadata?.done !== true || !servico || !Number.isFinite(step)) continue;
    const chave = `${linha.client_id}:${servico}`;
    const atual = mapa.get(chave) || new Set<number>();
    atual.add(step);
    mapa.set(chave, atual);
  }
  return mapa;
}

/**
 * Conclui (ou reabre) a entrega de um cliente avulso.
 *
 * Usa a MESMA bandeira que a tela de Clientes já usa —
 * `services_config.one_off_done` —, em vez de inventar uma segunda marca de
 * concluído. Duas marcas para o mesmo fato divergem no primeiro conserto: a
 * tela de Clientes mostraria entregue e a do Ciclo, em andamento.
 *
 * Registra também uma linha na história do cliente, porque concluir é um
 * acontecimento: é o que a Central, o dossiê e o agente externo leem para
 * saber que aquele trabalho terminou — e é o que faz o projeto continuar
 * existindo no histórico depois de sair da lista viva.
 */
export async function concluirEntrega(input: {
  clientId: string;
  servicesConfig: Record<string, unknown> | null;
  resumo: string;
  concluir: boolean;
}): Promise<boolean> {
  const { clientId, servicesConfig, resumo, concluir } = input;
  try {
    const proximo = { ...(servicesConfig || {}), one_off_done: concluir };
    const { error } = await supabase
      .from("profiles")
      .update({ services_config: proximo } as never)
      .eq("id", clientId);
    if (error) return false;

    const { data: session } = await supabase.auth.getUser();
    // Reabrir apaga o marco em vez de gravar "não concluído": um registro
    // dizendo que algo desaconteceu é ruído na história que a IA lê.
    if (!concluir) {
      await supabase
        .from("project_memory")
        .delete()
        .eq("client_id", clientId)
        .eq("kind", "marco")
        .eq("metadata->>tipo", "entrega_concluida");
      return true;
    }

    await supabase.from("project_memory").insert({
      client_id: clientId,
      kind: "marco",
      title: "Projeto concluído",
      content: resumo,
      source: "ciclo",
      tags: ["entrega", "avulso", "concluido"],
      metadata: {
        tipo: "entrega_concluida",
        done_at: new Date().toISOString(),
        client_visible: false,
      },
      created_by: session?.user?.id || null,
    } as never);
    return true;
  } catch {
    return false;
  }
}

/** A entrega deste cliente já foi dada por concluída? */
export function entregaConcluida(client: unknown): boolean {
  const config = (client as { services_config?: Record<string, unknown> } | null)
    ?.services_config;
  return Boolean(config && (config as Record<string, unknown>).one_off_done === true);
}
