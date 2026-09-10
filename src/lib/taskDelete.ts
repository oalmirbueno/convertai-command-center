import { supabase } from "@/integrations/supabase/client";
import { notifyOpsTaskDeleted } from "@/lib/opsTaskSync";
import { requestIdFromTaskSource } from "@/lib/requestTaskWorkflow";
import { recordMemory } from "@/lib/clientMemory";

/**
 * Excluir tarefa: UM caminho para as quatro telas (Kanban, Timeline, modal de
 * edição, detalhe/Execução) e para a folha do Ciclo.
 *
 * Antes cada tela apagava do seu jeito: o Kanban bloqueava tarefa de pedido,
 * a Timeline e o modal não; ninguém bloqueava tarefa cuja publicação já está
 * agendada; e a exclusão deixava rastro solto (vínculo de operador órfão,
 * "alerta virou tarefa" sem contraparte no diário). Tarefa que não faz mais
 * sentido precisa poder sair — mas sair limpa.
 */

export interface TarefaParaExcluir {
  id: string;
  title?: string | null;
  source?: string | null;
  project_id?: string | null;
  ops_node_id?: string | null;
}

export interface ResultadoDaExclusao {
  ok: boolean;
  /** Mensagem para a pessoa: por que não pôde, ou o que foi feito. */
  mensagem: string;
}

/** Diz se a tarefa pode ser excluída e, se não, por quê. */
export async function podeExcluirTarefa(t: TarefaParaExcluir): Promise<ResultadoDaExclusao> {
  // 1. Tarefa que nasceu de um pedido do cliente: o pedido ficaria sem
  //    resposta. O caminho certo é desvincular e reabrir o pedido.
  if (requestIdFromTaskSource(t.source)) {
    return {
      ok: false,
      mensagem: "Esta tarefa veio de um pedido do cliente. Desvincule e reabra o pedido em vez de excluir.",
    };
  }

  // 2. Tarefa editorial cuja publicação já está agendada ou no ar: apagar a
  //    tarefa deixaria a publicação órfã na agenda. Arquive a pauta.
  const { data: vinculo } = await (supabase as any)
    .from("editorial_post_internal")
    .select("post_id")
    .eq("task_id", t.id)
    .maybeSingle();
  if (vinculo?.post_id) {
    const { data: pubs } = await (supabase as any)
      .from("editorial_publications")
      .select("id, status")
      .eq("post_id", vinculo.post_id)
      .in("status", ["scheduled", "published"])
      .limit(1);
    if (pubs && pubs.length > 0) {
      return {
        ok: false,
        mensagem:
          pubs[0].status === "published"
            ? "A publicação desta pauta já está no ar. A tarefa fica como histórico; arquive a pauta se não quiser mais vê-la."
            : "A publicação desta pauta está agendada. Cancele o agendamento na agenda antes de excluir a tarefa.",
      };
    }
  }

  return { ok: true, mensagem: "" };
}

/**
 * Exclui de verdade, com a limpeza que a exclusão exige:
 * - vínculos de operador ficam bloqueados com o motivo (não órfãos);
 * - o diário do cliente registra "tarefa descartada" (quando veio do Ciclo,
 *   fecha o par com "alerta virou tarefa");
 * - o Ops é avisado, como antes.
 */
export async function excluirTarefa(
  t: TarefaParaExcluir,
  opts?: { motivo?: string },
): Promise<ResultadoDaExclusao> {
  const guarda = await podeExcluirTarefa(t);
  if (!guarda.ok) return guarda;

  const titulo = String(t.title || "").trim() || "tarefa sem título";
  const origemCiclo = String(t.source || "").startsWith("ciclo:");

  // O cliente dono da tarefa (tarefa não tem client_id; passa pelo projeto).
  let clientId: string | null = null;
  if (t.project_id) {
    const { data: projeto } = await (supabase as any)
      .from("projects").select("client_id").eq("id", t.project_id).maybeSingle();
    clientId = projeto?.client_id ?? null;
  }

  const { error } = await supabase.from("tasks").delete().eq("id", t.id);
  if (error) {
    return { ok: false, mensagem: error.message || "Não foi possível excluir a tarefa." };
  }

  // Vínculo de operador: bloqueado com motivo, nunca apontando para o nada.
  await (supabase as any)
    .from("operator_task_links")
    .update({ status: "blocked", block_reason: `Tarefa excluída${opts?.motivo ? `: ${opts.motivo}` : ""}` })
    .eq("kanban_task_id", t.id)
    .then(() => undefined, () => undefined);

  if (clientId) {
    await recordMemory({
      clientId,
      kind: "ciclo",
      title: `Tarefa descartada: ${titulo}`,
      content: origemCiclo
        ? `A tarefa que tinha nascido de um alerta do Ciclo foi descartada${opts?.motivo ? ` (${opts.motivo})` : ""}. Se o problema continuar no painel, o alerta volta a aparecer.`
        : `Tarefa excluída do Kanban${opts?.motivo ? ` (${opts.motivo})` : ""}.`,
      source: "kanban",
      tags: ["tarefa", "descartada"],
      metadata: { task_id: t.id, source: t.source ?? null, registro: "descartada" },
    }).catch(() => undefined);
  }

  notifyOpsTaskDeleted(t.id, t.ops_node_id ?? null);
  return { ok: true, mensagem: "Tarefa excluída." };
}
