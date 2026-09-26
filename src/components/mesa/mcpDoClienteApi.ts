import { chamarFuncao } from "@/lib/mesa/api";

/**
 * Área MCP do Contexto do cliente (26/09): o que chegou pelo MCP do painel
 * (orientações de aceleriq_client_instruction, dossiê, memórias, arquivos e
 * rascunho do Estúdio) e o que vale para o planejamento. A lista e a troca
 * passam pelo agente-calendario (itens_mcp e ativar_item_mcp), com a chave de
 * serviço no servidor e o acesso ao cliente conferido. Espelho dos tipos de
 * supabase/functions/_shared/contexto-mcp.ts.
 */

export type FonteMcp = "orientacao" | "dossie" | "memoria" | "arquivo" | "rascunho";

export interface ItemMcp {
  fonte: FonteMcp;
  id: string;
  titulo: string;
  resumo: string;
  origem: string;
  quando: string | null;
  tamanho: number;
  ativo: boolean;
  padrao: boolean;
  publico?: string | null;
}

export interface ListaDoMcp {
  itens: ItemMcp[];
  /** false: a tabela de escolhas (SQL M-01) ainda não existe; valem os padrões e a troca não grava. */
  tabela: boolean;
}

export const ROTULO_DA_FONTE: Record<FonteMcp, string> = {
  orientacao: "Orientação",
  dossie: "Dossiê",
  memoria: "Memória",
  arquivo: "Arquivo",
  rascunho: "Rascunho do Estúdio",
};

export const chaveDoMcp = (clientId: string) => ["mesa", "mcp-do-cliente", clientId] as const;

export async function lerItensMcp(clientId: string): Promise<ListaDoMcp> {
  const r = await chamarFuncao<ListaDoMcp>("agente-calendario", { acao: "itens_mcp", client_id: clientId });
  return { itens: Array.isArray(r && r.itens) ? r.itens : [], tabela: !!(r && r.tabela) };
}

export const ativarItemMcp = (clientId: string, fonte: FonteMcp, itemId: string, ativo: boolean) =>
  chamarFuncao<{ item: ItemMcp }>("agente-calendario", { acao: "ativar_item_mcp", client_id: clientId, fonte, item_id: itemId, ativo });

/** A lista com um item trocado (sem reler do servidor). */
export function comItemTrocado(lista: ListaDoMcp, fonte: FonteMcp, id: string, ativo: boolean): ListaDoMcp {
  return { ...lista, itens: lista.itens.map((i) => (i.fonte === fonte && i.id === id ? { ...i, ativo, padrao: false } : i)) };
}

/** Itens da fonte escolhida ("todas" = tudo), mais novos primeiro. */
export function filtrarItensMcp(itens: ItemMcp[], fonte: FonteMcp | "todas"): ItemMcp[] {
  return itens
    .filter((i) => fonte === "todas" || i.fonte === fonte)
    .slice()
    .sort((a, b) => String(b.quando || "").localeCompare(String(a.quando || "")));
}

/** "12 itens · 3 valem para o planejamento". */
export function resumoDoMcp(itens: ItemMcp[]): string {
  if (!itens.length) return "Nada chegou pelo MCP";
  const ativos = itens.filter((i) => i.ativo).length;
  return `${itens.length} ${itens.length === 1 ? "item" : "itens"} · ${ativos} ${ativos === 1 ? "vale" : "valem"} para o planejamento`;
}
