/**
 * Motor de modelos da Mesa do cliente (docs/mesa-do-cliente/SPEC.md, secao 3).
 *
 * Unico lugar do painel que fala com provedores de IA para a Mesa. Toda
 * chamada segue a mesma ordem, sem atalho:
 *   1. le o modelo no catalogo (ia_modelos) com o cliente de servico
 *      (desligado ou indisponivel no provedor: erro);
 *   2. resolve a chave (SPEC 2.1): a chave propria do cliente para aquele
 *      provedor, pela RPC backend ia_chave_resolver; sem ela, a da agencia
 *      (ambiente) quando ia_clientes_config.usar_chave_agencia e verdadeiro ou
 *      nao ha linha; senao erro cliente_sem_chave. Agencia sem chave no
 *      ambiente: erro provedor_sem_chave.
 *      Rota de reserva (decisao do dono, 2026-09-22): se o modelo pedido e do
 *      OpenRouter e nao ha chave do OpenRouter (nem do cliente, nem da
 *      agencia), o motor usa o equivalente direto do catalogo quando existe
 *      ("openrouter:openai/gpt-6-sol" vira a linha openai com modelo_api
 *      "gpt-6-sol"; "openrouter:anthropic/claude-opus-5.5" vira a linha
 *      anthropic "claude-opus-5-5"), com os precos e a chave desse provedor.
 *      So quando nem o equivalente tem chave o erro original sobe
 *      (provedor_sem_chave ou cliente_sem_chave). O uso fica registrado no
 *      modelo que de fato respondeu.
 *      Reserva por credito: se o OpenRouter responder 402 (sem credito) ou
 *      401 (chave recusada), o motor tenta o equivalente direto com chave na
 *      mesma chamada (conferindo de novo cota e saldo) e devolve o aviso
 *      reservaUsada = "openrouter_sem_credito"; sem equivalente, erro
 *      openrouter_sem_credito (402) pedindo recarga. O registro do uso
 *      acontece uma vez so, depois da chamada que deu certo: sem cobranca
 *      dupla;
 *   3. estima o custo pela tabela; com chave do cliente, confere a cota do mes
 *      (gasto_mes_usd + estimativa <= cota_mensal_usd, senao erro
 *      cota_da_chave_esgotada); depois confere a carteira do cliente
 *      (saldo menor que a estimativa: erro saldo_insuficiente com o que falta);
 *   4. chama o provedor com tempo limite (texto 120 s, imagem 150 s);
 *   5. calcula o custo real (o do provedor quando ele informa; senao tokens
 *      vezes a tabela; imagem vezes preco_imagem[qualidade]) e grava o uso
 *      pela RPC ia_registrar_uso (com chave_origem e chave_id), que debita a
 *      carteira.
 *
 * Provedores:
 * - openai: Responses API para texto (web_search, reasoning.effort e
 *   text.format json_schema) e Images API para imagem (generations sem
 *   referencia; edits em multipart com varias imagens de referencia e mascara).
 * - anthropic: Messages API (pensamento adaptativo com output_config.effort,
 *   web_search de servidor e saida em json_schema).
 * - openrouter: Chat Completions para texto. Imagem: GPT Image e todo modelo
 *   so de imagem (Seedream, FLUX.2, MAI, Riverflow, Qwen, Grok, Krea) pela API
 *   de imagens (POST /api/v1/images), com proporcao, resolucao (1K, 2K, 4K),
 *   qualidade, semente e fundo so quando o modelo aceita; Gemini segue no chat
 *   (modalities image+text), com image_size quando a resolucao e pedida.
 *   Referencias cortadas no limite de cada modelo (capacidades-imagem.ts), com
 *   aviso. O custo vem em usage.cost.
 *
 * Catalogo: listarCatalogoOpenRouter le a lista publica do OpenRouter (chat
 * e imagens, com preco e capacidades de cada endpoint) e converte para linhas
 * de ia_modelos (usada pela acao sincronizar_catalogo do ia-gateway, que roda
 * todo dia).
 *
 * Privacidade: nunca registrar chave (nem o segredo do Vault) nem prompt em
 * log. Os logs daqui levam so codigo de erro, status e ids.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  capacidadesDaListaDeImagens,
  type CapacidadesImagem,
  capacidadesDoModelo,
  type EndpointDeImagemOpenRouter,
  type ModeloDeImagemOpenRouter,
  OPENROUTER_IMAGENS_URL,
  precoDasEntradas,
  precoImagemDoEndpoint,
  precoPorImagem,
  precosDoEndpoint,
  proporcaoEntre,
  qualidadeParaModelo,
  referenciasNoLimite,
  type Resolucao,
  resolucaoParaModelo,
  urlDosEndpointsDeImagem,
} from "./capacidades-imagem.ts";

export {
  aceitaResolucao,
  type CapacidadesImagem,
  capacidadesDoModelo,
  lerResolucao,
  limiteDeReferencias,
  precoPorImagem,
  type Resolucao,
  RESOLUCOES,
} from "./capacidades-imagem.ts";

export type Provedor = "openai" | "anthropic" | "openrouter";
export type TipoModelo = "texto" | "imagem";
export type Qualidade = "baixa" | "media" | "alta";
export type Tarefa = "calendario" | "estudio" | "conversa" | "leitura_referencia" | "verificacao" | "contexto" | "ads";
export type Agente = "estrategista" | "diretor_arte" | "gerador_imagem" | "leitor" | "jev" | "contexto" | "estrategista_ads";

export type ModeloIa = {
  id: string;
  provedor: Provedor;
  modelo_api: string;
  tipo: TipoModelo;
  rotulo: string | null;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
  preco_cache_1m: number | null;
  /** {"baixa","media","alta"} por imagem 1024x1536; opcional "entrada_imagem_1m" para token de imagem de entrada. */
  preco_imagem: Record<string, number> | null;
  raciocinio: string[] | null;
  padrao_para: string[] | null;
  ativo: boolean;
  fonte_preco: string | null;
  conferido_em: string | null;
  /** Entrou pela sincronizacao e o dono ainda nao revisou. */
  novo?: boolean;
  /** O provedor ainda oferece o modelo. */
  disponivel?: boolean;
  contexto_tokens?: number | null;
  modalidades?: { entrada?: string[]; saida?: string[] } | null;
  /**
   * Modelos de imagem: referências máximas, resoluções, proporções, qualidade,
   * semente, fundo transparente e a API do OpenRouter (capacidades-imagem.ts).
   * Coluna nova (docs/mesa-foto/migrations/03_modelos_canvas.sql); sem ela
   * valem as famílias conhecidas.
   */
  capacidades?: CapacidadesImagem | null;
};

export type ImagemEntrada = { bytes: Uint8Array; mime: string; nome?: string };
export type MensagemMotor = { papel: "usuario" | "agente"; conteudo: string; imagens?: ImagemEntrada[] };
export type EsquemaJson = { nome?: string; schema: Record<string, unknown> } | Record<string, unknown>;
export type ReferenciaUso = { tipo: string; id: string };

export type EntradaTexto = {
  clientId: string;
  tarefa: Tarefa;
  agente: Agente;
  modeloId: string;
  sistema: string;
  mensagens: MensagemMotor[];
  raciocinio?: string;
  pesquisaWeb?: boolean;
  esquemaJson?: EsquemaJson;
  referencia?: ReferenciaUso;
  criadoPor?: string | null;
  maxTokensSaida?: number;
  /**
   * Tempo limite da chamada ao provedor (padrão TIMEOUT_TEXTO_MS). Tarefas longas
   * (planejar o mês com raciocínio alto) pedem mais; a função precisa responder
   * com fôlego (resposta-com-folego.ts) para a plataforma não cortar em 150 s.
   */
  timeoutMs?: number;
};

export type SaidaTexto = {
  texto: string;
  json?: unknown;
  usoId: string;
  custoUsd: number;
  saldoUsd: number;
  modeloId: string;
  /** Aviso para a tela quando o motor atendeu por outro caminho (a funcao de borda devolve como reserva_usada). */
  reservaUsada?: ReservaUsada;
};

export type EntradaImagem = {
  clientId: string;
  modeloId: string;
  prompt: string;
  referencias: ImagemEntrada[];
  qualidade: Qualidade;
  tamanho: "1024x1536" | "1088x1360" | string;
  /** Prompt a usar se o provedor recusar o 4:5 e a arte sair em 2:3 (quadro 4:5 no centro). */
  promptSe2x3?: string;
  /** Sem reserva em 2:3: a tela dupla do carrossel contínuo só serve no tamanho pedido. */
  tamanhoFixo?: boolean;
  editar?: { bytes: Uint8Array; mascara?: Uint8Array };
  /**
   * Fundo transparente (Mesa Foto): vai como `background: "transparent"` no
   * GPT Image (OpenAI direto e API de imagens do OpenRouter). Modelo que não
   * aceita (Gemini pelo chat do OpenRouter) recusa antes de cobrar, com
   * entrada_invalida e motivo fundo_transparente_nao_suportado: nunca cai
   * calado para fundo opaco.
   */
  fundo?: "transparente";
  /**
   * Resolução pedida (Mesa Foto: 1K, 2K, 4K). Vai ao provedor só quando o
   * modelo aceita (capacidades.resolucoes); aceita outra: a mais perto abaixo,
   * com aviso em SaidaImagem.avisos. Sem ela, o corpo sai como antes.
   */
  resolucao?: Resolucao | null;
  /** Semente (reprodutibilidade), só nos modelos que aceitam. */
  seed?: number | null;
  /**
   * Só o mesmo modelo (ou o equivalente dele em outra conta) pode atender:
   * sem a reserva por "gerador da mesma família" ou "qualquer gerador ativo".
   * O panorama do carrossel contínuo precisa do tamanho em pixels do GPT
   * Image; outro gerador devolveria outra proporção e o corte daria zoom.
   */
  mesmoModelo?: boolean;
  referencia?: ReferenciaUso;
  criadoPor?: string | null;
  tarefa?: Tarefa;
  agente?: Agente;
};

export type SaidaImagem = {
  /** Bytes como o provedor devolveu (PNG, JPEG ou WebP: ver mime). */
  png: Uint8Array;
  mime: string;
  /** Tamanho em que a arte saiu de fato (4:5 pedido ou 2:3 de reserva). */
  tamanho: string;
  usoId: string;
  custoUsd: number;
  saldoUsd: number;
  modeloId: string;
  /** Aviso para a tela quando o motor atendeu por outro caminho (a funcao de borda devolve como reserva_usada). */
  reservaUsada?: ReservaUsada;
  /** Resolução que foi ao provedor (null quando o modelo não escolhe). */
  resolucao?: Resolucao | null;
  /** Imagens de entrada que foram de fato (depois do limite do modelo). */
  referenciasEnviadas?: number;
  /** Referências cortadas pelo limite, resolução ajustada e afins. */
  avisos?: string[];
};

export type EntradaEstimativa = {
  modeloId: string;
  tipo: TipoModelo;
  tokensEntrada?: number;
  tokensSaida?: number;
  imagens?: number;
  qualidade?: Qualidade;
  buscasWeb?: number;
  /** Imagem: resolução pedida (preço por variante) e imagens de entrada (preço por referência). */
  resolucao?: Resolucao | null;
  imagensEntrada?: number;
  tamanho?: string | null;
};

export type CodigoErroMotor =
  | "saldo_insuficiente"
  | "provedor_sem_chave"
  | "cliente_sem_chave"
  | "cota_da_chave_esgotada"
  | "chave_indisponivel"
  | "modelo_inexistente"
  | "modelo_inativo"
  | "modelo_indisponivel"
  | "modelo_tipo_errado"
  | "raciocinio_nao_aceito"
  | "provedor_sem_imagem"
  | "provedor_erro"
  | "provedor_timeout"
  | "provedor_recusou"
  | "openrouter_sem_credito"
  | "provedor_sem_credito"
  | "resposta_vazia"
  | "json_invalido"
  | "uso_nao_registrado"
  | "entrada_invalida";

const STATUS_POR_CODIGO: Record<CodigoErroMotor, number> = {
  saldo_insuficiente: 402,
  provedor_sem_chave: 503,
  cliente_sem_chave: 403,
  cota_da_chave_esgotada: 402,
  chave_indisponivel: 503,
  modelo_inexistente: 404,
  modelo_inativo: 409,
  modelo_indisponivel: 410,
  modelo_tipo_errado: 400,
  raciocinio_nao_aceito: 400,
  provedor_sem_imagem: 400,
  provedor_erro: 502,
  provedor_timeout: 504,
  provedor_recusou: 422,
  openrouter_sem_credito: 402,
  provedor_sem_credito: 402,
  resposta_vazia: 502,
  json_invalido: 502,
  uso_nao_registrado: 500,
  entrada_invalida: 400,
};

export class IaMotorErro extends Error {
  codigo: CodigoErroMotor;
  status: number;
  detalhes: Record<string, unknown>;
  constructor(codigo: CodigoErroMotor, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "IaMotorErro";
    this.codigo = codigo;
    this.status = STATUS_POR_CODIGO[codigo];
    this.detalhes = detalhes;
  }
  paraJson() {
    return { error: this.codigo, mensagem: this.message, ...this.detalhes };
  }
}

// Tempos limite de toda chamada externa.
export const TIMEOUT_TEXTO_MS = 120_000;
// Imagem: 280 s. O panorama do carrossel contínuo (3264 x 1360) levou 136 s na
// qualidade baixa; nas maiores passaria de 150 s. A função tem 400 s no plano Pro e
// faz uma imagem por chamada (preparar_fundo e gerar_card são chamadas separadas).
export const TIMEOUT_IMAGEM_MS = 280_000;
export const TIMEOUT_LISTA_MS = 30_000;

// Busca na web cobrada por chamada, fora dos tokens (US$ 10 por mil nos dois).
// OpenAI: https://platform.openai.com/docs/pricing (ferramentas). Anthropic:
// https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool
export const CUSTO_BUSCA_WEB_USD: Record<Provedor, number> = { openai: 0.01, anthropic: 0.01, openrouter: 0 };

const QUALIDADE_OPENAI: Record<Qualidade, string> = { baixa: "low", media: "medium", alta: "high" };

// Saida estimada por nivel de raciocinio (so para a checagem previa).
const SAIDA_ESTIMADA: Record<string, number> = {
  none: 3_000, minimal: 3_000, low: 4_000, medium: 8_000, high: 16_000, xhigh: 24_000, max: 32_000,
};
const TOKENS_POR_IMAGEM_ENTRADA = 1_600;
const TOKENS_BUSCA_WEB_ESTIMADOS = 10_000;
const BUSCAS_ESTIMADAS = 3;

const ENV_CHAVE: Record<Provedor, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

let servico: SupabaseClient | null = null;
function clienteServico(): SupabaseClient {
  if (!servico) {
    servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servico;
}

/** A chave da agencia para cada provedor vem so do ambiente do servidor. */
export function chaveDoProvedor(provedor: Provedor): string {
  const chave = Deno.env.get(ENV_CHAVE[provedor])?.trim();
  if (!chave) {
    throw new IaMotorErro("provedor_sem_chave", `O provedor ${provedor} ainda nao tem chave configurada.`, { provedor });
  }
  return chave;
}

export type ChaveResolvida = {
  /** Segredo em memoria so durante a chamada. Nunca logar nem devolver. */
  segredo: string;
  origem: "cliente" | "agencia";
  chaveId: string | null;
  cotaMensalUsd: number | null;
  gastoMesUsd: number;
};

/**
 * Resolve a chave de uma chamada (SPEC 2.1). Ordem: chave ativa do cliente
 * (RPC so backend ia_chave_resolver, segredo lido do Vault); sem ela, a da
 * agencia se o cliente permitir (ou nao tiver configuracao); senao bloqueia.
 */
export async function resolverChave(clientId: string, provedor: Provedor): Promise<ChaveResolvida> {
  const servicoDb = clienteServico();
  const { data, error } = await servicoDb.rpc("ia_chave_resolver", { _client_id: clientId, _provedor: provedor });
  if (error) {
    throw new IaMotorErro("chave_indisponivel", "Nao foi possivel resolver a chave de IA do cliente.", { provedor, erro_banco: error.code ?? null });
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    | { chave_id?: string | null; segredo?: string | null; cota_mensal_usd?: unknown; gasto_mes_usd?: unknown }
    | null
    | undefined;
  const segredo = typeof linha?.segredo === "string" ? linha.segredo.trim() : "";
  if (segredo) {
    return {
      segredo,
      origem: "cliente",
      chaveId: linha?.chave_id ? String(linha.chave_id) : null,
      cotaMensalUsd: linha?.cota_mensal_usd == null ? null : num(linha.cota_mensal_usd),
      gastoMesUsd: num(linha?.gasto_mes_usd),
    };
  }

  const { data: config, error: erroConfig } = await servicoDb
    .from("ia_clientes_config")
    .select("usar_chave_agencia")
    .eq("client_id", clientId)
    .maybeSingle();
  if (erroConfig) {
    throw new IaMotorErro("chave_indisponivel", "Nao foi possivel ler a configuracao de IA do cliente.", { provedor });
  }
  // Sem linha de configuracao vale o padrao: usar a chave da agencia.
  const usarAgencia = (config as { usar_chave_agencia?: boolean } | null)?.usar_chave_agencia !== false;
  if (!usarAgencia) {
    throw new IaMotorErro("cliente_sem_chave", `O cliente nao tem chave propria de ${provedor} e nao usa a chave da agencia.`, { provedor });
  }
  return { segredo: chaveDoProvedor(provedor), origem: "agencia", chaveId: null, cotaMensalUsd: null, gastoMesUsd: 0 };
}

/** Com chave do cliente, a cota do mes precisa cobrir a estimativa. */
export function garantirCota(chave: ChaveResolvida, estimativaUsd: number) {
  if (chave.origem !== "cliente" || chave.cotaMensalUsd == null) return;
  if (chave.gastoMesUsd + estimativaUsd > chave.cotaMensalUsd) {
    throw new IaMotorErro("cota_da_chave_esgotada", "A cota do mes da chave de IA do cliente acabou.", {
      chave_id: chave.chaveId,
      cota_mensal_usd: arred(chave.cotaMensalUsd),
      gasto_mes_usd: arred(chave.gastoMesUsd),
      estimativa_usd: arred(estimativaUsd),
    });
  }
}

/**
 * Equivalente direto de um modelo do OpenRouter, pelo slug "dono/modelo".
 * So OpenAI e Anthropic tem conta direta; a Anthropic usa hifen onde o
 * OpenRouter usa ponto (claude-opus-5.5 no OpenRouter e claude-opus-5-5 na API).
 */
export function equivalenteDireto(m: Pick<ModeloIa, "provedor" | "modelo_api">): { provedor: Provedor; modeloApi: string } | null {
  if (m.provedor !== "openrouter") return null;
  const barra = m.modelo_api.indexOf("/");
  if (barra <= 0) return null;
  const dono = m.modelo_api.slice(0, barra);
  const nome = m.modelo_api.slice(barra + 1).split(":")[0];
  if (!nome) return null;
  if (dono === "openai") return { provedor: "openai", modeloApi: nome };
  if (dono === "anthropic") return { provedor: "anthropic", modeloApi: nome.replace(/\./g, "-") };
  return null;
}

export type ReservaUsada = "openrouter_sem_chave" | "openrouter_sem_credito" | "direto_sem_credito";

/**
 * Equivalente direto com chave, para a rota de reserva. A linha direta nao
 * precisa estar ativa (e o mesmo modelo que o dono escolheu), mas precisa
 * existir no catalogo com preco e estar disponivel. Sem equivalente ou sem
 * chave para ele: null.
 */
export async function rotaDireta(clientId: string, pedido: ModeloIa): Promise<{ m: ModeloIa; chave: ChaveResolvida } | null> {
  const eq = equivalenteDireto(pedido);
  if (!eq) return null;
  const { data } = await clienteServico()
    .from("ia_modelos")
    .select("*")
    .eq("provedor", eq.provedor)
    .eq("modelo_api", eq.modeloApi)
    .eq("tipo", pedido.tipo)
    .neq("disponivel", false)
    .limit(1);
  const direto = ((data ?? [])[0] as ModeloIa | undefined) ?? null;
  if (!direto) return null;
  try {
    return { m: direto, chave: await resolverChave(clientId, direto.provedor) };
  } catch {
    return null;
  }
}

/**
 * Modelo e chave de uma chamada. Sem chave do OpenRouter (nem do cliente,
 * nem da agencia), cai no equivalente direto; sem ele, sobe o erro original.
 */
export async function resolverRota(
  clientId: string,
  pedido: ModeloIa,
): Promise<{ m: ModeloIa; chave: ChaveResolvida; reserva?: ReservaUsada }> {
  try {
    return { m: pedido, chave: await resolverChave(clientId, pedido.provedor) };
  } catch (err) {
    const semChave = err instanceof IaMotorErro && (err.codigo === "provedor_sem_chave" || err.codigo === "cliente_sem_chave");
    if (!semChave || pedido.provedor !== "openrouter") throw err;
    const direta = await rotaDireta(clientId, pedido);
    // Nem o equivalente tem chave: vale o erro do modelo pedido.
    if (!direta) throw err;
    return { ...direta, reserva: "openrouter_sem_chave" };
  }
}

/**
 * Caminho inverso: a conta DIRETA do provedor (OpenAI, Anthropic) ficou sem
 * credito. A agencia paga pelo OpenRouter (dono, 23/09): o motor procura o
 * mesmo modelo no OpenRouter; sem ele, e for imagem, o gerador de imagem da
 * mesma familia no OpenRouter (o mais barato disponivel); sem isso, qualquer
 * gerador de imagem ativo no OpenRouter. Precisa da chave do OpenRouter.
 */
export async function rotaOpenRouter(clientId: string, pedido: ModeloIa, soOMesmo = false): Promise<{ m: ModeloIa; chave: ChaveResolvida } | null> {
  if (pedido.provedor === "openrouter") return null;
  const db = clienteServico();
  const base = () => db.from("ia_modelos").select("*").eq("provedor", "openrouter").eq("tipo", pedido.tipo).neq("disponivel", false);
  let achado: ModeloIa | null = null;
  const { data: igual } = await base().eq("modelo_api", `${pedido.provedor}/${pedido.modelo_api}`).limit(1);
  achado = ((igual ?? [])[0] as ModeloIa | undefined) ?? null;
  if (!achado && pedido.tipo === "imagem" && !soOMesmo) {
    const { data: familia } = await base().like("modelo_api", `${pedido.provedor}/%`).limit(20);
    const { data: ativos } = await base().eq("ativo", true).limit(20);
    const preco = (m: ModeloIa) => num((m.preco_imagem as Record<string, unknown> | null)?.media) || 999;
    const lista = [...((familia ?? []) as ModeloIa[]), ...((ativos ?? []) as ModeloIa[])];
    const daFamilia = ((familia ?? []) as ModeloIa[]).sort((a, b) => preco(a) - preco(b));
    achado = daFamilia[0] ?? lista.sort((a, b) => preco(a) - preco(b))[0] ?? null;
  }
  if (!achado) return null;
  try {
    return { m: achado, chave: await resolverChave(clientId, "openrouter") };
  } catch {
    return null;
  }
}

/** A conta direta (nao OpenRouter) recusou por falta de credito. */
export function ehDiretoSemCredito(err: unknown, m: ModeloIa): boolean {
  return m.provedor !== "openrouter" && err instanceof IaMotorErro && err.codigo === "provedor_sem_credito";
}

/** O OpenRouter recusou por falta de credito (402) ou chave invalida (401). */
export function ehOpenRouterSemCredito(err: unknown, m: ModeloIa): boolean {
  if (m.provedor !== "openrouter" || !(err instanceof IaMotorErro) || err.codigo !== "provedor_erro") return false;
  const status = Number(err.detalhes.status_provedor);
  return status === 402 || status === 401;
}

function erroOpenRouterSemCredito(err: IaMotorErro, pedido: ModeloIa): IaMotorErro {
  return new IaMotorErro(
    "openrouter_sem_credito",
    "O OpenRouter recusou a chamada por falta de credito ou chave invalida, e este modelo nao tem equivalente direto com chave. Recarregue em https://openrouter.ai/settings/credits ou confira a chave do OpenRouter.",
    { modelo_id: pedido.id, status_provedor: err.detalhes.status_provedor ?? null },
  );
}

/**
 * Chama o provedor pela rota escolhida. Se o OpenRouter responder 402 ou 401,
 * tenta na mesma chamada o equivalente direto com chave, conferindo de novo
 * cota e saldo pela estimativa do modelo direto. Nenhum uso e registrado aqui:
 * quem chama registra uma vez so, no modelo que de fato atendeu, depois do
 * sucesso. Assim nao ha cobranca dupla.
 */
async function comReservaOpenRouter<R>(
  clientId: string,
  rota: { m: ModeloIa; chave: ChaveResolvida; reserva?: ReservaUsada },
  estimativaPara: (m: ModeloIa) => number,
  despachar: (m: ModeloIa, segredo: string) => Promise<R>,
  soOMesmo = false,
): Promise<{ r: R; m: ModeloIa; chave: ChaveResolvida; reserva?: ReservaUsada }> {
  try {
    return { r: await despachar(rota.m, rota.chave.segredo), m: rota.m, chave: rota.chave, reserva: rota.reserva };
  } catch (err) {
    // Conta direta sem credito: a mesma chamada vai pelo OpenRouter.
    if (ehDiretoSemCredito(err, rota.m)) {
      const viaOpenRouter = await rotaOpenRouter(clientId, rota.m, soOMesmo);
      if (!viaOpenRouter) throw err;
      const estimativa = estimativaPara(viaOpenRouter.m);
      garantirCota(viaOpenRouter.chave, estimativa);
      await garantirSaldo(clientId, estimativa);
      return {
        r: await despachar(viaOpenRouter.m, viaOpenRouter.chave.segredo),
        m: viaOpenRouter.m,
        chave: viaOpenRouter.chave,
        reserva: "direto_sem_credito",
      };
    }
    if (!ehOpenRouterSemCredito(err, rota.m)) throw err;
    const direta = await rotaDireta(clientId, rota.m);
    if (!direta) throw erroOpenRouterSemCredito(err as IaMotorErro, rota.m);
    const estimativa = estimativaPara(direta.m);
    garantirCota(direta.chave, estimativa);
    await garantirSaldo(clientId, estimativa);
    return { r: await despachar(direta.m, direta.chave.segredo), m: direta.m, chave: direta.chave, reserva: "openrouter_sem_credito" };
  }
}

// ---------------------------------------------------------------- utilidades

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};
const arred = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

export function paraBase64(bytes: Uint8Array): string {
  let s = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(s);
}

export function deBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Copia para um ArrayBuffer proprio (o Blob nao aceita buffer compartilhado).
const paraBlob = (bytes: Uint8Array, mime: string) => new Blob([new Uint8Array(bytes)], { type: mime });
const dataUrl = (img: ImagemEntrada) => `data:${img.mime};base64,${paraBase64(img.bytes)}`;

/**
 * Toda chamada externa passa por aqui: nao existe fetch sem tempo limite.
 */
async function buscar(provedor: Provedor, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const nome = err instanceof Error ? err.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new IaMotorErro("provedor_timeout", `O provedor ${provedor} nao respondeu em ${Math.round(timeoutMs / 1000)} s.`, { provedor });
    }
    throw new IaMotorErro("provedor_erro", `Falha de rede ao chamar ${provedor}.`, { provedor });
  }
  if (!res.ok) {
    // A mensagem do provedor vai no erro (nao no log) e cortada.
    let msg = "";
    try {
      const corpo = await res.json() as { error?: { message?: string } | string; message?: string };
      msg = typeof corpo.error === "string" ? corpo.error : corpo.error?.message || corpo.message || "";
    } catch { /* corpo sem JSON */ }
    // Conta do provedor sem crédito (a da agência ou a do cliente): mensagem clara, não o texto cru.
    if ((res.status === 429 || res.status === 402) && /credit|quota|billing|insufficient|saldo/i.test(String(msg))) {
      const onde = provedor === "openai" ? " em platform.openai.com, Billing" : provedor === "anthropic" ? " em console.anthropic.com, Billing" : "";
      throw new IaMotorErro("provedor_sem_credito", `A conta da ${provedor} que paga este modelo está sem crédito. Recarregue${onde} ou escolha outro modelo no seletor (por exemplo, o Nano Banana).`, {
        provedor,
        status_provedor: res.status,
      });
    }
    throw new IaMotorErro("provedor_erro", `${provedor} respondeu ${res.status}${msg ? `: ${String(msg).slice(0, 300)}` : ""}`, {
      provedor,
      status_provedor: res.status,
    });
  }
  // O corpo também corre contra o mesmo tempo limite: lido aqui, o estouro vira
  // provedor_timeout (antes escapava como TimeoutError e virava "falha inesperada").
  try {
    const corpo = await res.arrayBuffer();
    return new Response(corpo, { status: res.status, headers: res.headers });
  } catch (err) {
    const nome = err instanceof Error ? err.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") {
      throw new IaMotorErro("provedor_timeout", `O provedor ${provedor} nao terminou a resposta em ${Math.round(timeoutMs / 1000)} s.`, { provedor });
    }
    throw new IaMotorErro("provedor_erro", `Falha de rede ao ler a resposta de ${provedor}.`, { provedor });
  }
}

function nomeEsquema(e: EsquemaJson): { nome: string; schema: Record<string, unknown> } {
  const talvez = e as { nome?: string; schema?: unknown };
  if (talvez.schema && typeof talvez.schema === "object") {
    return { nome: (talvez.nome || "resposta").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: talvez.schema as Record<string, unknown> };
  }
  return { nome: "resposta", schema: e as Record<string, unknown> };
}

function lerJson(texto: string): unknown {
  const limpo = texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const ini = limpo.search(/[[{]/);
    const fim = Math.max(limpo.lastIndexOf("}"), limpo.lastIndexOf("]"));
    if (ini >= 0 && fim > ini) {
      try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch { /* cai no erro abaixo */ }
    }
    throw new IaMotorErro("json_invalido", "O modelo nao devolveu JSON valido.");
  }
}

// ------------------------------------------------------------------ catalogo

export async function carregarModelo(modeloId: string, tipo?: TipoModelo): Promise<ModeloIa> {
  const { data, error } = await clienteServico().from("ia_modelos").select("*").eq("id", modeloId).maybeSingle();
  if (error) throw new IaMotorErro("modelo_inexistente", `Catalogo indisponivel: ${error.message}`, { modelo_id: modeloId });
  if (!data) throw new IaMotorErro("modelo_inexistente", `Modelo ${modeloId} nao esta no catalogo.`, { modelo_id: modeloId });
  const m = data as ModeloIa;
  if (!m.ativo) throw new IaMotorErro("modelo_inativo", `Modelo ${modeloId} esta desligado no catalogo.`, { modelo_id: modeloId });
  if (m.disponivel === false) {
    throw new IaMotorErro("modelo_indisponivel", `O provedor nao oferece mais o modelo ${modeloId}.`, { modelo_id: modeloId });
  }
  if (tipo && m.tipo !== tipo) {
    throw new IaMotorErro("modelo_tipo_errado", `Modelo ${modeloId} e de ${m.tipo}, nao de ${tipo}.`, { modelo_id: modeloId });
  }
  return m;
}

/** Modelo padrao de um papel (estrategista, diretor_arte, imagem, leitura). */
export async function modeloPadrao(papel: string): Promise<ModeloIa | null> {
  const { data } = await clienteServico().from("ia_modelos").select("*").eq("ativo", true).contains("padrao_para", [papel]).limit(1);
  return ((data ?? [])[0] as ModeloIa | undefined) ?? null;
}

type UsoTokens = {
  entrada: number;
  saida: number;
  cache: number;
  /** Parte da entrada que e imagem (so modelos de imagem). */
  entradaImagem?: number;
  imagens?: number;
  qualidade?: Qualidade;
  buscasWeb?: number;
  /** Imagem: resolução que foi ao provedor e quantas imagens de entrada. */
  resolucao?: Resolucao | null;
  imagensEntrada?: number;
};

/**
 * Custo pela tabela do catalogo. Entrada em cache paga preco_cache_1m (ou o
 * preco cheio quando o catalogo nao tem preco de cache). Imagem paga o preco
 * por imagem da qualidade, a menos que o provedor informe tokens de saida e o
 * catalogo tenha preco de saida por token.
 */
export function custoPelaTabela(m: ModeloIa, u: UsoTokens): number {
  const pe = num(m.preco_entrada_1m);
  const ps = num(m.preco_saida_1m);
  const pc = m.preco_cache_1m == null ? pe : num(m.preco_cache_1m);
  const busca = num(u.buscasWeb) * CUSTO_BUSCA_WEB_USD[m.provedor];
  if (m.tipo === "imagem") {
    const pImgEntrada = m.preco_imagem && m.preco_imagem.entrada_imagem_1m != null ? num(m.preco_imagem.entrada_imagem_1m) : pe;
    const entradaImagem = Math.min(num(u.entradaImagem), num(u.entrada));
    const entradaTexto = num(u.entrada) - entradaImagem;
    const custoEntrada = (entradaTexto * pe + entradaImagem * pImgEntrada) / 1_000_000;
    // Modelo cobrado por imagem de entrada (Seedream, Qwen, Grok): soma por referência.
    const entradasPorImagem = precoDasEntradas(m, num(u.imagensEntrada));
    if (num(u.saida) > 0 && ps > 0) return arred(custoEntrada + entradasPorImagem + (num(u.saida) * ps) / 1_000_000);
    // Com resolução, o preço da variante (res_2K, por megapixel ou por token); sem ela, o da qualidade.
    const porImagem = u.resolucao ? precoPorImagem(m, u.qualidade ?? "media", u.resolucao) : num(m.preco_imagem?.[u.qualidade ?? "media"]);
    return arred(custoEntrada + entradasPorImagem + num(u.imagens ?? 1) * porImagem);
  }
  const cache = Math.min(num(u.cache), num(u.entrada));
  return arred(((num(u.entrada) - cache) * pe + cache * pc + num(u.saida) * ps) / 1_000_000 + busca);
}

/** Estimativa pela tabela do catalogo, sem chamar provedor. */
export async function estimar(e: EntradaEstimativa): Promise<number> {
  const m = await carregarModelo(e.modeloId, e.tipo);
  return estimarComModelo(m, e);
}

export function estimarComModelo(m: ModeloIa, e: Omit<EntradaEstimativa, "modeloId" | "tipo">): number {
  if (m.tipo === "imagem") {
    // Resolução pedida: preço da variante (1K, 2K, 4K, megapixel ou token); sem ela, o da qualidade, como antes.
    const porImagem = e.resolucao || m.preco_imagem?.por_megapixel != null
      ? precoPorImagem(m, e.qualidade ?? "media", e.resolucao ?? null, e.tamanho ?? null)
      : num(m.preco_imagem?.[e.qualidade ?? "media"]);
    const pImgEntrada = m.preco_imagem && m.preco_imagem.entrada_imagem_1m != null ? num(m.preco_imagem.entrada_imagem_1m) : num(m.preco_entrada_1m);
    // Na estimativa toda a entrada e cobrada como imagem: fica do lado seguro.
    return arred(num(e.imagens ?? 1) * porImagem + (num(e.tokensEntrada) * pImgEntrada) / 1_000_000 + precoDasEntradas(m, num(e.imagensEntrada)));
  }
  return custoPelaTabela(m, { entrada: num(e.tokensEntrada), saida: num(e.tokensSaida), cache: 0, buscasWeb: num(e.buscasWeb) });
}

// ------------------------------------------------------------------ carteira

export async function lerSaldo(clientId: string): Promise<number> {
  const { data, error } = await clienteServico().from("ia_carteiras").select("saldo_usd").eq("client_id", clientId).maybeSingle();
  if (error) throw new IaMotorErro("entrada_invalida", `Carteira indisponivel: ${error.message}`);
  return num((data as { saldo_usd?: unknown } | null)?.saldo_usd);
}

/** Saldo precisa cobrir a estimativa antes de qualquer chamada paga. */
export async function garantirSaldo(clientId: string, estimativaUsd: number): Promise<number> {
  const saldo = await lerSaldo(clientId);
  if (saldo < estimativaUsd) {
    const falta = arred(estimativaUsd - saldo);
    throw new IaMotorErro("saldo_insuficiente", `Saldo insuficiente na carteira de IA do cliente: faltam US$ ${falta.toFixed(4)}.`, {
      saldo_usd: arred(saldo),
      estimativa_usd: arred(estimativaUsd),
      falta_usd: falta,
    });
  }
  return saldo;
}

type RegistroUso = {
  clientId: string;
  tarefa: Tarefa;
  agente: Agente;
  modelo: ModeloIa;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCache: number;
  imagens: number;
  qualidade: Qualidade | null;
  custoUsd: number;
  custoFonte: "provedor" | "tabela";
  referencia?: ReferenciaUso;
  criadoPor?: string | null;
  chave: ChaveResolvida;
};

/** Grava o uso e debita a carteira pela RPC (so backend). Tenta duas vezes. */
export async function registrarUso(r: RegistroUso): Promise<{ usoId: string; saldoUsd: number }> {
  const params = {
    _client_id: r.clientId,
    _tarefa: r.tarefa,
    _agente: r.agente,
    _modelo_id: r.modelo.id,
    _provedor: r.modelo.provedor,
    _tokens_entrada: Math.round(r.tokensEntrada),
    _tokens_saida: Math.round(r.tokensSaida),
    _tokens_cache: Math.round(r.tokensCache),
    _imagens: r.imagens,
    _qualidade: r.qualidade,
    _custo_usd: arred(r.custoUsd),
    _custo_fonte: r.custoFonte,
    _referencia_tipo: r.referencia?.tipo ?? null,
    _referencia_id: r.referencia?.id ?? null,
    _criado_por: r.criadoPor ?? null,
    _chave_origem: r.chave.origem,
    _chave_id: r.chave.chaveId,
  };
  let ultimoErro = "";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data, error } = await clienteServico().rpc("ia_registrar_uso", params);
    if (!error) {
      const linha = (Array.isArray(data) ? data[0] : data) as { uso_id?: string; saldo_usd?: unknown } | null;
      return { usoId: String(linha?.uso_id ?? ""), saldoUsd: arred(num(linha?.saldo_usd)) };
    }
    ultimoErro = error.message;
  }
  // So ids e o codigo do banco; nada de prompt.
  console.error("ia-motor: ia_registrar_uso falhou", { modelo_id: r.modelo.id, client_id: r.clientId, erro: ultimoErro });
  throw new IaMotorErro("uso_nao_registrado", "A chamada foi feita, mas o uso nao foi registrado na carteira.", {
    custo_usd: arred(r.custoUsd),
  });
}

// ----------------------------------------------------------------------- jev

/** Jev 1.13: US$ 0,042 por milhao de tokens de entrada; saida gratis (docs.typesafe.ai/models). */
export const JEV_MODELO_ID = "typesafe:jev-latest";
export const JEV_PRECO_ENTRADA_1M = 0.042;

export function custoJev(tokensEntrada: number): number {
  return Math.max(0, Number(tokensEntrada) || 0) * JEV_PRECO_ENTRADA_1M / 1e6;
}

/**
 * Registra na carteira do cliente o que o Jev gastou numa resposta. A chave
 * do Jev e sempre a da agencia. Nao derruba quem chamou: o julgamento ja foi
 * feito e o valor e de fracao de centavo; se o registro falhar, fica no log.
 */
export async function cobrarJev(
  resultado: { usage: { input_tokens?: number; output_tokens?: number } | null; modelo?: string },
  c: { clientId: string; tarefa: Tarefa; referencia?: ReferenciaUso; criadoPor?: string | null },
): Promise<{ usoId: string; custoUsd: number } | null> {
  const entrada = Math.round(Number(resultado.usage?.input_tokens) || 0);
  const saida = Math.round(Number(resultado.usage?.output_tokens) || 0);
  const custo = arred(custoJev(entrada));
  const params = {
    _client_id: c.clientId,
    _tarefa: c.tarefa,
    _agente: "jev",
    _modelo_id: JEV_MODELO_ID,
    _provedor: "typesafe",
    _tokens_entrada: entrada,
    _tokens_saida: saida,
    _tokens_cache: 0,
    _imagens: 0,
    _qualidade: null,
    _custo_usd: custo,
    _custo_fonte: "tabela",
    _referencia_tipo: c.referencia?.tipo ?? null,
    _referencia_id: c.referencia?.id ?? null,
    _criado_por: c.criadoPor ?? null,
    _chave_origem: "agencia",
    _chave_id: null,
  };
  try {
    const { data, error } = await clienteServico().rpc("ia_registrar_uso", params);
    if (error) throw new Error(error.message);
    const linha = (Array.isArray(data) ? data[0] : data) as { uso_id?: string } | null;
    return { usoId: String(linha?.uso_id ?? ""), custoUsd: custo };
  } catch (err) {
    console.error("ia-motor: uso do jev nao registrado", {
      client_id: c.clientId,
      erro: err instanceof Error ? err.message : "desconhecido",
    });
    return null;
  }
}

// --------------------------------------------------------------------- texto

type RespostaProvedorTexto = {
  texto: string;
  entrada: number;
  saida: number;
  cache: number;
  buscasWeb: number;
  custoProvedor: number | null;
};

async function textoOpenAi(m: ModeloIa, chave: string, e: EntradaTexto): Promise<RespostaProvedorTexto> {
  const input = e.mensagens.map((msg) => {
    if (msg.papel === "agente") return { role: "assistant", content: msg.conteudo };
    if (!msg.imagens?.length) return { role: "user", content: msg.conteudo };
    return {
      role: "user",
      content: [
        { type: "input_text", text: msg.conteudo },
        ...msg.imagens.map((img) => ({ type: "input_image", image_url: dataUrl(img) })),
      ],
    };
  });
  const corpo: Record<string, unknown> = { model: m.modelo_api, instructions: e.sistema, input, store: false };
  if (e.raciocinio) corpo.reasoning = { effort: e.raciocinio };
  if (e.pesquisaWeb) corpo.tools = [{ type: "web_search" }];
  if (e.esquemaJson) {
    const { nome, schema } = nomeEsquema(e.esquemaJson);
    corpo.text = { format: { type: "json_schema", name: nome, schema, strict: true } };
  }
  if (e.maxTokensSaida) corpo.max_output_tokens = e.maxTokensSaida;

  const res = await buscar("openai", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  }, e.timeoutMs ?? TIMEOUT_TEXTO_MS);
  const data = await res.json() as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  let texto = "";
  let recusa = "";
  let buscas = 0;
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") buscas += 1;
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) texto += c.text;
      if (c.type === "refusal" && c.refusal) recusa = c.refusal;
    }
  }
  if (!texto && typeof data.output_text === "string") texto = data.output_text;
  if (!texto && recusa) throw new IaMotorErro("provedor_recusou", "O modelo recusou o pedido.", { provedor: "openai" });
  return {
    texto,
    entrada: num(data.usage?.input_tokens),
    saida: num(data.usage?.output_tokens),
    cache: num(data.usage?.input_tokens_details?.cached_tokens),
    buscasWeb: buscas,
    custoProvedor: null,
  };
}

async function textoAnthropic(m: ModeloIa, chave: string, e: EntradaTexto): Promise<RespostaProvedorTexto> {
  const messages = e.mensagens.map((msg) => {
    if (msg.papel === "agente") return { role: "assistant", content: msg.conteudo };
    if (!msg.imagens?.length) return { role: "user", content: msg.conteudo };
    return {
      role: "user",
      content: [
        ...msg.imagens.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mime, data: paraBase64(img.bytes) } })),
        { type: "text", text: msg.conteudo },
      ],
    };
  });
  const corpo: Record<string, unknown> = {
    model: m.modelo_api,
    max_tokens: e.maxTokensSaida ?? 16_000,
    system: e.sistema,
    messages,
  };
  const outputConfig: Record<string, unknown> = {};
  if (e.raciocinio) {
    corpo.thinking = { type: "adaptive" };
    outputConfig.effort = e.raciocinio;
  }
  if (e.esquemaJson) outputConfig.format = { type: "json_schema", schema: nomeEsquema(e.esquemaJson).schema };
  if (Object.keys(outputConfig).length) corpo.output_config = outputConfig;
  if (e.pesquisaWeb) corpo.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }];

  const res = await buscar("anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  }, e.timeoutMs ?? TIMEOUT_TEXTO_MS);
  const data = await res.json() as {
    stop_reason?: string;
    content?: Array<{ type?: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      server_tool_use?: { web_search_requests?: number };
    };
  };
  if (data.stop_reason === "refusal") throw new IaMotorErro("provedor_recusou", "O modelo recusou o pedido.", { provedor: "anthropic" });
  const texto = (data.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text).join("");
  const u = data.usage ?? {};
  // input_tokens da Anthropic nao inclui cache. O motor nao usa cache_control,
  // entao escrita de cache (1,25x) nao deve aparecer; se aparecer, entra como entrada cheia.
  const cache = num(u.cache_read_input_tokens);
  return {
    texto,
    entrada: num(u.input_tokens) + num(u.cache_creation_input_tokens) + cache,
    saida: num(u.output_tokens),
    cache,
    buscasWeb: num(u.server_tool_use?.web_search_requests),
    custoProvedor: null,
  };
}

function cabecalhosOpenRouter(chave: string) {
  return {
    "Authorization": `Bearer ${chave}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://aceleriq.online",
    "X-Title": "Aceleriq",
  };
}

type UsoOpenRouter = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

async function textoOpenRouter(m: ModeloIa, chave: string, e: EntradaTexto): Promise<RespostaProvedorTexto> {
  const messages: unknown[] = [{ role: "system", content: e.sistema }];
  for (const msg of e.mensagens) {
    if (msg.papel === "agente") { messages.push({ role: "assistant", content: msg.conteudo }); continue; }
    if (!msg.imagens?.length) { messages.push({ role: "user", content: msg.conteudo }); continue; }
    messages.push({
      role: "user",
      content: [
        { type: "text", text: msg.conteudo },
        ...msg.imagens.map((img) => ({ type: "image_url", image_url: { url: dataUrl(img) } })),
      ],
    });
  }
  // O OpenRouter ja devolve usage.cost em toda resposta (usage.include foi aposentado).
  const corpo: Record<string, unknown> = { model: m.modelo_api, messages };
  if (e.raciocinio) corpo.reasoning = { effort: e.raciocinio };
  if (e.pesquisaWeb) corpo.plugins = [{ id: "web" }];
  if (e.esquemaJson) {
    const { nome, schema } = nomeEsquema(e.esquemaJson);
    corpo.response_format = { type: "json_schema", json_schema: { name: nome, strict: true, schema } };
  }
  if (e.maxTokensSaida) corpo.max_tokens = e.maxTokensSaida;

  const res = await buscar("openrouter", "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: cabecalhosOpenRouter(chave),
    body: JSON.stringify(corpo),
  }, e.timeoutMs ?? TIMEOUT_TEXTO_MS);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string | null } }>; usage?: UsoOpenRouter };
  const u = data.usage ?? {};
  return {
    texto: String(data.choices?.[0]?.message?.content ?? ""),
    entrada: num(u.prompt_tokens),
    saida: num(u.completion_tokens),
    cache: num(u.prompt_tokens_details?.cached_tokens),
    buscasWeb: 0,
    custoProvedor: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
  };
}

function validarRaciocinio(m: ModeloIa, raciocinio?: string) {
  if (!raciocinio) return;
  const aceitos = m.raciocinio ?? [];
  if (!aceitos.includes(raciocinio)) {
    throw new IaMotorErro("raciocinio_nao_aceito", `O modelo ${m.id} nao aceita raciocinio "${raciocinio}".`, { aceitos });
  }
}

function estimarEntradaTexto(e: EntradaTexto): number {
  const caracteres = e.sistema.length + e.mensagens.reduce((s, msg) => s + msg.conteudo.length, 0);
  const imagens = e.mensagens.reduce((s, msg) => s + (msg.imagens?.length ?? 0), 0);
  return Math.ceil(caracteres / 3.5) + imagens * TOKENS_POR_IMAGEM_ENTRADA + (e.pesquisaWeb ? TOKENS_BUSCA_WEB_ESTIMADOS : 0);
}

/**
 * Chamada de texto com carteira. Ordem fixa: modelo, chave, estimativa,
 * saldo, provedor, custo, registro.
 */
export async function chamarTexto(e: EntradaTexto): Promise<SaidaTexto> {
  if (!e.clientId || !e.modeloId || !Array.isArray(e.mensagens) || e.mensagens.length === 0) {
    throw new IaMotorErro("entrada_invalida", "clientId, modeloId e mensagens sao obrigatorios.");
  }
  const pedido = await carregarModelo(e.modeloId, "texto");
  validarRaciocinio(pedido, e.raciocinio);
  const rota = await resolverRota(e.clientId, pedido);
  if (rota.m.id !== pedido.id) validarRaciocinio(rota.m, e.raciocinio);

  const estimativaPara = (mod: ModeloIa) => estimarComModelo(mod, {
    tokensEntrada: estimarEntradaTexto(e),
    tokensSaida: e.maxTokensSaida ?? SAIDA_ESTIMADA[e.raciocinio ?? ""] ?? 4_000,
    buscasWeb: e.pesquisaWeb ? BUSCAS_ESTIMADAS : 0,
  });
  const estimativa = estimativaPara(rota.m);
  garantirCota(rota.chave, estimativa);
  await garantirSaldo(e.clientId, estimativa);

  // Provedor; com 402 ou 401 do OpenRouter, reserva no equivalente direto.
  const { r, m, chave, reserva } = await comReservaOpenRouter(e.clientId, rota, estimativaPara, (mod, segredo) => {
    if (mod.id !== pedido.id) validarRaciocinio(mod, e.raciocinio);
    return mod.provedor === "openai"
      ? textoOpenAi(mod, segredo, e)
      : mod.provedor === "anthropic"
      ? textoAnthropic(mod, segredo, e)
      : textoOpenRouter(mod, segredo, e);
  });

  const custoFonte: "provedor" | "tabela" = r.custoProvedor != null ? "provedor" : "tabela";
  const custoUsd = r.custoProvedor != null
    ? arred(r.custoProvedor)
    : custoPelaTabela(m, { entrada: r.entrada, saida: r.saida, cache: r.cache, buscasWeb: r.buscasWeb });

  // Registra antes de validar o conteudo: a chamada ja custou.
  const { usoId, saldoUsd } = await registrarUso({
    clientId: e.clientId,
    tarefa: e.tarefa,
    agente: e.agente,
    modelo: m,
    tokensEntrada: r.entrada,
    tokensSaida: r.saida,
    tokensCache: r.cache,
    imagens: 0,
    qualidade: null,
    custoUsd,
    custoFonte,
    referencia: e.referencia,
    criadoPor: e.criadoPor,
    chave,
  });

  if (!r.texto.trim()) throw new IaMotorErro("resposta_vazia", "O modelo nao devolveu texto.", { uso_id: usoId });
  const saida: SaidaTexto = { texto: r.texto, usoId, custoUsd, saldoUsd, modeloId: m.id };
  if (reserva) saida.reservaUsada = reserva;
  if (e.esquemaJson) saida.json = lerJson(r.texto);
  return saida;
}

// -------------------------------------------------------------------- imagem

type RespostaProvedorImagem = {
  bytes: Uint8Array;
  mime: string;
  tamanho: string;
  entrada: number;
  entradaImagem: number;
  saida: number;
  custoProvedor: number | null;
  /** Só nos caminhos que sabem (API de imagens e chat do OpenRouter). */
  resolucao?: Resolucao | null;
  referenciasEnviadas?: number;
  avisos?: string[];
};

/** A arte sai direto no formato do feed; 2:3 fica de reserva. */
export const TAMANHO_4X5 = "1088x1360";
export const TAMANHO_2X3 = "1024x1536";

export function recusouTamanho(err: unknown): boolean {
  return err instanceof IaMotorErro && err.codigo === "provedor_erro" &&
    Number(err.detalhes?.status_provedor) === 400 && /size|dimension|resolution|aspect|pixel/i.test(err.message);
}

async function imagemOpenAi(m: ModeloIa, chave: string, e: EntradaImagem): Promise<RespostaProvedorImagem> {
  const pedido = e.tamanho || TAMANHO_2X3;
  try {
    return await imagemOpenAiNoTamanho(m, chave, e, pedido, e.prompt);
  } catch (err) {
    // Provedor que ainda não aceita 4:5: a mesma chamada em 2:3, com o prompt do recorte central.
    if (!e.tamanhoFixo && pedido !== TAMANHO_2X3 && recusouTamanho(err)) {
      return await imagemOpenAiNoTamanho(m, chave, e, TAMANHO_2X3, e.promptSe2x3 || e.prompt);
    }
    throw err;
  }
}

async function imagemOpenAiNoTamanho(m: ModeloIa, chave: string, e: EntradaImagem, tamanho: string, prompt: string): Promise<RespostaProvedorImagem> {
  const qualidade = QUALIDADE_OPENAI[e.qualidade] ?? "medium";
  const usarEdicao = !!e.editar || e.referencias.length > 0;
  // Fundo transparente (Mesa Foto): parâmetro background do GPT Image.
  const fundo: Record<string, string> = e.fundo === "transparente" ? { background: "transparent" } : {};
  let res: Response;
  if (!usarEdicao) {
    res = await buscar("openai", "https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.modelo_api, prompt, n: 1, size: tamanho, quality: qualidade, output_format: "png", ...fundo }),
    }, TIMEOUT_IMAGEM_MS);
  } else {
    // Edicao: a imagem a editar vai primeiro; depois as referencias, na ordem.
    const form = new FormData();
    form.append("model", m.modelo_api);
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", tamanho);
    form.append("quality", qualidade);
    form.append("output_format", "png");
    if (e.fundo === "transparente") form.append("background", "transparent");
    if (e.editar) form.append("image[]", paraBlob(e.editar.bytes, "image/png"), "atual.png");
    e.referencias.forEach((ref, i) => {
      form.append("image[]", paraBlob(ref.bytes, ref.mime), ref.nome || `referencia_${i + 1}.png`);
    });
    if (e.editar?.mascara) form.append("mask", paraBlob(e.editar.mascara, "image/png"), "mascara.png");
    res = await buscar("openai", "https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": `Bearer ${chave}` },
      body: form,
    }, TIMEOUT_IMAGEM_MS);
  }
  const data = await res.json() as {
    data?: Array<{ b64_json?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { image_tokens?: number; text_tokens?: number } };
  };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new IaMotorErro("resposta_vazia", "O gerador nao devolveu imagem.", { provedor: "openai" });
  return {
    bytes: deBase64(b64),
    mime: "image/png",
    tamanho,
    entrada: num(data.usage?.input_tokens),
    entradaImagem: num(data.usage?.input_tokens_details?.image_tokens),
    saida: num(data.usage?.output_tokens),
    custoProvedor: null,
  };
}

/** Proporções que os geradores do OpenRouter aceitam (Gemini e GPT pelo OpenRouter). */
const PROPORCOES_ACEITAS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Proporção do tamanho pedido, arredondada para a aceita mais próxima (o código recorta depois). */
export function proporcao(tamanho: string): string {
  const [l, a] = tamanho.split("x").map((v) => Number(v));
  if (!l || !a) return "2:3";
  const alvo = l / a;
  let melhor = PROPORCOES_ACEITAS[0];
  let dif = Infinity;
  for (const p of PROPORCOES_ACEITAS) {
    const [x, y] = p.split(":").map(Number);
    const d = Math.abs(Math.log((x / y) / alvo));
    if (d < dif) { dif = d; melhor = p; }
  }
  return melhor;
}

/**
 * API dedicada de imagens do OpenRouter (POST /api/v1/images), não o chat.
 * Vai por ela o GPT Image (tamanho em pixels, qualidade e fundo) e todo modelo
 * só de imagem (Seedream, FLUX.2, MAI, Riverflow, Qwen, Grok, Krea), com os
 * parâmetros que as capacidades dizem que o modelo aceita: proporção,
 * resolução, qualidade, semente, fundo e formato. Imagens de entrada (a
 * editada primeiro, depois as referências, em ordem) em input_references como
 * data URL, cortadas no limite do modelo. Não aceita máscara: quem precisa de
 * área travada já devolve o original fora da área no código.
 * Resposta: data[0].b64_json (ou url) e usage.cost.
 */
export const usaApiDeImagensDoOpenRouter = (m: ModeloIa) =>
  (m.provedor === "openrouter" && /^openai\/gpt-image/.test(m.modelo_api)) ||
  (m.provedor === "openrouter" && capacidadesDoModelo(m).api === "imagens");

async function imagemOpenRouterImages(m: ModeloIa, chave: string, e: EntradaImagem): Promise<RespostaProvedorImagem> {
  const caps = capacidadesDoModelo(m);
  const gpt = /^openai\/gpt-image/.test(m.modelo_api);
  const noLimite = referenciasNoLimite(e.editar ? { bytes: e.editar.bytes, mime: "image/png" } : null, e.referencias, caps.refs_max ?? 16);
  const imagens = noLimite.imagens;
  const avisos: string[] = noLimite.aviso ? [noLimite.aviso] : [];
  const tamanho = e.tamanho || TAMANHO_2X3;
  const corpo: Record<string, unknown> = { model: m.modelo_api, prompt: e.prompt, n: 1 };
  let resolucao: Resolucao | null = null;
  if (gpt) {
    // GPT Image: como sempre foi (tamanho em pixels e qualidade da OpenAI).
    corpo.size = tamanho;
    corpo.quality = QUALIDADE_OPENAI[e.qualidade] ?? "medium";
    corpo.output_format = "png";
  } else {
    corpo.aspect_ratio = proporcaoEntre(tamanho, caps.proporcoes);
    const r = resolucaoParaModelo(caps, e.resolucao ?? null);
    resolucao = r.resolucao;
    if (r.resolucao) corpo.resolution = r.resolucao;
    if (r.aviso) avisos.push(r.aviso);
    const q = qualidadeParaModelo(caps, e.qualidade);
    if (q) corpo.quality = q;
    if (caps.seed && typeof e.seed === "number" && Number.isFinite(e.seed)) corpo.seed = Math.floor(e.seed);
    if ((caps.formatos_saida ?? []).includes("png")) corpo.output_format = "png";
  }
  if (imagens.length) corpo.input_references = imagens.map((img) => ({ type: "image_url", image_url: { url: dataUrl(img) } }));
  if (e.fundo === "transparente") corpo.background = "transparent";
  const res = await buscar("openrouter", "https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: cabecalhosOpenRouter(chave),
    body: JSON.stringify(corpo),
  }, TIMEOUT_IMAGEM_MS);
  const data = await res.json() as {
    data?: Array<{ b64_json?: string; media_type?: string; url?: string }>;
    usage?: UsoOpenRouter;
  };
  const item = data.data?.[0];
  let bytes: Uint8Array | null = item?.b64_json ? deBase64(item.b64_json) : null;
  let mime = item?.media_type || "";
  if (!bytes && item?.url) {
    const embutida = item.url.match(/^data:([^;]+);base64,(.+)$/);
    if (embutida) {
      bytes = deBase64(embutida[2]);
      mime = mime || embutida[1];
    } else {
      // Pelo mesmo ponto de saída do motor (tempo limite e erro padronizado).
      const baixada = await buscar("openrouter", item.url, { method: "GET" }, 60_000);
      mime = mime || baixada.headers.get("content-type")?.split(";")[0] || "";
      bytes = new Uint8Array(await baixada.arrayBuffer());
    }
  }
  if (!bytes || !bytes.length) throw new IaMotorErro("resposta_vazia", "O gerador nao devolveu imagem.", { provedor: "openrouter" });
  const u = data.usage ?? {};
  return {
    bytes,
    mime: mime || mimePelosBytes(bytes),
    tamanho,
    entrada: num(u.prompt_tokens),
    entradaImagem: 0,
    saida: num(u.completion_tokens),
    custoProvedor: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
    resolucao,
    referenciasEnviadas: imagens.length,
    avisos,
  };
}

/** Tipo da imagem pelos primeiros bytes (PNG, JPEG, WebP); PNG quando não dá para saber. */
function mimePelosBytes(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return "image/png";
}

/**
 * Modelos que devolvem fundo transparente de verdade: GPT Image direto na
 * OpenAI e pela API de imagens do OpenRouter, e os modelos só de imagem cujas
 * capacidades dizem que aceitam (Riverflow). O chat do OpenRouter (Gemini e
 * outros) não tem esse parâmetro.
 */
export function aceitaFundoTransparente(m: Pick<ModeloIa, "provedor" | "modelo_api"> & Pick<Partial<ModeloIa>, "capacidades" | "modalidades">): boolean {
  if (m.provedor === "openai") return /^gpt-image/.test(m.modelo_api);
  if (m.provedor === "openrouter" && /^openai\/gpt-image/.test(m.modelo_api)) return true;
  if (m.provedor !== "openrouter") return false;
  const caps = capacidadesDoModelo(m);
  return caps.api === "imagens" && caps.fundo_transparente === true;
}

function erroFundoTransparente(m: ModeloIa): IaMotorErro {
  return new IaMotorErro("entrada_invalida", `O modelo ${m.id} não gera fundo transparente.`, {
    motivo: "fundo_transparente_nao_suportado",
    modelo_id: m.id,
  });
}

async function imagemOpenRouter(m: ModeloIa, chave: string, e: EntradaImagem): Promise<RespostaProvedorImagem> {
  if (usaApiDeImagensDoOpenRouter(m)) return await imagemOpenRouterImages(m, chave, e);
  if (e.fundo === "transparente") throw erroFundoTransparente(m);
  // Chat do OpenRouter (Gemini): corpo igual ao de antes; resolução (image_size) só quando pedida e aceita.
  const caps = capacidadesDoModelo(m);
  const noLimite = referenciasNoLimite(e.editar ? { bytes: e.editar.bytes, mime: "image/png" } : null, e.referencias, caps.refs_max ?? 14);
  const imagens = noLimite.imagens;
  const avisos: string[] = noLimite.aviso ? [noLimite.aviso] : [];
  const r = resolucaoParaModelo(caps, e.resolucao ?? null);
  if (r.aviso) avisos.push(r.aviso);
  const imageConfig: Record<string, unknown> = { aspect_ratio: proporcao(e.tamanho || TAMANHO_2X3) };
  if (r.resolucao) imageConfig.image_size = r.resolucao;
  const corpo = {
    model: m.modelo_api,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: e.prompt },
        ...imagens.map((img) => ({ type: "image_url", image_url: { url: dataUrl(img) } })),
      ],
    }],
    modalities: ["image", "text"],
    image_config: imageConfig,
  };
  const res = await buscar("openrouter", "https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: cabecalhosOpenRouter(chave),
    body: JSON.stringify(corpo),
  }, TIMEOUT_IMAGEM_MS);
  const data = await res.json() as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    usage?: UsoOpenRouter;
  };
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const achado = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!achado) throw new IaMotorErro("resposta_vazia", "O gerador nao devolveu imagem.", { provedor: "openrouter" });
  const u = data.usage ?? {};
  return {
    bytes: deBase64(achado[2]),
    mime: achado[1],
    tamanho: e.tamanho || TAMANHO_2X3,
    entrada: num(u.prompt_tokens),
    entradaImagem: 0,
    saida: num(u.completion_tokens),
    custoProvedor: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
    resolucao: r.resolucao,
    referenciasEnviadas: imagens.length,
    avisos,
  };
}

/**
 * Uma imagem por chamada (uma lamina), com carteira. Mesma ordem do texto.
 */
export async function chamarImagem(e: EntradaImagem): Promise<SaidaImagem> {
  if (!e.clientId || !e.modeloId || !e.prompt?.trim()) {
    throw new IaMotorErro("entrada_invalida", "clientId, modeloId e prompt sao obrigatorios.");
  }
  const pedido = await carregarModelo(e.modeloId, "imagem");
  if (pedido.provedor === "anthropic") {
    throw new IaMotorErro("provedor_sem_imagem", "A Anthropic nao gera imagem.", { modelo_id: pedido.id });
  }
  const rota = await resolverRota(e.clientId, pedido);
  // Fundo transparente é pedido explícito: recusa antes de cobrar quando o modelo não faz.
  if (e.fundo === "transparente" && !aceitaFundoTransparente(rota.m)) throw erroFundoTransparente(rota.m);

  const qtdImagensEntrada = e.referencias.length + (e.editar ? 1 : 0);
  const estimativaPara = (mod: ModeloIa) => {
    const limite = capacidadesDoModelo(mod).refs_max ?? qtdImagensEntrada;
    const enviadas = Math.min(qtdImagensEntrada, Math.max(0, limite));
    return estimarComModelo(mod, {
      imagens: 1,
      qualidade: e.qualidade,
      tokensEntrada: Math.ceil(e.prompt.length / 3.5) + enviadas * TOKENS_POR_IMAGEM_ENTRADA,
      resolucao: e.resolucao ? resolucaoParaModelo(capacidadesDoModelo(mod), e.resolucao).resolucao : null,
      imagensEntrada: enviadas,
      tamanho: e.tamanho,
    });
  };
  const estimativa = estimativaPara(rota.m);
  garantirCota(rota.chave, estimativa);
  await garantirSaldo(e.clientId, estimativa);

  // Provedor; com 402 ou 401 do OpenRouter, reserva no equivalente direto.
  const { r, m, chave, reserva } = await comReservaOpenRouter(e.clientId, rota, estimativaPara, (mod, segredo) =>
    mod.provedor === "openai" ? imagemOpenAi(mod, segredo, e) : imagemOpenRouter(mod, segredo, e), !!e.mesmoModelo
  );

  const custoFonte: "provedor" | "tabela" = r.custoProvedor != null ? "provedor" : "tabela";
  const custoUsd = r.custoProvedor != null
    ? arred(r.custoProvedor)
    : custoPelaTabela(m, {
      entrada: r.entrada,
      entradaImagem: r.entradaImagem,
      saida: r.saida,
      cache: 0,
      imagens: 1,
      qualidade: e.qualidade,
      resolucao: r.resolucao ?? null,
      imagensEntrada: r.referenciasEnviadas ?? qtdImagensEntrada,
    });

  const { usoId, saldoUsd } = await registrarUso({
    clientId: e.clientId,
    tarefa: e.tarefa ?? "estudio",
    agente: e.agente ?? "gerador_imagem",
    modelo: m,
    tokensEntrada: r.entrada,
    tokensSaida: r.saida,
    tokensCache: 0,
    imagens: 1,
    qualidade: e.qualidade,
    custoUsd,
    custoFonte,
    referencia: e.referencia,
    criadoPor: e.criadoPor,
    chave,
  });
  const saida: SaidaImagem = { png: r.bytes, mime: r.mime, tamanho: r.tamanho, usoId, custoUsd, saldoUsd, modeloId: m.id };
  if (reserva) saida.reservaUsada = reserva;
  if (r.resolucao !== undefined) saida.resolucao = r.resolucao;
  if (r.referenciasEnviadas !== undefined) saida.referenciasEnviadas = r.referenciasEnviadas;
  if (r.avisos?.length) saida.avisos = r.avisos;
  return saida;
}

// ---------------------------------------------------- conferencia do catalogo

/** Lista os ids reais de modelo que o provedor oferece para a nossa chave. */
export async function listarModelosDoProvedor(provedor: Provedor): Promise<string[]> {
  const chave = chaveDoProvedor(provedor);
  const alvo: Record<Provedor, { url: string; headers: Record<string, string> }> = {
    openai: { url: "https://api.openai.com/v1/models", headers: { "Authorization": `Bearer ${chave}` } },
    anthropic: { url: "https://api.anthropic.com/v1/models?limit=1000", headers: { "x-api-key": chave, "anthropic-version": "2023-06-01" } },
    openrouter: { url: "https://openrouter.ai/api/v1/models", headers: cabecalhosOpenRouter(chave) },
  };
  const { url, headers } = alvo[provedor];
  const res = await buscar(provedor, url, { method: "GET", headers }, TIMEOUT_LISTA_MS);
  const data = await res.json() as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((d) => String(d.id ?? "")).filter(Boolean).sort();
}

// ------------------------------------------------- catalogo do OpenRouter

const ORDEM_RACIOCINIO = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
/** Tokens de uma imagem 1K do Gemini, para a estimativa previa (o custo real vem em usage.cost). */
const TOKENS_IMAGEM_ESTIMADOS = 1_290;
export const OPENROUTER_MODELOS_URL = "https://openrouter.ai/api/v1/models";

export type LinhaCatalogo = {
  id: string;
  modelo_api: string;
  tipo: TipoModelo;
  rotulo: string;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
  preco_cache_1m: number | null;
  preco_imagem: Record<string, number> | null;
  raciocinio: string[];
  contexto_tokens: number | null;
  modalidades: { entrada: string[]; saida: string[] };
  fonte_preco: string;
  /** Só modelos de imagem (lista de imagens do OpenRouter); texto: null. */
  capacidades: CapacidadesImagem | null;
};

type ModeloOpenRouter = {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, unknown>;
  supported_parameters?: string[];
  reasoning?: { supported_efforts?: string[] };
};

/** Preco por token (texto do OpenRouter) para preco por 1 milhao. */
function por1m(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * Converte um modelo da lista publica do OpenRouter em linha do catalogo.
 * Ficam de fora: variantes com ":" (batch, free), roteadores do proprio
 * OpenRouter, preco negativo ou ausente e modelos que falam audio.
 */
export function converterModeloOpenRouter(o: ModeloOpenRouter, hoje: string): LinhaCatalogo | null {
  const slug = String(o.id ?? "").trim();
  if (!slug || slug.includes(":") || slug.startsWith("openrouter/")) return null;
  const saida = o.architecture?.output_modalities ?? [];
  const entrada = o.architecture?.input_modalities ?? [];
  if (saida.includes("audio")) return null;
  const tipo: TipoModelo | null = saida.includes("image") ? "imagem" : saida.includes("text") ? "texto" : null;
  if (!tipo) return null;
  const p = o.pricing ?? {};
  const pe = por1m(p.prompt);
  const ps = por1m(p.completion);
  if (pe == null || ps == null) return null;

  let raciocinio: string[] = [];
  const esforcos = o.reasoning?.supported_efforts;
  if (Array.isArray(esforcos) && esforcos.length) {
    raciocinio = ORDEM_RACIOCINIO.filter((n) => esforcos.includes(n));
  } else if ((o.supported_parameters ?? []).includes("reasoning_effort")) {
    raciocinio = ["low", "medium", "high"];
  }

  let precoImagem: Record<string, number> | null = null;
  const saidaImagem = por1m(p.image_output);
  if (tipo === "imagem" && saidaImagem != null) {
    // Gemini nao tem nivel de qualidade: as tres levam a estimativa de 1K.
    const porImagem = Math.round((saidaImagem / 1_000_000) * TOKENS_IMAGEM_ESTIMADOS * 10_000) / 10_000;
    precoImagem = { baixa: porImagem, media: porImagem, alta: porImagem, saida_imagem_1m: saidaImagem };
    const entradaImagem = por1m(p.image);
    if (entradaImagem != null) precoImagem.entrada_imagem_1m = entradaImagem;
  }

  const contexto = Number(o.context_length);
  return {
    id: `openrouter:${slug}`,
    modelo_api: slug,
    tipo,
    rotulo: String(o.name ?? slug).slice(0, 200),
    preco_entrada_1m: pe,
    preco_saida_1m: ps,
    preco_cache_1m: por1m(p.input_cache_read),
    preco_imagem: precoImagem,
    raciocinio,
    contexto_tokens: Number.isInteger(contexto) && contexto > 0 ? contexto : null,
    modalidades: { entrada, saida },
    fonte_preco: `${OPENROUTER_MODELOS_URL} e https://openrouter.ai/${slug} (sincronizado ${hoje})`,
    capacidades: null,
  };
}

/**
 * Converte um modelo da lista pública de IMAGENS do OpenRouter
 * (/api/v1/images/models + /endpoints) em linha do catálogo, com as
 * capacidades e o preço por imagem na variante certa (por imagem, por
 * megapixel ou por token). Ficam de fora: GPT Image (linha mantida à mão,
 * com o preço por qualidade da OpenAI; a sincronização não a derruba) e
 * modelo sem preço publicado no endpoint.
 */
export function converterModeloDeImagemOpenRouter(
  o: ModeloDeImagemOpenRouter,
  endpoints: EndpointDeImagemOpenRouter[] | null,
  hoje: string,
): LinhaCatalogo | null {
  const slug = String(o.id ?? "").trim();
  if (!slug || slug.includes(":") || slug.startsWith("openrouter/") || /^openai\/gpt-image/.test(slug)) return null;
  const saida = o.architecture?.output_modalities ?? [];
  if (!saida.includes("image")) return null;
  const endpoint = (endpoints ?? [])[0] ?? null;
  const caps = capacidadesDaListaDeImagens(o, endpoint);
  const precos = precosDoEndpoint(endpoint);
  const preco = precoImagemDoEndpoint(slug, caps, precos);
  if (!preco.preco_imagem) return null;
  return {
    id: `openrouter:${slug}`,
    modelo_api: slug,
    tipo: "imagem",
    rotulo: String(o.name ?? slug).slice(0, 200),
    preco_entrada_1m: preco.preco_entrada_1m,
    preco_saida_1m: preco.preco_saida_1m,
    preco_cache_1m: null,
    preco_imagem: preco.preco_imagem,
    raciocinio: [],
    contexto_tokens: null,
    modalidades: { entrada: o.architecture?.input_modalities ?? ["text"], saida },
    fonte_preco: `${OPENROUTER_IMAGENS_URL} e ${urlDosEndpointsDeImagem(slug)} (sincronizado ${hoje})`,
    capacidades: { ...caps, precos, fonte: urlDosEndpointsDeImagem(slug) },
  };
}

/**
 * Junta a linha do chat (Gemini, que também está na lista de imagens) com as
 * capacidades e os preços por resolução da lista de imagens. O preço por
 * token do chat fica; entram as chaves res_<R>.
 */
export function juntarCapacidades(linha: LinhaCatalogo, daImagem: LinhaCatalogo): LinhaCatalogo {
  const resolucoes: Record<string, number> = {};
  for (const [k, v] of Object.entries(daImagem.preco_imagem ?? {})) if (k.startsWith("res_") || k === "entrada_por_imagem") resolucoes[k] = v;
  return {
    ...linha,
    preco_imagem: linha.preco_imagem ? { ...linha.preco_imagem, ...resolucoes } : daImagem.preco_imagem,
    capacidades: daImagem.capacidades,
  };
}

/** Lista de imagens + endpoints de cada modelo (6 por vez, uma nova tentativa por falha). */
async function listarModelosDeImagemOpenRouter(hoje: string): Promise<LinhaCatalogo[]> {
  const obterJson = async (url: string) => (await buscar("openrouter", url, { method: "GET" }, TIMEOUT_LISTA_MS)).json();
  const comUmaNovaTentativa = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      return await fn();
    }
  };
  const lista = ((await comUmaNovaTentativa(() => obterJson(OPENROUTER_IMAGENS_URL))) as { data?: ModeloDeImagemOpenRouter[] }).data ?? [];
  const alvos = lista.filter((o) => {
    const slug = String(o.id ?? "");
    return slug && !slug.includes(":") && !/^openai\/gpt-image/.test(slug) && (o.architecture?.output_modalities ?? []).includes("image");
  });
  const linhas: LinhaCatalogo[] = [];
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < alvos.length) {
      const o = alvos[proximo++];
      const dados = await comUmaNovaTentativa(() => obterJson(urlDosEndpointsDeImagem(String(o.id)))) as { endpoints?: EndpointDeImagemOpenRouter[] };
      const linha = converterModeloDeImagemOpenRouter(o, dados.endpoints ?? [], hoje);
      if (linha) linhas.push(linha);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, alvos.length) }, trabalhador));
  return linhas;
}

/**
 * Lista publica do OpenRouter (sem chave), ja convertida para o catalogo:
 * a lista do chat (/api/v1/models) mais a de imagens (/api/v1/images/models,
 * com o preço e as capacidades de cada endpoint). Os modelos só de imagem
 * (Seedream, FLUX.2, MAI, Riverflow...) só aparecem na segunda. Se a lista de
 * imagens falhar duas vezes, a sincronização inteira falha (sem ela, a rodada
 * completa marcaria esses modelos como indisponíveis) e o cron tenta amanhã.
 */
export async function listarCatalogoOpenRouter(): Promise<{ linhas: LinhaCatalogo[]; recebidos: number }> {
  const res = await buscar("openrouter", OPENROUTER_MODELOS_URL, { method: "GET" }, TIMEOUT_LISTA_MS);
  const data = await res.json() as { data?: ModeloOpenRouter[] };
  const hoje = new Date().toISOString().slice(0, 10);
  const lista = data.data ?? [];
  const doChat = lista.map((o) => converterModeloOpenRouter(o, hoje)).filter((l): l is LinhaCatalogo => l !== null);
  const deImagem = await listarModelosDeImagemOpenRouter(hoje);
  const porId = new Map(doChat.map((l) => [l.id, l]));
  for (const img of deImagem) {
    const noChat = porId.get(img.id);
    porId.set(img.id, noChat ? juntarCapacidades(noChat, img) : img);
  }
  return { linhas: Array.from(porId.values()), recebidos: lista.length + deImagem.length };
}
