import { toast } from "sonner";
/**
 * Mesa do cliente: a ponte da tela com as funções de borda e as RPCs
 * (docs/mesa-do-cliente/SPEC.md, seções 2, 2.1 e 3 a 5).
 *
 * Nenhuma chave de IA passa por aqui: o navegador só manda ordens e recebe
 * ids, preços e custos. Toda ação que gasta passa antes por uma estimativa
 * (ver `estimarCusto` e o componente BotaoComCusto) e, depois, lê o custo
 * real da resposta (`custoDaResposta`).
 */
import { supabase } from "@/integrations/supabase/client";

export type FuncaoDaMesa = "ia-gateway" | "agente-calendario" | "estudio-arte";

export type AcaoDeErro = "recarregar" | "cota" | "chave" | "modelo" | null;

/** Erro já traduzido para gente: código do backend, frase e próximo passo. */
export class ErroDaMesa extends Error {
  codigo: string;
  detalhes: Record<string, unknown>;
  acao: AcaoDeErro;
  rotuloAcao: string | null;
  constructor(codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "ErroDaMesa";
    this.codigo = codigo;
    this.detalhes = detalhes;
    const proximo = proximoPasso(codigo);
    this.acao = proximo.acao;
    this.rotuloAcao = proximo.rotulo;
  }
}

const NOMES_DAS_FUNCOES: Record<FuncaoDaMesa, string> = {
  "ia-gateway": "motor de IA",
  "agente-calendario": "estrategista",
  "estudio-arte": "estúdio de arte",
};

const PROVEDORES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

export const nomeDoProvedor = (p?: unknown) => PROVEDORES[String(p || "")] || String(p || "provedor");

function proximoPasso(codigo: string): { acao: AcaoDeErro; rotulo: string | null } {
  switch (codigo) {
    case "saldo_insuficiente":
      return { acao: "recarregar", rotulo: "Recarregar carteira" };
    case "cota_da_chave_esgotada":
      return { acao: "cota", rotulo: "Ajustar cota" };
    case "cliente_sem_chave":
    case "provedor_sem_chave":
      return { acao: "chave", rotulo: "Cadastrar chave" };
    case "sem_modelo":
      return { acao: "modelo", rotulo: "Escolher modelos" };
    default:
      return { acao: null, rotulo: null };
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Frase em português para cada código que o motor e as funções devolvem. */
export function mensagemDoCodigo(codigo: string, detalhes: Record<string, unknown> = {}, funcao?: FuncaoDaMesa): string {
  const provedor = nomeDoProvedor(detalhes.provedor);
  switch (codigo) {
    case "saldo_insuficiente": {
      const falta = num(detalhes.falta_usd);
      const saldo = num(detalhes.saldo_usd);
      return `A carteira de IA deste cliente não cobre esta ação${falta !== null ? `: faltam ${usd(falta)}` : ""}${saldo !== null ? ` (saldo ${usd(saldo)})` : ""}. Recarregue a carteira para seguir.`;
    }
    case "cota_da_chave_esgotada": {
      const cota = num(detalhes.cota_mensal_usd);
      const gasto = num(detalhes.gasto_mes_usd);
      return `A cota do mês da chave de IA deste cliente acabou${gasto !== null && cota !== null ? ` (gasto ${usd(gasto)} de ${usd(cota)})` : ""}. Ajuste a cota em Chaves e cotas para seguir.`;
    }
    case "cliente_sem_chave":
      return `Este cliente não tem chave própria de ${provedor} e está marcado para não usar a chave da agência. Cadastre a chave do cliente ou ligue o uso da chave da agência em Chaves e cotas.`;
    case "provedor_sem_chave":
      return `A agência ainda não tem chave de ${provedor} configurada. Escolha um modelo de outro provedor ou cadastre a chave do cliente em Chaves e cotas.`;
    case "sem_modelo":
      return "Nenhum modelo ativo para esta tarefa. Um admin precisa ativar um modelo em Modelos de IA.";
    case "nao_autorizado":
    case "somente_admin":
      return "Você não tem permissão para esta ação.";
    case "entrada_invalida":
      return "Faltou algum dado ou algum valor está fora do esperado. Confira o formulário.";
    case "servico_indisponivel":
      return `O ${funcao ? NOMES_DAS_FUNCOES[funcao] : "serviço"} ainda não respondeu. Pode estar sendo publicado agora; tente de novo em instantes.`;
    case "acao_desconhecida":
      return `O ${funcao ? NOMES_DAS_FUNCOES[funcao] : "serviço"} ainda não conhece esta ação. Ela entra no ar em breve.`;
    case "falha_interna":
      return "O serviço falhou ao processar o pedido. Nada foi cobrado se a IA não respondeu; tente de novo.";
    default:
      return typeof detalhes.mensagem === "string" && detalhes.mensagem.trim()
        ? String(detalhes.mensagem)
        : "Não foi possível concluir. Tente de novo.";
  }
}

/** Lê o corpo de erro de uma função de borda e devolve um ErroDaMesa. */
async function erroDaFuncao(error: any, funcao: FuncaoDaMesa): Promise<ErroDaMesa> {
  const ctx = error?.context;
  let corpo: Record<string, unknown> | null = null;
  let status = 0;
  try {
    if (ctx && typeof ctx.status === "number") status = ctx.status;
    if (ctx && typeof ctx.clone === "function") corpo = await ctx.clone().json();
    else if (ctx && typeof ctx.json === "function") corpo = await ctx.json();
  } catch {
    corpo = null;
  }
  if (corpo && typeof corpo.error === "string") {
    const codigo = String(corpo.error);
    return new ErroDaMesa(codigo, mensagemDoCodigo(codigo, corpo, funcao), corpo);
  }
  // Sem corpo: função não publicada (404), relé fora do ar ou rede.
  if (status === 404 || error?.name === "FunctionsFetchError" || error?.name === "FunctionsRelayError" || !ctx) {
    return new ErroDaMesa("servico_indisponivel", mensagemDoCodigo("servico_indisponivel", {}, funcao));
  }
  return new ErroDaMesa("falha_interna", mensagemDoCodigo("falha_interna", {}, funcao));
}

/** Chama uma função da Mesa e devolve o corpo; erro vira ErroDaMesa. */
export async function chamarFuncao<T = any>(funcao: FuncaoDaMesa, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcao, { body: corpo });
  if (error) throw await erroDaFuncao(error, funcao);
  if (data && typeof data === "object" && typeof (data as any).error === "string") {
    const codigo = String((data as any).error);
    throw new ErroDaMesa(codigo, mensagemDoCodigo(codigo, data as any, funcao), data as any);
  }
  // O motor atendeu por outro caminho (ex.: OpenRouter sem credito, OpenAI direta).
  if (data && typeof data === "object" && typeof (data as any).reserva_usada === "string") {
    const motivo = String((data as any).reserva_usada);
    toast.info(
      motivo === "openrouter_sem_credito"
        ? "O OpenRouter está sem crédito. Esta chamada foi feita direto na OpenAI, com o mesmo modelo."
        : "Esta chamada foi feita direto no provedor do modelo, sem passar pelo OpenRouter.",
    );
  }
  return data as T;
}

/** Converte qualquer erro (de RPC, de storage, da função) em frase. */
export function textoDoErro(err: unknown, padrao = "Não foi possível concluir. Tente de novo."): string {
  if (err instanceof ErroDaMesa) return err.message;
  const msg = (err as any)?.message;
  if (typeof msg === "string" && msg.trim()) {
    if (msg.indexOf("IA_RECARGA_SO_ADMIN_OU_MANAGER") >= 0) return "Só admin ou gestor recarrega a carteira.";
    if (msg.indexOf("IA_RECARGA_VALOR_INVALIDO") >= 0) return "O valor da recarga precisa ser maior que zero.";
    if (/row-level security|permission denied/i.test(msg)) return "Você não tem permissão para esta ação.";
    return msg;
  }
  return padrao;
}

// ------------------------------------------------------------------ dinheiro

export function usd(valor: number | null | undefined): string {
  const v = Number(valor || 0);
  const abs = Math.abs(v);
  const casas = abs > 0 && abs < 0.1 ? 4 : 2;
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: casas })}`;
}

/** Custo real que a função devolveu, em qualquer das formas combinadas. */
export function custoDaResposta(data: any): number | null {
  if (!data || typeof data !== "object") return null;
  const candidatos = [data.custo_usd, data.custoUsd, data.uso?.custo_usd, data.custo_real_usd];
  for (const c of candidatos) {
    const n = num(c);
    if (n !== null) return n;
  }
  if (Array.isArray(data.usos)) {
    let total = 0;
    let achou = false;
    for (const u of data.usos) {
      const n = num(u?.custo_usd ?? u?.custoUsd);
      if (n !== null) { total += n; achou = true; }
    }
    if (achou) return total;
  }
  return null;
}

// ------------------------------------------------------------------ catálogo

export type Papel = "estrategista" | "diretor_arte" | "imagem" | "leitura";
export type Qualidade = "baixa" | "media" | "alta";

export interface ModeloIa {
  id: string;
  provedor: string;
  modelo_api: string;
  tipo: "texto" | "imagem";
  rotulo: string | null;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
  preco_cache_1m: number | null;
  preco_imagem: Record<string, number> | null;
  raciocinio: string[] | null;
  padrao_para: string[] | null;
  ativo: boolean;
  fonte_preco?: string | null;
  conferido_em?: string | null;
  criado_em?: string | null;
  novo?: boolean | null;
}

export const QUALIDADES: { valor: Qualidade; rotulo: string }[] = [
  { valor: "baixa", rotulo: "Rascunho (baixa)" },
  { valor: "media", rotulo: "Média" },
  { valor: "alta", rotulo: "Final (alta)" },
];

export const PAPEIS: { valor: Papel; rotulo: string; tipo: "texto" | "imagem" }[] = [
  { valor: "estrategista", rotulo: "Estrategista", tipo: "texto" },
  { valor: "diretor_arte", rotulo: "Diretor de arte", tipo: "texto" },
  { valor: "imagem", rotulo: "Gerador de imagem", tipo: "imagem" },
  { valor: "leitura", rotulo: "Leitura de imagem", tipo: "texto" },
];

/** Catálogo pela função; se ela ainda não estiver no ar, lê a tabela (RLS da equipe). */
export async function lerCatalogo(): Promise<ModeloIa[]> {
  try {
    const data = await chamarFuncao<{ modelos: ModeloIa[] }>("ia-gateway", { acao: "catalogo" });
    if (Array.isArray(data?.modelos)) return data.modelos;
  } catch {
    /* cai na leitura direta */
  }
  const { data, error } = await (supabase as any).from("ia_modelos").select("*").order("tipo").order("provedor").order("id");
  if (error) throw error;
  return (data || []) as ModeloIa[];
}

export const modelosAtivos = (catalogo: ModeloIa[], tipo: "texto" | "imagem") =>
  catalogo.filter((m) => m.ativo && m.tipo === tipo);

export function padraoPara(catalogo: ModeloIa[], papel: Papel): ModeloIa | null {
  const tipo = PAPEIS.find((p) => p.valor === papel)?.tipo || "texto";
  const ativos = modelosAtivos(catalogo, tipo);
  return ativos.find((m) => (m.padrao_para || []).indexOf(papel) >= 0) || ativos[0] || null;
}

const preco = (v: number | null | undefined) =>
  v === null || v === undefined ? "?" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Preço curto para aparecer ao lado do nome do modelo. */
export function precoDoModelo(m: ModeloIa, qualidade: Qualidade = "media"): string {
  if (m.tipo === "imagem") {
    const tabela = m.preco_imagem || {};
    const v = tabela[qualidade] ?? tabela.media ?? tabela.baixa ?? tabela.alta;
    return v === undefined ? "preço a conferir" : `US$ ${preco(v)} por imagem`;
  }
  if (m.preco_entrada_1m === null && m.preco_saida_1m === null) return "preço a conferir";
  return `US$ ${preco(m.preco_entrada_1m)} / ${preco(m.preco_saida_1m)} por 1M`;
}

export const nomeDoModelo = (m: ModeloIa) => m.rotulo || m.modelo_api || m.id;

/** Chegou há pouco: coluna `novo` quando existir; senão criado ou conferido nos últimos 14 dias. */
export function modeloNovo(m: ModeloIa, agora = Date.now()): boolean {
  if (typeof m.novo === "boolean") return m.novo;
  const quando = m.criado_em || m.conferido_em;
  if (!quando) return false;
  const t = new Date(quando).getTime();
  return Number.isFinite(t) && agora - t < 14 * 86400000;
}

// ------------------------------------------------------------------ estimativa

export interface ParteDaEstimativa {
  modeloId: string | null | undefined;
  tipo: "texto" | "imagem";
  tokensEntrada?: number;
  tokensSaida?: number;
  imagens?: number;
  qualidade?: Qualidade;
  buscasWeb?: number;
  /** Quantas vezes esta parte se repete (ex.: um card vezes N cards). */
  vezes?: number;
}

// Saída estimada por nível de raciocínio, igual à do motor (só para a estimativa).
const SAIDA_POR_RACIOCINIO: Record<string, number> = {
  none: 3000, minimal: 3000, low: 4000, medium: 8000, high: 16000, xhigh: 24000, max: 32000,
};
export const saidaPorRaciocinio = (r?: string | null) => SAIDA_POR_RACIOCINIO[String(r || "")] || 8000;

/** Soma a estimativa de cada parte pela tabela do catálogo (sem chamar provedor). */
export async function estimarCusto(partes: ParteDaEstimativa[]): Promise<number> {
  let total = 0;
  for (const parte of partes) {
    if (!parte.modeloId) throw new ErroDaMesa("sem_modelo", mensagemDoCodigo("sem_modelo"));
    const vezes = parte.vezes === undefined ? 1 : parte.vezes;
    if (vezes <= 0) continue;
    const data = await chamarFuncao<{ custo_usd: number }>("ia-gateway", {
      acao: "estimar",
      modelo_id: parte.modeloId,
      tipo: parte.tipo,
      tokens_entrada: parte.tokensEntrada || 0,
      tokens_saida: parte.tokensSaida || 0,
      imagens: parte.tipo === "imagem" ? parte.imagens || 1 : undefined,
      qualidade: parte.qualidade,
      buscas_web: parte.buscasWeb || 0,
    });
    total += (num(data?.custo_usd) || 0) * vezes;
  }
  return total;
}

/**
 * Tamanhos típicos de cada ação, para a estimativa antes de gastar. São
 * aproximações declaradas como tais na tela; o custo real vem da resposta.
 */
export const TAMANHOS = {
  proporTemas: { entrada: 40000, buscasWeb: 5 },
  detalhar: { entrada: 30000, saidaPorItem: 1500 },
  conversarMes: { entrada: 30000, saida: 4000 },
  preparar: { entrada: 20000, saida: 8000 },
  leituraDoCard: { entrada: 2500, saida: 400 },
  ajuste: { entrada: 6000, saida: 1200 },
  legenda: { entrada: 8000, saida: 1500 },
  lerReferencia: { entrada: 3000, saida: 800 },
};

// ------------------------------------------------------------------ mês

export const inicioDoMes = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { inicio: `${a}-${String(m).padStart(2, "0")}-01`, fim: `${a}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` };
}

export function rotuloDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${nomes[(m || 1) - 1]} de ${a}`;
}

export function somarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return inicioDoMes(d);
}

export const dataCurta = (iso?: string | null) => {
  if (!iso) return "sem data";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
};

/** Extensão em minúsculas, sem regex moderna. */
export function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : "";
}

// ------------------------------------------------------------------ entrega

/** Data e hora curtas no fuso do navegador (ex.: "sex., 25/09 às 09:00"). */
export const dataEHora = (iso?: string | null) => {
  if (!iso) return "sem data";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} às ${hora}`;
};

export interface ResultadoDoEnvio {
  trabalho_id: string;
  ok: boolean;
  estado?: string;
  erro?: string;
}

/**
 * Envia as artes entregues para aprovação pelo caminho da tela de Arquivos:
 * admin e gestor liberam direto ao cliente; design pede a revisão da agência.
 */
export async function enviarParaAprovacao(trabalhoIds: string[]): Promise<ResultadoDoEnvio[]> {
  const { data, error } = await (supabase as any).rpc("mesa_enviar_para_aprovacao", { _trabalho_ids: trabalhoIds });
  if (error) throw error;
  return ((data || {}).resultados || []) as ResultadoDoEnvio[];
}

export interface PrevisaoDoPlano {
  posts_por_mes: number | null;
  laminas_por_post: number | null;
  hora_publicacao: string;
  fuso: string;
  agendar_ao_aprovar: boolean;
  custo_por_post_usd: number;
  fonte: "historico" | "tabela";
  amostra: number;
  previsao_mes_usd: number | null;
  saldo_usd: number;
  posts_que_o_saldo_cobre: number | null;
  recarga_sugerida_usd: number | null;
  artes_entregues_no_mes: number;
  gasto_mes_usd: number;
}

export async function lerPrevisao(clientId: string): Promise<PrevisaoDoPlano> {
  const { data, error } = await (supabase as any).rpc("mesa_previsao_cliente", { _client_id: clientId });
  if (error) throw error;
  return data as PrevisaoDoPlano;
}

export async function salvarAjustesDaEntrega(a: {
  clientId: string;
  horaPublicacao: string;
  fuso: string;
  agendarAoAprovar: boolean;
  postsPorMes: number | null;
  laminasPorPost: number | null;
}): Promise<void> {
  const { error } = await (supabase as any).rpc("mesa_config_salvar", {
    _client_id: a.clientId,
    _hora_publicacao: a.horaPublicacao,
    _fuso: a.fuso,
    _agendar_ao_aprovar: a.agendarAoAprovar,
    _posts_por_mes: a.postsPorMes,
    _laminas_por_post: a.laminasPorPost,
  });
  if (error) throw error;
}
