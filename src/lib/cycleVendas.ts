import { supabase } from "@/integrations/supabase/client";

/**
 * Quantos leads viraram COMPRA na semana, por cliente.
 *
 * O número que fecha o funil não existe em API nenhuma: quem sabe se o
 * contato virou venda é o dono do negócio, no WhatsApp. O painel dá o
 * lugar de registrar — um toque no card do tráfego — e a leitura vira
 * régua: zero compra com lead chegando é conversa que não converte;
 * uma ou duas ainda é pouco; a régua é do dono.
 *
 * Mora em project_memory (kind 'vendas_semana'), um registro por cliente
 * por semana, porque é história do cliente: o dossiê e o agente externo
 * leem dali sem precisar de tabela nova.
 */

const KIND = "vendas_semana";

export interface VendasDaSemana {
  id: string | null;
  compras: number;
}

/** As compras registradas de vários clientes numa semana, numa consulta. */
export async function lerVendasDaSemana(
  clientIds: string[],
  weekStart: string,
): Promise<Map<string, VendasDaSemana>> {
  const mapa = new Map<string, VendasDaSemana>();
  for (const id of clientIds) mapa.set(id, { id: null, compras: 0 });
  if (clientIds.length === 0) return mapa;

  const { data } = await (supabase as any)
    .from("project_memory")
    .select("id, client_id, metadata")
    .in("client_id", clientIds)
    .eq("kind", KIND)
    .eq("metadata->>week_start", weekStart);

  for (const linha of (data ?? []) as Array<Record<string, unknown>>) {
    const compras = Number((linha.metadata as { compras?: unknown } | null)?.compras ?? 0);
    mapa.set(String(linha.client_id), {
      id: String(linha.id),
      compras: Number.isFinite(compras) ? compras : 0,
    });
  }
  return mapa;
}

/**
 * Grava o total da semana (não um incremento): o botão soma na tela e
 * manda o número final, então dois toques rápidos não se perdem.
 */
export async function registrarVendas(input: {
  clientId: string;
  weekStart: string;
  compras: number;
  registroId: string | null;
}): Promise<VendasDaSemana | null> {
  const compras = Math.max(0, Math.floor(input.compras));
  const conteudo = compras === 0
    ? `Nenhuma compra registrada na semana de ${input.weekStart}.`
    : `${compras} ${compras === 1 ? "compra registrada" : "compras registradas"} na semana de ${input.weekStart}.`;

  if (input.registroId) {
    const { error } = await (supabase as any)
      .from("project_memory")
      .update({
        content: conteudo,
        metadata: { week_start: input.weekStart, compras, client_visible: false },
      })
      .eq("id", input.registroId);
    return error ? null : { id: input.registroId, compras };
  }

  const { data: session } = await supabase.auth.getUser();
  const { data, error } = await (supabase as any)
    .from("project_memory")
    .insert({
      client_id: input.clientId,
      kind: KIND,
      title: `Compras da semana de ${input.weekStart}`,
      content: conteudo,
      source: "ciclo",
      tags: ["ciclo", "vendas"],
      metadata: { week_start: input.weekStart, compras, client_visible: false },
      created_by: session?.user?.id || null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: String((data as { id: string }).id), compras };
}

/** A leitura que acompanha o número, na régua do dono. */
export function leituraDasCompras(compras: number, leads7d: number): string {
  if (compras === 0) {
    return leads7d > 0
      ? `0 compras com ${leads7d} leads na semana: a conversa não está convertendo`
      : "0 compras registradas nesta semana";
  }
  if (compras <= 2) return `${compras} ${compras === 1 ? "compra" : "compras"}: ainda pouco, dá para subir`;
  return `${compras} compras na semana`;
}
