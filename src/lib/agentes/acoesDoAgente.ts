import { chamarFuncao, type FuncaoDaMesa } from "@/lib/mesa/api";

/**
 * Espelho, na tela, do contrato comum das ações propostas pelos agentes
 * (supabase/functions/_shared/acoes-do-agente.ts). O agente propõe (anexo
 * "acao_agente" na mensagem), a tela mostra o CartaoDeAcao, só a confirmação
 * executa (executar_acao_agente na função do agente) e, quando há reverso,
 * dá para desfazer (desfazer_acao_agente).
 */

export const TIPO_DA_ACAO = "acao_agente";

export interface ItemDaAcaoDoAgente {
  ref: string;
  alvo_id: string;
  titulo: string;
  detalhe: string | null;
  operacao: string;
  rotulo: string;
  para: string | number | null;
  para_rotulo?: string | null;
}

export interface RecusaDoItem {
  ref: string;
  titulo: string;
  operacao: string;
  motivo: string;
}

export interface ResultadoDoItem {
  ref: string;
  alvo_id: string;
  titulo: string;
  operacao: string;
  ok: boolean;
  motivo?: string;
  desfazer?: Record<string, unknown> | null;
}

export interface AcaoDoAgente {
  tipo: "acao_agente";
  agente: string;
  id: string;
  resumo: string;
  itens: ItemDaAcaoDoAgente[];
  ignorados: string[];
  recusados: RecusaDoItem[];
  contexto?: Record<string, unknown>;
  sem_desfazer?: boolean;
  custo_estimado_usd?: number | null;
  executada_em?: string | null;
  resultados?: ResultadoDoItem[];
  descartada_em?: string | null;
  desfeita_em?: string | null;
}

export type EstadoDaAcao = "aberta" | "feita" | "descartada" | "desfeita";

export function estadoDaAcao(a: Pick<AcaoDoAgente, "executada_em" | "descartada_em" | "desfeita_em">): EstadoDaAcao {
  if (a.desfeita_em) return "desfeita";
  if (a.executada_em) return "feita";
  if (a.descartada_em) return "descartada";
  return "aberta";
}

export function acaoDoAnexo(a: unknown): AcaoDoAgente | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if (o.tipo !== TIPO_DA_ACAO) return null;
  return {
    ...(o as unknown as AcaoDoAgente),
    agente: String(o.agente || ""),
    id: String(o.id || ""),
    resumo: String(o.resumo || ""),
    itens: Array.isArray(o.itens) ? (o.itens as ItemDaAcaoDoAgente[]) : [],
    ignorados: Array.isArray(o.ignorados) ? (o.ignorados as unknown[]).map(String) : [],
    recusados: Array.isArray(o.recusados) ? (o.recusados as RecusaDoItem[]) : [],
  };
}

/** As propostas de ação dos anexos de uma mensagem. */
export function acoesDaMensagem(anexos: unknown[] | null | undefined): AcaoDoAgente[] {
  if (!Array.isArray(anexos)) return [];
  const out: AcaoDoAgente[] = [];
  anexos.forEach((a) => {
    const x = acaoDoAnexo(a);
    if (x) out.push(x);
  });
  return out;
}

export type PedidoDaAcao = "confirmar" | "descartar" | "desfazer";

export interface RespostaDaAcao {
  anexo?: unknown;
  feitos?: number;
  falhas?: number;
  voltaram?: number;
  custo_usd?: number;
}

/**
 * Chamada padrão do cartão: confirmar, cancelar ou desfazer a proposta
 * guardada na mensagem. `extra` leva o que a função do agente precisar
 * (ex.: client_id).
 */
export function chamarAcaoDoAgente(
  funcao: FuncaoDaMesa,
  mensagemId: string,
  acaoId: string,
  pedido: PedidoDaAcao,
  extra: Record<string, unknown> = {},
): Promise<RespostaDaAcao> {
  const corpo: Record<string, unknown> = {
    ...extra,
    acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente",
    mensagem_id: mensagemId,
    acao_id: acaoId,
  };
  if (pedido === "descartar") corpo.descartar = true;
  return chamarFuncao<RespostaDaAcao>(funcao, corpo);
}

/** Frase curta do resultado, para o aviso na tela. */
export function frasesDoResultado(resultados: ResultadoDoItem[] | undefined): { titulo: string; descricao: string } {
  const lista = resultados || [];
  const ok = lista.filter((r) => r.ok).length;
  const falhas = lista.length - ok;
  return {
    titulo: ok ? `${ok} ${ok === 1 ? "item feito" : "itens feitos"}` : "Nada mudou",
    descricao: falhas ? `${falhas} não ${falhas === 1 ? "pôde ser feito" : "puderam ser feitos"}. O motivo está na lista.` : "Dá para desfazer no cartão.",
  };
}
