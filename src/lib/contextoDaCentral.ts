/**
 * O contexto de UM cliente, lido de uma vez e dizendo o que faltou.
 *
 * Frente R (25/09): a Central montava o contexto de quatro lugares e engolia
 * as falhas (`.catch(() => "")`). Quando a leitura dos movimentos quebrou no
 * banco (25/09, função app_private.movimentos_do_cliente_bruto ausente), a
 * mensagem continuou saindo, só que sem a linha do tempo da semana, e ninguém
 * viu. Aqui cada fonte que falha entra em `falhas`, para a tela poder avisar.
 *
 * Fontes (as mesmas que o gerador de rituais usa):
 * - dossiê geral atual e o que mudou desde a versão anterior (client_dossiers);
 * - movimentos com data e hora (RPC movimentos_do_cliente: arquivos,
 *   aprovações, agenda, tarefas, marcos, pedidos, mensagens e as mesas:
 *   campanhas, conteúdo gravado, Mesa Ads, fotos aprovadas, cérebro, Estúdio);
 * - plano da semana da esteira (project_memory, kind esteira_plano).
 *
 * Reutilizável pela Central e pelo agente da Central (frente S).
 */

import { supabase } from "@/integrations/supabase/client";
import { lerDossieDoCliente, type DossieDoCliente } from "@/lib/dossieGeral";
import { lerMovimentos, movimentosComoFatos, type Movimento } from "@/lib/movimentos";
import { localIso, mondayOf } from "@/lib/cycleWeek";

/**
 * Entregue de verdade: compartilhado com o cliente ou aprovado por ele.
 * "Enviado para aprovação" é pendência; contar como entrega fazia a mesma
 * peça aparecer como "concluída e liberada" e como "aguardando aprovação".
 */
export function ehEntregue(arquivo: { visibility?: string | null; approval_status?: string | null }): boolean {
  return arquivo.visibility === "client_shared" || arquivo.approval_status === "approved";
}

export interface PlanoDaSemana {
  foco: string;
  feito: string[];
  proximos: Array<{ titulo: string; passo: string; motivo?: string }>;
}

export interface ContextoDoCliente {
  dossie: DossieDoCliente | null;
  movimentos: Movimento[];
  plano: PlanoDaSemana | null;
  /** Nome de cada fonte que não respondeu. Vazio = contexto completo. */
  falhas: string[];
}

async function lerPlanoDaSemana(clientId: string, semana: string): Promise<PlanoDaSemana | null> {
  const { data, error } = await (supabase as any)
    .from("project_memory")
    .select("metadata, created_at")
    .eq("client_id", clientId)
    .eq("kind", "esteira_plano")
    .contains("metadata", { week_start: semana })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const m = (data?.[0]?.metadata ?? null) as Record<string, unknown> | null;
  if (!m) return null;
  return {
    foco: String(m.foco ?? ""),
    feito: Array.isArray(m.feito) ? (m.feito as string[]) : [],
    proximos: Array.isArray(m.proximos) ? (m.proximos as PlanoDaSemana["proximos"]) : [],
  };
}

export async function lerContextoDoCliente(
  clientId: string,
  opcoes: { dias?: number; agora?: Date } = {},
): Promise<ContextoDoCliente> {
  const semana = localIso(mondayOf(opcoes.agora ?? new Date()));
  const [dossie, movimentos, plano] = await Promise.allSettled([
    lerDossieDoCliente(clientId),
    lerMovimentos(clientId, { dias: opcoes.dias ?? 14 }),
    lerPlanoDaSemana(clientId, semana),
  ]);
  const falhas: string[] = [];
  if (dossie.status === "rejected") falhas.push("dossiê");
  if (movimentos.status === "rejected") falhas.push("movimentos");
  if (plano.status === "rejected") falhas.push("plano da semana");
  return {
    dossie: dossie.status === "fulfilled" ? dossie.value : null,
    movimentos: movimentos.status === "fulfilled" ? movimentos.value : [],
    plano: plano.status === "fulfilled" ? plano.value : null,
    falhas,
  };
}

/** O contexto em texto para a IA, com o aviso do que não foi lido. */
export function contextoComoTexto(ctx: ContextoDoCliente, opcoes: { maxMovimentos?: number; dias?: number } = {}): string {
  const geral = ctx.dossie?.geral;
  const partes = [
    geral ? `DOSSIÊ GERAL (v${geral.version ?? "?"}):\n${String(geral.content ?? geral.summary ?? "").trim()}` : "",
    ctx.dossie?.mudancas.length ? `O QUE MUDOU DESDE A VERSÃO ANTERIOR:\n${ctx.dossie.mudancas.map((m) => `- ${m}`).join("\n")}` : "",
    ctx.plano?.foco ? `PLANO DA SEMANA: ${ctx.plano.foco}` : "",
    movimentosComoFatos(ctx.movimentos, { max: opcoes.maxMovimentos ?? 40, dias: opcoes.dias ?? 14 }),
    ctx.falhas.length ? `ATENÇÃO: não foi possível ler ${ctx.falhas.join(", ")}. Não conclua nada sobre o que faltou.` : "",
  ];
  return partes.filter(Boolean).join("\n\n");
}
