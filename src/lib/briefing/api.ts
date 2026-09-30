import { supabase } from "@/integrations/supabase/client";
import type { AnexoDoBriefing, SlugDoModelo } from "../../../supabase/functions/_shared/briefing-modelos";
import type { SugestaoDoContexto, ItemDecupado, Aplicada } from "../../../supabase/functions/_shared/briefing-decupagem";

/**
 * Chamadas do briefing (frente BRF, 30/09/2026).
 *
 * Link público (sem login): RPCs do banco (ler, salvar parcial, enviar,
 * pedir reabertura) e a função briefing-publico (logo, anexos, decupagem).
 * Equipe (logada): a função briefing-agente.
 */

export class ErroDoBriefing extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const MENSAGEM_PADRAO: Record<string, string> = {
  servico_indisponivel: "O serviço do briefing não respondeu. Tente de novo em instantes.",
  sessao_expirada: "Sessão expirada. Entre de novo no painel.",
};

async function erroDaResposta(error: any): Promise<ErroDoBriefing> {
  const ctx = error?.context;
  let corpo: any = null;
  try {
    if (ctx && typeof ctx.clone === "function") corpo = await ctx.clone().json();
    else if (ctx && typeof ctx.json === "function") corpo = await ctx.json();
  } catch {
    corpo = null;
  }
  if (corpo && typeof corpo.error === "string") return new ErroDoBriefing(corpo.error, String(corpo.mensagem || MENSAGEM_PADRAO[corpo.error] || "Não foi possível concluir."));
  const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
  if (status === 404 || /FunctionsFetchError|FunctionsRelayError/.test(String(error?.name || ""))) return new ErroDoBriefing("servico_indisponivel", MENSAGEM_PADRAO.servico_indisponivel);
  return new ErroDoBriefing("falha", error?.message || "Não foi possível concluir. Tente de novo.");
}

/** Chama a função da equipe (briefing-agente). Erro vira ErroDoBriefing com a frase do servidor. */
export async function chamarAgenteDoBriefing<T = any>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("briefing-agente", { body: { acao, ...corpo } });
  if (error) throw await erroDaResposta(error);
  if (data && typeof data === "object" && typeof (data as any).error === "string") {
    throw new ErroDoBriefing((data as any).error, String((data as any).mensagem || "Não foi possível concluir."));
  }
  return data as T;
}

/** Resposta de uma consulta do Supabase (o mínimo que as telas do briefing usam). */
export type RespostaSolta<T> = { data: T | null; error: { code?: string; message?: string } | null; count?: number | null };
/**
 * Consulta com a lista de colunas montada em texto (colunas novas com volta
 * sem elas): o tipo gerado do Supabase não entende a string montada; este é
 * o mínimo que a lista e a leitura dos briefings usam.
 */
export interface ConsultaSolta<T> extends PromiseLike<RespostaSolta<T>> {
  select(colunas: string): ConsultaSolta<T>;
  eq(coluna: string, valor: unknown): ConsultaSolta<T>;
  is(coluna: string, valor: null): ConsultaSolta<T>;
  not(coluna: string, operador: string, valor: unknown): ConsultaSolta<T>;
  in(coluna: string, valores: unknown[]): ConsultaSolta<T>;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaSolta<T>;
  limit(n: number): ConsultaSolta<T>;
  maybeSingle(): PromiseLike<RespostaSolta<T>>;
}
export function consultaSolta<T>(tabela: string): ConsultaSolta<T> {
  return (supabase as unknown as { from: (t: string) => ConsultaSolta<T> }).from(tabela);
}

/** O que cada sugestão faz no contexto (mesmo tempo verbal nos dois blocos de "Levar para o contexto"). */
export const ROTULO_DO_MODO_DA_SUGESTAO: Record<string, string> = { preencher: "Preenche", juntar: "Acrescenta", substituir: "Substitui" };

/**
 * Erro de coluna que o banco ainda não tem (migração da frente BRF2 não
 * aplicada): a leitura repete sem as colunas novas e trata como vazias.
 * Qualquer outro erro continua sendo erro.
 */
export function ehErroDeColuna(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const x = e as { code?: unknown; message?: unknown };
  return x.code === "42703" || /column .* does not exist/i.test(String(x.message || ""));
}

export function textoDoErroDoBriefing(e: unknown, padrao = "Não foi possível concluir. Tente de novo."): string {
  if (e instanceof ErroDoBriefing) return e.message;
  const m = (e as any)?.message;
  return typeof m === "string" && m.trim() ? m : padrao;
}

// ------------------------------------------------------------------ link público

export type BriefingPublico = {
  id: string;
  submitted: boolean;
  expirado: boolean;
  responses?: Record<string, unknown>;
  modelo: SlugDoModelo;
  modelo_versao?: number | null;
  modelo_conteudo?: unknown;
  modelo_nome?: string;
  prefill?: Record<string, string>;
  titulo?: string | null;
  cliente_nome?: string | null;
  marca_nome?: string | null;
  tem_cliente?: boolean;
  expira_em?: string | null;
  rascunho_salvo_em?: string | null;
  enviado_em?: string | null;
  reabertura_pedida_em?: string | null;
  anexos?: AnexoDoBriefing[];
  equipe?: boolean;
};

/** Lê o link. null = link inexistente ou arquivado. Erro de rede sobe (não é "link inválido"). */
export async function abrirBriefingPublico(token: string): Promise<BriefingPublico | null> {
  const { data, error } = await supabase.rpc("briefing_public_get" as any, { _token: token });
  if (error) throw error;
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha || typeof linha !== "object" || !(linha as any).id) return null;
  const b = linha as any;
  return { ...b, submitted: !!b.submitted, expirado: !!b.expirado, modelo: b.modelo || "diagnostico" } as BriefingPublico;
}

export type ResultadoDoSalvar = { ok: boolean; motivo?: string; salvo_em?: string; respostas?: Record<string, unknown> };

export async function salvarParcial(token: string, mudancas: Record<string, unknown>): Promise<ResultadoDoSalvar> {
  const { data, error } = await supabase.rpc("briefing_public_save" as any, { _token: token, _mudancas: mudancas });
  if (error) throw error;
  return (data || { ok: false, motivo: "sem_resposta" }) as ResultadoDoSalvar;
}

/** Envia. true só quando o servidor gravou (envio único). */
export async function enviarBriefing(token: string, respostas: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.rpc("briefing_public_submit" as any, { _token: token, _responses: respostas });
  if (error) throw error;
  return data === true;
}

export async function pedirReabertura(token: string, motivo: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("briefing_public_pedir_reabertura" as any, { _token: token, _motivo: motivo });
  if (error) throw error;
  return data === true;
}

const URL_PUBLICA = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/briefing-publico`;
const CHAVE_PUBLICA = () => import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function chamarPublico(token: string, acao: string, init: { body?: BodyInit; headers?: Record<string, string>; keepalive?: boolean } = {}): Promise<any> {
  const r = await fetch(URL_PUBLICA(), {
    method: "POST",
    headers: { apikey: CHAVE_PUBLICA(), "x-briefing-token": token, "x-briefing-acao": acao, ...(init.headers || {}) },
    body: init.body,
    keepalive: init.keepalive,
    referrerPolicy: "no-referrer",
  });
  let corpo: any = null;
  try {
    corpo = await r.json();
  } catch {
    corpo = null;
  }
  if (!r.ok || (corpo && typeof corpo.error === "string")) {
    throw new ErroDoBriefing(corpo?.error || `http_${r.status}`, corpo?.mensagem || "Não foi possível concluir. Tente de novo.");
  }
  return corpo;
}

export async function capaDoBriefing(token: string): Promise<{ logo: string | null; agencia: string | null }> {
  const r = await chamarPublico(token, "capa", { headers: { "content-type": "application/json" }, body: "{}" });
  return {
    logo: typeof r?.logo_cliente_url === "string" ? r.logo_cliente_url : null,
    agencia: typeof r?.agencia_nome === "string" && r.agencia_nome.trim() ? r.agencia_nome.trim() : null,
  };
}

export async function anexarArquivo(token: string, arquivo: File, campo: string, categoria: string): Promise<AnexoDoBriefing> {
  const r = await chamarPublico(token, "anexar", {
    body: arquivo,
    headers: {
      "content-type": arquivo.type || "application/octet-stream",
      "x-briefing-nome": encodeURIComponent(arquivo.name),
      "x-briefing-campo": campo,
      "x-briefing-categoria": categoria,
    },
  });
  return r.anexo as AnexoDoBriefing;
}

export async function removerAnexo(token: string, anexoId: string): Promise<void> {
  await chamarPublico(token, "remover_anexo", { headers: { "content-type": "application/json" }, body: JSON.stringify({ anexo_id: anexoId }) });
}

/** Depois do envio: pede a decupagem sem esperar (a equipe refaz pelo painel se falhar). */
export function pedirDecupagem(token: string): Promise<void> {
  return chamarPublico(token, "decupar", { headers: { "content-type": "application/json" }, body: "{}", keepalive: true }).then(
    () => undefined,
    (e) => console.error("[briefing] decupagem depois do envio falhou:", e),
  );
}

// ------------------------------------------------------------------ equipe

export type ModeloResumido = { slug: SlugDoModelo; nome: string; titulo: string; versao: number; minutos: number };
export type LinkGerado = { briefing: { id: string; token: string; expira_em: string; modelo: SlugDoModelo }; caminho: string; cliente: string; telefone: string | null; prefill_campos: string[] };

export type LinhaDaDecupagem = {
  id: string;
  briefing_id: string;
  client_id: string | null;
  envio: number;
  status: "pendente" | "processando" | "pronta" | "falhou" | "aplicada" | "desfeita";
  itens: ItemDecupado[];
  tom_de_voz: string | null;
  sugestoes: SugestaoDoContexto[];
  destino: { tipo: "kit" } | { tipo: "marca"; marca_id: string; marca_nome: string } | null;
  aplicadas: Aplicada[] | null;
  custo_usd: number;
  erro: string | null;
  criado_em: string;
  concluido_em: string | null;
  aplicada_em: string | null;
  desfeita_em: string | null;
};

// ------------------------------------------------------------------ frente BRF2

/**
 * Resposta por áudio: manda o áudio gravado e recebe o texto (o áudio não
 * fica guardado). Erro vira ErroDoBriefing com a frase para o cliente.
 */
export async function transcreverAudio(token: string, audio: Blob, campo: string, segundos: number): Promise<{ texto: string; segundos: number }> {
  const r = await chamarPublico(token, "transcrever", {
    body: audio,
    headers: {
      "content-type": audio.type || "audio/webm",
      "x-briefing-campo": campo,
      "x-briefing-duracao": String(Math.max(1, Math.round(segundos))),
    },
  });
  return { texto: String(r?.texto || ""), segundos: Number(r?.segundos) || segundos };
}

export type PreviaDoPreenchimento = {
  valores: Record<string, unknown>;
  fontes: string[];
  avisos: string[];
  rotulos: Record<string, string>;
  atuais: Record<string, unknown>;
  custo_usd: number;
  saldo_usd: number | null;
  modelo_id: string;
  reserva_usada?: string | null;
};

export type PreviaDaExportacao = {
  destino: { tipo: "kit" } | { tipo: "marca"; marca_id: string; marca_nome: string };
  sugestoes: SugestaoDoContexto[];
  memoria: { titulo: string; previa: string; caracteres: number };
  exportado: { em: string; aplicadas: Aplicada[]; memoria_id: string | null } | null;
};
