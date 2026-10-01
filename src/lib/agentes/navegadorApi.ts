/**
 * Navegador do agente na tela (frente MOD, 30/09/2026): computer use pela API,
 * só leitura e coleta, com o Confirmar do dono. A tela lê a fila pela RLS da
 * equipe (agente_computador_tarefas, só as tarefas de navegador) e fala com a
 * função computador-do-agente para pedir, confirmar, parar e ver as provas.
 * Desenho: docs/motores/COMPUTADOR-DO-AGENTE.md, seção 8.
 */

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import {
  type CasoDoNavegador,
  custoEstimadoDoCaso,
  DEFINICOES_DOS_CASOS,
  type EstadoDaTarefa,
  MODELO_PADRAO_DO_COMPUTADOR,
  type ModeloDoCatalogoParaComputador,
  POR_QUE_SO_ESTES_MODELOS,
  provedorDoComputador,
  ROTULO_DA_TAREFA,
} from "../../../supabase/functions/computador-do-agente/modulos/navegador";

export type { CasoDoNavegador, EstadoDaTarefa };
export { custoEstimadoDoCaso, DEFINICOES_DOS_CASOS, MODELO_PADRAO_DO_COMPUTADOR, POR_QUE_SO_ESTES_MODELOS, provedorDoComputador, ROTULO_DA_TAREFA };

/** Origens do pedido (a mesa que pediu e que recebe o insumo). */
export type OrigemDoNavegador = "mesa_site" | "agenda" | "proposta" | "mesa_ads" | "mesa_identidade" | "painel";

export interface TarefaDoNavegador {
  id: string;
  client_id: string | null;
  titulo: string;
  caso: CasoDoNavegador;
  estado: EstadoDaTarefa;
  url_inicial: string;
  dominios: string[];
  objetivo: string | null;
  origem: string | null;
  teto_passos: number;
  teto_custo_usd: number;
  passos_feitos: number;
  custo_usd: number;
  resultado: Record<string, unknown> | null;
  motivo: string | null;
  criado_por: string | null;
  criado_em: string;
  aprovado_em: string | null;
  terminado_em: string | null;
  /** Frente CUS: o modelo do computer use escolhido no pedido (null nas ações de roteiro fixo). */
  modelo_id?: string | null;
  /** Aprovada há mais de 24 h sem executor: a fila tira na próxima vez que um worker olhar. */
  vencida?: boolean;
}

export interface CasoNaTela {
  valor: CasoDoNavegador;
  rotulo: string;
  descricao?: string;
  onde?: string;
  usa_modelo: boolean;
  ligado: boolean;
  motivo: string | null;
  teto_passos: number;
  teto_custo_usd: number;
  insumo?: string | null;
  varios_sites?: boolean;
  /** Tarefas feitas desta ação (as últimas 300 da fila) e o custo médio real delas. */
  feitas?: number;
  custo_medio_usd?: number | null;
  /** Estimativa pelo modelo padrão quando ainda não há histórico. */
  custo_estimado_usd?: number;
}

export type ModeloDoNavegador = ModeloDoCatalogoParaComputador & { rotulo?: string | null; ativo?: boolean };

export interface ExecutorDoNavegador {
  nome: string;
  visto_em: string;
  versao: string | null;
  casos: string[];
  provedores?: string[];
  ultimo_erro?: string | null;
  ultimo_erro_em?: string | null;
}

export interface EstadoDoNavegador {
  casos: CasoNaTela[];
  com_modelo: boolean;
  /** Frente CUS: os modelos do catálogo com computer use (o padrão primeiro). */
  modelos?: ModeloDoNavegador[];
  modelo_padrao?: string;
  executores: ExecutorDoNavegador[];
}

/** Resultado inteiro de uma tarefa, com as imagens do cartão (link de 10 minutos). */
export interface CartaoDaTarefa {
  tarefa: { id: string; caso: CasoDoNavegador; estado: EstadoDaTarefa; url_inicial: string; dominios: string[]; objetivo: string | null; origem: string | null; modelo_id: string | null; client_id: string | null };
  resultado: Record<string, unknown>;
  imagens: Array<{ rotulo: string; url: string | null; storage_path: string }>;
}

export interface ProvaNaTela {
  passo: number;
  url: string | null;
  legenda: string;
  em: string | null;
}

export const chaveDasTarefas = (clientId: string | null) => ["navegador-do-agente", "tarefas", clientId || "agencia"];
export const CHAVE_DO_ESTADO = ["navegador-do-agente", "estado"];

const ATIVOS: EstadoDaTarefa[] = ["aguardando_dono", "aprovada", "executando"];
export const tarefaAtiva = (t: Pick<TarefaDoNavegador, "estado" | "vencida">) => ATIVOS.indexOf(t.estado) >= 0 && !t.vencida;

/** A fila (computador_tarefa_pegar) tira a tarefa aprovada há mais de 24 h; a tela mostra antes, sem esperar um worker. */
export const VALIDADE_DA_APROVACAO_MS = 24 * 3_600_000;
export function aprovacaoVencida(t: Pick<TarefaDoNavegador, "estado" | "aprovado_em">, agora = Date.now()): boolean {
  if (t.estado !== "aprovada" || !t.aprovado_em) return false;
  const quando = new Date(t.aprovado_em).getTime();
  return Number.isFinite(quando) && agora - quando > VALIDADE_DA_APROVACAO_MS;
}

/**
 * De quanto em quanto tempo a lista olha de novo: 5 s com tarefa executando, 60 s com tarefa
 * aprovada esperando o executor (sem worker ligado ela pode esperar o dia todo) e nada no resto.
 */
export function intervaloDaLista(itens: Array<Pick<TarefaDoNavegador, "estado" | "vencida">> | undefined): number | false {
  if (!itens || !itens.length) return false;
  if (itens.some((t) => t.estado === "executando")) return 5_000;
  if (itens.some((t) => t.estado === "aprovada" && !t.vencida)) return 60_000;
  return false;
}

/**
 * Só o que a lista mostra. provas e resultado inteiro (até 200 KB por tarefa) ficam no banco:
 * do resultado vêm só os campos do resumo, e as provas abrem pela função.
 */
export const COLUNAS_DA_LISTA = [
  "id", "client_id", "titulo", "caso", "estado", "url_inicial", "dominios", "objetivo", "origem",
  "teto_passos", "teto_custo_usd", "passos_feitos", "custo_usd", "motivo", "criado_por", "criado_em",
  "aprovado_em", "terminado_em", "modelo_id",
  "r_no_ar:resultado->no_ar", "r_parcial:resultado->parcial", "r_resumo:resultado->>resumo", "r_motivo:resultado->>motivo", "r_capturas:resultado->capturas",
].join(", ");

type LinhaDaLista = Omit<TarefaDoNavegador, "resultado" | "vencida"> & {
  r_no_ar?: unknown;
  r_parcial?: unknown;
  r_resumo?: string | null;
  r_motivo?: string | null;
  r_capturas?: unknown;
};

export function tarefaDaLinha(l: LinhaDaLista, agora = Date.now()): TarefaDoNavegador {
  const { r_no_ar, r_parcial, r_resumo, r_motivo, r_capturas, ...resto } = l;
  const resultado: Record<string, unknown> = {};
  if (r_no_ar !== undefined && r_no_ar !== null) resultado.no_ar = r_no_ar;
  if (r_parcial) resultado.parcial = r_parcial;
  if (r_resumo) resultado.resumo = r_resumo;
  if (r_motivo) resultado.motivo = r_motivo;
  if (Array.isArray(r_capturas)) resultado.capturas = r_capturas;
  const t: TarefaDoNavegador = { ...(resto as TarefaDoNavegador), resultado: Object.keys(resultado).length ? resultado : null };
  t.vencida = aprovacaoVencida(t, agora);
  return t;
}

/** Tarefas de navegador do cliente (ou da agência), mais novas primeiro, só com as colunas da lista. */
export function useTarefasDoNavegador(clientId: string | null, origem?: string) {
  return useQuery({
    queryKey: chaveDasTarefas(clientId).concat(origem ? [origem] : []),
    staleTime: 10_000,
    retry: false,
    refetchInterval: (q) => intervaloDaLista((q.state.data as { itens: TarefaDoNavegador[] } | undefined)?.itens),
    queryFn: async (): Promise<{ itens: TarefaDoNavegador[]; disponivel: boolean }> => {
      let q = (supabase as any).from("agente_computador_tarefas").select(COLUNAS_DA_LISTA).not("caso", "is", null).order("criado_em", { ascending: false }).limit(30);
      q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
      if (origem) q = q.eq("origem", origem);
      const { data, error } = await q;
      if (error) {
        // Banco sem a migration 20260930320200: a lista fica vazia com o aviso.
        if (/does not exist|column|schema cache/i.test(String(error.message || ""))) return { itens: [], disponivel: false };
        throw error;
      }
      const agora = Date.now();
      return { itens: (Array.isArray(data) ? (data as LinhaDaLista[]) : []).map((l) => tarefaDaLinha(l, agora)), disponivel: true };
    },
  });
}

/** Estado dos casos e do executor. Só busca quando a tela precisa (janela aberta ou fila com tarefa): painel leve. */
export function useEstadoDoNavegador(ativo = true) {
  return useQuery({
    queryKey: CHAVE_DO_ESTADO,
    enabled: ativo,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => normalizarEstado(await chamarFuncao<EstadoDoNavegador>("computador-do-agente", { acao: "estado" })),
  });
}

/** Resposta da função com as listas sempre presentes (função antiga sem modelos, resposta parcial). */
export function normalizarEstado(d: Partial<EstadoDoNavegador> | null | undefined): EstadoDoNavegador {
  const o = (d && typeof d === "object" ? d : {}) as Partial<EstadoDoNavegador>;
  return {
    casos: Array.isArray(o.casos) ? o.casos : [],
    com_modelo: o.com_modelo === true,
    modelos: Array.isArray(o.modelos) ? o.modelos : [],
    modelo_padrao: typeof o.modelo_padrao === "string" ? o.modelo_padrao : undefined,
    executores: Array.isArray(o.executores) ? o.executores.map((e) => ({ ...e, casos: Array.isArray(e.casos) ? e.casos : [] })) : [],
  };
}

export const pedirAoNavegador = (p: { caso: CasoDoNavegador; url: string; urls?: string; dominios?: string; objetivo?: string; origem: string; client_id?: string | null; modelo_id?: string | null }) =>
  chamarFuncao<{ tarefa: TarefaDoNavegador; custo_estimado_usd?: number; teto_custo_usd?: number }>("computador-do-agente", { acao: "pedir", ...p });

export const cartaoDaTarefa = (tarefaId: string) => chamarFuncao<CartaoDaTarefa>("computador-do-agente", { acao: "cartao", tarefa_id: tarefaId });

/** Rótulo curto do modelo para a tela ("Claude Sonnet 5.5", "GPT-6.1 Sol"), sem o "(Anthropic direta)". */
export function nomeDoModelo(m: Pick<ModeloDoNavegador, "id" | "rotulo"> | null | undefined, id?: string | null): string {
  const bruto = (m && (m.rotulo || m.id)) || id || "";
  return String(bruto).replace(/\s*\((Anthropic|OpenAI) direta\)\s*$/i, "").replace(/^(anthropic|openai):/, "") || "modelo padrão";
}

/** O executor ligado tem a chave do provedor deste modelo? (sem executor ligado: não dá para saber). */
export function executorTemProvedor(e: EstadoDoNavegador | undefined, modeloId: string, agora = Date.now()): boolean | null {
  const p = provedorDoComputador(modeloId);
  if (!e || !p) return null;
  const vivos = e.executores.filter((x) => {
    const t = new Date(x.visto_em).getTime();
    return Number.isFinite(t) && agora - t < 120_000;
  });
  if (!vivos.length) return null;
  // Worker antigo (sem a lista de provedores) só fala com a Anthropic.
  return vivos.some((x) => (Array.isArray(x.provedores) && x.provedores.length ? x.provedores.indexOf(p) >= 0 : p === "anthropic" && x.casos.indexOf("coleta_publica") >= 0));
}

/** "US$ 0,03" (até centavo; abaixo de 1 centavo mostra "menos de US$ 0,01"). */
export function dolares(v: number | null | undefined): string {
  const n = Number(v) || 0;
  if (n > 0 && n < 0.01) return "menos de US$ 0,01";
  return `US$ ${n.toFixed(2).replace(".", ",")}`;
}

export const decidirTarefa = (tarefaId: string, estado: "aprovada" | "cancelada") =>
  chamarFuncao<{ tarefa: TarefaDoNavegador }>("computador-do-agente", { acao: "decidir", tarefa_id: tarefaId, estado });

export const pararTarefa = (tarefaId: string) => chamarFuncao<{ tarefa: TarefaDoNavegador }>("computador-do-agente", { acao: "parar", tarefa_id: tarefaId });

export const provasDaTarefa = (tarefaId: string) => chamarFuncao<{ provas: ProvaNaTela[] }>("computador-do-agente", { acao: "provas", tarefa_id: tarefaId });

export function invalidarNavegador(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["navegador-do-agente"] });
}

/** Executor visto há menos de 2 minutos (o worker olha a fila a cada 20 s). */
export function executorLigado(e: EstadoDoNavegador | undefined, agora = Date.now()): boolean {
  if (!e) return false;
  return e.executores.some((x) => {
    const t = new Date(x.visto_em).getTime();
    return Number.isFinite(t) && agora - t < 120_000;
  });
}

/** Resumo curto do resultado para a lista. */
export function resumoDoResultado(t: Pick<TarefaDoNavegador, "caso" | "estado" | "resultado" | "motivo">): string {
  const r = t.resultado || {};
  if ((t as { vencida?: boolean }).vencida) return "A aprovação venceu (24 h sem executor ligado). Peça de novo quando o worker estiver ligado.";
  if (t.estado === "falhou" || t.estado === "cancelada") return t.motivo || ROTULO_DA_TAREFA[t.estado];
  if (t.estado !== "feita") return "";
  if (t.caso === "conferir_post") {
    const noAr = (r as { no_ar?: unknown }).no_ar;
    return noAr === true ? "No ar." : noAr === false ? `Fora do ar. ${String((r as { motivo?: unknown }).motivo || "")}` : `Não deu para conferir. ${String((r as { motivo?: unknown }).motivo || "")}`;
  }
  if (t.caso === "captura_site") {
    const caps = Array.isArray((r as { capturas?: unknown }).capturas) ? ((r as { capturas: unknown[] }).capturas.length) : 0;
    return `${caps} captura(s) de tela inteira${(r as { parcial?: unknown }).parcial ? " (parou no teto)" : ""}.`;
  }
  if (t.caso === "capturar_referencia" && !(r as { resumo?: unknown }).resumo && Array.isArray((r as { capturas?: unknown }).capturas)) {
    return `${(r as { capturas: unknown[] }).capturas.length} captura(s) de tela inteira.`;
  }
  return String((r as { resumo?: unknown }).resumo || "Coleta feita.");
}
