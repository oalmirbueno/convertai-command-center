import { safeInternalPath } from "@/lib/internalNavigation";
import { supabase } from "@/integrations/supabase/client";
import {
  areaDaRota,
  AREAS_DO_PAINEL,
  destinoDoPedido,
  rotasNoTexto,
  type AreaDoPainel,
} from "../../../supabase/functions/_shared/mapa-do-painel";
import type { PedidoDaAcao, RespostaDaAcao } from "./acoesDoAgente";

/**
 * O mapa do painel na tela (o mesmo arquivo que os agentes leem no servidor):
 * rota citada pelo agente vira link com o cliente, e o destino que o agente
 * devolve (ir_para) vira botão "Abrir" (ou abre sozinho quando a pessoa pediu
 * para abrir). Só caminho interno conhecido do mapa: nada sai do painel.
 */

export { AREAS_DO_PAINEL };
export type { AreaDoPainel };

export interface DestinoDoAgente {
  area: string;
  nome: string;
  link: string;
  /** A pessoa pediu para abrir: a tela abre sozinha. */
  direto: boolean;
}

/** Lê o ir_para da resposta do agente. Link fora do mapa ou externo: null. */
export function destinoDoAgente(bruto: unknown): DestinoDoAgente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const link = safeInternalPath(o.link);
  if (!link || !areaDaRota(link)) return null;
  const area = areaDaRota(link);
  return { area: area ? area.chave : String(o.area || ""), nome: String(o.nome || (area ? area.nome : "a área")), link, direto: o.direto === true };
}

export type PedacoDoTexto = { tipo: "texto"; texto: string } | { tipo: "link"; texto: string; link: string; nome: string };

/**
 * Parte o texto do agente em pedaços: texto comum e rotas do mapa (viram
 * link com o cliente da tela). Rota desconhecida fica como texto.
 */
export function pedacosComLinks(texto: string, clientId?: string | null): PedacoDoTexto[] {
  const s = String(texto || "");
  const rotas = rotasNoTexto(s);
  if (!rotas.length) return [{ tipo: "texto", texto: s }];
  const pedacos: PedacoDoTexto[] = [];
  let resto = s;
  for (const r of rotas) {
    const i = resto.indexOf(r.rota);
    if (i < 0) continue;
    if (i > 0) pedacos.push({ tipo: "texto", texto: resto.slice(0, i) });
    const destino = destinoDoPedido(r.rota, clientId || null);
    const link = destino ? safeInternalPath(destino.link) : null;
    if (link && destino) pedacos.push({ tipo: "link", texto: r.rota, link, nome: destino.nome });
    else pedacos.push({ tipo: "texto", texto: r.rota });
    resto = resto.slice(i + r.rota.length);
  }
  if (resto) pedacos.push({ tipo: "texto", texto: resto });
  return pedacos;
}

/**
 * Confirmar, Cancelar ou Desfazer do cartão do Aceleriq do lançador
 * (voice-assistant-agent guarda a proposta na conversa do cliente).
 */
export async function chamarAcaoDoLancador(mensagemId: string, acaoId: string, pedido: PedidoDaAcao): Promise<RespostaDaAcao> {
  const corpo: Record<string, unknown> = {
    acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente",
    mensagem_id: mensagemId,
    acao_id: acaoId,
  };
  if (pedido === "descartar") corpo.descartar = true;
  const { data, error } = await supabase.functions.invoke("voice-assistant-agent", { body: corpo });
  let mensagem = "";
  if (error) {
    try {
      const ctx = (error as { context?: { clone?: () => Response } }).context;
      const j = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : null;
      mensagem = j && typeof j.mensagem === "string" ? j.mensagem : "";
    } catch {
      mensagem = "";
    }
    throw new Error(mensagem || "Não foi possível agora. Tente de novo.");
  }
  const d = (data || {}) as RespostaDaAcao & { error?: string; mensagem?: string };
  if (d.error) throw new Error(d.mensagem || "Não foi possível agora. Tente de novo.");
  return d;
}
