/**
 * Histórico da conversa do Gestor (Central de Autonomia, 09/10/2026).
 *
 * A conversa é contínua: o modelo recebe as últimas 30 mensagens em ordem
 * (com o que aconteceu nas ações e o recorte de cada resposta) e os objetos
 * citados, abertos, propostos ou criados antes, para resolver "isso", "essa",
 * "pode aprovar" e "abre o que você fez". Separado do index.ts para o teste de
 * ponta usar o mesmo caminho.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ReferenciaDoGestor } from "./nucleo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ultimasMensagens(db: SupabaseClient, conversaId: string, n: number): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db.from("gestor_mensagens").select("id, papel, conteudo, dados, client_id, criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(n);
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).reverse();
}

/** Uma mensagem do Gestor como ela aparece no histórico do modelo: o texto e o que aconteceu com as ações. */
export function linhaDoGestor(m: Record<string, unknown>): string {
  const d = (m.dados || {}) as Record<string, unknown>;
  const partes = [String(m.conteudo || "").slice(0, 900)];
  for (const a of (Array.isArray(d.acoes) ? d.acoes : []) as Array<Record<string, unknown>>) {
    const itens = (Array.isArray(a.itens) ? a.itens : []) as Array<{ rotulo?: string; titulo?: string }>;
    const estado = a.desfeita_em ? "desfeita" : a.descartada_em ? "descartada pelo dono" : a.executada_em ? "feita" : "aguardando o Confirmar do dono";
    if (itens.length) partes.push(`[Ação proposta: ${itens.map((i) => `${i.rotulo || ""} ${i.titulo ? `"${String(i.titulo).slice(0, 80)}"` : ""}`.trim()).join("; ")} -> ${estado}]`);
  }
  for (const b of (Array.isArray(d.bloqueadas) ? d.bloqueadas : []) as Array<{ pedido?: string }>) partes.push(`[Precisa da decisão do dono fora daqui: ${String(b.pedido || "").slice(0, 120)}]`);
  if (d.abrir && typeof d.abrir === "object") partes.push(`[Abriu na lateral: ${String((d.abrir as { titulo?: string }).titulo || "objeto")}]`);
  if (d.cliente && typeof d.cliente === "object") partes.push(`[Recorte: ${String((d.cliente as { nome?: string }).nome || "")}]`);
  return partes.filter(Boolean).join(" ");
}

/**
 * Contexto da conversa para o modelo: o histórico recente INTEIRO (até 30
 * mensagens, em ordem, com o que aconteceu nas ações), mais o resumo do que
 * ficou antes. Também devolve os objetos citados/criados (referências) e o
 * cliente da última resposta, para "isso", "essa" e "continua".
 */
export async function contextoDaConversa(db: SupabaseClient, c: { id: string; resumo: string | null }): Promise<{ historico: string; referencias: ReferenciaDoGestor[]; clienteAnterior: string | null }> {
  const ultimas = await ultimasMensagens(db, c.id, 30);
  const partes: string[] = [];
  const { count } = await db.from("gestor_mensagens").select("id", { count: "exact", head: true }).eq("conversa_id", c.id);
  if (c.resumo && (count || 0) > ultimas.length) partes.push(`(Antes destas mensagens a conversa tratou de: ${c.resumo})`);
  for (const m of ultimas) {
    if (m.papel === "usuario") partes.push(`Dono: ${String(m.conteudo || "").slice(0, 900)}`);
    else if (m.papel === "gestor") partes.push(`Gestor: ${linhaDoGestor(m)}`);
    else if (m.papel === "sistema") partes.push(`(Sistema: ${String(m.conteudo || "").slice(0, 200)})`);
  }
  let historico = partes.join("\n");
  if (historico.length > 16_000) historico = `(...)\n${historico.slice(-16_000)}`;

  // Referências: mais recente primeiro, sem repetir; entregas confirmadas depois também entram.
  const referencias: ReferenciaDoGestor[] = [];
  const junta = (r: Partial<ReferenciaDoGestor> | null | undefined, origem?: ReferenciaDoGestor["origem"]) => {
    if (!r || typeof r.id !== "string" || typeof r.tipo !== "string" || !UUID.test(r.id)) return;
    if (referencias.some((x) => x.tipo === r.tipo && x.id === r.id)) return;
    referencias.push({ tipo: r.tipo as ReferenciaDoGestor["tipo"], id: r.id, titulo: r.titulo ? String(r.titulo).slice(0, 140) : null, client_id: r.client_id || null, origem: (origem || r.origem || "citado") as ReferenciaDoGestor["origem"], estado: r.estado ? String(r.estado).slice(0, 60) : null });
  };
  let clienteAnterior: string | null = null;
  for (const m of [...ultimas].reverse()) {
    if (m.papel !== "gestor") continue;
    const d = (m.dados || {}) as Record<string, unknown>;
    if (!clienteAnterior && d.cliente && typeof d.cliente === "object") clienteAnterior = String((d.cliente as { id?: string }).id || "") || null;
    for (const a of (Array.isArray(d.acoes) ? d.acoes : []) as Array<{ entregas?: Array<{ objeto?: ReferenciaDoGestor; tipo?: string; estado?: string }> }>) {
      for (const e of a.entregas || []) if (e.objeto) junta({ ...e.objeto, estado: e.estado }, e.tipo === "aprovacao" ? "decidido" : "criado");
    }
    for (const r of (Array.isArray(d.referencias) ? d.referencias : []) as ReferenciaDoGestor[]) junta(r);
    if (referencias.length >= 16) break;
  }
  return { historico, referencias: referencias.slice(0, 16), clienteAnterior };
}

