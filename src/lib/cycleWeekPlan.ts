import { supabase } from "@/integrations/supabase/client";

/**
 * O plano da semana: as três etapas que giram, CONGELADAS por cliente e
 * semana a partir das pendências reais.
 *
 * A peça que faltava. O motor de pendências existia, mas as etapas do
 * checklist continuavam saindo do sorteio antigo sobre o acervo — o relato
 * do dono foi exato: "quando eu clico, as etapas da semana estão a mesma
 * coisa, tudo genérico". O contexto estava na tela e o CHECKLIST, que é
 * onde se age, seguia cego.
 *
 * Por que congelar em vez de derivar ao vivo: a marcação em
 * weekly_cycle_progress guarda SÓ O NÚMERO da etapa. Se o rótulo mudasse
 * durante a semana (pendência resolvida some, outra entra), a etapa 3
 * marcada na segunda significaria outra coisa na quarta e o histórico
 * viraria mentira. Então o plano nasce da realidade DO MOMENTO EM QUE A
 * SEMANA COMEÇA a ser trabalhada, e fica: contexto na escolha,
 * estabilidade na marcação.
 *
 * Mora em project_memory (kind `ciclo_semana`), um registro por cliente,
 * frente e semana — o dossiê e os agentes externos leem o plano dali.
 */

const KIND = "ciclo_semana";

export interface PlanoDaSemana {
  id: string;
  etapas: string[];
}

/** Os planos já congelados de vários clientes, numa consulta. */
export async function lerPlanosDaSemana(
  clientIds: string[],
  area: string,
  weekStart: string,
): Promise<Map<string, PlanoDaSemana>> {
  const mapa = new Map<string, PlanoDaSemana>();
  if (clientIds.length === 0) return mapa;
  const { data } = await (supabase as any)
    .from("project_memory")
    .select("id, client_id, metadata")
    .in("client_id", clientIds)
    .eq("kind", KIND)
    .eq("metadata->>area", area)
    .eq("metadata->>week_start", weekStart);
  for (const linha of (data ?? []) as Array<Record<string, unknown>>) {
    const etapas = (linha.metadata as { etapas?: unknown } | null)?.etapas;
    if (Array.isArray(etapas) && etapas.length > 0 && !mapa.has(String(linha.client_id))) {
      mapa.set(String(linha.client_id), {
        id: String(linha.id),
        etapas: etapas.map(String),
      });
    }
  }
  return mapa;
}

/**
 * Substitui as etapas de um plano já congelado.
 *
 * Só é chamado enquanto NENHUMA etapa girante foi marcada: o plano é
 * dinâmico no começo da semana (pendência nova entra, resolvida sai) e
 * trava no instante em que a primeira marcação acontece — porque a
 * marcação guarda só o número, e trocar o rótulo depois dela faria o
 * histórico mentir.
 */
export async function substituirPlano(input: {
  registroId: string;
  area: string;
  weekStart: string;
  etapas: string[];
}): Promise<boolean> {
  if (input.etapas.length === 0) return false;
  const { error } = await (supabase as any)
    .from("project_memory")
    .update({
      content: `Etapas da semana, escolhidas do estado real do painel: ${input.etapas.join("; ")}.`,
      metadata: {
        area: input.area,
        week_start: input.weekStart,
        etapas: input.etapas,
        client_visible: false,
      },
    })
    .eq("id", input.registroId);
  return !error;
}

/** Os rótulos da semana ANTERIOR, para o acervo não repetir. */
export async function lerPlanoAnterior(
  clientIds: string[],
  area: string,
  weekStartAnterior: string,
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  const planos = await lerPlanosDaSemana(clientIds, area, weekStartAnterior);
  for (const [id, plano] of planos) mapa.set(id, plano.etapas);
  return mapa;
}

/**
 * Congela o plano de um cliente. Grava uma vez por semana; se dois
 * navegadores correrem, o segundo insert é inofensivo — a leitura pega o
 * mais antigo, e os dois nasceram da mesma realidade.
 */
export async function congelarPlano(input: {
  clientId: string;
  area: string;
  weekStart: string;
  etapas: string[];
}): Promise<boolean> {
  if (input.etapas.length === 0) return false;
  const { error } = await (supabase as any)
    .from("project_memory")
    .insert({
      client_id: input.clientId,
      kind: KIND,
      title: `Plano da semana de ${input.weekStart} (${input.area})`,
      content: `Etapas da semana, escolhidas do estado real do painel: ${input.etapas.join("; ")}.`,
      source: "ciclo",
      tags: ["ciclo", "plano", input.area],
      metadata: {
        area: input.area,
        week_start: input.weekStart,
        etapas: input.etapas,
        client_visible: false,
      },
    });
  return !error;
}
