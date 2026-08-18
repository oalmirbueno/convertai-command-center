import { supabase } from "@/integrations/supabase/client";
import type { CycleArea } from "@/lib/cycleDefs";

/**
 * Duas folgas no ciclo, para o que a regra fixa não cobre.
 *
 * 1) CLIENTE EXTRA — a lista do ciclo vem do serviço marcado no cadastro, e
 *    isso é certo como padrão. Mas existe o caso real: o cliente que ainda não
 *    tem tráfego contratado e já está em preparação, o que entrou no meio da
 *    semana, o que pediu uma frente por fora. Sem uma porta, a saída era
 *    marcar o serviço no cadastro — e isso mexe em cobrança, ritual e MRR.
 *    Por isso o extra mora em `services_config.ciclo_extra`, SEPARADO do
 *    serviço contratado: entra no ciclo sem virar cliente daquela frente.
 *
 * 2) AVULSOS — as 6 etapas contam a rotina, e a rotina é só parte do trabalho.
 *    Gravação na loja, reunião de alinhamento, ajuste que o cliente pediu no
 *    meio da semana: hoje nada disso aparecia, e a semana parecia menor do que
 *    foi. Cada avulso vira uma linha na história do cliente, então aparece
 *    junto na Central, no dossiê e no que o agente externo lê pelo MCP — que é
 *    justamente o "acompanhar melhor o processo".
 */

/* ─────────────────────────── 1) Cliente extra ────────────────────────────── */

/** As frentes em que este cliente foi incluído à mão. */
export function extraAreas(client: unknown): CycleArea[] {
  const config = (client as { services_config?: { ciclo_extra?: unknown } } | null)
    ?.services_config;
  const lista = config?.ciclo_extra;
  if (!Array.isArray(lista)) return [];
  return lista.filter((valor): valor is CycleArea => valor === "social" || valor === "trafego");
}

/** Está no ciclo desta frente: por contrato ou por inclusão manual. */
export function inCycle(
  client: unknown,
  area: CycleArea,
  contratou: (client: unknown, area: CycleArea) => boolean,
): boolean {
  return contratou(client, area) || extraAreas(client).includes(area);
}

/**
 * Inclui ou remove o cliente da frente, sem tocar no serviço contratado.
 *
 * Lê a configuração atual antes de gravar porque `services_config` guarda
 * outras coisas (caixas do financeiro, histórico de pulso): sobrescrever o
 * objeto inteiro apagaria o que não é nosso.
 */
export async function setCycleExtra(
  clientId: string,
  area: CycleArea,
  incluir: boolean,
): Promise<boolean> {
  try {
    const { data: atual, error: erroLeitura } = await supabase
      .from("profiles")
      .select("services_config")
      .eq("id", clientId)
      .single();
    if (erroLeitura) return false;

    const config = ((atual as { services_config?: Record<string, unknown> })?.services_config ||
      {}) as Record<string, unknown>;
    const antes = extraAreas(atual);
    const depois = incluir
      ? [...new Set([...antes, area])]
      : antes.filter((valor) => valor !== area);

    const { error } = await supabase
      .from("profiles")
      .update({ services_config: { ...config, ciclo_extra: depois } } as never)
      .eq("id", clientId);
    return !error;
  } catch {
    return false;
  }
}

/* ───────────────────────────── 2) Avulsos ────────────────────────────────── */

export interface Avulso {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

const KIND = "avulso";

/** Os avulsos daquele cliente, naquela frente, naquela semana. */
export async function listAvulsos(
  clientId: string,
  area: CycleArea,
  weekStart: string,
): Promise<Avulso[]> {
  const { data, error } = await supabase
    .from("project_memory")
    .select("id, title, metadata, created_at")
    .eq("client_id", clientId)
    .eq("kind", KIND)
    .eq("metadata->>area", area)
    .eq("metadata->>week_start", weekStart)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    text: String(row.title || ""),
    done: (row.metadata as { done?: boolean } | null)?.done === true,
    created_at: String(row.created_at),
  }));
}

/**
 * Registra um trabalho avulso da semana.
 *
 * Fica interno: é bastidor de operação, não material para o cliente ler. A
 * mensagem que ele recebe é escrita à parte, na língua dele.
 */
export async function addAvulso(input: {
  clientId: string;
  area: CycleArea;
  weekStart: string;
  text: string;
}): Promise<Avulso | null> {
  const texto = input.text.trim().slice(0, 200);
  if (!texto) return null;
  try {
    const { data: session } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("project_memory")
      .insert({
        client_id: input.clientId,
        kind: KIND,
        title: texto,
        content: `Trabalho avulso da semana de ${input.weekStart} (${input.area}): ${texto}`,
        source: "ciclo",
        tags: ["ciclo", "avulso", input.area],
        metadata: {
          area: input.area,
          week_start: input.weekStart,
          done: false,
          client_visible: false,
        },
        created_by: session?.user?.id || null,
      } as never)
      .select("id, created_at")
      .single();
    if (error || !data) return null;
    return {
      id: String((data as Record<string, unknown>).id),
      text: texto,
      done: false,
      created_at: String((data as Record<string, unknown>).created_at),
    };
  } catch {
    return null;
  }
}

/**
 * Marca ou desmarca.
 *
 * O corpo do registro é reescrito junto com a marcação, porque é ele que a IA
 * da Central lê: só mudar a marcação deixaria o histórico dizendo que o
 * trabalho não aconteceu.
 */
export async function toggleAvulso(avulso: Avulso, area: CycleArea, weekStart: string) {
  const done = !avulso.done;
  const { error } = await supabase
    .from("project_memory")
    .update({
      content: done
        ? `Feito na semana de ${weekStart} (${area}): ${avulso.text}`
        : `Trabalho avulso da semana de ${weekStart} (${area}): ${avulso.text}`,
      metadata: {
        area,
        week_start: weekStart,
        done,
        done_at: done ? new Date().toISOString() : null,
        client_visible: false,
      },
    } as never)
    .eq("id", avulso.id);
  return error ? null : { ...avulso, done };
}

export async function removeAvulso(id: string): Promise<boolean> {
  const { error } = await supabase.from("project_memory").delete().eq("id", id);
  return !error;
}
