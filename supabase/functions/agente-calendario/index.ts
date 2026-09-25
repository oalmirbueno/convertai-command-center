/**
 * agente-calendario: o estrategista editorial da Mesa do cliente
 * (docs/mesa-do-cliente/SPEC.md, secao 4).
 *
 * Acoes (POST { acao, ... }, so equipe com acesso ao cliente):
 * - propor_temas { client_id, periodo_inicio, periodo_fim, frequencia, objetivo?,
 *   oferta?, regiao?, project_id?, modelo_id?, raciocinio? }: monta o contexto
 *   real do cliente, pesquisa na web, devolve diagnostico e 8 a 15 temas; o Jev
 *   da nota de aderencia ao objetivo e de potencial de salvamento e
 *   compartilhamento de cada tema. Cria calendario_propostas com status temas
 *   e abre a conversa do agente.
 * - escolher_temas { proposta_id, temas: string[] }: marca os temas escolhidos.
 * - detalhar { proposta_id, modelo_id?, raciocinio? }: gera os itens completos
 *   dos temas escolhidos (todos os campos do prompt, roteiro de cada card,
 *   ilustracao, estilo, carrossel infinito). Datas so de segunda a sexta dentro
 *   do periodo, calculadas aqui no codigo. Formato so carrossel ou estatico.
 *   Os lotes rodam em paralelo para caber no tempo da funcao; um lote que falha
 *   deixa a proposta em detalhando e a proxima chamada so refaz o que falta.
 * - conversar { proposta_id, mensagem }: aplica o pedido na proposta (saida em
 *   JSON), grava as mensagens e devolve a proposta atualizada e a resposta.
 * - gravar { proposta_id, project_id }: cria os itens na agenda pelo mesmo
 *   servico do MCP (createEditorialItem), idempotente por proposta mais indice
 *   do item, preserva o que existe, guarda task_ids, status gravada e registra
 *   na memoria do agente o que foi escolhido e descartado.
 * - planejar_mes { client_id, mensagem, mes, proposta_id?, anexos?, modelo_id?,
 *   raciocinio? }: o agente do mes conversando sobre o planejamento do mes e dos
 *   proximos (prompt geral do cliente mais publicado, aprovado, metricas,
 *   campanhas, hypes e agenda). O que a conversa decide vira o plano combinado
 *   do mes (agente_memoria, "Plano do mês AAAA-MM:"), que propor_temas e
 *   detalhar seguem. Mudanca na proposta volta so como sugestao (anexo mudanca).
 * - aplicar_mudanca { mensagem_id, descartar? }: aplica (ou descarta) a sugestao.
 * - tirar_item / repor_item { proposta_id, tema_id, ... }: apaga um conteudo da
 *   proposta antes de gravar e desfaz.
 * - arquivar_item_agenda / restaurar_item_agenda { client_id, task_id, ... }:
 *   tira da agenda um conteudo gravado (deleted_at, com desfazer), nunca o
 *   aprovado, agendado ou publicado; com arte feita pede confirmar_arte.
 *
 * Regras: contexto so com dado real (nunca inventar); toda leitura e escrita
 * presa ao client_id da proposta; nenhuma falha responde 200.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { carregarModelo, chamarImagem, chamarTexto, cobrarJev, IaMotorErro, modeloPadrao, type ImagemEntrada, type ModeloIa } from "../_shared/ia-motor.ts";
import { decodificar, logoLimpa } from "../_shared/imagem-local.ts";
import { jevPerguntar, JevErro, notaScore, type PerguntaJev } from "../_shared/jev.ts";
import {
  createEditorialItem,
  createEditorialItemSchema,
  deterministicEditorialTaskId,
  requestIdFromTaskSource,
  WriteError,
  type WriteCtx,
} from "../_shared/mcp-write-services.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { direcaoDoRoteiro } from "../_shared/direcao-arte.ts";
import { aplicarFotosDoPlano, pecasDoPlanoGravado } from "../_shared/fotos-do-plano.ts";
export { aplicarFotosDoPlano, pecasDoPlanoGravado };
import { lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";

/**
 * Tempo limite de cada chamada de texto do calendário: propor temas e detalhar o
 * mês com raciocínio alto passam dos 120 s padrão do motor (Outubro, Novembro e
 * Dezembro caíram em 504 em 24/09/2026). A função responde com fôlego.
 */
const TIMEOUT_CALENDARIO_MS = 300_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const AGENTE = "estrategista";
const REF_TIPO = "calendario_proposta";

// Principal fixo do backend para a escrita na agenda. O id da tarefa nasce de
// principal + chave de idempotencia (deterministicEditorialTaskId), entao com
// um principal fixo a mesma proposta e o mesmo item geram sempre a mesma
// tarefa, seja quem for da equipe que clicar em gravar de novo. Quem pediu
// fica no registro de auditoria (mcp_audit_log).
export const PRINCIPAL_MESA = "mesa:agente-calendario";

// Tema por lote no detalhamento e quantos lotes rodam ao mesmo tempo.
const TEMAS_POR_LOTE = 3;
const LOTES_EM_PARALELO = 5;

// Limite da descricao do item editorial (createEditorialItemSchema).
const LIMITE_DESCRICAO = 4000;

export const FORMATOS = ["carrossel", "estatico"] as const;
type Formato = typeof FORMATOS[number];
const FORMATO_PARA_ENTREGA: Record<Formato, "carousel" | "static"> = { carrossel: "carousel", estatico: "static" };

const OBJETIVOS = [
  "viralizacao_descoberta",
  "conscientizacao_educacao",
  "autoridade_confianca",
  "engajamento_relacionamento",
  "conversao_vendas",
] as const;
const ROTULO_OBJETIVO: Record<string, string> = {
  viralizacao_descoberta: "Viralização e descoberta",
  conscientizacao_educacao: "Conscientização e educação",
  autoridade_confianca: "Autoridade e confiança",
  engajamento_relacionamento: "Engajamento e relacionamento",
  conversao_vendas: "Conversão e vendas",
};
const ROTULO_FASE: Record<string, string> = {
  "1": "Fase 1: descoberta, identificação do problema e reconhecimento da marca",
  "2": "Fase 2: educação, diferenciais, funcionamento, localização e quebra de objeções",
  "3": "Fase 3: provas, benefícios, ofertas, conversão, recorrência e indicação",
};

// ------------------------------------------------------------------ tipos

type Tema = {
  id: string;
  tema: string;
  pilar: string;
  fase: string;
  objetivo: string;
  por_que: string;
  formato_sugerido: Formato;
  sazonal: boolean;
  data_sazonal: string | null;
  jev: { aderencia: number | null; potencial: number | null } | null;
  escolhido: boolean;
};

type Card = { ordem: number; funcao: string; texto: string; ilustracao: string; estilo: string };

type Item = {
  tema_id: string;
  data: string;
  formato: Formato;
  pilar: string;
  fase: string;
  publico: string;
  tema: string;
  gancho: string;
  resumo: string;
  copy: string;
  cta: string;
  objetivo: string;
  metrica_principal: string;
  palavra_chave: string;
  termo_regional: string | null;
  status: string;
  tipo_conteudo: "principal" | "extra_sazonal";
  carrossel_infinito: boolean;
  cards: Card[];
  // Preenchido no gravar: a tarefa da agenda deste item (criada ou ja
  // existente). O estudio-arte acha o roteiro dos cards por itens[].task_id.
  task_id?: string | null;
  /** Campanha (mesa_campanhas) a que o conteúdo pertence; o Estúdio segue a identidade dela. */
  campanha_id?: string | null;
};

type Proposta = {
  id: string;
  client_id: string;
  project_id: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  parametros: Record<string, unknown>;
  status: string;
  diagnostico: string | null;
  temas: Tema[];
  itens: Item[];
  conversa_id: string | null;
  task_ids: string[];
  criado_por: string | null;
  criado_em: string;
  gravada_em: string | null;
  /** Tocado pelo gatilho a cada mudança: a sugestão do agente só vale sobre a versão que ela leu. */
  atualizado_em?: string;
};

type Chamador = { userId: string; token: string };

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public extra: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

// ------------------------------------------------------------------ datas

/** Dia da semana de uma data YYYY-MM-DD (0 domingo, 6 sabado), sem fuso. */
function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00.000Z`).getUTCDay();
}

export function ehDiaUtil(data: string): boolean {
  if (!DATA.test(data)) return false;
  const d = diaDaSemana(data);
  return d >= 1 && d <= 5;
}

/** Dias corridos entre duas datas AAAA-MM-DD (fim incluído). */
export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Todos os dias de segunda a sexta do periodo, em ordem. */
export function diasUteisDoPeriodo(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let d = inicio; d <= fim && dias.length < 400; d = somarDias(d, 1)) {
    if (ehDiaUtil(d)) dias.push(d);
  }
  return dias;
}

/**
 * Leva uma data para um dia util dentro do periodo: mantem se ja for; senao o
 * proximo dia util do periodo; sem proximo, o anterior mais perto.
 */
export function normalizarDataUtil(data: string | null | undefined, uteis: string[]): string {
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const d = typeof data === "string" && DATA.test(data) ? data : "";
  if (d && uteis.includes(d)) return d;
  if (!d) return uteis[0];
  const proximo = uteis.find((u) => u >= d);
  return proximo ?? uteis[uteis.length - 1];
}

/**
 * Distribui n publicacoes pelos dias uteis, espalhadas de forma regular.
 * Prefere dias sem item editorial ja existente quando ha dias livres bastantes.
 */
export function distribuirDatas(n: number, uteis: string[], ocupados: Set<string>): string[] {
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const livres = uteis.filter((d) => !ocupados.has(d));
  const base = livres.length >= n ? livres : uteis;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(base[Math.floor((i * base.length) / Math.max(n, 1))]);
  return out;
}

// ------------------------------------------------------------ normalizacao

const texto = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normalizarFormato(v: unknown, cards: unknown[]): Formato {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("carross") || s.includes("carous")) return "carrossel";
  if (s.includes("estat") || s.includes("static")) return "estatico";
  // Qualquer outro formato (reels, video, story) nunca passa: vira carrossel
  // quando ha mais de um card, senao estatico.
  return cards.length > 1 ? "carrossel" : "estatico";
}

function normalizarObjetivo(v: unknown): string {
  const s = String(v ?? "");
  return (OBJETIVOS as readonly string[]).includes(s) ? s : "conscientizacao_educacao";
}

function normalizarFase(v: unknown): string {
  const s = String(v ?? "").replace(/\D/g, "");
  return s === "1" || s === "2" || s === "3" ? s : "2";
}

function normalizarCards(v: unknown, formato: Formato): Card[] {
  const lista = Array.isArray(v) ? v : [];
  let cards = lista
    .map((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        ordem: Number.isFinite(Number(o.ordem)) ? Number(o.ordem) : i + 1,
        funcao: texto(o.funcao, 200),
        texto: texto(o.texto, 1200),
        ilustracao: texto(o.ilustracao, 800),
        estilo: texto(o.estilo, 600),
      };
    })
    .filter((c) => c.texto || c.ilustracao)
    .sort((a, b) => a.ordem - b.ordem);
  if (formato === "estatico") cards = cards.slice(0, 1);
  return cards.slice(0, 20).map((c, i) => ({ ...c, ordem: i + 1 }));
}

export function normalizarItem(bruto: unknown, uteis: string[], dataPadrao?: string): Item {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const cardsBrutos = Array.isArray(o.cards) ? o.cards : [];
  const formato = normalizarFormato(o.formato, cardsBrutos);
  const cards = normalizarCards(cardsBrutos, formato);
  const tipo = String(o.tipo_conteudo ?? "") === "extra_sazonal" ? "extra_sazonal" : "principal";
  return {
    tema_id: texto(o.tema_id, 40),
    // Data sempre de segunda a sexta dentro do periodo.
    data: normalizarDataUtil(dataPadrao ?? (o.data as string), uteis),
    formato,
    pilar: texto(o.pilar, 200),
    fase: normalizarFase(o.fase),
    publico: texto(o.publico, 400),
    tema: texto(o.tema, 200),
    gancho: texto(o.gancho, 400),
    resumo: texto(o.resumo, 1200),
    copy: texto(o.copy, 2200),
    cta: texto(o.cta, 300),
    objetivo: normalizarObjetivo(o.objetivo),
    metrica_principal: texto(o.metrica_principal, 200),
    palavra_chave: texto(o.palavra_chave, 120),
    termo_regional: texto(o.termo_regional, 120) || null,
    status: texto(o.status, 60) || "planejado",
    tipo_conteudo: tipo,
    carrossel_infinito: formato === "carrossel" && o.carrossel_infinito === true,
    cards,
  };
}

function normalizarTema(bruto: unknown, id: string, anterior?: Tema): Tema {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const fmt = String(o.formato_sugerido ?? "").toLowerCase().includes("estat") ? "estatico" : "carrossel";
  return {
    id,
    tema: texto(o.tema, 200),
    pilar: texto(o.pilar, 200),
    fase: normalizarFase(o.fase),
    objetivo: normalizarObjetivo(o.objetivo),
    por_que: texto(o.por_que, 1200),
    formato_sugerido: fmt,
    sazonal: o.sazonal === true,
    data_sazonal: typeof o.data_sazonal === "string" && DATA.test(o.data_sazonal) ? o.data_sazonal : null,
    jev: anterior?.jev ?? null,
    escolhido: typeof o.escolhido === "boolean" ? o.escolhido : anterior?.escolhido ?? false,
  };
}

// ------------------------------------------------------------ esquemas JSON
// Saida estrita: todo campo obrigatorio, sem campo extra; opcional vira null.

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});

const ESQUEMA_TEMA = obj({
  id: S("string"),
  tema: S("string"),
  pilar: S("string"),
  fase: S("string", { enum: ["1", "2", "3"] }),
  objetivo: S("string", { enum: [...OBJETIVOS] }),
  por_que: S("string"),
  formato_sugerido: S("string", { enum: [...FORMATOS] }),
  sazonal: S("boolean"),
  data_sazonal: S(["string", "null"]),
});

const ESQUEMA_CARD = obj({
  ordem: S("integer"),
  funcao: S("string"),
  texto: S("string"),
  ilustracao: S("string"),
  estilo: S("string"),
});

const ESQUEMA_ITEM = obj({
  tema_id: S("string"),
  data: S("string"),
  formato: S("string", { enum: [...FORMATOS] }),
  pilar: S("string"),
  fase: S("string", { enum: ["1", "2", "3"] }),
  publico: S("string"),
  tema: S("string"),
  gancho: S("string"),
  resumo: S("string"),
  copy: S("string"),
  cta: S("string"),
  objetivo: S("string", { enum: [...OBJETIVOS] }),
  metrica_principal: S("string"),
  palavra_chave: S("string"),
  termo_regional: S(["string", "null"]),
  status: S("string"),
  tipo_conteudo: S("string", { enum: ["principal", "extra_sazonal"] }),
  carrossel_infinito: S("boolean"),
  cards: { type: "array", items: ESQUEMA_CARD },
});

export const ESQUEMA_TEMAS = {
  nome: "temas_do_periodo",
  schema: obj({
    diagnostico: S("string"),
    publicos_prioritarios: { type: "array", items: S("string") },
    pilares: { type: "array", items: S("string") },
    pesquisa: S("string"),
    hipoteses: { type: "array", items: S("string") },
    temas: { type: "array", items: ESQUEMA_TEMA },
  }),
};

const ESQUEMA_ITENS = {
  nome: "itens_detalhados",
  schema: obj({ itens: { type: "array", items: ESQUEMA_ITEM } }),
};

const ESQUEMA_CONVERSA = {
  nome: "ajuste_da_proposta",
  schema: obj({
    resposta: S("string"),
    diagnostico: S(["string", "null"]),
    temas: { type: ["array", "null"], items: ESQUEMA_TEMA },
    itens: { type: ["array", "null"], items: ESQUEMA_ITEM },
  }),
};

// ------------------------------------------------------------ banco e acesso

function clienteServico(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente do banco com o JWT de quem chamou: can_access_client le auth.uid(). */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identificar(req: Request, servico: SupabaseClient): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico.auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico.rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa o estrategista.");
  return { userId, token };
}

/** Equipe com acesso ao cliente, conferido no banco com o JWT de quem chamou. */
async function exigirAcessoAoCliente(chamador: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await clienteDoChamador(chamador.token).rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

/**
 * Dias úteis que valem para a proposta. Pedido livre e campanha nascem com o
 * período dos próprios itens (às vezes um dia só); ajustar a data precisa da
 * janela inteira: de hoje (ou do início, se antes) até 30 dias depois do fim.
 */
function diasUteisDaProposta(p: Proposta): string[] {
  const origem = String((p.parametros ?? {}).origem ?? "");
  if (origem !== "pedido_livre") return diasUteisDoPeriodo(p.periodo_inicio, p.periodo_fim);
  const hoje = hojeSaoPaulo();
  const inicio = p.periodo_inicio < hoje ? p.periodo_inicio : hoje;
  const fimBase = p.periodo_fim > hoje ? p.periodo_fim : hoje;
  return diasUteisDoPeriodo(inicio, somarDias(fimBase, 30));
}

async function carregarProposta(servico: SupabaseClient, id: unknown): Promise<Proposta> {
  const pid = String(id ?? "");
  if (!UUID.test(pid)) throw new ErroHttp(400, "proposta_id_invalido", "proposta_id precisa ser um UUID.");
  const { data, error } = await servico.from("calendario_propostas").select("*").eq("id", pid).maybeSingle();
  if (error) throw new ErroHttp(500, "proposta_indisponivel", "Não foi possível ler a proposta.");
  if (!data) throw new ErroHttp(404, "proposta_inexistente", "Proposta não encontrada.");
  const p = data as Proposta;
  p.temas = Array.isArray(p.temas) ? p.temas : [];
  p.itens = Array.isArray(p.itens) ? p.itens : [];
  p.parametros = (p.parametros ?? {}) as Record<string, unknown>;
  p.task_ids = Array.isArray(p.task_ids) ? p.task_ids : [];
  return p;
}

/** Atualiza a proposta sempre presa ao client_id dela. */
async function salvarProposta(servico: SupabaseClient, p: Proposta, campos: Record<string, unknown>): Promise<Proposta> {
  const { data, error } = await servico
    .from("calendario_propostas")
    .update(campos)
    .eq("id", p.id)
    .eq("client_id", p.client_id)
    .select("*")
    .single();
  if (error || !data) throw new ErroHttp(500, "proposta_nao_salva", "Não foi possível salvar a proposta.");
  return data as Proposta;
}

async function garantirConversa(servico: SupabaseClient, p: Proposta, userId: string): Promise<string> {
  if (p.conversa_id) return p.conversa_id;
  const { data, error } = await servico
    .from("agente_conversas")
    .insert({ client_id: p.client_id, agente: AGENTE, referencia_tipo: REF_TIPO, referencia_id: p.id, criado_por: userId })
    .select("id")
    .single();
  if (error || !data) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente.");
  await salvarProposta(servico, p, { conversa_id: data.id });
  p.conversa_id = data.id;
  return data.id;
}

async function registrarMensagens(
  servico: SupabaseClient,
  conversaId: string,
  clientId: string,
  msgs: Array<{ papel: "usuario" | "agente" | "sistema"; conteudo: string; uso_id?: string | null; anexos?: unknown[] }>,
) {
  const base = Date.now();
  const linhas = msgs
    .filter((m) => m.conteudo.trim())
    .map((m, i) => ({
      conversa_id: conversaId,
      client_id: clientId,
      criado_em: new Date(base + i).toISOString(),
      papel: m.papel,
      conteudo: m.conteudo.slice(0, 20000),
      anexos: m.anexos ?? [],
      uso_id: m.uso_id ?? null,
    }));
  if (linhas.length === 0) return;
  const { error } = await servico.from("agente_mensagens").insert(linhas);
  if (error) console.error("[agente-calendario] mensagens nao gravadas", { conversa_id: conversaId, code: error.code });
}

// ------------------------------------------------------------ contexto real

type Contexto = {
  cliente: { nome: string; instagram: string | null };
  dossie: string | null;
  movimentos: unknown[];
  metricas: { posts: { melhores_por_alcance: unknown[]; melhores_por_salvamento_e_compartilhamento: unknown[]; piores_por_alcance: unknown[]; total_lidos: number }; semanas: unknown[] };
  agenda_no_periodo: { tarefas: unknown[]; posts: unknown[] };
  titulos_recentes: string[];
  kit_marca: unknown | null;
  memoria: Array<{ tipo: string; texto: string }>;
  /** O que a conversa com o agente do mês combinou para cada mês (o mais novo de cada mês). */
  planos: Array<{ mes: string; texto: string }>;
  datasOcupadas: Set<string>;
  prompt: string;
};

const corta = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : v ?? null);

// ------------------------------------------------------------ plano combinado

/**
 * O plano de cada mês que a equipe combina conversando com o agente do mês
 * mora na memória do estrategista (agente_memoria), uma linha ativa por mês,
 * com o texto começando por "Plano do mês AAAA-MM:". Assim ele entra no
 * contexto de todas as ações (propor temas, detalhar, conversar) sem tabela nova.
 */
export const PREFIXO_PLANO = "Plano do mês ";
const MES_DO_PLANO = /^Plano do mês (\d{4}-\d{2}):/;

export function mesDoPlano(t: string): string | null {
  const m = MES_DO_PLANO.exec(String(t ?? ""));
  return m ? m[1] : null;
}

/** O plano mais novo de cada mês, na ordem em que chegaram (mais novo primeiro). */
export function planosUnicos(linhas: Array<{ texto: string }>): Array<{ mes: string; texto: string }> {
  const vistos = new Set<string>();
  const saida: Array<{ mes: string; texto: string }> = [];
  for (const l of linhas) {
    const mes = mesDoPlano(l.texto);
    if (!mes || vistos.has(mes)) continue;
    vistos.add(mes);
    saida.push({ mes, texto: l.texto });
  }
  return saida;
}

/** Bloco do plano combinado para o mês do período (vazio quando não há). */
export function blocoDoPlano(ctx: Pick<Contexto, "planos">, inicio: string): string {
  const plano = ctx.planos.find((p) => p.mes === inicio.slice(0, 7));
  if (!plano) return "";
  return `\n\nPLANO COMBINADO COM A EQUIPE PARA ESTE MÊS (decidido na conversa com o agente do mês; siga, a não ser que o pedido desta execução diga outra coisa):\n${plano.texto}`;
}

/**
 * Monta o contexto do estrategista so com dado real do banco. O que nao existe
 * vai como vazio ou null, nunca preenchido.
 */
async function montarContexto(servico: SupabaseClient, clientId: string, inicio: string, fim: string): Promise<Contexto> {
  const hoje = new Date();
  const ha60 = new Date(hoje.getTime() - 60 * 86_400_000).toISOString();
  const ha180 = new Date(hoje.getTime() - 180 * 86_400_000).toISOString();

  const { data: projetos } = await servico
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .limit(200);
  const projectIds = (projetos ?? []).map((p: { id: string }) => p.id);

  const [
    perfil,
    conta,
    dossie,
    movimentos,
    posts,
    semanas,
    tarefasPeriodo,
    tarefasRecentes,
    postsEditoriais,
    kit,
    memoria,
    prompts,
    planos,
  ] = await Promise.all([
    servico.from("profiles").select("full_name, company_name").eq("id", clientId).maybeSingle(),
    servico.from("external_accounts").select("handle, display_name").eq("client_id", clientId).eq("platform", "instagram").eq("status", "active").limit(1),
    // Dossie geral atual: contexto, sem projeto.
    servico.from("client_dossiers").select("content, summary, version, effective_at")
      .eq("client_id", clientId).eq("dossier_type", "contexto").eq("is_current", true).is("project_id", null).maybeSingle(),
    // SECURITY DEFINER com confianca de backend: chamada pelo cliente de servico.
    servico.rpc("movimentos_do_cliente", { _client_id: clientId, _desde: ha60, _ate: hoje.toISOString(), _somente_visiveis: false }),
    servico.from("social_post_metrics")
      .select("media_type, caption, permalink, posted_at, like_count, comments_count, reach, saved, shares, total_interactions")
      .eq("client_id", clientId).gte("posted_at", ha180).order("posted_at", { ascending: false }).limit(300),
    servico.from("social_metrics_weekly")
      .select("week_start, week_end, followers, reach, profile_views, accounts_engaged, total_interactions")
      .eq("client_id", clientId).order("week_start", { ascending: false }).limit(8),
    projectIds.length
      ? servico.from("tasks").select("title, delivery_type, due_date, status")
        .in("project_id", projectIds).not("delivery_type", "is", null).is("deleted_at", null)
        .gte("due_date", inicio).lte("due_date", fim).order("due_date").limit(200)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    projectIds.length
      ? servico.from("tasks").select("title, due_date")
        .in("project_id", projectIds).in("delivery_type", ["carousel", "static", "design"]).is("deleted_at", null)
        .gte("due_date", ha60.slice(0, 10)).lt("due_date", inicio).order("due_date", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    servico.from("editorial_posts")
      .select("title, content_type, objective, production_status, editorial_publications(scheduled_at, status)")
      .eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    servico.from("cliente_kit_marca").select("paleta, estilo, regras, contexto").eq("client_id", clientId).maybeSingle(),
    servico.from("agente_memoria").select("tipo, texto").eq("client_id", clientId).eq("agente", AGENTE).eq("ativa", true)
      .order("criado_em", { ascending: false }).limit(60),
    servico.from("agente_prompts").select("client_id, conteudo, versao").eq("agente", AGENTE).eq("ativo", true)
      .or(`client_id.is.null,client_id.eq.${clientId}`),
    // Planos combinados na conversa do agente do mês (uma linha ativa por mês).
    servico.from("agente_memoria").select("texto, criado_em").eq("client_id", clientId).eq("agente", AGENTE).eq("ativa", true)
      .like("texto", `${PREFIXO_PLANO}%`).order("criado_em", { ascending: false }).limit(24),
  ]);

  // Prompt efetivo: global ativo + complemento ativo do cliente.
  const linhasPrompt = (prompts.data ?? []) as Array<{ client_id: string | null; conteudo: string }>;
  const global = linhasPrompt.find((l) => l.client_id === null)?.conteudo?.trim();
  if (!global) {
    throw new ErroHttp(409, "prompt_global_ausente", "Não há prompt global ativo do estrategista em agente_prompts.");
  }
  const complemento = linhasPrompt.find((l) => l.client_id === clientId)?.conteudo?.trim();
  const prompt = complemento ? `${global}\n\nCOMPLEMENTO DESTE CLIENTE:\n${complemento}` : global;

  // Metricas de post: melhores e piores, so dos posts que tem o numero.
  type Post = { media_type: string | null; caption: string | null; permalink: string | null; posted_at: string | null; like_count: number | null; comments_count: number | null; reach: number | null; saved: number | null; shares: number | null; total_interactions: number | null };
  const lista = ((posts.data ?? []) as Post[]).map((p) => ({ ...p, caption: corta(p.caption, 220) as string | null }));
  const comAlcance = lista.filter((p) => typeof p.reach === "number");
  const porAlcance = [...comAlcance].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  const comSalvamento = lista.filter((p) => typeof p.saved === "number" || typeof p.shares === "number");
  const porSalvamento = [...comSalvamento].sort((a, b) => ((b.saved ?? 0) + (b.shares ?? 0)) - ((a.saved ?? 0) + (a.shares ?? 0)));

  // Itens editoriais do periodo: tarefas e publicacoes agendadas no periodo.
  type PostEd = { title: string; content_type: string; objective: string | null; production_status: string; editorial_publications: Array<{ scheduled_at: string | null; status: string }> | null };
  const postsNoPeriodo = ((postsEditoriais.data ?? []) as PostEd[])
    .map((p) => ({
      titulo: p.title,
      formato: p.content_type,
      objetivo: p.objective,
      producao: p.production_status,
      publicacoes: (p.editorial_publications ?? []).filter((x) => x.scheduled_at && x.scheduled_at.slice(0, 10) >= inicio && x.scheduled_at.slice(0, 10) <= fim),
    }))
    .filter((p) => p.publicacoes.length > 0);

  const tarefas = (tarefasPeriodo.data ?? []) as Array<{ title: string; delivery_type: string; due_date: string; status: string }>;
  const datasOcupadas = new Set<string>([
    ...tarefas.map((t) => t.due_date).filter(Boolean),
    ...postsNoPeriodo.flatMap((p) => p.publicacoes.map((x) => String(x.scheduled_at).slice(0, 10))),
  ]);

  const perfilDados = perfil.data as { full_name: string | null; company_name: string | null } | null;
  const contaIg = ((conta.data ?? []) as Array<{ handle: string | null; display_name: string }>)[0];
  const dossieDados = dossie.data as { content: string; summary: string | null; version: number; effective_at: string } | null;

  return {
    cliente: {
      nome: perfilDados?.company_name?.trim() || perfilDados?.full_name?.trim() || "Cliente sem nome no cadastro",
      instagram: contaIg?.handle ? `@${contaIg.handle.replace(/^@/, "")}` : null,
    },
    dossie: dossieDados ? `Versão ${dossieDados.version} (${String(dossieDados.effective_at).slice(0, 10)}):\n${dossieDados.content.slice(0, 14000)}` : null,
    movimentos: ((movimentos.data ?? []) as Array<Record<string, unknown>>).slice(0, 150).map((m) => ({
      quando: String(m.quando ?? "").slice(0, 10),
      tipo: m.tipo,
      titulo: corta(m.titulo, 160),
      detalhe: corta(m.detalhe, 200),
    })),
    metricas: {
      posts: {
        melhores_por_alcance: porAlcance.slice(0, 5),
        melhores_por_salvamento_e_compartilhamento: porSalvamento.slice(0, 5),
        piores_por_alcance: porAlcance.slice(-5).reverse(),
        total_lidos: lista.length,
      },
      semanas: semanas.data ?? [],
    },
    agenda_no_periodo: { tarefas, posts: postsNoPeriodo },
    titulos_recentes: ((tarefasRecentes.data ?? []) as Array<{ title: string }>).map((t) => t.title).slice(0, 60),
    kit_marca: kit.data ?? null,
    // O plano do mês vai em campo próprio (planos), não misturado na memória.
    memoria: ((memoria.data ?? []) as Array<{ tipo: string; texto: string }>).filter((m) => !mesDoPlano(m.texto)),
    planos: planosUnicos((planos.data ?? []) as Array<{ texto: string }>),
    datasOcupadas,
    prompt,
  };
}

function contextoEmTexto(ctx: Contexto, p: { inicio: string; fim: string; parametros: Record<string, unknown> }): string {
  const dados = {
    cliente: ctx.cliente.nome,
    instagram: ctx.cliente.instagram,
    periodo: { inicio: p.inicio, fim: p.fim },
    frequencia: p.parametros.frequencia ?? null,
    objetivo_principal: p.parametros.objetivo ?? null,
    oferta_principal: p.parametros.oferta ?? null,
    regiao: p.parametros.regiao ?? null,
    dossie_geral_atual: ctx.dossie,
    movimentos_ultimos_60_dias: ctx.movimentos,
    metricas_instagram: ctx.metricas,
    agenda_ja_existente_no_periodo: ctx.agenda_no_periodo,
    titulos_publicados_ou_planejados_nos_ultimos_60_dias: ctx.titulos_recentes,
    kit_de_marca: ctx.kit_marca,
    memoria_do_estrategista: ctx.memoria,
    planos_combinados_com_a_equipe: ctx.planos,
  };
  return `DADOS REAIS DO CLIENTE (JSON, lidos do painel agora; campo vazio ou null significa que o dado não existe no painel):\n${JSON.stringify(dados, null, 1)}`;
}

const REGRAS_DE_SAIDA = `
REGRAS DESTA EXECUÇÃO NO PAINEL:
- Use somente os dados reais recebidos e o que a pesquisa na web trouxer. Nunca invente métrica, resultado, diferencial ou informação local. Dado ausente vira hipótese declarada.
- Formatos permitidos: somente carrossel ou post estático. Nunca reels, vídeo, stories ou live.
- Publicações só de segunda a sexta, dentro do período.
- Evite repetir temas que já estão na agenda do período ou nos títulos recentes.
- Siga a memória do estrategista (preferências, aprendizados e o que evitar).
- Português do Brasil, sem travessões.
- Responda somente com o JSON pedido.`;

// ------------------------------------------------------------ modelo e erros

/**
 * Raciocinio padrao quando o usuario nao escolhe: o mais alto aceito pelo
 * modelo; com pesquisa na web, high (max com pesquisa arrisca estourar os
 * 120 s do motor). A escolha explicita do usuario sempre prevalece.
 */
export function raciocinioPadrao(aceitos: string[], pesquisaWeb: boolean): string | undefined {
  if (pesquisaWeb && aceitos.includes("high")) return "high";
  return aceitos[aceitos.length - 1] || undefined;
}

async function resolverModelo(
  modeloId: unknown,
  raciocinio: unknown,
  opcoes: { pesquisaWeb?: boolean } = {},
): Promise<{ modelo: ModeloIa; raciocinio: string | undefined; raciocinioExplicito: boolean }> {
  let modelo: ModeloIa | null;
  if (typeof modeloId === "string" && modeloId.trim()) modelo = await carregarModelo(modeloId.trim(), "texto");
  else modelo = await modeloPadrao(AGENTE);
  if (!modelo) throw new ErroHttp(409, "sem_modelo_padrao", "Nenhum modelo do catálogo está marcado como padrão do estrategista.");
  const explicito = typeof raciocinio === "string" && raciocinio.trim() ? raciocinio.trim() : null;
  const r = explicito ?? raciocinioPadrao(modelo.raciocinio ?? [], opcoes.pesquisaWeb === true);
  return { modelo, raciocinio: r || undefined, raciocinioExplicito: explicito !== null };
}

// Mensagens claras para os erros de dinheiro e chave. Nunca 200.
const MENSAGEM_ERRO_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA deste cliente. Peça a recarga a um admin ou manager." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou. Ajuste a cota ou aguarde o próximo mês." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 403, mensagem: "O provedor deste modelo está sem chave de API configurada. Escolha outro modelo ou peça a configuração da chave." },
};

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_ERRO_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  if (err instanceof WriteError) {
    const status = err.code === "forbidden" ? 403 : err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
    return json({ error: `agenda_${err.code}`, mensagem: err.message }, status);
  }
  console.error("[agente-calendario] erro inesperado", { nome: err instanceof Error ? err.name : "desconhecido" });
  return json({ error: "erro_interno", mensagem: "Falha inesperada no estrategista." }, 500);
}

// ------------------------------------------------------------ Jev

const NIVEIS_ADERENCIA = [
  "O tema não tem relação com o objetivo principal nem com a oferta do cliente.",
  "O tema toca o nicho do cliente, mas quase não ajuda o objetivo principal.",
  "O tema ajuda o objetivo principal de forma indireta, em algum momento da jornada.",
  "O tema serve claramente ao objetivo principal e conversa com a oferta do cliente.",
  "O tema é um caminho direto e específico para o objetivo principal, feito sob medida para este cliente e esta região.",
];

const NIVEIS_POTENCIAL = [
  "Conteúdo genérico, que ninguém salvaria nem mandaria para alguém.",
  "Pouco útil fora do momento; salvamento e envio só por acaso.",
  "Útil para parte do público; algumas pessoas salvariam ou mandariam para alguém.",
  "Resolve uma dúvida real com informação aplicável; boa chance de ser salvo e enviado.",
  "Referência prática ou identificação forte que o público guarda e manda para outras pessoas de propósito.",
];

/** Normaliza a nota do Score (0 a niveis-1) para 0 a 10 com uma casa. */
const notaDe0a10 = (n: number | null, niveis: number) => (n == null ? null : Math.round((n / (niveis - 1)) * 100) / 10);

/**
 * O Jev pontua cada tema em duas dimensoes, com Score de niveis ordenados.
 * Falha do Jev nao derruba a proposta (os temas ja custaram): nota fica null.
 */
async function pontuarTemasComJev(
  temas: Tema[],
  base: { cliente: string; objetivo: unknown; oferta: unknown; regiao: unknown; diagnostico: string | null },
  cobranca: { clientId: string; propostaId: string; criadoPor: string },
): Promise<{ temas: Tema[]; jev_erro: string | null; custo: number }> {
  if (temas.length === 0) return { temas, jev_erro: null, custo: 0 };
  const state = {
    cliente: base.cliente,
    objetivo_principal: base.objetivo ?? "não informado",
    oferta_principal: base.oferta ?? "não informada",
    regiao: base.regiao ?? "não informada",
    diagnostico: base.diagnostico ?? "",
    temas: temas.map((t) => ({ tema: t.tema, pilar: t.pilar, objetivo_do_post: ROTULO_OBJETIVO[t.objetivo], por_que: t.por_que })),
  };
  const questions: Record<string, PerguntaJev> = {};
  temas.forEach((_, i) => {
    questions[`aderencia_${i}`] = {
      type: "score",
      instructions: `Quanto o tema \`temas[${i}]\` serve ao \`objetivo_principal\` do cliente, considerando a \`oferta_principal\`, a \`regiao\` e o \`diagnostico\`?`,
      criteria: NIVEIS_ADERENCIA,
    };
    questions[`potencial_${i}`] = {
      type: "score",
      instructions: `Como carrossel ou post estático no Instagram, quanto o tema \`temas[${i}]\` tende a ser salvo e compartilhado pelo público deste cliente?`,
      criteria: NIVEIS_POTENCIAL,
    };
  });
  try {
    const r = await jevPerguntar({ state, questions });
    const cobrado = await cobrarJev(r, {
      clientId: cobranca.clientId,
      tarefa: "calendario",
      referencia: { tipo: REF_TIPO, id: cobranca.propostaId },
      criadoPor: cobranca.criadoPor,
    });
    return {
      custo: cobrado?.custoUsd ?? 0,
      temas: temas.map((t, i) => ({
        ...t,
        jev: {
          aderencia: notaDe0a10(notaScore(r.answers[`aderencia_${i}`]), NIVEIS_ADERENCIA.length),
          potencial: notaDe0a10(notaScore(r.answers[`potencial_${i}`]), NIVEIS_POTENCIAL.length),
        },
      })),
      jev_erro: null,
    };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[agente-calendario] jev falhou", { codigo });
    return { temas, jev_erro: codigo, custo: 0 };
  }
}

// ------------------------------------------------------------ acoes

async function proporTemas(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const inicio = String(corpo.periodo_inicio ?? "");
  const fim = String(corpo.periodo_fim ?? "");
  if (!DATA.test(inicio) || !DATA.test(fim) || fim < inicio) {
    throw new ErroHttp(400, "periodo_invalido", "Informe periodo_inicio e periodo_fim (AAAA-MM-DD), com o fim depois do início.");
  }
  // Um mês por chamada: período longo com pesquisa na web estoura o tempo do
  // provedor. Para vários meses, a tela chama mês a mês.
  if (diasEntre(inicio, fim) > 31) {
    throw new ErroHttp(400, "periodo_longo", "Planeje até 31 dias por vez. Para vários meses, use Planejar vários meses: o estrategista faz um mês de cada vez.");
  }
  const uteis = diasUteisDoPeriodo(inicio, fim);
  if (uteis.length === 0) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const frequencia = Number(corpo.frequencia);
  if (!Number.isFinite(frequencia) || frequencia < 1 || frequencia > 200) {
    throw new ErroHttp(400, "frequencia_invalida", "Informe a frequência: quantas publicações no período.");
  }
  let projectId: string | null = null;
  if (corpo.project_id != null && corpo.project_id !== "") {
    projectId = String(corpo.project_id);
    await exigirProjetoDoCliente(servico, projectId, clientId);
  }

  // Com pesquisa na web o padrao e high; a escolha explicita prevalece.
  const { modelo, raciocinio, raciocinioExplicito } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, { pesquisaWeb: true });
  const parametros: Record<string, unknown> = {
    frequencia: Math.round(frequencia),
    objetivo: texto(corpo.objetivo, 500) || null,
    oferta: texto(corpo.oferta, 500) || null,
    regiao: texto(corpo.regiao, 500) || null,
    modelo: modelo.id,
    // So a escolha do usuario vira parametro da proposta; o padrao de cada
    // etapa (com ou sem pesquisa) e decidido de novo em cada chamada.
    raciocinio: raciocinioExplicito ? raciocinio : null,
    raciocinio_temas: raciocinio ?? null,
  };

  const ctx = await montarContexto(servico, clientId, inicio, fim);

  // A proposta e a conversa nascem com ids conhecidos antes da chamada, para o
  // uso de IA ja ficar ligado a proposta.
  const propostaId = crypto.randomUUID();
  const { data: conversa, error: erroConversa } = await servico
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE, referencia_tipo: REF_TIPO, referencia_id: propostaId, criado_por: chamador.userId })
    .select("id")
    .single();
  if (erroConversa || !conversa) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente.");

  // Temas pela frequência pedida: meta de mais de 15 posts no mês não cabia em 15 temas.
  const maxTemas = Math.min(30, Math.max(15, Math.round(Number(parametros.frequencia) || 0)));
  const pedido = `Proponha de 8 a ${maxTemas} temas para o período de ${inicio} a ${fim}, com ${parametros.frequencia} publicações no período.`
    + (parametros.objetivo ? ` Objetivo principal: ${parametros.objetivo}.` : "")
    + (parametros.oferta ? ` Oferta principal: ${parametros.oferta}.` : "")
    + (parametros.regiao ? ` Região: ${parametros.regiao}.` : "");

  const instrucao = `${contextoEmTexto(ctx, { inicio, fim, parametros })}

TAREFA: ${pedido}${blocoDoPlano(ctx, inicio)}
Antes, pesquise na web dúvidas, buscas, comportamentos, datas sazonais e oportunidades do nicho e da região deste cliente.
Devolva:
- diagnostico: diagnóstico resumido a partir dos dados reais (melhores e piores conteúdos, o que as métricas mostram, o que falta).
- publicos_prioritarios e pilares.
- pesquisa: o que a pesquisa na web trouxe de útil, com as fontes (links) usadas.
- hipoteses: o que precisou ser suposto por falta de dado.
- temas: de 8 a ${maxTemas}, cada um com id (t1, t2, ...), tema, pilar, fase (1, 2 ou 3), objetivo (um só), por_que (ligado a dado real ou à pesquisa), formato_sugerido (carrossel ou estatico), sazonal e data_sazonal (AAAA-MM-DD ou null).`;

  let saida;
  try {
    saida = await chamarTexto({
      clientId,
      tarefa: "calendario",
      agente: AGENTE,
      modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
      sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
      mensagens: [{ papel: "usuario", conteudo: instrucao }],
      raciocinio,
      pesquisaWeb: true,
      esquemaJson: ESQUEMA_TEMAS,
      referencia: { tipo: REF_TIPO, id: propostaId },
      criadoPor: chamador.userId,
    });
  } catch (err) {
    // Sem proposta, a conversa aberta fica orfa: apaga (so a desta chamada).
    await servico.from("agente_conversas").delete().eq("id", conversa.id).eq("client_id", clientId);
    throw err;
  }

  const r = (saida.json ?? {}) as Record<string, unknown>;
  const temasBrutos = Array.isArray(r.temas) ? r.temas : [];
  let temas = temasBrutos.slice(0, maxTemas).map((t, i) => normalizarTema(t, `t${i + 1}`)).filter((t) => t.tema);
  const diagnostico = [
    texto(r.diagnostico, 6000),
    Array.isArray(r.publicos_prioritarios) && r.publicos_prioritarios.length ? `Públicos prioritários: ${r.publicos_prioritarios.map(String).join("; ")}.` : "",
    Array.isArray(r.pilares) && r.pilares.length ? `Pilares: ${r.pilares.map(String).join("; ")}.` : "",
    texto(r.pesquisa, 4000) ? `Pesquisa: ${texto(r.pesquisa, 4000)}` : "",
    Array.isArray(r.hipoteses) && r.hipoteses.length ? `Hipóteses (dado indisponível): ${r.hipoteses.map(String).join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");

  const jev = await pontuarTemasComJev(temas, {
    cliente: ctx.cliente.nome,
    objetivo: parametros.objetivo,
    oferta: parametros.oferta,
    regiao: parametros.regiao,
    diagnostico,
  }, { clientId, propostaId, criadoPor: chamador.userId });
  temas = jev.temas;
  if (jev.jev_erro) parametros.jev_erro = jev.jev_erro;
  if (temas.length < 8) parametros.aviso = `O modelo devolveu ${temas.length} temas (o pedido era de 8 a ${maxTemas}).`;

  const { data: proposta, error } = await servico
    .from("calendario_propostas")
    .insert({
      id: propostaId,
      client_id: clientId,
      project_id: projectId,
      periodo_inicio: inicio,
      periodo_fim: fim,
      parametros,
      status: "temas",
      diagnostico,
      temas,
      itens: [],
      conversa_id: conversa.id,
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (error || !proposta) throw new ErroHttp(500, "proposta_nao_salva", "Os temas foram gerados, mas a proposta não foi salva.", { uso_id: saida.usoId });

  await registrarMensagens(servico, conversa.id, clientId, [
    { papel: "usuario", conteudo: pedido },
    {
      papel: "agente",
      conteudo: `${diagnostico}\n\nTemas:\n${temas.map((t) => `${t.id}. ${t.tema} (${ROTULO_OBJETIVO[t.objetivo]}, fase ${t.fase})`).join("\n")}`,
      uso_id: saida.usoId,
    },
  ]);

  return json({ proposta, custo_usd: Math.round((saida.custoUsd + jev.custo) * 1e6) / 1e6, saldo_usd: saida.saldoUsd, jev_erro: jev.jev_erro, reserva_usada: saida.reservaUsada ?? null });
}

async function escolherTemas(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const ids = Array.isArray(corpo.temas) ? corpo.temas.map(String) : [];
  const validos = new Set(p.temas.map((t) => t.id));
  const escolhidos = new Set(ids.filter((id) => validos.has(id)));
  if (escolhidos.size === 0) throw new ErroHttp(400, "nenhum_tema_valido", "Escolha ao menos um tema da proposta.");

  const temas = p.temas.map((t) => ({ ...t, escolhido: escolhidos.has(t.id) }));
  // Itens de temas que deixaram de ser escolhidos saem; os outros ficam.
  const itens = p.itens.filter((i) => escolhidos.has(i.tema_id));
  const faltam = [...escolhidos].filter((id) => !itens.some((i) => i.tema_id === id));
  const status = itens.length > 0 && faltam.length === 0 ? "pronta" : itens.length > 0 ? "detalhando" : "temas";
  const atualizada = await salvarProposta(servico, p, { temas, itens, status });

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "usuario", conteudo: `Temas escolhidos: ${temas.filter((t) => t.escolhido).map((t) => t.tema).join("; ")}.` },
  ]);
  return json({ proposta: atualizada });
}

async function detalhar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const escolhidos = p.temas.filter((t) => t.escolhido);
  if (escolhidos.length === 0) throw new ErroHttp(409, "sem_tema_escolhido", "Escolha os temas antes de detalhar.");

  const uteis = diasUteisDoPeriodo(p.periodo_inicio, p.periodo_fim);
  const ctx = await montarContexto(servico, p.client_id, p.periodo_inicio, p.periodo_fim);
  const { modelo, raciocinio } = await resolverModelo(
    corpo.modelo_id ?? p.parametros.modelo,
    corpo.raciocinio ?? p.parametros.raciocinio,
  );

  // Datas calculadas no codigo, em ordem de fase: so segunda a sexta.
  const ordenados = [...escolhidos].sort((a, b) => a.fase.localeCompare(b.fase));
  const datas = distribuirDatas(ordenados.length, uteis, ctx.datasOcupadas);
  const dataDoTema = new Map<string, string>();
  ordenados.forEach((t, i) => {
    // Tema sazonal com data util dentro do periodo fica na propria data.
    const d = t.sazonal && t.data_sazonal && uteis.includes(t.data_sazonal) ? t.data_sazonal : datas[i];
    dataDoTema.set(t.id, d);
  });

  const jaFeitos = new Map(p.itens.filter((i) => escolhidos.some((t) => t.id === i.tema_id)).map((i) => [i.tema_id, i]));
  const pendentes = ordenados.filter((t) => !jaFeitos.has(t.id));

  await salvarProposta(servico, p, { status: "detalhando" });

  const lotes: Tema[][] = [];
  for (let i = 0; i < pendentes.length; i += TEMAS_POR_LOTE) lotes.push(pendentes.slice(i, i + TEMAS_POR_LOTE));

  const base = `${contextoEmTexto(ctx, { inicio: p.periodo_inicio, fim: p.periodo_fim, parametros: p.parametros })}${blocoDoPlano(ctx, p.periodo_inicio)}

DIAGNÓSTICO JÁ FEITO:
${p.diagnostico ?? ""}

TODOS OS TEMAS ESCOLHIDOS (para não repetir estrutura nem gancho entre eles):
${ordenados.map((t) => `${t.id}. ${t.tema} (fase ${t.fase}, ${ROTULO_OBJETIVO[t.objetivo]})`).join("\n")}

TEMAS DESCARTADOS PELA EQUIPE (não usar):
${p.temas.filter((t) => !t.escolhido).map((t) => `- ${t.tema}`).join("\n") || "- nenhum"}`;

  const usos: string[] = [];
  let custo = 0;
  let saldo: number | null = null;

  const rodarLote = async (lote: Tema[]) => {
    const pedido = `${base}

TAREFA: detalhe uma publicação para cada tema abaixo, com todos os campos do calendário.
${lote.map((t) => `- tema_id ${t.id}: "${t.tema}" | pilar ${t.pilar} | fase ${t.fase} | objetivo ${t.objetivo} | formato sugerido ${t.formato_sugerido} | data ${dataDoTema.get(t.id)} | por que: ${t.por_que}`).join("\n")}
Regras dos itens:
- formato: carrossel ou estatico. Estático tem exatamente 1 card.
- cards: roteiro de cada card em ordem (ordem, funcao como capa, desenvolvimento ou CTA final, texto exato do card, ilustracao que acompanha, estilo visual respeitando o kit de marca). A história é uma só: a capa abre uma tensão com um gancho forte, cada card avança um passo e prepara o próximo com texto corrido e conectivos, nunca frases soltas; o CTA fecha a história. As ilustracoes formam UMA série: a mesma protagonista, o mesmo cenário e a mesma luz do começo ao fim (descreva a protagonista igual em todos os cards), variando só a pose, o gesto e o enquadramento (nunca a mesma pose em dois cards seguidos); prefira foto real do cliente quando o contexto tiver. Quantidade de cards pelo conteúdo: o mínimo que conta a história, em geral 4 a 6; 7 ou mais só quando o conteúdo pede. Nunca escreva o nome da marca no texto dos cards. Não repita tema, gancho nem imagem de posts recentes.
- carrossel_infinito: true quando o carrossel for uma cena panorâmica contínua (o fundo atravessa os cards e o último se liga ao primeiro) e isso fizer sentido para o tema.
- copy: a legenda completa do post.
- data: use exatamente a data indicada para o tema.
- tipo_conteudo: extra_sazonal só para conteúdo de data sazonal marcado como extra; senão principal.
- status: planejado.`;
    const s = await chamarTexto({
      clientId: p.client_id,
      tarefa: "calendario",
      agente: AGENTE,
      modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
      sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
      mensagens: [{ papel: "usuario", conteudo: pedido }],
      raciocinio,
      esquemaJson: ESQUEMA_ITENS,
      referencia: { tipo: REF_TIPO, id: p.id },
      criadoPor: chamador.userId,
    });
    usos.push(s.usoId);
    custo += s.custoUsd;
    saldo = s.saldoUsd;
    const brutos = Array.isArray((s.json as Record<string, unknown>)?.itens) ? (s.json as { itens: unknown[] }).itens : [];
    const novos: Item[] = [];
    for (const t of lote) {
      const bruto = brutos.find((b) => String((b as Record<string, unknown>)?.tema_id ?? "") === t.id) ?? brutos[lote.indexOf(t)];
      if (!bruto) continue;
      const item = normalizarItem(bruto, uteis, dataDoTema.get(t.id));
      item.tema_id = t.id;
      if (!item.tema) item.tema = t.tema;
      novos.push(item);
    }
    return novos;
  };

  // Pool simples: ate LOTES_EM_PARALELO chamadas ao mesmo tempo.
  const resultados: PromiseSettledResult<Item[]>[] = new Array(lotes.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const i = proximo++;
      try {
        resultados[i] = { status: "fulfilled", value: await rodarLote(lotes[i]) };
      } catch (reason) {
        resultados[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOTES_EM_PARALELO, lotes.length) }, trabalhador));

  const novos = resultados.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const falha = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;

  const itens = [...jaFeitos.values(), ...novos]
    .map((i) => ({ ...i, data: normalizarDataUtil(i.data, uteis) }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const faltam = ordenados.filter((t) => !itens.some((i) => i.tema_id === t.id)).map((t) => t.id);
  const status = faltam.length === 0 ? "pronta" : "detalhando";
  const atualizada = await salvarProposta(servico, p, { itens, status });

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  await registrarMensagens(servico, conversaId, p.client_id, [
    {
      papel: "agente",
      conteudo: `Detalhei ${novos.length} publicação(ões).${faltam.length ? ` Faltam: ${faltam.join(", ")}.` : " Proposta pronta para revisar e gravar."}`,
      uso_id: usos[0] ?? null,
      anexos: usos.slice(1).map((id) => ({ uso_id: id })),
    },
  ]);

  if (falha) {
    // Parte ficou salva; a proxima chamada so refaz o que falta. Nunca 200.
    const resposta = respostaDeErro(falha.reason);
    const corpoErro = await resposta.json();
    return json({ ...corpoErro, proposta: atualizada, faltam, custo_usd: custo, saldo_usd: saldo }, resposta.status);
  }
  return json({ proposta: atualizada, faltam, custo_usd: custo, saldo_usd: saldo });
}

async function conversar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o ajuste que você quer na proposta.");

  const uteis = diasUteisDaProposta(p);
  const ctx = await montarContexto(servico, p.client_id, p.periodo_inicio, p.periodo_fim);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id ?? p.parametros.modelo, corpo.raciocinio ?? p.parametros.raciocinio);
  const conversaId = await garantirConversa(servico, p, chamador.userId);

  const { data: historico } = await servico
    .from("agente_mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversaId)
    .eq("client_id", p.client_id)
    .order("criado_em", { ascending: false })
    .limit(20);
  const anteriores = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 4000) }));

  const pedido = `${contextoEmTexto(ctx, { inicio: p.periodo_inicio, fim: p.periodo_fim, parametros: p.parametros })}

PROPOSTA ATUAL (JSON):
${JSON.stringify({ status: p.status, diagnostico: p.diagnostico, temas: p.temas, itens: p.itens })}

PEDIDO DA EQUIPE: ${mensagem}

Aplique o pedido na proposta. Devolva:
- resposta: o que você mudou, em poucas linhas.
- diagnostico: o novo texto só se ele mudou; senão null.
- temas: a lista COMPLETA de temas atualizada só se algum tema mudou (mantenha os ids; tema novo recebe id novo); senão null.
- itens: a lista COMPLETA de itens atualizada só se algum item mudou; senão null.
Datas só de segunda a sexta entre ${p.periodo_inicio} e ${p.periodo_fim}. Formato só carrossel ou estatico.`;

  const saida = await chamarTexto({
    clientId: p.client_id,
    tarefa: "conversa",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido }],
    raciocinio,
    esquemaJson: ESQUEMA_CONVERSA,
    referencia: { tipo: REF_TIPO, id: p.id },
    criadoPor: chamador.userId,
  });

  const r = (saida.json ?? {}) as Record<string, unknown>;
  const campos: Record<string, unknown> = {};
  const ajustes: string[] = [];
  let custoJev = 0;

  if (typeof r.diagnostico === "string" && r.diagnostico.trim()) campos.diagnostico = r.diagnostico.trim().slice(0, 12000);

  if (Array.isArray(r.temas)) {
    const porId = new Map(p.temas.map((t) => [t.id, t]));
    const usados = new Set<string>();
    let seq = p.temas.length;
    let temas = r.temas.slice(0, 30).map((bruto) => {
      let id = texto((bruto as Record<string, unknown>)?.id, 40);
      if (!id || usados.has(id)) id = `t${++seq}`;
      usados.add(id);
      return normalizarTema(bruto, id, porId.get(id));
    }).filter((t) => t.tema);
    // Tema novo ou com texto mudado ganha nota nova do Jev.
    const mudados = temas.filter((t) => porId.get(t.id)?.tema !== t.tema);
    if (mudados.length) {
      const j = await pontuarTemasComJev(mudados, {
        cliente: ctx.cliente.nome,
        objetivo: p.parametros.objetivo,
        oferta: p.parametros.oferta,
        regiao: p.parametros.regiao,
        diagnostico: (campos.diagnostico as string) ?? p.diagnostico,
      }, { clientId: p.client_id, propostaId: p.id, criadoPor: chamador.userId });
      custoJev += j.custo;
      const notas = new Map(j.temas.map((t) => [t.id, t.jev]));
      temas = temas.map((t) => (notas.has(t.id) ? { ...t, jev: notas.get(t.id) ?? null } : t));
    }
    campos.temas = temas;
  }

  if (Array.isArray(r.itens)) {
    // Item ja gravado em tentativa parcial mantem o task_id pelo tema.
    const tarefaDoTema = new Map(p.itens.filter((i) => i.task_id).map((i) => [i.tema_id, i.task_id]));
    const itens = r.itens.slice(0, 200).map((bruto) => {
      const original = String((bruto as Record<string, unknown>)?.data ?? "");
      const item = normalizarItem(bruto, uteis);
      if (tarefaDoTema.has(item.tema_id)) item.task_id = tarefaDoTema.get(item.tema_id) ?? null;
      // O vínculo com a campanha é da proposta: ajuste na conversa não perde.
      if (typeof p.parametros.campanha_id === "string") item.campanha_id = p.parametros.campanha_id;
      if (original && original !== item.data) ajustes.push(`"${item.tema}" foi de ${original} para ${item.data} (só segunda a sexta dentro do período).`);
      return item;
    }).filter((i) => i.tema);
    campos.itens = itens.sort((a, b) => a.data.localeCompare(b.data));
    // Pedido livre: o período acompanha as datas dos itens (a data pode ter mudado).
    if (String(p.parametros.origem ?? "") === "pedido_livre" && itens.length) {
      campos.periodo_inicio = (campos.itens as Item[])[0].data;
      campos.periodo_fim = (campos.itens as Item[])[(campos.itens as Item[]).length - 1].data;
    }
  }

  const atualizada = Object.keys(campos).length ? await salvarProposta(servico, p, campos) : p;
  const resposta = [texto(r.resposta, 4000) || "Ajuste aplicado.", ...ajustes].join("\n");
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "usuario", conteudo: mensagem },
    { papel: "agente", conteudo: resposta, uso_id: saida.usoId },
  ]);
  return json({ proposta: atualizada, resposta, custo_usd: Math.round((saida.custoUsd + custoJev) * 1e6) / 1e6, saldo_usd: saida.saldoUsd, reserva_usada: saida.reservaUsada ?? null });
}

// ------------------------------------------------------------ gravar

async function exigirProjetoDoCliente(servico: SupabaseClient, projectId: string, clientId: string) {
  if (!UUID.test(projectId)) throw new ErroHttp(400, "project_id_invalido", "project_id precisa ser um UUID.");
  const { data, error } = await servico.from("projects").select("id, client_id, deleted_at").eq("id", projectId).maybeSingle();
  if (error) throw new ErroHttp(500, "projeto_indisponivel", "Não foi possível ler o projeto.");
  if (!data || data.deleted_at || data.client_id !== clientId) {
    throw new ErroHttp(404, "projeto_de_outro_cliente", "O projeto não existe ou não é deste cliente.");
  }
}

function exigirEditavel(p: Proposta) {
  if (p.status === "gravada") throw new ErroHttp(409, "proposta_gravada", "Esta proposta já foi gravada na agenda. Crie uma nova proposta para mudar o período.");
  if (p.status === "descartada") throw new ErroHttp(409, "proposta_descartada", "Esta proposta foi descartada.");
}

/** Descricao legivel do item, com todo o conteudo estruturado, cabendo no limite. */
/** Contexto da campanha no texto da tarefa: briefing antes do roteiro e a foto escolhida em cada card. */
export type CampanhaNoItem = { linhas: string[]; fotoDoCard: (temaId: string, ordem: number) => string | null };

export function descricaoDoItem(item: Item, propostaId: string, indice: number, campanha?: CampanhaNoItem | null): string {
  const linhas: string[] = [
    `Tema: ${item.tema}`,
    `Formato: ${item.formato === "carrossel" ? `Carrossel${item.carrossel_infinito ? " (carrossel infinito)" : ""}` : "Post estático"}`,
    `Tipo: ${item.tipo_conteudo === "extra_sazonal" ? "extra sazonal" : "conteúdo principal"}`,
    `${ROTULO_FASE[item.fase] ?? `Fase ${item.fase}`}`,
    `Pilar: ${item.pilar}`,
    `Público: ${item.publico}`,
    `Objetivo: ${ROTULO_OBJETIVO[item.objetivo] ?? item.objetivo}`,
    `Métrica principal: ${item.metrica_principal}`,
    `Palavra-chave: ${item.palavra_chave}`,
  ];
  if (item.termo_regional) linhas.push(`Termo regional: ${item.termo_regional}`);
  linhas.push("", `Gancho: ${item.gancho}`, "", `Resumo: ${item.resumo}`);
  if (campanha && campanha.linhas.length) linhas.push("", ...campanha.linhas);
  linhas.push("", "Roteiro dos cards:");
  for (const c of item.cards) {
    linhas.push(`Card ${c.ordem}${c.funcao ? ` (${c.funcao})` : ""}: ${c.texto}`);
    if (c.ilustracao) linhas.push(`  Ilustração: ${c.ilustracao}`);
    if (c.estilo) linhas.push(`  Estilo: ${c.estilo}`);
    const foto = campanha ? campanha.fotoDoCard(item.tema_id, c.ordem) : null;
    if (foto) linhas.push(`  Foto da campanha: ${foto}`);
  }
  linhas.push("", `CTA: ${item.cta}`, "", `Legenda (copy):\n${item.copy}`, "", `Origem: Mesa do cliente, proposta ${propostaId}, item ${indice + 1}.`);
  const completo = linhas.join("\n").trim();
  if (completo.length <= LIMITE_DESCRICAO) return completo;
  // Sem espaco: a origem fica no fim e o meio e cortado com aviso.
  const origem = `\n\n[Texto cortado para caber na agenda. Completo na proposta ${propostaId}, item ${indice + 1}.]`;
  return completo.slice(0, LIMITE_DESCRICAO - origem.length).trimEnd() + origem;
}

const tituloNormal = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Copia o task_id do resultado do gravar para cada item, pelo indice. Mantem
 * o task_id que o item ja tinha quando esta tentativa nao achou nada.
 */
export function itensComTaskId(itens: Item[], resultado: Array<{ indice: number; task_id: string | null }>): Item[] {
  const porIndice = new Map(resultado.map((r) => [r.indice, r.task_id]));
  return itens.map((item, i) => ({ ...item, task_id: porIndice.get(i) ?? item.task_id ?? null }));
}

async function gravar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  if (p.status === "descartada") throw new ErroHttp(409, "proposta_descartada", "Esta proposta foi descartada.");
  if (p.status !== "pronta" && p.status !== "gravada") {
    throw new ErroHttp(409, "proposta_nao_pronta", "Detalhe todos os temas escolhidos antes de gravar na agenda.");
  }
  const projectId = String(corpo.project_id ?? p.project_id ?? "");
  await exigirProjetoDoCliente(servico, projectId, p.client_id);
  if (p.itens.length === 0) throw new ErroHttp(409, "proposta_sem_itens", "A proposta não tem itens para gravar.");

  const uteis = diasUteisDaProposta(p);

  // Itens que ja existem na agenda do cliente (mesmo titulo na mesma data) nao
  // sao recriados: preserva o que existe.
  const { data: projetos } = await servico.from("projects").select("id").eq("client_id", p.client_id).is("deleted_at", null).limit(200);
  const projectIds = (projetos ?? []).map((x: { id: string }) => x.id);
  const { data: existentes } = projectIds.length
    ? await servico.from("tasks").select("id, title, due_date")
      .in("project_id", projectIds).is("deleted_at", null)
      .gte("due_date", p.periodo_inicio).lte("due_date", p.periodo_fim).limit(1000)
    : { data: [] as Array<{ id: string; title: string; due_date: string }> };
  const jaNaAgenda = (existentes ?? []) as Array<{ id: string; title: string; due_date: string }>;

  // Contexto de escrita do MCP (WriteCtx): principal fixo do backend, escopo
  // so deste cliente (o acesso de quem chamou ja foi conferido no banco).
  const dataScope = {
    unrestricted: false,
    clientIds: [p.client_id],
    principalUserId: chamador.userId,
    // Sessao Supabase Auth, o mesmo tipo de identidade do caminho OAuth do MCP.
    source: "oauth" as const,
  };

  const taskIds: string[] = [];
  const resultado: Array<{ indice: number; tema: string; data: string; task_id: string | null; situacao: string; erro?: string }> = [];

  // Conteúdo de campanha: o briefing e a foto de cada card entram no texto da tarefa (o Estúdio lê).
  const idDaCampanha = typeof p.parametros.campanha_id === "string" && UUID.test(p.parametros.campanha_id) ? p.parametros.campanha_id : null;
  const campanhaDaProposta = idDaCampanha ? await carregarCampanha(servico, idDaCampanha).catch(() => null) : null;
  const campanhaNoItem = campanhaDaProposta && campanhaDaProposta.client_id === p.client_id
    ? await campanhaNaAgenda(servico, campanhaDaProposta).catch(() => null)
    : null;

  for (let i = 0; i < p.itens.length; i++) {
    const item = p.itens[i];
    const data = normalizarDataUtil(item.data, uteis);
    const titulo = (item.tema || `Publicação ${i + 1}`).slice(0, 200);
    const idempotencyKey = `mesa-cal:${p.id}:${i}`;
    const idPrevisto = await deterministicEditorialTaskId(PRINCIPAL_MESA, idempotencyKey);

    const duplicado = jaNaAgenda.find((t) => t.id !== idPrevisto && t.due_date === data && tituloNormal(t.title) === tituloNormal(titulo));
    if (duplicado) {
      resultado.push({ indice: i, tema: titulo, data, task_id: duplicado.id, situacao: "ja_existia" });
      continue;
    }

    const correlationId = crypto.randomUUID();
    const resultRefHolder: { value?: string } = {};
    const ctx: WriteCtx = { keyId: PRINCIPAL_MESA, origin: "mesa:agente-calendario", correlationId, dataScope, resultRefHolder };
    const entrada = {
      client_id: p.client_id,
      project_id: projectId,
      title: titulo,
      description: descricaoDoItem({ ...item, data }, p.id, i, campanhaNoItem),
      format: FORMATO_PARA_ENTREGA[item.formato === "estatico" ? "estatico" : "carrossel"],
      due_date: data,
      priority: "medium" as const,
      idempotency_key: idempotencyKey,
    };
    const inicio = Date.now();
    try {
      const parsed = createEditorialItemSchema.parse(entrada);
      const r = await createEditorialItem(parsed, ctx);
      const id = String((r.record as Record<string, unknown>).id);
      taskIds.push(id);
      resultado.push({ indice: i, tema: titulo, data, task_id: id, situacao: r.replayed ? "ja_gravado" : "criado" });
      await auditLog({
        correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:agente-calendario",
        keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
        input: { ...entrada, description: "[item da proposta]", proposta_id: p.id, pedido_por: chamador.userId },
        success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: id,
      });
    } catch (err) {
      const conflito = err instanceof WriteError && err.code === "conflict";
      const msg = err instanceof Error ? err.message : String(err);
      if (conflito) {
        // O item ja foi gravado antes e mudou depois na conversa: preserva o
        // que esta na agenda e aponta a tarefa existente.
        taskIds.push(idPrevisto);
        resultado.push({ indice: i, tema: titulo, data, task_id: idPrevisto, situacao: "ja_gravado_com_outro_conteudo" });
      } else {
        resultado.push({ indice: i, tema: titulo, data, task_id: null, situacao: "erro", erro: msg.slice(0, 300) });
      }
      await auditLog({
        correlationId, toolName: "aceleriq_create_editorial_item", origin: "mesa:agente-calendario",
        keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
        input: { ...entrada, description: "[item da proposta]", proposta_id: p.id, pedido_por: chamador.userId },
        success: false, statusCode: conflito ? 409 : 500, durationMs: Date.now() - inicio,
        errorCode: conflito ? "conflict" : "handler_error", errorMessage: msg,
      });
    }
  }

  const erros = resultado.filter((r) => r.situacao === "erro");
  // Pulados por ja existirem tambem entram: o estudio usa a tarefa existente.
  const todos = [...new Set([...p.task_ids, ...taskIds, ...resultado.map((r) => r.task_id).filter((id): id is string => !!id)])];
  // task_id dentro de cada item: criado, ja gravado ou ja existente; null so
  // quando nada foi criado nem encontrado. O estudio acha o roteiro por aqui.
  const itensComTarefa = itensComTaskId(p.itens, resultado);

  if (erros.length > 0) {
    // Parcial: guarda o que entrou e continua pronta para nova tentativa
    // (idempotente). Nunca 200.
    const atualizada = await salvarProposta(servico, p, { task_ids: todos, itens: itensComTarefa, project_id: projectId });
    return json({
      error: "gravacao_parcial",
      mensagem: `${erros.length} de ${p.itens.length} itens não entraram na agenda. Tente gravar de novo; o que já entrou não duplica.`,
      proposta: atualizada,
      itens: resultado,
    }, erros.length === p.itens.length ? 500 : 409);
  }

  const atualizada = await salvarProposta(servico, p, {
    task_ids: todos,
    itens: itensComTarefa,
    project_id: projectId,
    status: "gravada",
    gravada_em: p.gravada_em ?? new Date().toISOString(),
  });

  await registrarMemoriaDaEscolha(servico, p);
  if (typeof p.parametros.campanha_id === "string" && UUID.test(p.parametros.campanha_id)) {
    await servico.from("mesa_campanhas").update({ status: "gravada" }).eq("id", p.parametros.campanha_id).eq("client_id", p.client_id);
  }
  // Cada item com roteiro já chega dirigido no Estúdio (sem custo de IA).
  const direcoes = await criarDirecoesDoRoteiro(servico, p.client_id, itensComTarefa, chamador.userId);

  const conversaId = await garantirConversa(servico, atualizada, chamador.userId);
  const criados = resultado.filter((r) => r.situacao === "criado").length;
  await registrarMensagens(servico, conversaId, p.client_id, [
    { papel: "sistema", conteudo: `Gravado na agenda: ${criados} criado(s), ${resultado.length - criados} já existia(m). ${direcoes} com direção de arte pronta no Estúdio.` },
  ]);

  return json({ proposta: atualizada, itens: resultado, direcoes_prontas: direcoes });
}

/** Memoria do estrategista: o que a equipe escolheu e o que descartou. Uma vez por proposta. */
async function registrarMemoriaDaEscolha(servico: SupabaseClient, p: Proposta) {
  const { data: ja } = await servico
    .from("agente_memoria")
    .select("id")
    .eq("client_id", p.client_id)
    .eq("agente", AGENTE)
    .eq("referencia_id", p.id)
    .limit(1);
  if ((ja ?? []).length > 0) return;
  const periodo = `${p.periodo_inicio} a ${p.periodo_fim}`;
  const escolhidos = p.temas.filter((t) => t.escolhido).map((t) => `${t.tema} (${ROTULO_OBJETIVO[t.objetivo] ?? t.objetivo})`);
  const descartados = p.temas.filter((t) => !t.escolhido).map((t) => t.tema);
  const linhas: Array<Record<string, unknown>> = [];
  if (escolhidos.length) {
    linhas.push({
      client_id: p.client_id, agente: AGENTE, tipo: "preferencia", origem: "aprovacao", referencia_id: p.id,
      texto: `Temas escolhidos pela equipe para ${periodo}: ${escolhidos.join("; ")}.`.slice(0, 4000),
    });
  }
  if (descartados.length) {
    linhas.push({
      client_id: p.client_id, agente: AGENTE, tipo: "aprendizado", origem: "aprovacao", referencia_id: p.id,
      texto: `Temas propostos e descartados pela equipe para ${periodo}: ${descartados.join("; ")}.`.slice(0, 4000),
    });
  }
  if (linhas.length === 0) return;
  const { error } = await servico.from("agente_memoria").insert(linhas);
  if (error) console.error("[agente-calendario] memoria nao gravada", { proposta_id: p.id, code: error.code });
}

// ------------------------------------------------------------ porta

// ------------------------------------------------ direção pronta no estúdio

const FORMATOS_COM_ARTE = new Set(["carousel", "static", "design"]);

/**
 * Cada item gravado com roteiro de cards vira um trabalho do estúdio já
 * dirigido (status dirigido), montado em código a partir do roteiro, sem
 * custo de IA. Quando a equipe abre o item no Estúdio, é só gerar.
 * Item que já tem trabalho não ganha outro.
 */
// aplicarFotosDoPlano e pecasDoPlanoGravado moraram aqui até 25/09; agora são
// de _shared/fotos-do-plano.ts (o Estúdio usa as mesmas no preparar).

async function criarDirecoesDoRoteiro(
  servico: SupabaseClient,
  clientId: string,
  itens: Item[],
  userId: string,
): Promise<number> {
  const comTarefa = itens.filter((i) => i.task_id && Array.isArray(i.cards) && i.cards.length);
  if (!comTarefa.length) return 0;
  const ids = comTarefa.map((i) => i.task_id!) as string[];
  const [{ data: existentes }, { data: tarefas }, marca, modeloImagem] = await Promise.all([
    servico.from("estudio_trabalhos").select("task_id").eq("client_id", clientId).in("task_id", ids),
    servico.from("tasks").select("id, delivery_type, deleted_at").in("id", ids),
    lerMarcaParaDirecao(servico, clientId),
    modeloPadrao("imagem"),
  ]);
  if (!modeloImagem) return 0;
  const jaTem = new Set(((existentes as { task_id: string }[] | null) ?? []).map((e) => e.task_id));
  const idsCampanha = [...new Set(comTarefa.map((i) => i.campanha_id).filter((x): x is string => !!x && UUID.test(x)))];
  // select * : antes do SQL de 25/09 a campanha vem sem plano_imagens e segue sem foto.
  const { data: campanhasBrutas } = idsCampanha.length
    ? await servico.from("mesa_campanhas").select("*").eq("client_id", clientId).in("id", idsCampanha)
    : { data: [] };
  const campanhas = new Map(((campanhasBrutas as Campanha[] | null) ?? []).map((x) => [x.id, x]));
  // Fotos do plano de imagens de cada campanha (conferidas no acervo do cliente).
  const pecasPorCampanha = new Map(Array.from(campanhas.values()).map((c) => [c.id, pecasDoPlanoGravado(c.plano_imagens)]));
  const idsDasFotos = [...new Set(Array.from(pecasPorCampanha.values()).flatMap((l) => l.map((p) => p.imagem_id)))];
  const fotosDoPlano = new Map((await fotosDoAcervoPorId(servico, clientId, idsDasFotos)).map((f) => [f.id, f]));
  const formato = new Map(((tarefas as { id: string; delivery_type: string; deleted_at: string | null }[] | null) ?? [])
    .filter((t) => !t.deleted_at)
    .map((t) => [t.id, t.delivery_type]));
  const linhas: Record<string, unknown>[] = [];
  for (const item of comTarefa) {
    const tipo = formato.get(item.task_id!);
    if (!tipo || !FORMATOS_COM_ARTE.has(tipo) || jaTem.has(item.task_id!)) continue;
    const campanha = item.campanha_id ? campanhas.get(item.campanha_id) : undefined;
    const direcao = direcaoDoRoteiro(item.cards, marca, {
      postUnico: tipo !== "carousel",
      carrosselInfinito: !!item.carrossel_infinito,
      conceito: `${item.tema}. ${item.resumo}${campanha ? ` Campanha "${campanha.nome}": ${String(campanha.identidade?.tema_visual ?? "")}` : ""}`.slice(0, 900),
      levaLogo: (ordem, total) => ordem === 1 || ordem === total,
    });
    if (!direcao.cards.length) continue;
    if (campanha) {
      (direcao as Record<string, unknown>).campanha_id = campanha.id;
      aplicarFotosDoPlano(direcao, item.tema_id, pecasPorCampanha.get(campanha.id) ?? [], fotosDoPlano);
    }
    linhas.push({
      client_id: clientId,
      task_id: item.task_id,
      status: "dirigido",
      direcao,
      modelo_imagem_id: modeloImagem.id,
      qualidade: "media",
      cards: [],
      custo_usd: 0,
      criado_por: userId,
    });
  }
  if (!linhas.length) return 0;
  const { error } = await servico.from("estudio_trabalhos").insert(linhas);
  if (error) {
    console.error("agente-calendario: direcoes nao criadas", { client_id: clientId, erro: error.message });
    return 0;
  }
  return linhas.length;
}

// ---------------------------------------------- completar itens da agenda

const MAX_ITENS_COMPLETAR = 12;

/**
 * completar_itens { client_id, task_ids }: itens que já estão na Agenda (vindos
 * de qualquer lugar) ganham o roteiro completo do estrategista (gancho, copy e
 * cada card) e a direção pronta no Estúdio. O roteiro fica numa proposta
 * gravada com esses task_ids, que é onde o estúdio procura.
 */
async function completarItens(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Cliente inválido.");
  await exigirAcessoAoCliente(chamador, clientId);
  const pedidos = (Array.isArray(corpo.task_ids) ? corpo.task_ids : []).map(String).filter((id) => UUID.test(id));
  if (!pedidos.length) throw new ErroHttp(400, "sem_itens", "Escolha os itens da agenda que o agente deve completar.");
  if (pedidos.length > MAX_ITENS_COMPLETAR) throw new ErroHttp(400, "itens_demais", `Complete até ${MAX_ITENS_COMPLETAR} itens por vez.`);

  const { data: tarefasBrutas } = await servico
    .from("tasks")
    .select("id, title, description, delivery_type, due_date, deleted_at, project_id")
    .in("id", pedidos);
  const tarefas = ((tarefasBrutas as { id: string; title: string; description: string | null; delivery_type: string; due_date: string | null; deleted_at: string | null; project_id: string }[] | null) ?? [])
    .filter((t) => !t.deleted_at && FORMATOS_COM_ARTE.has(t.delivery_type));
  if (!tarefas.length) throw new ErroHttp(409, "sem_itens_de_arte", "Nenhum dos itens escolhidos é carrossel ou post estático.");
  const { data: projetos } = await servico.from("projects").select("id, client_id").in("id", [...new Set(tarefas.map((t) => t.project_id))]);
  const doCliente = new Set(((projetos as { id: string; client_id: string }[] | null) ?? []).filter((p) => p.client_id === clientId).map((p) => p.id));
  const validas = tarefas.filter((t) => doCliente.has(t.project_id));
  if (!validas.length) throw new ErroHttp(403, "itens_de_outro_cliente", "Os itens escolhidos não são deste cliente.");

  const datas = validas.map((t) => t.due_date).filter((d): d is string => !!d && DATA.test(d)).sort();
  const inicio = datas[0] ?? new Date().toISOString().slice(0, 10);
  const fim = datas[datas.length - 1] ?? inicio;
  const uteis = diasUteisDoPeriodo(inicio, fim);
  const ctx = await montarContexto(servico, clientId, inicio, fim);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: {} })}

TAREFA: estes itens JÁ ESTÃO na agenda do cliente. Complete cada um com todos os campos do calendário, mantendo o tema, a data e o formato de cada item (não troque o assunto). O roteiro de cada card precisa estar pronto para o diretor de arte: texto exato de cada card (curto, com hierarquia clara), ilustração concreta e estilo visual no sistema da marca.
${validas.map((t, i) => `- tema_id i${i}: "${t.title}" | formato ${t.delivery_type === "carousel" ? "carrossel" : "estatico"} | data ${t.due_date ?? inicio} | o que já existe: ${(t.description ?? "").replace(/\s+/g, " ").slice(0, 900) || "só o título"}`).join("\n")}
Regras dos itens:
- formato: carrossel ou estatico, igual ao do item. Estático tem exatamente 1 card.
- cards: roteiro de cada card em ordem (ordem, funcao como capa, desenvolvimento ou CTA final, texto exato do card, ilustracao, estilo). A história é uma só: a capa abre uma tensão com um gancho forte, cada card avança um passo e prepara o próximo com texto corrido e conectivos, nunca frases soltas; o CTA fecha a história. As ilustracoes formam UMA série: a mesma protagonista, o mesmo cenário e a mesma luz do começo ao fim (descreva a protagonista igual em todos os cards), variando só a pose, o gesto e o enquadramento (nunca a mesma pose em dois cards seguidos); prefira foto real do cliente quando o contexto tiver. Quantidade de cards pelo conteúdo: o mínimo que conta a história, em geral 4 a 6; 7 ou mais só quando o conteúdo pede. Nunca escreva o nome da marca no texto dos cards. Não repita tema, gancho nem imagem de posts recentes.
- carrossel_infinito: true quando o carrossel for uma cena panorâmica contínua (o fundo atravessa os cards e o último se liga ao primeiro) e isso fizer sentido.
- copy: a legenda completa do post.
- data: exatamente a data do item.
- tipo_conteudo: principal.
- status: planejado.`;

  const s = await chamarTexto({
    clientId,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [{ papel: "usuario", conteudo: pedido }],
    raciocinio,
    esquemaJson: ESQUEMA_ITENS,
    criadoPor: chamador.userId,
  });
  const brutos = Array.isArray((s.json as Record<string, unknown>)?.itens) ? (s.json as { itens: unknown[] }).itens : [];
  const itens: Item[] = [];
  validas.forEach((t, i) => {
    const bruto = brutos.find((b) => String((b as Record<string, unknown>)?.tema_id ?? "") === `i${i}`) ?? brutos[i];
    if (!bruto) return;
    const item = normalizarItem(bruto, uteis.length ? uteis : [inicio], t.due_date ?? inicio);
    item.tema_id = `i${i}`;
    item.task_id = t.id;
    item.data = t.due_date ?? item.data;
    item.formato = t.delivery_type === "carousel" ? "carrossel" : "estatico";
    if (!item.tema) item.tema = t.title;
    itens.push(item);
  });
  if (!itens.length) {
    throw new ErroHttp(502, "itens_vazios", "O estrategista não devolveu os itens. Tente de novo.", { uso_id: s.usoId });
  }

  const { data: proposta, error } = await servico
    .from("calendario_propostas")
    .insert({
      client_id: clientId,
      project_id: validas[0].project_id,
      periodo_inicio: inicio,
      periodo_fim: fim,
      parametros: { origem: "completar_itens" },
      status: "gravada",
      diagnostico: null,
      temas: [],
      itens,
      task_ids: itens.map((i) => i.task_id),
      criado_por: chamador.userId,
      gravada_em: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new ErroHttp(503, "proposta_nao_gravada", "O roteiro foi escrito, mas não foi gravado. Tente de novo.", { uso_id: s.usoId });

  const direcoes = await criarDirecoesDoRoteiro(servico, clientId, itens, chamador.userId);
  return json({ proposta, itens, direcoes_prontas: direcoes, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

// ------------------------------------------- agente do mês, hypes e campanhas

const MAX_ANEXOS_PEDIDO = 6;
const MAX_BYTES_ANEXO = 12 * 1024 * 1024;
const REF_AGENTE_DO_MES = "agente_do_mes";

/** Hoje no fuso de São Paulo (AAAA-MM-DD). */
function hojeSaoPaulo(): string {
  const agora = new Date(Date.now() - 3 * 3600_000);
  return agora.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data. */
function segundaDaSemana(data: string): string {
  const d = diaDaSemana(data);
  return somarDias(data, d === 0 ? -6 : 1 - d);
}

function mimeDaImagem(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

/**
 * Imagens anexadas ao pedido (prints, fotos): a tela sobe no bucket mesa em
 * <cliente>/pedidos/; aqui só entra caminho do próprio cliente.
 */
async function baixarAnexos(servico: SupabaseClient, clientId: string, bruto: unknown): Promise<{ imagens: ImagemEntrada[]; caminhos: string[] }> {
  const caminhos = (Array.isArray(bruto) ? bruto : [])
    .map((c) => String(c ?? ""))
    .filter((c) => c.startsWith(`${clientId}/`) && c.indexOf("..") < 0)
    .slice(0, MAX_ANEXOS_PEDIDO);
  const imagens: ImagemEntrada[] = [];
  const validos: string[] = [];
  for (const c of caminhos) {
    const { data, error } = await servico.storage.from("mesa").download(c);
    if (error || !data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = mimeDaImagem(bytes);
    if (!mime || bytes.byteLength > MAX_BYTES_ANEXO) continue;
    imagens.push({ bytes, mime, nome: `anexo-${imagens.length + 1}.${mime.split("/")[1]}` });
    validos.push(c);
  }
  return { imagens, caminhos: validos };
}

/** Projeto de social do cliente (para gravar sem perguntar), o mais recente. */
async function projetoSocialDoCliente(servico: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await servico
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .eq("project_type", "social_media")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data as { id: string }[] | null) ?? [])[0]?.id ?? null;
}

async function conversaDoAgenteDoMes(servico: SupabaseClient, clientId: string, userId: string): Promise<string> {
  const { data } = await servico
    .from("agente_conversas")
    .select("id")
    .eq("client_id", clientId)
    .eq("agente", AGENTE)
    .eq("referencia_tipo", REF_AGENTE_DO_MES)
    .order("criado_em", { ascending: false })
    .limit(1);
  const existente = ((data as { id: string }[] | null) ?? [])[0]?.id;
  if (existente) return existente;
  const { data: nova, error } = await servico
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE, referencia_tipo: REF_AGENTE_DO_MES, criado_por: userId })
    .select("id")
    .single();
  if (error || !nova) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa do agente do mês.");
  return nova.id;
}

type Campanha = {
  id: string;
  client_id: string;
  nome: string;
  pedido: string | null;
  objetivo: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  conceito: string | null;
  identidade: Record<string, unknown>;
  referencias_ids: string[];
  selo_path: string | null;
  proposta_id: string | null;
  status: string;
  custo_usd: number;
  /** Colunas de 25/09 (docs/mesa/migrations/20260925120000_mesa_campanhas_completas.sql); ausentes antes do SQL. */
  briefing?: Record<string, unknown> | null;
  imagens?: unknown;
  plano_imagens?: Record<string, unknown> | null;
};

async function carregarCampanha(servico: SupabaseClient, id: unknown): Promise<Campanha> {
  const cid = String(id ?? "");
  if (!UUID.test(cid)) throw new ErroHttp(400, "campanha_invalida", "Campanha inválida.");
  const { data, error } = await servico.from("mesa_campanhas").select("*").eq("id", cid).maybeSingle();
  if (error) throw new ErroHttp(500, "campanha_indisponivel", "Não foi possível ler a campanha.");
  if (!data) throw new ErroHttp(404, "campanha_inexistente", "Campanha não encontrada.");
  return data as Campanha;
}

/** Soma no custo da campanha sem perder parcela quando duas ações terminam juntas (compara e troca). */
async function somarCustoDaCampanha(servico: SupabaseClient, id: string, clientId: string, valor: number) {
  if (!(valor > 0)) return;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const { data } = await servico.from("mesa_campanhas").select("custo_usd").eq("id", id).eq("client_id", clientId).maybeSingle();
    if (!data) return;
    const atual = Number((data as { custo_usd: number | string }).custo_usd) || 0;
    const novo = Math.round((atual + valor) * 1e6) / 1e6;
    const { data: feito } = await servico.from("mesa_campanhas").update({ custo_usd: novo })
      .eq("id", id).eq("client_id", clientId).eq("custo_usd", (data as { custo_usd: number | string }).custo_usd).select("id").maybeSingle();
    if (feito) return;
  }
  console.error("[agente-calendario] custo da campanha nao somado", { campanha_id: id, valor });
}

// ------------------------------- campanha completa: briefing, imagens e plano

const MAX_IMAGENS_CAMPANHA = 12;
const PAPEIS_DA_IMAGEM = ["heroi", "apoio", "ambiente"] as const;
type PapelDaImagem = typeof PAPEIS_DA_IMAGEM[number];
const ROTULO_DO_PAPEL: Record<PapelDaImagem, string> = {
  heroi: "produto herói",
  apoio: "apoio",
  ambiente: "ambiente",
};

type ImagemDaCampanha = { imagem_id: string; papel: PapelDaImagem; nota: string };

type BriefingDaCampanha = {
  produtos: { nome: string; por_que: string }[];
  oferta: string;
  mensagem_central: string;
  publico: string;
  provas: string[];
  tom: string;
  cta: string;
};

/** Linha do acervo (cliente_imagens) que a campanha usa. */
type FotoDaCampanha = {
  id: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
  origem: string | null;
};

const CAMPOS_FOTO = "id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao, origem";

export function normalizarBriefing(bruto: unknown): BriefingDaCampanha {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const produtos = (Array.isArray(o.produtos) ? o.produtos : [])
    .map((p) => {
      const x = (p && typeof p === "object" ? p : { nome: p }) as Record<string, unknown>;
      return { nome: texto(x.nome, 120), por_que: texto(x.por_que, 500) };
    })
    .filter((p) => p.nome)
    .slice(0, 5);
  const provas = (Array.isArray(o.provas) ? o.provas : []).map((p) => texto(p, 300)).filter(Boolean).slice(0, 6);
  return {
    produtos,
    oferta: texto(o.oferta, 600),
    mensagem_central: texto(o.mensagem_central, 400),
    publico: texto(o.publico, 600),
    provas,
    tom: texto(o.tom, 300),
    cta: texto(o.cta, 200),
  };
}

/** O que a equipe definiu vale sobre o que o estrategista sugeriu (campo vazio não apaga). */
export function juntarBriefing(daIa: BriefingDaCampanha, daEquipe: BriefingDaCampanha): BriefingDaCampanha {
  return {
    produtos: daEquipe.produtos.length ? daEquipe.produtos : daIa.produtos,
    oferta: daEquipe.oferta || daIa.oferta,
    mensagem_central: daEquipe.mensagem_central || daIa.mensagem_central,
    publico: daEquipe.publico || daIa.publico,
    provas: daEquipe.provas.length ? daEquipe.provas : daIa.provas,
    tom: daEquipe.tom || daIa.tom,
    cta: daEquipe.cta || daIa.cta,
  };
}

const briefingVazio = (b: BriefingDaCampanha) =>
  !b.produtos.length && !b.oferta && !b.mensagem_central && !b.publico && !b.provas.length && !b.tom && !b.cta;

/** Imagens da campanha: só UUID, sem repetir, papel conhecido, até 12. */
export function normalizarImagensDaCampanha(bruto: unknown): ImagemDaCampanha[] {
  const vistas = new Set<string>();
  const saida: ImagemDaCampanha[] = [];
  for (const x of Array.isArray(bruto) ? bruto : []) {
    const o = (x && typeof x === "object" ? x : { imagem_id: x }) as Record<string, unknown>;
    const id = String(o.imagem_id ?? o.id ?? "").trim().toLowerCase();
    if (!UUID.test(id) || vistas.has(id)) continue;
    vistas.add(id);
    const papel = (PAPEIS_DA_IMAGEM as readonly string[]).includes(String(o.papel)) ? String(o.papel) as PapelDaImagem : "apoio";
    saida.push({ imagem_id: id, papel, nota: texto(o.nota, 400) });
    if (saida.length >= MAX_IMAGENS_CAMPANHA) break;
  }
  return saida;
}

/**
 * Assinatura do plano: imagens da campanha (id:papel) e conteúdos (tema_id:
 * quantidade de cards). A tela calcula igual (campanhasApi.assinaturaDoPlano)
 * e avisa quando o plano ficou velho.
 */
export function assinaturaDoPlano(imagens: { imagem_id: string; papel?: string }[], itens: { tema_id?: string | null; cards?: unknown[] | null }[]): string {
  const a = imagens.map((i) => `${i.imagem_id}:${i.papel || ""}`).sort().join(",");
  const b = itens.map((i) => `${i.tema_id || ""}:${Array.isArray(i.cards) ? i.cards.length : 0}`).sort().join(",");
  return `${a}|${b}`;
}

/** Referência baixada da internet (Mesa Foto) não é publicável: não entra na campanha. */
const fotoNaoPublicavel = (f: FotoDaCampanha) => (f.tags ?? []).some((t) => t === "nao_publicar" || t === "referencia_web");

/** As linhas do acervo pelos ids, só do cliente e ativas, na ordem pedida. */
async function fotosDoAcervoPorId(servico: SupabaseClient, clientId: string, ids: string[]): Promise<FotoDaCampanha[]> {
  const validos = ids.filter((i) => UUID.test(i)).slice(0, 40);
  if (!validos.length) return [];
  const { data } = await servico.from("cliente_imagens").select(CAMPOS_FOTO).eq("client_id", clientId).eq("ativa", true).in("id", validos);
  const achadas = (data as FotoDaCampanha[] | null) ?? [];
  return validos.map((i) => achadas.find((a) => a.id === i)).filter((a): a is FotoDaCampanha => !!a && !fotoNaoPublicavel(a));
}

/** Imagens gravadas na campanha que ainda existem no acervo, com a linha do acervo junto. */
async function fotosDaCampanha(servico: SupabaseClient, c: Campanha): Promise<{ imagem: ImagemDaCampanha; foto: FotoDaCampanha }[]> {
  const imagens = normalizarImagensDaCampanha(c.imagens);
  if (!imagens.length) return [];
  const fotos = await fotosDoAcervoPorId(servico, c.client_id, imagens.map((i) => i.imagem_id));
  return imagens
    .map((imagem) => ({ imagem, foto: fotos.find((f) => f.id === imagem.imagem_id) }))
    .filter((x): x is { imagem: ImagemDaCampanha; foto: FotoDaCampanha } => !!x.foto);
}

/** Sem imagem escolhida, o plano olha o acervo: fotos reais recentes (sem logo, arte pronta nem referência da internet). */
async function fotosDoAcervoParaOPlano(servico: SupabaseClient, clientId: string, limite = 10): Promise<FotoDaCampanha[]> {
  const { data } = await servico
    .from("cliente_imagens")
    .select(CAMPOS_FOTO)
    .eq("client_id", clientId)
    .eq("ativa", true)
    .or("categoria.is.null,categoria.not.in.(logo,arte)")
    .order("atualizado_em", { ascending: false })
    .limit(40);
  const ordem = ["produto", "ambiente", "pessoa", "antes_depois", "detalhe", "equipe", "fachada"];
  return ((data as FotoDaCampanha[] | null) ?? [])
    .filter((f) => !fotoNaoPublicavel(f))
    .sort((a, b) => {
      const ia = ordem.indexOf(a.categoria || ""), ib = ordem.indexOf(b.categoria || "");
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .slice(0, limite);
}

/** Foto reduzida para o modelo ler (lado maior 768): transformação do bucket, senão redução local. */
async function fotoParaLeitura(servico: SupabaseClient, f: FotoDaCampanha, nome: string): Promise<ImagemEntrada | null> {
  const lado = 768;
  try {
    const { data, error } = await servico.storage.from(f.storage_bucket || "mesa").download(f.storage_path, {
      transform: { width: lado, height: lado, resize: "contain" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = mimeDaImagem(bytes);
      if (mime && bytes.byteLength <= 3 * 1024 * 1024) return { bytes, mime, nome: `${nome}.${mime.split("/")[1]}` };
    }
  } catch {
    // cai no original
  }
  try {
    const { data, error } = await servico.storage.from(f.storage_bucket || "mesa").download(f.storage_path);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = mimeDaImagem(bytes);
    if (!mime || bytes.byteLength > 30 * 1024 * 1024) return null;
    if (bytes.byteLength <= 1_500_000) return { bytes, mime, nome: `${nome}.${mime.split("/")[1]}` };
    const img = await decodificar(bytes);
    const reduzida = img.width > lado || img.height > lado ? img.contain(lado, lado) : img;
    return { bytes: await reduzida.encodeJPEG(82), mime: "image/jpeg", nome: `${nome}.jpg` };
  } catch {
    return null;
  }
}

/** Catálogo das fotos para o prompt: código curto (F1, F2...) em vez do UUID, que o modelo troca. */
function catalogoDasFotos(fotos: { foto: FotoDaCampanha; imagem?: ImagemDaCampanha | null }[]) {
  return fotos.map((x, i) => ({
    foto: `F${i + 1}`,
    nome: texto(x.foto.nome, 120),
    papel_na_campanha: x.imagem ? ROTULO_DO_PAPEL[x.imagem.papel] : "do acervo (não escolhida pela equipe)",
    por_que_a_equipe_escolheu: x.imagem?.nota || null,
    categoria: x.foto.categoria,
    pasta: x.foto.pasta,
    descricao_do_acervo: texto(x.foto.descricao, 300) || null,
  }));
}

const ESQUEMA_BRIEFING = obj({
  produtos: { type: "array", items: obj({ nome: S("string"), por_que: S("string") }) },
  oferta: S("string"),
  mensagem_central: S("string"),
  publico: S("string"),
  provas: { type: "array", items: S("string") },
  tom: S("string"),
  cta: S("string"),
});

const ESQUEMA_PLANO_IMAGENS = obj({
  resumo: S("string"),
  analise: { type: "array", items: obj({ foto: S("string"), o_que_mostra: S("string"), forca: S("string"), serve_para: S("string") }) },
  pecas: {
    type: "array",
    items: obj({
      item: S("integer"),
      ordem: S("integer"),
      candidatas: { type: "array", items: S("string") },
      uso: S("string", { enum: ["fundo", "elemento"] }),
      por_que: S("string"),
    }),
  },
  lacunas: { type: "array", items: S("string") },
});

const REGRAS_DO_PLANO_DE_IMAGENS = `Regras do plano_imagens (fotos reais da campanha, citadas pelo código F1, F2...):
- analise: uma linha por foto que você recebeu: o_que_mostra (o que se vê de verdade, sem inventar), forca (o que ela tem de melhor para vender o produto ou a mensagem) e serve_para (capa, oferta, prova, ambiente, detalhe do produto, bastidor...).
- pecas: uma linha por lâmina que deve usar foto real. item é a posição (1, 2, 3...) do conteúdo na lista de conteúdos; ordem é a ordem do card. candidatas: de 1 a 3 códigos de foto, a melhor primeiro. uso: fundo (a foto é a base da lâmina, fica como está, e o texto vai numa área calma dela) ou elemento (o produto recortado entra na composição desenhada). por_que: em 1 ou 2 frases, por que esta foto nesta lâmina, ligando o produto em foco, a mensagem central e o texto do card.
- O produto herói vai na capa e na lâmina da oferta; foto de ambiente vai nas lâminas de contexto; foto de apoio em prova e detalhe. Siga a nota da equipe sobre cada foto.
- Nunca a mesma foto como fundo em duas lâminas do mesmo conteúdo. Lâmina que a foto não serve fica fora (não force).
- Carrossel contínuo (carrossel_infinito true) é uma cena panorâmica desenhada: ali use no máximo uso elemento, nunca fundo.
- lacunas: as fotos que faltam para a campanha ficar completa (ex.: produto em uso, embalagem de perto, cliente real), em frases curtas. Sem fotos, analise e pecas vazias e diga nas lacunas o que fotografar.`;

type PecaDoPlano = {
  tema_id: string;
  ordem: number;
  imagem_id: string | null;
  candidatas: string[];
  uso: "fundo" | "elemento";
  por_que: string;
  escolha: "estrategista" | "jev";
  confianca: number | null;
  aviso: string | null;
};

type PlanoDeImagens = {
  gerado_em: string;
  assinatura: string;
  fonte: "campanha" | "acervo";
  resumo: string;
  analise: { imagem_id: string; o_que_mostra: string; forca: string; serve_para: string }[];
  pecas: PecaDoPlano[];
  lacunas: string[];
  jev_erro: string | null;
};

/**
 * Plano do modelo em ids reais: código de foto desconhecido sai, item e card
 * precisam existir, uma linha por lâmina, e nunca a mesma foto como fundo em
 * duas lâminas do mesmo conteúdo. Carrossel contínuo não recebe fundo.
 */
export function normalizarPlanoDeImagens(
  bruto: unknown,
  codigos: Map<string, string>,
  itens: { tema_id: string; carrossel_infinito?: boolean; cards: { ordem: number }[] }[],
  base: { assinatura: string; fonte: "campanha" | "acervo" },
): PlanoDeImagens {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const idDe = (c: unknown) => codigos.get(String(c ?? "").trim().toUpperCase()) ?? null;
  const analise = (Array.isArray(o.analise) ? o.analise : [])
    .map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      return { imagem_id: idDe(x.foto) ?? "", o_que_mostra: texto(x.o_que_mostra, 400), forca: texto(x.forca, 300), serve_para: texto(x.serve_para, 200) };
    })
    .filter((a, i, l) => a.imagem_id && l.findIndex((b) => b.imagem_id === a.imagem_id) === i);
  const vistas = new Set<string>();
  const pecas: PecaDoPlano[] = [];
  for (const p of Array.isArray(o.pecas) ? o.pecas : []) {
    const x = (p ?? {}) as Record<string, unknown>;
    const item = itens[Number(x.item) - 1];
    if (!item) continue;
    const ordem = Number(x.ordem);
    const nCards = Math.max(item.cards.length, 1);
    if (!Number.isInteger(ordem) || ordem < 1 || ordem > nCards) continue;
    const chave = `${item.tema_id}:${ordem}`;
    if (vistas.has(chave)) continue;
    const candidatas = (Array.isArray(x.candidatas) ? x.candidatas : []).map(idDe).filter((id): id is string => !!id)
      .filter((id, i, l) => l.indexOf(id) === i).slice(0, 3);
    if (!candidatas.length) continue;
    vistas.add(chave);
    pecas.push({
      tema_id: item.tema_id,
      ordem,
      imagem_id: candidatas[0],
      candidatas,
      uso: item.carrossel_infinito ? "elemento" : x.uso === "elemento" ? "elemento" : "fundo",
      por_que: texto(x.por_que, 500),
      escolha: "estrategista",
      confianca: null,
      aviso: null,
    });
  }
  return {
    gerado_em: new Date().toISOString(),
    assinatura: base.assinatura,
    fonte: base.fonte,
    resumo: texto(o.resumo, 1200),
    analise,
    pecas: semFundoRepetido(pecas),
    lacunas: (Array.isArray(o.lacunas) ? o.lacunas : []).map((l) => texto(l, 300)).filter(Boolean).slice(0, 8),
    jev_erro: null,
  };
}

/** A mesma foto não vira fundo de duas lâminas do mesmo conteúdo: passa para a próxima candidata livre. */
export function semFundoRepetido(pecas: PecaDoPlano[]): PecaDoPlano[] {
  const usadas = new Map<string, Set<string>>();
  return pecas
    .slice()
    .sort((a, b) => (a.tema_id === b.tema_id ? a.ordem - b.ordem : a.tema_id.localeCompare(b.tema_id)))
    .map((p) => {
      if (p.uso !== "fundo" || !p.imagem_id) return p;
      const doItem = usadas.get(p.tema_id) ?? new Set<string>();
      usadas.set(p.tema_id, doItem);
      if (!doItem.has(p.imagem_id)) {
        doItem.add(p.imagem_id);
        return p;
      }
      const livre = p.candidatas.find((c) => !doItem.has(c)) ?? null;
      if (livre) doItem.add(livre);
      return { ...p, imagem_id: livre, aviso: livre ? p.aviso : "A foto escolhida já é fundo de outra lâmina deste conteúdo; esta lâmina fica sem foto." };
    });
}

/**
 * Onde há mais de uma foto candidata para a lâmina, o Jev escolhe (Choice)
 * entre elas, com "nenhuma" como saída. Regra em código: a escolha do Jev só
 * troca a do estrategista com probabilidade de pelo menos 0,5; "nenhuma" com
 * 0,6 ou mais vira aviso na lâmina (a foto fica, a equipe decide). Falha do
 * Jev não derruba o plano: fica a ordem do estrategista e o código do erro.
 */
async function decidirFotosComJev(
  plano: PlanoDeImagens,
  contexto: {
    campanha: Record<string, unknown>;
    fotos: Map<string, { codigo: string; descricao: string }>;
    itens: Item[];
  },
  cobranca: { clientId: string; campanhaId: string; criadoPor: string },
): Promise<{ plano: PlanoDeImagens; custo: number }> {
  const alvos = plano.pecas.map((p, i) => ({ p, i })).filter(({ p }) => p.candidatas.length >= 2).slice(0, 40);
  if (!alvos.length) return { plano, custo: 0 };
  const laminas: Record<string, unknown>[] = [];
  const questions: Record<string, PerguntaJev> = {};
  alvos.forEach(({ p }, k) => {
    const item = contexto.itens.find((it) => it.tema_id === p.tema_id);
    const card = item?.cards.find((c) => c.ordem === p.ordem);
    laminas.push({
      conteudo: item?.tema ?? "",
      formato: item?.formato ?? "",
      funcao_da_lamina: card?.funcao || (p.ordem === 1 ? "capa" : "conteúdo"),
      texto_da_lamina: card?.texto ?? "",
      ilustracao_prevista: card?.ilustracao ?? "",
      uso_da_foto: p.uso === "fundo" ? "a foto é a base da lâmina e o texto vai por cima numa área calma" : "o produto da foto entra recortado na composição",
    });
    const criteria: Record<string, unknown> = {};
    for (const id of p.candidatas) {
      const f = contexto.fotos.get(id);
      if (f) criteria[f.codigo] = f.descricao;
    }
    criteria.nenhuma = "Nenhuma destas fotos combina com o texto e a função desta lâmina; melhor sem foto real.";
    if (Object.keys(criteria).length < 3) return;
    questions[`foto_${k}`] = {
      type: "choice",
      instructions: `Qual foto real do cliente serve melhor para a lâmina \`laminas[${k}]\` desta campanha, pensando no produto em foco, na mensagem central (\`campanha.briefing\`) e no texto e na função da lâmina?`,
      criteria,
    };
  });
  if (!Object.keys(questions).length) return { plano, custo: 0 };
  const idDoCodigo = new Map(Array.from(contexto.fotos.entries()).map(([id, f]) => [f.codigo, id]));
  try {
    const r = await jevPerguntar({ state: { campanha: contexto.campanha, laminas }, questions });
    const cobrado = await cobrarJev(r, {
      clientId: cobranca.clientId,
      tarefa: "calendario",
      referencia: { tipo: "mesa_campanha", id: cobranca.campanhaId },
      criadoPor: cobranca.criadoPor,
    });
    const pecas = plano.pecas.slice();
    alvos.forEach(({ p, i }, k) => {
      const resposta = r.answers[`foto_${k}`];
      if (!resposta || typeof resposta.choice !== "string") return;
      const prob = resposta.probabilities ?? {};
      const escolhida = resposta.choice;
      const pEscolhida = Number(prob[escolhida] ?? resposta.confidence ?? 0);
      if (escolhida === "nenhuma") {
        if (pEscolhida >= 0.6) pecas[i] = { ...p, confianca: Math.round(pEscolhida * 100) / 100, aviso: "O Jev acha que nenhuma das fotos serve bem a esta lâmina. Confira antes de gerar." };
        return;
      }
      const id = idDoCodigo.get(escolhida);
      if (!id || p.candidatas.indexOf(id) < 0) return;
      if (id !== p.imagem_id && pEscolhida >= 0.5) {
        pecas[i] = { ...p, imagem_id: id, escolha: "jev", confianca: Math.round(pEscolhida * 100) / 100 };
      } else {
        pecas[i] = { ...p, confianca: Math.round(Number(prob[p.imagem_id ?? ""] ?? pEscolhida) * 100) / 100 };
      }
    });
    return { plano: { ...plano, pecas: semFundoRepetido(pecas), jev_erro: null }, custo: cobrado?.custoUsd ?? 0 };
  } catch (err) {
    const codigo = err instanceof JevErro ? err.codigo : "jev_falhou";
    console.error("[agente-calendario] jev do plano de imagens falhou", { codigo });
    return { plano: { ...plano, jev_erro: codigo }, custo: 0 };
  }
}

/** Descrição curta da foto para o Jev: a análise do estrategista, o papel e a nota da equipe. */
function descricoesDasFotos(
  plano: PlanoDeImagens,
  fotos: { foto: FotoDaCampanha; imagem?: ImagemDaCampanha | null }[],
): Map<string, { codigo: string; descricao: string }> {
  const mapa = new Map<string, { codigo: string; descricao: string }>();
  fotos.forEach((x, i) => {
    const a = plano.analise.find((y) => y.imagem_id === x.foto.id);
    const partes = [
      a?.o_que_mostra || x.foto.descricao || x.foto.nome,
      a?.forca ? `Força: ${a.forca}` : "",
      x.imagem ? `Papel na campanha: ${ROTULO_DO_PAPEL[x.imagem.papel]}` : "",
      x.imagem?.nota ? `Nota da equipe: ${x.imagem.nota}` : "",
    ].filter(Boolean);
    mapa.set(x.foto.id, { codigo: `F${i + 1}`, descricao: texto(partes.join(". "), 600) });
  });
  return mapa;
}

/**
 * O que a campanha leva para a tarefa da agenda: o briefing antes do roteiro
 * e, em cada card, a foto escolhida no plano (nome, id do acervo, uso e por
 * quê). O diretor de arte do Estúdio lê este texto (roteiro_e_contexto).
 */
async function campanhaNaAgenda(servico: SupabaseClient, c: Campanha): Promise<CampanhaNoItem> {
  const b = normalizarBriefing(c.briefing);
  const linhas: string[] = [`Campanha: ${c.nome}`];
  if (c.objetivo) linhas.push(`Objetivo da campanha: ${c.objetivo}`);
  if (b.produtos.length) linhas.push(`Produto(s) em foco: ${b.produtos.map((p) => (p.por_que ? `${p.nome} (${p.por_que})` : p.nome)).join("; ")}`);
  if (b.oferta) linhas.push(`Oferta: ${b.oferta}`);
  if (b.mensagem_central) linhas.push(`Mensagem central: ${b.mensagem_central}`);
  if (b.publico) linhas.push(`Público da campanha: ${b.publico}`);
  if (b.provas.length) linhas.push(`Provas: ${b.provas.join("; ")}`);
  if (b.tom) linhas.push(`Tom: ${b.tom}`);
  if (b.cta) linhas.push(`CTA da campanha: ${b.cta}`);
  const pecas = pecasDoPlanoGravado(c.plano_imagens);
  const fotos = await fotosDoAcervoPorId(servico, c.client_id, [...new Set(pecas.map((p) => p.imagem_id))]);
  const nomes = new Map(fotos.map((f) => [f.id, f.nome]));
  const porCard = new Map<string, string>();
  for (const p of pecas) {
    const nome = nomes.get(p.imagem_id);
    if (!nome) continue;
    porCard.set(`${p.tema_id}:${p.ordem}`, texto(`${nome} (acervo ${p.imagem_id}; ${p.uso === "fundo" ? "foto de fundo, usada como está" : "produto recortado como elemento"}). Por quê: ${p.por_que}`, 600));
  }
  return { linhas, fotoDoCard: (temaId, ordem) => porCard.get(`${temaId}:${ordem}`) ?? null };
}

/** Erro de coluna que ainda não existe (SQL de 25/09 não aplicado). */
const faltaColunaNova = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /briefing|plano_imagens|imagens/.test(String(e.message ?? "")));

const resumoDaCampanha = (c: Campanha, fotos: { imagem: ImagemDaCampanha; foto: FotoDaCampanha }[] = []) => {
  const briefing = normalizarBriefing(c.briefing);
  return {
    nome: c.nome,
    objetivo: c.objetivo,
    conceito: c.conceito,
    identidade: c.identidade,
    periodo: { inicio: c.periodo_inicio, fim: c.periodo_fim },
    briefing: briefingVazio(briefing) ? null : briefing,
    imagens_da_campanha: fotos.length
      ? fotos.map((x) => ({
        nome: texto(x.foto.nome, 120),
        papel: ROTULO_DO_PAPEL[x.imagem.papel],
        por_que: x.imagem.nota || null,
        descricao: texto(x.foto.descricao, 240) || null,
      }))
      : null,
  };
};

const REGRAS_DOS_ITENS = `Regras dos itens:
- formato: carrossel ou estatico. Estático tem exatamente 1 card.
- cards: roteiro de cada card em ordem (ordem, funcao como capa, desenvolvimento ou CTA final, texto exato do card, ilustracao, estilo). A história é uma só: a capa abre uma tensão com um gancho forte, cada card avança um passo e prepara o próximo com texto corrido e conectivos, nunca frases soltas; o CTA fecha a história. As ilustracoes formam UMA série: a mesma protagonista, o mesmo cenário e a mesma luz do começo ao fim, variando só a pose, o gesto e o enquadramento; prefira foto real do cliente quando o contexto tiver. Quantidade de cards pelo conteúdo: o mínimo que conta a história, em geral 4 a 6. Nunca escreva o nome da marca no texto dos cards.
- carrossel_infinito: true quando o carrossel for uma cena panorâmica contínua e isso fizer sentido.
- copy: a legenda completa do post.
- tipo_conteudo: principal (ou extra_sazonal para data comemorativa).
- status: planejado.`;

const ESQUEMA_PEDIDO = {
  nome: "pedido_do_mes",
  schema: obj({
    resposta: S("string"),
    itens: { type: "array", items: ESQUEMA_ITEM },
  }),
};

/**
 * pedido_livre { client_id, mensagem, anexos?, data_inicio?, campanha_id? }:
 * o agente do mês. A equipe pede em linguagem livre ("prepare três conteúdos
 * para a campanha X", "a agenda de hoje", "arte de depoimentos com estes
 * prints do Google") e o estrategista devolve os itens prontos numa proposta
 * pronta para gravar (gravar / conversar continuam iguais).
 */
async function pedidoLivre(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que você quer que o agente prepare.");
  const inicio = typeof corpo.data_inicio === "string" && DATA.test(corpo.data_inicio) ? corpo.data_inicio : hojeSaoPaulo();
  const fim = somarDias(inicio, 30);
  const uteis = diasUteisDoPeriodo(inicio, fim);

  const campanha = corpo.campanha_id ? await carregarCampanha(servico, corpo.campanha_id) : null;
  if (campanha && campanha.client_id !== clientId) throw new ErroHttp(403, "campanha_de_outro_cliente", "A campanha não é deste cliente.");

  const [ctx, anexos, projectId, conversaId, fotosDaCamp] = await Promise.all([
    montarContexto(servico, clientId, inicio, fim),
    baixarAnexos(servico, clientId, corpo.anexos),
    projetoSocialDoCliente(servico, clientId),
    conversaDoAgenteDoMes(servico, clientId, chamador.userId),
    campanha ? fotosDaCampanha(servico, campanha) : Promise.resolve([]),
  ]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  const { data: historico } = await servico
    .from("agente_mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(10);
  const anteriores = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 2000) }));

  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: {} })}
${campanha ? `\nCAMPANHA DESTES CONTEÚDOS (siga o conceito, a identidade e o briefing: produto em foco, oferta, mensagem central, público, provas e tom; quando a campanha tiver imagens, a ilustracao da lâmina que usa uma delas começa com "Foto real: <nome da imagem>"):\n${JSON.stringify(resumoDaCampanha(campanha, fotosDaCamp))}\n` : ""}
PEDIDO DA EQUIPE: ${mensagem}
${anexos.imagens.length ? `\nA equipe anexou ${anexos.imagens.length} imagem(ns) (prints, fotos ou referências). Use o conteúdo delas com fidelidade: depoimento ou avaliação vira texto transcrito exatamente como está (com o nome ou a inicial do autor quando aparecer), sem inventar nem melhorar a fala; foto do cliente vira indicação de uso da foto real na ilustracao.` : ""}

TAREFA: faça exatamente o que o pedido diz.
- Quantidade: a pedida (se não disser, 1 conteúdo).
- Datas: se o pedido disser uma data ou "hoje", use essa data (hoje é ${inicio}); senão, os próximos dias úteis livres a partir de ${inicio}. Só segunda a sexta.
- resposta: em 1 a 3 frases, o que você preparou e por quê.
${REGRAS_DOS_ITENS}`;

  const s = await chamarTexto({
    clientId,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens: anexos.imagens.length ? anexos.imagens : undefined }],
    raciocinio,
    esquemaJson: ESQUEMA_PEDIDO,
    referencia: { tipo: REF_AGENTE_DO_MES, id: conversaId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const itens = (Array.isArray(r.itens) ? r.itens : []).slice(0, 12).map((bruto, i) => {
    const item = normalizarItem(bruto, uteis);
    item.tema_id = `p${i + 1}`;
    if (campanha) (item as Item & { campanha_id?: string }).campanha_id = campanha.id;
    return item;
  }).filter((i) => i.tema);
  if (!itens.length) throw new ErroHttp(502, "pedido_sem_itens", "O agente não devolveu nenhum conteúdo. Tente descrever de novo.", { uso_id: s.usoId });
  itens.sort((a, b) => a.data.localeCompare(b.data));

  const { data: proposta, error } = await servico
    .from("calendario_propostas")
    .insert({
      client_id: clientId,
      project_id: projectId,
      periodo_inicio: itens[0].data,
      periodo_fim: itens[itens.length - 1].data,
      parametros: { origem: "pedido_livre", mensagem, anexos: anexos.caminhos, campanha_id: campanha?.id ?? null, modelo: modelo.id },
      status: "pronta",
      diagnostico: null,
      temas: [],
      itens,
      task_ids: [],
      conversa_id: conversaId,
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (error || !proposta) throw new ErroHttp(503, "proposta_nao_gravada", "O agente preparou os conteúdos, mas não foi possível guardar. Tente de novo.", { uso_id: s.usoId });

  const resposta = texto(r.resposta, 2000) || `Preparei ${itens.length} conteúdo(s).`;
  await registrarMensagens(servico, conversaId, clientId, [
    { papel: "usuario", conteudo: mensagem, anexos: anexos.caminhos.map((c) => ({ caminho: c })) },
    { papel: "agente", conteudo: resposta, uso_id: s.usoId, anexos: [{ proposta_id: proposta.id }] },
  ]);
  return json({ proposta, resposta, conversa_id: conversaId, project_id: projectId, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

// ------------------------------------------------------------------ hypes

const ESQUEMA_HYPES = {
  nome: "hypes_da_semana",
  schema: obj({
    resumo: S("string"),
    hypes: {
      type: "array",
      items: obj({
        titulo: S("string"),
        o_que_e: S("string"),
        por_que_agora: S("string"),
        fonte: S("string"),
        janela: S("string", { enum: ["hoje", "esta_semana", "proximas_semanas"] }),
        como_usar: S("string"),
        formato: S("string", { enum: [...FORMATOS] }),
        cuidado: S("string"),
      }),
    },
  }),
};

const NIVEIS_HYPE = [
  "Não serve: fora do nicho, do público ou da região, ou arriscado para a marca.",
  "Serve pouco: dá para forçar uma ligação, mas o público do cliente não se importa.",
  "Serve: o público do cliente conhece o assunto e a marca tem algo a dizer.",
  "Serve muito: assunto quente para o público do cliente, com ligação natural com a oferta e seguro para a marca.",
];

/**
 * buscar_hypes { client_id, forcar? }: os assuntos em alta da semana que servem
 * a ESTE cliente (pesquisa na web + contexto do cliente), com a nota do Jev de
 * relevância. Uma busca por semana: repetir o clique devolve a mesma, sem custo.
 */
async function buscarHypes(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const hoje = hojeSaoPaulo();
  const semana = segundaDaSemana(hoje);
  if (corpo.forcar !== true) {
    const { data: ja } = await servico.from("mesa_hypes").select("*").eq("client_id", clientId).eq("semana", semana).maybeSingle();
    if (ja) return json({ hypes: ja, cache: true, custo_usd: 0 });
  }

  const ctx = await montarContexto(servico, clientId, hoje, somarDias(hoje, 14));
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio, { pesquisaWeb: true });
  const pedido = `${contextoEmTexto(ctx, { inicio: hoje, fim: somarDias(hoje, 14), parametros: {} })}

TAREFA: hoje é ${hoje}. Pesquise na web o que está em alta AGORA (esta semana e as próximas duas) no Brasil e na região deste cliente: datas comemorativas, notícias, eventos locais, tendências e formatos virais no Instagram, memes e assuntos que o público deste nicho está comentando. Escolha de 5 a 8 hypes que ESTE cliente pode usar com naturalidade e segurança.
Para cada um:
- titulo curto; o_que_e em 1 a 2 frases; por_que_agora (o que está acontecendo, com data); fonte: um link real da pesquisa.
- janela: hoje, esta_semana ou proximas_semanas.
- como_usar: a ideia de conteúdo concreta para este cliente (gancho e ângulo), ligada à oferta dele.
- formato: carrossel ou estatico.
- cuidado: o que evitar para a marca não parecer oportunista ou errar o tom (vazio se não houver).
- resumo: 1 frase sobre o clima da semana para este nicho.
Nada de assunto político, tragédia ou polêmica que exponha a marca. Nunca invente evento nem data.`;

  const s = await chamarTexto({
    clientId,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [{ papel: "usuario", conteudo: pedido }],
    raciocinio,
    pesquisaWeb: true,
    esquemaJson: ESQUEMA_HYPES,
    referencia: { tipo: "mesa_hypes", id: clientId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as { resumo?: string; hypes?: Record<string, unknown>[] };
  let hypes = (Array.isArray(r.hypes) ? r.hypes : []).slice(0, 10).map((h) => ({
    titulo: texto(h.titulo, 160),
    o_que_e: texto(h.o_que_e, 600),
    por_que_agora: texto(h.por_que_agora, 600),
    fonte: texto(h.fonte, 500),
    janela: ["hoje", "esta_semana", "proximas_semanas"].includes(String(h.janela)) ? String(h.janela) : "esta_semana",
    como_usar: texto(h.como_usar, 800),
    formato: String(h.formato) === "estatico" ? "estatico" : "carrossel",
    cuidado: texto(h.cuidado, 400),
    nota: null as number | null,
  })).filter((h) => h.titulo);
  let custo = s.custoUsd;

  // Relevância para ESTE cliente pelo Jev (centavos); ordena pela nota.
  if (hypes.length) {
    try {
      const questions: Record<string, PerguntaJev> = {};
      hypes.forEach((_, i) => {
        questions[`h${i}`] = {
          type: "score",
          instructions: `Quanto o assunto \`hypes[${i}]\` serve para a marca em \`cliente\` falar com o público dela nesta semana?`,
          criteria: NIVEIS_HYPE,
        };
      });
      const kit = (ctx.kit_marca ?? {}) as { contexto?: Record<string, unknown> };
      const j = await jevPerguntar({
        state: { cliente: { nome: ctx.cliente.nome, negocio: kit.contexto?.negocio ?? null, publico: kit.contexto?.publico ?? null }, hypes },
        questions,
      });
      const cobrado = await cobrarJev(j, { clientId, tarefa: "calendario", referencia: { tipo: "mesa_hypes", id: clientId }, criadoPor: chamador.userId });
      if (cobrado) custo += cobrado.custoUsd;
      hypes = hypes
        .map((h, i) => ({ ...h, nota: notaDe0a10(notaScore(j.answers[`h${i}`]), NIVEIS_HYPE.length) }))
        .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
    } catch {
      // Sem Jev a lista vai na ordem da pesquisa.
    }
  }

  const { data: gravado, error } = await servico
    .from("mesa_hypes")
    .upsert({ client_id: clientId, semana, itens: hypes, resumo: texto(r.resumo, 600) || null, custo_usd: custo, criado_por: chamador.userId, criado_em: new Date().toISOString() }, { onConflict: "client_id,semana" })
    .select("*")
    .single();
  if (error || !gravado) throw new ErroHttp(503, "hypes_nao_gravados", "A pesquisa foi feita, mas não foi guardada. Tente de novo.", { uso_id: s.usoId });
  return json({ hypes: gravado, cache: false, custo_usd: custo, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

// --------------------------------------------------------------- campanhas

const ESQUEMA_CAMPANHA = {
  nome: "campanha",
  schema: obj({
    nome: S("string"),
    objetivo: S("string"),
    conceito: S("string"),
    resposta: S("string"),
    identidade: obj({
      tema_visual: S("string"),
      paleta_apoio: { type: "array", items: obj({ nome: S("string"), hex: S("string") }) },
      tipografia: S("string"),
      elementos: S("string"),
      tom: S("string"),
      selo: obj({ texto: S("string"), descricao: S("string") }),
    }),
    briefing: ESQUEMA_BRIEFING,
    itens: { type: "array", items: ESQUEMA_ITEM },
    plano_imagens: ESQUEMA_PLANO_IMAGENS,
  }),
};

function normalizarIdentidade(bruto: unknown): Record<string, unknown> {
  const o = (bruto ?? {}) as Record<string, any>;
  const HEX = /^#[0-9a-f]{6}$/i;
  return {
    tema_visual: texto(o.tema_visual, 1200),
    paleta_apoio: (Array.isArray(o.paleta_apoio) ? o.paleta_apoio : [])
      .map((p: any) => ({ nome: texto(p?.nome, 40), hex: texto(p?.hex, 7).toUpperCase() }))
      .filter((p: { hex: string }) => HEX.test(p.hex))
      .slice(0, 4),
    tipografia: texto(o.tipografia, 400),
    elementos: texto(o.elementos, 800),
    tom: texto(o.tom, 400),
    selo: { texto: texto(o.selo?.texto, 60), descricao: texto(o.selo?.descricao, 600) },
  };
}

/**
 * campanha_criar { client_id, pedido, periodo_inicio?, periodo_fim?, quantidade?,
 * anexos?, referencias_ids?, hype? }: o estrategista cria a campanha inteira
 * (nome, conceito, identidade do tema com selo, e os conteúdos) numa proposta
 * pronta para gravar. Os conteúdos gravados chegam ao Estúdio com a campanha.
 */
async function campanhaCriar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const pedidoTexto = texto(corpo.pedido, 4000);
  if (!pedidoTexto) throw new ErroHttp(400, "pedido_vazio", "Descreva a campanha (tema, ocasião, oferta).");
  const inicio = typeof corpo.periodo_inicio === "string" && DATA.test(corpo.periodo_inicio) ? corpo.periodo_inicio : hojeSaoPaulo();
  let fim = typeof corpo.periodo_fim === "string" && DATA.test(corpo.periodo_fim) ? corpo.periodo_fim : somarDias(inicio, 21);
  if (fim < inicio) fim = inicio;
  if (diasEntre(inicio, fim) > 62) throw new ErroHttp(400, "periodo_longo", "Campanha de até 2 meses por vez.");
  const uteis = diasUteisDoPeriodo(inicio, fim);
  if (!uteis.length) throw new ErroHttp(400, "periodo_sem_dia_util", "O período não tem nenhum dia de segunda a sexta.");
  const quantidade = Number.isInteger(Number(corpo.quantidade)) && Number(corpo.quantidade) >= 1 && Number(corpo.quantidade) <= 12 ? Number(corpo.quantidade) : null;
  const referencias = (Array.isArray(corpo.referencias_ids) ? corpo.referencias_ids : []).map(String).filter((r) => /^(g:)?[0-9a-f-]{36}$/i.test(r)).slice(0, 8);
  const hype = corpo.hype && typeof corpo.hype === "object" ? corpo.hype : null;
  // Briefing e imagens que a equipe já definiu no formulário (valem sobre o que o estrategista sugerir).
  const briefingDaEquipe = normalizarBriefing(corpo.briefing);
  const imagensPedidas = normalizarImagensDaCampanha(corpo.imagens);

  const [ctx, anexos, projectId, fotosAchadas] = await Promise.all([
    montarContexto(servico, clientId, inicio, fim),
    baixarAnexos(servico, clientId, corpo.anexos),
    projetoSocialDoCliente(servico, clientId),
    fotosDoAcervoPorId(servico, clientId, imagensPedidas.map((i) => i.imagem_id)),
  ]);
  const fotos = imagensPedidas
    .map((imagem) => ({ imagem, foto: fotosAchadas.find((f) => f.id === imagem.imagem_id) }))
    .filter((x): x is { imagem: ImagemDaCampanha; foto: FotoDaCampanha } => !!x.foto);
  const imagensValidas = fotos.map((x) => x.imagem);
  // As fotos da campanha vão à vista do estrategista (reduzidas), antes dos anexos do pedido.
  const lidas = await Promise.all(fotos.map((x, i) => fotoParaLeitura(servico, x.foto, `F${i + 1}`)));
  const codigos = new Map<string, string>();
  const fotosVistas: { imagem: ImagemDaCampanha; foto: FotoDaCampanha }[] = [];
  const imagensDaChamada: ImagemEntrada[] = [];
  lidas.forEach((img, i) => {
    if (!img) return;
    fotosVistas.push(fotos[i]);
    codigos.set(`F${fotosVistas.length}`, fotos[i].foto.id);
    imagensDaChamada.push({ ...img, nome: `F${fotosVistas.length}.${img.mime.split("/")[1]}` });
  });
  anexos.imagens.forEach((img) => imagensDaChamada.push(img));
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  // O id nasce antes: o uso de IA fica ligado à campanha, não ao cliente.
  const campanhaId = crypto.randomUUID();
  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: {} })}

PEDIDO DE CAMPANHA DA EQUIPE: ${pedidoTexto}
${hype ? `\nA campanha nasce deste assunto em alta: ${JSON.stringify(hype)}\n` : ""}${briefingVazio(briefingDaEquipe) ? "" : `\nBRIEFING QUE A EQUIPE JÁ DEFINIU (mantenha exatamente e complete o que faltar):\n${JSON.stringify(briefingDaEquipe)}\n`}${fotosVistas.length ? `\nFOTOS DA CAMPANHA escolhidas pela equipe (vêm nesta ordem, antes de qualquer outra imagem; cite pelo código):\n${JSON.stringify(catalogoDasFotos(fotosVistas))}\n` : ""}${anexos.imagens.length ? `\nDepois ${fotosVistas.length ? "das fotos da campanha" : "do texto"}, a equipe anexou ${anexos.imagens.length} imagem(ns) de referência ou material da campanha; use com fidelidade.\n` : ""}
TAREFA: crie a campanha completa para ${inicio} a ${fim}. Nada genérico: cada parte fala do produto em foco, da oferta e do público deste cliente.
- nome: nome curto e memorável da campanha (é o tema, não o nome da marca).
- objetivo: o resultado de negócio que a campanha busca, em 1 frase.
- conceito: a grande ideia em 2 a 4 frases (o que a campanha diz, por que funciona para este público).
- briefing: produtos (1 a 3 produtos ou serviços em foco, cada um com por_que: por que este produto nesta campanha e neste período), oferta (a oferta concreta; se o pedido e o contexto não disserem, escreva "sem oferta definida" e nunca invente preço, desconto ou prazo), mensagem_central (a frase que o público precisa entender), publico (quem a campanha quer alcançar, concreto: quem é, o que quer, o que trava), provas (1 a 4 provas reais do contexto: depoimentos, números, garantias; nunca invente; sem prova real, lista vazia), tom (como a campanha fala), cta (a ação principal pedida).
- identidade: a identidade visual DO TEMA, que vive dentro da marca: tema_visual (clima, fotografia, composição recorrente em 3 a 5 frases), paleta_apoio (1 a 3 cores de apoio em hex que harmonizam com a paleta da marca, nunca substituindo a principal), tipografia (como o título da campanha aparece), elementos (grafismos, formas, selo, texturas), tom (como a campanha fala), selo (texto curto do selo ou logo do tema, até 4 palavras, e a descricao visual do selo).
- itens: ${quantidade ? `exatamente ${quantidade}` : "de 3 a 8"} conteúdos dentro do período, contando a campanha do teaser ao fechamento (aquecimento, lançamento, prova, urgência, último chamado), sem repetir estrutura; datas só de segunda a sexta entre ${inicio} e ${fim}. Cada conteúdo mostra o produto em foco e serve à mensagem central.${fotosVistas.length ? ' Quando uma lâmina usar uma foto da campanha, a ilustracao dela começa com "Foto real: <nome da foto>" e diz o enquadramento.' : ""}
- plano_imagens: ${fotosVistas.length ? "qual foto da campanha vai em qual lâmina e por quê." : "sem fotos da campanha: analise e pecas vazias; nas lacunas, as fotos que a equipe deveria trazer."}
- resposta: 1 a 3 frases com o resumo da campanha para a equipe.
${REGRAS_DOS_ITENS}
${REGRAS_DO_PLANO_DE_IMAGENS}`;

  const s = await chamarTexto({
    clientId,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [{ papel: "usuario", conteudo: pedido, imagens: imagensDaChamada.length ? imagensDaChamada : undefined }],
    raciocinio,
    esquemaJson: ESQUEMA_CAMPANHA,
    referencia: { tipo: "mesa_campanha", id: campanhaId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  // Na ordem do modelo (o plano cita o conteúdo pela posição); a lista gravada sai por data.
  const naOrdem = (Array.isArray(r.itens) ? r.itens : []).slice(0, 12).map((bruto, i) => {
    const item = normalizarItem(bruto, uteis);
    item.tema_id = `c${i + 1}`;
    (item as Item & { campanha_id?: string }).campanha_id = campanhaId;
    return item;
  });
  const itens = naOrdem.filter((i) => i.tema).sort((a, b) => a.data.localeCompare(b.data));
  if (!itens.length) throw new ErroHttp(502, "campanha_sem_itens", "O estrategista não devolveu os conteúdos da campanha. Tente de novo.", { uso_id: s.usoId });

  const briefing = juntarBriefing(normalizarBriefing(r.briefing), briefingDaEquipe);
  // Plano de imagens: o do estrategista, decidido pelo Jev onde há mais de uma candidata.
  let plano: PlanoDeImagens | null = null;
  let custoJev = 0;
  if (fotosVistas.length) {
    const base = normalizarPlanoDeImagens(
      r.plano_imagens,
      codigos,
      naOrdem.map((i) => (i.tema ? i : { ...i, tema_id: "", cards: [] })),
      { assinatura: assinaturaDoPlano(imagensValidas, itens), fonte: "campanha" },
    );
    base.pecas = base.pecas.filter((p) => p.tema_id);
    const decidido = await decidirFotosComJev(base, {
      campanha: { nome: texto(r.nome, 120), objetivo: texto(r.objetivo, 600), briefing },
      fotos: descricoesDasFotos(base, fotosVistas),
      itens,
    }, { clientId, campanhaId, criadoPor: chamador.userId });
    plano = decidido.plano;
    custoJev = decidido.custo;
  } else {
    const lacunas = (r.plano_imagens as Record<string, unknown> | undefined)?.lacunas;
    const soLacunas = (Array.isArray(lacunas) ? lacunas : []).map((l) => texto(l, 300)).filter(Boolean).slice(0, 8);
    if (soLacunas.length) {
      plano = {
        gerado_em: new Date().toISOString(), assinatura: assinaturaDoPlano([], itens), fonte: "campanha",
        resumo: "", analise: [], pecas: [], lacunas: soLacunas, jev_erro: null,
      };
    }
  }
  const custoTotal = Math.round((s.custoUsd + custoJev) * 1e6) / 1e6;

  const { data: proposta, error: erroProposta } = await servico
    .from("calendario_propostas")
    .insert({
      client_id: clientId,
      project_id: projectId,
      periodo_inicio: inicio,
      periodo_fim: fim,
      parametros: { origem: "campanha", campanha_id: campanhaId, modelo: modelo.id },
      status: "pronta",
      diagnostico: texto(r.conceito, 4000) || null,
      temas: [],
      itens,
      task_ids: [],
      criado_por: chamador.userId,
    })
    .select("*")
    .single();
  if (erroProposta || !proposta) throw new ErroHttp(503, "proposta_nao_gravada", "A campanha foi escrita, mas os conteúdos não foram guardados.", { uso_id: s.usoId });

  const linhaDaCampanha: Record<string, unknown> = {
    id: campanhaId,
    client_id: clientId,
    nome: texto(r.nome, 120) || "Campanha",
    pedido: pedidoTexto,
    objetivo: texto(r.objetivo, 600) || null,
    periodo_inicio: inicio,
    periodo_fim: fim,
    conceito: texto(r.conceito, 2000) || null,
    identidade: normalizarIdentidade(r.identidade),
    referencias_ids: referencias,
    proposta_id: proposta.id,
    status: "planejada",
    custo_usd: custoTotal,
    criado_por: chamador.userId,
  };
  let { data: campanha, error } = await servico
    .from("mesa_campanhas")
    .insert({ ...linhaDaCampanha, briefing, imagens: imagensValidas, plano_imagens: plano })
    .select("*")
    .single();
  if (error && faltaColunaNova(error)) {
    // SQL de 25/09 ainda não aplicado: a campanha nasce sem briefing, imagens e plano (a resposta paga não se perde).
    console.error("[agente-calendario] mesa_campanhas sem as colunas de 25/09; gravando sem briefing e imagens", { campanha_id: campanhaId });
    ({ data: campanha, error } = await servico.from("mesa_campanhas").insert(linhaDaCampanha).select("*").single());
  }
  if (error || !campanha) {
    // Sem campanha, a proposta não fica órfã na lista.
    await servico.from("calendario_propostas").update({ status: "descartada" }).eq("id", proposta.id).eq("client_id", clientId);
    throw new ErroHttp(503, "campanha_nao_gravada", "A campanha foi escrita, mas não foi guardada. Tente de novo.", { uso_id: s.usoId });
  }

  // O pedido e o resumo viram a primeira conversa da campanha (a resposta paga não se perde).
  try {
    const conversaId = await conversaDaCampanha(servico, campanha as Campanha, chamador.userId);
    await registrarMensagens(servico, conversaId, clientId, [
      { papel: "usuario", conteudo: pedidoTexto },
      { papel: "agente", conteudo: texto(r.resposta, 2000) || "Campanha criada.", uso_id: s.usoId, anexos: [{ proposta_id: proposta.id }] },
    ]);
  } catch (e) {
    console.error("[agente-calendario] conversa inicial da campanha nao gravada", { campanha_id: campanhaId, erro: String(e) });
  }

  return json({ campanha, proposta, resposta: texto(r.resposta, 2000), project_id: projectId, custo_usd: custoTotal, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

const ESQUEMA_AJUSTE_CAMPANHA = {
  nome: "ajuste_da_campanha",
  schema: obj({
    resposta: S("string"),
    nome: S("string"),
    objetivo: S("string"),
    conceito: S("string"),
    identidade: ESQUEMA_CAMPANHA.schema.properties.identidade,
    briefing: ESQUEMA_BRIEFING,
  }),
};

/** campanha_ajustar { campanha_id, mensagem }: muda nome, conceito e identidade pelo pedido (os conteúdos se ajustam em conversar da proposta). */
async function campanhaAjustar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCampanha(servico, corpo.campanha_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  const mensagem = texto(corpo.mensagem, 3000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o ajuste que você quer na campanha.");
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "low");
  const s = await chamarTexto({
    clientId: c.client_id,
    tarefa: "conversa",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `Você é o estrategista da agência ajustando uma campanha já criada. Mantenha tudo o que o pedido não manda mudar. Português do Brasil, sem travessões. Responda só com o JSON pedido.`,
    mensagens: [{ papel: "usuario", conteudo: `CAMPANHA ATUAL:\n${JSON.stringify(resumoDaCampanha(c))}\n\nPEDIDO: ${mensagem}\n\nDevolva a campanha completa atualizada (nome, objetivo, conceito, identidade, briefing) e em resposta o que mudou.` }],
    raciocinio,
    esquemaJson: ESQUEMA_AJUSTE_CAMPANHA,
    referencia: { tipo: "mesa_campanha", id: c.id },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;
  const { data, error } = await servico
    .from("mesa_campanhas")
    .update({
      nome: texto(r.nome, 120) || c.nome,
      objetivo: texto(r.objetivo, 600) || c.objetivo,
      conceito: texto(r.conceito, 2000) || c.conceito,
      identidade: r.identidade ? normalizarIdentidade(r.identidade) : c.identidade,
      // Só com a coluna no banco (select * da campanha a traz); antes do SQL de 25/09 fica de fora.
      ...(c.briefing !== undefined && r.briefing ? { briefing: normalizarBriefing(r.briefing) } : {}),
    })
    .eq("id", c.id)
    .eq("client_id", c.client_id)
    .select("*")
    .single();
  if (error || !data) throw new ErroHttp(503, "campanha_nao_salva", "O ajuste foi feito, mas não foi salvo.", { uso_id: s.usoId });
  await somarCustoDaCampanha(servico, c.id, c.client_id, s.custoUsd);
  (data as Campanha).custo_usd = Math.round((Number((data as Campanha).custo_usd) + s.custoUsd) * 1e6) / 1e6;
  return json({ campanha: data, resposta: texto(r.resposta, 2000) || "Campanha ajustada.", custo_usd: s.custoUsd, saldo_usd: s.saldoUsd });
}

/**
 * campanha_selo { campanha_id }: desenha o selo (logo do tema) da campanha com
 * o gerador de imagem, no fundo limpo, e guarda em mesa/<cliente>/campanhas/.
 * O Estúdio anexa o selo na capa e no fechamento dos conteúdos da campanha.
 */
async function campanhaSelo(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCampanha(servico, corpo.campanha_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  const modelo = await modeloPadrao("imagem");
  if (!modelo) throw new ErroHttp(409, "sem_modelo_de_imagem", "O catálogo não tem gerador de imagem padrão.");
  const id = (c.identidade ?? {}) as Record<string, any>;
  const { data: kit } = await servico.from("cliente_kit_marca").select("paleta").eq("client_id", c.client_id).maybeSingle();
  const paleta = [...(Array.isArray((kit as any)?.paleta) ? (kit as any).paleta : []), ...(Array.isArray(id.paleta_apoio) ? id.paleta_apoio : [])]
    .map((p: any) => `${p?.nome ?? "cor"} ${p?.hex ?? ""}`).join(", ");
  const textoSelo = texto(id.selo?.texto, 60) || c.nome;
  const prompt = [
    `SELO (logo do tema) da campanha "${c.nome}".`,
    `Escreva exatamente este texto, com a grafia e os acentos certos, e nenhum outro: "${textoSelo}".`,
    id.selo?.descricao ? `Desenho do selo: ${id.selo.descricao}` : "Selo gráfico simples e marcante, legível em tamanho pequeno.",
    id.tipografia ? `Tipografia: ${id.tipografia}` : "",
    paleta ? `Cores: ${paleta}.` : "",
    "Fundo branco liso e vazio em volta (o fundo será removido). Um único selo centralizado, com margem, sem mockup, sem sombra de cena, sem outros elementos, vetorial e limpo.",
  ].filter(Boolean).join("\n");
  const img = await chamarImagem({
    clientId: c.client_id,
    modeloId: modelo.id,
    prompt,
    referencias: [],
    qualidade: "media",
    tamanho: "1024x1024",
    referencia: { tipo: "mesa_campanha", id: c.id },
    criadoPor: chamador.userId,
    tarefa: "estudio",
    agente: "gerador_imagem",
  });
  let png = img.png;
  try {
    png = await logoLimpa(img.png);
  } catch {
    // vai com o fundo branco
  }
  const caminho = `${c.client_id}/campanhas/${c.id}/selo-${Date.now()}.png`;
  const { error: erroUpload } = await servico.storage.from("mesa").upload(caminho, new Blob([new Uint8Array(png)], { type: "image/png" }), { contentType: "image/png" });
  if (erroUpload) throw new ErroHttp(503, "selo_nao_guardado", "O selo foi desenhado, mas não foi guardado.", { uso_id: img.usoId });
  const { data, error } = await servico
    .from("mesa_campanhas")
    .update({ selo_path: caminho })
    .eq("id", c.id)
    .eq("client_id", c.client_id)
    .select("*")
    .single();
  if (error || !data) throw new ErroHttp(503, "campanha_nao_salva", "O selo foi guardado, mas a campanha não foi atualizada.");
  await somarCustoDaCampanha(servico, c.id, c.client_id, img.custoUsd);
  (data as Campanha).custo_usd = Math.round((Number((data as Campanha).custo_usd) + img.custoUsd) * 1e6) / 1e6;
  return json({ campanha: data, selo_path: caminho, custo_usd: img.custoUsd, saldo_usd: img.saldoUsd });
}

// ------------------------------------------------- conversa da campanha

const REF_CAMPANHA = "mesa_campanha";

const ESQUEMA_CONVERSA_CAMPANHA = {
  nome: "conversa_da_campanha",
  schema: obj({
    resposta: S("string"),
    campanha: {
      ...obj({
        nome: S("string"),
        objetivo: S("string"),
        conceito: S("string"),
        identidade: ESQUEMA_CAMPANHA.schema.properties.identidade,
        briefing: ESQUEMA_BRIEFING,
      }),
      type: ["object", "null"],
    },
    itens: { type: ["array", "null"], items: ESQUEMA_ITEM },
  }),
};

async function conversaDaCampanha(servico: SupabaseClient, c: Campanha, userId: string): Promise<string> {
  const { data } = await servico
    .from("agente_conversas")
    .select("id")
    .eq("client_id", c.client_id)
    .eq("agente", AGENTE)
    .eq("referencia_tipo", REF_CAMPANHA)
    .eq("referencia_id", c.id)
    .order("criado_em", { ascending: false })
    .limit(1);
  const existente = ((data as { id: string }[] | null) ?? [])[0]?.id;
  if (existente) return existente;
  const { data: nova, error } = await servico
    .from("agente_conversas")
    .insert({ client_id: c.client_id, agente: AGENTE, referencia_tipo: REF_CAMPANHA, referencia_id: c.id, criado_por: userId })
    .select("id")
    .single();
  if (error || !nova) throw new ErroHttp(500, "conversa_nao_criada", "Não foi possível abrir a conversa da campanha.");
  return nova.id;
}

/**
 * campanha_conversar { campanha_id, mensagem, anexos? }: o agente da campanha.
 * Aplica o pedido na campanha (nome, objetivo, conceito, identidade) e nos
 * conteúdos da proposta ligada (muda, acrescenta ou tira). Conteúdo já gravado
 * na agenda não muda por aqui: a resposta diz para ajustar no Estúdio.
 */
async function campanhaConversar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCampanha(servico, corpo.campanha_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que você quer na campanha.");

  const proposta = c.proposta_id ? await carregarProposta(servico, c.proposta_id).catch(() => null) : null;
  const inicio = c.periodo_inicio ?? hojeSaoPaulo();
  const fim = c.periodo_fim ?? somarDias(inicio, 21);
  const uteis = diasUteisDoPeriodo(inicio, fim);
  const podeMudarItens = !!proposta && proposta.status !== "gravada" && proposta.status !== "descartada";

  const [ctx, anexos, conversaId, fotosDaCamp] = await Promise.all([
    montarContexto(servico, c.client_id, inicio, fim),
    baixarAnexos(servico, c.client_id, corpo.anexos),
    conversaDaCampanha(servico, c, chamador.userId),
    fotosDaCampanha(servico, c),
  ]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  const { data: historico } = await servico
    .from("agente_mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(12);
  const anteriores = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 2000) }));

  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: {} })}

CAMPANHA ATUAL (JSON):
${JSON.stringify({ ...resumoDaCampanha(c, fotosDaCamp), status: c.status })}

CONTEÚDOS DA CAMPANHA (JSON${podeMudarItens ? "" : "; JÁ GRAVADOS NA AGENDA, NÃO MUDE"}):
${JSON.stringify(proposta?.itens ?? [])}

PEDIDO DA EQUIPE: ${mensagem}
${anexos.imagens.length ? `\nA equipe anexou ${anexos.imagens.length} imagem(ns); use o conteúdo com fidelidade.\n` : ""}
${fotosDaCamp.length ? `Os conteúdos seguem o briefing e usam as imagens da campanha: a ilustracao da lâmina que usa uma delas começa com "Foto real: <nome da imagem>".
` : ""}Aplique o pedido. Devolva:
- resposta: o que você mudou ou respondeu, em até 4 frases.
- campanha: a campanha COMPLETA atualizada (nome, objetivo, conceito, identidade, briefing) só se algo dela mudou; senão null. As imagens da campanha a equipe escolhe na tela (seção Imagens): se o pedido for trocar imagem, diga isso na resposta.
- itens: ${podeMudarItens ? `a lista COMPLETA de conteúdos atualizada só se algum conteúdo mudou, entrou ou saiu (mantenha tema_id dos que ficam; novo recebe tema_id novo); senão null. Datas só de segunda a sexta entre ${inicio} e ${fim}.` : "sempre null (os conteúdos já estão na agenda; se o pedido for sobre eles, diga na resposta para ajustar no Estúdio)."}
${REGRAS_DOS_ITENS}`;

  const s = await chamarTexto({
    clientId: c.client_id,
    tarefa: "conversa",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens: anexos.imagens.length ? anexos.imagens : undefined }],
    raciocinio,
    esquemaJson: ESQUEMA_CONVERSA_CAMPANHA,
    referencia: { tipo: REF_CAMPANHA, id: c.id },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;

  let campanha: Campanha = c;
  const nova = r.campanha && typeof r.campanha === "object" ? (r.campanha as Record<string, unknown>) : null;
  const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (nova) {
    campos.nome = texto(nova.nome, 120) || c.nome;
    campos.objetivo = texto(nova.objetivo, 600) || c.objetivo;
    campos.conceito = texto(nova.conceito, 2000) || c.conceito;
    if (nova.identidade) campos.identidade = normalizarIdentidade(nova.identidade);
    // Só com a coluna no banco (select * da campanha a traz); antes do SQL de 25/09 fica de fora.
    if (nova.briefing && c.briefing !== undefined) campos.briefing = normalizarBriefing(nova.briefing);
  }
  const { data: gravada, error } = await servico
    .from("mesa_campanhas")
    .update(campos)
    .eq("id", c.id)
    .eq("client_id", c.client_id)
    .select("*")
    .single();
  if (error || !gravada) throw new ErroHttp(503, "campanha_nao_salva", "O agente respondeu, mas a campanha não foi salva.", { uso_id: s.usoId });
  campanha = gravada as Campanha;
  await somarCustoDaCampanha(servico, c.id, c.client_id, s.custoUsd);
  campanha.custo_usd = Math.round((Number(campanha.custo_usd) + s.custoUsd) * 1e6) / 1e6;

  let propostaFinal = proposta;
  if (podeMudarItens && proposta && Array.isArray(r.itens) && uteis.length) {
    const tarefaDoTema = new Map(proposta.itens.filter((i) => i.task_id).map((i) => [i.tema_id, i.task_id]));
    // Próximo id a partir do maior cN que já existiu (tirar um conteúdo não reaproveita id).
    let seq = Math.max(proposta.itens.length, ...proposta.itens.map((i) => Number(String(i.tema_id).replace(/^c/, "")) || 0));
    const usados = new Set<string>();
    const itens = r.itens.slice(0, 12).map((bruto) => {
      const item = normalizarItem(bruto, uteis);
      if (!item.tema_id || usados.has(item.tema_id)) {
        do item.tema_id = `c${++seq}`; while (usados.has(item.tema_id));
      }
      usados.add(item.tema_id);
      item.campanha_id = c.id;
      if (tarefaDoTema.has(item.tema_id)) item.task_id = tarefaDoTema.get(item.tema_id) ?? null;
      return item;
    }).filter((i) => i.tema).sort((a, b) => a.data.localeCompare(b.data));
    if (itens.length) propostaFinal = await salvarProposta(servico, proposta, { itens });
  }

  const resposta = texto(r.resposta, 2000) || "Campanha atualizada.";
  await registrarMensagens(servico, conversaId, c.client_id, [
    { papel: "usuario", conteudo: mensagem, anexos: anexos.caminhos.map((x) => ({ caminho: x })) },
    { papel: "agente", conteudo: resposta, uso_id: s.usoId, anexos: propostaFinal && propostaFinal !== proposta ? [{ proposta_id: propostaFinal.id }] : [] },
  ]);
  return json({ campanha, proposta: propostaFinal, resposta, conversa_id: conversaId, custo_usd: s.custoUsd, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

// ------------------------------------ imagens, briefing e plano da campanha

/**
 * campanha_salvar { campanha_id, briefing?, imagens?, objetivo? }: grava o que
 * a equipe definiu na tela, sem IA e sem custo. Salva só o que veio (parcial):
 * briefing e imagens podem ser salvos em momentos diferentes sem um apagar o
 * outro. Cada imagem é conferida no acervo do cliente (cliente_imagens ativa,
 * do próprio cliente, e nunca referência da internet); a recusada volta em
 * `recusadas` e não entra. Resposta: { campanha, recusadas, custo_usd: 0 }.
 */
async function campanhaSalvar(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCampanha(servico, corpo.campanha_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  const campos: Record<string, unknown> = {};
  let recusadas: string[] = [];
  if (corpo.briefing !== undefined) campos.briefing = normalizarBriefing(corpo.briefing);
  if (typeof corpo.objetivo === "string") campos.objetivo = texto(corpo.objetivo, 600) || null;
  if (corpo.imagens !== undefined) {
    const pedidas = normalizarImagensDaCampanha(corpo.imagens);
    const achadas = new Set((await fotosDoAcervoPorId(servico, c.client_id, pedidas.map((i) => i.imagem_id))).map((f) => f.id));
    campos.imagens = pedidas.filter((i) => achadas.has(i.imagem_id));
    recusadas = pedidas.filter((i) => !achadas.has(i.imagem_id)).map((i) => i.imagem_id);
  }
  if (!Object.keys(campos).length) throw new ErroHttp(400, "nada_para_salvar", "Nada para salvar: mande briefing, imagens ou objetivo.");
  const { data, error } = await servico
    .from("mesa_campanhas")
    .update(campos)
    .eq("id", c.id)
    .eq("client_id", c.client_id)
    .select("*")
    .single();
  if (error && faltaColunaNova(error)) {
    throw new ErroHttp(503, "campanha_sem_colunas_novas", "O banco ainda não tem os campos de imagens e briefing da campanha. Falta aplicar o SQL de 25/09 (docs/mesa/migrations).");
  }
  if (error || !data) throw new ErroHttp(503, "campanha_nao_salva", "Não foi possível salvar a campanha. Tente de novo.");
  return json({ campanha: data, recusadas, custo_usd: 0 });
}

/**
 * campanha_plano_imagens { campanha_id, modelo_id?, raciocinio? }: o
 * estrategista olha as imagens da campanha (ou, sem nenhuma escolhida, até 10
 * fotos reais recentes do acervo) junto com o briefing e os conteúdos, e diz
 * qual imagem vai em qual lâmina e por quê; onde há mais de uma candidata, o
 * Jev escolhe. Grava em mesa_campanhas.plano_imagens. O gravar leva a foto
 * escolhida de cada lâmina ao Estúdio. Resposta: { campanha, plano_imagens,
 * custo_usd, saldo_usd, reserva_usada }.
 */
async function campanhaPlanoImagens(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const c = await carregarCampanha(servico, corpo.campanha_id);
  await exigirAcessoAoCliente(chamador, c.client_id);
  if (c.plano_imagens === undefined) {
    throw new ErroHttp(503, "campanha_sem_colunas_novas", "O banco ainda não tem os campos de imagens e briefing da campanha. Falta aplicar o SQL de 25/09 (docs/mesa/migrations).");
  }
  const proposta = c.proposta_id ? await carregarProposta(servico, c.proposta_id).catch(() => null) : null;
  const itens = proposta?.itens ?? [];
  if (!itens.length) throw new ErroHttp(409, "campanha_sem_conteudos", "A campanha ainda não tem conteúdos. Peça os conteúdos ao agente antes do plano de imagens.");

  const escolhidas = await fotosDaCampanha(servico, c);
  const fonte: "campanha" | "acervo" = escolhidas.length ? "campanha" : "acervo";
  const candidatas: { foto: FotoDaCampanha; imagem: ImagemDaCampanha | null }[] = escolhidas.length
    ? escolhidas
    : (await fotosDoAcervoParaOPlano(servico, c.client_id)).map((foto) => ({ foto, imagem: null }));
  if (!candidatas.length) {
    throw new ErroHttp(409, "campanha_sem_imagens", "Nenhuma imagem para analisar. Escolha imagens para a campanha ou sincronize o acervo do cliente na aba Contexto.");
  }
  const lidas = await Promise.all(candidatas.map((x, i) => fotoParaLeitura(servico, x.foto, `F${i + 1}`)));
  const vistas: { foto: FotoDaCampanha; imagem: ImagemDaCampanha | null }[] = [];
  const imagens: ImagemEntrada[] = [];
  const codigos = new Map<string, string>();
  lidas.forEach((img, i) => {
    if (!img) return;
    vistas.push(candidatas[i]);
    codigos.set(`F${vistas.length}`, candidatas[i].foto.id);
    imagens.push({ ...img, nome: `F${vistas.length}.${img.mime.split("/")[1]}` });
  });
  if (!imagens.length) throw new ErroHttp(409, "imagens_ilegiveis", "Não foi possível abrir as imagens da campanha. Confira se elas ainda existem no acervo.");

  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");
  const briefing = normalizarBriefing(c.briefing);
  const conteudos = itens.map((it, i) => ({
    item: i + 1,
    tema: it.tema,
    data: it.data,
    formato: it.formato,
    carrossel_infinito: it.carrossel_infinito,
    gancho: it.gancho,
    objetivo: ROTULO_OBJETIVO[it.objetivo] ?? it.objetivo,
    cards: it.cards.map((card) => ({ ordem: card.ordem, funcao: card.funcao, texto: card.texto, ilustracao: card.ilustracao })),
  }));
  const pedido = `CAMPANHA (JSON):
${JSON.stringify({ nome: c.nome, objetivo: c.objetivo, conceito: c.conceito, periodo: { inicio: c.periodo_inicio, fim: c.periodo_fim }, briefing, identidade: c.identidade })}

FOTOS (vêm anexadas nesta ordem; cite pelo código):
${JSON.stringify(catalogoDasFotos(vistas))}
${fonte === "acervo" ? "\nA equipe ainda não escolheu imagens para esta campanha: estas são fotos reais recentes do acervo do cliente. Use só as que servem de verdade e diga nas lacunas o que falta.\n" : ""}
CONTEÚDOS DA CAMPANHA (JSON; item é a posição):
${JSON.stringify(conteudos)}

TAREFA: monte o plano de imagens da campanha. Olhe cada foto de verdade (o que aparece, a luz, onde há área calma para texto, se o produto aparece inteiro e nítido) e decida qual foto vai em qual lâmina e por quê, sempre ligado ao produto em foco, à oferta e à mensagem central. resumo: em 2 a 4 frases, a lógica do plano (qual foto carrega a campanha e por quê).
${REGRAS_DO_PLANO_DE_IMAGENS}`;

  const s = await chamarTexto({
    clientId: c.client_id,
    tarefa: "calendario",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `Você é o estrategista da agência e diretor de fotografia da campanha. Escolhe fotos reais do cliente para cada peça com critério de venda, sem inventar o que a foto não mostra. Português do Brasil, sem travessões. Responda só com o JSON pedido.`,
    mensagens: [{ papel: "usuario", conteudo: pedido, imagens }],
    raciocinio,
    esquemaJson: { nome: "plano_de_imagens", schema: ESQUEMA_PLANO_IMAGENS },
    referencia: { tipo: REF_CAMPANHA, id: c.id },
    criadoPor: chamador.userId,
  });
  const base = normalizarPlanoDeImagens(s.json, codigos, itens, {
    assinatura: assinaturaDoPlano(normalizarImagensDaCampanha(c.imagens), itens),
    fonte,
  });
  const decidido = await decidirFotosComJev(base, {
    campanha: { nome: c.nome, objetivo: c.objetivo, briefing },
    fotos: descricoesDasFotos(base, vistas),
    itens,
  }, { clientId: c.client_id, campanhaId: c.id, criadoPor: chamador.userId });

  const { data, error } = await servico
    .from("mesa_campanhas")
    .update({ plano_imagens: decidido.plano })
    .eq("id", c.id)
    .eq("client_id", c.client_id)
    .select("*")
    .single();
  if (error || !data) throw new ErroHttp(503, "plano_nao_salvo", "O plano de imagens foi feito, mas não foi salvo. Tente de novo.", { uso_id: s.usoId });
  const custo = Math.round((s.custoUsd + decidido.custo) * 1e6) / 1e6;
  await somarCustoDaCampanha(servico, c.id, c.client_id, custo);
  (data as Campanha).custo_usd = Math.round((Number((data as Campanha).custo_usd) + custo) * 1e6) / 1e6;
  return json({ campanha: data, plano_imagens: decidido.plano, custo_usd: custo, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null });
}

// ------------------------------------------ planejar o mês conversando

const ESQUEMA_PLANO_DO_MES = obj({
  resumo: S("string"),
  frequencia_semanal: S(["integer", "null"]),
  pilares: { type: "array", items: S("string") },
  formatos: S("string"),
  datas: { type: "array", items: S("string") },
  campanhas: { type: "array", items: S("string") },
});

export const ESQUEMA_PLANEJAMENTO = {
  nome: "planejamento_do_mes",
  schema: obj({
    resposta: S("string"),
    plano_do_mes: { ...ESQUEMA_PLANO_DO_MES, type: ["object", "null"] },
    proximos_meses: { type: ["array", "null"], items: obj({ mes: S("string"), plano: ESQUEMA_PLANO_DO_MES }) },
    mudancas: {
      ...obj({
        resumo: S("string"),
        temas: { type: "array", items: ESQUEMA_TEMA },
        temas_removidos: { type: "array", items: S("string") },
        itens: { type: "array", items: ESQUEMA_ITEM },
        itens_removidos: { type: "array", items: S("string") },
      }),
      type: ["object", "null"],
    },
  }),
};

/** Mudança que o agente sugere na proposta: só o que entra, muda ou sai. */
type PatchDaProposta = { temas: Tema[]; temas_removidos: string[]; itens: Item[]; itens_removidos: string[] };

/** "AAAA-MM" a partir de "AAAA-MM" ou "AAAA-MM-DD"; null quando não é um mês. */
export function mesDoPedido(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return null;
  const n = Number(s.slice(5, 7));
  return n >= 1 && n <= 12 ? s.slice(0, 7) : null;
}

/** Último dia do mês "AAAA-MM", em AAAA-MM-DD. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
}

/** Mês "AAAA-MM" mais n meses. */
export function somarMesesAoMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1, 12)).toISOString().slice(0, 7);
}

const listaDeTextos = (v: unknown, max: number, tam = 200) =>
  (Array.isArray(v) ? v : []).map((x) => texto(x, tam)).filter(Boolean).slice(0, max);

/** Texto do plano combinado de um mês, como vai para a memória do estrategista. */
export function textoDoPlano(mes: string, bruto: unknown): string | null {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const resumo = texto(o.resumo, 1500);
  if (!resumo) return null;
  const linhas = [`${PREFIXO_PLANO}${mes}: ${resumo}`];
  const freq = Number(o.frequencia_semanal);
  if (Number.isFinite(freq) && freq > 0) linhas.push(`Frequência: ${Math.min(14, Math.round(freq))} publicações por semana.`);
  const pilares = listaDeTextos(o.pilares, 8);
  if (pilares.length) linhas.push(`Pilares: ${pilares.join("; ")}.`);
  const formatos = texto(o.formatos, 400);
  if (formatos) linhas.push(`Formatos: ${formatos}`);
  const datas = listaDeTextos(o.datas, 12);
  if (datas.length) linhas.push(`Datas: ${datas.join("; ")}.`);
  const campanhas = listaDeTextos(o.campanhas, 8);
  if (campanhas.length) linhas.push(`Campanhas: ${campanhas.join("; ")}.`);
  return linhas.join("\n").slice(0, 3500);
}

/** Troca o plano ativo do mês pelo novo (o anterior fica inativo, como histórico). */
async function salvarPlano(servico: SupabaseClient, clientId: string, mes: string, textoPlano: string, conversaId: string): Promise<string | null> {
  await servico
    .from("agente_memoria")
    .update({ ativa: false })
    .eq("client_id", clientId)
    .eq("agente", AGENTE)
    .eq("ativa", true)
    .like("texto", `${PREFIXO_PLANO}${mes}:%`);
  const { data, error } = await servico
    .from("agente_memoria")
    .insert({ client_id: clientId, agente: AGENTE, tipo: "preferencia", origem: "ajuste", referencia_id: conversaId, texto: textoPlano })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agente-calendario] plano nao gravado", { client_id: clientId, mes, code: error?.code });
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * Contexto extra do planejamento, só com dado real: o que saiu publicado e o
 * que foi aprovado nos últimos 90 dias, campanhas ativas, os hypes da semana e
 * a agenda do mês e dos 3 seguintes (quantos, formatos e títulos).
 */
async function contextoDoPlanejamento(servico: SupabaseClient, clientId: string, mes: string) {
  const inicio = `${mes}-01`;
  const ate = fimDoMes(somarMesesAoMes(mes, 3));
  const ha90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: projetos } = await servico.from("projects").select("id").eq("client_id", clientId).is("deleted_at", null).limit(200);
  const projectIds = ((projetos ?? []) as Array<{ id: string }>).map((p) => p.id);
  const vazio = Promise.resolve({ data: [] as unknown[] });
  const [publicados, aprovados, campanhas, hypes, agenda] = await Promise.all([
    servico.from("editorial_publications").select("scheduled_at, editorial_posts(title, content_type)")
      .eq("client_id", clientId).eq("status", "published").gte("scheduled_at", ha90)
      .order("scheduled_at", { ascending: false }).limit(40),
    servico.from("estudio_trabalhos").select("task_id, entrega_status, atualizado_em")
      .eq("client_id", clientId).in("entrega_status", ["aprovado", "agendado"]).gte("atualizado_em", ha90)
      .order("atualizado_em", { ascending: false }).limit(40),
    servico.from("mesa_campanhas").select("nome, objetivo, conceito, periodo_inicio, periodo_fim, status")
      .eq("client_id", clientId).neq("status", "encerrada").order("criado_em", { ascending: false }).limit(12),
    servico.from("mesa_hypes").select("semana, resumo, itens").eq("client_id", clientId).order("semana", { ascending: false }).limit(1),
    projectIds.length
      ? servico.from("tasks").select("title, due_date, delivery_type")
        .in("project_id", projectIds).is("deleted_at", null).gte("due_date", inicio).lte("due_date", ate).order("due_date").limit(400)
      : vazio,
  ]);

  const idsAprovados = ((aprovados.data ?? []) as Array<{ task_id: string | null }>).map((a) => a.task_id).filter((x): x is string => !!x && UUID.test(x));
  const { data: tarefasAprovadas } = idsAprovados.length
    ? await servico.from("tasks").select("id, title, due_date").in("id", idsAprovados)
    : { data: [] as unknown[] };
  const tituloDaTarefa = new Map(((tarefasAprovadas ?? []) as Array<{ id: string; title: string; due_date: string | null }>).map((t) => [t.id, t]));

  const porMes: Record<string, { total: number; formatos: Record<string, number>; titulos: string[] }> = {};
  for (const t of (agenda.data ?? []) as Array<{ title: string; due_date: string | null; delivery_type: string | null }>) {
    const m = String(t.due_date ?? "").slice(0, 7);
    if (!m) continue;
    const linha = porMes[m] ?? (porMes[m] = { total: 0, formatos: {}, titulos: [] });
    linha.total++;
    const f = t.delivery_type || "sem formato";
    linha.formatos[f] = (linha.formatos[f] ?? 0) + 1;
    if (linha.titulos.length < 20) linha.titulos.push(`${t.due_date}: ${String(t.title ?? "").slice(0, 120)}`);
  }

  const hype = ((hypes.data ?? []) as Array<{ semana: string; resumo: string | null; itens: unknown }>)[0] ?? null;
  return {
    publicados_nos_ultimos_90_dias: ((publicados.data ?? []) as Array<{ scheduled_at: string; editorial_posts: { title?: string; content_type?: string } | null }>)
      .map((p) => ({ data: String(p.scheduled_at ?? "").slice(0, 10), titulo: corta(p.editorial_posts?.title ?? "", 160), formato: p.editorial_posts?.content_type ?? null })),
    aprovados_pelo_cliente_nos_ultimos_90_dias: ((aprovados.data ?? []) as Array<{ task_id: string; entrega_status: string }>)
      .map((a) => {
        const t = tituloDaTarefa.get(a.task_id);
        return { titulo: corta(t?.title ?? "", 160), data: t?.due_date ?? null, situacao: a.entrega_status };
      })
      .filter((a) => a.titulo),
    campanhas_ativas: ((campanhas.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
      nome: c.nome, objetivo: corta(c.objetivo, 300), conceito: corta(c.conceito, 400), periodo: { inicio: c.periodo_inicio, fim: c.periodo_fim }, status: c.status,
    })),
    hypes_da_semana: hype
      ? {
        semana: hype.semana,
        resumo: hype.resumo,
        itens: (Array.isArray(hype.itens) ? hype.itens : []).slice(0, 8).map((h) => {
          const o = (h ?? {}) as Record<string, unknown>;
          return { titulo: o.titulo, janela: o.janela, como_usar: corta(o.como_usar, 300), nota: o.nota ?? null };
        }),
      }
      : null,
    agenda_do_mes_e_dos_3_seguintes: Object.keys(porMes).sort().map((m) => ({ mes: m, ...porMes[m] })),
  };
}

/** A proposta pedida ou a aberta mais recente do estrategista que começa neste mês. */
async function propostaDoPlanejamento(servico: SupabaseClient, clientId: string, pedida: unknown, inicio: string, fim: string): Promise<Proposta | null> {
  if (pedida != null && pedida !== "") {
    const p = await carregarProposta(servico, pedida);
    if (p.client_id !== clientId) throw new ErroHttp(403, "proposta_de_outro_cliente", "A proposta não é deste cliente.");
    return p;
  }
  const { data } = await servico
    .from("calendario_propostas")
    .select("id")
    .eq("client_id", clientId)
    .is("parametros->>origem", null)
    .in("status", ["temas", "detalhando", "pronta"])
    .gte("periodo_inicio", inicio)
    .lte("periodo_inicio", fim)
    .order("criado_em", { ascending: false })
    .limit(1);
  const id = ((data as Array<{ id: string }> | null) ?? [])[0]?.id;
  return id ? await carregarProposta(servico, id) : null;
}

/** Item alterado: o que veio vazio fica como estava (datas, cards e textos não se perdem). */
export function mesclarItem(antigo: Item, novo: Item): Item {
  const out: Item = { ...antigo };
  for (const k of Object.keys(novo) as Array<keyof Item>) {
    const v = novo[k];
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  if (out.formato === "estatico") {
    out.cards = out.cards.slice(0, 1);
    out.carrossel_infinito = false;
  }
  out.task_id = antigo.task_id ?? null;
  if (antigo.campanha_id) out.campanha_id = antigo.campanha_id;
  return out;
}

/** Status da proposta depois de uma mudança nos temas ou nos itens. */
export function statusDaProposta(p: Pick<Proposta, "status">, temas: Tema[], itens: Item[]): string {
  // Pedido livre, campanha e completar não têm temas: com itens, pronta.
  if (temas.length === 0) return itens.length ? "pronta" : p.status;
  if (itens.length === 0) return "temas";
  const faltam = temas.filter((t) => t.escolhido && !itens.some((i) => i.tema_id === t.id));
  return faltam.length ? "detalhando" : "pronta";
}

/** Normaliza a mudança sugerida pelo modelo sobre a proposta atual; null quando não muda nada. */
function normalizarPatch(p: Proposta, bruto: unknown): { patch: PatchDaProposta; ajustes: string[] } | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const uteis = diasUteisDaProposta(p);
  const ajustes: string[] = [];

  const porTema = new Map(p.temas.map((t) => [t.id, t]));
  const numero = (id: string) => Number(String(id).replace(/\D/g, "")) || 0;
  let seqTema = Math.max(p.temas.length, ...p.temas.map((t) => numero(t.id)));
  const usadosT = new Set<string>();
  const temas: Tema[] = [];
  for (const b of (Array.isArray(o.temas) ? o.temas : []).slice(0, 30)) {
    let id = texto((b as Record<string, unknown>)?.id, 40);
    if (!id || usadosT.has(id)) {
      do id = `t${++seqTema}`; while (porTema.has(id) || usadosT.has(id));
    }
    usadosT.add(id);
    const t = normalizarTema(b, id, porTema.get(id));
    if (!t.tema) continue;
    temas.push(porTema.has(id) ? t : { ...t, escolhido: true });
  }

  const porItem = new Map(p.itens.map((i) => [i.tema_id, i]));
  let seqItem = p.itens.length;
  const usadosI = new Set<string>();
  const itens: Item[] = [];
  for (const b of (Array.isArray(o.itens) ? o.itens : []).slice(0, 60)) {
    const dataCrua = String((b as Record<string, unknown>)?.data ?? "");
    const novo = normalizarItem(b, uteis);
    if (!novo.tema_id || usadosI.has(novo.tema_id)) {
      do novo.tema_id = `n${++seqItem}`; while (porItem.has(novo.tema_id) || usadosI.has(novo.tema_id));
    }
    usadosI.add(novo.tema_id);
    const antigo = porItem.get(novo.tema_id);
    if (antigo && antigo.task_id) {
      ajustes.push(`"${antigo.tema}" já está na agenda e não muda por aqui.`);
      continue;
    }
    // Sem data válida no alterado, a data fica a de antes.
    if (antigo && !DATA.test(dataCrua)) novo.data = antigo.data;
    const item = antigo ? mesclarItem(antigo, novo) : novo;
    if (typeof p.parametros.campanha_id === "string") item.campanha_id = p.parametros.campanha_id;
    if (DATA.test(dataCrua) && dataCrua !== item.data) ajustes.push(`"${item.tema}" foi de ${dataCrua} para ${item.data} (só segunda a sexta dentro do período).`);
    if (item.tema) itens.push(item);
  }

  const temasRemovidos = listaDeTextos(o.temas_removidos, 30, 40).filter((id) => porTema.has(id));
  const itensRemovidos = listaDeTextos(o.itens_removidos, 60, 40).filter((id) => {
    const i = porItem.get(id);
    if (i && i.task_id) ajustes.push(`"${i.tema}" já está na agenda e não sai por aqui: apague pela Agenda do mês.`);
    return !!i && !i.task_id;
  });
  if (!temas.length && !itens.length && !temasRemovidos.length && !itensRemovidos.length) return null;
  return { patch: { temas, temas_removidos: temasRemovidos, itens, itens_removidos: itensRemovidos }, ajustes };
}

/** A proposta com a mudança aplicada (temas, itens e status), sem gravar. */
export function aplicarPatch(p: Pick<Proposta, "temas" | "itens" | "status">, patch: PatchDaProposta): { temas: Tema[]; itens: Item[]; status: string } {
  const foraT = new Set(patch.temas_removidos);
  const novosT = new Map(patch.temas.map((t) => [t.id, t]));
  let temas = p.temas.filter((t) => !foraT.has(t.id)).map((t) => novosT.get(t.id) ?? t);
  for (const t of patch.temas) if (!p.temas.some((x) => x.id === t.id)) temas.push(t);

  const foraI = new Set(patch.itens_removidos);
  const novosI = new Map(patch.itens.map((i) => [i.tema_id, i]));
  // Conteúdo de tema que saiu também sai (o que já está na agenda fica).
  const itens = p.itens
    .filter((i) => i.task_id || (!foraI.has(i.tema_id) && !foraT.has(i.tema_id)))
    .map((i) => (i.task_id ? i : novosI.get(i.tema_id) ?? i));
  for (const i of patch.itens) if (!p.itens.some((x) => x.tema_id === i.tema_id)) itens.push(i);
  itens.sort((a, b) => a.data.localeCompare(b.data));

  // Tema com conteúdo fica escolhido; tema que perdeu o conteúdo deixa de ser escolhido.
  const comItem = new Set(itens.map((i) => i.tema_id));
  temas = temas.map((t) => {
    if (comItem.has(t.id)) return t.escolhido ? t : { ...t, escolhido: true };
    if (foraI.has(t.id) && t.escolhido) return { ...t, escolhido: false };
    return t;
  });
  return { temas, itens, status: statusDaProposta(p, temas, itens) };
}

const CAMPOS_DA_DIFERENCA: Array<[keyof Item, string]> = [
  ["data", "data"], ["formato", "formato"], ["tema", "tema"], ["gancho", "gancho"], ["copy", "legenda"],
  ["cta", "CTA"], ["cards", "roteiro dos cards"], ["pilar", "pilar"], ["fase", "fase"], ["objetivo", "objetivo"],
];

/** O que muda na proposta, para a equipe ver antes de aplicar. */
export function diferencaDaProposta(antes: { temas: Tema[]; itens: Item[] }, depois: { temas: Tema[]; itens: Item[] }) {
  const resumo = (i: Item) => ({ tema_id: i.tema_id, tema: i.tema, data: i.data, formato: i.formato });
  const porId = new Map(antes.itens.map((i) => [i.tema_id, i]));
  const idsDepois = new Set(depois.itens.map((i) => i.tema_id));
  const mudam: Array<ReturnType<typeof resumo> & { data_antes: string | null; campos: string[] }> = [];
  for (const d of depois.itens) {
    const a = porId.get(d.tema_id);
    if (!a) continue;
    const campos = CAMPOS_DA_DIFERENCA.filter(([k]) => JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null)).map(([, r]) => r);
    if (campos.length) mudam.push({ ...resumo(d), data_antes: a.data !== d.data ? a.data : null, campos });
  }
  return {
    entram: depois.itens.filter((i) => !porId.has(i.tema_id)).map(resumo),
    saem: antes.itens.filter((i) => !idsDepois.has(i.tema_id)).map(resumo),
    mudam,
    temas_entram: depois.temas.filter((t) => !antes.temas.some((a) => a.id === t.id)).map((t) => t.tema),
    temas_saem: antes.temas.filter((t) => !depois.temas.some((d) => d.id === t.id)).map((t) => t.tema),
    temas_mudam: depois.temas.filter((t) => {
      const a = antes.temas.find((x) => x.id === t.id);
      return !!a && a.tema !== t.tema;
    }).map((t) => t.tema),
  };
}

/**
 * planejar_mes { client_id, mensagem, mes (AAAA-MM ou AAAA-MM-01), proposta_id?,
 * anexos?, modelo_id?, raciocinio? }: o agente do mês conversando sobre o
 * planejamento (estratégia, datas, campanhas, frequência, formatos, pilares)
 * deste mês e dos próximos, com o prompt geral do cliente e mais contexto
 * (publicado, aprovado, métricas, campanhas, hypes e a agenda dos próximos
 * meses). O que a conversa decide vira o plano combinado do mês (memória do
 * estrategista, que o gerador de meses segue). Mudança na proposta aberta do
 * mês NÃO é gravada aqui: volta como sugestão na mensagem do agente
 * (anexo tipo mudanca, com a diferença) e só entra com aplicar_mudanca.
 */
async function planejarMes(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroHttp(400, "mensagem_vazia", "Escreva o que você quer conversar sobre o mês.");
  const mes = mesDoPedido(corpo.mes);
  if (!mes) throw new ErroHttp(400, "mes_invalido", "Informe o mês do planejamento (AAAA-MM).");
  const inicio = `${mes}-01`;
  const fim = fimDoMes(mes);

  const proposta = await propostaDoPlanejamento(servico, clientId, corpo.proposta_id, inicio, fim);
  const editavel = !!proposta && proposta.status !== "gravada" && proposta.status !== "descartada";

  const [ctx, extra, imagens, conversaId] = await Promise.all([
    montarContexto(servico, clientId, inicio, fim),
    contextoDoPlanejamento(servico, clientId, mes),
    baixarAnexos(servico, clientId, corpo.anexos),
    conversaDoAgenteDoMes(servico, clientId, chamador.userId),
  ]);
  const { modelo, raciocinio } = await resolverModelo(corpo.modelo_id, corpo.raciocinio ?? "medium");

  const { data: historico } = await servico
    .from("agente_mensagens")
    .select("papel, conteudo")
    .eq("conversa_id", conversaId)
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(16);
  const anteriores = ((historico ?? []) as Array<{ papel: string; conteudo: string }>)
    .reverse()
    .filter((m) => m.papel === "usuario" || m.papel === "agente")
    .map((m) => ({ papel: m.papel as "usuario" | "agente", conteudo: m.conteudo.slice(0, 3000) }));

  const blocoDaProposta = proposta
    ? `\nPROPOSTA DO ESTRATEGISTA PARA ESTE MÊS (JSON; ${editavel ? "pode sugerir mudanças" : "já gravada na agenda: não muda por aqui"}):\n${JSON.stringify({
      periodo: { inicio: proposta.periodo_inicio, fim: proposta.periodo_fim },
      status: proposta.status,
      diagnostico: corta(proposta.diagnostico, 3000),
      temas: proposta.temas.map((t) => ({ id: t.id, tema: t.tema, pilar: t.pilar, fase: t.fase, objetivo: t.objetivo, escolhido: t.escolhido, formato_sugerido: t.formato_sugerido, data_sazonal: t.data_sazonal })),
      itens: proposta.itens.map((i) => ({ ...i, gravado: !!i.task_id, task_id: undefined })),
    })}\n`
    : "\nAinda não existe proposta aberta do estrategista para este mês.\n";

  const pedido = `${contextoEmTexto(ctx, { inicio, fim, parametros: proposta?.parametros ?? {} })}

CONTEXTO DO PLANEJAMENTO (JSON, lido do painel agora; vazio significa que o dado não existe):
${JSON.stringify(extra)}${blocoDoPlano(ctx, inicio)}
${blocoDaProposta}
MÊS EM CONVERSA: ${mes} (de ${inicio} a ${fim}). Hoje é ${hojeSaoPaulo()}.
MENSAGEM DA EQUIPE: ${mensagem}
${imagens.imagens.length ? `\nA equipe anexou ${imagens.imagens.length} imagem(ns) (prints de métricas, referências ou fotos). Use o conteúdo delas com fidelidade.\n` : ""}
TAREFA: você é o estrategista planejando o mês junto com a equipe, numa conversa de verdade (não um formulário). Siga o prompt geral do cliente e use os dados reais acima: o que já foi publicado e aprovado, as métricas do Instagram, as campanhas, os hypes, a agenda e o plano combinado.
- Converse sobre estratégia, datas, campanhas, frequência, formatos e pilares deste mês e, quando fizer sentido, dos próximos meses. Traga números reais quando existirem e diga quando um dado não existe.
- Se faltar algo importante para decidir, faça no máximo 2 perguntas objetivas no fim da resposta.
- Nunca invente dado, resultado, data ou evento.
Devolva:
- resposta: sua fala na conversa, em português claro, de 2 a 10 frases (pode usar lista curta).
- plano_do_mes: o plano COMPLETO combinado para ${mes} (resumo de 2 a 6 frases com o que foi decidido, frequencia_semanal, pilares, formatos, datas e campanhas), só quando esta conversa decidiu ou mudou algo do mês; senão null. Mantenha o que já estava combinado e continua valendo.
- proximos_meses: para cada mês seguinte sobre o qual a conversa decidiu algo, { mes: "AAAA-MM", plano } com o plano completo daquele mês; senão null.
- mudancas: ${editavel
    ? `só quando a equipe pedir para mudar a proposta do mês (trocar, tirar ou acrescentar temas ou conteúdos, mudar datas). resumo: o que muda, em 1 a 3 frases. temas: só os temas novos ou alterados (mantenha o id do alterado; tema novo recebe id novo). temas_removidos: ids dos temas que saem. itens: só os conteúdos novos ou alterados, completos (mantenha o tema_id do alterado). itens_removidos: tema_id dos conteúdos que saem. Conteúdo com "gravado": true já está na agenda e não muda aqui. A equipe vê a mudança antes de aplicar. Sem pedido de mudança, null.`
    : "sempre null (não há proposta aberta para este mês; para gerar o mês, a equipe usa o gerador de meses, que segue o plano combinado)."}
Datas só de segunda a sexta entre ${inicio} e ${fim}. Formato só carrossel ou estatico.
${editavel ? REGRAS_DOS_ITENS : ""}`;

  const s = await chamarTexto({
    clientId,
    tarefa: "conversa",
    agente: AGENTE,
    modeloId: modelo.id,
    timeoutMs: TIMEOUT_CALENDARIO_MS,
    sistema: `${ctx.prompt}\n${REGRAS_DE_SAIDA}`,
    mensagens: [...anteriores, { papel: "usuario", conteudo: pedido, imagens: imagens.imagens.length ? imagens.imagens : undefined }],
    raciocinio,
    esquemaJson: ESQUEMA_PLANEJAMENTO,
    referencia: { tipo: REF_AGENTE_DO_MES, id: conversaId },
    criadoPor: chamador.userId,
  });
  const r = (s.json ?? {}) as Record<string, unknown>;

  // Plano combinado do mês e dos próximos meses: vai para a memória do estrategista.
  const planos: Array<{ mes: string; texto: string; id: string | null }> = [];
  const doMes = r.plano_do_mes ? textoDoPlano(mes, r.plano_do_mes) : null;
  if (doMes) planos.push({ mes, texto: doMes, id: await salvarPlano(servico, clientId, mes, doMes, conversaId) });
  for (const x of (Array.isArray(r.proximos_meses) ? r.proximos_meses : []).slice(0, 6)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const m = mesDoPedido(o.mes);
    if (!m || m <= mes || planos.some((p) => p.mes === m)) continue;
    const t = textoDoPlano(m, o.plano);
    if (t) planos.push({ mes: m, texto: t, id: await salvarPlano(servico, clientId, m, t, conversaId) });
  }

  // Mudança na proposta: só sugestão, com a diferença calculada aqui.
  let mudanca: Record<string, unknown> | null = null;
  if (editavel && proposta) {
    const n = normalizarPatch(proposta, r.mudancas);
    if (n) {
      const depois = aplicarPatch(proposta, n.patch);
      mudanca = {
        tipo: "mudanca",
        alvo_proposta_id: proposta.id,
        base: proposta.atualizado_em ?? null,
        periodo: { inicio: proposta.periodo_inicio, fim: proposta.periodo_fim },
        resumo: texto((r.mudancas as Record<string, unknown>)?.resumo, 1000),
        patch: n.patch,
        diferenca: diferencaDaProposta(proposta, depois),
        ajustes: n.ajustes,
      };
    }
  }

  const resposta = texto(r.resposta, 6000) || "Anotado.";
  const anexosDaResposta: Record<string, unknown>[] = planos.map((p) => ({ tipo: "plano", mes: p.mes }));
  if (mudanca) anexosDaResposta.push(mudanca);
  await registrarMensagens(servico, conversaId, clientId, [
    { papel: "usuario", conteudo: mensagem, anexos: imagens.caminhos.map((c) => ({ caminho: c })) },
  ]);
  const { data: msgAgente, error: erroMsg } = await servico
    .from("agente_mensagens")
    .insert({
      conversa_id: conversaId,
      client_id: clientId,
      criado_em: new Date(Date.now() + 5).toISOString(),
      papel: "agente",
      conteudo: resposta,
      anexos: anexosDaResposta,
      uso_id: s.usoId,
    })
    .select("id")
    .single();
  if (erroMsg || !msgAgente) {
    throw new ErroHttp(503, "resposta_nao_guardada", "O agente respondeu, mas a resposta não foi guardada. Tente de novo.", { uso_id: s.usoId, custo_usd: s.custoUsd });
  }

  return json({
    resposta,
    planos,
    mudanca,
    mensagem_id: (msgAgente as { id: string }).id,
    conversa_id: conversaId,
    proposta_id: proposta?.id ?? null,
    custo_usd: s.custoUsd,
    saldo_usd: s.saldoUsd,
    reserva_usada: s.reservaUsada ?? null,
  });
}

/**
 * aplicar_mudanca { mensagem_id, descartar? }: aplica na proposta a mudança
 * que o agente sugeriu naquela mensagem (ou descarta). Só vale sobre a versão
 * da proposta que o agente leu; se ela mudou depois, pede para conversar de novo.
 */
async function aplicarMudanca(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const id = String(corpo.mensagem_id ?? "");
  if (!UUID.test(id)) throw new ErroHttp(400, "mensagem_invalida", "mensagem_id precisa ser um UUID.");
  const { data: msg, error } = await servico.from("agente_mensagens").select("id, client_id, conversa_id, anexos").eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(500, "mensagem_indisponivel", "Não foi possível ler a mensagem do agente.");
  if (!msg) throw new ErroHttp(404, "mensagem_inexistente", "Mensagem não encontrada.");
  const m = msg as { id: string; client_id: string; conversa_id: string; anexos: unknown };
  await exigirAcessoAoCliente(chamador, m.client_id);
  const anexos = Array.isArray(m.anexos) ? (m.anexos as Record<string, unknown>[]) : [];
  const i = anexos.findIndex((a) => a && a.tipo === "mudanca");
  if (i < 0) throw new ErroHttp(404, "mudanca_inexistente", "Esta mensagem não tem mudança sugerida.");
  const sugestao = anexos[i];
  if (sugestao.aplicada_em) throw new ErroHttp(409, "mudanca_ja_aplicada", "Esta mudança já foi aplicada.");
  if (sugestao.descartada_em) throw new ErroHttp(409, "mudanca_descartada", "Esta mudança foi descartada. Peça de novo ao agente.");

  const marcar = async (campo: "aplicada_em" | "descartada_em") => {
    const novos = anexos.slice();
    novos[i] = { ...sugestao, [campo]: new Date().toISOString() };
    await servico.from("agente_mensagens").update({ anexos: novos }).eq("id", m.id).eq("client_id", m.client_id);
    return novos[i];
  };

  if (corpo.descartar === true) return json({ anexo: await marcar("descartada_em") });

  const p = await carregarProposta(servico, sugestao.alvo_proposta_id);
  if (p.client_id !== m.client_id) throw new ErroHttp(403, "proposta_de_outro_cliente", "A proposta não é deste cliente.");
  exigirEditavel(p);
  if (p.task_ids.length > 0) {
    throw new ErroHttp(409, "proposta_ja_na_agenda", "Parte desta proposta já entrou na agenda. Grave o resto primeiro e ajuste pela Agenda do mês.");
  }
  if (sugestao.base && p.atualizado_em && String(sugestao.base) !== String(p.atualizado_em)) {
    throw new ErroHttp(409, "proposta_mudou", "A proposta mudou depois desta sugestão. Peça de novo ao agente para ele ler a versão atual.");
  }
  const patch = (sugestao.patch ?? {}) as Partial<PatchDaProposta>;
  const depois = aplicarPatch(p, {
    temas: Array.isArray(patch.temas) ? patch.temas : [],
    temas_removidos: Array.isArray(patch.temas_removidos) ? patch.temas_removidos.map(String) : [],
    itens: Array.isArray(patch.itens) ? patch.itens : [],
    itens_removidos: Array.isArray(patch.itens_removidos) ? patch.itens_removidos.map(String) : [],
  });
  const atualizada = await salvarProposta(servico, p, depois);
  const anexo = await marcar("aplicada_em");
  await registrarMensagens(servico, m.conversa_id, m.client_id, [
    { papel: "sistema", conteudo: `Mudanças aplicadas na proposta de ${p.periodo_inicio} a ${p.periodo_fim}.` },
  ]);
  return json({ proposta: atualizada, anexo });
}

// ------------------------------------------- apagar conteúdo que não serviu

/** Memória do estrategista: o que a equipe apagou, para não voltar a propor. */
async function lembrarDoApagado(servico: SupabaseClient, clientId: string, referenciaId: string, textoMemoria: string): Promise<string | null> {
  const { data, error } = await servico
    .from("agente_memoria")
    .insert({ client_id: clientId, agente: AGENTE, tipo: "evitar", origem: "ajuste", referencia_id: referenciaId, texto: textoMemoria.slice(0, 4000) })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** Desfazer: a memória do apagado deixa de valer. */
async function esquecerMemoria(servico: SupabaseClient, clientId: string, id: unknown) {
  const mid = String(id ?? "");
  if (!UUID.test(mid)) return;
  await servico.from("agente_memoria").update({ ativa: false }).eq("id", mid).eq("client_id", clientId).eq("agente", AGENTE);
}

/**
 * tirar_item { proposta_id, tema_id, indice? }: apaga um conteúdo da proposta
 * antes de gravar. O tema dele deixa de ser escolhido (detalhar não recria) e
 * a memória do estrategista guarda o que não serviu. Conteúdo que já entrou na
 * agenda sai pela Agenda do mês (arquivar_item_agenda).
 */
async function tirarItem(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  const temaId = texto(corpo.tema_id, 40);
  if (!temaId) throw new ErroHttp(400, "tema_id_ausente", "Informe o conteúdo (tema_id) que sai da proposta.");
  const pedido = Number(corpo.indice);
  let indice = Number.isInteger(pedido) && p.itens[pedido] && p.itens[pedido].tema_id === temaId ? pedido : -1;
  if (indice < 0) indice = p.itens.findIndex((i) => i.tema_id === temaId);
  if (indice < 0) throw new ErroHttp(404, "item_inexistente", "Este conteúdo não está mais na proposta. Atualize a tela.");
  const item = p.itens[indice];
  if (item.task_id || p.task_ids.length > 0) {
    throw new ErroHttp(409, "item_na_agenda", "Esta proposta já começou a entrar na agenda. Apague o conteúdo pela Agenda do mês.");
  }
  const itens = p.itens.filter((_, k) => k !== indice);
  const tema = p.temas.find((t) => t.id === item.tema_id);
  const temas = itens.some((i) => i.tema_id === item.tema_id) ? p.temas : p.temas.map((t) => (t.id === item.tema_id ? { ...t, escolhido: false } : t));
  const atualizada = await salvarProposta(servico, p, { itens, temas, status: statusDaProposta(p, temas, itens) });
  const memoriaId = await lembrarDoApagado(
    servico,
    p.client_id,
    p.id,
    `A equipe apagou o conteúdo proposto "${item.tema}"${item.gancho ? ` (gancho: ${item.gancho})` : ""}. Não proponha de novo o mesmo tema e gancho sem pedido.`,
  );
  return json({ proposta: atualizada, removido: { item, indice, tema_escolhido: tema ? tema.escolhido : null }, memoria_id: memoriaId });
}

/** repor_item { proposta_id, item, indice?, tema_escolhido?, memoria_id? }: desfaz o tirar_item. */
async function reporItem(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const p = await carregarProposta(servico, corpo.proposta_id);
  await exigirAcessoAoCliente(chamador, p.client_id);
  exigirEditavel(p);
  if (p.task_ids.length > 0) throw new ErroHttp(409, "item_na_agenda", "Esta proposta já começou a entrar na agenda.");
  const bruto = corpo.item;
  if (!bruto || typeof bruto !== "object") throw new ErroHttp(400, "item_ausente", "Informe o conteúdo que volta para a proposta.");
  const temaId = texto((bruto as Record<string, unknown>).tema_id, 40);
  if (!temaId) throw new ErroHttp(400, "tema_id_ausente", "O conteúdo precisa do tema_id.");
  await esquecerMemoria(servico, p.client_id, corpo.memoria_id);
  if (p.itens.some((i) => i.tema_id === temaId)) return json({ proposta: p, ja_estava: true });

  const item = normalizarItem(bruto, diasUteisDaProposta(p));
  item.tema_id = temaId;
  if (typeof p.parametros.campanha_id === "string") item.campanha_id = p.parametros.campanha_id;
  const itens = p.itens.slice();
  const indice = Number(corpo.indice);
  if (Number.isInteger(indice) && indice >= 0 && indice <= itens.length) itens.splice(indice, 0, item);
  else itens.push(item);
  const temas = corpo.tema_escolhido === false ? p.temas : p.temas.map((t) => (t.id === temaId ? { ...t, escolhido: true } : t));
  const atualizada = await salvarProposta(servico, p, { itens, temas, status: statusDaProposta(p, temas, itens) });
  return json({ proposta: atualizada });
}

type TarefaDaAgenda = { id: string; title: string; due_date: string | null; source: string | null; deleted_at: string | null; project_id: string };

async function tarefaDoCliente(servico: SupabaseClient, taskId: unknown, clientId: string): Promise<TarefaDaAgenda> {
  const id = String(taskId ?? "");
  if (!UUID.test(id)) throw new ErroHttp(400, "task_id_invalido", "task_id precisa ser um UUID.");
  const { data, error } = await servico.from("tasks").select("id, title, due_date, source, deleted_at, project_id").eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(500, "item_indisponivel", "Não foi possível ler o item da agenda.");
  if (!data) throw new ErroHttp(404, "item_inexistente", "Este item não está mais na agenda.");
  const t = data as TarefaDaAgenda;
  const { data: projeto } = await servico.from("projects").select("client_id").eq("id", t.project_id).maybeSingle();
  if (!projeto || (projeto as { client_id: string }).client_id !== clientId) {
    throw new ErroHttp(403, "item_de_outro_cliente", "Este item não é deste cliente.");
  }
  return t;
}

/** Entrega que trava o apagar: a aprovação do cliente não pode sumir. */
const ENTREGAS_QUE_TRAVAM = ["aprovado", "agendado"];

/**
 * arquivar_item_agenda { client_id, task_id, confirmar_arte? }: tira da agenda
 * um conteúdo que não serviu, arquivando a tarefa (deleted_at, dá para
 * desfazer com restaurar_item_agenda). Não sai: tarefa de pedido do cliente,
 * pauta com publicação agendada ou no ar, arte aprovada ou agendada. Com arte
 * já feita no Estúdio pede confirmar_arte; nenhum arquivo é apagado.
 */
async function arquivarItemDaAgenda(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const t = await tarefaDoCliente(servico, corpo.task_id, clientId);
  const titulo = String(t.title || "").trim() || "conteúdo sem título";
  if (t.deleted_at) return json({ task_id: t.id, titulo, ja_estava_apagado: true, arte: false, memoria_id: null });
  if (requestIdFromTaskSource(t.source)) {
    throw new ErroHttp(409, "item_de_pedido", "Este item veio de um pedido do cliente. Desvincule e reabra o pedido em vez de apagar.");
  }
  const { data: vinculo } = await servico.from("editorial_post_internal").select("post_id").eq("task_id", t.id).maybeSingle();
  const postId = (vinculo as { post_id?: string } | null)?.post_id ?? null;
  if (postId) {
    const { data: pubs } = await servico.from("editorial_publications").select("status").eq("post_id", postId).in("status", ["scheduled", "published"]).limit(1);
    const pub = ((pubs ?? []) as Array<{ status: string }>)[0];
    if (pub) {
      throw new ErroHttp(
        409,
        pub.status === "published" ? "item_publicado" : "item_agendado",
        pub.status === "published"
          ? "Este conteúdo já foi publicado. Ele fica na agenda como histórico."
          : "A publicação deste conteúdo está agendada. Cancele o agendamento na Agenda antes de apagar.",
      );
    }
  }
  const { data: trabalhos } = await servico
    .from("estudio_trabalhos")
    .select("status, entrega_status, cards")
    .eq("client_id", clientId)
    .eq("task_id", t.id)
    .order("atualizado_em", { ascending: false })
    .limit(5);
  const lista = (trabalhos ?? []) as Array<{ status: string; entrega_status: string | null; cards: unknown }>;
  if (lista.some((w) => w.entrega_status && ENTREGAS_QUE_TRAVAM.includes(w.entrega_status))) {
    throw new ErroHttp(409, "arte_aprovada", "A arte deste conteúdo já foi aprovada ou agendada. Ele não sai por aqui para a aprovação não se perder.");
  }
  const temArte = lista.some((w) => ["gerando", "pronto", "entregue"].includes(w.status) || !!w.entrega_status || (Array.isArray(w.cards) && w.cards.length > 0));
  if (temArte && corpo.confirmar_arte !== true) {
    throw new ErroHttp(409, "item_com_arte", "Este conteúdo já tem arte no Estúdio. Confirme para apagar: a arte fica guardada no Estúdio e nenhum arquivo é apagado.", { arte: true });
  }

  const inicio = Date.now();
  const { error } = await servico.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id).is("deleted_at", null);
  if (error) throw new ErroHttp(500, "item_nao_apagado", "Não foi possível apagar o item da agenda. Tente de novo.");
  const memoriaId = await lembrarDoApagado(
    servico,
    clientId,
    t.id,
    `A equipe apagou da agenda o conteúdo "${titulo}"${t.due_date ? ` de ${t.due_date}` : ""}. Não proponha de novo o mesmo tema sem pedido.`,
  );
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "mesa_apagar_item_da_agenda", origin: "mesa:agente-calendario",
    keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
    input: { client_id: clientId, task_id: t.id, confirmar_arte: corpo.confirmar_arte === true },
    success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: t.id,
  });
  return json({ task_id: t.id, titulo, arte: temArte, memoria_id: memoriaId });
}

/** restaurar_item_agenda { client_id, task_id, memoria_id? }: desfaz o arquivar_item_agenda. */
async function restaurarItemDaAgenda(servico: SupabaseClient, chamador: Chamador, corpo: Record<string, unknown>) {
  const clientId = String(corpo.client_id ?? "");
  await exigirAcessoAoCliente(chamador, clientId);
  const t = await tarefaDoCliente(servico, corpo.task_id, clientId);
  await esquecerMemoria(servico, clientId, corpo.memoria_id);
  if (!t.deleted_at) return json({ task_id: t.id, ja_estava_na_agenda: true });
  const inicio = Date.now();
  const { error } = await servico.from("tasks").update({ deleted_at: null }).eq("id", t.id);
  if (error) throw new ErroHttp(500, "item_nao_restaurado", "Não foi possível devolver o item para a agenda. Tente de novo.");
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "mesa_restaurar_item_da_agenda", origin: "mesa:agente-calendario",
    keyId: `${PRINCIPAL_MESA}:${chamador.userId}`, scopes: ["editorial:write"],
    input: { client_id: clientId, task_id: t.id },
    success: true, statusCode: 200, durationMs: Date.now() - inicio, resultRef: t.id,
  });
  return json({ task_id: t.id, titulo: t.title });
}

const ACOES: Record<string, (s: SupabaseClient, c: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  planejar_mes: planejarMes,
  aplicar_mudanca: aplicarMudanca,
  tirar_item: tirarItem,
  repor_item: reporItem,
  arquivar_item_agenda: arquivarItemDaAgenda,
  restaurar_item_agenda: restaurarItemDaAgenda,
  pedido_livre: pedidoLivre,
  buscar_hypes: buscarHypes,
  campanha_criar: campanhaCriar,
  campanha_ajustar: campanhaAjustar,
  campanha_selo: campanhaSelo,
  campanha_conversar: campanhaConversar,
  campanha_salvar: campanhaSalvar,
  campanha_plano_imagens: campanhaPlanoImagens,
  propor_temas: proporTemas,
  escolher_temas: escolherTemas,
  detalhar,
  conversar,
  gravar,
  completar_itens: completarItens,
};

/** Ações com IA: a resposta começa na hora para a plataforma não derrubar com 504 aos 150 s. */
const ACOES_LONGAS = new Set(["planejar_mes", "pedido_livre","buscar_hypes", "campanha_criar", "campanha_ajustar", "campanha_conversar", "campanha_plano_imagens", "propor_temas", "detalhar", "conversar", "gravar", "completar_itens"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);
  try {
    const servico = clienteServico();
    const chamador = await identificar(req, servico);
    let corpo: Record<string, unknown> = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? corpo.action ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", aceitas: Object.keys(ACOES) }, 400);
    if (ACOES_LONGAS.has(acao)) {
      return respostaComFolego(async () => {
        try {
          return await fn(servico, chamador, corpo);
        } catch (err) {
          return respostaDeErro(err);
        }
      }, corsHeaders);
    }
    return await fn(servico, chamador, corpo);
  } catch (err) {
    return respostaDeErro(err);
  }
});
