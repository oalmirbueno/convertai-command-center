import { chamarFuncao, type FuncaoDaMesa } from "@/lib/mesa/api";

/**
 * Espelho, na tela, do contrato comum das ações propostas pelos agentes
 * (supabase/functions/_shared/acoes-do-agente.ts). O agente propõe (anexo
 * "acao_agente" na mensagem), a tela mostra o CartaoDeAcao, só a confirmação
 * executa (executar_acao_agente na função do agente) e, quando há reverso,
 * dá para desfazer (desfazer_acao_agente).
 */

export const TIPO_DA_ACAO = "acao_agente";
/** Itens num pedido só (o mesmo do servidor). */
export const MAX_ITENS_POR_ACAO = 120;

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
  /** Pedidos válidos acima do teto de MAX_ITENS_POR_ACAO: ficam para um próximo pedido. */
  acima_do_teto?: number;
  contexto?: Record<string, unknown>;
  sem_desfazer?: boolean;
  custo_estimado_usd?: number | null;
  executada_em?: string | null;
  /** Feita na hora, sem clique (pedido claro, sem custo e com Desfazer). */
  executada_direto?: boolean;
  resultados?: ResultadoDoItem[];
  descartada_em?: string | null;
  desfeita_em?: string | null;
  /** Botão "Ir para" depois de feito (espelho do servidor). */
  caminho?: CaminhoDoAgente | null;
  /** Sequência feita em passos: quantos já foram e o total (a tela mostra "3 de 12" e o Parar). */
  andamento?: { feitos: number; total: number; atualizado_em?: string } | null;
  /** A equipe parou a sequência no meio: o que foi feito fica, com o Desfazer. */
  parada_em?: string | null;
}

/**
 * Anexo de caminho numa resposta sem ação (espelho do servidor): o botão
 * "Ir para" continua na mensagem quando a conversa é reaberta.
 */
export const TIPO_DO_CAMINHO = "caminho_do_agente";

/** O caminho de uma mensagem (anexo próprio). Null quando não há ou não é rota interna. */
export function caminhoDosAnexos(anexos: unknown): CaminhoDoAgente | null {
  if (!Array.isArray(anexos)) return null;
  for (const a of anexos) {
    if (a && typeof a === "object" && (a as Record<string, unknown>).tipo === TIPO_DO_CAMINHO) {
      const c = caminhoSeguro(a);
      if (c) return c;
    }
  }
  return null;
}

/** Itens ainda sem resultado (sequência em passos). */
export function pendentesDaAcao(a: Pick<AcaoDoAgente, "itens" | "resultados">): ItemDaAcaoDoAgente[] {
  const feitos: Record<string, boolean> = {};
  (a.resultados || []).forEach((r) => {
    feitos[`${r.operacao}|${r.ref}`] = true;
  });
  return a.itens.filter((i) => !feitos[`${i.operacao}|${i.ref}`]);
}

/** A sequência começou e não terminou (nem foi parada): falta continuar ou parar. */
export function emAndamento(a: Pick<AcaoDoAgente, "itens" | "resultados" | "executada_em" | "descartada_em" | "desfeita_em">): boolean {
  return estadoDaAcao(a) === "aberta" && (a.resultados || []).length > 0 && pendentesDaAcao(a).length > 0;
}

/**
 * Para onde ir quando a ação termina (pedido do dono, 27/09: "quando termina
 * ele dá o caminho pra mim apertar e ir e já fica tudo certinho"): rota
 * interna do painel já com o estado (cliente, etapa, item) e o rótulo do
 * botão. `abrir_sozinho`: a tela vai sozinha ao terminar (pedido "faz e me
 * leva"). Só rota interna: começa com "/" e nunca com "//".
 */
export type CaminhoDoAgente = { rotulo: string; destino: string; abrir_sozinho?: boolean };

/** Caminho válido ou null (endereço externo, javascript: ou rótulo vazio não passam). */
export function caminhoSeguro(c: unknown): CaminhoDoAgente | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const destino = typeof o.destino === "string" ? o.destino.trim() : "";
  const rotulo = typeof o.rotulo === "string" ? o.rotulo.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!rotulo || !destino || destino.length > 600) return null;
  if (destino.charAt(0) !== "/" || destino.charAt(1) === "/" || destino.charAt(1) === "\\") return null;
  return o.abrir_sozinho === true ? { rotulo, destino, abrir_sozinho: true } : { rotulo, destino };
}

/**
 * A pessoa já está no destino do caminho? Mesmo caminho e todos os parâmetros
 * do destino iguais no endereço atual (o atual pode ter outros, como mes ou
 * marca). Aí o botão "Ir para" não aparece (seria só ruído).
 */
export function jaEstaAqui(destino: string, atual: string): boolean {
  const partir = (s: string) => {
    const i = s.indexOf("?");
    return { caminho: (i >= 0 ? s.slice(0, i) : s).replace(/\/+$/, "") || "/", busca: new URLSearchParams(i >= 0 ? s.slice(i + 1) : "") };
  };
  const d = partir(String(destino || ""));
  const a = partir(String(atual || ""));
  if (d.caminho !== a.caminho) return false;
  let igual = true;
  d.busca.forEach((valor, chave) => {
    if (a.busca.get(chave) !== valor) igual = false;
  });
  return igual;
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
    caminho: caminhoSeguro(o.caminho),
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

/**
 * "parar": encerra a sequência em passos no meio (o que já foi feito fica,
 * com o Desfazer). Só aparece quando a função do agente faz em passos.
 */
export type PedidoDaAcao = "confirmar" | "descartar" | "desfazer" | "parar";

export interface RespostaDaAcao {
  anexo?: unknown;
  feitos?: number;
  falhas?: number;
  voltaram?: number;
  /** Desfazer: os itens que não voltaram, com o motivo (o cartão avisa). */
  falharam?: Array<{ ref?: string; titulo?: string; motivo?: string }>;
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
  if (pedido === "parar") corpo.parar = true;
  return chamarFuncao<RespostaDaAcao>(funcao, corpo);
}

/** Frase curta do resultado, para o aviso na tela. */
export function frasesDoResultado(resultados: ResultadoDoItem[] | undefined, total?: number): { titulo: string; descricao: string } {
  const lista = resultados || [];
  const ok = lista.filter((r) => r.ok).length;
  const falhas = lista.length - ok;
  const parou = typeof total === "number" && total > lista.length;
  return {
    titulo: ok ? `${ok} ${ok === 1 ? "item feito" : "itens feitos"}${parou ? ` de ${total}` : ""}` : parou ? "Parado antes de começar" : "Nada mudou",
    descricao: falhas
      ? `${falhas} não ${falhas === 1 ? "pôde ser feito" : "puderam ser feitos"}. O motivo está na lista.`
      : parou
        ? "Parado: o resto não foi feito. Dá para desfazer o que foi."
        : "Dá para desfazer no cartão.",
  };
}
